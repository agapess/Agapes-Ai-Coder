# FORGE Sandbox — Phase 1 Design

**Date:** 2026-05-09
**Scope:** Phase 1 of 5 — Code Execution Sandbox
**Status:** Approved

---

## Overview

Add a full code execution sandbox to FORGE. When the AI generates code, the user can run it immediately inside the app without switching to a terminal. Web files (HTML/CSS/JS) use an enhanced iframe with console capture. All other files use a real PTY terminal via `node-pty` and `xterm.js`, giving full stdin/stdout/ANSI color support.

**Out of scope for Phase 1:** AI iteration loop, file system sync, templates, deploy, multi-agent. These are separate phases.

---

## Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Execution model | node-pty + xterm.js + WebSocket | Full terminal: stdin, colors, interactive programs |
| Security model | Child process, local only | Single user, trusted environment, no Docker overhead |
| Layout | Split pane: code top, terminal bottom | Most IDE-like; resizable drag handle |
| Web console capture | PostMessage from iframe | No WebSocket needed for HTML files; lightweight |
| Language detection | File extension → runtime map | Auto-detect, supports all installed runtimes |
| Run button location | File tab bar, right side | Always visible, shows detected language |

---

## Architecture

### Frontend Components

**`CodePanel.tsx` (modified)**
- Gains a resizable vertical split: code editor on top, `TerminalPane` below
- Drag handle between the two halves; terminal can collapse to zero height
- Run button added to the file tab bar (right side), showing detected language label
- Disabled for file types with no known runtime

**`TerminalPane.tsx` (new)**
- Mounts an `xterm.js` Terminal instance sized to fill its container
- Connects to `ws://localhost:3001/terminal` on mount (when a run is triggered)
- Renders output in real-time; accepts keystroke input → stdin
- Header bar: command string, exit status badge (green/red), Stop button, Clear button
- Resizes xterm columns/rows when the pane is resized (xterm `fit` addon)

**`useExecution.ts` (new hook)**
- Owns WebSocket lifecycle: open on run, close on exit/stop/unmount
- Language detection: maps file extension to runtime command
- State: `idle | running | exited`; exit code; accumulated output for web console
- Sends `start`, `input`, `kill`, `resize` messages
- For HTML files: skips WebSocket, triggers iframe refresh + console interception instead

**`PreviewPanel.tsx` (modified)**
- Injects console interceptor script before rendering HTML content in the iframe
- Interceptor overrides `console.log/warn/error`, `window.onerror`, `unhandledrejection`
- Each event is `postMessage`-ed to parent with `{ type: 'console', level, args, stack? }`
- Parent (`useExecution`) forwards these to `TerminalPane` for display

### Backend Components

**WebSocket server (added to `server/index.mjs`)**
- Attaches to the existing Express HTTP server via the `ws` library
- Handles upgrade requests at path `/terminal`
- One PTY session per WebSocket connection; cleans up on disconnect

**`ExecutionManager` (new module `server/execution.mjs`)**
- `start(file, content, lang, cwd)` → writes temp file, spawns node-pty, returns pty instance
- `kill(pty)` → sends SIGKILL, cleans up temp file
- Auto-kill after 60-second timeout
- Language → command resolution (see table below)

### Language → Runtime Map

| Extension | Runtime command | Notes |
|-----------|----------------|-------|
| `.py` | `python` / `python3` | Checks which is available |
| `.js` `.mjs` | `node` | |
| `.ts` | `npx ts-node` | Falls back to error if ts-node not installed |
| `.sh` `.bash` | `bash` | On Windows: requires WSL or Git Bash in PATH |
| `.sql` | `sqlite3` | Opens in-memory DB |
| `.rb` | `ruby` | |
| `.go` | `go run` | |
| `.rs` | `cargo run` | Requires Cargo.toml in project dir |
| `.php` | `php` | |
| `.html` `.htm` | (no PTY) | Console capture via iframe PostMessage |
| `.css` | (no execution) | Run button disabled |
| `.json` `.md` | (no execution) | Run button disabled |

Runtime availability is checked at execution time; if the binary is not found, the TerminalPane shows a clear error: `"python not found — install Python and ensure it's in PATH"`.

---

## Data Flow

### Server-side execution (Python, Node, Bash, etc.)

