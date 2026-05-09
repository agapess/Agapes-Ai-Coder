# FORGE Superapp — Full Design Spec

**Date:** 2026-05-09
**Status:** Approved
**Audience:** Non-technical users + power users
**Vision:** Write a prompt → AI builds, runs, fixes, and deploys your app. Everything handled by AI.

---

## Overview

FORGE becomes a zero-friction AI app builder for anyone — no coding knowledge required. Users describe what they want, and FORGE handles everything: generating code, installing dependencies, running it, fixing errors, and deploying to the web. Power users get full terminal access, multi-LLM switching, and multi-agent builds.

The project ships in 5 phases, each independently usable and building on the last.

---

## Phase 1 — Sandbox + AI Loop + Multi-LLM

**Goal:** Code runs automatically, errors fix themselves, works with any LLM.

### 1.1 Code Execution Sandbox

**Architecture:**
- `node-pty` spawns real processes on the server (Python, Node, Bash, Go, Rust, etc.)
- `ws` library adds a WebSocket server at `/terminal` on the existing Express server
- `xterm.js` + `xterm-addon-fit` render a full terminal in the browser
- Full bidirectional I/O: stdin, stdout, stderr, ANSI colors

**UI — Split Pane:**
- `CodePanel.tsx` gains a resizable vertical split: code editor top, `TerminalPane` bottom
- Drag handle between halves; terminal collapses to zero when not in use
- First run auto-expands terminal to 35% of panel height
- Run button in file tab bar (right side) shows detected language: `▶ Run (python)`
- Greyed out with tooltip for unsupported types (`.css`, `.md`, `.json`)

**`TerminalPane.tsx` (new component):**
- xterm.js Terminal instance, auto-resizes with `fit` addon
- Header: command string, exit badge (green `exit 0` / red `exit 1`), Stop, Clear buttons
- WebSocket client — connects on run, closes on exit/stop/unmount

**`useExecution.ts` (new hook):**
- State machine: `idle → running → exited`
- Language detection from file extension
- WebSocket lifecycle management
- For HTML files: skips WebSocket, injects console interceptor into iframe instead

**Web files (HTML/CSS/JS):**
- Console interceptor script prepended to HTML before iframe render
- Overrides `console.log/warn/error`, `window.onerror`, `unhandledrejection`
- PostMessages all events to parent → displayed in TerminalPane
- Preview iframe and terminal output coexist

**Language → Runtime Map:**

| Extension | Runtime | Notes |
|-----------|---------|-------|
| `.py` | `python` / `python3` | Checks both, uses whichever exists |
| `.js` `.mjs` | `node` | |
| `.ts` | `npx ts-node` | Error if not installed |
| `.sh` `.bash` | `bash` | Windows: requires WSL or Git Bash |
| `.sql` | `sqlite3` | In-memory DB |
| `.rb` | `ruby` | |
| `.go` | `go run` | |
| `.rs` | `cargo run` | Requires Cargo.toml in project dir |
| `.php` | `php` | |
| `.html` `.htm` | (iframe + PostMessage) | Console capture only |
| `.css` `.json` `.md` | (disabled) | Run button greyed out |

**WebSocket Protocol:**

Client → Server:
```json
{"type":"start","file":"script.py","content":"...","lang":"python","cwd":"/projects/abc"}
{"type":"input","data":"hello\n"}
{"type":"kill"}
{"type":"resize","cols":80,"rows":24}
```

Server → Client:
```json
{"type":"output","data":"Got 42 records\r\n"}
{"type":"exit","code":0}
{"type":"error","message":"python not found — install Python and ensure it's in PATH"}
```

**Error Handling:**

| Scenario | Behaviour |
|----------|-----------|
| Runtime not installed | Red error in terminal, exit 127 |
| Process timeout (60s) | Auto-kill, `"Process timed out after 60s"` shown |
| WebSocket fails | `"Could not connect to execution server"` |
| File write fails | OS error shown, no process spawned |
| Non-zero exit | Red `exit N` badge, stderr already streamed |
| HTML JS error | Red stack trace in TerminalPane |

---

