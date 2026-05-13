import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, 'data', 'agapes.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    key TEXT NOT NULL DEFAULT '',
    base_url TEXT NOT NULL DEFAULT '',
    model_name TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, provider),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS published_apps (
    slug TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    published_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'backlog',
    category TEXT NOT NULL DEFAULT 'functional',
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
`);

// Migrate existing api_keys rows if columns don't exist yet
for (const col of ['base_url TEXT NOT NULL DEFAULT ""', 'model_name TEXT NOT NULL DEFAULT ""']) {
  try { db.exec(`ALTER TABLE api_keys ADD COLUMN ${col}`); } catch { /* already exists */ }
}

// ── Users ─────────────────────────────────────────────────────

export function getUserCount() {
  return db.prepare('SELECT COUNT(*) as n FROM users').get().n;
}

export function createUser({ id, username, passwordHash, isAdmin }) {
  db.prepare(
    'INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, username, passwordHash, isAdmin ? 1 : 0, new Date().toISOString());
}

export function findUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function getAllUsers() {
  return db.prepare('SELECT id, username, is_admin, created_at FROM users ORDER BY created_at ASC').all();
}

export function deleteUser(id) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function toggleAdmin(id) {
  db.prepare('UPDATE users SET is_admin = 1 - is_admin WHERE id = ?').run(id);
}

// ── API Keys ──────────────────────────────────────────────────

export function getUserApiKeys(userId) {
  const rows = db.prepare('SELECT provider, key, base_url, model_name FROM api_keys WHERE user_id = ?').all(userId);
  return Object.fromEntries(rows.map((r) => [r.provider, {
    key:     r.key      ?? '',
    baseUrl: r.base_url ?? '',
    model:   r.model_name ?? '',
  }]));
}

export function setUserApiKey(userId, provider, key = '', baseUrl = '', modelName = '') {
  db.prepare(`
    INSERT INTO api_keys (user_id, provider, key, base_url, model_name)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, provider) DO UPDATE SET
      key        = excluded.key,
      base_url   = excluded.base_url,
      model_name = excluded.model_name
  `).run(userId, provider, key, baseUrl, modelName);
}

// ── Published Apps ────────────────────────────────────────────

export function getPublishedApp(slug) {
  return db.prepare('SELECT * FROM published_apps WHERE slug = ?').get(slug);
}

export function getPublishedAppByProject(projectId, userId) {
  return db.prepare('SELECT * FROM published_apps WHERE project_id = ? AND user_id = ?').get(projectId, userId);
}

export function publishProject({ slug, projectId, userId }) {
  db.prepare(
    'INSERT INTO published_apps (slug, project_id, user_id, published_at) VALUES (?, ?, ?, ?)'
  ).run(slug, projectId, userId, new Date().toISOString());
}

export function unpublishProject(projectId, userId) {
  db.prepare('DELETE FROM published_apps WHERE project_id = ? AND user_id = ?').run(projectId, userId);
}

export function slugExists(slug) {
  return !!db.prepare('SELECT 1 FROM published_apps WHERE slug = ?').get(slug);
}

export function getAllPublishedApps() {
  return db.prepare(`
    SELECT pa.slug, pa.project_id, pa.user_id, pa.published_at,
           u.username
    FROM published_apps pa
    LEFT JOIN users u ON u.id = pa.user_id
    ORDER BY pa.published_at DESC
  `).all();
}

export function deletePublishedBySlug(slug) {
  db.prepare('DELETE FROM published_apps WHERE slug = ?').run(slug);
}

// ── Project Features (Kanban) ─────────────────────────────────

export function listFeatures(projectId) {
  return db.prepare(
    'SELECT * FROM project_features WHERE project_id = ? ORDER BY priority ASC, id ASC'
  ).all(projectId);
}

export function createFeature({ projectId, title, description = null, category = 'functional' }) {
  const maxRow = db.prepare('SELECT MAX(priority) as m FROM project_features WHERE project_id = ?').get(projectId);
  const priority = (maxRow?.m ?? -1) + 1;
  return db.prepare(
    'INSERT INTO project_features (project_id, title, description, category, priority) VALUES (?, ?, ?, ?, ?) RETURNING *'
  ).get(projectId, title, description, category, priority);
}

export function updateFeature(id, { title, description, status, category, priority }) {
  const fields = [];
  const vals   = [];
  if (title       !== undefined) { fields.push('title = ?');       vals.push(title); }
  if (description !== undefined) { fields.push('description = ?'); vals.push(description); }
  if (status      !== undefined) { fields.push('status = ?');      vals.push(status); }
  if (category    !== undefined) { fields.push('category = ?');    vals.push(category); }
  if (priority    !== undefined) { fields.push('priority = ?');    vals.push(priority); }
  if (fields.length === 0) return db.prepare('SELECT * FROM project_features WHERE id = ?').get(id);
  fields.push("updated_at = (CURRENT_TIMESTAMP)");
  vals.push(id);
  return db.prepare(
    `UPDATE project_features SET ${fields.join(', ')} WHERE id = ? RETURNING *`
  ).get(...vals);
}

export function deleteFeature(id) {
  db.prepare('DELETE FROM project_features WHERE id = ?').run(id);
}
