import express    from 'express';
import cors       from 'cors';
import Anthropic  from '@anthropic-ai/sdk';
import fs         from 'fs/promises';
import path       from 'path';
import { spawn }  from 'child_process';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { ExecutionManager } from './execution.mjs';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.join(__dirname, '..', 'projects');
const app          = express();
const PORT         = 3001;

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

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:4173'] }));
app.use(express.json({ limit: '8mb' }));

// ── System prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are FORGE, an expert AI developer. You build web apps, scripts, APIs, data pipelines — anything the user asks.

## RESPONSE FORMAT

Always respond like this:
1. One or two sentences describing what you are building.
2. All project files using <forge-file> tags:

<forge-file path="relative/path/to/file.ext" lang="language">
file content here
</forge-file>

Output EVERY file needed. Repeat the tag for each file.

---

## CHOOSING THE RIGHT OUTPUT

### Simple interactive web apps (todo, dashboard, timer, game, form, landing page, calculator…)
→ Single self-contained **index.html** that works in an iframe.
→ Use React 18 + Babel + Tailwind via CDN — no build step needed.

\`\`\`
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
<body>
  <div id="root"></div>
  <script type="text/babel">
    const App = () => { /* ... */ };
    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>
</forge-file>
\`\`\`

### Multi-component React / Vue / Svelte projects
→ Generate: src/App.tsx, src/components/*, src/index.css, package.json, README.md, etc.
→ Use TypeScript. Include Vite config.
→ Add a "How to run" section in README.md.

### Python / backend / scripts
→ Generate: main.py (or appropriate entry point), requirements.txt, README.md.
→ Include clear docstrings and inline comments.
→ Add a "How to run" comment block at the top of the main file.

### SQL / data
→ Generate .sql file(s) with schema, indexes, and example queries.
→ Add SQL comments explaining each section.

### APIs / microservices
→ Generate all routes, models, and a basic README.

---

## DESIGN RULES (for HTML/CSS output)
- Professional, polished design — not a wireframe.
- Smooth animations and hover/focus effects.
- Fully functional: real state and logic, no placeholder "TODO" sections.
- Handle loading, empty, and error states.
- Mobile-responsive.
- Use Google Fonts via @import when it improves aesthetics.

## GENERAL RULES
- Output the COMPLETE file content every time — never truncate or use "..." placeholders.
- When modifying an existing project, include ALL files (even unchanged ones).
- Never leave TODO comments or stubbed functions.
- The lang attribute must match the file type for correct syntax highlighting
  (html, css, javascript, typescript, python, sql, bash, json, markdown, go, rust, etc.)`;

// ── LLM streaming helpers ─────────────────────────────────────
async function streamAnthropic(res, messages, apiKey, baseUrl) {
  const base      = (baseUrl?.trim() || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;   // Bearer token (brconnector / OAuth)
  const apiKeyVal = apiKey?.trim() || process.env.ANTHROPIC_API_KEY;  // classic x-api-key

  if (!authToken && !apiKeyVal) {
    throw new Error('No API key. Enter one in Settings or set ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN env var.');
  }

  const headers = {
    'content-type':                        'application/json',
    'anthropic-version':                   '2023-06-01',
    'anthropic-beta':                      'claude-code-20250219,interleaved-thinking-2025-05-14,effort-2025-11-24',
    'anthropic-dangerous-direct-browser-access': 'true',
    'user-agent':                          'claude-cli/2.1.83 (external, claude-vscode, agent-sdk/0.2.92)',
    'x-app':                               'cli',
    'x-stainless-lang':                    'js',
    'x-stainless-package-version':         '0.74.0',
    'x-stainless-os':                      'Windows',
    'x-stainless-arch':                    'x64',
    'x-stainless-runtime':                 'node',
    'x-stainless-runtime-version':         'v24.3.0',
    'accept':                              'application/json',
  };
  if (authToken) {
    headers['authorization'] = `Bearer ${authToken}`;
  } else {
    headers['x-api-key'] = apiKeyVal;
  }

  const model = process.env.ANTHROPIC_MODEL || 'claude-opus-4-6';

  const upstream = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model, max_tokens: 16000, stream: true,
      system: SYSTEM_PROMPT,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!upstream.ok) {
    const body = await upstream.text().catch(() => '');
    throw new Error(`Anthropic ${upstream.status}: ${body || upstream.statusText}`);
  }

  const reader = upstream.body.getReader();
  const dec    = new TextDecoder();
  let   buf    = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data: ')) continue;
      const p = t.slice(6).trim();
      if (p === '[DONE]') return;
      try {
        const parsed = JSON.parse(p);
        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
          res.write(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`);
        }
        if (parsed.type === 'error') throw new Error(parsed.error?.message || 'API error');
      } catch (e) {
        if (e.message !== 'API error' && !e.message.startsWith('Anthropic')) { /* partial JSON, skip */ }
        else throw e;
      }
    }
  }
}

async function streamLocal(res, messages, cfg) {
  const baseUrl  = (cfg.localUrl || 'http://localhost:1234/v1').replace(/\/$/, '');
  const model    = cfg.localModel || 'local-model';
  const localKey = cfg.localKey?.trim() || 'lm-studio';

  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localKey}` },
    body: JSON.stringify({
      model, stream: true, temperature: 0.7, max_tokens: 16000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    }),
  });

  if (!upstream.ok) {
    const body = await upstream.text().catch(() => '');
    throw new Error(`Local LLM ${upstream.status}: ${body || upstream.statusText}`);
  }

  const reader = upstream.body.getReader();
  const dec    = new TextDecoder();
  let   buf    = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data: ')) continue;
      const p = t.slice(6).trim();
      if (p === '[DONE]') return;
      try {
        const parsed = JSON.parse(p);
        const text   = parsed.choices?.[0]?.delta?.content;
        if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
      } catch { /* partial */ }
    }
  }
}

