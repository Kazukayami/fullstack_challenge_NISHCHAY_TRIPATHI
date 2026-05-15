import express from "express";
import cors from "cors";
import crypto from "crypto";
import { DatabaseSync } from "node:sqlite";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(__dirname, "data");
const dbFile = path.join(dataDir, "note_nest.sqlite");
const port = process.env.PORT || 4000;
const sessionSecret = process.env.SESSION_SECRET || "dev-session-secret-change-before-production";
const isProduction = process.env.NODE_ENV === "production";

await fs.mkdir(dataDir, { recursive: true });
const db = new DatabaseSync(dbFile);
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA journal_mode = WAL");

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

function now() {
  return new Date().toISOString();
}

function json(value, fallback = []) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function stringify(value) {
  return JSON.stringify(value ?? []);
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map(String).map((tag) => tag.trim()).filter(Boolean);
  return String(tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function noteFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    content: row.content,
    tags: json(row.tags),
    category: row.category,
    summary: row.summary,
    actionItems: json(row.action_items),
    suggestedTitle: row.suggested_title,
    isPublic: Boolean(row.is_public),
    shareId: row.share_id,
    isArchived: Boolean(row.is_archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, originalHash] = String(storedHash || "").split(":");
  if (!salt || !originalHash) return false;
  const candidate = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(originalHash, "hex"));
}

function signSession(userId) {
  const payload = Buffer.from(
    JSON.stringify({ userId, expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7 })
  ).toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readSession(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  return session.expiresAt > Date.now() ? session : null;
}

function getCookie(req, name) {
  const cookies = Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim().split("="))
      .filter(([key, value]) => key && value)
  );
  return cookies[name];
}

