import express    from 'express';
import cors       from 'cors';
import { createProvider } from './providers/index.mjs';
import fs         from 'fs/promises';
import path       from 'path';
import { spawn }  from 'child_process';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { ExecutionManager } from './execution.mjs';
import { installPackages } from './mcp/packages.mjs';
import { webSearch }      from './mcp/search.mjs';
import { parsePlanJson }  from './providers/plan-utils.mjs';
import { createSnapshot, listSnapshots, restoreSnapshot } from './mcp/snapshot.mjs';
import { detectTestFramework, parseTestOutput, buildTestGenPrompt } from './mcp/tests.mjs';
import { stripHtml, checkRobotsDisallowed } from './mcp/clone.mjs';
import cookieParser from 'cookie-parser';
import jwt          from 'jsonwebtoken';
import bcrypt       from 'bcrypt';
import crypto       from 'crypto';
import {
  getUserCount, createUser, findUserByUsername, findUserById,
  getAllUsers, deleteUser, toggleAdmin,
  getUserApiKeys, setUserApiKey,
  getPublishedApp, getPublishedAppByProject,
  publishProject, unpublishProject, slugExists,
  getAllPublishedApps, deletePublishedBySlug,
} from './db.mjs';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.join(__dirname, '..', 'projects');
const app          = express();
const PORT         = 3001;
const JWT_SECRET   = process.env.JWT_SECRET ?? crypto.randomBytes(32).toString('hex');
const IS_WINDOWS   = process.platform === 'win32';

await fs.mkdir(PROJECTS_DIR, { recursive: true });

// ── Migrate legacy flat .json → folder per project ────────────
async function migrateLegacyProjects() {
  const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const jsonPath = path.join(PROJECTS_DIR, entry.name);
    try {
      const proj = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
      if (!proj.id) continue;

      // Skip if already migrated (folder already exists)
      const dir = path.join(PROJECTS_DIR, safeIdStatic(proj.id));
      const mp  = path.join(dir, '.forge', 'project.json');
      try { await fs.access(mp); continue; } catch { /* not yet migrated */ }

      const files = proj.files?.length
        ? proj.files
        : proj.code
        ? [{ path: 'index.html', lang: 'html', content: proj.code }]
        : [];

      // Write each file to disk
      await fs.mkdir(path.join(dir, '.forge'), { recursive: true });
      const filePaths = [];
      for (const file of files) {
        const absPath = path.resolve(dir, file.path.replace(/\\/g, '/'));
        if (!absPath.startsWith(dir + path.sep) && absPath !== dir) continue; // skip traversal
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, file.content, 'utf-8');
        filePaths.push({ path: file.path, lang: file.lang });
      }

      // Write metadata
      await fs.writeFile(mp, JSON.stringify({
        id:        proj.id,
        name:      proj.name || 'Untitled App',
        messages:  proj.messages || [],
        filePaths,
        createdAt: proj.createdAt || new Date().toISOString(),
        updatedAt: proj.updatedAt || new Date().toISOString(),
      }, null, 2), 'utf-8');

      // Remove old flat file
      await fs.unlink(jsonPath);
      console.log(`  ✓ Migrated: ${proj.name || proj.id}`);
    } catch (e) {
      console.warn(`  ✗ Could not migrate ${entry.name}:`, e.message);
    }
  }
}

function safeIdStatic(id) { return id.replace(/[^a-zA-Z0-9-]/g, ''); }

console.log('Migrating legacy projects…');
await migrateLegacyProjects();
console.log('Done.\n');

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:4173'], credentials: true }));
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());

// ── System prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Agapes, an expert AI developer. You build complete, working applications — web apps, scripts, APIs, data tools — exactly as requested.

## OUTPUT FORMAT (READ THIS FIRST)

Use <forge-file> tags for every file you output:

<forge-file path="relative/path/to/file.ext" lang="language">
complete file content here — never truncate
</forge-file>

**Building new:** One short sentence describing what you built, then all files. After the last file, add a "▶ How to Run" section (plain text, outside any tag) with the exact command(s) needed — or "Open index.html in the preview" for pure HTML projects. For single-file scripts, also note "you can click the ▶ Run button in the toolbar."
**Modifying/fixing:** 1-2 plain-English sentences explaining what changed, then ONLY the changed files. Unchanged files must be completely omitted.

CRITICAL RULES:
- NEVER put code in your explanation text — all code lives inside <forge-file> tags only.
- NEVER truncate file content with "..." or "rest of code here" — output every line in full.
- NEVER output the same file twice — list each file exactly once.
- Output files are immediately written to the user's project on disk.

---

## PROJECT TYPES

### Web apps (todo, dashboard, timer, game, landing page, calculator, etc.)
→ Single self-contained **index.html** using React 18 + Babel + Tailwind via CDN.
→ This is the DEFAULT for any interactive web app — it works instantly in the preview pane with zero setup.