### 1.2 AI Auto-Fix Loop

After execution, if the exit code is non-zero, FORGE automatically:

1. Captures the full terminal output (stdout + stderr)
2. Sends it back to the active LLM with the original code and a fix prompt
3. LLM generates fixed code
4. FORGE applies the fix, saves the file, re-runs
5. Repeats up to **5 iterations** (configurable)
6. Stops when exit code is 0 or max iterations reached

**Loop prompt template (injected into system context):**
```
The following code was executed and produced this error output. Fix the code so it runs correctly.
Do not explain — just output the corrected file(s) using the same <forge-file> format.
Error output: {stderr}
```

**UI during loop:**
- Chat panel shows animated status: `"Fixing error... (attempt 2/5)"`
- Each fix attempt creates a new message in chat history (collapsible)
- If loop exhausts all attempts: plain-English explanation of what's wrong

**Auto-run on generate:**
- Default ON: code runs automatically when generation completes
- Toggle in settings: "Auto-run generated code"
- Entry point detection order: single file → run it; multiple files → prefer `main.py`, `index.js`, `app.py`, `server.js`, `main.go`, `main.rs` → fallback to most recently written file

---

### 1.3 Plain-English Explainer

Every significant event produces a friendly status message visible above the terminal:

| Event | Message shown |
|-------|--------------|
| Generation complete | "I built your app! Running it now…" |
| Run success | "✓ Your app is running. Here's what it does: [1-line summary]" |
| Error detected | "Something went wrong — I'm fixing it automatically." |
| Fix applied | "I found the issue ([brief reason]) and fixed it. Trying again…" |
| All fixes failed | "I tried 5 times but couldn't fix this. Here's what's happening: [plain English explanation]" |
| Runtime missing | "Python isn't installed on this machine. [Link to install guide]" |
| Package missing | "Installing missing packages… this takes a moment." |

These messages appear in a status bar above the terminal pane, separate from raw output.

---

### 1.4 Package Manager MCP

An MCP tool the AI can call during the build/fix loop to install missing dependencies.

**MCP tool: `install_packages`**
```json
{
  "name": "install_packages",
  "description": "Install missing packages for the current project",
  "input_schema": {
    "manager": "npm | pip | cargo | gem | go",
    "packages": ["requests", "flask"]
  }
}
```

**Behaviour:**
- Runs the install command in the project directory via PTY (shows real output in terminal)
- On success, re-triggers execution
- Integrated into the AI fix loop: if error mentions missing module, AI calls this tool first before rewriting code

**MCP server location:** `server/mcp/packages.mjs`

---

### 1.5 Full Multi-LLM Support

Unified provider abstraction supporting all major LLMs from a single settings panel.

**Providers:**

| Provider | SDK / Method | Notes |
|----------|-------------|-------|
| Anthropic Claude | `@anthropic-ai/sdk` | Already implemented |
| OpenAI (GPT-4o, o1, etc.) | `openai` npm package | New |
| Google Gemini | `@google/generative-ai` | New |
| Ollama | OpenAI-compatible endpoint | `localhost:11434/v1` |
| LM Studio | OpenAI-compatible endpoint | Already partially implemented |
| Any OpenAI-compatible API | Custom base URL + key | OpenRouter, Together, Groq, etc. |

**Architecture — `server/providers/` directory:**

```
server/providers/
  index.mjs          — unified provider factory
  anthropic.mjs      — Anthropic Claude (existing, refactored)
  openai.mjs         — OpenAI + any OAI-compatible
  gemini.mjs         — Google Gemini
```

**Unified interface** (all providers implement):
```js
{
  stream(messages, systemPrompt, onChunk, onDone),
  listModels(),        // returns available models for this provider
  validateKey()        // tests the connection
}
```

**Settings UI — Provider Panel:**
- Provider selector: Claude / OpenAI / Gemini / Ollama / LM Studio / Custom
- Model dropdown (populated by `listModels()`)
- API key field (masked)
- Base URL field (shown for Ollama, LM Studio, Custom)
- "Test Connection" button
- Per-project model override (stored in `.forge/project.json`)

