# Git Integration — Design Spec

**Goal:** Add local + remote git support to every project, accessible from a collapsible Git section at the bottom of the sidebar.

**Architecture:** Server shells out to system `git` in each project's directory (`projects/{id}/`). Eight REST endpoints cover the full workflow. A `useGit` hook manages state client-side; `GitPanel` renders in the Sidebar. Remote auth uses HTTPS with the PAT embedded in the origin URL — no credential manager or SSH keys needed.

**Tech Stack:** React 18 + TypeScript, Node.js `child_process.execFile`, system `git`, no new dependencies.

---

## How It Works End-to-End

1. User opens the Git section in the sidebar. The hook calls `GET /api/projects/:id/git/status` to check if the repo is initialized and how many files are dirty.
2. If not initialized, only an "Initialize repository" button is shown. Clicking it calls `POST /git/init`, which runs `git init`, sets `user.name = "Agapes AI"` and `user.email = "ai@agapes.us"`, then makes an initial empty commit on `main`.
3. Once initialized, the user types a commit message and clicks Commit → `POST /git/commit` runs `git add -A && git commit -m "message"`. Status refreshes.
4. To push, the user first sets the remote via the "Set Remote URL + Token" form, which calls `POST /git/remote` and stores the URL with embedded PAT (`https://{token}@github.com/user/repo.git`) as the `origin` remote in the project's `.git/config`. The token never reaches the database.
5. Push/Pull call the corresponding endpoints. Errors (wrong credentials, no network) are surfaced as inline error text in the panel.
6. Clicking "View diff" below the commit list fetches `GET /git/diff` and renders the unified diff inline with green `+` / red `-` lines.

---

## Server Endpoints

All endpoints are under `/api/projects/:id/git/`. All require auth (existing session middleware). All shell out to `git` with `execFile` (not `exec`) to avoid shell injection. The working directory is always `projectDir(id)`.

### `GET /api/projects/:id/git/status`

Returns:
```json
{
  "initialized": true,
  "branch": "main",
  "dirty": 4,
  "ahead": 1,
  "lastCommit": { "hash": "a1b2c3", "message": "Add dark mode", "date": "2026-05-11T14:00:00Z" }
}
```

- `initialized`: whether `.git/` exists in the project dir
- `dirty`: count of files reported by `git status --porcelain`
- `ahead`: number of commits ahead of `origin/main` (0 if no remote set)
- `lastCommit`: from `git log -1 --format="%H|%s|%cI"`, with `shortHash = hash.slice(0, 7)` — null if no commits

### `POST /api/projects/:id/git/init`

Body: none.

Steps:
1. `git init -b main` (Git ≥ 2.28) or `git init && git checkout -b main` fallback
2. `git config user.name "Agapes AI"`
3. `git config user.email "ai@agapes.us"`
4. `git commit --allow-empty -m "Initial commit"`

Returns `{ ok: true }`.

### `POST /api/projects/:id/git/commit`

Body: `{ message: string }` (required, max 500 chars).

Steps:
1. `git add -A`
2. `git commit -m "{message}"`

Returns `{ ok: true, hash: "abc123" }`.

Error if nothing to commit: `{ error: "Nothing to commit" }` (HTTP 400).

### `GET /api/projects/:id/git/log`

Returns last 10 commits:
```json
[
  { "hash": "abc123", "shortHash": "abc123".slice(0,7), "message": "Add dark mode", "date": "2026-05-11T14:00:00Z" }
]
```

From: `git log -10 --format="%H|%s|%cI"`

### `GET /api/projects/:id/git/diff`

Returns unified diff text of all uncommitted changes:
```json
{ "diff": "diff --git a/index.html b/index.html\n..." }
```

From: `git diff HEAD` (includes staged and unstaged relative to last commit). Empty string if nothing changed.

### `POST /api/projects/:id/git/remote`

Body: `{ url: string, token: string }`.

- `url`: the bare repo URL e.g. `https://github.com/user/repo.git`
- `token`: personal access token (GitHub, GitLab, etc.)

Builds the authenticated URL: `https://{token}@{url-without-scheme}` and runs:
`git remote set-url origin {authUrl}` (or `git remote add origin {authUrl}` if no remote yet).

Returns `{ ok: true, displayUrl: "github.com/user/repo.git" }` (display URL strips the token).

### `POST /api/projects/:id/git/push`

Body: none.

Runs: `git push -u origin main`

Returns `{ ok: true }`. On failure returns `{ error: "..." }` with the git stderr output.

