const express  = require('express');
const Database = require('better-sqlite3');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Password (set via Railway env var or fallback to default) ──────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'pharmachemistry';

// ── SQLite data directory ──────────────────────────────────────────────────
// Railway: attach a volume and set RAILWAY_VOLUME_MOUNT_PATH, or data lives
// in ./data (ephemeral — lost on redeploy if no volume).
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  || path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'notes.db'));

// ── Schema ─────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    subject_name TEXT NOT NULL,
    subject_code TEXT,
    category     TEXT NOT NULL,
    link         TEXT NOT NULL,
    created_at   TEXT NOT NULL
  );
`);

// ── In-memory token store (tokens expire after 24 h) ──────────────────────
const activeTokens = new Set();

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !activeTokens.has(token)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

// ── POST /api/auth ─────────────────────────────────────────────────────────
app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    const token = crypto.randomUUID();
    activeTokens.add(token);
    setTimeout(() => activeTokens.delete(token), 24 * 60 * 60 * 1000);
    return res.json({ success: true, token });
  }
  res.status(401).json({ success: false, message: 'Incorrect password.' });
});

// ── GET /api/notes ─────────────────────────────────────────────────────────
app.get('/api/notes', (_req, res) => {
  const notes = db.prepare('SELECT * FROM notes ORDER BY created_at DESC').all();
  res.json({ success: true, data: notes });
});

// ── POST /api/notes ────────────────────────────────────────────────────────
app.post('/api/notes', requireAdmin, (req, res) => {
  const { title, subject_name, subject_code, category, link } = req.body || {};
  if (!title || !subject_name || !category || !link) {
    return res.status(400).json({ success: false, message: 'Missing required fields.' });
  }
  const id         = crypto.randomUUID();
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO notes
       (id, title, subject_name, subject_code, category, link, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, title, subject_name, subject_code || '', category, link, created_at);
  res.json({ success: true, id });
});

// ── DELETE /api/notes/:id ──────────────────────────────────────────────────
app.delete('/api/notes/:id', requireAdmin, (req, res) => {
  const result = db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ success: false, message: 'Note not found.' });
  }
  res.json({ success: true });
});

// ── GET /api/subjects ──────────────────────────────────────────────────────
app.get('/api/subjects', (_req, res) => {
  const rows = db.prepare(
    `SELECT DISTINCT subject_name, subject_code
     FROM notes ORDER BY subject_name`
  ).all();
  res.json({ success: true, data: rows });
});

// ── GET /api/categories ────────────────────────────────────────────────────
app.get('/api/categories', (_req, res) => {
  const rows = db.prepare(
    `SELECT DISTINCT category FROM notes ORDER BY category`
  ).all();
  res.json({ success: true, data: rows.map(r => r.category) });
});

// ── Serve admin page at /admin ─────────────────────────────────────────────
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ── Catch-all → index ──────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  PharmaChem portal running on port ${PORT}`);
  console.log(`   Public  →  http://localhost:${PORT}/`);
  console.log(`   Admin   →  http://localhost:${PORT}/admin`);
});