**Streaming normalisation:**
- All providers stream tokens. Anthropic uses its own SSE format; OpenAI/Gemini/Ollama all use the OpenAI streaming format. The provider abstraction normalises all to a single `onChunk(text)` callback.

---

## Phase 2 — AI Intelligence Layer

### 2.1 AI Project Planner

Before generating code, FORGE shows a planning step:

**Flow:**
1. User submits prompt
2. AI generates a brief plan (not code): what it will build, what files, what technologies
3. Plan shown in chat as a structured card (not a wall of text)
4. User sees: "Does this sound right? [Yes, build it] [No, let me change something]"
5. On confirm → generation starts; on change → user refines prompt

**Plan card format:**
```
Building: A weather dashboard
Files: index.html, style.css, app.js
Uses: OpenWeatherMap API, Chart.js
Features: current temp, 5-day forecast, city search
```

**Toggle:** "Skip planning step" in settings for power users who want instant generation.

---

### 2.2 AI Auto-Tester

After successful execution, AI generates and runs a test suite:

- For Python: generates `pytest` tests, runs them
- For Node.js: generates `jest` or built-in `node:test` tests
- For web apps: generates Playwright E2E tests (if Phase 3 is active)
- Shows result badge: `✓ 8/8 tests passed` or `✗ 3/8 tests failed`
- Failed tests feed back into the AI fix loop automatically

**MCP tool: `run_tests`**
```json
{
  "name": "run_tests",
  "description": "Run the test suite for the current project",
  "input_schema": { "framework": "pytest | jest | node:test | playwright" }
}
```

---

### 2.3 Web Search MCP

Gives the AI real-time web access during code generation.

**MCP tool: `web_search`**
```json
{
  "name": "web_search",
  "description": "Search the web for documentation, API references, or package info",
  "input_schema": { "query": "string", "max_results": 5 }
}
```

**Implementation:** Uses Brave Search API (free tier available) or DuckDuckGo scraping as fallback.

**When AI uses it:** Before writing code that uses an external API or library, AI searches for the current correct syntax. Eliminates hallucinated package names and outdated API calls.

---

### 2.4 Version Time Travel

Every successful run (exit code 0) creates an automatic snapshot.

**Storage:** Snapshots saved to `.forge/snapshots/{timestamp}/` — full copy of all project files.

**UI:** Timeline slider in the CodePanel header. Hover shows timestamp + first line of the prompt that produced it. Click to restore.

**MCP tool: `snapshot`**
```json
{
  "name": "snapshot",
  "description": "Save a named snapshot of the current project state",
  "input_schema": { "label": "string" }
}
```

---

## Phase 3 — Input Superpowers

### 3.1 Voice-to-App

- Microphone button in the chat input bar
- Uses Web Speech API (`SpeechRecognition`) — no external service, no cost
- Transcription streams into the prompt input field in real-time
- User can edit before submitting, or just say "go" to trigger generation
- Fallback: if Web Speech API unavailable, show install link for browser

---

### 3.2 Screenshot / Image-to-App

- Paperclip / image upload button in chat input
- Accepts PNG, JPG, WebP — dragged in or pasted from clipboard
- Image sent to AI alongside the text prompt using vision capability
- AI analyzes design, colors, layout, components and generates matching code
- Works with Claude (built-in vision), GPT-4o (vision), Gemini (vision)
- For providers without vision: show clear message "Switch to Claude or GPT-4o for image support"

---

### 3.3 URL Clone

- URL input field in a new "Clone" tab of the chat panel
- Backend fetches the URL, extracts HTML/CSS/JS (respects robots.txt)
- Extracted content sent to AI: "Recreate this app design and functionality"
- AI rebuilds from scratch as clean, editable FORGE project files
- Not a copy-paste scraper — AI genuinely rebuilds with understanding

**Backend endpoint:** `POST /api/clone` — fetches URL, strips trackers/analytics, returns cleaned content.

---

### 3.4 Playwright MCP (Browser Testing)

AI-controlled browser for testing generated web apps.

