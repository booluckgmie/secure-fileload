// netlify/functions/api.js
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import multer from "multer";
import { Octokit } from "@octokit/rest";
import { nanoid } from "nanoid";
import serverless from "serverless-http";

const app = express();
app.use(express.json());
app.use(cookieParser());

// ✅ Environment config
const JWT_SECRET = process.env.JWT_SECRET || "replace_this_secret";
const BASE_URL = process.env.BASE_URL || "http://localhost:8888"; // <-- ROOT site, not /functions/api
const TOKEN_TTL_SECONDS = Number(process.env.TOKEN_TTL_SECONDS || 900);

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const GITHUB_REPO = process.env.GITHUB_REPO; // "owner/repo"
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

// ✅ Mailer
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const usedJtis = new Set();

function signLoginToken(email) {
  const jti = nanoid();
  const token = jwt.sign({ sub: email }, JWT_SECRET, {
    expiresIn: TOKEN_TTL_SECONDS,
    jwtid: jti
  });
  return { token, jti };
}

function verifyOnce(token) {
  const payload = jwt.verify(token, JWT_SECRET);
  if (usedJtis.has(payload.jti)) throw new Error("Token already used");
  usedJtis.add(payload.jti);
  return payload.sub;
}

function requireAuth(req, res, next) {
  if (!req.cookies?.auth) return res.status(401).json({ error: "Not authenticated" });
  req.user = req.cookies.auth;
  next();
}

// ✅ Request access link
app.post("/api/request-access", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    const { token } = signLoginToken(email);
    const link = `${BASE_URL}/.netlify/functions/api/callback?token=${encodeURIComponent(token)}`;

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: email,
      subject: "Your access link",
      html: `<p>Click this link to sign in: <a href="${link}">${link}</a></p>`
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// ✅ Magic link callback
app.get("/api/callback", (req, res) => {
  try {
    const email = verifyOnce(req.query.token);
    res.cookie("auth", email, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: 6 * 60 * 60 * 1000
    });
    res.send("✅ Signed in! You can close this tab and return to the app.");
  } catch (e) {
    res.status(400).send("Invalid or expired token");
  }
});

// ✅ File Upload
const allowedTypes = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/x-sqlite3",
  "application/octet-stream"
];

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error("File type not allowed"), false);
  }
});

app.post("/api/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const path = `uploads/${req.user}/${Date.now()}-${req.file.originalname}`;
    await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_REPO.split("/")[0],
      repo: GITHUB_REPO.split("/")[1],
      path,
      branch: GITHUB_BRANCH,
      message: `Upload ${req.file.originalname}`,
      content: req.file.buffer.toString("base64")
    });

    res.json({ ok: true, path });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// ✅ List user uploads
app.get("/api/list", requireAuth, async (req, res) => {
  try {
    const r = await octokit.repos.getContent({
      owner: GITHUB_REPO.split("/")[0],
      repo: GITHUB_REPO.split("/")[1],
      path: `uploads/${req.user}`,
      ref: GITHUB_BRANCH
    });
    res.json(r.data);
  } catch (err) {
    if (err.status === 404) return res.json([]);
    console.error(err);
    res.status(500).json({ error: "List failed" });
  }
});

export const handler = serverless(app);
