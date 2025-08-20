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

// ---------- ENV ----------
const {
  JWT_SECRET = "0f6ade702b5cd881ac1b8e557ed51771",
  TOKEN_TTL_SECONDS = "900",
  BASE_URL = "http://localhost:8888/",
  COOKIE_SECURE = "false",
  NODE_ENV = "development",
  SMTP_HOST = "smtp.gmail.com",
  SMTP_PORT = "465",
  SMTP_SECURE = "true",
  SMTP_USER,
  SMTP_PASS,
  EMAIL_FROM = SMTP_USER,
  GITHUB_TOKEN,
  GITHUB_REPO, // "owner/repo"
  GITHUB_BRANCH = "main"
} = process.env;

if (!GITHUB_TOKEN || !GITHUB_REPO) {
  console.warn("[WARN] GITHUB_TOKEN and GITHUB_REPO are required for GitHub storage.");
}

const [owner, repo] = (GITHUB_REPO || "/").split("/");
const tokenTtl = Number(TOKEN_TTL_SECONDS);
const cookieSecure = COOKIE_SECURE === "true" || NODE_ENV === "production";

// ---------- GitHub ----------
const octokit = new Octokit({ auth: GITHUB_TOKEN });
const STORAGE_ROOT = "uploads"; // repo folder root

// ---------- Nodemailer ----------
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: SMTP_SECURE === "true",
  auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
});

// Quick check (won’t throw if provider blocks, but verifies config)
transporter.verify().then(
  () => console.log("[smtp] transporter ready"),
  (e) => console.warn("[smtp] transporter verify failed:", e.message)
);

// ---------- One-time JWT ----------
const usedJtis = new Set();

function signLoginToken(email) {
  const jti = nanoid();
  const token = jwt.sign({ sub: email }, JWT_SECRET, {
    expiresIn: tokenTtl,
    jwtid: jti
  });
  return { token, jti };
}

function verifyOnce(token) {
  const payload = jwt.verify(token, JWT_SECRET);
  if (usedJtis.has(payload.jti)) {
    throw new Error("Token already used");
  }
  usedJtis.add(payload.jti);
  return payload.sub; // email
}

// ---------- Auth Middleware ----------
function requireAuth(req, res, next) {
  const email = req.cookies?.auth;
  if (!email) return res.status(401).json({ error: "Not authenticated" });
  req.user = email;
  next();
}

// ---------- Multer ----------
const allowedTypes = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "text/csv", // .csv
  "application/x-sqlite3", // .sqlite
  "application/octet-stream" // .db (generic)
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB (adjust as needed)
  },
  fileFilter: (req, file, cb) => {
    if (allowedTypes.has(file.mimetype)) cb(null, true);
    else cb(new Error("File type not allowed"), false);
  }
});

// ---------- Helpers ----------
async function ghCreateOrUpdate(path, buffer, message) {
  try {
    // Try to create
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      branch: GITHUB_BRANCH,
      message,
      content: buffer.toString("base64")
    });
  } catch (err) {
    // If file exists, update
    if (err?.status === 422 || /exists/.test(err?.message || "")) {
      const existing = await octokit.repos.getContent({ owner, repo, path, ref: GITHUB_BRANCH });
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        branch: GITHUB_BRANCH,
        message,
        content: buffer.toString("base64"),
        sha: existing.data.sha
      });
    } else {
      throw err;
    }
  }
}

function sanitizePath(p) {
  // prevent path traversal
  if (!p || p.includes("..")) throw new Error("Invalid path");
  return p.replace(/^\/+/, "");
}

// ---------- Routes ----------

// Request magic link
app.post("/api/request-access", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: "Valid email required" });

    const { token } = signLoginToken(email);
    const link = `${BASE_URL}/api/callback?token=${encodeURIComponent(token)}`;

    await transporter.sendMail({
      from: EMAIL_FROM || SMTP_USER,
      to: email,
      subject: "Your secure access link",
      text: `Click this link to sign in: ${link}`,
      html: `<p>Click this link to sign in: <a href="${link}">${link}</a></p>`
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[/api/request-access] error:", err);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// Magic link callback -> sets cookie
app.get("/api/callback", (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send("Missing token");
    const email = verifyOnce(token);

    res.cookie("auth", email, {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure,
      maxAge: 6 * 60 * 60 * 1000 // 6 hours
    });

    res.send("✅ Signed in! You can close this tab and return to the app.");
  } catch (e) {
    console.error("[/api/callback] error:", e.message);
    res.status(400).send("Invalid or expired token");
  }
});

// Upload
app.post("/api/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const timestamp = Date.now();
    const userFolder = `${STORAGE_ROOT}/${encodeURIComponent(req.user)}`;
    const path = `${userFolder}/${timestamp}-${req.file.originalname}`;

    await ghCreateOrUpdate(path, req.file.buffer, `Upload ${req.file.originalname}`);

    res.json({ ok: true, path, name: req.file.originalname, size: req.file.size });
  } catch (err) {
    console.error("[/api/upload] error:", err.message);
    res.status(500).json({ error: "Upload failed" });
  }
});

// List
app.get("/api/list", requireAuth, async (req, res) => {
  try {
    const userFolder = `${STORAGE_ROOT}/${encodeURIComponent(req.user)}`;
    const r = await octokit.repos.getContent({ owner, repo, path: userFolder, ref: GITHUB_BRANCH });
    const files = Array.isArray(r.data)
      ? r.data
          .filter((item) => item.type === "file")
          .map((f) => ({ name: f.name, path: f.path, sha: f.sha, size: f.size }))
      : [];
    res.json(files);
  } catch (err) {
    if (err.status === 404) return res.json([]); // no files yet
    console.error("[/api/list] error:", err.message);
    res.status(500).json({ error: "List failed" });
  }
});

// Download
app.get("/api/download", requireAuth, async (req, res) => {
  try {
    const rawPath = req.query.path;
    const path = sanitizePath(rawPath);

    // ensure file is under the user's folder
    const prefix = `${STORAGE_ROOT}/${encodeURIComponent(req.user)}/`;
    if (!path.startsWith(prefix)) return res.status(403).json({ error: "Forbidden" });

    const file = await octokit.repos.getContent({ owner, repo, path, ref: GITHUB_BRANCH });
    const content = Buffer.from(file.data.content, file.data.encoding || "base64");

    res.setHeader("Content-Disposition", `attachment; filename="${file.data.name}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(content);
  } catch (err) {
    console.error("[/api/download] error:", err.message);
    res.status(404).json({ error: "File not found" });
  }
});

// Delete
app.delete("/api/delete", requireAuth, async (req, res) => {
  try {
    const rawPath = req.query.path;
    const path = sanitizePath(rawPath);

    const prefix = `${STORAGE_ROOT}/${encodeURIComponent(req.user)}/`;
    if (!path.startsWith(prefix)) return res.status(403).json({ error: "Forbidden" });

    const existing = await octokit.repos.getContent({ owner, repo, path, ref: GITHUB_BRANCH });
    await octokit.repos.deleteFile({
      owner,
      repo,
      path,
      branch: GITHUB_BRANCH,
      sha: existing.data.sha,
      message: `Delete ${existing.data.name}`
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[/api/delete] error:", err.message);
    res.status(404).json({ error: "File not found" });
  }
});

// Health
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", ts: new Date().toISOString() });
});

export const handler = serverless(app);