### `POST /api/projects/:id/git/pull`

Body: none.

Runs: `git pull origin main`

Returns `{ ok: true, summary: "Already up to date." }` or error.

---

## Client: `useGit` Hook

**File:** `src/hooks/useGit.ts`

```ts
interface GitStatus {
  initialized: boolean;
  branch:      string;
  dirty:       number;
  ahead:       number;
  lastCommit:  { hash: string; shortHash: string; message: string; date: string } | null;
}

interface GitLog {
  hash:      string;
  shortHash: string;
  message:   string;
  date:      string;
}

interface GitState {
  status:    GitStatus | null;
  log:       GitLog[];
  diff:      string;
  isLoading: boolean;
  error:     string | null;
}
```

**Exports:**
- `status`, `log`, `diff`, `isLoading`, `error` — state
- `refresh()` — re-fetch status + log
- `init()`, `commit(message)`, `setRemote(url, token)`, `push()`, `pull()`, `fetchDiff()` — operations (each calls refresh after success)

The hook takes `projectId: string | null`. When `projectId` changes, it clears state and re-fetches.

---

## Client: `GitPanel` Component

**File:** `src/components/GitPanel.tsx`

Props: `{ projectId: string | null }`

The component calls `useGit(projectId)` internally — no prop drilling of git state through Sidebar/App.

### States

**Not initialized:**
```
▶ Git
  [Initialize repository]
```

**Initialized, no remote:**
```
▼ Git
  main  ● 4 uncommitted changes

  [textarea: Commit message…]       [Commit]

  Remote: not set
  [Set Remote URL + Token]

  ── Recent commits ───────────────────
  a1b2c3  Initial commit   just now
                           [View diff]
```

**Initialized + remote:**
```
▼ Git
  main  ✓ up to date

  [textarea: Commit message…]       [Commit]

  github.com/user/repo  [Edit]
  [Push ↑]  [Pull ↓]

  ── Recent commits ───────────────────
  f3d1e2  Add dark mode    2h ago
  a1b2c3  Initial commit   3h ago
                           [View diff]
```

**Set remote form** (inline, shown when "Set Remote URL + Token" clicked):
```
Repository URL:  [https://github.com/user/repo.git]
Access Token:    [••••••••]               [Save]  [Cancel]
```

**Diff viewer** (inline, toggleable):
```
index.html  +12 -3
───────────────────────────────────
+ <div class="dark-mode">
- <div class="light-mode">
  ...
```

### Behavior Details

- The Git section header shows "Git" with a collapse toggle. Default: collapsed.
- On expand: calls `refresh()` (fetches status + log).
- Commit button disabled when textarea is empty or `isLoading`.
- Push/Pull buttons disabled while `isLoading`.
- "View diff" is a toggle button — clicking again collapses.
- After each operation, status badge updates immediately.
- Errors shown as red inline text below the relevant button.
- Display URL in the panel strips the token: show only `hostname/user/repo.git`.

---

## Sidebar Integration

**File:** `src/components/Sidebar.tsx`

Add `<GitPanel projectId={activeProjectId} />` at the bottom of the sidebar, below the files section. No additional props needed — `GitPanel` manages its own state via `useGit`.

---

## Security

- Token is stored only in the project's `.git/config` on disk — never written to the SQLite database or sent back to the client.
- The display URL in the panel response strips the token portion.
- `execFile` (not `exec`) prevents shell injection. All user-supplied strings (commit messages, URLs, tokens) are passed as argv arguments, never interpolated into shell strings.
- Commit message capped at 500 chars server-side.
- Project dir access uses existing `safeFilePath` / `projectDir` helpers — no path traversal possible.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `git` not installed | Status endpoint returns `{ error: "git not found" }` — panel shows "Git not available on this server" |
| Nothing to commit | 400 with `{ error: "Nothing to commit" }` — shown inline |
| Push auth failure | stderr forwarded as `{ error: "..." }` — shown inline |
| Pull conflict | stderr forwarded as error — user must resolve manually |
| No commits yet (diff) | Returns empty diff |
| Project dir missing | 404 — panel shows error |

---

## File Summary

| File | Change |
|------|--------|
| `server/index.mjs` | Add 8 git endpoints under `/api/projects/:id/git/` |
| `src/hooks/useGit.ts` | New — git state hook |
| `src/components/GitPanel.tsx` | New — collapsible git UI |
| `src/components/Sidebar.tsx` | Add `<GitPanel>` at bottom |
| `src/index.css` | Add styles for git panel, diff viewer |
