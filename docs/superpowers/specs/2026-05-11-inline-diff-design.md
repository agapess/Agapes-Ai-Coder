# Inline Diff — Accept/Reject AI Edits — Design Spec

**Date:** 2026-05-11
**Status:** Approved

---

## Goal

Give users a way to review, accept, and reject AI-generated file changes before they are applied — per hunk, with an optional "Accept all / Reject all" shortcut — using a split before/after panel inside the CodePanel.

---

## Design Decisions

| Decision | Choice |
|---|---|
| Layout | Split panel — before (left) / after (right) |
| Trigger | Toggleable "Review Mode" in CodePanel toolbar |
| Granularity | Per-hunk, with Accept all / Reject all at top |

---

## Architecture Overview

Review Mode is an opt-in toggle. When off (default), AI edits apply instantly as today. When on, every AI-generated file change is held as a pending diff that the user must explicitly accept or reject before it is written to state.

The diff computation is client-side only, with no new server endpoints and no additional npm dependencies. A simple line-level Myers-style diff is implemented in `src/hooks/useDiff.ts`.

---

## Data Types (`src/types.ts`)

```ts
export interface DiffHunk {
  type:       'equal' | 'add' | 'remove' | 'replace';
  beforeLines: string[];  // lines from original (empty for pure adds)
  afterLines:  string[];  // lines from new version (empty for pure removes)
  beforeStart: number;    // 1-based line number in original
  afterStart:  number;    // 1-based line number in new version
}

export interface PendingDiff {
  path:            string;
  lang:            string;
  originalContent: string;       // content before AI edit
  newContent:      string;       // content AI produced
  hunks:           DiffHunk[];   // computed diff hunks
  resolvedHunks:   ('accepted' | 'rejected' | 'pending')[];
}
```

---

## File Map

| File | Change |
|---|---|
| `src/types.ts` | Add `DiffHunk`, `PendingDiff` types |
| `src/hooks/useDiff.ts` | NEW — `computeHunks(before, after): DiffHunk[]` |
| `src/components/DiffPanel.tsx` | NEW — split before/after view with per-hunk accept/reject |
| `src/components/CodePanel.tsx` | Review mode toggle button; DiffPanel when diffs pending; tab badges |
| `src/App.tsx` | `reviewMode` state; `beforeSnapshotRef`; `pendingDiffs` state; watcher effect; accept/reject handlers |
| `src/index.css` | Diff panel styles |

---

## `src/hooks/useDiff.ts`

Pure utility — no React state. Implements line-level diff:

1. Split both strings by `\n` into line arrays.
2. Run LCS (longest common subsequence) to find equal regions.
3. Group consecutive non-equal regions into hunks, each padded with 3 lines of context above and below.
4. Return `DiffHunk[]`.

Export: `computeHunks(before: string, after: string): DiffHunk[]`

---

## `src/components/DiffPanel.tsx`

Props:
```ts
interface DiffPanelProps {
  diff:          PendingDiff;
  onAcceptHunk:  (i: number) => void;
  onRejectHunk:  (i: number) => void;
  onAcceptAll:   () => void;
  onRejectAll:   () => void;
}
```

Layout:
- Top bar: filename, "N changes", "Accept all" (green), "Reject all" (red).
- Body: two-column split. Left = before (red deletions), right = after (green additions).
- Context lines rendered in muted color.
- Each changed hunk has an "Accept" chip on the right column. Accepted hunks show a checkmark and dim. Rejected hunks are crossed out.
- Scroll is synchronised between left and right columns.

---

## `src/App.tsx` Changes

### State & Refs

```ts
const [reviewMode,   setReviewMode]   = useState(false);
const [pendingDiffs, setPendingDiffs] = useState<PendingDiff[]>([]);
const beforeSnapshotRef = useRef<GeneratedFile[]>([]);
```

### Capturing snapshot before send

In `handleSend`, at the very top (before any logic), when `reviewMode` is true:
```ts
if (reviewMode) {
  beforeSnapshotRef.current = project.files.map(f => ({ ...f }));
}
```

### Watcher effect — fires when generation finishes

```ts
useEffect(() => {
  if (!reviewMode) return;
  if (project.isGenerating) return;
  const before = beforeSnapshotRef.current;
  if (before.length === 0) return;

  const diffs: PendingDiff[] = [];
  for (const newFile of project.files) {
    const orig = before.find(f => f.path === newFile.path);
    const origContent = orig?.content ?? '';
    if (origContent === newFile.content) continue; // unchanged

    const hunks = computeHunks(origContent, newFile.content);
    diffs.push({
      path: newFile.path,
      lang: newFile.lang,
      originalContent: origContent,
      newContent: newFile.content,
      hunks,
      resolvedHunks: hunks.map(() => 'pending'),
    });

    // Revert this file to its pre-AI state
    project.updateFileContent(newFile.path, origContent);
  }

  // Handle brand-new files (no "before" entry)
  for (const newFile of project.files) {
    const existed = before.find(f => f.path === newFile.path);
    if (!existed) {
      const hunks = computeHunks('', newFile.content);
      diffs.push({
        path: newFile.path, lang: newFile.lang,
        originalContent: '', newContent: newFile.content,
        hunks, resolvedHunks: hunks.map(() => 'pending'),
      });
      // Remove newly created file until accepted
      project.removeFile(newFile.path);
    }
  }

  if (diffs.length > 0) setPendingDiffs(diffs);
  beforeSnapshotRef.current = [];
}, [project.isGenerating]);
```

