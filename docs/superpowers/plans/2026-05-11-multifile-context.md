# Multi-File Chat Context — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users attach project files to chat messages so the AI sees their content as explicit context.

**Architecture:** Attachments live in ChatPanel state, cleared on send. File contents are prepended to the prompt string in App.tsx before reaching the AI. A `displayContent` param on `sendMessage` keeps the chat bubble clean.

**Tech Stack:** React 18 + TypeScript, lucide-react icons, no new dependencies.

---

### Task 1: Add `displayContent` to `sendMessage` in `useProject.ts`

**Files:**
- Modify: `src/hooks/useProject.ts` (lines 275–460)

This makes the chat bubble show friendly text (e.g. `message\n\n[Attached: file.js]`) while the AI receives the full prompt with file contents prepended.

- [ ] **Step 1: Add the param and update userMsg**

In `sendMessage`, change the signature and the `userMsg` creation:

```ts
// Old:
const sendMessage = useCallback(async (userContent: string, imageData?: string, endpoint = '/api/generate', merge = false) => {
  ...
  const userMsg: Message = {
    id: crypto.randomUUID(), role: 'user',
    content: userContent, timestamp: new Date(),
  };

// New:
const sendMessage = useCallback(async (userContent: string, imageData?: string, endpoint = '/api/generate', merge = false, displayContent?: string) => {
  ...
  const userMsg: Message = {
    id: crypto.randomUUID(), role: 'user',
    content: displayContent ?? userContent, timestamp: new Date(),
  };
```

The `streamRequest` and all downstream logic still use `userContent` (the full prompt). Only the stored message bubble uses `displayContent`.

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd /c/Lovable && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors related to `sendMessage`.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useProject.ts
git commit -m "feat: add displayContent param to sendMessage for clean chat bubbles"
```

---

### Task 2: Update `App.tsx` — attachment context injection

**Files:**
- Modify: `src/App.tsx` (lines 77–140)

- [ ] **Step 1: Add `buildAttachmentContext` helper and update `handleSend`**

Replace the existing `handleSend` function (lines 77–140) entirely with:

```ts
function buildAttachmentContext(paths: string[], files: import('./types').GeneratedFile[]): string {
  const attached = paths.map((p) => files.find((f) => f.path === p)).filter(Boolean) as import('./types').GeneratedFile[];
  if (attached.length === 0) return '';
  const MAX = 6000;
  const blocks = attached.map(
    (f) => `=== ${f.path} ===\n${f.content.slice(0, MAX)}${f.content.length > MAX ? '\n...(truncated)' : ''}`
  );
  return `[Attached files]\n${blocks.join('\n\n')}\n\n`;
}