<forge-file path="index.html" lang="html">
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <title>My App</title>
</head>
<body class="bg-gray-950 text-white min-h-screen">
  <div id="root"></div>
  <script type="text/babel">
    const { useState, useEffect, useRef, useCallback } = React;

    function App() {
      // complete implementation — no placeholders
      return (
        <div className="container mx-auto p-6">
          {/* real UI here */}
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>
</forge-file>

### TypeScript / Vite projects (larger multi-component apps)
→ Files: package.json, vite.config.ts, tsconfig.json, index.html, src/main.tsx, src/App.tsx, src/components/*.tsx, src/index.css, README.md
→ Use TypeScript strict mode. All component props must be typed.

### Node.js / Express API
→ Files: app.js (or server.js), package.json, README.md
→ Use CommonJS (require). Include error handling middleware and input validation.

### Python / scripts / automation / GUI
→ Files: main.py, requirements.txt, README.md
→ ALWAYS include requirements.txt listing EVERY third-party package (even one).
→ Add "# How to Run" comment at top of main.py.
→ For Windows .exe: include build.bat running "pip install pyinstaller && pyinstaller --onefile --noconsole main.py"

### Mobile PWA (Ionic)
→ Single index.html with Ionic Web Components from CDN.
→ Mobile-first: bottom tab bar, card layout, touch-friendly targets (min 44px), safe area insets.
→ CDN: https://cdn.jsdelivr.net/npm/@ionic/core/dist/ionic/ionic.esm.js

### React Native / Expo
→ ONLY when the user explicitly says "React Native" or "Expo".
→ Files: App.tsx, app.json, package.json, babel.config.js, tsconfig.json, src/screens/*.tsx, README.md
→ Include README.md with: npm install → npx expo start → scan QR with Expo Go.

### SQL / data
→ .sql files with schema, indexes, sample data, and commented example queries.

### Windows batch scripts
→ .bat / .cmd files — selectable and runnable directly from the terminal panel.

---

## CODE QUALITY

**UI & Design (HTML/CSS):**
- Professional, polished appearance — never a wireframe or "draft" look.
- Smooth transitions, hover/focus effects, loading states, empty states, error states.
- Mobile-responsive. Use Google Fonts via CDN when appropriate.
- Dark-mode-first is preferred for tools and dashboards.

**Logic & Correctness:**
- Fully functional — every function body must contain real working logic, not comments describing what it should do.
- Use only real, documented library APIs. Never invent method or property names.
- Handle edge cases: empty lists, null values, network errors, invalid input.
- Never silently remove existing working code unless the user explicitly asked.

**ZERO PLACEHOLDERS — strictly forbidden patterns:**
- "// TODO", "// FIXME", "// add logic here", "// implement this", "// rest of code", "// ..."
- Empty function bodies: "function draw() {}" or "draw() { /* coming soon */ }"
- Partial implementations: "function update() { // game loop logic here }"
- Forward references to functions that are never defined anywhere in the output
- Any comment that describes code instead of replacing it with actual code

**COMPLETENESS CHECKLIST — every function called must be defined:**
- If update() is called → update() must be fully implemented with real logic
- If drawBoard() is called → drawBoard() must be fully implemented
- If handleInput() is called → handleInput() must be fully implemented
- Mentally trace every function call before outputting. If the definition is missing → write it now.
- For games: the game loop (requestAnimationFrame), collision detection, input handling, scoring, and game-over logic must ALL be present and working.

**Multi-file projects:**
- Every import path must exactly match an actual output file path.
- Every third-party package must be listed in package.json or requirements.txt.
- Every multi-file project must include README.md with exact install + run commands.

**JavaScript:**
- Plain .js files execute with Node.js — NEVER use JSX or browser globals (document, window, DOM APIs) in .js files.
- JSX only in: <script type="text/babel"> inside HTML files, or in .tsx/.jsx files in Vite projects.

---

## SELF-CHECK (do this before outputting)

1. Do all import/require paths point to files I'm actually outputting?
2. Are all third-party packages listed in package.json / requirements.txt?
3. Is every <forge-file> tag complete — no truncated content?
4. For edits: am I only including files that actually changed?
5. Search every line for: TODO, FIXME, placeholder, stub, "...", "rest of", "add logic", empty "{}" bodies. If found → replace with real code NOW.
6. List every function that is CALLED anywhere. Verify each one is DEFINED with a real body. Missing definitions = broken app.
7. For interactive apps (games, forms, dashboards): confirm the event loop / game loop / reactive updates are wired up end-to-end.

Fix any issues silently before outputting. Only output files that are fully complete and correct.`;

const PLAN_SYSTEM_PROMPT = `You are a project planner for FORGE. The user wants to build something.
Return ONLY valid JSON (no markdown, no explanation) in this exact shape:
{
  "summary":     "one sentence describing what will be built",
  "files":       ["file1.ext", "file2.ext"],
  "uses":        ["Technology 1", "Library 2"],
  "features":    ["feature 1", "feature 2", "feature 3"],
  "suggestions": ["Use Vue instead of React", "Add dark mode", "Use Python instead of JS", "Add user login"]
}
Keep "files", "uses", "features" to 4 items maximum. Be concise.
Always include 4-5 "suggestions" — a mix of:
- Improvements to make the app better (e.g. "Add dark mode", "Add user authentication", "Add data export", "Add keyboard shortcuts", "Add search & filter", "Add offline support", "Add animations")
- Alternative approaches (e.g. "Use Vue instead of React", "Use Python/Flask instead of Node.js", "Add TypeScript")
Make them specific to what the user asked for. These are shown as clickable chips on the plan card so the user can instantly refine or enhance the plan.

IMPORTANT: If the user's request is for a MOBILE APP and they have NOT specified whether they want a mobile PWA (runs in browser/preview pane) or a React Native app (Expo, deployable to App Store/Play Store), add TWO extra fields to the JSON:
{
  "clarifyingQuestion": "Do you want a Mobile PWA or a React Native app?",
  "clarifyOptions": ["Mobile PWA (runs in browser, instant preview)", "React Native / Expo (real mobile app, scan QR to preview on phone)"]
}
Only add clarifyingQuestion/clarifyOptions when the request is specifically for a mobile app AND the type is ambiguous. Do not add them for web apps, scripts, or when the user already specified PWA or React Native.`;

const SUGGESTIONS_PROMPT = (summary, userPrompt) =>
  `The user asked to build: "${userPrompt}"\nThe plan summary is: "${summary}"\n\nGenerate 5 specific, actionable suggestions to improve or expand this app. Make them relevant to what the user actually asked for — features to add, alternatives to consider, quality improvements.\nReturn ONLY a valid JSON array of short strings (5–8 words each), no other text:\n["suggestion 1", "suggestion 2", "suggestion 3", "suggestion 4", "suggestion 5"]`;

// ── Plan ──────────────────────────────────────────────────────
app.post('/api/plan', async (req, res) => {
  const { messages, llmConfig } = req.body;
  try {
    const provider  = createProvider(llmConfig);
    const text      = await provider.generate(messages, PLAN_SYSTEM_PROMPT);
    const plan      = parsePlanJson(text);
    if (!plan) return res.status(500).json({ error: 'Could not parse plan', raw: text });

    // If the model skipped suggestions, ask for them in a focused second call
    if (!plan.suggestions || plan.suggestions.length === 0) {
      try {
        const userPrompt = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
        const suggText   = await provider.generate(
          [{ role: 'user', content: SUGGESTIONS_PROMPT(plan.summary, userPrompt.slice(0, 300)) }],
          '',
        );
        const arrMatch = suggText.match(/\[[\s\S]*?\]/);
        if (arrMatch) {
          const arr = JSON.parse(arrMatch[0]);
          if (Array.isArray(arr)) plan.suggestions = arr.map(String).slice(0, 5);
        }
      } catch { /* suggestions stay empty — client will show nothing */ }
    }

    res.json({ plan });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Generate ──────────────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const { messages, llmConfig, imageData } = req.body;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  try {
    // Inject web search context into system prompt
    let systemPrompt = SYSTEM_PROMPT;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      try {
        const results = await webSearch({ query: lastUser.content.slice(0, 150), maxResults: 3 });
        if (results.length > 0) {
          const ctx = results.map((r) => `• ${r.title}: ${r.snippet}`).join('\n');
          systemPrompt = `${SYSTEM_PROMPT}\n\n## Web Context (current documentation)\n${ctx}`;
        }
      } catch { /* search unavailable — proceed without */ }
    }

    const processedMessages = imageData
      ? messages.map((m, i) =>
          i === messages.length - 1 && m.role === 'user'
            ? { ...m, imageData }
            : m
        )
      : messages;

    const provider = createProvider(llmConfig);
    await provider.stream(res, processedMessages, systemPrompt);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: String(err.message || err) })}\n\n`);
    res.end();
  }
});

// ── Search ────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const q   = req.query.q;
  const max = parseInt(req.query.max ?? '5', 10);
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    const results = await webSearch({ query: q, maxResults: max });
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── URL Clone ─────────────────────────────────────────────────
app.post('/api/clone', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  let parsed;
  try { parsed = new URL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Check robots.txt
  try {
    const robotsRes = await fetch(`${parsed.origin}/robots.txt`, {
      headers: { 'User-Agent': 'FORGE/1.0 (educational web recreation tool)' },
      signal: AbortSignal.timeout(5000),
    });
    if (robotsRes.ok) {
      const txt = await robotsRes.text();
      if (checkRobotsDisallowed(txt)) {
        return res.status(403).json({ error: "This site doesn't allow automated access." });
      }
    }
  } catch { /* robots.txt unavailable — proceed */ }

  // Fetch the page
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 10000);
  try {
    const pageRes = await fetch(url, {
      headers: { 'User-Agent': 'FORGE/1.0 (educational web recreation tool)' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!pageRes.ok) {
      return res.status(502).json({ error: `Page not found (HTTP ${pageRes.status})` });
    }

    const html       = await pageRes.text();
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title      = titleMatch?.[1]?.trim() ?? '';
    const stripped   = stripHtml(html);
    const content    = (title ? `Page title: ${title}\n\n` : '') + stripped;
    const truncated  = content.slice(0, 12000);

    if (!truncated.trim()) {
      return res.status(422).json({ error: 'No readable content found — try a different URL.' });
    }
    res.json({ content: truncated, title });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return res.status(504).json({
        error: `Could not reach ${url} — the site took too long to respond.`,
      });
    }
    res.status(502).json({ error: String(err.message || err) });
  }
});

// ── Auth middleware ───────────────────────────────────────────

function authenticate(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user    = findUserById(payload.id);
    if (user) req.user = { id: user.id, username: user.username, isAdmin: !!user.is_admin };
  } catch { /* invalid/expired token — proceed unauthenticated */ }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin only' });
  next();
}

function signToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '7d' });
}

function setTokenCookie(res, token) {
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge:   7 * 24 * 60 * 60 * 1000,
  });
}

// ── Auth routes ───────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username?.trim() || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }
  if (username.trim().length < 2 || username.trim().length > 32) {
    return res.status(400).json({ error: 'Username must be 2–32 characters' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (findUserByUsername(username.trim())) {
    return res.status(409).json({ error: 'Username already taken' });
  }
  const isFirstUser = getUserCount() === 0;
  const id          = crypto.randomUUID();
  const hash        = await bcrypt.hash(password, 12);
  createUser({ id, username: username.trim(), passwordHash: hash, isAdmin: isFirstUser });
  const token            = signToken(id);
  setTokenCookie(res, token);
  const providerSettings = getUserApiKeys(id);
  res.json({ user: { id, username: username.trim(), isAdmin: isFirstUser }, providerSettings });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }
  const row = findUserByUsername(username.trim());
  if (!row) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token            = signToken(row.id);
  setTokenCookie(res, token);
  const providerSettings = getUserApiKeys(row.id);
  res.json({
    user: { id: row.id, username: row.username, isAdmin: !!row.is_admin },
    providerSettings,
  });
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/auth/me', authenticate, requireAuth, (req, res) => {
  const providerSettings = getUserApiKeys(req.user.id);
  res.json({ user: req.user, providerSettings });
});

app.put('/api/auth/apikeys', authenticate, requireAuth, (req, res) => {
  const { provider, key = '', baseUrl = '', model = '' } = req.body ?? {};
  if (!provider) return res.status(400).json({ error: 'provider required' });
  setUserApiKey(req.user.id, provider, key, baseUrl, model);
  res.json({ ok: true });
});

// ── Admin routes ──────────────────────────────────────────────

app.get('/api/admin/users', authenticate, requireAuth, requireAdmin, (_req, res) => {
  res.json({ users: getAllUsers() });
});

app.patch('/api/admin/users/:id', authenticate, requireAuth, requireAdmin, (req, res) => {
  const id = req.params.id;
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot change your own admin status' });
  toggleAdmin(id);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', authenticate, requireAuth, requireAdmin, (req, res) => {
  const id = req.params.id;
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  deleteUser(id);
  res.json({ ok: true });
});

app.get('/api/admin/users/:id/api-keys', authenticate, requireAuth, requireAdmin, (req, res) => {
  const settings = getUserApiKeys(req.params.id);
  // Return simple { provider: key } map for the admin panel display
  const apiKeys = Object.fromEntries(Object.entries(settings).map(([p, v]) => [p, v.key]));
  res.json({ apiKeys });
});

app.get('/api/admin/stats', authenticate, requireAuth, requireAdmin, async (_req, res) => {
  let projectCount = 0;
  try {
    const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
    projectCount = entries.filter((e) => e.isDirectory()).length;
  } catch { /* ignore */ }
  res.json({
    port:           PORT,
    nodeVersion:    process.version,
    platform:       process.platform,
    uptime:         Math.floor(process.uptime()),
    userCount:      getUserCount(),
    projectCount,
    publishedCount: getAllPublishedApps().length,
  });
});

app.get('/api/admin/published-apps', authenticate, requireAuth, requireAdmin, (_req, res) => {
  res.json({ apps: getAllPublishedApps() });
});

app.delete('/api/admin/published-apps/:slug', authenticate, requireAuth, requireAdmin, (req, res) => {
  deletePublishedBySlug(req.params.slug);
  res.json({ ok: true });
});

// ── Project CRUD (folder-per-project) ────────────────────────

function safeId(id) { return safeIdStatic(id); }

/** Resolve a file's path inside the project folder, preventing path traversal. */
function safeFilePath(projectDir, filePath) {
  const resolved = path.resolve(projectDir, filePath.replace(/\\/g, '/'));
  if (!resolved.startsWith(projectDir + path.sep) && resolved !== projectDir) {
    throw new Error(`Path traversal attempt: ${filePath}`);
  }
  return resolved;
}

function projectDir(id)  { return path.join(PROJECTS_DIR, safeId(id)); }
function metaPath(id)    { return path.join(projectDir(id), '.forge', 'project.json'); }

// ── List all projects ─────────────────────────────────────────
app.get('/api/projects', authenticate, async (req, res) => {
  const userId  = req.user?.id ?? null;
  const isAdmin = req.user?.isAdmin ?? false;
  try {
    const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
    const list = await Promise.all(entries.map(async (entry) => {
      try {
        // New folder-based project
        if (entry.isDirectory()) {
          const mp = path.join(PROJECTS_DIR, entry.name, '.forge', 'project.json');
          const meta = JSON.parse(await fs.readFile(mp, 'utf-8'));
          // Filter: only show own projects (or all if admin); legacy projects (no user_id) visible to admins
          if (meta.user_id && meta.user_id !== userId && !isAdmin) return null;
          if (!meta.user_id && !isAdmin) return null;
          return {
            id:         meta.id,
            name:       meta.name || 'Untitled App',
            hasFiles:   (meta.filePaths?.length ?? 0) > 0,
            updatedAt:  meta.updatedAt,
            folderPath: path.join(PROJECTS_DIR, entry.name),
          };
        }
        // Legacy flat .json file
        if (entry.isFile() && entry.name.endsWith('.json')) {
          if (!isAdmin) return null; // legacy projects are admin-only
          const p = JSON.parse(await fs.readFile(path.join(PROJECTS_DIR, entry.name), 'utf-8'));
          return {
            id:        p.id,
            name:      p.name || 'Untitled App',
            hasFiles:  !!(p.files?.length || p.code),
            updatedAt: p.updatedAt,
          };
        }
      } catch { /* skip corrupt entries */ }
      return null;
    }));
    res.json(
      list.filter(Boolean).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
    );
  } catch { res.json([]); }
});

// ── Get one project ───────────────────────────────────────────
app.get('/api/projects/:id', authenticate, async (req, res) => {
  const id  = safeId(req.params.id);
  const mp  = metaPath(id);

  try {
    // Try new folder-based format first
    const meta = JSON.parse(await fs.readFile(mp, 'utf-8'));

    // Ownership check
    if (meta.user_id && meta.user_id !== req.user?.id && !req.user?.isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!meta.user_id && !req.user?.isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const filePaths = meta.filePaths ?? [];

    const files = await Promise.all(filePaths.map(async ({ path: fp, lang }) => {
      const absPath = safeFilePath(projectDir(id), fp);
      const content = await fs.readFile(absPath, 'utf-8').catch(() => '');
      return { path: fp, lang, content };
    }));

    res.json({
      id:         meta.id,
      name:       meta.name,
      messages:   meta.messages ?? [],
      files,
      createdAt:  meta.createdAt,
      updatedAt:  meta.updatedAt,
      folderPath: projectDir(id),
    });
    return;
  } catch { /* fall through to legacy */ }

  // Legacy flat .json (admin-only)
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Forbidden' });
  try {
    const legacyPath = path.join(PROJECTS_DIR, `${id}.json`);
    const proj = JSON.parse(await fs.readFile(legacyPath, 'utf-8'));
    if (!proj.files?.length && proj.code) {
      proj.files = [{ path: 'index.html', lang: 'html', content: proj.code }];
    }
    res.json(proj);
  } catch { res.status(404).json({ error: 'Not found' }); }
});

// ── Save / update project ─────────────────────────────────────
app.put('/api/projects/:id', authenticate, async (req, res) => {
  const id  = safeId(req.params.id);
  const dir = projectDir(id);
  const mp  = metaPath(id);

  // Load existing metadata if present
  let existing = {};
  try { existing = JSON.parse(await fs.readFile(mp, 'utf-8')); } catch { /* new project */ }

  // Ownership check for existing projects
  if (existing.user_id && existing.user_id !== req.user?.id && !req.user?.isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const now      = new Date().toISOString();
  const files    = req.body.files    ?? existing._files   ?? [];
  const messages = req.body.messages ?? existing.messages ?? [];
  const name     = req.body.name     ?? existing.name     ?? 'Untitled App';

  // Write each file to its real path on disk
  await fs.mkdir(path.join(dir, '.forge'), { recursive: true });

  const filePaths = [];
  for (const file of files) {
    const absPath = safeFilePath(dir, file.path);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, file.content, 'utf-8');
    filePaths.push({ path: file.path, lang: file.lang });
  }

  // Save metadata (no file contents); stamp user_id on creation
  const meta = {
    id,
    name,
    messages,
    filePaths,
    user_id:   existing.user_id ?? req.user?.id ?? null,
    createdAt: existing.createdAt ?? now,
    updatedAt: now,
  };
  await fs.writeFile(mp, JSON.stringify(meta, null, 2), 'utf-8');

  res.json({ ok: true, folderPath: dir });
});

// ── Delete project ────────────────────────────────────────────
app.delete('/api/projects/:id', authenticate, async (req, res) => {
  const id = safeId(req.params.id);

  // Try new folder format
  try {
    const dir = projectDir(id);
    const mp  = path.join(dir, '.forge', 'project.json');
    await fs.access(mp);
    const meta = JSON.parse(await fs.readFile(mp, 'utf-8'));
    if (meta.user_id && meta.user_id !== req.user?.id && !req.user?.isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await fs.rm(dir, { recursive: true, force: true });
    return res.json({ ok: true });
  } catch (err) {
    if (err.message === 'Forbidden') return; // already sent
    /* not a folder project */
  }

  // Try legacy flat .json (admin-only)
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Forbidden' });
  try {
    await fs.unlink(path.join(PROJECTS_DIR, `${id}.json`));
    return res.json({ ok: true });
  } catch { return res.status(404).json({ error: 'Not found' }); }
});

// ── Open project folder in OS file manager ────────────────────
app.post('/api/projects/:id/open-folder', authenticate, async (req, res) => {
  const id  = safeId(req.params.id);
  const dir = projectDir(id);

  try {
    await fs.access(dir);
  } catch {
    return res.status(404).json({ error: 'Project folder not found' });
  }

  const platform = process.platform;
  let   cmd, args;
  if (platform === 'win32')  { cmd = 'explorer'; args = [dir]; }
  else if (platform === 'darwin') { cmd = 'open'; args = [dir]; }
  else { cmd = 'xdg-open'; args = [dir]; }

  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  res.json({ ok: true, folderPath: dir });
});

app.post('/api/install-packages', authenticate, async (req, res) => {
  const { manager, packages, projectId } = req.body;
  if (!manager || !packages?.length || !projectId) {
    return res.status(400).json({ error: 'manager, packages, and projectId required' });
  }

  const cwd = projectDir(safeId(projectId));
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const { success } = await installPackages({
    manager, packages, cwd,
    onData: (chunk) => res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`),
  });

  res.write(`data: ${JSON.stringify({ done: true, success })}\n\n`);
  res.end();
});