### Accept / Reject handlers

```ts
const handleAcceptHunk = (path: string, hunkIdx: number) => {
  setPendingDiffs(prev => prev.map(d => {
    if (d.path !== path) return d;
    const resolved = [...d.resolvedHunks];
    resolved[hunkIdx] = 'accepted';
    // Apply: recompute merged content from accepted hunks and update file
    const merged = applyAcceptedHunks(d, resolved);
    project.updateFileContent(path, merged);
    if (resolved.every(r => r !== 'pending')) {
      return null as unknown as PendingDiff; // will be filtered
    }
    return { ...d, resolvedHunks: resolved };
  }).filter(Boolean));
};

const handleRejectHunk = (path: string, hunkIdx: number) => { /* similar, marks 'rejected', no file update */ };

const handleAcceptAll = (path: string) => {
  const diff = pendingDiffs.find(d => d.path === path);
  if (!diff) return;
  project.updateFileContent(path, diff.newContent);
  setPendingDiffs(prev => prev.filter(d => d.path !== path));
};

const handleRejectAll = (path: string) => {
  // File stays at original (already reverted); just clear the pending diff
  setPendingDiffs(prev => prev.filter(d => d.path !== path));
};
```

`applyAcceptedHunks(diff, resolved)`: walks hunks in order — accepted hunks contribute their `afterLines`, rejected hunks contribute their `beforeLines`, equal hunks contribute unchanged lines. Joins with `\n`.

### Review mode toggle with pending diffs guard

When `reviewMode` is true and user clicks the toggle off:
- If `pendingDiffs.length > 0`: show an inline confirmation row in the toolbar: "Unreviewed changes — [Accept all] [Reject all] [Keep reviewing]"
- If no pending diffs: toggle off immediately.

### Multi-file pending

When `pendingDiffs.length > 1`, show an additional toolbar row in CodePanel:
- "N files pending review" label
- "Accept all files" → accepts all hunks in all pending files
- "Reject all files" → rejects all

### Agent mode guard

When `reviewMode` is true, the Agent mode button in the chat mode bar is disabled (greyed out, tooltip: "Disable Review Mode to use Agent").

---

## `src/components/CodePanel.tsx` Changes

- **Review mode toggle button**: in `<div className="code-actions">`, before the Code Intelligence buttons. Icon: `GitCompare` (or `Diff`) from lucide-react. Purple when active. Props: `reviewMode`, `onToggleReviewMode`, `pendingDiffs`.
- **Rendering**: when `pendingDiffs` has an entry for the active file and `!isStreamingActive`, render `<DiffPanel>` instead of `<SyntaxHighlighter>`.
- **Tab badges**: file tabs get a `●` indicator when that file has a pending diff.
- **Props added**:
  ```ts
  reviewMode?:         boolean;
  onToggleReviewMode?: () => void;
  pendingDiffs?:       PendingDiff[];
  onAcceptHunk?:       (path: string, i: number) => void;
  onRejectHunk?:       (path: string, i: number) => void;
  onAcceptAll?:        (path: string) => void;
  onRejectAll?:        (path: string) => void;
  ```

---

## `useProject.ts` — `removeFile`

A small new method needed to revert newly-created files:
```ts
const removeFile = useCallback((path: string) => {
  setFiles(prev => prev.filter(f => f.path !== path));
}, []);
```

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| Agent mode + review mode on | Agent mode button disabled; tooltip explains conflict |
| New file (no before) | Whole file shown as green additions; reject = file never added |
| Switching projects | `pendingDiffs` cleared on `projectId` change |
| Toggle off with pending diffs | Inline confirmation row: Accept all / Reject all / Keep reviewing |
| Multi-file AI edit | All changed files get pending diffs; tab badges; bulk Accept/Reject all files |
| Streaming in progress | Normal streaming view shown; diff computed only after `isGenerating → false` |

---

## CSS

New classes in `src/index.css`:
- `.diff-panel` — two-column split layout
- `.diff-col` — each column, `overflow-y: auto`, synchronized scroll via JS
- `.diff-line`, `.diff-line--add`, `.diff-line--remove`, `.diff-line--context`
- `.diff-hunk` — wraps a changed block
- `.diff-hunk-accept` — per-hunk accept chip (top-right of right column)
- `.diff-toolbar` — top bar with filename + Accept all / Reject all
- `.diff-badge` — `●` dot on file tabs
- `.review-mode-active` — purple highlight state for toggle button