**MCP tool: `browser_test`**
```json
{
  "name": "browser_test",
  "description": "Test the running web app in a real browser",
  "input_schema": {
    "url": "http://localhost:...",
    "actions": [
      {"type": "click", "selector": "#submit-btn"},
      {"type": "fill", "selector": "#name", "value": "Alice"},
      {"type": "assert_text", "selector": ".result", "expected": "Hello, Alice"}
    ]
  }
}
```

**Implementation:** `playwright` npm package, headless Chromium. AI generates test actions based on the app's HTML structure.

---

## Phase 4 — Share & Deploy

### 4.1 One-Click Deploy

**Supported targets:** Vercel (web apps), Railway (backend/full-stack), Netlify (static).

**Flow:**
1. User clicks "Deploy" button in header
2. FORGE prompts for deploy target (Vercel / Netlify / Railway) if not already set
3. User provides their own API token for the chosen platform (stored locally in settings, never sent anywhere)
4. FORGE packages the project and runs the platform's deploy CLI in a child process
5. Returns public URL shown as a clickable card: "Your app is live at https://..."

**Backend:** `POST /api/deploy` — accepts project ID + target + token, runs deploy CLI in child process.

---

### 4.2 App Gallery & Templates

**Gallery page** (new route in the SPA):
- Grid of template cards: Todo App, Dashboard, Landing Page, API, Python Script, etc.
- One-click fork: creates new project pre-populated with template files
- "Publish" button on any project: submits to the gallery with a screenshot auto-generated via Playwright

**Storage:** Gallery metadata in `gallery/` directory (local for Phase 4; could move to cloud later).

---

### 4.3 Export as Desktop App / PWA

**PWA export:**
- Generates `manifest.json` + service worker
- Adds install prompt to the running preview
- User can install from browser "Add to Home Screen"

**Electron export:**
- `POST /api/export/electron` — runs `electron-builder` on the project
- Produces `.exe` (Windows), `.dmg` (Mac), `.AppImage` (Linux)
- Download link shown in chat when build completes

---

### 4.4 GitHub MCP

**MCP tool: `github_push`**
```json
{
  "name": "github_push",
  "description": "Push the project to a new or existing GitHub repository",
  "input_schema": {
    "repo_name": "string",
    "private": true,
    "token": "ghp_..."
  }
}
```

