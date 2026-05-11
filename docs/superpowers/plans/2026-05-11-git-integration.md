# Git Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local + remote git support to every project via a collapsible Git section in the sidebar.

**Architecture:** Server shells out to system `git` via `execFile` in each project's real directory (`projects/{id}/`). Eight REST endpoints cover init/commit/log/diff/remote/push/pull. A `useGit` hook manages state; `GitPanel` renders in `Sidebar`. Remote auth uses HTTPS with PAT embedded in the origin URL.

**Tech Stack:** React 18 + TypeScript, Node.js `child_process.execFile` + `util.promisify`, system `git`, lucide-react, no new dependencies.

---

### Task 1: Server — git helper + status + init endpoints

**Files:**
- Modify: `server/index.mjs` (imports section, after helper functions)

- [ ] **Step 1: Add `execFile` to child_process import and add `promisify`**

Find line 6 in `server/index.mjs`:
```js
import { spawn }  from 'child_process';
```
Change to:
```js
import { spawn, execFile } from 'child_process';
import { promisify }       from 'util';
```

- [ ] **Step 2: Add `execFileAsync` and `runGit` helper after the existing helper functions**

After the `function projectDir(id)` definition (around line 576), add:

```js
const execFileAsync = promisify(execFile);

async function runGit(dir, args) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd: dir, timeout: 15000 });
    return { stdout: stdout.trim(), stderr: stderr.trim(), ok: true };
  } catch (err) {
    return { stdout: '', stderr: err.stderr?.trim() ?? err.message, ok: false };
  }
}
```

- [ ] **Step 3: Add `GET /api/projects/:id/git/status` endpoint**

Add after the existing project routes (after the `app.post('/api/projects/:id/open-folder', ...)` block):

```js
// ── Git endpoints ──────────────────────────────────────────────
app.get('/api/projects/:id/git/status', authenticate, async (req, res) => {
  const dir = projectDir(safeId(req.params.id));
  try { await fs.access(path.join(dir, '.git')); }
  catch { return res.json({ initialized: false, branch: '', dirty: 0, ahead: 0, remote: null, lastCommit: null }); }

  const [branchR, statusR, aheadR, logR, remoteR] = await Promise.all([
    runGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(dir, ['status', '--porcelain']),
    runGit(dir, ['rev-list', '--count', '@{u}..HEAD']),
    runGit(dir, ['log', '-1', '--format=%H|%s|%cI']),
    runGit(dir, ['remote', 'get-url', 'origin']),
  ]);

  const branch = branchR.ok ? branchR.stdout : 'main';
  const dirty  = statusR.ok  ? statusR.stdout.split('\n').filter(Boolean).length : 0;
  const ahead  = aheadR.ok && !aheadR.stderr ? (parseInt(aheadR.stdout, 10) || 0) : 0;

  let lastCommit = null;
  if (logR.ok && logR.stdout) {
    const [hash, message, date] = logR.stdout.split('|');
    if (hash) lastCommit = { hash, shortHash: hash.slice(0, 7), message: message ?? '', date: date ?? '' };
  }

  let remote = null;
  if (remoteR.ok && remoteR.stdout) {
    try {
      const u = new URL(remoteR.stdout);
      u.username = ''; u.password = '';
      remote = u.hostname + u.pathname;
    } catch { remote = remoteR.stdout; }
  }

  res.json({ initialized: true, branch, dirty, ahead, remote, lastCommit });
});
```

- [ ] **Step 4: Add `POST /api/projects/:id/git/init` endpoint**

```js
app.post('/api/projects/:id/git/init', authenticate, async (req, res) => {
  const dir = projectDir(safeId(req.params.id));
  let r = await runGit(dir, ['init', '-b', 'main']);
  if (!r.ok) {
    r = await runGit(dir, ['init']);
    if (!r.ok) return res.status(500).json({ error: r.stderr || 'git init failed' });
    await runGit(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  }
  await runGit(dir, ['config', 'user.name', 'Agapes AI']);
  await runGit(dir, ['config', 'user.email', 'ai@agapes.us']);
  await runGit(dir, ['commit', '--allow-empty', '-m', 'Initial commit']);
  res.json({ ok: true });
});
```

- [ ] **Step 5: Verify server starts without errors**

```bash
cd /c/Lovable/server && node index.mjs &
sleep 2 && curl -s http://localhost:3000/api/auth/me | head -c 100
kill %1
```

