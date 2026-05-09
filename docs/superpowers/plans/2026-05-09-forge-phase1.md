# FORGE Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full code execution sandbox, AI auto-fix loop, plain-English status messages, package manager MCP, and unified multi-LLM support (Claude, OpenAI, Gemini, Ollama, LM Studio, custom) to FORGE.

**Architecture:** A WebSocket server (ws library) on the existing Express HTTP server spawns PTY processes (node-pty) for server-side code. xterm.js renders a real terminal in the browser, split-paned below the code editor. A unified provider abstraction replaces the current `streamAnthropic`/`streamLocal` split. An auto-fix hook feeds execution errors back to the active LLM and retries up to 5 times.

**Tech Stack:** node-pty, ws, xterm + xterm-addon-fit, openai SDK, @google/generative-ai, vitest (frontend tests), node:test (backend tests)

---

## Task 1: Install Dependencies + Test Setup

**Files:**
- Modify: `package.json`
- Modify: `server/package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install frontend dependencies**

```bash
cd /c/Lovable
npm install xterm xterm-addon-fit vitest @vitest/ui
```

Expected: packages added to `node_modules/`, `package.json` updated.

- [ ] **Step 2: Install backend dependencies**

```bash
cd /c/Lovable/server
npm install ws node-pty openai @google/generative-ai
```

> **Windows note:** `node-pty` is a native module and requires Visual Studio Build Tools. If the install fails with a node-gyp error, run: `npm install --global windows-build-tools` (requires admin PowerShell), then retry.

Expected: packages added, `server/package.json` updated.

- [ ] **Step 3: Add vitest config**

Create `vitest.config.ts` in project root:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 4: Add test script to root package.json**

In `package.json`, add to the `scripts` section:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Verify setup**

```bash
cd /c/Lovable
npx vitest run --reporter=verbose
```

Expected: `No test files found` (not an error — we just haven't written tests yet).

- [ ] **Step 6: Commit**

```bash
cd /c/Lovable
git init
git add package.json server/package.json vitest.config.ts
git commit -m "chore: install phase 1 dependencies and vitest"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Read current types.ts**

Read `src/types.ts` to understand existing types before adding new ones.

- [ ] **Step 2: Add execution and provider types**

Append to `src/types.ts`:

```ts
// ── Execution / Sandbox ───────────────────────────────────────

export type ExecutionStatus = 'idle' | 'running' | 'exited';

export interface WsMessage {
  type: 'start' | 'input' | 'kill' | 'resize' | 'output' | 'exit' | 'error';
  // client → server
  file?: string;
  content?: string;
  lang?: string;
  cwd?: string;
  data?: string;
  cols?: number;
  rows?: number;
  // server → client
  code?: number;
  message?: string;
}

export interface ExecutionState {
  status: ExecutionStatus;
  exitCode: number | null;
  command: string;
}

// ── Multi-LLM Provider ────────────────────────────────────────

export type ProviderType =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'ollama'
  | 'lmstudio'
  | 'custom';

export interface LLMProvider {
  provider: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

// ── Auto-Fix ──────────────────────────────────────────────────

export type AutoFixStatus =
  | 'idle'
  | 'fixing'
  | 'success'
  | 'failed';

export interface AutoFixState {
  status: AutoFixStatus;
  attempt: number;
  maxAttempts: number;
  lastError: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add execution, provider, and auto-fix types"
```

---

## Task 3: Language Detection Utility + Tests

**Files:**
- Create: `server/lang.mjs`
- Create: `server/lang.test.mjs`

- [ ] **Step 1: Write the failing tests first**

Create `server/lang.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRuntime, RUNNABLE_EXTENSIONS, WEB_EXTENSIONS } from './lang.mjs';

test('detects python', () => {
  const r = detectRuntime('/tmp/script.py');
  assert.equal(r.cmd, 'python');
  assert.deepEqual(r.args, []);
});

test('detects node for .js', () => {
  const r = detectRuntime('app.js');
  assert.equal(r.cmd, 'node');
});

test('detects node for .mjs', () => {
  const r = detectRuntime('server.mjs');
  assert.equal(r.cmd, 'node');
});

test('detects ts-node for .ts', () => {
  const r = detectRuntime('index.ts');
  assert.equal(r.cmd, 'npx');
  assert.deepEqual(r.args, ['ts-node']);
});

test('detects bash for .sh', () => {
  const r = detectRuntime('setup.sh');
  assert.equal(r.cmd, 'bash');
});

test('detects go run for .go', () => {
  const r = detectRuntime('main.go');
  assert.equal(r.cmd, 'go');
  assert.deepEqual(r.args, ['run']);
});

test('returns null for .css', () => {
  assert.equal(detectRuntime('style.css'), null);
});

test('returns null for .json', () => {
  assert.equal(detectRuntime('data.json'), null);
});

test('.html is in WEB_EXTENSIONS', () => {
  assert.ok(WEB_EXTENSIONS.has('.html'));
});

test('.htm is in WEB_EXTENSIONS', () => {
  assert.ok(WEB_EXTENSIONS.has('.htm'));
});

test('.py is in RUNNABLE_EXTENSIONS', () => {
  assert.ok(RUNNABLE_EXTENSIONS.has('.py'));
});

test('detects entry point: main.py preferred', () => {
  const { detectEntryPoint } = await import('./lang.mjs');
  const files = ['helper.py', 'main.py', 'utils.py'];
  assert.equal(detectEntryPoint(files), 'main.py');
});

test('detects entry point: index.js preferred', () => {
  const { detectEntryPoint } = await import('./lang.mjs');
  const files = ['utils.js', 'index.js'];
  assert.equal(detectEntryPoint(files), 'index.js');
});

test('detects entry point: falls back to last file', () => {
  const { detectEntryPoint } = await import('./lang.mjs');
  const files = ['helper.py', 'utils.py'];
  assert.equal(detectEntryPoint(files), 'utils.py');
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd /c/Lovable/server
node --test lang.test.mjs
```

Expected: `Error: Cannot find module './lang.mjs'`

- [ ] **Step 3: Implement lang.mjs**

Create `server/lang.mjs`:

```js
import path from 'path';

const RUNTIME_MAP = {
  '.py':   { cmd: 'python',  args: [] },
  '.js':   { cmd: 'node',    args: [] },
  '.mjs':  { cmd: 'node',    args: [] },
  '.ts':   { cmd: 'npx',     args: ['ts-node'] },
  '.sh':   { cmd: 'bash',    args: [] },
  '.bash': { cmd: 'bash',    args: [] },
  '.sql':  { cmd: 'sqlite3', args: [':memory:'] },
  '.rb':   { cmd: 'ruby',    args: [] },
  '.go':   { cmd: 'go',      args: ['run'] },
  '.rs':   { cmd: 'cargo',   args: ['run'] },
  '.php':  { cmd: 'php',     args: [] },
};

export const WEB_EXTENSIONS = new Set(['.html', '.htm']);

export const RUNNABLE_EXTENSIONS = new Set([
  ...Object.keys(RUNTIME_MAP),
  ...WEB_EXTENSIONS,
]);

/** Returns { cmd, args } for a file path, or null if not runnable. */
export function detectRuntime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return RUNTIME_MAP[ext] ?? null;
}

const ENTRY_POINT_PRIORITY = [
  'main.py', 'app.py', 'index.py',
  'index.js', 'server.js', 'app.js', 'main.js',
  'main.ts', 'index.ts', 'server.ts', 'app.ts',
  'main.go', 'main.rs', 'main.rb',
];

/** Given a list of file paths, return the best entry point to auto-run. */
export function detectEntryPoint(filePaths) {
  if (filePaths.length === 0) return null;
  if (filePaths.length === 1) return filePaths[0];
  for (const name of ENTRY_POINT_PRIORITY) {
    const match = filePaths.find(f => path.basename(f) === name);
    if (match) return match;
  }
  return filePaths[filePaths.length - 1];
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd /c/Lovable/server
node --test lang.test.mjs
```

