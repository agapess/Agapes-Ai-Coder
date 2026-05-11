# Inline Diff — Accept/Reject AI Edits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable Review Mode that captures AI-generated file changes as pending diffs shown in a split before/after panel, where users accept or reject individual hunks before changes are applied.

**Architecture:** Pure client-side. A `reviewMode` toggle in App.tsx snapshots files before each AI send, computes line-level diffs after generation completes, reverts files to the snapshot, and stores pending diffs in state. CodePanel renders a `DiffPanel` component instead of the syntax highlighter when diffs are pending. No new server endpoints or npm dependencies.

**Tech Stack:** React 18, TypeScript, Vite, Vitest (existing), no new deps.

---

## File Map

| File | Change |
|------|--------|
| `src/types.ts` | Add `DiffHunk`, `PendingDiff` types |
| `src/hooks/useDiff.ts` | NEW — `computeHunks` (LCS diff) + `applyAcceptedHunks` |
| `src/components/DiffPanel.tsx` | NEW — split before/after view, per-hunk accept/reject |
| `src/hooks/useProject.ts` | Add `removeFile` method (~line 263) |
| `src/App.tsx` | `reviewMode` state, `beforeSnapshotRef`, `pendingDiffs` state, watcher effect, accept/reject handlers, agent mode guard |
| `src/components/CodePanel.tsx` | Review mode toggle button, DiffPanel rendering, tab badges, new props |
| `src/index.css` | Diff panel + toolbar styles |

---

## Task 1: Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add DiffHunk and PendingDiff to types.ts**

Append to the end of `src/types.ts`:
```ts
// ── Inline diff ───────────────────────────────────────────────

export interface DiffHunk {
  type:        'add' | 'remove' | 'replace';
  beforeStart: number;   // 0-based line index in original
  beforeCount: number;   // how many original lines this replaces
  afterStart:  number;   // 0-based line index in new version
  afterCount:  number;   // how many new lines this introduces
  beforeLines: string[]; // lines being removed/replaced
  afterLines:  string[]; // lines being added/replacing
}

export interface PendingDiff {
  path:            string;
  lang:            string;
  originalContent: string;
  newContent:      string;
  hunks:           DiffHunk[];
  resolvedHunks:   ('accepted' | 'rejected' | 'pending')[];
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd C:\Lovable && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(diff): add DiffHunk and PendingDiff types"
```

---

## Task 2: useDiff hook — computeHunks + applyAcceptedHunks

**Files:**
- Create: `src/hooks/useDiff.ts`

- [ ] **Step 1: Create useDiff.ts**

Create `src/hooks/useDiff.ts` with the following content:

```ts
import type { DiffHunk } from '../types';

const MAX_LINES = 2000;

export function computeHunks(before: string, after: string): DiffHunk[] {
  const bLines = before ? before.split('\n') : [];
  const aLines = after  ? after.split('\n')  : [];

  // Fallback for very large files: single replace hunk
  if (bLines.length > MAX_LINES || aLines.length > MAX_LINES) {
    return [{
      type: 'replace',
      beforeStart: 0, beforeCount: bLines.length, beforeLines: bLines,
      afterStart:  0, afterCount:  aLines.length,  afterLines:  aLines,
    }];
  }

  const m = bLines.length, n = aLines.length;

  // LCS DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = bLines[i - 1] === aLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);

  // Backtrack iteratively to produce ops
  type Op = { type: 'eq' | 'add' | 'del'; bi: number; ai: number };
  const ops: Op[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && bLines[i - 1] === aLines[j - 1]) {
      ops.unshift({ type: 'eq', bi: i - 1, ai: j - 1 });
      i--; j--;
    } else if (i > 0 && (j === 0 || dp[i - 1][j] >= dp[i][j - 1])) {
      ops.unshift({ type: 'del', bi: i - 1, ai: j });
      i--;
    } else {
      ops.unshift({ type: 'add', bi: i, ai: j - 1 });
      j--;
    }
  }

  // Group consecutive non-equal ops into hunks
  const hunks: DiffHunk[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].type === 'eq') { k++; continue; }
    const start = k;
    while (k < ops.length && ops[k].type !== 'eq') k++;
    const slice = ops.slice(start, k);
    const delOps = slice.filter(o => o.type === 'del');
    const addOps = slice.filter(o => o.type === 'add');
    const hunkType: DiffHunk['type'] =
      delOps.length > 0 && addOps.length > 0 ? 'replace'
      : addOps.length > 0 ? 'add' : 'remove';
    const beforeStart = delOps.length > 0 ? delOps[0].bi : (addOps[0]?.bi ?? 0);
    const afterStart  = addOps.length  > 0 ? addOps[0].ai : (delOps[0]?.ai ?? 0);
    hunks.push({
      type:        hunkType,
      beforeStart, beforeCount: delOps.length, beforeLines: delOps.map(o => bLines[o.bi]),
      afterStart,  afterCount:  addOps.length,  afterLines:  addOps.map(o => aLines[o.ai]),
    });
  }
  return hunks;
}

export function applyAcceptedHunks(
  originalContent: string,
  hunks: DiffHunk[],
  resolved: ('accepted' | 'rejected' | 'pending')[],
): string {
  const lines = originalContent.split('\n');
  // Process in reverse to keep indices valid
  for (let idx = hunks.length - 1; idx >= 0; idx--) {
    if (resolved[idx] === 'accepted') {
      lines.splice(hunks[idx].beforeStart, hunks[idx].beforeCount, ...hunks[idx].afterLines);
    }
  }
  return lines.join('\n');
}
```

