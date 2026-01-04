const express = require("express");
const session = require("express-session");
const QRCode = require("qrcode");
const multer = require("multer");
const fs = require("fs");
const { parse } = require("csv-parse/sync");
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: "secret123",
  resave: false,
  saveUninitialized: true
}));

const USERNAME = "admin";
const PASSWORD = "12345";

let sock, latestQR = "", connected = false;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  sock = makeWASocket({ auth: state, printQRInTerminal: false });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { qr, connection, lastDisconnect } = update;
    if (qr) latestQR = await QRCode.toDataURL(qr);

    if (connection === "open") {
      connected = true;
      latestQR = "";
    }

    if (connection === "close") {
      connected = false;
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        startBot(); // auto reconnect
      }
    }
  });
}
startBot();

function auth(req, res, next) {
  if (!req.session.login) return res.redirect("/login");
  next();
}

const upload = multer({ dest: "uploads/" });

app.get("/login", (req, res) => res.sendFile(__dirname + "/views/login.html"));

app.post("/login", (req, res) => {
  if (req.body.username === USERNAME && req.body.password === PASSWORD) {
    req.session.login = true;
    return res.redirect("/");
  }
  res.send("Wrong login");
});

app.get("/logout", auth, (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/", auth, (req, res) => res.sendFile(__dirname + "/views/dashboard.html"));

app.get("/qr", auth, (req, res) => {
  if (connected) return res.send("CONNECTED");
  res.send(`<img src="${latestQR}" width="280"/>`);
});

app.post("/send-campaign", auth, upload.single("numbers"), async (req, res) => {
  let numbers = [];
  const { message, delay, repeat } = req.body;

  if (req.file.originalname.endsWith(".csv")) {
    const csv = fs.readFileSync(req.file.path);
    const records = parse(csv, { skip_empty_lines: true });
    numbers = records.flat();
  } else {
    numbers = fs.readFileSync(req.file.path, "utf-8").split(/\r?\n/).filter(Boolean);
  }

  (async () => {
    for (let r = 0; r < repeat; r++) {
      for (const num of numbers) {
        await sock.sendMessage(num + "@s.whatsapp.net", { text: message });
        await new Promise(x => setTimeout(x, delay * 1000));
      }
    }
  })();

  res.send("Campaign Started");
});

app.listen(3000, () => console.log("Server running"));