Expected: all 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/lang.mjs server/lang.test.mjs
git commit -m "feat: language detection and entry point utility"
```

---

## Task 4: ExecutionManager (Backend)

**Files:**
- Create: `server/execution.mjs`
- Create: `server/execution.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `server/execution.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionManager } from './execution.mjs';

test('ExecutionManager: run and capture output', async () => {
  const mgr = new ExecutionManager();
  const chunks = [];
  const code = await mgr.run({
    content: 'console.log("hello forge")',
    filePath: 'test.js',
    cwd: process.cwd(),
    onData: (data) => chunks.push(data),
  });
  const output = chunks.join('');
  assert.ok(output.includes('hello forge'), `Expected "hello forge" in: ${output}`);
  assert.equal(code, 0);
  mgr.destroy();
});

test('ExecutionManager: non-zero exit for bad code', async () => {
  const mgr = new ExecutionManager();
  const code = await mgr.run({
    content: 'process.exit(1)',
    filePath: 'fail.js',
    cwd: process.cwd(),
    onData: () => {},
  });
  assert.equal(code, 1);
  mgr.destroy();
});

test('ExecutionManager: kill terminates process', async () => {
  const mgr = new ExecutionManager();
  let exited = false;
  const p = mgr.run({
    content: 'setTimeout(() => {}, 60000)',
    filePath: 'long.js',
    cwd: process.cwd(),
    onData: () => {},
  }).then((code) => { exited = true; return code; });
  await new Promise(r => setTimeout(r, 200));
  mgr.kill();
  await p;
  assert.ok(exited);
  mgr.destroy();
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd /c/Lovable/server
node --test execution.test.mjs
```

Expected: `Error: Cannot find module './execution.mjs'`

- [ ] **Step 3: Implement ExecutionManager**

Create `server/execution.mjs`:

```js
import pty from 'node-pty';
import fs  from 'fs/promises';
import os  from 'os';
import path from 'path';
import { detectRuntime } from './lang.mjs';

const TIMEOUT_MS = 60_000;

export class ExecutionManager {
  #pty = null;
  #tempFile = null;
  #timeoutId = null;

  /**
   * Spawns a PTY process for the given file content.
   * Returns a promise that resolves with the exit code.
   */
  async run({ content, filePath, cwd, onData }) {
    const ext = path.extname(filePath).toLowerCase();
    const runtime = detectRuntime(filePath);

    if (!runtime) {
      onData(`\r\nNo runtime available for ${ext} files.\r\n`);
      return 127;
    }

    // Write content to a temp file in cwd
    this.#tempFile = path.join(cwd, `_forge_run_${Date.now()}${ext}`);
    await fs.writeFile(this.#tempFile, content, 'utf-8');

    const { cmd, args } = runtime;
    // For cargo run, pass manifest path; otherwise append file path
    const finalArgs = ext === '.rs'
      ? [...args, '--manifest-path', path.join(cwd, 'Cargo.toml')]
      : [...args, this.#tempFile];

    return new Promise((resolve) => {
      try {
        this.#pty = pty.spawn(cmd, finalArgs, {
          name: 'xterm-color',
          cols: 80,
          rows: 24,
          cwd,
          env: { ...process.env, FORCE_COLOR: '1' },
        });
      } catch (err) {
        onData(`\r\n${cmd} not found — install it and ensure it is in PATH.\r\n`);
        this.#cleanup();
        resolve(127);
        return;
      }

      this.#pty.onData((data) => onData(data));

      this.#pty.onExit(({ exitCode }) => {
        clearTimeout(this.#timeoutId);
        this.#cleanup();
        resolve(exitCode ?? 0);
      });

      this.#timeoutId = setTimeout(() => {
        onData('\r\nProcess timed out after 60s.\r\n');
        this.kill();
      }, TIMEOUT_MS);
    });
  }

  /** Send data to the process stdin. */
  write(data) {
    this.#pty?.write(data);
  }

  /** Resize the terminal. */
  resize(cols, rows) {
    this.#pty?.resize(cols, rows);
  }

  /** Kill the running process. */
  kill() {
    clearTimeout(this.#timeoutId);
    try { this.#pty?.kill(); } catch { /* already dead */ }
  }

  /** Kill and clean up temp file. */
  destroy() {
    this.kill();
    this.#cleanup();
  }

  async #cleanup() {
    if (this.#tempFile) {
      await fs.unlink(this.#tempFile).catch(() => {});
      this.#tempFile = null;
    }
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd /c/Lovable/server
node --test execution.test.mjs
```

Expected: all 3 tests pass. If `node-pty` failed to install on Windows, you'll see a build error — fix that first (see Task 1 Windows note).

- [ ] **Step 5: Commit**

```bash
git add server/execution.mjs server/execution.test.mjs
git commit -m "feat: ExecutionManager with PTY spawning and timeout"
```

---

## Task 5: WebSocket Server

**Files:**
- Modify: `server/index.mjs`

- [ ] **Step 1: Add WebSocket import and server upgrade**

At the top of `server/index.mjs`, add the ws import after existing imports:

```js
import { WebSocketServer } from 'ws';
import { ExecutionManager } from './execution.mjs';
```

- [ ] **Step 2: Replace `app.listen` at the bottom of index.mjs**

Find the existing `app.listen(...)` call at the end of `server/index.mjs` and replace it with:

```js
// ── WebSocket terminal server ─────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`FORGE server running on http://localhost:${PORT}`);
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
      // Kill any existing process
      mgr?.destroy();
      mgr = new ExecutionManager();

      const exitCode = await mgr.run({
        content: msg.content,
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
```

- [ ] **Step 3: Verify server starts without error**

```bash
cd /c/Lovable/server
node index.mjs
```

Expected: `FORGE server running on http://localhost:3001` — no crash.

Stop the server with Ctrl+C.

- [ ] **Step 4: Smoke test WebSocket manually**

In a second terminal, run:

```bash
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3001/terminal');
ws.on('open', () => {
  ws.send(JSON.stringify({type:'start',file:'test.js',content:'console.log(42)',cwd:process.cwd()}));
});
ws.on('message', d => { console.log('MSG:', d.toString()); });
setTimeout(() => process.exit(0), 3000);
"
```

Expected: output contains `"data":"42"` and `"type":"exit","code":0`.

- [ ] **Step 5: Commit**

```bash
git add server/index.mjs
git commit -m "feat: WebSocket terminal server with PTY execution"
```

---

## Task 6: Provider Abstraction — Refactor Anthropic + Add Factory

**Files:**
- Create: `server/providers/anthropic.mjs`
- Create: `server/providers/index.mjs`
- Modify: `server/index.mjs`

- [ ] **Step 1: Create providers directory**

```bash
mkdir -p /c/Lovable/server/providers
```

- [ ] **Step 2: Extract Anthropic provider**

Create `server/providers/anthropic.mjs` — this is the existing `streamAnthropic` function, refactored into a class:

```js
export class AnthropicProvider {
  #cfg;

  constructor(cfg) {
    // cfg: { apiKey, baseUrl, model }
    this.#cfg = cfg;
  }

  async stream(res, messages, systemPrompt) {
    const base      = (this.#cfg.baseUrl?.trim() || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
    const apiKeyVal = this.#cfg.apiKey?.trim() || process.env.ANTHROPIC_API_KEY;

    if (!authToken && !apiKeyVal) {
      throw new Error('No API key. Enter one in Settings or set ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN env var.');
    }

    const headers = {
      'content-type':      'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta':    'claude-code-20250219,interleaved-thinking-2025-05-14,effort-2025-11-24',
      'anthropic-dangerous-direct-browser-access': 'true',
      'user-agent':        'claude-cli/2.1.83 (external, claude-vscode, agent-sdk/0.2.92)',
      'x-app':             'cli',
      'x-stainless-lang':  'js',
      'x-stainless-package-version': '0.74.0',
      'x-stainless-os':    'Windows',
      'x-stainless-arch':  'x64',
      'x-stainless-runtime': 'node',
      'x-stainless-runtime-version': 'v24.3.0',
      'accept':            'application/json',
    };
    if (authToken) {
      headers['authorization'] = `Bearer ${authToken}`;
    } else {
      headers['x-api-key'] = apiKeyVal;
    }

    const model = this.#cfg.model || process.env.ANTHROPIC_MODEL || 'claude-opus-4-6';

    const upstream = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model, max_tokens: 16000, stream: true,
        system: systemPrompt,
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
          if (e.message !== 'API error' && !e.message.startsWith('Anthropic')) continue;
          else throw e;
        }
      }
    }
  }
}
```

- [ ] **Step 3: Create provider factory**

Create `server/providers/index.mjs`:

```js
import { AnthropicProvider } from './anthropic.mjs';
import { OpenAIProvider }    from './openai.mjs';
import { GeminiProvider }    from './gemini.mjs';

/**
 * Creates the appropriate provider from an llmConfig object.
 * llmConfig shape (from frontend):
 *   { provider, apiKey, baseUrl, model, localUrl, localModel, localKey, anthropicKey, anthropicBaseUrl }
 */
export function createProvider(llmConfig = {}) {
  const p = llmConfig.provider || 'anthropic';

  switch (p) {
    case 'anthropic':
      return new AnthropicProvider({
        apiKey:  llmConfig.apiKey || llmConfig.anthropicKey,   // new shape || legacy shape
        baseUrl: llmConfig.baseUrl || llmConfig.anthropicBaseUrl,
        model:   llmConfig.model,
      });

    case 'openai':
      return new OpenAIProvider({
        apiKey:  llmConfig.apiKey,
        baseUrl: 'https://api.openai.com/v1',
        model:   llmConfig.model || 'gpt-4o',
      });

    case 'gemini':
      return new GeminiProvider({
        apiKey: llmConfig.apiKey,
        model:  llmConfig.model || 'gemini-2.0-flash',
      });

    case 'ollama':
      return new OpenAIProvider({
        apiKey:  'ollama',
        baseUrl: (llmConfig.baseUrl || 'http://localhost:11434').replace(/\/$/, '') + '/v1',
        model:   llmConfig.model || 'llama3',
      });

    case 'lmstudio':
    case 'local':
      return new OpenAIProvider({
        apiKey:  llmConfig.localKey || llmConfig.apiKey || 'lm-studio',
        baseUrl: (llmConfig.localUrl || llmConfig.baseUrl || 'http://localhost:1234/v1').replace(/\/$/, ''),
        model:   llmConfig.localModel || llmConfig.model || 'local-model',
      });

    case 'custom':
      return new OpenAIProvider({
        apiKey:  llmConfig.apiKey,
        baseUrl: (llmConfig.baseUrl || '').replace(/\/$/, ''),
        model:   llmConfig.model,
      });

    default:
      throw new Error(`Unknown LLM provider: ${p}`);
  }
}
```

- [ ] **Step 4: Update /api/generate to use factory**

In `server/index.mjs`, replace the `app.post('/api/generate', ...)` handler with:

```js
import { createProvider } from './providers/index.mjs';

// ... (keep existing imports and code) ...

app.post('/api/generate', async (req, res) => {
  const { messages, llmConfig } = req.body;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  try {
    const provider = createProvider(llmConfig);
    await provider.stream(res, messages, SYSTEM_PROMPT);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: String(err.message || err) })}\n\n`);
    res.end();
  }
});
```

Also add `import { createProvider } from './providers/index.mjs';` to the top of `server/index.mjs` and **remove** the old `streamAnthropic` and `streamLocal` functions (they are now replaced by the providers).

- [ ] **Step 5: Verify existing generation still works**

```bash
cd /c/Lovable
npm run dev
```

Open http://localhost:5173, create a new project, type "build a hello world html page", confirm streaming still works. Stop server.

- [ ] **Step 6: Commit**

```bash
git add server/providers/anthropic.mjs server/providers/index.mjs server/index.mjs
git commit -m "feat: provider abstraction, refactor Anthropic streaming"
```

---

## Task 7: OpenAI Provider (covers OpenAI, Ollama, LM Studio, Custom)

**Files:**
- Create: `server/providers/openai.mjs`

- [ ] **Step 1: Write the test**

Create `server/providers/openai.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider } from './openai.mjs';