- [ ] **Step 2: Write tests**

Create `src/hooks/useDiff.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeHunks, applyAcceptedHunks } from './useDiff';

describe('computeHunks', () => {
  it('returns empty array for identical content', () => {
    expect(computeHunks('a\nb\nc', 'a\nb\nc')).toEqual([]);
  });

  it('detects a single line replacement', () => {
    const hunks = computeHunks('a\nb\nc', 'a\nX\nc');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('replace');
    expect(hunks[0].beforeLines).toEqual(['b']);
    expect(hunks[0].afterLines).toEqual(['X']);
  });

  it('detects a pure addition', () => {
    const hunks = computeHunks('a\nc', 'a\nb\nc');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('add');
    expect(hunks[0].afterLines).toEqual(['b']);
    expect(hunks[0].beforeCount).toBe(0);
  });

  it('detects a pure removal', () => {
    const hunks = computeHunks('a\nb\nc', 'a\nc');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('remove');
    expect(hunks[0].beforeLines).toEqual(['b']);
    expect(hunks[0].afterCount).toBe(0);
  });

  it('handles empty before (all adds)', () => {
    const hunks = computeHunks('', 'a\nb');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('add');
    expect(hunks[0].afterLines).toEqual(['a', 'b']);
  });

  it('handles empty after (all removes)', () => {
    const hunks = computeHunks('a\nb', '');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('remove');
    expect(hunks[0].beforeLines).toEqual(['a', 'b']);
  });

  it('produces multiple hunks for non-adjacent changes', () => {
    const hunks = computeHunks('a\nb\nc\nd\ne', 'a\nX\nc\nY\ne');
    expect(hunks).toHaveLength(2);
  });
});

describe('applyAcceptedHunks', () => {
  it('applies all accepted hunks', () => {
    const hunks = computeHunks('a\nb\nc', 'a\nX\nc');
    const result = applyAcceptedHunks('a\nb\nc', hunks, ['accepted']);
    expect(result).toBe('a\nX\nc');
  });

  it('does not apply rejected hunks', () => {
    const hunks = computeHunks('a\nb\nc', 'a\nX\nc');
    const result = applyAcceptedHunks('a\nb\nc', hunks, ['rejected']);
    expect(result).toBe('a\nb\nc');
  });

  it('applies only accepted hunks from multiple', () => {
    const before = 'a\nb\nc\nd\ne';
    const after  = 'a\nX\nc\nY\ne';
    const hunks  = computeHunks(before, after);
    expect(hunks).toHaveLength(2);
    // Accept first hunk only
    const result = applyAcceptedHunks(before, hunks, ['accepted', 'rejected']);
    expect(result).toBe('a\nX\nc\nd\ne');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd C:\Lovable && npx vitest run src/hooks/useDiff.test.ts 2>&1 | tail -20`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useDiff.ts src/hooks/useDiff.test.ts
