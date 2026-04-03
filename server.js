const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Password ───────────────────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'pharmachemistry';

// ── JSON "database" ────────────────────────────────────────────────────────
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  || path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'notes.json');

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { notes: [] }; }
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── In-memory token store (expire after 24 h) ─────────────────────────────
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
  const { notes } = readDB();
  const sorted = [...notes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ success: true, data: sorted });
});

// ── POST /api/notes ────────────────────────────────────────────────────────
app.post('/api/notes', requireAdmin, (req, res) => {
  const { title, subject_name, subject_code, category, link } = req.body || {};
  if (!title || !subject_name || !category || !link) {
    return res.status(400).json({ success: false, message: 'Missing required fields.' });
  }
  const db   = readDB();
  const note = {
    id: crypto.randomUUID(),
    title, subject_name,
    subject_code: subject_code || '',
    category, link,
    created_at: new Date().toISOString(),
  };
  db.notes.push(note);
  writeDB(db);
  res.json({ success: true, id: note.id });
});

// ── DELETE /api/notes/:id ──────────────────────────────────────────────────
app.delete('/api/notes/:id', requireAdmin, (req, res) => {
  const db  = readDB();
  const len = db.notes.length;
  db.notes  = db.notes.filter(n => n.id !== req.params.id);
  if (db.notes.length === len) {
    return res.status(404).json({ success: false, message: 'Note not found.' });
  }
  writeDB(db);
  res.json({ success: true });
});

// ── GET /api/subjects ──────────────────────────────────────────────────────
app.get('/api/subjects', (_req, res) => {
  const { notes } = readDB();
  const seen = new Map();
  notes.forEach(n => { if (!seen.has(n.subject_name)) seen.set(n.subject_name, n.subject_code || ''); });
  const data = [...seen.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([subject_name, subject_code]) => ({ subject_name, subject_code }));
  res.json({ success: true, data });
});

// ── GET /api/categories ────────────────────────────────────────────────────
app.get('/api/categories', (_req, res) => {
  const { notes } = readDB();
  const data = [...new Set(notes.map(n => n.category))].sort();
  res.json({ success: true, data });
});

// ── Admin page at /admin ───────────────────────────────────────────────────
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ── Catch-all → index ──────────────────────────────────────────────────────
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  PharmaChem portal running on port ${PORT}`);
  console.log(`   Public  →  http://localhost:${PORT}/`);
  console.log(`   Admin   →  http://localhost:${PORT}/admin`);
});