test('OpenAIProvider: throws if no apiKey', async () => {
  const p = new OpenAIProvider({ apiKey: '', baseUrl: 'http://localhost:1234/v1', model: 'x' });
  const fakeRes = { write: () => {}, end: () => {} };
  await assert.rejects(
    () => p.stream(fakeRes, [], 'system'),
    /api key/i
  );
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd /c/Lovable/server
node --test providers/openai.test.mjs
```

Expected: `Cannot find module './openai.mjs'`

- [ ] **Step 3: Implement OpenAI provider**

Create `server/providers/openai.mjs`:

```js
import OpenAI from 'openai';

export class OpenAIProvider {
  #cfg;

  constructor(cfg) {
    // cfg: { apiKey, baseUrl, model }
    this.#cfg = cfg;
  }

  async stream(res, messages, systemPrompt) {
    const apiKey = this.#cfg.apiKey?.trim() || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('No API key. Enter one in Settings or set OPENAI_API_KEY env var.');
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.#cfg.baseUrl || 'https://api.openai.com/v1',
    });

    const stream = await client.chat.completions.create({
      model:      this.#cfg.model || 'gpt-4o',
      max_tokens: 16000,
      stream:     true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
  }
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd /c/Lovable/server
node --test providers/openai.test.mjs
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add server/providers/openai.mjs server/providers/openai.test.mjs
git commit -m "feat: OpenAI provider (covers OpenAI, Ollama, LM Studio, custom)"
```

---

## Task 8: Google Gemini Provider

**Files:**
- Create: `server/providers/gemini.mjs`

- [ ] **Step 1: Write the test**

Create `server/providers/gemini.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiProvider } from './gemini.mjs';

test('GeminiProvider: throws if no apiKey', async () => {
  const p = new GeminiProvider({ apiKey: '', model: 'gemini-2.0-flash' });
  const fakeRes = { write: () => {} };
  await assert.rejects(
    () => p.stream(fakeRes, [], 'system'),
    /api key/i
  );
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd /c/Lovable/server
node --test providers/gemini.test.mjs
```

- [ ] **Step 3: Implement Gemini provider**

Create `server/providers/gemini.mjs`:

```js
import { GoogleGenerativeAI } from '@google/generative-ai';

export class GeminiProvider {
  #cfg;

  constructor(cfg) {
    // cfg: { apiKey, model }
    this.#cfg = cfg;
  }

  async stream(res, messages, systemPrompt) {
    const apiKey = this.#cfg.apiKey?.trim() || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('No API key. Enter one in Settings or set GEMINI_API_KEY env var.');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model:              this.#cfg.model || 'gemini-2.0-flash',
      systemInstruction:  systemPrompt,
    });

    // Convert FORGE message format to Gemini format
    const history = messages.slice(0, -1).map((m) => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const lastMsg = messages[messages.length - 1]?.content ?? '';

    const chat   = model.startChat({ history });
    const result = await chat.sendMessageStream(lastMsg);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
  }
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd /c/Lovable/server
node --test providers/gemini.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add server/providers/gemini.mjs server/providers/gemini.test.mjs
git commit -m "feat: Google Gemini provider"
```

---

## Task 9: ProviderSettings UI Component

**Files:**
- Create: `src/components/ProviderSettings.tsx`
- Modify: `src/components/Header.tsx`

- [ ] **Step 1: Read current Header.tsx to understand settings modal pattern**

Read `src/components/Header.tsx` to find how the existing settings modal works.

- [ ] **Step 2: Create ProviderSettings component**

Create `src/components/ProviderSettings.tsx`:

```tsx
import React, { useState } from 'react';
import type { LLMProvider, ProviderType } from '../types';

interface Props {
  config: LLMProvider;
  onChange: (config: LLMProvider) => void;
}

const PROVIDER_LABELS: Record<ProviderType, string> = {
  anthropic: 'Claude (Anthropic)',
  openai:    'OpenAI (GPT-4o, o1…)',
  gemini:    'Google Gemini',
  ollama:    'Ollama (local)',
  lmstudio:  'LM Studio (local)',
  custom:    'Custom OpenAI-compatible',
};

const DEFAULT_MODELS: Record<ProviderType, string[]> = {
  anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  openai:    ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini'],
  gemini:    ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  ollama:    ['llama3', 'mistral', 'codellama', 'phi3'],
  lmstudio:  ['local-model'],
  custom:    [],
};

const NEEDS_BASE_URL: ProviderType[] = ['ollama', 'lmstudio', 'custom'];
const DEFAULT_BASE_URLS: Partial<Record<ProviderType, string>> = {
  ollama:   'http://localhost:11434',
  lmstudio: 'http://localhost:1234/v1',
};

export function ProviderSettings({ config, onChange }: Props) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const update = (patch: Partial<LLMProvider>) =>
    onChange({ ...config, ...patch });

  const provider = config.provider ?? 'anthropic';

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
          llmConfig: config,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Read a bit of the stream
      const reader = res.body!.getReader();
      const { value } = await reader.read();
      reader.cancel();
      const text = new TextDecoder().decode(value);
      setTestResult(text.includes('error') ? '✗ Connection failed' : '✓ Connected');
    } catch (e) {
      setTestResult(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  }

  const models = DEFAULT_MODELS[provider] ?? [];
  const needsBaseUrl = NEEDS_BASE_URL.includes(provider);

  return (
    <div className="provider-settings">
      <h3>AI Provider</h3>

      <label className="setting-label">
        Provider
        <select
          value={provider}
          onChange={(e) => update({ provider: e.target.value as ProviderType, model: '', apiKey: '', baseUrl: DEFAULT_BASE_URLS[e.target.value as ProviderType] || '' })}
        >
          {(Object.keys(PROVIDER_LABELS) as ProviderType[]).map((k) => (
            <option key={k} value={k}>{PROVIDER_LABELS[k]}</option>
          ))}
        </select>
      </label>

      {models.length > 0 && (
        <label className="setting-label">
          Model
          <select value={config.model || models[0]} onChange={(e) => update({ model: e.target.value })}>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      )}

      {provider !== 'ollama' && provider !== 'lmstudio' && (
        <label className="setting-label">
          API Key
          <input
            type="password"
            placeholder={`Enter ${PROVIDER_LABELS[provider]} API key`}
            value={config.apiKey || ''}
            onChange={(e) => update({ apiKey: e.target.value })}
          />
        </label>
      )}

      {needsBaseUrl && (
        <label className="setting-label">
          Base URL
          <input
            type="text"
            placeholder={DEFAULT_BASE_URLS[provider] || 'http://...'}
            value={config.baseUrl || ''}
            onChange={(e) => update({ baseUrl: e.target.value })}
          />
        </label>
      )}

      <div className="setting-row">
        <button
          className="btn-secondary"
          onClick={testConnection}
          disabled={testing}
        >
          {testing ? 'Testing…' : 'Test Connection'}
        </button>
        {testResult && (
          <span className={testResult.startsWith('✓') ? 'test-ok' : 'test-fail'}>
            {testResult}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire ProviderSettings into the existing settings modal in Header.tsx**

Read `src/components/Header.tsx` to find where `llmConfig` / `anthropicKey` settings are rendered. Replace that section with:

```tsx
import { ProviderSettings } from './ProviderSettings';

// Inside the settings modal JSX, replace the existing provider fields with:
<ProviderSettings
  config={llmConfig}
  onChange={(cfg) => setLlmConfig(cfg)}
/>
```

> Read `src/components/Header.tsx` and find the settings panel JSX section. Look for the block that renders the anthropic API key input and the local LLM URL fields. Remove those fields and replace with `<ProviderSettings config={llmConfig} onChange={setLlmConfig} />`. The `llmConfig` state and `setLlmConfig` setter should already exist — just swap the UI.

- [ ] **Step 4: Update llmConfig state shape in useProject.ts**

Read `src/hooks/useProject.ts`. Find where `llmConfig` is stored in `localStorage`. Add migration: if the stored config has `provider: 'local'`, remap to `provider: 'lmstudio'` so existing users aren't broken.

```ts
// In the localStorage load logic for llmConfig:
const stored = JSON.parse(localStorage.getItem('forge-llm-config') || '{}');
// Migrate legacy 'local' provider
if (stored.provider === 'local') stored.provider = 'lmstudio';
// Migrate legacy flat keys
if (!stored.provider && stored.anthropicKey) stored.provider = 'anthropic';
```

- [ ] **Step 5: Verify UI renders**

```bash
npm run dev
```

Open settings, confirm all 6 providers appear in the dropdown. Test Connection button should appear. No console errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ProviderSettings.tsx src/components/Header.tsx src/hooks/useProject.ts
git commit -m "feat: ProviderSettings UI with 6 LLM providers"
```

---

## Task 10: TerminalPane Component

**Files:**
- Create: `src/components/TerminalPane.tsx`

- [ ] **Step 1: Write a smoke test**

Create `src/components/TerminalPane.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock xterm since jsdom doesn't support canvas
vi.mock('xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
    loadAddon: vi.fn(),
    onData: vi.fn(),
  })),
}));
vi.mock('xterm-addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({ fit: vi.fn(), dispose: vi.fn() })),
}));

import { TerminalPane } from './TerminalPane';

describe('TerminalPane', () => {
  it('renders header with command', () => {
    render(
      <TerminalPane
        command="python script.py"
        status="idle"
        exitCode={null}
        wsUrl="ws://localhost:3001/terminal"
        onStop={() => {}}
        onClear={() => {}}
      />
    );
    expect(screen.getByText('TERMINAL')).toBeTruthy();
  });

  it('shows exit badge when exited', () => {
    render(
      <TerminalPane
        command="python script.py"
        status="exited"
        exitCode={0}
        wsUrl="ws://localhost:3001/terminal"
        onStop={() => {}}
        onClear={() => {}}
      />
    );
    expect(screen.getByText(/exit 0/)).toBeTruthy();
  });
});
```

Install testing library:

```bash
npm install -D @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 2: Run test — expect failure**

```bash
npx vitest run src/components/TerminalPane.test.tsx
```

Expected: `Cannot find module './TerminalPane'`

- [ ] **Step 3: Implement TerminalPane**

Create `src/components/TerminalPane.tsx`:

```tsx
import React, { useEffect, useRef, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import type { ExecutionStatus } from '../types';

interface Props {
  command: string;
  status: ExecutionStatus;
  exitCode: number | null;
  wsUrl: string;
  onStop: () => void;
  onClear: () => void;
  // Exposed so parent (useExecution) can write web console output
  writeRef?: React.MutableRefObject<((data: string) => void) | null>;
}

export function TerminalPane({ command, status, exitCode, wsUrl, onStop, onClear, writeRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef      = useRef<Terminal | null>(null);
  const fitRef       = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#060810',
        foreground: '#EEEEF8',
        cursor:     '#FF5E1A',
        selection:  '#FF5E1A44',
      },
      fontFamily: 'JetBrains Mono, Cascadia Code, monospace',
      fontSize:   13,
      cursorBlink: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current  = fit;

    if (writeRef) {
      writeRef.current = (data: string) => term.write(data);
    }

    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      fit.dispose();
      term.dispose();
      if (writeRef) writeRef.current = null;
    };
  }, []);

  const handleClear = useCallback(() => {
    termRef.current?.clear();
    onClear();
  }, [onClear]);

  const exitLabel = exitCode === 0
    ? <span className="exit-badge exit-ok">● exit 0</span>
    : <span className="exit-badge exit-fail">● exit {exitCode}</span>;

  return (
    <div className="terminal-pane">
      <div className="terminal-header">
        <span className="terminal-label">TERMINAL</span>
        <span className="terminal-command">{command}</span>
        <div className="terminal-controls">
          {status === 'exited' && exitLabel}
          <button
            className="terminal-btn"
            onClick={onStop}
            disabled={status !== 'running'}
            title="Stop process"
          >
            ⏹ Stop
          </button>
          <button className="terminal-btn" onClick={handleClear} title="Clear output">
            🗑 Clear
          </button>
        </div>
      </div>
      <div ref={containerRef} className="terminal-body" />
    </div>
  );
}
```