// ── Generate ──────────────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const { messages, llmConfig } = req.body;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  try {
    if (llmConfig?.provider === 'local') {
      await streamLocal(res, messages, llmConfig);
    } else {
      await streamAnthropic(res, messages, llmConfig?.anthropicKey, llmConfig?.anthropicBaseUrl);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    const message = err instanceof Anthropic.APIError ? err.message : String(err);
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
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
app.get('/api/projects', async (_req, res) => {
  try {
    const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
    const list = await Promise.all(entries.map(async (entry) => {
      try {
        // New folder-based project
        if (entry.isDirectory()) {
          const mp = path.join(PROJECTS_DIR, entry.name, '.forge', 'project.json');
          const meta = JSON.parse(await fs.readFile(mp, 'utf-8'));
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
app.get('/api/projects/:id', async (req, res) => {
  const id  = safeId(req.params.id);
  const mp  = metaPath(id);

  try {
    // Try new folder-based format first
    const meta = JSON.parse(await fs.readFile(mp, 'utf-8'));
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

  // Legacy flat .json
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
app.put('/api/projects/:id', async (req, res) => {
  const id  = safeId(req.params.id);
  const dir = projectDir(id);
  const mp  = metaPath(id);

  // Load existing metadata if present
  let existing = {};
  try { existing = JSON.parse(await fs.readFile(mp, 'utf-8')); } catch { /* new project */ }

  const now      = new Date().toISOString();
  const files    = req.body.files    ?? existing._files   ?? [];   // GeneratedFile[]
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

  // Save metadata (no file contents)
  const meta = {
    id,
    name,
    messages,
    filePaths,             // [ { path, lang } ]
    createdAt: existing.createdAt ?? now,
    updatedAt: now,
  };
  await fs.writeFile(mp, JSON.stringify(meta, null, 2), 'utf-8');

  res.json({ ok: true, folderPath: dir });
});

// ── Delete project ────────────────────────────────────────────
app.delete('/api/projects/:id', async (req, res) => {
  const id = safeId(req.params.id);

  // Try new folder format
  try {
    const dir = projectDir(id);
    await fs.access(path.join(dir, '.forge', 'project.json'));
    await fs.rm(dir, { recursive: true, force: true });
    return res.json({ ok: true });
  } catch { /* not a folder project */ }

  // Try legacy flat .json
  try {
    await fs.unlink(path.join(PROJECTS_DIR, `${id}.json`));
    return res.json({ ok: true });
  } catch { return res.status(404).json({ error: 'Not found' }); }
});

// ── Open project folder in OS file manager ────────────────────
app.post('/api/projects/:id/open-folder', async (req, res) => {
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

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ── WebSocket terminal server ─────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n🔥 FORGE → http://localhost:${PORT}`);
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

      const exitCode = await mgr.run({
        content:  msg.content,
        filePath: msg.file,
        cwd:      msg.cwd,
        onData:   (data) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'output', data }));
          }
        },
      });

      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
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