// ── Auto-Tester ───────────────────────────────────────────────
app.post('/api/projects/:id/test', authenticate, async (req, res) => {
  const { llmConfig, files } = req.body;
  if (!files?.length) return res.status(400).json({ error: 'files required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const framework = detectTestFramework(files);
    if (!framework) {
      send({ error: 'Unknown test framework' });
      return res.end();
    }

    send({ status: 'generating', framework });

    const prompt   = buildTestGenPrompt(files, framework);
    const provider = createProvider(llmConfig);
    const testCode = await provider.generate(
      [{ role: 'user', content: prompt }],
      'You are a test engineer. Output only the test file content.',
    );

    // Determine test file name and runner command
    const ext   = framework === 'pytest' ? 'py' : framework === 'vitest' ? 'ts' : 'test.js';
    const fname = `forge_auto_test.${ext}`;
    const id    = safeId(req.params.id);
    const dir   = projectDir(id);
    const fpath = path.join(dir, fname);

    await fs.writeFile(fpath, testCode, 'utf-8');
    send({ status: 'running', file: fname });

    // Run the test
    const cmdMap = {
      jest:   ['npx', ['jest', '--no-coverage', fname]],
      vitest: ['npx', ['vitest', 'run', fname]],
      pytest: ['python', ['-m', 'pytest', fname, '-v']],
    };
    const [cmd, args] = cmdMap[framework];

    let output = '';
    await new Promise((resolve) => {
      const proc = spawn(cmd, args, { cwd: dir, shell: true });
      proc.stdout.on('data', (d) => { output += d; send({ chunk: d.toString() }); });
      proc.stderr.on('data', (d) => { output += d; send({ chunk: d.toString() }); });
      proc.on('close', resolve);
    });

    const counts = parseTestOutput(output, framework);
    send({ status: 'done', ...counts });
  } catch (err) {
    send({ error: String(err.message || err) });
  }
  res.end();
});

// ── Playwright E2E ────────────────────────────────────────────
app.post('/api/projects/:id/playwright-test', authenticate, async (req, res) => {
  const { llmConfig, files } = req.body;
  if (!files?.length) return res.status(400).json({ error: 'files required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    send({ status: 'generating', framework: 'playwright' });

    const prompt   = buildTestGenPrompt(files, 'playwright');
    const provider = createProvider(llmConfig);
    const testCode = await provider.generate(
      [{ role: 'user', content: prompt }],
      'You are a test engineer. Output only the Playwright test file content.',
    );

    const id    = safeId(req.params.id);
    const dir   = projectDir(id);
    const fpath = path.join(dir, 'forge_playwright.spec.js');
    await fs.writeFile(fpath, testCode, 'utf-8');
    send({ status: 'running', file: 'forge_playwright.spec.js' });

    let output = '';
    await new Promise((resolve) => {
      const proc = spawn(
        'npx',
        ['playwright', 'test', 'forge_playwright.spec.js', '--reporter=line'],
        { cwd: dir, shell: true },
      );
      proc.stdout.on('data', (d) => { output += d; send({ chunk: d.toString() }); });
      proc.stderr.on('data', (d) => { output += d; send({ chunk: d.toString() }); });
      proc.on('close', resolve);
    });

    const counts = parseTestOutput(output, 'playwright');
    send({ status: 'done', ...counts });
  } catch (err) {
    const msg  = String(err.message || err);
    const hint = msg.includes('not found') || msg.includes('ENOENT')
      ? 'Playwright not found. Run: npx playwright install chromium'
      : msg;
    send({ error: hint });
  }
  res.end();
});

// ── Snapshots ─────────────────────────────────────────────────
app.get('/api/projects/:id/snapshots', authenticate, async (req, res) => {
  const dir = projectDir(safeId(req.params.id));
  try {
    const snaps = await listSnapshots(dir);
    res.json({ snapshots: snaps });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/projects/:id/snapshots', authenticate, async (req, res) => {
  const dir   = projectDir(safeId(req.params.id));
  const label = req.body.label ?? 'snapshot';
  try {
    const snap = await createSnapshot(dir, label);
    res.json({ snapshot: snap });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/projects/:id/snapshots/:snapId/restore', authenticate, async (req, res) => {
  const dir    = projectDir(safeId(req.params.id));
  const snapId = req.params.snapId;
  try {
    await restoreSnapshot(dir, snapId);
    res.json({ ok: true });
  } catch (err) {
    const status = err.message?.toLowerCase().includes('invalid') ? 400 : 500;
    res.status(status).json({ error: String(err.message || err) });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ── Dev preview — serve project files so multi-file HTML works ─
// Relative imports (CSS, JS, ES modules, images) resolve naturally
// because the iframe uses a real URL, not about:srcdoc.
const PREVIEW_CONSOLE_INTERCEPTOR = `<script>
(function() {
  const _send = (level, args) => {
    const formatted = args.map(a => {
      try { return typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a); }
      catch { return String(a); }
    }).join(' ');
    window.parent.postMessage({ type: 'console', level, text: formatted }, '*');
  };
  ['log','warn','error','info','debug'].forEach(l => {
    const orig = console[l].bind(console);
    console[l] = (...args) => { orig(...args); _send(l, args); };
  });
  window.onerror = (msg, src, line, col, err) => {
    _send('error', [\`\${msg} (line \${line})\${err?.stack ? '\\n' + err.stack : ''}\`]);
  };
  window.addEventListener('unhandledrejection', e => {
    _send('error', ['Unhandled Promise rejection: ' + (e.reason?.message || e.reason)]);
  });
})();
<\/script>`;

app.get('/api/projects/:id/preview/*', authenticate, async (req, res) => {
  const id = safeId(req.params.id);
  const fp = req.params[0] || 'index.html';
  const dir = projectDir(id);

  // Ownership check
  try {
    const meta = JSON.parse(await fs.readFile(metaPath(id), 'utf-8'));
    if (meta.user_id && meta.user_id !== req.user?.id && !req.user?.isAdmin) {
      return res.status(403).send('Forbidden');
    }
  } catch {
    return res.status(404).send('Project not found');
  }

  let absPath;
  try {
    absPath = safeFilePath(dir, fp);
  } catch {
    return res.status(400).send('Invalid path');
  }

  // For HTML files, inject the console interceptor so terminal receives logs
  if (/\.html?$/i.test(fp)) {
    try {
      const html = await fs.readFile(absPath, 'utf-8');
      const injected = html.replace(/(<head[^>]*>)/i, `$1\n${PREVIEW_CONSOLE_INTERCEPTOR}`)
        || (PREVIEW_CONSOLE_INTERCEPTOR + html);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(injected);
    } catch {
      res.status(404).send('File not found');
    }
    return;
  }

  // All other files (JS, CSS, images, etc.) served as-is
  res.sendFile(absPath, (err) => {
    if (err && !res.headersSent) res.status(404).send('File not found');
  });
});

// ── Fetch available models from a provider ────────────────────
app.post('/api/provider-models', async (req, res) => {
  const { provider, baseUrl, apiKey } = req.body ?? {};
  try {
    if (provider === 'ollama') {
      const url  = (baseUrl || 'http://localhost:11434').replace(/\/$/, '');
      const r    = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(6000) });
      const data = await r.json();
      const models = (data.models ?? []).map((m) => m.name);
      return res.json({ models });
    }

    if (provider === 'anthropic') {
      // Anthropic doesn't expose a public model list — return curated list
      return res.json({ models: [
        'claude-opus-4-7', 'claude-opus-4-6',
        'claude-sonnet-4-6', 'claude-haiku-4-5-20251001',
        'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022',
        'claude-3-opus-20240229',
      ]});
    }

    if (provider === 'gemini') {
      return res.json({ models: [
        'gemini-2.0-flash', 'gemini-2.0-flash-lite',
        'gemini-1.5-pro', 'gemini-1.5-flash',
      ]});
    }

    if (provider === 'openrouter') {
      const r = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          'Authorization':  `Bearer ${apiKey}`,
          'HTTP-Referer':   'https://agapes.us',
          'X-Title':        'Agapes Ai Coder',
        },
        signal: AbortSignal.timeout(8000),
      }).catch((e) => { throw new Error(`Cannot reach OpenRouter: ${e.message}`); });
      if (!r.ok) return res.status(r.status).json({ error: `OpenRouter returned ${r.status}` });
      const data = await r.json();
      const models = (data.data ?? []).map((m) => m.id).filter(Boolean);
      return res.json({ models });
    }

    // OpenAI-compatible: lmstudio, openai, custom
    const base = (baseUrl || (provider === 'openai' ? 'https://api.openai.com' : 'http://localhost:1234/v1')).replace(/\/$/, '');
    const endpoint = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    let r;
    try {
      r = await fetch(endpoint, { headers, signal: AbortSignal.timeout(8000) });
    } catch (connErr) {
      const code = connErr?.cause?.code ?? connErr?.code;
      const msg  = code === 'ECONNREFUSED'
        ? `Cannot connect to ${base} — is the server running?`
        : String(connErr.message || connErr);
      return res.status(502).json({ error: msg });
    }

    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return res.status(r.status).json({ error: `Provider returned ${r.status}${body.slice(0, 120) ? ': ' + body.slice(0, 120) : ''}` });
    }

    const ct = r.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      const label = provider === 'lmstudio' ? 'LM Studio' : 'The provider';
      return res.status(502).json({ error: `${label} returned a non-JSON response. Make sure the server is running and a model is loaded, then try again.` });
    }

    const data = await r.json();
    const models = (data.data ?? []).map((m) => m.id ?? m.name).filter(Boolean);
    if (!models.length) {
      const label = provider === 'lmstudio' ? 'LM Studio' : 'Provider';
      return res.status(502).json({ error: `${label} returned no models. Load a model in the app first.` });
    }
    res.json({ models });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Chat (conversational, no code generation) ─────────────────
const CHAT_SYSTEM_PROMPT = `You are Agapes, a helpful AI assistant. Answer questions clearly and concisely. You can discuss code, explain concepts, help debug, suggest approaches, and have general conversations. Do NOT output forge-file tags or code files unless explicitly asked to build something.`;

app.post('/api/chat', async (req, res) => {
  const { messages, llmConfig } = req.body;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  try {
    const provider = createProvider(llmConfig);
    await provider.stream(res, messages, CHAT_SYSTEM_PROMPT);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: String(err.message || err) })}\n\n`);
    res.end();
  }
});

// ── Publish ───────────────────────────────────────────────────

app.get('/api/projects/:id/publish-status', authenticate, requireAuth, async (req, res) => {
  const id  = safeId(req.params.id);
  const row = getPublishedAppByProject(id, req.user.id);
  if (row) {
    res.json({ published: true, slug: row.slug, url: `/app/${row.slug}` });
  } else {
    res.json({ published: false });
  }
});

app.post('/api/projects/:id/publish', authenticate, requireAuth, async (req, res) => {
  const id  = safeId(req.params.id);
  const mp  = metaPath(id);

  // Verify ownership
  let meta;
  try {
    meta = JSON.parse(await fs.readFile(mp, 'utf-8'));
  } catch {
    return res.status(404).json({ error: 'Project not found' });
  }
  if (meta.user_id && meta.user_id !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Check if already published
  const existing = getPublishedAppByProject(id, req.user.id);
  if (existing) {
    return res.json({ slug: existing.slug, url: `/app/${existing.slug}` });
  }

  // Generate unique slug
  let slug;
  let attempts = 0;
  do {
    slug = crypto.randomBytes(4).toString('hex');
    attempts++;
  } while (slugExists(slug) && attempts < 10);

  publishProject({ slug, projectId: id, userId: req.user.id });
  res.json({ slug, url: `/app/${slug}` });
});

app.delete('/api/projects/:id/publish', authenticate, requireAuth, async (req, res) => {
  const id = safeId(req.params.id);
  unpublishProject(id, req.user.id);
  res.json({ ok: true });
});

// ── Serve published apps (public) ─────────────────────────────

app.get('/app/:slug', async (req, res) => {
  const row = getPublishedApp(req.params.slug);
  if (!row) return res.status(404).send('App not found');

  const dir = projectDir(row.project_id);
  const mp  = metaPath(row.project_id);
  try {
    const meta = JSON.parse(await fs.readFile(mp, 'utf-8'));
    const htmlEntry = (meta.filePaths ?? []).find(({ path: p }) => p.endsWith('.html'));
    if (!htmlEntry) return res.status(404).send('No HTML entry point found');
    const absPath = safeFilePath(dir, htmlEntry.path);
    res.sendFile(absPath);
  } catch {
    res.status(404).send('App not found');
  }
});

app.get('/app/:slug/*', async (req, res) => {
  const row = getPublishedApp(req.params.slug);
  if (!row) return res.status(404).send('Not found');

  const dir      = projectDir(row.project_id);
  const filePath = req.params[0] ?? '';
  try {
    const absPath = safeFilePath(dir, filePath);
    res.sendFile(absPath);
  } catch {
    res.status(400).send('Invalid path');
  }
});

// ── Auto-install missing dependencies ────────────────────────
// Maps common import names → correct pip package names
const PYTHON_PKG_ALIASES = {
  PIL: 'Pillow', cv2: 'opencv-python', sklearn: 'scikit-learn',
  bs4: 'beautifulsoup4', yaml: 'PyYAML', dotenv: 'python-dotenv',
  Crypto: 'pycryptodome', wx: 'wxPython', gi: 'PyGObject',
  pydub: 'pydub', pygame: 'pygame', flask: 'Flask', django: 'Django',
  tensorflow: 'tensorflow', torch: 'torch', requests: 'requests',
  numpy: 'numpy', pandas: 'pandas', matplotlib: 'matplotlib',
  scipy: 'scipy', seaborn: 'seaborn', nltk: 'nltk',
  sqlalchemy: 'SQLAlchemy', aiohttp: 'aiohttp', fastapi: 'fastapi',
  uvicorn: 'uvicorn', httpx: 'httpx', pydantic: 'pydantic',
};

function detectMissingDep(output, ext) {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, ''); // strip ANSI codes

  if (ext === '.py') {
    // Standard Python ImportError
    const m1 = clean.match(/No module named ['"]([^'"]+)['"]/);
    if (m1) {
      const raw = m1[1].split('.')[0];
      return { pkg: PYTHON_PKG_ALIASES[raw] ?? raw, manager: 'pip' };
    }

    // "X is not installed" — check BEFORE requirements.txt so we get the specific package name
    const m3 = clean.match(/([\w-]+) is not installed/i);
    if (m3) {
      const raw = m3[1];
      return { pkg: PYTHON_PKG_ALIASES[raw] ?? raw, manager: 'pip' };
    }

    // Custom "pip install X" hint printed by the code itself
    const m2 = clean.match(/pip install ([\w-]+)/);
    if (m2 && m2[1] !== '-r') {
      return { pkg: m2[1], manager: 'pip' };
    }

    // requirements.txt fallback — only useful when the file actually exists
    if (/pip install -r requirements\.txt/.test(clean)) {
      return { pkg: '-r requirements.txt', manager: 'pip' };
    }
  }

  if (['.js', '.mjs', '.cjs', '.ts'].includes(ext)) {
    // Standard Node.js missing module
    const m = clean.match(/Cannot find module '(@?[^'./][^']*)'/);
    if (m) return { pkg: m[1], manager: 'npm' };

    // npm install hint printed by code
    const m2 = clean.match(/npm install ([\w@/-]+)/);
    if (m2) return { pkg: m2[1], manager: 'npm' };
  }

  return null;
}

async function autoInstall({ pkg, manager }, cwd, onData) {
  // Guard: if requirements.txt was requested but file doesn't exist, bail out early
  if (pkg === '-r requirements.txt') {
    try { await fs.access(path.join(cwd, 'requirements.txt')); }
    catch {
      onData(`\r\n\x1b[31m[Auto-install] requirements.txt not found in project — cannot install deps from file.\x1b[0m\r\n`);
      return false;
    }
  }

  onData(`\r\n\x1b[33m━━ Auto-install: ${pkg} ━━\x1b[0m\r\n`);

  let cmd, args;
  if (manager === 'pip') {
    cmd = IS_WINDOWS ? 'python.exe' : 'python3';
    args = ['-m', 'pip', 'install', ...pkg.split(' ')];
  } else {
    const pkgJson = path.join(cwd, 'package.json');
    try { await fs.access(pkgJson); } catch {
      await fs.writeFile(pkgJson, JSON.stringify({ name: 'project', version: '1.0.0', private: true }, null, 2));
    }
    cmd = IS_WINDOWS ? 'npm.cmd' : 'npm';
    args = ['install', '--save', pkg];
  }

  return new Promise((resolve) => {
    let proc;
    try {
      // Use child_process.spawn (already imported) — no pty needed for package installs
      proc = spawn(cmd, args, {
        cwd,
        env: { ...process.env, FORCE_COLOR: '0', PIP_NO_COLOR: '1' },
        shell: false,
      });
    } catch {
      onData(`\r\n\x1b[31m[Auto-install] Could not run ${manager} — is it installed?\x1b[0m\r\n`);
      resolve(false);
      return;
    }

    const emit = (chunk) => onData(chunk.toString().replace(/\n/g, '\r\n'));
    proc.stdout?.on('data', emit);
    proc.stderr?.on('data', emit);

    proc.on('error', (err) => {
      onData(`\r\n\x1b[31m[Auto-install] ${err.message}\x1b[0m\r\n`);
      resolve(false);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        onData(`\r\n\x1b[32m✓ ${pkg} installed — retrying...\x1b[0m\r\n\r\n`);
      } else {
        onData(`\r\n\x1b[31m✗ Could not install ${pkg} (exit ${code ?? '?'}).\x1b[0m\r\n`);
      }
      resolve(code === 0);
    });
  });
}

// ── WebSocket terminal server ─────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n✨ Agapes Ai Coder → http://localhost:${PORT}`);
  console.log(`   Projects: ${PROJECTS_DIR}\n`);
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://localhost:${PORT}`);
  if (pathname === '/terminal') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  let mgr = null;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'start') {
      mgr?.destroy();
      mgr = new ExecutionManager();

      // Resolve the working directory: prefer msg.cwd, fall back to project folder
      let cwd = msg.cwd && msg.cwd.trim() ? msg.cwd : null;
      if (!cwd && msg.projectId) {
        cwd = projectDir(msg.projectId);
      }
      if (!cwd) cwd = PROJECTS_DIR; // last resort

      // Write all companion files so relative imports resolve
      if (msg.allFiles && msg.allFiles.length > 0) {
        await fs.mkdir(cwd, { recursive: true }).catch(() => {});
        for (const f of msg.allFiles) {
          try {
            const dest = path.join(cwd, f.path);
            // Prevent path traversal
            if (!dest.startsWith(cwd)) continue;
            await fs.mkdir(path.dirname(dest), { recursive: true });
            await fs.writeFile(dest, f.content, 'utf-8');
          } catch { /* skip unwritable files */ }
        }
      }

      const ext       = path.extname(msg.file).toLowerCase();
      const installed = new Set(); // prevent reinstalling the same package
      let   outputBuf = '';

      const send = (data) => {
        outputBuf += data;
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'output', data }));
      };

      let lastExit = await mgr.run({ content: msg.content, filePath: msg.file, cwd, onData: send });

      // Auto-install loop: detect missing dep → install → re-run (up to 5 deps)
      for (let i = 0; i < 5 && lastExit !== 0; i++) {
        const dep = detectMissingDep(outputBuf, ext);
        if (!dep || installed.has(dep.pkg)) break;
        installed.add(dep.pkg);

        const ok = await autoInstall(dep, cwd, send);
        if (!ok) break;

        outputBuf = '';
        mgr = new ExecutionManager();
        lastExit = await mgr.run({ content: msg.content, filePath: msg.file, cwd, onData: send });
      }

      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', code: lastExit }));
      }
      mgr = null;
    }

    if (msg.type === 'input')  mgr?.write(msg.data);
    if (msg.type === 'kill')   { mgr?.kill(); mgr = null; }
    if (msg.type === 'resize') mgr?.resize(msg.cols, msg.rows);
  });

  ws.on('close', () => {
    mgr?.destroy();
    mgr = null;
  });
});