- [ ] **Step 4: Add terminal CSS to index.css**

Append to `src/index.css`:

```css
/* ── TerminalPane ───────────────────────────────────────────── */
.terminal-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #060810;
  border-top: 2px solid #FF5E1A33;
}

.terminal-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 12px;
  background: #0d0d18;
  border-bottom: 1px solid #1a1a2e;
  min-height: 32px;
  flex-shrink: 0;
}

.terminal-label {
  color: #00C4AA;
  font-size: 10px;
  font-weight: bold;
  letter-spacing: 0.08em;
}

.terminal-command {
  color: #555;
  font-size: 10px;
  font-family: 'JetBrains Mono', monospace;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.exit-badge {
  font-size: 9px;
  padding: 2px 8px;
  border-radius: 10px;
  font-family: 'JetBrains Mono', monospace;
}

.exit-ok   { color: #7fff7f; background: #0a1a0a; border: 1px solid #1a3a1a; }
.exit-fail { color: #ff7f7f; background: #1a0a0a; border: 1px solid #3a1a1a; }

.terminal-btn {
  background: #1a1a2e;
  border: none;
  color: #555;
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-family: inherit;
}

.terminal-btn:hover:not(:disabled) { color: #aaa; background: #252540; }
.terminal-btn:disabled { opacity: 0.4; cursor: default; }

.terminal-body {
  flex: 1;
  min-height: 0;
  padding: 4px;
}

/* xterm overrides */
.terminal-body .xterm { height: 100%; }
.terminal-body .xterm-viewport { border-radius: 0; }
```

- [ ] **Step 5: Run tests — expect pass**

```bash
npx vitest run src/components/TerminalPane.test.tsx
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/TerminalPane.tsx src/components/TerminalPane.test.tsx src/index.css
git commit -m "feat: TerminalPane component with xterm.js"
```

---

## Task 11: useExecution Hook

**Files:**
- Create: `src/hooks/useExecution.ts`

- [ ] **Step 1: Write the test**

Create `src/hooks/useExecution.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildCommand, isWebFile } from './useExecution';

describe('buildCommand', () => {
  it('python files', () => expect(buildCommand('script.py')).toBe('python script.py'));
  it('js files',     () => expect(buildCommand('app.js')).toBe('node app.js'));
  it('ts files',     () => expect(buildCommand('app.ts')).toBe('npx ts-node app.ts'));
  it('go files',     () => expect(buildCommand('main.go')).toBe('go run main.go'));
  it('unknown',      () => expect(buildCommand('file.xyz')).toBeNull());
});

describe('isWebFile', () => {
  it('.html is web', () => expect(isWebFile('index.html')).toBe(true));
  it('.htm is web',  () => expect(isWebFile('page.htm')).toBe(true));
  it('.js is not web', () => expect(isWebFile('app.js')).toBe(false));
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
npx vitest run src/hooks/useExecution.test.ts
```

- [ ] **Step 3: Implement useExecution**

Create `src/hooks/useExecution.ts`:

```ts
import { useState, useRef, useCallback, useEffect } from 'react';
import type { ExecutionState, ExecutionStatus, WsMessage } from '../types';

const WS_URL = 'ws://localhost:3001/terminal';

const LANG_COMMANDS: Record<string, string> = {
  '.py':   'python',
  '.js':   'node',
  '.mjs':  'node',
  '.ts':   'npx ts-node',
  '.sh':   'bash',
  '.bash': 'bash',
  '.sql':  'sqlite3 :memory:',
  '.rb':   'ruby',
  '.go':   'go run',
  '.rs':   'cargo run',
  '.php':  'php',
};

const WEB_EXTS = new Set(['.html', '.htm']);

/** Returns "python script.py" style label, or null if not runnable. */
export function buildCommand(filePath: string): string | null {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  const cmd = LANG_COMMANDS[ext];
  if (!cmd) return null;
  const name = filePath.split('/').pop() ?? filePath;
  return `${cmd} ${name}`;
}

export function isWebFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return WEB_EXTS.has(ext);
}

export function useExecution(projectCwd: string) {
  const [state, setState] = useState<ExecutionState>({
    status:   'idle',
    exitCode: null,
    command:  '',
  });

  const wsRef      = useRef<WebSocket | null>(null);
  const writeRef   = useRef<((data: string) => void) | null>(null); // set by TerminalPane

  const run = useCallback((filePath: string, content: string) => {
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();

    if (isWebFile(filePath)) {
      // Web files use iframe console interception — no WebSocket needed
      setState({ status: 'running', exitCode: null, command: 'browser preview' });
      return;
    }

    const cmd = buildCommand(filePath);
    if (!cmd) return;

    // Close any existing connection
    wsRef.current?.close();

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    setState({ status: 'running', exitCode: null, command: cmd });

    ws.onopen = () => {
      const msg: WsMessage = {
        type:    'start',
        file:    filePath,
        content,
        lang:    ext.slice(1),
        cwd:     projectCwd,
      };
      ws.send(JSON.stringify(msg));
    };

    ws.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data);
      if (msg.type === 'output' && msg.data) {
        writeRef.current?.(msg.data);
      }
      if (msg.type === 'exit') {
        setState({ status: 'exited', exitCode: msg.code ?? 0, command: cmd });
        ws.close();
      }
      if (msg.type === 'error' && msg.message) {
        writeRef.current?.(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
        setState({ status: 'exited', exitCode: 127, command: cmd });
        ws.close();
      }
    };

    ws.onerror = () => {
      writeRef.current?.('\r\n\x1b[31mCould not connect to execution server\x1b[0m\r\n');
      setState({ status: 'exited', exitCode: 1, command: cmd });
    };
  }, [projectCwd]);

  const stop = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: 'kill' }));
    wsRef.current?.close();
    wsRef.current = null;
    setState(s => ({ ...s, status: 'exited' }));
  }, []);

  const sendInput = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }));
    }
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }, []);

  // Clean up on unmount
  useEffect(() => () => wsRef.current?.close(), []);

  return { state, run, stop, sendInput, resize, writeRef };
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run src/hooks/useExecution.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useExecution.ts src/hooks/useExecution.test.ts
git commit -m "feat: useExecution hook with WebSocket lifecycle"
```

---

## Task 12: CodePanel Split Pane + Run Button

**Files:**
- Modify: `src/components/CodePanel.tsx`

- [ ] **Step 1: Read current CodePanel.tsx**

Read `src/components/CodePanel.tsx` to understand current structure before modifying.

- [ ] **Step 2: Add split pane layout, Run button, and TerminalPane integration**

The CodePanel needs these additions:
1. A Run button in the file tab bar
2. A resize handle between code and terminal
3. The `TerminalPane` rendered below
4. `useExecution` hook wired up

Replace the `CodePanel` component with the modified version. Key changes — add near the top of the component:

```tsx
import { useState, useRef, useCallback } from 'react';
import { TerminalPane } from './TerminalPane';
import { useExecution, buildCommand, isWebFile } from '../hooks/useExecution';

// Inside CodePanel component:
const { state: execState, run, stop, writeRef } = useExecution(project.folderPath ?? '');

const [termHeight, setTermHeight] = useState(0); // 0 = collapsed
const [dragging, setDragging] = useState(false);
const panelRef = useRef<HTMLDivElement>(null);

const handleRunClick = useCallback(() => {
  if (!activeFile) return;
  const file = project.files.find(f => f.path === activeFile);
  if (!file) return;
  if (termHeight === 0) setTermHeight(220); // auto-expand on first run
  run(file.path, file.content);
}, [activeFile, project.files, run, termHeight]);

const handleDragStart = useCallback((e: React.MouseEvent) => {
  e.preventDefault();
  setDragging(true);
  const startY = e.clientY;
  const startH = termHeight;
  const onMove = (ev: MouseEvent) => {
    const delta = startY - ev.clientY;
    setTermHeight(Math.max(0, Math.min(startH + delta, 600)));
  };
  const onUp = () => {
    setDragging(false);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}, [termHeight]);
```

