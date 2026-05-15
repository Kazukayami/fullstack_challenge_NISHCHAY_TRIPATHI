import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Copy,
  Eye,
  FileText,
  Globe2,
  Lock,
  LogOut,
  Plus,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Wand2
} from "lucide-react";
import "./styles.css";

const emptyForm = {
  id: null,
  title: "",
  content: "",
  tags: "",
  category: "General",
  summary: "",
  actionItems: [],
  suggestedTitle: "",
  isPublic: false,
  isArchived: false,
  shareId: ""
};

const api = {
  async get(path) {
    const response = await fetch(path, { credentials: "include" });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  },
  async send(path, method, body) {
    const response = await fetch(path, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) throw new Error(await response.text());
    return response.status === 204 ? null : response.json();
  }
};

function normalizeForm(note) {
  return {
    ...emptyForm,
    ...note,
    tags: (note.tags || []).join(", "),
    actionItems: note.actionItems || []
  };
}

function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "demo@example.com", password: "password123" });
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      const user = await api.send(`/api/auth/${mode}`, "POST", form);
      onAuthed(user);
    } catch {
      setError(mode === "login" ? "Invalid login details." : "Signup failed. Try another email.");
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-hero">
        <div className="hero-mark">
          <BookOpen size={34} />
        </div>
        <h1>Note Nest</h1>
        <p>Private notes, smart AI extraction, public sharing, and an insight dashboard in one polished workspace.</p>
        <div className="hero-grid">
          <span>Secure sessions</span>
          <span>Autosave editor</span>
          <span>AI action items</span>
          <span>Share pages</span>
        </div>
      </section>

      <form className="auth-card" onSubmit={submit}>
        <div className="tabs">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            Login
          </button>
          <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>
            Signup
          </button>
        </div>
        {mode === "signup" && (
          <label>
            Name
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
        )}
        <label>
          Email
          <input
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary-action">{mode === "login" ? "Enter workspace" : "Create account"}</button>
        <p className="hint">Demo login: demo@example.com / password123</p>
      </form>
    </main>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SharedPage({ shareId }) {
  const [note, setNote] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get(`/api/notes/public/${shareId}`)
      .then(setNote)
      .catch(() => setError("This note is private, archived, or no longer available."));
  }, [shareId]);

  return (
    <main className="shared-page">
      <article className="shared-note">
        <a href="/" className="back-link">
          Note Nest
        </a>
        {error && <p className="empty-state">{error}</p>}
        {!error && !note && <p className="empty-state">Loading public note...</p>}
        {note && (
          <>
            <div className="shared-meta">
              <Globe2 size={18} />
              Public note by {note.owner?.name || "Note Nest"}
            </div>
            <h1>{note.title}</h1>
            <div className="shared-tags">
              <span>{note.category}</span>
              {(note.tags || []).map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
            {note.summary && (
              <section className="shared-summary">
                <h2>Summary</h2>
                <p>{note.summary}</p>
              </section>
            )}
            <p className="shared-content">{note.content}</p>
          </>
        )}
      </article>
    </main>
  );
}