Expected: JSON response (not a crash), server exits cleanly.

- [ ] **Step 6: Commit**

```bash
git add server/index.mjs
git commit -m "feat: git status + init endpoints"
```

---

### Task 2: Server — commit, log, diff endpoints

**Files:**
- Modify: `server/index.mjs` (add 3 routes after Task 1's routes)

- [ ] **Step 1: Add `POST /api/projects/:id/git/commit`**

```js
app.post('/api/projects/:id/git/commit', authenticate, async (req, res) => {
  const dir = projectDir(safeId(req.params.id));
  const { message } = req.body ?? {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message required' });
  }
  const msg = message.trim().slice(0, 500);
  await runGit(dir, ['add', '-A']);
  const r = await runGit(dir, ['commit', '-m', msg]);
  if (!r.ok) {
    if (r.stderr.includes('nothing to commit')) return res.status(400).json({ error: 'Nothing to commit' });
    return res.status(500).json({ error: r.stderr || 'Commit failed' });
  }
  const hashM = r.stdout.match(/\[(?:main|master) ([a-f0-9]+)\]/);
  res.json({ ok: true, hash: hashM?.[1] ?? '' });
});
```

- [ ] **Step 2: Add `GET /api/projects/:id/git/log`**

```js
app.get('/api/projects/:id/git/log', authenticate, async (req, res) => {
  const dir = projectDir(safeId(req.params.id));
  const r = await runGit(dir, ['log', '-10', '--format=%H|%s|%cI']);
  if (!r.ok || !r.stdout) return res.json([]);
  const commits = r.stdout.split('\n').filter(Boolean).map((line) => {
    const [hash, message, date] = line.split('|');
    return { hash: hash ?? '', shortHash: (hash ?? '').slice(0, 7), message: message ?? '', date: date ?? '' };
  });
  res.json(commits);
});
```

- [ ] **Step 3: Add `GET /api/projects/:id/git/diff`**

```js
app.get('/api/projects/:id/git/diff', authenticate, async (req, res) => {
  const dir = projectDir(safeId(req.params.id));
  const r = await runGit(dir, ['diff', 'HEAD']);
  res.json({ diff: r.ok ? r.stdout : '' });
});
```

- [ ] **Step 4: Commit**

```bash
git add server/index.mjs
git commit -m "feat: git commit + log + diff endpoints"
```

---

### Task 3: Server — remote, push, pull endpoints

**Files:**
- Modify: `server/index.mjs` (add 3 routes)

- [ ] **Step 1: Add `POST /api/projects/:id/git/remote`**

```js
app.post('/api/projects/:id/git/remote', authenticate, async (req, res) => {
  const dir = projectDir(safeId(req.params.id));
  const { url, token } = req.body ?? {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });
  let authUrl, displayUrl;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    if (token) u.username = String(token);
    authUrl    = u.toString();
    u.username = ''; u.password = '';
    displayUrl = u.hostname + u.pathname;
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  const listR   = await runGit(dir, ['remote']);
  const hasOrigin = listR.stdout.split('\n').includes('origin');
  const r = hasOrigin
    ? await runGit(dir, ['remote', 'set-url', 'origin', authUrl])
    : await runGit(dir, ['remote', 'add', 'origin', authUrl]);
  if (!r.ok) return res.status(500).json({ error: r.stderr || 'Failed to set remote' });
  res.json({ ok: true, displayUrl });
});
```

- [ ] **Step 2: Add `POST /api/projects/:id/git/push`**

```js
app.post('/api/projects/:id/git/push', authenticate, async (req, res) => {
  const dir = projectDir(safeId(req.params.id));
  const r = await runGit(dir, ['push', '-u', 'origin', 'main']);
  if (!r.ok) return res.status(500).json({ error: r.stderr || 'Push failed' });
  res.json({ ok: true });
});
```

- [ ] **Step 3: Add `POST /api/projects/:id/git/pull`**

```js
app.post('/api/projects/:id/git/pull', authenticate, async (req, res) => {
  const dir = projectDir(safeId(req.params.id));
  const r = await runGit(dir, ['pull', 'origin', 'main']);
  if (!r.ok) return res.status(500).json({ error: r.stderr || 'Pull failed' });
  res.json({ ok: true, summary: r.stdout });
});
```

- [ ] **Step 4: Commit**

```bash
git add server/index.mjs
git commit -m "feat: git remote + push + pull endpoints"
```

---

### Task 4: `useGit` hook

**Files:**
- Create: `src/hooks/useGit.ts`

- [ ] **Step 1: Create the file**

```ts
import { useState, useCallback, useEffect } from 'react';

export interface GitCommit {
  hash:      string;
  shortHash: string;
  message:   string;
  date:      string;
}

export interface GitStatus {
  initialized: boolean;
  branch:      string;
  dirty:       number;
  ahead:       number;
  remote:      string | null;
  lastCommit:  GitCommit | null;
}

interface GitState {
  status:    GitStatus | null;
  log:       GitCommit[];
  diff:      string;
  isLoading: boolean;
  error:     string | null;
}

const INIT: GitState = { status: null, log: [], diff: '', isLoading: false, error: null };

export function useGit(projectId: string | null) {
  const [state, setState] = useState<GitState>(INIT);

  const refresh = useCallback(async () => {
    if (!projectId) { setState(INIT); return; }
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const [sRes, lRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/git/status`, { credentials: 'include' }),
        fetch(`/api/projects/${projectId}/git/log`,    { credentials: 'include' }),
      ]);
      const status: GitStatus = await sRes.json();
      const log: GitCommit[]  = lRes.ok ? await lRes.json() : [];
      setState((s) => ({ ...s, status, log, isLoading: false }));
    } catch (err) {
      setState((s) => ({ ...s, isLoading: false, error: String(err) }));
    }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const gitAction = useCallback(async (
    endpoint: string,
    opts: RequestInit = {},
  ): Promise<{ ok: boolean; error?: string } & Record<string, unknown>> => {
    if (!projectId) return { ok: false, error: 'No project' };
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const res  = await fetch(`/api/projects/${projectId}/git/${endpoint}`, { credentials: 'include', ...opts });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) throw new Error((data.error as string) ?? `HTTP ${res.status}`);
      await refresh();
      return { ok: true, ...data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, isLoading: false, error: msg }));
      return { ok: false, error: msg };
    }
  }, [projectId, refresh]);

  const init   = useCallback(() => gitAction('init', { method: 'POST' }), [gitAction]);

  const commit = useCallback((message: string) => gitAction('commit', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ message }),
  }), [gitAction]);

  const setRemote = useCallback((url: string, token: string) => gitAction('remote', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ url, token }),
  }), [gitAction]);

  const push = useCallback(() => gitAction('push', { method: 'POST' }), [gitAction]);
  const pull = useCallback(() => gitAction('pull', { method: 'POST' }), [gitAction]);

  const fetchDiff = useCallback(async () => {
    if (!projectId) return;
    try {
      const res  = await fetch(`/api/projects/${projectId}/git/diff`, { credentials: 'include' });
      const data = await res.json() as { diff?: string };
      setState((s) => ({ ...s, diff: data.diff ?? '' }));
    } catch { /* silent */ }
  }, [projectId]);

  return { ...state, refresh, init, commit, setRemote, push, pull, fetchDiff };
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd /c/Lovable && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useGit.ts
git commit -m "feat: useGit hook for git state management"
```

---

### Task 5: `GitPanel` component

**Files:**
- Create: `src/components/GitPanel.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useState } from 'react';
import { GitBranch, ChevronRight, ChevronDown, Upload, Download, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { useGit } from '../hooks/useGit';

function DiffViewer({ diff }: { diff: string }) {
  if (!diff) return <div className="sb-git-diff-empty">No uncommitted changes</div>;
  return (
    <div className="sb-git-diff">
      {diff.split('\n').map((line, i) => (
        <div
          key={i}
          className={
            `sb-git-diff-line` +
            (line.startsWith('+') && !line.startsWith('+++') ? ' add' :
             line.startsWith('-') && !line.startsWith('---') ? ' del' :
             line.startsWith('@@') ? ' hunk' : '')
          }
        >
          {line || ' '}
        </div>
      ))}
    </div>
  );
}

export function GitPanel({ projectId }: { projectId: string | null }) {
  const git = useGit(projectId);
  const [expanded,       setExpanded]       = useState(false);
  const [commitMsg,      setCommitMsg]      = useState('');
  const [showRemoteForm, setShowRemoteForm] = useState(false);
  const [remoteUrl,      setRemoteUrl]      = useState('');
  const [remoteToken,    setRemoteToken]    = useState('');
  const [showDiff,       setShowDiff]       = useState(false);
  const [opError,        setOpError]        = useState<string | null>(null);

  const clearErr = () => setOpError(null);

  const handleExpand = () => {
    if (!expanded) git.refresh();
    setExpanded((v) => !v);
  };

  const handleInit = async () => {
    clearErr();
    const r = await git.init();
    if (!r.ok) setOpError(r.error ?? 'Init failed');
  };

  const handleCommit = async () => {
    clearErr();
    if (!commitMsg.trim()) return;
    const r = await git.commit(commitMsg.trim());
    if (r.ok) setCommitMsg('');
    else setOpError(r.error ?? 'Commit failed');
  };

  const handleSaveRemote = async () => {
    clearErr();
    const r = await git.setRemote(remoteUrl.trim(), remoteToken.trim());
    if (r.ok) { setShowRemoteForm(false); setRemoteToken(''); }
    else setOpError(r.error ?? 'Failed to set remote');
  };

  const handlePush = async () => {
    clearErr();
    const r = await git.push();
    if (!r.ok) setOpError(r.error ?? 'Push failed');
  };

  const handlePull = async () => {
    clearErr();
    const r = await git.pull();
    if (!r.ok) setOpError(r.error ?? 'Pull failed');
  };

  const handleDiffToggle = async () => {
    if (!showDiff) await git.fetchDiff();
    setShowDiff((v) => !v);
  };

  const { status, log, diff, isLoading } = git;
  const hasProject = !!projectId;

  return (
    <div className="sb-section sb-git-section">
      {/* Header */}
      <div className="sb-header sb-git-header" onClick={handleExpand} style={{ cursor: 'pointer' }}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <GitBranch size={12} />
        <span className="sb-header-label">Git</span>
        {status?.initialized && (
          <span className="sb-git-badge">
            {status.dirty > 0 ? `● ${status.dirty}` : <Check size={10} />}
          </span>
        )}
        {expanded && (
          <button
            className="sb-icon-btn"
            onClick={(e) => { e.stopPropagation(); git.refresh(); }}
            title="Refresh git status"
            disabled={isLoading}
          >
            <RefreshCw size={11} className={isLoading ? 'sb-git-spin' : ''} />
          </button>
        )}
      </div>

      {expanded && hasProject && (
        <div className="sb-git-body">
          {/* Error */}
          {opError && (
            <div className="sb-git-error">
              <AlertCircle size={11} />
              {opError}
              <button className="sb-git-error-close" onClick={clearErr}>×</button>
            </div>
          )}

          {/* Not initialized */}
          {!status?.initialized && !isLoading && (
            <div className="sb-git-uninit">
              <p className="sb-git-hint">No git repository. Initialize to start tracking changes.</p>
              <button className="sb-git-btn sb-git-btn--primary" onClick={handleInit}>
                Initialize repository
              </button>
            </div>
          )}

          {/* Initialized */}
          {status?.initialized && (
            <>
              {/* Branch + status */}
              <div className="sb-git-status">
                <GitBranch size={11} />
                <span className="sb-git-branch">{status.branch}</span>
                {status.dirty > 0
                  ? <span className="sb-git-dirty">{status.dirty} change{status.dirty !== 1 ? 's' : ''}</span>
                  : <span className="sb-git-clean">up to date</span>
                }
              </div>

              {/* Commit area */}
              <div className="sb-git-commit">
                <textarea
                  className="sb-git-textarea"
                  placeholder="Commit message…"
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  rows={2}
                  disabled={isLoading}
                />
                <button
                  className="sb-git-btn sb-git-btn--primary"
                  onClick={handleCommit}
                  disabled={!commitMsg.trim() || isLoading}
                >
                  Commit
                </button>
              </div>

              {/* Remote area */}
              <div className="sb-git-remote-area">
                {status.remote ? (
                  <>
                    <div className="sb-git-remote-row">
                      <span className="sb-git-remote-url" title={status.remote}>{status.remote}</span>
                      <button
                        className="sb-git-link"
                        onClick={() => { setRemoteUrl(''); setRemoteToken(''); setShowRemoteForm((v) => !v); }}
                      >
                        Edit
                      </button>
                    </div>
                    <div className="sb-git-push-pull">
                      <button className="sb-git-btn" onClick={handlePush} disabled={isLoading}>
                        <Upload size={11} /> Push
                      </button>
                      <button className="sb-git-btn" onClick={handlePull} disabled={isLoading}>
                        <Download size={11} /> Pull
                      </button>
                    </div>
                  </>
                ) : (
                  !showRemoteForm && (
                    <button className="sb-git-link" onClick={() => setShowRemoteForm(true)}>
                      + Set remote URL &amp; token
                    </button>
                  )
                )}

                {showRemoteForm && (
                  <div className="sb-git-form">
                    <input
                      className="sb-git-input"
                      type="url"
                      placeholder="https://github.com/user/repo.git"
                      value={remoteUrl}
                      onChange={(e) => setRemoteUrl(e.target.value)}
                    />
                    <input
                      className="sb-git-input"
                      type="password"
                      placeholder="Personal access token"
                      value={remoteToken}
                      onChange={(e) => setRemoteToken(e.target.value)}
                    />
                    <div className="sb-git-form-actions">
                      <button
                        className="sb-git-btn sb-git-btn--primary"
                        onClick={handleSaveRemote}
                        disabled={!remoteUrl.trim() || isLoading}
                      >
                        Save
                      </button>
                      <button className="sb-git-btn" onClick={() => setShowRemoteForm(false)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Commit log */}
              {log.length > 0 && (
                <div className="sb-git-log">
                  <div className="sb-git-log-hd">
                    Recent commits
                    <button className="sb-git-link" onClick={handleDiffToggle}>
                      {showDiff ? 'Hide diff' : 'View diff'}
                    </button>
                  </div>
                  {log.map((c) => (
                    <div key={c.hash} className="sb-git-log-item">
                      <span className="sb-git-hash">{c.shortHash}</span>
                      <span className="sb-git-msg">{c.message}</span>
                      <span className="sb-git-date">{timeAgo(c.date)}</span>
                    </div>
                  ))}
                  {showDiff && <DiffViewer diff={diff} />}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return 'now';
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd /c/Lovable && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/GitPanel.tsx
git commit -m "feat: GitPanel component with commit/push/pull/diff UI"
```

---

### Task 6: Sidebar integration + CSS

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Import GitPanel in Sidebar.tsx**

Add to the imports at the top of `src/components/Sidebar.tsx`:
```ts
import { GitPanel } from './GitPanel';
```

- [ ] **Step 2: Add `<GitPanel>` at the bottom of the sidebar**

Find the closing `</aside>` tag at the bottom of the `Sidebar` component's return (after the Files section `</div>`). Add the GitPanel just before it:

```tsx
      {/* ── Git ── */}
      <GitPanel projectId={activeProjectId} />
    </aside>
```

The full return now ends:
```tsx
      {/* ── File tree ── */}
      {files.length > 0 && (
        <div className="sb-section sb-files-section">
          ...
        </div>
      )}

      {/* ── Git ── */}
      <GitPanel projectId={activeProjectId} />
    </aside>
```

- [ ] **Step 3: TypeScript check**

```bash
cd /c/Lovable && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Add CSS for the git panel**

In `src/index.css`, find the end of the `.sb-tree-file` and `.sb-tree-dir` block (search for `sb-tree-file`) and add after the sidebar styles section:

```css
/* ── Git panel ───────────────────────────────────────────────── */
.sb-git-section { border-top: 1px solid var(--b1); }
.sb-git-header  { gap: 5px; user-select: none; }
.sb-git-badge   {
  margin-left: auto;
  font-size: 10px;
  color: var(--t3);
  display: flex; align-items: center; gap: 3px;
}
.sb-git-body {
  padding: 8px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sb-git-error {
  display: flex; align-items: flex-start; gap: 6px;
  padding: 6px 8px;
  background: rgba(239,68,68,.1);
  border: 1px solid rgba(239,68,68,.3);
  border-radius: var(--r-sm);
  font-size: 11px;
  color: var(--err);
  line-height: 1.4;
}
.sb-git-error-close {
  margin-left: auto; flex-shrink: 0;
  color: var(--err); font-size: 13px; line-height: 1;
}
.sb-git-uninit { display: flex; flex-direction: column; gap: 6px; }
.sb-git-hint   { font-size: 11px; color: var(--t4); line-height: 1.4; }
.sb-git-status {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px;
}
.sb-git-branch { color: var(--t2); font-weight: 600; }
.sb-git-dirty  { color: #f59e0b; }
.sb-git-clean  { color: #34d399; }
.sb-git-commit { display: flex; flex-direction: column; gap: 5px; }
.sb-git-textarea {
  width: 100%;
  background: var(--raised);
  border: 1px solid var(--b2);
  border-radius: var(--r-sm);
  padding: 6px 8px;
  font-size: 11px;
  color: var(--t1);
  resize: none;
  outline: none;
  line-height: 1.4;
}
.sb-git-textarea:focus { border-color: var(--b4); }
.sb-git-textarea::placeholder { color: var(--t4); }
.sb-git-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px;
  font-size: 11px;
  background: var(--overlay);
  border: 1px solid var(--b2);
  border-radius: var(--r-sm);
  color: var(--t2);
  cursor: pointer;
  transition: all var(--t-xs);
}
.sb-git-btn:hover:not(:disabled) { border-color: var(--b3); color: var(--t1); }
.sb-git-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.sb-git-btn--primary {
  background: var(--fire);
  border-color: var(--fire);
  color: #fff;
  font-weight: 600;
}
.sb-git-btn--primary:hover:not(:disabled) { background: var(--fire-hi); border-color: var(--fire-hi); }
.sb-git-remote-area { display: flex; flex-direction: column; gap: 5px; }
.sb-git-remote-row  { display: flex; align-items: center; gap: 6px; font-size: 11px; }
.sb-git-remote-url  { color: var(--t3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.sb-git-push-pull   { display: flex; gap: 5px; }
.sb-git-link {
  font-size: 11px; color: var(--fire); background: none;
  border: none; cursor: pointer; padding: 0;
  text-decoration: underline; text-underline-offset: 2px;
}
.sb-git-link:hover { color: var(--fire-hi); }
.sb-git-form { display: flex; flex-direction: column; gap: 5px; }
.sb-git-input {
  width: 100%;
  background: var(--raised);
  border: 1px solid var(--b2);
  border-radius: var(--r-sm);
  padding: 5px 8px;
  font-size: 11px;
  color: var(--t1);
  outline: none;
}
.sb-git-input:focus { border-color: var(--b4); }
.sb-git-input::placeholder { color: var(--t4); }
.sb-git-form-actions { display: flex; gap: 5px; }
.sb-git-log { display: flex; flex-direction: column; gap: 4px; font-size: 11px; }
.sb-git-log-hd {
  display: flex; align-items: center; justify-content: space-between;
  color: var(--t4); font-size: 10px; text-transform: uppercase;
  letter-spacing: .04em; margin-bottom: 2px;
}
.sb-git-log-item {
  display: flex; align-items: baseline; gap: 6px;
  padding: 2px 0;
}
.sb-git-hash  { color: var(--fire); font-family: monospace; flex-shrink: 0; }
.sb-git-msg   { color: var(--t2); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb-git-date  { color: var(--t4); flex-shrink: 0; }
.sb-git-diff  { max-height: 300px; overflow-y: auto; font-family: monospace; font-size: 10px; }
.sb-git-diff-line { padding: 0 4px; white-space: pre; color: var(--t3); line-height: 1.5; }
.sb-git-diff-line.add  { background: rgba(52,211,153,.12); color: #34d399; }
.sb-git-diff-line.del  { background: rgba(239,68,68,.1);   color: #f87171; }
.sb-git-diff-line.hunk { color: #60a5fa; }
.sb-git-diff-empty { font-size: 11px; color: var(--t4); padding: 6px 0; }
.sb-git-spin { animation: sb-git-rotate 1s linear infinite; }
@keyframes sb-git-rotate { to { transform: rotate(360deg); } }
```

- [ ] **Step 5: Final TypeScript + build check**

```bash
cd /c/Lovable && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar.tsx src/index.css
git commit -m "feat: integrate GitPanel into sidebar with full CSS"
```

---

## Verification

1. Open the app. Select a project that has files.
2. The sidebar shows a collapsed "Git" section at the bottom.
3. Click to expand → shows "Initialize repository" button (project not yet a git repo).
4. Click "Initialize repository" → section updates to show `main`, "up to date", commit textarea.
5. Edit a file (via CodePanel) → save → return to sidebar Git section → shows "1 change".
6. Type a commit message → click "Commit" → log shows the new commit hash.
7. Click "View diff" → diff viewer shows colored `+`/`-` lines.
8. Click "+ Set remote URL & token" → form appears → enter a GitHub URL and PAT → click Save → remote URL shown.
9. Click "Push ↑" → succeeds or shows a clear error if auth fails.
10. Click "Pull ↓" → shows "Already up to date." in no visible error (success).
11. The refresh button (↻) in the header re-fetches status without collapsing the panel.