**Flow:** AI writes a README first (using the project's chat history as context), then pushes all files. User provides their GitHub personal access token once in settings; it's stored locally.

---

## Phase 5 — Advanced Power

### 5.1 Multi-Agent Build

For complex projects, FORGE spawns parallel agent sessions:

- **Orchestrator agent** — decomposes the project into independent parts
- **Worker agents** — each handles one part (frontend, backend, database schema, tests)
- All use the same `useExecution` + WebSocket infrastructure
- Results merged by orchestrator into a single coherent project
- UI: agent panel showing each worker's status and output in real-time

**Implementation:** Multiple concurrent `/api/generate` SSE streams, coordinated by an orchestrator prompt that defines boundaries and interfaces between parts.

---

### 5.2 Live Collaboration

Real-time multi-user sessions via WebSocket.

- Host generates a session link: `forge://session/{id}`
- Guests join and see the same chat, code, and terminal output
- All users can type prompts; messages attributed by name/color
- Uses existing WebSocket infrastructure, extended with a broadcast room model
- **Not** a conflict-resolution system — last prompt wins; designed for teaching, not team coding

---

## MCP Architecture

All MCPs are hosted as a local MCP server running alongside the Express backend.

**`server/mcp/index.mjs`** — MCP server entry point, registers all tools.

**Tool registry:**

| Tool | Phase | File |
|------|-------|------|
| `install_packages` | 1 | `server/mcp/packages.mjs` |
| `run_tests` | 2 | `server/mcp/tests.mjs` |
| `web_search` | 2 | `server/mcp/search.mjs` |
| `snapshot` | 2 | `server/mcp/snapshot.mjs` |
| `browser_test` | 3 | `server/mcp/playwright.mjs` |
| `github_push` | 4 | `server/mcp/github.mjs` |

Claude communicates with MCP tools via the Anthropic tool-use API. For non-Anthropic providers, the same tools are passed as OpenAI-compatible function definitions.

---

## File Structure (full, post all phases)

```
/c/Lovable/
├── src/
│   ├── components/
│   │   ├── Header.tsx              — add Deploy button, Agent panel toggle
│   │   ├── Sidebar.tsx             — add Gallery tab, Snapshots list
│   │   ├── ChatPanel.tsx           — add Voice btn, Image upload, Plan card, Status bar
│   │   ├── CodePanel.tsx           — add split layout, Run button, resize handle
│   │   ├── TerminalPane.tsx        — NEW: xterm.js + WebSocket client
│   │   ├── PreviewPanel.tsx        — add console interceptor injection
│   │   ├── ProviderSettings.tsx    — NEW: multi-LLM settings panel
│   │   ├── PlanCard.tsx            — NEW: AI project plan confirmation card
│   │   ├── StatusBar.tsx           — NEW: plain-English status messages
│   │   ├── GalleryPage.tsx         — NEW: app gallery + templates
│   │   ├── AgentPanel.tsx          — NEW: multi-agent status (Phase 5)
│   │   └── CollabBar.tsx           — NEW: collaboration session bar (Phase 5)
│   ├── hooks/
│   │   ├── useProject.ts           — existing, minor updates
│   │   ├── useExecution.ts         — NEW: sandbox execution state
│   │   ├── useAutoFix.ts           — NEW: AI fix loop
│   │   └── useCollaboration.ts     — NEW: Phase 5
│   ├── providers/
│   │   └── llm.ts                  — NEW: frontend provider config + types
│   └── types.ts                    — add ExecutionState, WsMessage, Snapshot, Provider
├── server/
│   ├── index.mjs                   — add WS server, MCP integration
│   ├── execution.mjs               — NEW: ExecutionManager + language map
│   ├── providers/
│   │   ├── index.mjs               — unified provider factory
│   │   ├── anthropic.mjs           — refactored from index.mjs
│   │   ├── openai.mjs              — NEW
│   │   └── gemini.mjs              — NEW
│   ├── mcp/
│   │   ├── index.mjs               — MCP server
│   │   ├── packages.mjs            — install_packages tool
│   │   ├── tests.mjs               — run_tests tool
│   │   ├── search.mjs              — web_search tool
│   │   ├── snapshot.mjs            — snapshot tool
│   │   ├── playwright.mjs          — browser_test tool
│   │   └── github.mjs              — github_push tool
│   └── package.json                — add ws, node-pty, openai, @google/generative-ai, playwright, ws
├── docs/superpowers/specs/
│   ├── 2026-05-09-sandbox-phase1-design.md   — original Phase 1 spec (superseded)
│   └── 2026-05-09-forge-superapp-design.md   — THIS FILE
└── gallery/                        — local gallery metadata (Phase 4)
```

---

## New Dependencies

**Frontend:**
- `xterm` + `xterm-addon-fit` — terminal emulator
- (No other frontend deps — voice uses Web Speech API, image uses native `<input type=file>`)

**Backend:**
- `ws` — WebSocket server
- `node-pty` — PTY process spawning (requires native build tools on Windows)
- `openai` — OpenAI + OAI-compatible providers
- `@google/generative-ai` — Google Gemini
- `playwright` — browser testing MCP (Phase 3)

---

## Non-Technical UX Principles

These apply across all phases:

1. **No jargon in user-facing text.** "Something went wrong" not "Process exited with SIGKILL."
2. **AI explains every action.** Status bar always shows what's happening and why.
3. **Auto everything.** Auto-run, auto-fix, auto-install. Defaults are hands-off.
4. **Progressive disclosure.** Raw terminal, file tree, and advanced settings are hidden until needed.
5. **Plain-English errors.** Every error message ends with what the user can do next.
6. **One primary action.** The chat input is always the main focus. Everything else is secondary.

---

## Out of Scope (all phases)

- User accounts / cloud sync (local-first throughout)
- Paid usage metering (user provides own API keys)
- Mobile app (desktop web only)
- Real-time conflict resolution in collaboration (last-write-wins)
