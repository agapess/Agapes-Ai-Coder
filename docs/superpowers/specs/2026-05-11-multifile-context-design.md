# Multi-File Chat Context — Design Spec

**Goal:** Let users attach project files to chat messages so the AI sees their content as explicit context, usable as reference or edit targets.

**Architecture:** Attachments live entirely in `ChatPanel` state, cleared on send. The file content is prepended to the prompt string before it reaches the AI — no new API endpoints needed. `App.tsx` receives the attached file paths alongside the message text and builds the context block before calling `sendMessage`.

**Tech Stack:** React 18 + TypeScript, lucide-react icons, no new dependencies.

---

## How It Works End-to-End

1. User types `@` in the chat textarea → a popup appears listing project files filtered by the text after `@`. Selecting a file adds it to the attachment chips and removes `@{query}` from the text.
2. User clicks the file-attach button (folder icon) → a dropdown lists all project files with checkboxes. Ticking/unticking adds/removes from chips.
3. Chips appear below the textarea, above the action row. Each chip shows the filename with an `×` remove button.
4. On send: attached file contents are prepended to the message as a context block. Chips clear.
5. The message stored in chat history shows `[Attached: file1.js, file2.css]` as a suffix so the user knows what was sent.

---

## Components

### `ChatPanel.tsx` changes

**New props:**
- `files: GeneratedFile[]` — the project's current file list (for the picker)

**New state:**
- `attachedFiles: string[]` — array of attached file paths (cleared on send)
- `atQuery: string | null` — text after `@` being typed; `null` when no active `@` mention
- `showFilePicker: boolean` — whether the paperclip dropdown is open

**`@` mention detection** (in `onChange` for the textarea):
```ts
const match = value.match(/@([\w./]*)$/);
if (match) {
  setAtQuery(match[1]);
} else {
  setAtQuery(null);
}
```

**On `@` file select:**
```ts
const addFile = (path: string) => {
  if (!attachedFiles.includes(path)) setAttachedFiles((p) => [...p, path]);
  // Remove @{query} from end of input
  setInput((prev) => prev.replace(/@[\w./]*$/, ''));
  setAtQuery(null);
};
```

**On send:**
```ts
const handleSubmit = () => {
  const text = input.trim();
  if (!text && attachedFiles.length === 0) return;
  onSend(text, undefined, attachedFiles);
  setInput('');
  setAttachedFiles([]);
  setAtQuery(null);
  setShowFilePicker(false);
};
```

**New UI elements:**
- `AtMentionPopup` — inline component, renders above textarea when `atQuery !== null`. Shows filtered file list (max 8, scrollable). Arrow-key + Enter navigable.
- File-attach button — folder icon (`FolderOpen` from lucide), opens/closes `showFilePicker` dropdown. Sits in the `input-row` beside the existing paperclip.
- `FilePickerDropdown` — inline component, renders below the file-attach button. Lists all files with `<input type="checkbox">`. Clicking outside closes it.
- Chips row — rendered between textarea and `input-row`. Each chip: `filename × `. Hidden when `attachedFiles` is empty.

### `App.tsx` changes

**`handleSend` signature change:**
```ts
const handleSend = async (text: string, imageData?: string, attachedFilePaths: string[] = []) => {
```

**Context injection for attached files:**
```ts
function buildAttachmentContext(paths: string[], files: GeneratedFile[]): string {
  const attached = paths
    .map((p) => files.find((f) => f.path === p))
    .filter(Boolean) as GeneratedFile[];
  if (attached.length === 0) return '';
  const MAX = 6000;
  const blocks = attached.map(
    (f) => `=== ${f.path} ===\n${f.content.slice(0, MAX)}${f.content.length > MAX ? '\n...(truncated)' : ''}`
  );
  return `[Attached files]\n${blocks.join('\n\n')}\n\n`;
}
```

**Injection point:** Prepend `buildAttachmentContext(...)` to `text` before any `sendMessage` call in `handleSend`.

**Message suffix:** Append `\n\n[Attached: ${paths.join(', ')}]` to the visible user message so chat history shows what was sent. This means the raw `text` shown in the bubble has the suffix, but the AI prompt prepends the full file contents.

Actually simpler: pass the attachment suffix directly in the text — the AI receives both the file contents block and the user message together. The stored message (what the bubble shows) trims the file contents block but keeps the `[Attached: ...]` label.

**Revised flow in `handleSend`:**
```ts
const ctx = buildAttachmentContext(attachedFilePaths, project.files);
const fullPrompt = ctx ? `${ctx}User message: ${text}` : text;
const displayText = attachedFilePaths.length > 0
  ? `${text}\n\n📎 ${attachedFilePaths.map(p => p.split('/').pop()).join(', ')}`
  : text;
// Use fullPrompt for AI, displayText for the stored message bubble
```

This requires a small change to `sendMessage` to accept separate `displayContent` and `promptContent`. OR: simpler — just use `fullPrompt` everywhere and keep it simple. The `[Attached files]` header is invisible in the bubble only if we strip it. For now, keep it simple: `fullPrompt` is what's sent and displayed. The file contents will appear in the bubble, but wrapped in the block so it's recognizable.

**Even simpler (chosen approach):** Don't modify `sendMessage`. Just build the prompt with the context block prepended and send it. The stored message will show the full text. To avoid showing raw file contents in the bubble, trim the context block from display. Pass `text` (without context) as the visible message but `fullPrompt` to the AI.

This means `sendMessage` needs a `displayContent?: string` param, OR we pre-strip in the bubble rendering. Cleanest: add `displayContent?: string` to `sendMessage`.

---

## File Summary

| File | Change |
|------|--------|
| `src/components/ChatPanel.tsx` | Add `files` prop; `@` mention detection; file-attach button; `AtMentionPopup`; `FilePickerDropdown`; chips row; update `onSend` call signature |
| `src/App.tsx` | Update `handleSend` to accept `attachedFilePaths`; add `buildAttachmentContext`; pass `files` prop to `ChatPanel`; pass display text vs full prompt |
| `src/hooks/useProject.ts` | Add optional `displayContent?: string` param to `sendMessage` so stored message shows clean text |

---

## Validation Rules

- Max 10 files attached at once (after 10, picker disables adding more)
- Max 6000 chars per file injected (truncated with `...(truncated)`)
- Duplicate paths ignored (same file can't be attached twice)
- Files from other projects can't be attached (picker only shows `props.files`)

---

## Edge Cases

- **Empty text + attachments:** Allow sending with only attachments and no text (AI sees "User message: " + files). Useful for "explain these files."
- **`@` with no matches:** Show "No files match" in the popup.
- **All files already attached:** File-attach button shows all items checked; adding more is disabled.
- **File removed from project while attached:** On send, filter out paths not found in `project.files`.
- **Sending during `@` popup open:** If user presses Enter while `@` popup is open, Enter selects the highlighted file (doesn't send). Only closes popup. Second Enter sends.