// inside App() component, replace handleSend:
const handleSend = async (text: string, imageData?: string, attachedFilePaths: string[] = []) => {
  const attachCtx = buildAttachmentContext(attachedFilePaths, project.files);
  const displayText = attachedFilePaths.length > 0
    ? `${text}\n\n[Attached: ${attachedFilePaths.map((p) => p.split('/').pop()).join(', ')}]`
    : undefined;

  const activeFile = project.files.find((f) => f.path === project.activeFilePath) ?? project.files[0];

  // Non-build modes → conversational endpoint, inject active file as context
  if (chatMode !== 'build') {
    const MODE_PREFIXES: Partial<Record<ChatModeType, string>> = {
      chat:     '',
      explain:  'Explain the following code in clear terms:\n\n',
      debug:    'Help me find and fix this bug or error in this code:\n\n',
      refactor: 'Suggest improvements and refactor this code:\n\n',
    };
    const prefix = MODE_PREFIXES[chatMode] ?? '';
    const fileCtx = activeFile
      ? `\n\nFile: ${activeFile.path}\n\`\`\`\n${activeFile.content.slice(0, 6000)}\n\`\`\`\n\nUser message: `
      : '';
    const aiText = chatMode === 'chat'
      ? (attachCtx ? `${attachCtx}User message: ${text}` : text)
      : `${attachCtx}${prefix}${fileCtx}${text}`;
    project.sendMessage(aiText, imageData, '/api/chat', false, displayText);
    return;
  }

  // Build mode with image → generate directly
  if (imageData) {
    const aiText = attachCtx ? `${attachCtx}User message: ${text}` : text;
    project.sendMessage(aiText, imageData, undefined, undefined, displayText);
    return;
  }

  // Build mode, follow-up on existing project → include current files, merge result
  if (project.files.length > 0 || project.llmConfig.skipPlanning) {
    if (project.files.length > 0) {
      const MAX_CHARS = 4000;
      const fileContext = project.files
        .map((f) => `<forge-file path="${f.path}" lang="${f.lang}">\n${f.content.slice(0, MAX_CHARS)}${f.content.length > MAX_CHARS ? '\n...(truncated)' : ''}\n</forge-file>`)
        .join('\n\n');
      const fullPrompt = `${attachCtx}Current project files:\n\n${fileContext}\n\nUser request: ${text}`;
      project.sendMessage(fullPrompt, undefined, '/api/generate', true, displayText);
    } else {
      const aiText = attachCtx ? `${attachCtx}User message: ${text}` : text;
      project.sendMessage(aiText, undefined, undefined, undefined, displayText);
    }
    return;
  }

  // Build mode, fresh project → show planner
  const aiText = attachCtx ? `${attachCtx}User message: ${text}` : text;
  setPendingPrompt(aiText);
  setIsPlanLoading(true);
  try {
    const res = await fetch('/api/plan', {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({
        messages:  [{ role: 'user', content: aiText }],
        llmConfig: project.llmConfig,
      }),
    });
    if (!res.ok) throw new Error('plan failed');
    const { plan } = await res.json();
    setPendingPlan(plan);
  } catch {
    project.sendMessage(aiText, undefined, undefined, undefined, displayText);
  } finally {
    setIsPlanLoading(false);
  }
};
```

Note: `buildAttachmentContext` is a module-level function (outside `App()`). The `import('./types').GeneratedFile[]` types should be imported at top — just use `GeneratedFile` since it's already imported via `import type { ViewMode, ProjectPlan } from './types'`. Add `GeneratedFile` to that import.

- [ ] **Step 2: Add `GeneratedFile` to the types import in App.tsx**

Change line 19:
```ts
// Old:
import type { ViewMode, ProjectPlan } from './types';
// New:
import type { ViewMode, ProjectPlan, GeneratedFile } from './types';
```

And update `buildAttachmentContext` signature to use the imported type directly:
```ts
function buildAttachmentContext(paths: string[], files: GeneratedFile[]): string {
```

- [ ] **Step 3: Pass `files` prop to ChatPanel and update `onSend` type**

In the `<ChatPanel ...>` JSX (around line 384), add the `files` prop:
```tsx
<ChatPanel
  files={project.files}          {/* ADD THIS LINE */}
  messages={project.messages}
  ...
  onSend={handleSend}
  ...
/>
```

- [ ] **Step 4: TypeScript check**

```bash
cd /c/Lovable && npx tsc --noEmit 2>&1 | head -30
```

Fix any type errors (likely `onSend` prop mismatch — will be resolved once ChatPanel is updated in Task 3).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: inject attached-file context into AI prompts in handleSend"
```

---

### Task 3: Update `ChatPanel.tsx` — UI for file attachment

**Files:**
- Modify: `src/components/ChatPanel.tsx`

This is the largest task. We add the `@` mention popup, file-attach dropdown, and attachment chips.

- [ ] **Step 1: Add new lucide icons to the import**

Change the lucide import line from:
```ts
import { Send, Square, Zap, Mic, MicOff, Paperclip, MessageSquare, Hammer, Bug, BookOpen, Wrench, Globe, Wand2, Puzzle, FlaskConical, FileText, Shield, Rocket, GitBranch, TestTube } from 'lucide-react';
```
to:
```ts
import { Send, Square, Zap, Mic, MicOff, Paperclip, MessageSquare, Hammer, Bug, BookOpen, Wrench, Globe, Wand2, Puzzle, FlaskConical, FileText, Shield, Rocket, GitBranch, TestTube, FolderOpen, X } from 'lucide-react';
```

- [ ] **Step 2: Add `GeneratedFile` type import**

Change:
```ts
import type { Message, LLMProvider, ProjectPlan } from '../types';
```
to:
```ts
import type { Message, LLMProvider, ProjectPlan, GeneratedFile } from '../types';
```

- [ ] **Step 3: Update Props interface**

Add `files` prop and update `onSend`:
```ts
interface Props {
  // ... existing props ...
  files?:               GeneratedFile[];          // ADD
  onSend:               (text: string, imageData?: string, attachedFilePaths?: string[]) => void;  // UPDATE
  // ... rest unchanged ...
}
```

- [ ] **Step 4: Add new state variables and refs**

After the existing state declarations inside `ChatPanel` (after `const [showTools, setShowTools] = useState(false);`), add:
```ts
const [attachedFiles,  setAttachedFiles]  = useState<string[]>([]);
const [atQuery,        setAtQuery]        = useState<string | null>(null);
const [atHighlight,    setAtHighlight]    = useState(0);
const [showFilePicker, setShowFilePicker] = useState(false);
const filePickerRef = useRef<HTMLDivElement>(null);
```

Also add `files = []` to destructured props:
```ts
export function ChatPanel({
  files = [],
  messages,
  // ...rest unchanged
}: Props) {
```

- [ ] **Step 5: Add @ detection to textarea onChange**

Replace the textarea `onChange` handler from:
```tsx
onChange={(e) => setInput(e.target.value)}
```
to:
```tsx
onChange={(e) => {
  const val = e.target.value;
  setInput(val);
  const m = val.match(/@([\w./\-]*)$/);
  if (m) {
    setAtQuery(m[1]);
    setAtHighlight(0);
  } else {
    setAtQuery(null);
  }
}}
```

- [ ] **Step 6: Update `handleKey` to intercept arrow keys when @ popup is open**

Replace the existing `handleKey` function:
```ts
const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
  if (atQuery !== null) {
    const filtered = files.filter((f) => f.path.toLowerCase().includes(atQuery.toLowerCase())).slice(0, 8);
    if (e.key === 'ArrowDown') { e.preventDefault(); setAtHighlight((h) => Math.min(h + 1, filtered.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setAtHighlight((h) => Math.max(h - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[atHighlight]) addFileFromAt(filtered[atHighlight].path);
      return;
    }
    if (e.key === 'Escape') { setAtQuery(null); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSubmit();
  }
};
```

- [ ] **Step 7: Add helper functions for file attachment**

After the `handleKey` definition:
```ts
const addFileFromAt = (path: string) => {
  if (!attachedFiles.includes(path)) setAttachedFiles((p) => [...p, path]);
  setInput((prev) => prev.replace(/@[\w./\-]*$/, ''));
  setAtQuery(null);
};

const toggleFilePicker = (path: string) => {
  setAttachedFiles((prev) =>
    prev.includes(path) ? prev.filter((p) => p !== path) : prev.length < 10 ? [...prev, path] : prev
  );
};

const removeAttached = (path: string) => setAttachedFiles((prev) => prev.filter((p) => p !== path));
```

- [ ] **Step 8: Update `handleSubmit` to pass attachments**

Replace:
```ts
const handleSubmit = (e?: FormEvent) => {
  e?.preventDefault();
  const text = input.trim();
  if (!text || isGenerating) return;
  onSend(text);
  setInput('');
};
```
with:
```ts
const handleSubmit = (e?: FormEvent) => {
  e?.preventDefault();
  const text = input.trim();
  if (!text && attachedFiles.length === 0) return;
  if (isGenerating) return;
  onSend(text, undefined, attachedFiles.length > 0 ? attachedFiles : undefined);
  setInput('');
  setAttachedFiles([]);
  setAtQuery(null);
  setShowFilePicker(false);
};
```

- [ ] **Step 9: Add click-outside effect for file picker**

After the existing `useEffect` hooks:
```ts
useEffect(() => {
  if (!showFilePicker) return;
  const handler = (e: MouseEvent) => {
    if (filePickerRef.current && !filePickerRef.current.contains(e.target as Node)) {
      setShowFilePicker(false);
    }
  };
  document.addEventListener('mousedown', handler);
  return () => document.removeEventListener('mousedown', handler);
}, [showFilePicker]);
```

- [ ] **Step 10: Add the UI elements — @ popup, chips row, file picker button**

In the JSX, inside the `<form className="chat-input-wrap">` and before the `<textarea>`, add the `@` mention popup. The popup should be positioned relative to the textarea. Add it as a sibling div above the textarea:

```tsx
{/* @ mention popup */}
{atQuery !== null && (() => {
  const filtered = files
    .filter((f) => f.path.toLowerCase().includes(atQuery.toLowerCase()))
    .slice(0, 8);
  return (
    <div className="at-mention-popup">
      {filtered.length === 0 ? (
        <div className="at-mention-item at-mention-item--empty">No files match</div>
      ) : filtered.map((f, i) => (
        <button
          key={f.path}
          type="button"
          className={`at-mention-item${i === atHighlight ? ' selected' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); addFileFromAt(f.path); }}
        >
          {f.path}
        </button>
      ))}
    </div>
  );
})()}
```

After the textarea and before `<div className="input-row">`, add the chips row:

```tsx
{/* Attached file chips */}
{attachedFiles.length > 0 && (
  <div className="file-chips">
    {attachedFiles.map((path) => (
      <div key={path} className="file-chip">
        <span className="file-chip-name">{path.split('/').pop()}</span>
        <button
          type="button"
          className="file-chip-remove"
          onClick={() => removeAttached(path)}
          title={`Remove ${path}`}
        >
          <X size={10} />
        </button>
      </div>
    ))}
  </div>
)}
```

In the `<div className="input-row">`, add the file-attach button after the existing Paperclip button (or after the mic button if no vision support). Place it before the Tools button:

```tsx
{/* File-attach button */}
<div className="file-attach-wrap" ref={filePickerRef} style={{ position: 'relative' }}>
  <button
    type="button"
    className={`attachment-btn${showFilePicker ? ' active' : ''}`}
    onClick={() => setShowFilePicker((v) => !v)}
    disabled={isGenerating || isPlanLoading || !!pendingPlan}
    title="Attach project files"
  >
    <FolderOpen size={13} />
  </button>
  {showFilePicker && (
    <div className="file-picker-dropdown">
      {files.length === 0 ? (
        <div className="file-picker-empty">No files in project</div>
      ) : files.map((f) => {
        const checked = attachedFiles.includes(f.path);
        const disabled = !checked && attachedFiles.length >= 10;
        return (
          <label
            key={f.path}
            className={`file-picker-item${disabled ? ' disabled' : ''}`}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => toggleFilePicker(f.path)}
            />
            <span>{f.path}</span>
          </label>
        );
      })}
    </div>
  )}