function setSessionCookie(res, userId) {
  const cookie = [
    `nn_session=${signSession(userId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=604800"
  ];
  if (isProduction) cookie.push("Secure");
  res.setHeader("Set-Cookie", cookie.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "nn_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      category TEXT NOT NULL DEFAULT 'General',
      summary TEXT NOT NULL DEFAULT '',
      action_items TEXT NOT NULL DEFAULT '[]',
      suggested_title TEXT NOT NULL DEFAULT '',
      is_public INTEGER NOT NULL DEFAULT 0,
      share_id TEXT NOT NULL UNIQUE,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      note_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notes_share_id ON notes(share_id);
  `);

  const count = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (count > 0) return;

  const timestamp = now();
  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run("USR_DEMO", "Demo User", "demo@example.com", hashPassword("password123"), timestamp);
  const insertNote = db.prepare(`
    INSERT INTO notes (
      id, user_id, title, content, tags, category, summary, action_items, suggested_title,
      is_public, share_id, is_archived, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertNote.run(
    "NOTE_LAUNCH",
    "USR_DEMO",
    "Launch plan",
    "Finalize the landing page copy, review onboarding tasks, and schedule a Friday check-in. Prepare UI mockups, review API structure, and confirm public sharing before launch.",
    stringify(["work", "planning"]),
    "Projects",
    "Finalize launch copy, onboarding, UI mockups, API review, public sharing, and a Friday check-in.",
    stringify(["Prepare UI mockups", "Review API structure", "Confirm public sharing"]),
    "Launch Planning Notes",
    1,
    "share-launch-plan",
    0,
    timestamp,
    timestamp
  );
  insertNote.run(
    "NOTE_READING",
    "USR_DEMO",
    "Reading notes",
    "Good notes preserve decisions, context, and the reason a detail mattered. Keep summaries brief, write in your own words, and tag ideas with the future use case instead of the source.",
    stringify(["learning", "writing"]),
    "Personal",
    "Good notes capture decisions, context, meaning, concise summaries, and future-use tags.",
    stringify(["Rewrite key ideas in your own words", "Tag notes by future use case"]),
    "Better Personal Notes",
    0,
    crypto.randomUUID(),
    0,
    timestamp,
    timestamp
  );
  db.prepare(
    "INSERT INTO ai_events (id, user_id, note_id, provider, type, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(crypto.randomUUID(), "USR_DEMO", "NOTE_LAUNCH", "local", "summary_action_title", timestamp);
}

migrate();

function requireAuth(req, res, next) {
  const session = readSession(getCookie(req, "nn_session"));
  if (!session) return res.status(401).json({ error: "Authentication required" });
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.userId);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  req.user = user;
  next();
}

function scoreSummary(content) {
  const text = String(content || "").replace(/\s+/g, " ").trim();
  if (!text) return "Add note content to generate a useful summary.";
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const words = text.toLowerCase().match(/[a-z0-9']+/g) || [];
  const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "your", "into"]);
  const freq = new Map();
  for (const word of words) {
    if (word.length > 2 && !stop.has(word)) freq.set(word, (freq.get(word) || 0) + 1);
  }
  return sentences
    .map((sentence, index) => ({
      sentence: sentence.trim(),
      index,
      score: (sentence.toLowerCase().match(/[a-z0-9']+/g) || []).reduce(
        (total, word) => total + (freq.get(word) || 0),
        0
      )
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence)
    .join(" ")
    .slice(0, 280);
}

function localAi(content) {
  const text = String(content || "").replace(/\s+/g, " ").trim();
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  const actionItems = sentences
    .filter((sentence) => /\b(prepare|review|follow up|schedule|confirm|create|send|update|finalize|write|tag|fix|ship)\b/i.test(sentence))
    .slice(0, 5)
    .map((sentence) => sentence.replace(/[.!?]+$/, "").trim());
  const keywords = [...new Set((text.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) || []))]
    .filter((word) => !["notes", "this", "that", "with", "from", "your", "keep", "good", "before"].includes(word))
    .slice(0, 3);
  return {
    summary: scoreSummary(content),
    action_items: actionItems.length ? actionItems : ["Review and refine this note"],
    suggested_title: keywords.length
      ? `${keywords.map((word) => word[0].toUpperCase() + word.slice(1)).join(" ")} Notes`
      : "Untitled Note",
    provider: "local"
  };
}

async function generateAi(content) {
  if (!process.env.OPENAI_API_KEY) return localAi(content);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: `Return strict JSON with keys summary, action_items, suggested_title for this note. action_items must be an array.\n\n${content}`
      })
    });
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
    const data = await response.json();
    return { ...JSON.parse(data.output_text), provider: "openai" };
  } catch {
    return localAi(content);
  }
}

function selectUserNotes(userId, query) {
  const archived = String(query.archived || "active") === "archived" ? 1 : 0;
  const rows = db
    .prepare("SELECT * FROM notes WHERE user_id = ? AND is_archived = ? ORDER BY updated_at DESC")
    .all(userId, archived);
  const search = String(query.search || "").toLowerCase();
  const tag = String(query.tag || "").toLowerCase();
  const category = String(query.category || "").toLowerCase();

  return rows
    .map(noteFromRow)
    .filter((note) => {
      const haystack = [
        note.title,
        note.content,
        note.summary,
        note.category,
        note.suggestedTitle,
        ...note.tags,
        ...note.actionItems
      ]
        .join(" ")
        .toLowerCase();
      return (
        (!search || haystack.includes(search)) &&
        (!tag || note.tags.some((item) => item.toLowerCase() === tag)) &&
        (!category || note.category.toLowerCase() === category)
      );
    });
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    database: "sqlite",
    aiProvider: process.env.OPENAI_API_KEY ? "openai" : "local-fallback"
  });
});

app.post("/api/auth/signup", (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!name || !email || password.length < 8) {
    return res.status(400).json({ error: "Name, email, and an 8+ character password are required" });
  }
  if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
    return res.status(409).json({ error: "Email is already registered" });
  }
  const user = {
    id: `USR_${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    name,
    email,
    password_hash: hashPassword(password),
    created_at: now()
  };
  db.prepare("INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(
    user.id,
    user.name,
    user.email,
    user.password_hash,
    user.created_at
  );
  setSessionCookie(res, user.id);
  res.status(201).json(publicUser(user));
});

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  setSessionCookie(res, user.id);
  res.json(publicUser(user));
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