1. User clicks **Run** on an active file tab
2. `useExecution` detects language, opens WebSocket to `/terminal`
3. Client sends `{"type":"start","file":"script.py","content":"...","lang":"python"}`
4. Backend writes content to temp file in project working directory
5. `node-pty` spawns process (e.g. `python script.py`) in project dir
6. PTY stdout/stderr → WebSocket `{"type":"output","data":"..."}` → xterm.js (real-time)
7. Keystrokes in xterm.js → WebSocket `{"type":"input","data":"..."}` → PTY stdin
8. Process exits → backend sends `{"type":"exit","code":0}` → exit badge shown, Stop disabled
9. WebSocket closes; temp file deleted

### Web execution (HTML/CSS/JS)

1. User clicks **Run** on an `.html` file
2. `useExecution` skips WebSocket; calls existing iframe refresh
3. Console interceptor script is prepended to the HTML before rendering
4. Interceptor overrides `console.*`, `window.onerror`, `unhandledrejection`
5. Each event is `postMessage`-ed to parent: `{type:'console', level:'log', args:[...]}`
6. Parent listener formats and appends to TerminalPane output

### WebSocket Protocol

**Client → Server**
```json
{"type":"start","file":"script.py","content":"...","lang":"python","cwd":"/path/to/project"}
{"type":"input","data":"hello\n"}
{"type":"kill"}
{"type":"resize","cols":80,"rows":24}
```

**Server → Client**
```json
{"type":"output","data":"Got 42 records\r\n"}
{"type":"exit","code":0}
{"type":"error","message":"python not found — install Python and ensure it's in PATH"}
```

---

## UI Behaviour

- Terminal pane is **hidden by default** (zero height) until the first Run
- First Run auto-expands terminal to 35% of panel height
- Drag handle lets user resize freely; preference is not persisted (no over-engineering)
- Clear button wipes xterm output but does not kill the process
- Stop button sends `kill` and marks state as `exited`
- New Run while a process is running: Stop existing process first, then start new one
- Run button label shows detected runtime: `▶ Run (python)`, `▶ Run (node)`
- Run button is greyed out (not hidden) for unsupported file types with tooltip: `"No runtime for .css files"`

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Runtime not installed | TerminalPane shows red error message, exit code 127 |
| Process times out (60s) | Auto-kill, terminal shows `"Process timed out after 60s"` |
| WebSocket connection fails | TerminalPane shows `"Could not connect to execution server"` |
| File write fails | TerminalPane shows OS error, no process spawned |
| Process crashes (non-zero exit) | Exit badge shows red `exit 1`, stderr already streamed |
| HTML console error | Displayed in TerminalPane in red with stack trace if available |

---

## New Dependencies

**Frontend**
- `xterm` — terminal emulator component
- `xterm-addon-fit` — auto-resizes terminal to container

**Backend**
- `ws` — WebSocket server (lightweight, no socket.io needed)
- `node-pty` — pseudo-terminal spawning (native module, requires build tools on Windows)

**Windows note:** `node-pty` requires `windows-build-tools` or Visual Studio Build Tools. This is a one-time setup. The server startup should check for `node-pty` availability and print a clear install message if missing.

---

## Files Changed

| File | Change |
|------|--------|
| `src/components/CodePanel.tsx` | Add split layout, Run button, resize handle |
| `src/components/TerminalPane.tsx` | New — xterm.js terminal + WebSocket client |
| `src/components/PreviewPanel.tsx` | Inject console interceptor into iframe HTML |
| `src/hooks/useExecution.ts` | New — execution state, WS lifecycle, language detection |
| `src/types.ts` | Add `ExecutionState`, `WsMessage` types |
| `server/index.mjs` | Add WebSocket server upgrade handler |
| `server/execution.mjs` | New — ExecutionManager, language→runtime map |
| `server/package.json` | Add `ws`, `node-pty` |
| `package.json` | Add `xterm`, `xterm-addon-fit` |

---

## Out of Scope (Future Phases)

- **Phase 2:** AI sees execution output and auto-fixes errors (iteration loop)
- **Phase 3:** Bi-directional file system sync with VS Code
- **Phase 4:** Project templates + one-click deploy (Vercel/Netlify/Railway)
- **Phase 5:** Multi-agent orchestration (parallel Claude instances)