</div>
```

- [ ] **Step 11: TypeScript check**

```bash
cd /c/Lovable && npx tsc --noEmit 2>&1 | head -30
```

Fix any type errors.

- [ ] **Step 12: Commit**

```bash
git add src/components/ChatPanel.tsx
git commit -m "feat: add file attachment UI to ChatPanel (@mention + picker + chips)"
```

---

### Task 4: Add CSS for new UI elements

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Append styles after the existing `.tools-panel` / `.tool-chip` block**

Find the end of `.tool-chip:hover { ... }` block (around line 1656) and add after it:

```css
/* ── File attachment chips ───────────────────────────────────── */
.file-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.file-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  background: var(--overlay);
  border: 1px solid var(--b3);
  border-radius: 12px;
  font-size: 11px;
  color: var(--t2);
}
.file-chip-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-chip-remove {
  display: flex; align-items: center; justify-content: center;
  padding: 1px;
  border-radius: 50%;
  color: var(--t4);
  transition: color var(--t-xs);
}
.file-chip-remove:hover { color: var(--err); }

/* ── @ mention popup ─────────────────────────────────────────── */
.at-mention-popup {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0; right: 0;
  background: var(--panel);
  border: 1px solid var(--b3);
  border-radius: var(--r);
  box-shadow: 0 4px 16px rgba(0,0,0,.4);
  max-height: 220px;
  overflow-y: auto;
  z-index: 200;
}
.at-mention-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 11px;
  font-size: 12px;
  color: var(--t2);
  transition: background var(--t-xs);
}
.at-mention-item:hover,
.at-mention-item.selected { background: var(--overlay); color: var(--t1); }
.at-mention-item--empty { color: var(--t4); cursor: default; }