app.post("/api/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

app.get("/api/notes", requireAuth, (req, res) => {
  res.json(selectUserNotes(req.user.id, req.query));
});

app.post("/api/notes", requireAuth, (req, res) => {
  const timestamp = now();
  const note = {
    id: `NOTE_${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    userId: req.user.id,
    title: String(req.body.title || "Untitled note").trim(),
    content: String(req.body.content || "").trim(),
    tags: normalizeTags(req.body.tags),
    category: String(req.body.category || "General").trim(),
    summary: String(req.body.summary || "").trim(),
    actionItems: Array.isArray(req.body.actionItems) ? req.body.actionItems : [],
    suggestedTitle: String(req.body.suggestedTitle || "").trim(),
    isPublic: Boolean(req.body.isPublic),
    shareId: crypto.randomUUID(),
    isArchived: false,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  db.prepare(`
    INSERT INTO notes (
      id, user_id, title, content, tags, category, summary, action_items, suggested_title,
      is_public, share_id, is_archived, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    note.id,
    note.userId,
    note.title,
    note.content,
    stringify(note.tags),
    note.category,
    note.summary,
    stringify(note.actionItems),
    note.suggestedTitle,
    note.isPublic ? 1 : 0,
    note.shareId,
    0,
    note.createdAt,
    note.updatedAt
  );
  res.status(201).json(note);
});

app.put("/api/notes/:id", requireAuth, (req, res) => {
  const current = db.prepare("SELECT * FROM notes WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!current) return res.status(404).json({ error: "Note not found" });
  const note = {
    ...noteFromRow(current),
    title: String(req.body.title || "Untitled note").trim(),
    content: String(req.body.content || "").trim(),
    tags: normalizeTags(req.body.tags),
    category: String(req.body.category || "General").trim(),
    summary: String(req.body.summary || "").trim(),
    actionItems: Array.isArray(req.body.actionItems) ? req.body.actionItems : json(current.action_items),
    suggestedTitle: String(req.body.suggestedTitle || current.suggested_title || "").trim(),
    isPublic: Boolean(req.body.isPublic),
    updatedAt: now()
  };
  db.prepare(`
    UPDATE notes
    SET title = ?, content = ?, tags = ?, category = ?, summary = ?, action_items = ?,
      suggested_title = ?, is_public = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    note.title,
    note.content,
    stringify(note.tags),
    note.category,
    note.summary,
    stringify(note.actionItems),
    note.suggestedTitle,
    note.isPublic ? 1 : 0,
    note.updatedAt,
    note.id,
    req.user.id
  );
  res.json(note);
});

app.patch("/api/notes/:id/archive", requireAuth, (req, res) => {
  const current = db.prepare("SELECT * FROM notes WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!current) return res.status(404).json({ error: "Note not found" });
  db.prepare("UPDATE notes SET is_archived = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(
    req.body.isArchived ? 1 : 0,
    now(),
    req.params.id,
    req.user.id
  );
  res.json(noteFromRow(db.prepare("SELECT * FROM notes WHERE id = ?").get(req.params.id)));
});

app.delete("/api/notes/:id", requireAuth, (req, res) => {
  const result = db.prepare("DELETE FROM notes WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: "Note not found" });
  res.status(204).end();
});

app.post("/api/notes/:id/ai", requireAuth, async (req, res) => {
  const current = db.prepare("SELECT * FROM notes WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!current) return res.status(404).json({ error: "Note not found" });
  const result = await generateAi(current.content);
  const timestamp = now();
  db.prepare(`
    UPDATE notes
    SET summary = ?, action_items = ?, suggested_title = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    result.summary,
    stringify(result.action_items || []),
    result.suggested_title || "",
    timestamp,
    req.params.id,
    req.user.id
  );
  db.prepare("INSERT INTO ai_events (id, user_id, note_id, provider, type, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    crypto.randomUUID(),
    req.user.id,
    req.params.id,
    result.provider || "local",
    "summary_action_title",
    timestamp
  );
  res.json(noteFromRow(db.prepare("SELECT * FROM notes WHERE id = ?").get(req.params.id)));
});

app.get("/api/notes/public/:shareId", (req, res) => {
  const row = db
    .prepare("SELECT * FROM notes WHERE share_id = ? AND is_public = 1 AND is_archived = 0")
    .get(req.params.shareId);
  if (!row) return res.status(404).json({ error: "Public note not found" });
  const owner = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id);
  res.json({ ...noteFromRow(row), owner: owner ? publicUser(owner) : null });
});

app.get("/api/insights", requireAuth, (req, res) => {
  const notes = db.prepare("SELECT * FROM notes WHERE user_id = ?").all(req.user.id).map(noteFromRow);
  const active = notes.filter((note) => !note.isArchived);
  const tagCounts = new Map();
  const dayCounts = new Map();
  let words = 0;

  for (const note of active) {
    words += (note.content.match(/\S+/g) || []).length;
    for (const tag of note.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    const day = note.updatedAt.slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
  }

  const sevenDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.now() - (6 - index) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return { date, count: dayCounts.get(date) || 0 };
  });

  res.json({
    totalNotes: active.length,
    archivedNotes: notes.length - active.length,
    publicNotes: active.filter((note) => note.isPublic).length,
    totalWords: words,
    aiUsage: db.prepare("SELECT COUNT(*) AS count FROM ai_events WHERE user_id = ?").get(req.user.id).count,
    aiProvider: process.env.OPENAI_API_KEY ? "openai" : "local-fallback",
    recentNotes: active
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5)
      .map((note) => ({ id: note.id, title: note.title, updatedAt: note.updatedAt })),
    topTags: [...tagCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    weeklyActivity: sevenDays
  });
});

app.use(express.static(path.join(rootDir, "dist")));
app.use((_req, res) => {
  res.sendFile(path.join(rootDir, "dist", "index.html"));
});

app.listen(port, () => {
  console.log(`Note Nest API running on http://127.0.0.1:${port}`);
  console.log(`SQLite database attached at ${dbFile}`);
});