In the JSX, add the Run button to the file tab row (after the last tab, right-aligned):

```tsx
{activeFile && (() => {
  const file = project.files.find(f => f.path === activeFile);
  const cmd = file ? buildCommand(file.path) : null;
  const isWeb = file ? isWebFile(file.path) : false;
  const label = isWeb ? 'Preview' : cmd ? `▶ Run (${cmd.split(' ')[0]})` : null;
  return label ? (
    <button
      className={`run-btn${execState.status === 'running' ? ' run-btn--running' : ''}`}
      onClick={handleRunClick}
      disabled={execState.status === 'running'}
      title={cmd ?? 'Open in preview'}
    >
      {execState.status === 'running' ? '⏳ Running…' : label}
    </button>
  ) : (
    <span className="run-btn run-btn--disabled" title={`No runtime for ${file?.path}`}>
      ▶ Run
    </span>
  );
})()}
```

Below the code editor div, add the drag handle and terminal:

```tsx
{/* Drag handle */}
<div
  className={`resize-handle${dragging ? ' resize-handle--dragging' : ''}`}
  onMouseDown={handleDragStart}
/>

{/* Terminal pane */}
{termHeight > 0 && (
  <div style={{ height: termHeight, flexShrink: 0 }}>
    <TerminalPane
      command={execState.command}
      status={execState.status}
      exitCode={execState.exitCode}
      wsUrl="ws://localhost:3001/terminal"
      onStop={stop}
      onClear={() => {}}
      writeRef={writeRef}
    />
  </div>
)}
```

- [ ] **Step 3: Add Run button + resize handle CSS to index.css**

Append to `src/index.css`:

```css
/* ── Run Button ─────────────────────────────────────────────── */
.run-btn {
  margin-left: auto;
  background: #FF5E1A;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 3px 12px;
  font-size: 10px;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  flex-shrink: 0;
}

.run-btn:hover:not(:disabled) { background: #ff7a3d; }
.run-btn:disabled, .run-btn--running { opacity: 0.7; cursor: default; }
.run-btn--disabled { background: #2a2a3e; color: #555; cursor: default; }

/* ── Resize Handle ──────────────────────────────────────────── */
.resize-handle {
  height: 5px;
  background: #1a1a2e;
  cursor: ns-resize;
  flex-shrink: 0;
  position: relative;
  transition: background 0.15s;
}

.resize-handle:hover,
.resize-handle--dragging { background: #FF5E1A55; }

.resize-handle::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 32px;
  height: 2px;
  background: #333;
  border-radius: 1px;
}
```

- [ ] **Step 4: Verify in browser**

```bash
npm run dev
```

Open FORGE, generate a Python script. Confirm:
- Run button appears with `▶ Run (python)` label
- Clicking Run expands the terminal pane
- Terminal shows output
- Drag handle resizes the split
- Stop button works

- [ ] **Step 5: Commit**

```bash
git add src/components/CodePanel.tsx src/index.css
git commit -m "feat: CodePanel split pane with Run button and terminal"
```

---

## Task 13: PreviewPanel Console Interceptor

**Files:**
- Modify: `src/components/PreviewPanel.tsx`

- [ ] **Step 1: Read current PreviewPanel.tsx**

Read `src/components/PreviewPanel.tsx` to understand how HTML is rendered in the iframe.

- [ ] **Step 2: Add console interceptor injection**

The interceptor script must be prepended to the HTML content before it's loaded into the iframe. Find where `srcDoc` is set and modify it:

```ts
const CONSOLE_INTERCEPTOR = `<script>
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
</script>`;

// In the component, before setting srcDoc:
const injectedHtml = htmlContent
  ? htmlContent.replace(/(<head[^>]*>)/i, `$1\n${CONSOLE_INTERCEPTOR}`)
      // fallback if no <head> tag
    || CONSOLE_INTERCEPTOR + htmlContent
  : '';
```

- [ ] **Step 3: Add PostMessage listener**

In `PreviewPanel.tsx` (or `App.tsx` if better scoped), add a `useEffect` that listens for PostMessage events from the iframe and writes them to the terminal:

```tsx
useEffect(() => {
  const handler = (e: MessageEvent) => {
    if (e.data?.type !== 'console') return;
    const { level, text } = e.data;
    const colors: Record<string, string> = {
      error: '\x1b[31m',   // red
      warn:  '\x1b[33m',   // yellow
      info:  '\x1b[36m',   // cyan
      log:   '\x1b[37m',   // white
      debug: '\x1b[90m',   // grey
    };
    const color = colors[level] ?? '\x1b[37m';
    const reset = '\x1b[0m';
    writeRef.current?.(`${color}[${level}] ${text}${reset}\r\n`);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}, [writeRef]);
```

Pass `writeRef` down from the parent that owns `useExecution`.

- [ ] **Step 4: Verify console interception**

Generate an HTML app with `console.log("hello from iframe")`. Click Run (which triggers a preview refresh). Confirm "hello from iframe" appears in the TerminalPane.

- [ ] **Step 5: Commit**

```bash
git add src/components/PreviewPanel.tsx
git commit -m "feat: iframe console interceptor → TerminalPane"
```

---

## Task 14: StatusBar Component

**Files:**
- Create: `src/components/StatusBar.tsx`
- Modify: `src/App.tsx` or `src/components/CodePanel.tsx`

- [ ] **Step 1: Create StatusBar**

Create `src/components/StatusBar.tsx`:

```tsx
import React from 'react';
import type { ExecutionStatus, AutoFixStatus } from '../types';

interface Props {
  execStatus: ExecutionStatus;
  exitCode: number | null;
  autoFixStatus: AutoFixStatus;
  autoFixAttempt: number;
  autoFixMax: number;
  lastMessage: string;
}

function getMessage({
  execStatus, exitCode, autoFixStatus, autoFixAttempt, autoFixMax, lastMessage,
}: Props): { text: string; color: string } {
  if (autoFixStatus === 'fixing') {
    return {
      text:  `Fixing error… (attempt ${autoFixAttempt}/${autoFixMax})`,
      color: '#f59e0b',
    };
  }
  if (autoFixStatus === 'success') {
    return { text: '✓ Fixed! App is running.', color: '#7fff7f' };
  }
  if (autoFixStatus === 'failed') {
    return { text: lastMessage || 'Could not fix automatically. Try rephrasing your prompt.', color: '#ff7f7f' };
  }
  if (execStatus === 'running') {
    return { text: 'Running…', color: '#00C4AA' };
  }
  if (execStatus === 'exited') {
    if (exitCode === 0) return { text: '✓ Finished successfully.', color: '#7fff7f' };
    return { text: 'Something went wrong — checking if I can fix it automatically…', color: '#f59e0b' };
  }
  if (lastMessage) return { text: lastMessage, color: '#aaa' };
  return { text: '', color: '#aaa' };
}

export function StatusBar(props: Props) {
  const { text, color } = getMessage(props);
  if (!text) return null;
  return (
    <div className="status-bar" style={{ color }}>
      {text}
    </div>
  );
}
```

- [ ] **Step 2: Add StatusBar CSS**

Append to `src/index.css`:

```css
/* ── StatusBar ──────────────────────────────────────────────── */
.status-bar {
  padding: 5px 14px;
  font-size: 11px;
  font-family: inherit;
  background: #0d0d18;
  border-bottom: 1px solid #1a1a2e;
  min-height: 26px;
  display: flex;
  align-items: center;
  transition: color 0.3s;
}
```

- [ ] **Step 3: Wire StatusBar above TerminalPane in CodePanel**

In `CodePanel.tsx`, import and render StatusBar between the code editor and the resize handle:

```tsx
import { StatusBar } from './StatusBar';

// In JSX, above the resize-handle div:
<StatusBar
  execStatus={execState.status}
  exitCode={execState.exitCode}
  autoFixStatus={autoFixState.status}
  autoFixAttempt={autoFixState.attempt}
  autoFixMax={autoFixState.maxAttempts}
  lastMessage={autoFixState.lastError}
/>
```

(autoFixState comes from Task 15 — pass `{ status: 'idle', attempt: 0, maxAttempts: 5, lastError: '' }` as placeholder for now.)

- [ ] **Step 4: Commit**

```bash
git add src/components/StatusBar.tsx src/index.css src/components/CodePanel.tsx
git commit -m "feat: StatusBar plain-English status messages"
```

---

## Task 15: useAutoFix Hook (AI Fix Loop)

**Files:**
- Create: `src/hooks/useAutoFix.ts`

- [ ] **Step 1: Write the test**

Create `src/hooks/useAutoFix.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildFixPrompt } from './useAutoFix';

describe('buildFixPrompt', () => {
  it('includes error output', () => {
    const p = buildFixPrompt('print("hi")', 'script.py', 'NameError: name x not defined');
    expect(p).toContain('NameError');
    expect(p).toContain('script.py');
  });

  it('includes the original code', () => {
    const p = buildFixPrompt('let x = 1', 'app.js', 'SyntaxError');
    expect(p).toContain('let x = 1');
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
npx vitest run src/hooks/useAutoFix.test.ts
```

- [ ] **Step 3: Implement useAutoFix**

Create `src/hooks/useAutoFix.ts`:

```ts
import { useState, useCallback, useRef } from 'react';
import type { AutoFixState, LLMProvider } from '../types';

const MAX_ATTEMPTS = 5;

export function buildFixPrompt(code: string, filePath: string, errorOutput: string): string {
  return `The file "${filePath}" was executed and produced this error:

\`\`\`
${errorOutput.slice(0, 3000)}
\`\`\`

The current code is:

\`\`\`
${code.slice(0, 8000)}
\`\`\`

Fix the code so it runs without errors. Output only the corrected file using the same <forge-file> format. Do not add any explanation before or after the file tag.`;
}

/** Parse the first <forge-file> content from a streamed AI response. */
function extractFixedContent(rawResponse: string): string | null {
  const match = rawResponse.match(/<forge-file[^>]*>([\s\S]*?)<\/forge-file>/);
  return match ? match[1].trim() : null;
}

interface RunFn {
  (filePath: string, content: string): void;
}

interface UpdateFileFn {
  (filePath: string, newContent: string): void;
}

export function useAutoFix(llmConfig: LLMProvider, runFn: RunFn, updateFileFn: UpdateFileFn) {
  const [state, setState] = useState<AutoFixState>({
    status:      'idle',
    attempt:     0,
    maxAttempts: MAX_ATTEMPTS,
    lastError:   '',
  });

  const abortRef = useRef(false);

  const attemptFix = useCallback(async (
    filePath:    string,
    fileContent: string,
    errorOutput: string,
  ) => {
    abortRef.current = false;
    let attempt = 0;
    let currentContent = fileContent;

    while (attempt < MAX_ATTEMPTS) {
      if (abortRef.current) break;
      attempt++;

      setState({ status: 'fixing', attempt, maxAttempts: MAX_ATTEMPTS, lastError: errorOutput });

      const prompt = buildFixPrompt(currentContent, filePath, errorOutput);
      let rawResponse = '';

      try {
        const res = await fetch('/api/generate', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            messages:  [{ role: 'user', content: prompt }],
            llmConfig,
          }),
        });

        const reader = res.body!.getReader();
        const dec    = new TextDecoder();
        let   buf    = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const p = line.slice(6).trim();
            if (p === '[DONE]') break;
            try {
              const parsed = JSON.parse(p);
              if (parsed.text) rawResponse += parsed.text;
              if (parsed.error) throw new Error(parsed.error);
            } catch { /* partial json */ }
          }
        }
      } catch (e) {
        setState({ status: 'failed', attempt, maxAttempts: MAX_ATTEMPTS, lastError: String(e) });
        return;
      }

      const fixedContent = extractFixedContent(rawResponse);
      if (!fixedContent) {
        setState({
          status:      'failed',
          attempt,
          maxAttempts: MAX_ATTEMPTS,
          lastError:   'AI could not produce a fixed version. Try rephrasing your original prompt.',
        });
        return;
      }

      currentContent = fixedContent;
      updateFileFn(filePath, fixedContent);

      // Re-run and wait for result — this is handled externally
      // The parent component calls attemptFix again if the new run fails
      setState({ status: 'success', attempt, maxAttempts: MAX_ATTEMPTS, lastError: '' });
      runFn(filePath, fixedContent);
      return;
    }

    setState({
      status:      'failed',
      attempt,
      maxAttempts: MAX_ATTEMPTS,
      lastError:   `I tried ${MAX_ATTEMPTS} times but couldn't fix this. The error is: ${errorOutput.slice(0, 300)}`,
    });
  }, [llmConfig, runFn, updateFileFn]);

  const cancel = useCallback(() => {
    abortRef.current = true;
    setState(s => ({ ...s, status: 'idle' }));
  }, []);

  const reset = useCallback(() => {
    setState({ status: 'idle', attempt: 0, maxAttempts: MAX_ATTEMPTS, lastError: '' });
  }, []);

  return { state, attemptFix, cancel, reset };
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run src/hooks/useAutoFix.test.ts
```

- [ ] **Step 5: Wire useAutoFix into CodePanel**

In `CodePanel.tsx`, import and connect `useAutoFix`:

```tsx
import { useAutoFix } from '../hooks/useAutoFix';

// Inside component (llmConfig comes from props or context):
const { state: autoFixState, attemptFix, reset: resetFix } = useAutoFix(
  llmConfig,
  run,            // from useExecution
  updateFileContent, // function that updates file content in project state
);

// When execState changes to 'exited' with non-zero exitCode, trigger auto-fix:
useEffect(() => {
  if (execState.status === 'exited' && execState.exitCode !== 0 && execState.exitCode !== null) {
    const file = project.files.find(f => f.path === activeFile);
    if (file && terminalOutputRef.current) {
      attemptFix(file.path, file.content, terminalOutputRef.current);
    }
  }
}, [execState.status, execState.exitCode]);
```

Also accumulate terminal output into `terminalOutputRef`:

```tsx
const terminalOutputRef = useRef('');

// In useExecution writeRef callback — wrap it to also accumulate:
// When run() is called, reset: terminalOutputRef.current = '';
// In the writeRef, after writing to terminal: terminalOutputRef.current += data;
```

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useAutoFix.ts src/hooks/useAutoFix.test.ts src/components/CodePanel.tsx
git commit -m "feat: useAutoFix hook — AI error loop up to 5 attempts"
```

---

## Task 16: Package Manager MCP

**Files:**
- Create: `server/mcp/packages.mjs`
- Modify: `server/index.mjs`

- [ ] **Step 1: Create MCP directory**

```bash
mkdir -p /c/Lovable/server/mcp
```

- [ ] **Step 2: Implement install_packages tool**

Create `server/mcp/packages.mjs`:

```js
import { spawn } from 'child_process';

const MANAGER_COMMANDS = {
  npm:   ['npm', 'install'],
  pip:   ['pip', 'install'],
  pip3:  ['pip3', 'install'],
  cargo: ['cargo', 'add'],
  gem:   ['gem', 'install'],
  go:    ['go', 'get'],
};

/**
 * Installs packages using the given package manager.
 * Returns a promise resolving to { success, output }.
 */
export async function installPackages({ manager, packages, cwd, onData }) {
  const cmds = MANAGER_COMMANDS[manager];
  if (!cmds) {
    return { success: false, output: `Unknown package manager: ${manager}` };
  }

  const [cmd, ...baseArgs] = cmds;
  const args = [...baseArgs, ...packages];

  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, env: process.env, shell: true });
    let output = '';

    proc.stdout.on('data', d => { const s = d.toString(); output += s; onData?.(s); });
    proc.stderr.on('data', d => { const s = d.toString(); output += s; onData?.(s); });

    proc.on('close', (code) => {
      resolve({ success: code === 0, output });
    });

    proc.on('error', (err) => {
      resolve({ success: false, output: `${cmd} not found: ${err.message}` });
    });
  });
}

/** MCP tool definition for passing to LLM providers. */
export const INSTALL_PACKAGES_TOOL = {
  name:        'install_packages',
  description: 'Install missing packages for the current project',
  input_schema: {
    type:       'object',
    properties: {
      manager:  { type: 'string', enum: ['npm', 'pip', 'pip3', 'cargo', 'gem', 'go'] },
      packages: { type: 'array', items: { type: 'string' } },
    },
    required: ['manager', 'packages'],
  },
};
```

