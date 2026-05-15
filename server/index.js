import express from "express";
import cors from "cors";
import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(__dirname, "data");
const dataFile = path.join(dataDir, "database.json");
const port = process.env.PORT || 4000;
const sessionSecret = process.env.SESSION_SECRET || "dev-session-secret-change-before-production";
const isProduction = process.env.NODE_ENV === "production";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

function now() {
  return new Date().toISOString();
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, originalHash] = String(storedHash).split(":");
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

async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(dataFile);
  } catch {
    const userId = "USR_DEMO";
    const createdAt = now();
    await fs.writeFile(
      dataFile,
      JSON.stringify(
        {
          users: [
            {
              id: userId,
              name: "Demo User",
              email: "demo@example.com",
              passwordHash: hashPassword("password123"),
              createdAt
            }
          ],
          notes: [
            {
              id: "NOTE_LAUNCH",
              userId,
              title: "Launch plan",
              content:
                "Finalize the landing page copy, review onboarding tasks, and schedule a Friday check-in. Prepare UI mockups, review API structure, and confirm public sharing before launch.",
              tags: ["work", "planning"],
              category: "Projects",
              summary:
                "Finalize launch copy, onboarding, UI mockups, API review, public sharing, and a Friday check-in.",
              actionItems: ["Prepare UI mockups", "Review API structure", "Confirm public sharing"],
              suggestedTitle: "Launch Planning Notes",
              isPublic: true,
              shareId: "share-launch-plan",
              isArchived: false,
              createdAt,
              updatedAt: createdAt
            },
            {
              id: "NOTE_READING",
              userId,
              title: "Reading notes",
              content:
                "Good notes preserve decisions, context, and the reason a detail mattered. Keep summaries brief, write in your own words, and tag ideas with the future use case instead of the source.",
              tags: ["learning", "writing"],
              category: "Personal",
              summary:
                "Good notes capture decisions, context, meaning, concise summaries, and future-use tags.",
              actionItems: ["Rewrite key ideas in your own words", "Tag notes by future use case"],
              suggestedTitle: "Better Personal Notes",
              isPublic: false,
              shareId: crypto.randomUUID(),
              isArchived: false,
              createdAt,
              updatedAt: createdAt
            }
          ],
          aiEvents: [
            { id: crypto.randomUUID(), userId, noteId: "NOTE_LAUNCH", createdAt, type: "summary" }
          ]
        },
        null,
        2
      )
    );
  }
}

async function readDb() {
  await ensureStore();
  return JSON.parse(await fs.readFile(dataFile, "utf8"));
}

async function writeDb(db) {
  await fs.writeFile(dataFile, JSON.stringify(db, null, 2));
}

async function requireAuth(req, res, next) {
  const session = readSession(getCookie(req, "nn_session"));
  if (!session) return res.status(401).json({ error: "Authentication required" });
  const db = await readDb();
  const user = db.users.find((item) => item.id === session.userId);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  req.user = user;
  req.db = db;
  next();
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map(String).map((tag) => tag.trim()).filter(Boolean);
  return String(tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
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
    .filter((sentence) => /\b(prepare|review|follow up|schedule|confirm|create|send|update|finalize|write|tag)\b/i.test(sentence))
    .slice(0, 5)
    .map((sentence) => sentence.replace(/[.!?]+$/, "").trim());
  const frequent = [...new Set((text.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) || []))]
    .filter((word) => !["notes", "this", "that", "with", "from", "your", "keep", "good"].includes(word))
    .slice(0, 3);
  const suggestedTitle =
    frequent.length > 0
      ? frequent.map((word) => word[0].toUpperCase() + word.slice(1)).join(" ") + " Notes"
      : "Untitled Note";
  return {
    summary: scoreSummary(content),
    action_items: actionItems.length ? actionItems : ["Review and refine this note"],
    suggested_title: suggestedTitle
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
        input: `Return only JSON with keys summary, action_items, suggested_title for this note:\n\n${content}`
      })
    });
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
    const data = await response.json();
    return JSON.parse(data.output_text);
  } catch {
    return localAi(content);
  }
}

function userNotes(db, userId) {
  return db.notes.filter((note) => note.userId === userId);
}