/* ── File picker dropdown ────────────────────────────────────── */
.file-attach-wrap { position: relative; }
.file-picker-dropdown {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  min-width: 220px;
  max-height: 260px;
  overflow-y: auto;
  background: var(--panel);
  border: 1px solid var(--b3);
  border-radius: var(--r);
  box-shadow: 0 4px 16px rgba(0,0,0,.4);
  z-index: 200;
  padding: 4px 0;
}
.file-picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 11px;
  font-size: 12px;
  color: var(--t2);
  cursor: pointer;
  transition: background var(--t-xs);
}
.file-picker-item:hover { background: var(--overlay); color: var(--t1); }
.file-picker-item.disabled { opacity: 0.45; cursor: not-allowed; }
.file-picker-item input[type="checkbox"] { flex-shrink: 0; accent-color: var(--fire); }
.file-picker-empty { padding: 10px 11px; font-size: 12px; color: var(--t4); }
```

The `at-mention-popup` needs `position: relative` on its parent to anchor correctly. The `<form className="chat-input-wrap">` needs `position: relative`. Add that:

```css
.chat-input-wrap { position: relative; /* add this */ }
```

Find the existing `.chat-input-wrap` rule and add `position: relative;` to it.

- [ ] **Step 2: TypeScript + build check**

```bash
cd /c/Lovable && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat: add CSS for file attachment chips, @ popup, and file picker"
```

---

## Verification

1. Open the app. Generate a project with 2+ files.
2. In the chat textarea, type `@` → popup appears listing project files.
3. Type more characters → popup filters. Arrow keys move highlight. Enter selects.
4. Selected file appears as a chip below the textarea.
5. Click the folder icon → dropdown shows all files with checkboxes.
6. Check a file → chip appears. Uncheck → chip removed.
7. Click `×` on a chip → chip removed.
8. Send the message → chips clear. Chat bubble shows `message\n\n[Attached: filename.js]`.
9. AI receives the file content as context (visible if you check the server request body).
10. With no text and at least one chip → send is still allowed (just attachments, no message text).
11. Max 10 files: after 10 chips, file picker disables remaining unchecked items.