- [ ] **Step 3: Add /api/install-packages endpoint to server/index.mjs**

```js
import { installPackages } from './mcp/packages.mjs';

app.post('/api/install-packages', async (req, res) => {
  const { manager, packages, projectId } = req.body;
  if (!manager || !packages?.length || !projectId) {
    return res.status(400).json({ error: 'manager, packages, and projectId required' });
  }

  const cwd = projectDir(safeId(projectId));
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const { success, output } = await installPackages({
    manager, packages, cwd,
    onData: (chunk) => res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`),
  });

  res.write(`data: ${JSON.stringify({ done: true, success })}\n\n`);
  res.end();
});
```

- [ ] **Step 4: Verify endpoint**

```bash
cd /c/Lovable
npm run dev
```

In a separate terminal:

```bash
curl -X POST http://localhost:3001/api/install-packages \
  -H "Content-Type: application/json" \
  -d '{"manager":"npm","packages":["lodash"],"projectId":"test"}'
```

Expected: streaming output from npm install.

- [ ] **Step 5: Commit**

```bash
git add server/mcp/packages.mjs server/index.mjs
git commit -m "feat: Package Manager MCP — install_packages endpoint"
```

---

## Task 17: Auto-Run on Generation Complete

**Files:**
- Modify: `src/hooks/useProject.ts`
- Modify: `src/App.tsx` (or wherever generation completion is handled)

- [ ] **Step 1: Read the generation completion flow**

Read `src/hooks/useProject.ts` to find where generation finishes (where the `[DONE]` SSE event is handled and files are saved).

- [ ] **Step 2: Add auto-run setting to LLM config**

In `useProject.ts`, add `autoRun: boolean` to the config stored in localStorage (default: `true`).

In `ProviderSettings.tsx`, add the toggle:

```tsx
<label className="setting-label setting-row">
  <input
    type="checkbox"
    checked={config.autoRun ?? true}
    onChange={(e) => update({ autoRun: e.target.checked })}
  />
  Auto-run code after generation
</label>
```

- [ ] **Step 3: Trigger auto-run after generation completes**

In `useProject.ts` (or wherever the SSE `[DONE]` is processed), after files are saved, call the run function if auto-run is enabled:

```ts
// After generation finishes and files are saved:
if (llmConfig.autoRun !== false && generatedFiles.length > 0) {
  const entryFile = detectEntryPointFromFiles(generatedFiles.map(f => f.path));
  if (entryFile) {
    const file = generatedFiles.find(f => f.path === entryFile);
    if (file) {
      onAutoRun?.(file.path, file.content); // callback to CodePanel's run()
    }
  }
}
```

`detectEntryPointFromFiles` uses the same priority list as `server/lang.mjs:detectEntryPoint` — duplicate the logic in a small frontend utility:

```ts
// src/lib/entryPoint.ts
const ENTRY_PRIORITY = [
  'main.py','app.py','index.py',
  'index.js','server.js','app.js','main.js',
  'main.ts','index.ts','server.ts','app.ts',
  'main.go','main.rs','main.rb',
];

export function detectEntryPointFromFiles(filePaths: string[]): string | null {
  if (!filePaths.length) return null;
  if (filePaths.length === 1) return filePaths[0];
  for (const name of ENTRY_PRIORITY) {
    const match = filePaths.find(f => f.split('/').pop() === name);
    if (match) return match;
  }
  return filePaths[filePaths.length - 1];
}
```

- [ ] **Step 4: Verify end-to-end**

```bash
npm run dev
```

Generate a Python script ("write a python script that prints the numbers 1 to 10"). Confirm:
1. Code generates in the chat
2. Terminal expands automatically
3. Script runs and prints 1–10
4. StatusBar shows "✓ Finished successfully"
5. If the script has an error (try intentionally), auto-fix loop starts

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useProject.ts src/lib/entryPoint.ts src/components/ProviderSettings.tsx
git commit -m "feat: auto-run on generation complete with entry point detection"
```

---

## Task 18: End-to-End Verification

This task verifies the entire Phase 1 system works together.

- [ ] **Step 1: Run all tests**

```bash
cd /c/Lovable
npx vitest run
cd server
node --test lang.test.mjs execution.test.mjs providers/openai.test.mjs providers/gemini.test.mjs
```

Expected: all tests pass. Fix any failures before proceeding.

- [ ] **Step 2: Test Python execution**

Start app with `npm run dev`. Generate: "write a python script that uses requests to fetch https://httpbin.org/json and print the result".

Verify:
- Script generates
- Auto-run triggers
- If `requests` not installed, Package Manager MCP installs it
- Script runs and prints JSON output
- StatusBar shows success

- [ ] **Step 3: Test Node.js execution**

Generate: "write a node.js script that reads a file called data.txt and counts the words". 

Verify terminal shows the execution. If `data.txt` is missing, verify the error appears in terminal and the AI fix loop tries to fix it.

- [ ] **Step 4: Test HTML console capture**

Generate: "build a simple counter web app with a button". 

Switch to Preview. Add a `console.log` to the source. Click Run. Verify console output appears in the TerminalPane.

- [ ] **Step 5: Test multi-LLM switch**

Open Settings. Switch provider to Ollama (if Ollama is installed locally). Test connection. Generate a simple app. Verify streaming works.

- [ ] **Step 6: Test auto-fix loop**

Modify a generated Python file to introduce a syntax error (`print "hello"` in Python 3). Click Run. Verify:
- Error appears in terminal
- StatusBar shows "Fixing error… (attempt 1/5)"
- AI generates a fix
- Fixed code runs successfully
- StatusBar shows "✓ Fixed!"

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: Phase 1 complete — sandbox, AI loop, multi-LLM, package manager MCP"
```

---

## File Map Summary

| File | Status | Purpose |
|------|--------|---------|
| `server/lang.mjs` | New | Language → runtime detection |
| `server/execution.mjs` | New | PTY process management |
| `server/providers/anthropic.mjs` | New (refactored) | Anthropic Claude streaming |
| `server/providers/openai.mjs` | New | OpenAI / Ollama / LM Studio / custom |
| `server/providers/gemini.mjs` | New | Google Gemini streaming |
| `server/providers/index.mjs` | New | Provider factory |
| `server/mcp/packages.mjs` | New | Package installer MCP tool |
| `server/index.mjs` | Modified | WebSocket server + use provider factory |
| `src/types.ts` | Modified | ExecutionState, WsMessage, LLMProvider, AutoFixState |
| `src/hooks/useExecution.ts` | New | WebSocket + terminal state |
| `src/hooks/useAutoFix.ts` | New | AI error loop |
| `src/lib/entryPoint.ts` | New | Entry point detection |
| `src/components/TerminalPane.tsx` | New | xterm.js terminal UI |
| `src/components/StatusBar.tsx` | New | Plain-English status messages |
| `src/components/ProviderSettings.tsx` | New | Multi-LLM settings UI |
| `src/components/CodePanel.tsx` | Modified | Split pane + Run button |
| `src/components/PreviewPanel.tsx` | Modified | Console interceptor injection |
| `src/components/Header.tsx` | Modified | Wire ProviderSettings |
| `src/hooks/useProject.ts` | Modified | Auto-run + provider config |
| `src/index.css` | Modified | Terminal, Run button, StatusBar styles |
| `vitest.config.ts` | New | Vitest test configuration |