function filterNotes(notes, query) {
  const search = String(query.search || "").toLowerCase();
  const tag = String(query.tag || "").toLowerCase();
  const category = String(query.category || "").toLowerCase();
  const archived = String(query.archived || "active");

  return notes
    .filter((note) => {
      const haystack = [
        note.title,
        note.content,
        note.summary,
        note.category,
        note.suggestedTitle,
        ...(note.tags || []),
        ...(note.actionItems || [])
      ]
        .join(" ")
        .toLowerCase();
      return (
        (!search || haystack.includes(search)) &&
        (!tag || note.tags?.some((item) => item.toLowerCase() === tag)) &&
        (!category || note.category?.toLowerCase() === category) &&
        ((archived === "archived" && note.isArchived) || (archived !== "archived" && !note.isArchived))
      );
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

app.post("/api/auth/signup", async (req, res) => {
  const db = await readDb();
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!name || !email || password.length < 8) {
    return res.status(400).json({ error: "Name, email, and an 8+ character password are required" });
  }
  if (db.users.some((user) => user.email === email)) {
    return res.status(409).json({ error: "Email is already registered" });
  }
  const user = {
    id: `USR_${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    name,
    email,
    passwordHash: hashPassword(password),
    createdAt: now()
  };
  db.users.push(user);
  await writeDb(db);
  setSessionCookie(res, user.id);
  res.status(201).json(publicUser(user));
});

app.post("/api/auth/login", async (req, res) => {
  const db = await readDb();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.users.find((item) => item.email === email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
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
  res.json(filterNotes(userNotes(req.db, req.user.id), req.query));
});

app.post("/api/notes", requireAuth, async (req, res) => {
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
  req.db.notes.push(note);
  await writeDb(req.db);
  res.status(201).json(note);
});

app.put("/api/notes/:id", requireAuth, async (req, res) => {
  const index = req.db.notes.findIndex((note) => note.id === req.params.id && note.userId === req.user.id);
  if (index === -1) return res.status(404).json({ error: "Note not found" });
  const current = req.db.notes[index];
  const note = {
    ...current,
    title: String(req.body.title || "Untitled note").trim(),
    content: String(req.body.content || "").trim(),
    tags: normalizeTags(req.body.tags),
    category: String(req.body.category || "General").trim(),
    summary: String(req.body.summary || "").trim(),
    actionItems: Array.isArray(req.body.actionItems) ? req.body.actionItems : current.actionItems || [],
    suggestedTitle: String(req.body.suggestedTitle || current.suggestedTitle || "").trim(),
    isPublic: Boolean(req.body.isPublic),
    updatedAt: now()
  };
  req.db.notes[index] = note;
  await writeDb(req.db);
  res.json(note);
});

app.patch("/api/notes/:id/archive", requireAuth, async (req, res) => {
  const index = req.db.notes.findIndex((note) => note.id === req.params.id && note.userId === req.user.id);
  if (index === -1) return res.status(404).json({ error: "Note not found" });
  req.db.notes[index].isArchived = Boolean(req.body.isArchived);
  req.db.notes[index].updatedAt = now();
  await writeDb(req.db);
  res.json(req.db.notes[index]);
});

app.delete("/api/notes/:id", requireAuth, async (req, res) => {
  const nextNotes = req.db.notes.filter((note) => !(note.id === req.params.id && note.userId === req.user.id));
  if (nextNotes.length === req.db.notes.length) return res.status(404).json({ error: "Note not found" });
  req.db.notes = nextNotes;
  await writeDb(req.db);
  res.status(204).end();
});

app.post("/api/notes/:id/ai", requireAuth, async (req, res) => {
  const index = req.db.notes.findIndex((note) => note.id === req.params.id && note.userId === req.user.id);
  if (index === -1) return res.status(404).json({ error: "Note not found" });
  const result = await generateAi(req.db.notes[index].content);
  req.db.notes[index] = {
    ...req.db.notes[index],
    summary: result.summary,
    actionItems: result.action_items || [],
    suggestedTitle: result.suggested_title || "",
    updatedAt: now()
  };
  req.db.aiEvents.push({
    id: crypto.randomUUID(),
    userId: req.user.id,
    noteId: req.db.notes[index].id,
    type: "summary_action_title",
    createdAt: now()
  });
  await writeDb(req.db);
  res.json(req.db.notes[index]);
});

app.get("/api/notes/public/:shareId", async (req, res) => {
  const db = await readDb();
  const note = db.notes.find((item) => item.shareId === req.params.shareId && item.isPublic && !item.isArchived);
  if (!note) return res.status(404).json({ error: "Public note not found" });
  const owner = db.users.find((user) => user.id === note.userId);
  res.json({ ...note, owner: owner ? publicUser(owner) : null });
});

app.get("/api/insights", requireAuth, (req, res) => {
  const notes = userNotes(req.db, req.user.id);
  const activeNotes = notes.filter((note) => !note.isArchived);
  const tagCounts = new Map();
  const dayCounts = new Map();
  let words = 0;

  for (const note of activeNotes) {
    words += (note.content.match(/\S+/g) || []).length;
    for (const tag of note.tags || []) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    const day = note.updatedAt.slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
  }

  const recentNotes = activeNotes
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5)
    .map((note) => ({ id: note.id, title: note.title, updatedAt: note.updatedAt }));

  const sevenDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.now() - (6 - index) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return { date, count: dayCounts.get(date) || 0 };
  });

  res.json({
    totalNotes: activeNotes.length,
    archivedNotes: notes.length - activeNotes.length,
    publicNotes: activeNotes.filter((note) => note.isPublic).length,
    totalWords: words,
    aiUsage: req.db.aiEvents.filter((event) => event.userId === req.user.id).length,
    recentNotes,
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
});