function Workspace({ user, onLogout }) {
  const [notes, setNotes] = useState([]);
  const [insights, setInsights] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [filters, setFilters] = useState({ search: "", tag: "", category: "", archived: "active" });
  const [status, setStatus] = useState("Ready");
  const [aiLoading, setAiLoading] = useState(false);
  const saveTimer = useRef(null);
  const firstAutosave = useRef(true);

  const categories = useMemo(
    () => [...new Set(notes.map((note) => note.category).filter(Boolean))].sort(),
    [notes]
  );
  const tags = useMemo(
    () => [...new Set(notes.flatMap((note) => note.tags || []))].sort(),
    [notes]
  );
  const selectedNote = notes.find((note) => note.id === selectedId);

  async function loadData(nextFilters = filters, keepSelection = true) {
    const params = new URLSearchParams(Object.entries(nextFilters).filter(([, value]) => value));
    const [nextNotes, nextInsights] = await Promise.all([
      api.get(`/api/notes?${params.toString()}`),
      api.get("/api/insights")
    ]);
    setNotes(nextNotes);
    setInsights(nextInsights);
    if (!keepSelection || !selectedId || !nextNotes.some((note) => note.id === selectedId)) {
      const next = nextNotes[0];
      setSelectedId(next?.id || null);
      setForm(next ? normalizeForm(next) : emptyForm);
    }
  }

  useEffect(() => {
    loadData({}, false).catch(() => setStatus("Could not load workspace"));
  }, []);

  useEffect(() => {
    if (!form.id) return;
    if (firstAutosave.current) {
      firstAutosave.current = false;
      return;
    }
    clearTimeout(saveTimer.current);
    setStatus("Unsaved changes");
    saveTimer.current = setTimeout(() => {
      saveCurrent("Autosaved").catch(() => setStatus("Autosave failed"));
    }, 900);
    return () => clearTimeout(saveTimer.current);
  }, [form.title, form.content, form.tags, form.category, form.isPublic]);

  function updateForm(patch) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function selectNote(note) {
    firstAutosave.current = true;
    setSelectedId(note.id);
    setForm(normalizeForm(note));
    setStatus("Editing");
  }

  function newNote() {
    firstAutosave.current = true;
    setSelectedId(null);
    setForm(emptyForm);
    setStatus("Drafting a new note");
  }

  async function saveCurrent(message = "Saved") {
    const payload = { ...form, tags: form.tags, title: form.title.trim() || "Untitled note" };
    const saved = form.id
      ? await api.send(`/api/notes/${form.id}`, "PUT", payload)
      : await api.send("/api/notes", "POST", payload);
    firstAutosave.current = true;
    setSelectedId(saved.id);
    setForm(normalizeForm(saved));
    setStatus(message);
    await loadData(filters);
    return saved;
  }

  async function manualSave(event) {
    event.preventDefault();
    await saveCurrent("Saved");
  }

  async function runAi() {
    const note = form.id ? form : await saveCurrent("Saved before AI");
    setAiLoading(true);
    const updated = await api.send(`/api/notes/${note.id}/ai`, "POST", {});
    setAiLoading(false);
    firstAutosave.current = true;
    setForm(normalizeForm(updated));
    setSelectedId(updated.id);
    setStatus("AI generated summary, actions, and title");
    await loadData(filters);
  }

  async function archiveNote() {
    if (!form.id) return;
    await api.send(`/api/notes/${form.id}/archive`, "PATCH", { isArchived: !form.isArchived });
    setStatus(form.isArchived ? "Restored" : "Archived");
    await loadData(filters, false);
  }

  async function deleteNote() {
    if (!form.id) return;
    await api.send(`/api/notes/${form.id}`, "DELETE", {});
    setStatus("Deleted");
    await loadData(filters, false);
  }

  async function logout() {
    await api.send("/api/auth/logout", "POST");
    onLogout();
  }

  function updateFilter(key, value) {
    const nextFilters = { ...filters, [key]: value };
    setFilters(nextFilters);
    loadData(nextFilters, false).catch(() => setStatus("Filter failed"));
  }

  function copyShareLink() {
    navigator.clipboard.writeText(`${window.location.origin}/shared/${form.shareId}`);
    setStatus("Public link copied");
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <FileText size={25} />
          <div>
            <h1>Note Nest</h1>
            <p>{user.name}'s secure workspace</p>
          </div>
        </div>
        <button className="primary-action" onClick={newNote}>
          <Plus size={18} />
          New note
        </button>
        <div className="search-box">
          <Search size={17} />
          <input
            placeholder="Search notes"
            value={filters.search}
            onChange={(event) => updateFilter("search", event.target.value)}
          />
        </div>
        <div className="filter-grid">
          <select value={filters.tag} onChange={(event) => updateFilter("tag", event.target.value)}>
            <option value="">All tags</option>
            {tags.map((tag) => (
              <option key={tag}>{tag}</option>
            ))}
          </select>
          <select value={filters.category} onChange={(event) => updateFilter("category", event.target.value)}>
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
          <select value={filters.archived} onChange={(event) => updateFilter("archived", event.target.value)}>
            <option value="active">Active notes</option>
            <option value="archived">Archived notes</option>
          </select>
        </div>
        <div className="note-list">
          {notes.map((note) => (
            <button
              className={`note-row ${selectedId === note.id ? "active" : ""}`}
              key={note.id}
              onClick={() => selectNote(note)}
            >
              <span className="note-row-title">{note.title}</span>
              <span className="note-row-meta">
                {note.category} | {note.tags?.slice(0, 2).join(", ") || "untagged"}
              </span>
            </button>
          ))}
          {!notes.length && <p className="empty">No notes match this view.</p>}
        </div>
        <button className="logout-button" onClick={logout}>
          <LogOut size={17} />
          Logout
        </button>
      </aside>

      <section className="workspace">
        <form className="editor" onSubmit={manualSave}>
          <div className="editor-topbar">
            <span className="status">{status}</span>
            <div className="topbar-actions">
              {form.id && form.isPublic && (
                <button type="button" className="icon-button" title="Copy public link" onClick={copyShareLink}>
                  <Copy size={18} />
                </button>
              )}
              {form.id && (
                <button type="button" className="icon-button" title="Archive note" onClick={archiveNote}>
                  <Archive size={18} />
                </button>
              )}
              {form.id && (
                <button type="button" className="icon-button danger" title="Delete note" onClick={deleteNote}>
                  <Trash2 size={18} />
                </button>
              )}
              <button className="save-button">Save</button>
            </div>
          </div>
          <input
            className="title-input"
            placeholder="Untitled note"
            value={form.title}
            onChange={(event) => updateForm({ title: event.target.value })}
          />
          <div className="meta-row">
            <label>
              <span>Category</span>
              <input value={form.category} onChange={(event) => updateForm({ category: event.target.value })} />
            </label>
            <label>
              <span>Tags</span>
              <input
                placeholder="work, meeting"
                value={form.tags}
                onChange={(event) => updateForm({ tags: event.target.value })}
              />
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={form.isPublic}
                onChange={(event) => updateForm({ isPublic: event.target.checked })}
              />
              <span>{form.isPublic ? <Globe2 size={16} /> : <Lock size={16} />}</span>
              Public
            </label>
          </div>
          <textarea
            className="content-input"
            placeholder="Capture ideas, decisions, meetings, or anything worth keeping..."
            value={form.content}
            onChange={(event) => updateForm({ content: event.target.value })}
          />
          <div className="ai-grid">
            <section className="ai-panel">
              <div className="panel-title">
                <Sparkles size={17} />
                <h2>AI Summary</h2>
              </div>
              <p>{form.summary || "Generate an AI summary from this note."}</p>
            </section>
            <section className="ai-panel">
              <div className="panel-title">
                <CheckCircle2 size={17} />
                <h2>Action Items</h2>
              </div>
              <ul>
                {(form.actionItems || []).map((item) => (
                  <li key={item}>{item}</li>
                ))}
                {!form.actionItems?.length && <li>No action items yet.</li>}
              </ul>
            </section>
            <section className="ai-panel">
              <div className="panel-title">
                <Wand2 size={17} />
                <h2>Suggested Title</h2>
              </div>
              <p>{form.suggestedTitle || "Let AI suggest a title."}</p>
            </section>
            <button type="button" className="summary-button" onClick={runAi} disabled={aiLoading}>
              <Sparkles size={17} />
              {aiLoading ? "Generating" : "Generate AI"}
            </button>
          </div>
        </form>

        <aside className="insights">
          <div className="insight-header">
            <BarChart3 size={20} />
            <h2>Dashboard</h2>
          </div>
          <div className="stats-grid">
            <Stat label="Total notes" value={insights?.totalNotes ?? 0} />
            <Stat label="Archived" value={insights?.archivedNotes ?? 0} />
            <Stat label="AI runs" value={insights?.aiUsage ?? 0} />
            <Stat label="Public" value={insights?.publicNotes ?? 0} />
          </div>
          <div className="insight-block">
            <h3>Recently edited</h3>
            {(insights?.recentNotes || []).map((note) => (
              <button className="mini-row" type="button" key={note.id} onClick={() => updateFilter("search", note.title)}>
                <span>{note.title}</span>
                <small>{new Date(note.updatedAt).toLocaleDateString()}</small>
              </button>
            ))}
          </div>
          <div className="insight-block">
            <h3>Most-used tags</h3>
            {(insights?.topTags || []).map((item) => (
              <div className="bar-row" key={item.name}>
                <span>
                  <Tag size={14} />
                  {item.name}
                </span>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
          <div className="insight-block">
            <h3>Weekly activity</h3>
            <div className="activity-bars">
              {(insights?.weeklyActivity || []).map((day) => (
                <span key={day.date} style={{ height: `${Math.max(12, day.count * 22)}px` }} title={day.date}>
                  {day.count}
                </span>
              ))}
            </div>
          </div>
          {selectedNote?.isPublic && (
            <a className="public-preview" href={`/shared/${selectedNote.shareId}`} target="_blank">
              <Eye size={17} />
              View public note
            </a>
          )}
        </aside>
      </section>
    </main>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const sharedMatch = window.location.pathname.match(/^\/shared\/([^/]+)/);

  useEffect(() => {
    if (sharedMatch) return;
    api
      .get("/api/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setCheckingSession(false));
  }, []);

  if (sharedMatch) return <SharedPage shareId={sharedMatch[1]} />;
  if (checkingSession) return <main className="loading-page">Loading workspace...</main>;
  if (!user) return <AuthScreen onAuthed={setUser} />;
  return <Workspace user={user} onLogout={() => setUser(null)} />;
}

createRoot(document.getElementById("root")).render(<App />);