git commit -m "feat(diff): computeHunks and applyAcceptedHunks"
```

---

## Task 3: DiffPanel component

**Files:**
- Create: `src/components/DiffPanel.tsx`

- [ ] **Step 1: Create DiffPanel.tsx**

Create `src/components/DiffPanel.tsx`:

```tsx
import type { PendingDiff } from '../types';

const CONTEXT = 3;

interface Props {
  diff:          PendingDiff;
  onAcceptHunk:  (i: number) => void;
  onRejectHunk:  (i: number) => void;
  onAcceptAll:   () => void;
  onRejectAll:   () => void;
}

export function DiffPanel({ diff, onAcceptHunk, onRejectHunk, onAcceptAll, onRejectAll }: Props) {
  const origLines = diff.originalContent.split('\n');
  const filename  = diff.path.split('/').pop() ?? diff.path;
  const pending   = diff.resolvedHunks.filter(r => r === 'pending').length;

  // Build render segments: context lines and hunk blocks
  type CtxSeg  = { kind: 'context'; lines: string[]; lineStart: number };
  type HunkSeg = { kind: 'hunk';    idx: number };
  type Seg     = CtxSeg | HunkSeg;

  const segments: Seg[] = [];
  let prevEnd = 0;

  for (let i = 0; i < diff.hunks.length; i++) {
    const hunk     = diff.hunks[i];
    const ctxStart = Math.max(prevEnd, hunk.beforeStart - CONTEXT);
    if (ctxStart < hunk.beforeStart) {
      segments.push({ kind: 'context', lines: origLines.slice(ctxStart, hunk.beforeStart), lineStart: ctxStart + 1 });
    }
    segments.push({ kind: 'hunk', idx: i });
    prevEnd = hunk.beforeStart + hunk.beforeCount;
  }
  const lastCtxEnd = Math.min(origLines.length, prevEnd + CONTEXT);
  if (prevEnd < lastCtxEnd) {
    segments.push({ kind: 'context', lines: origLines.slice(prevEnd, lastCtxEnd), lineStart: prevEnd + 1 });
  }

  return (
    <div className="diff-panel">
      {/* Toolbar */}
      <div className="diff-toolbar">
        <span className="diff-filename">{filename}</span>
        <span className="diff-count">{diff.hunks.length} change{diff.hunks.length !== 1 ? 's' : ''}</span>
        <div className="diff-toolbar-actions">
          <button className="diff-btn diff-btn--accept" onClick={onAcceptAll} disabled={pending === 0}>
            Accept all
          </button>
          <button className="diff-btn diff-btn--reject" onClick={onRejectAll} disabled={pending === 0}>
            Reject all
          </button>
        </div>
      </div>

      {/* Split body */}
      <div className="diff-body">
        {/* Before column */}
        <div className="diff-col diff-col--before">
          {segments.map((seg, si) => {
            if (seg.kind === 'context') {
              return seg.lines.map((l, li) => (
                <div key={`${si}-${li}`} className="diff-line diff-line--context">{l || ' '}</div>
              ));
            }
            const hunk = diff.hunks[seg.idx];
            const resolved = diff.resolvedHunks[seg.idx];
            const extra = Math.max(0, hunk.afterLines.length - hunk.beforeLines.length);
            return (
              <div key={si} className={`diff-hunk-block${resolved !== 'pending' ? ' diff-hunk-block--resolved' : ''}`}>
                {hunk.beforeLines.map((l, li) => (
                  <div key={li} className="diff-line diff-line--remove">
                    <span className="diff-gutter">−</span>{l || ' '}
                  </div>
                ))}
                {Array.from({ length: extra }).map((_, li) => (
                  <div key={`p${li}`} className="diff-line diff-line--pad">&nbsp;</div>
                ))}
              </div>
            );
          })}
        </div>

        {/* After column */}
        <div className="diff-col diff-col--after">
          {segments.map((seg, si) => {
            if (seg.kind === 'context') {
              return seg.lines.map((l, li) => (
                <div key={`${si}-${li}`} className="diff-line diff-line--context">{l || ' '}</div>
              ));
            }
            const hunk = diff.hunks[seg.idx];
            const resolved = diff.resolvedHunks[seg.idx];
            const extra = Math.max(0, hunk.beforeLines.length - hunk.afterLines.length);
            return (
              <div key={si} className={`diff-hunk-block${resolved !== 'pending' ? ' diff-hunk-block--resolved' : ''}`}>
                {hunk.afterLines.map((l, li) => (
                  <div key={li} className="diff-line diff-line--add">
                    <span className="diff-gutter">+</span>{l || ' '}
                  </div>
                ))}
                {Array.from({ length: extra }).map((_, li) => (
                  <div key={`p${li}`} className="diff-line diff-line--pad">&nbsp;</div>
                ))}
                {resolved === 'pending' && (
                  <div className="diff-hunk-actions">
                    <button className="diff-hunk-btn diff-hunk-btn--accept" onClick={() => onAcceptHunk(seg.idx)}>✓ Accept</button>
                    <button className="diff-hunk-btn diff-hunk-btn--reject" onClick={() => onRejectHunk(seg.idx)}>✕ Reject</button>
                  </div>
                )}
                {resolved === 'accepted' && <div className="diff-resolved diff-resolved--accepted">✓ accepted</div>}
                {resolved === 'rejected' && <div className="diff-resolved diff-resolved--rejected">✕ rejected</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd C:\Lovable && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/DiffPanel.tsx
git commit -m "feat(diff): DiffPanel split before/after component"
```

---

## Task 4: useProject — add removeFile

**Files:**
- Modify: `src/hooks/useProject.ts`

- [ ] **Step 1: Add removeFile after updateFileContent (~line 263)**

Find this block in `src/hooks/useProject.ts`:
```ts
  // ── Stop generation ──────────────────────────────────────────
  const stopGeneration = useCallback(() => {
```

Insert before it:
```ts
  // ── Remove a file (used by review mode to revert newly created files) ──
  const removeFile = useCallback((path: string) => {
    setFiles(prev => prev.filter(f => f.path !== path));
  }, []);

```

- [ ] **Step 2: Export removeFile in the return object**

Find the return statement of `useProject` (the large object with `projectId`, `files`, etc.) and add `removeFile` to it:
```ts
    removeFile,
```

- [ ] **Step 3: Verify TypeScript**

Run: `cd C:\Lovable && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useProject.ts
git commit -m "feat(diff): add removeFile to useProject"
```

---

## Task 5: App.tsx — review mode state machine

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports**

Add to the imports at the top of `src/App.tsx`:
```ts
import { computeHunks, applyAcceptedHunks } from './hooks/useDiff';
import type { PendingDiff } from './types';
```

- [ ] **Step 2: Add state and refs after existing refs**

After the `agentStatus` state block (around line 62), add:
```ts
  // ── Review mode ───────────────────────────────────────────────
  const [reviewMode,    setReviewMode]    = useState(false);
  const [pendingDiffs,  setPendingDiffs]  = useState<PendingDiff[]>([]);
  const [showReviewConfirm, setShowReviewConfirm] = useState(false);
  const beforeSnapshotRef = useRef<import('./types').GeneratedFile[]>([]);
```

- [ ] **Step 3: Snapshot files before send**

At the very top of `handleSend` (before the `if (chatMode === 'agent')` block), add:
```ts
    if (reviewMode) {
      beforeSnapshotRef.current = project.files.map(f => ({ ...f }));
    }
```

- [ ] **Step 4: Add watcher effect — fires when generation finishes in review mode**

Add this `useEffect` after the agent `useEffect` blocks (around line 345):
```ts
  // Review mode: compute diffs after generation completes
  useEffect(() => {
    if (!reviewMode) return;
    if (project.isGenerating) return;
    const before = beforeSnapshotRef.current;
    if (before.length === 0 && project.files.length === 0) return;

    const diffs: PendingDiff[] = [];

    for (const newFile of project.files) {
      const orig = before.find(f => f.path === newFile.path);
      const origContent = orig?.content ?? '';
      if (origContent === newFile.content) continue;

      const hunks = computeHunks(origContent, newFile.content);
      if (hunks.length === 0) continue;

      diffs.push({
        path: newFile.path, lang: newFile.lang,
        originalContent: origContent, newContent: newFile.content,
        hunks, resolvedHunks: hunks.map(() => 'pending' as const),
      });
      project.updateFileContent(newFile.path, origContent);
    }

    // Brand-new files (not in before snapshot)
    for (const newFile of project.files) {
      if (before.find(f => f.path === newFile.path)) continue;
      const hunks = computeHunks('', newFile.content);
      diffs.push({
        path: newFile.path, lang: newFile.lang,
        originalContent: '', newContent: newFile.content,
        hunks, resolvedHunks: hunks.map(() => 'pending' as const),
      });
      project.removeFile(newFile.path);
    }

    if (diffs.length > 0) setPendingDiffs(diffs);
    beforeSnapshotRef.current = [];
  }, [project.isGenerating]);
```

- [ ] **Step 5: Add accept/reject handlers**

Add these handlers after `handleCodeAction`:
```ts
  const handleAcceptHunk = (path: string, hunkIdx: number) => {
    setPendingDiffs(prev => {
      const next = prev.map(d => {
        if (d.path !== path) return d;
        const resolvedHunks = [...d.resolvedHunks];
        resolvedHunks[hunkIdx] = 'accepted';
        const merged = applyAcceptedHunks(d.originalContent, d.hunks, resolvedHunks);
        project.updateFileContent(path, merged);
        if (resolvedHunks.every(r => r !== 'pending')) return null;
        return { ...d, resolvedHunks };
      });
      return next.filter(Boolean) as PendingDiff[];
    });
  };

  const handleRejectHunk = (path: string, hunkIdx: number) => {
    setPendingDiffs(prev => {
      const next = prev.map(d => {
        if (d.path !== path) return d;
        const resolvedHunks = [...d.resolvedHunks];
        resolvedHunks[hunkIdx] = 'rejected';
        if (resolvedHunks.every(r => r !== 'pending')) return null;
        return { ...d, resolvedHunks };
      });
      return next.filter(Boolean) as PendingDiff[];
    });
  };

  const handleAcceptAll = (path: string) => {
    const diff = pendingDiffs.find(d => d.path === path);
    if (!diff) return;
    project.updateFileContent(path, diff.newContent);
    setPendingDiffs(prev => prev.filter(d => d.path !== path));
  };

  const handleRejectAll = (path: string) => {
    // File is already at originalContent (reverted in watcher); just clear
    setPendingDiffs(prev => prev.filter(d => d.path !== path));
  };

  const handleToggleReviewMode = () => {
    if (reviewMode && pendingDiffs.length > 0) {
      setShowReviewConfirm(true);
      return;
    }
    setReviewMode(v => !v);
  };

  const handleReviewConfirmAcceptAll = () => {
    pendingDiffs.forEach(d => project.updateFileContent(d.path, d.newContent));
    // Add new files that were held pending
    pendingDiffs
      .filter(d => d.originalContent === '')
      .forEach(d => project.updateFileContent(d.path, d.newContent));
    setPendingDiffs([]);
    setShowReviewConfirm(false);
    setReviewMode(false);
  };

  const handleReviewConfirmRejectAll = () => {
    setPendingDiffs([]);
    setShowReviewConfirm(false);
    setReviewMode(false);
  };
```

- [ ] **Step 6: Clear pendingDiffs when project changes**

Find the `useEffect` that calls `refreshSnapshots()` (around line 350) and add:
```ts
    setPendingDiffs([]);
    beforeSnapshotRef.current = [];
```
inside it, after the existing calls.

- [ ] **Step 7: Wire props to CodePanel**

In the `<CodePanel ...>` JSX, add these props:
```tsx
              reviewMode={reviewMode}
              onToggleReviewMode={handleToggleReviewMode}
              pendingDiffs={pendingDiffs}
              showReviewConfirm={showReviewConfirm}
              onAcceptHunk={handleAcceptHunk}
              onRejectHunk={handleRejectHunk}
              onAcceptAll={handleAcceptAll}
              onRejectAll={handleRejectAll}
              onReviewConfirmAcceptAll={handleReviewConfirmAcceptAll}
              onReviewConfirmRejectAll={handleReviewConfirmRejectAll}
              onReviewConfirmKeep={() => setShowReviewConfirm(false)}
```

- [ ] **Step 8: Guard agent mode when review mode is on**

In `App.tsx`, pass this prop to `<ChatPanel>`:
```tsx
          reviewModeActive={reviewMode}
```

- [ ] **Step 9: Verify TypeScript**

Run: `cd C:\Lovable && npx tsc --noEmit 2>&1 | head -30`
Expected: errors only about missing props on CodePanel/ChatPanel (will fix in Tasks 6 & 7)

- [ ] **Step 10: Commit**

```bash
git add src/App.tsx
git commit -m "feat(diff): review mode state machine in App.tsx"
```

---

## Task 6: CodePanel — toggle button, DiffPanel, tab badges

**Files:**
- Modify: `src/components/CodePanel.tsx`

- [ ] **Step 1: Add imports**

Add to imports at top of `src/components/CodePanel.tsx`:
```ts
import { GitCompare } from 'lucide-react';
import { DiffPanel } from './DiffPanel';
import type { PendingDiff } from '../types';
```

- [ ] **Step 2: Add new props to interface**

Add to the `Props` interface:
```ts
  reviewMode?:                  boolean;
  onToggleReviewMode?:          () => void;
  pendingDiffs?:                PendingDiff[];
  showReviewConfirm?:           boolean;
  onAcceptHunk?:                (path: string, i: number) => void;
  onRejectHunk?:                (path: string, i: number) => void;
  onAcceptAll?:                 (path: string) => void;
  onRejectAll?:                 (path: string) => void;
  onReviewConfirmAcceptAll?:    () => void;
  onReviewConfirmRejectAll?:    () => void;
  onReviewConfirmKeep?:         () => void;
```

- [ ] **Step 3: Destructure new props**

Add to the destructured params of `CodePanel`:
```ts
reviewMode, onToggleReviewMode, pendingDiffs = [], showReviewConfirm,
onAcceptHunk, onRejectHunk, onAcceptAll, onRejectAll,
onReviewConfirmAcceptAll, onReviewConfirmRejectAll, onReviewConfirmKeep,
```

- [ ] **Step 4: Add review mode toggle button to toolbar**

In `<div className="code-actions">`, add this block BEFORE the Code Intelligence buttons:
```tsx
          {/* Review mode toggle */}
          <button
            className={`icon-btn${reviewMode ? ' icon-btn--active' : ''}`}
            onClick={onToggleReviewMode}
            title={reviewMode ? 'Review Mode ON — click to toggle off' : 'Enable Review Mode (hold AI edits for approval)'}
            style={reviewMode ? { color: '#a78bfa' } : undefined}
          >
            <GitCompare size={13} />
          </button>
          {pendingDiffs.length > 1 && (
            <span className="diff-multi-badge">{pendingDiffs.length} pending</span>
          )}
```

- [ ] **Step 5: Add review confirm bar**

After the toolbar `</div>` (closing `code-toolbar`), insert:
```tsx
      {/* Review mode confirm bar — shown when toggling off with pending diffs */}
      {showReviewConfirm && (
        <div className="diff-confirm-bar">
          <span>Unreviewed changes — </span>
          <button className="diff-btn diff-btn--accept" onClick={onReviewConfirmAcceptAll}>Accept all</button>
          <button className="diff-btn diff-btn--reject" onClick={onReviewConfirmRejectAll}>Reject all</button>
          <button className="diff-btn" onClick={onReviewConfirmKeep}>Keep reviewing</button>
        </div>
      )}
```

- [ ] **Step 6: Add ● badge to file tabs with pending diffs**

Find the tab rendering block (around `tabs.map((f) => {`). In the tab button's children, after `{filename(f.path)}`, add:
```tsx
                {pendingDiffs.some(d => d.path === f.path) && (
                  <span className="diff-tab-badge">●</span>
                )}
```

- [ ] **Step 7: Render DiffPanel instead of SyntaxHighlighter when diff pending**

Find the code body section:
```tsx
      {/* Body */}
      <div className="code-body">
        {displayFile ? (
          editMode ? (
```

Replace the entire `{displayFile ? ( ... ) : ( ... )}` block content with:
```tsx
        {(() => {
          const activeDiff = pendingDiffs.find(d => d.path === (activeFilePath || files[0]?.path));
          if (activeDiff && !isStreamingActive) {
            return (
              <DiffPanel
                diff={activeDiff}
                onAcceptHunk={(i) => onAcceptHunk?.(activeDiff.path, i)}
                onRejectHunk={(i) => onRejectHunk?.(activeDiff.path, i)}
                onAcceptAll={() => onAcceptAll?.(activeDiff.path)}
                onRejectAll={() => onRejectAll?.(activeDiff.path)}
              />
            );
          }
          if (displayFile) {
            return editMode ? (
              <textarea
                ref={editorRef}
                className="code-editor-textarea"
                value={editContent}
                onChange={(e) => handleEditorChange(e.target.value)}
                onKeyDown={handleEditorKeyDown}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            ) : (
              <SyntaxHighlighter
                language={displayFile.lang}
                style={forgeTheme}
                showLineNumbers
                lineNumberStyle={{
                  color: 'var(--t4)', fontSize: '11px',
                  paddingRight: '18px', userSelect: 'none', minWidth: '2.5em',
                }}
                wrapLines
              >
                {displayFile.content}
              </SyntaxHighlighter>
            );
          }
          return (
            <div className="code-placeholder">
              {isGenerating ? (
                <div className="code-generating">
                  <span className="gen-ring" />
                  Generating…
                </div>
              ) : (
                <>
                  <FileCode size={28} style={{ opacity: .18 }} />
                  <span>Code will appear here</span>
                </>
              )}
            </div>
          );
        })()}
```

- [ ] **Step 8: Verify TypeScript**

Run: `cd C:\Lovable && npx tsc --noEmit 2>&1 | head -30`
Expected: errors about `reviewModeActive` on ChatPanel (will fix next), otherwise clean

- [ ] **Step 9: Commit**

```bash
git add src/components/CodePanel.tsx
git commit -m "feat(diff): review mode toggle and DiffPanel in CodePanel"
```

---

## Task 7: ChatPanel — agent guard when review mode active

**Files:**
- Modify: `src/components/ChatPanel.tsx`

- [ ] **Step 1: Add reviewModeActive prop**

Add to `Props` interface:
```ts
  reviewModeActive?: boolean;
```

Add to destructured params:
```ts
  reviewModeActive,
```

- [ ] **Step 2: Disable agent mode button when review mode is on**

Find where `CHAT_MODES.map` renders buttons in the mode bar. The button for `id === 'agent'` should be disabled when `reviewModeActive` is true. Replace the map with:

```tsx
        {CHAT_MODES.map((m) => {
          const isAgentBlocked = m.id === 'agent' && reviewModeActive;
          return (
            <button
              key={m.id}
              className={`chat-mode-btn${chatMode === m.id ? ' active' : ''}${isAgentBlocked ? ' disabled' : ''}`}
              onClick={() => !isAgentBlocked && onChatModeChange?.(m.id)}
              title={isAgentBlocked ? 'Disable Review Mode to use Agent' : m.hint}
              style={isAgentBlocked ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
            >
              {m.icon}
              {m.label}
            </button>
          );
        })}
```

- [ ] **Step 3: Verify TypeScript**

Run: `cd C:\Lovable && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/components/ChatPanel.tsx
git commit -m "feat(diff): disable agent mode when review mode active"
```

---

## Task 8: CSS — diff panel styles

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Add diff styles**

Append to `src/index.css`:
```css
/* ── Inline Diff Panel ─────────────────────────────────────── */
.diff-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: #040406;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
}
.diff-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #0d0d1a;
  border-bottom: 1px solid #1a1a2e;
  flex-shrink: 0;
}
.diff-filename { color: var(--t1); font-weight: 600; font-size: 12px; }
.diff-count    { color: var(--t3); font-size: 11px; margin-right: auto; }
.diff-toolbar-actions { display: flex; gap: 6px; }
.diff-btn {
  padding: 3px 10px;
  border-radius: 4px;
  border: none;
  font-size: 11px;
  cursor: pointer;
  background: #1a1a2e;
  color: var(--t2);
  transition: opacity .15s;
}
.diff-btn:disabled { opacity: .35; cursor: default; }
.diff-btn--accept { background: rgba(34,197,94,.15); color: #22c55e; }
.diff-btn--reject { background: rgba(239,68,68,.12); color: #ef4444; }
.diff-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}
.diff-col {
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  padding: 8px 0;
}
.diff-col--before { border-right: 1px solid #1a1a2e; }
.diff-line {
  padding: 0 12px;
  line-height: 1.75;
  white-space: pre;
  min-height: 1.75em;
}
.diff-line--context { color: #555570; }
.diff-line--remove  { background: rgba(239,68,68,.08); color: #ef4444; }
.diff-line--add     { background: rgba(34,197,94,.08); color: #22c55e; }
.diff-line--pad     { background: rgba(0,0,0,.2); }
.diff-gutter { display: inline-block; width: 14px; opacity: .7; }
.diff-hunk-block { position: relative; }
.diff-hunk-block--resolved { opacity: .5; }
.diff-hunk-actions {
  display: flex;
  gap: 6px;
  padding: 4px 12px;
  background: #0d0d1a;
}
.diff-hunk-btn {
  padding: 2px 8px;
  border-radius: 4px;
  border: none;
  font-size: 10px;
  cursor: pointer;
}
.diff-hunk-btn--accept { background: rgba(34,197,94,.2); color: #22c55e; }
.diff-hunk-btn--reject { background: rgba(239,68,68,.15); color: #ef4444; }
.diff-resolved {
  padding: 2px 12px;
  font-size: 10px;
}
.diff-resolved--accepted { color: #22c55e; }
.diff-resolved--rejected { color: #ef4444; }

/* Tab badge */
.diff-tab-badge { color: #a78bfa; font-size: 8px; margin-left: 3px; line-height: 1; }

/* Multi-file pending badge */
.diff-multi-badge {
  font-size: 10px;
  color: #a78bfa;
  background: rgba(124,58,237,.15);
  padding: 1px 6px;
  border-radius: 10px;
}

/* Review confirm bar */
.diff-confirm-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(124,58,237,.12);
  border-bottom: 1px solid rgba(124,58,237,.3);
  font-size: 11px;
  color: #a78bfa;
  flex-shrink: 0;
}

/* Active state for review mode toggle button */
.icon-btn--active { color: #a78bfa !important; }
```

- [ ] **Step 2: Final TypeScript check**

Run: `cd C:\Lovable && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors

- [ ] **Step 3: Run all tests**

Run: `cd C:\Lovable && npx vitest run 2>&1 | tail -20`
Expected: all tests pass

- [ ] **Step 4: Final commit**

```bash
git add src/index.css
git commit -m "feat(diff): diff panel CSS styles"
```

---

## Verification Checklist

1. **Review mode off (default)**: Click the `GitCompare` icon in CodePanel toolbar — it should highlight purple. Icon stays purple.
2. **Build + review**: Type a prompt in Build mode, send. While AI streams, normal view shows. When done, CodePanel switches to split diff view. Left = before (red), right = after (green).
3. **Per-hunk accept**: Click "✓ Accept" on one hunk — that hunk dims and shows "✓ accepted". File is updated with just that hunk.
4. **Per-hunk reject**: Click "✕ Reject" — hunk dims, file stays at original for that range.
5. **Accept all**: Click "Accept all" in toolbar — all hunks accepted, diff panel disappears, normal view returns.
6. **Reject all**: Click "Reject all" — all hunks rejected, diff panel clears, file unchanged.
7. **Multi-file**: Ask AI to change 2 files — both tabs show ● badge. Clicking each tab shows that file's diff.
8. **Toggle off with pending**: While diff pending, click the review toggle — confirm bar appears with Accept all / Reject all / Keep reviewing.
9. **Agent blocked**: With review mode on, the Agent button in chat mode bar is greyed out with correct tooltip.
10. **New file**: Ask AI to create a file in review mode — it appears in pending diffs as all-green. Accept adds it; reject means it never appears.
