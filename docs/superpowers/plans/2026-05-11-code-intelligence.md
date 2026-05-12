# Code Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Explain, Refactor, and Add Docs toolbar buttons to CodePanel that send selected/full file content to the AI.

**Architecture:** `onCodeAction(action, content, filename)` callback on CodePanel reads selected text in edit mode or full file content. App.tsx handler switches chat mode and calls `handleSend` with a crafted prompt.

**Tech Stack:** Existing `editorRef` (textarea), existing `handleSend`, existing chat modes.

---

## File Map

| File | Change |
|------|--------|
| `src/components/CodePanel.tsx` | Add `onCodeAction` prop + 3 toolbar buttons |
| `src/App.tsx` | Add `handleCodeAction`, wire prop |

---

## Task 1: CodePanel toolbar buttons

**Files:**
- Modify: `src/components/CodePanel.tsx`

- [ ] **Step 1: Add BookOpen, Wrench, FileText to imports (if not already present)**

Check line 2 of CodePanel.tsx:
```ts
import { Copy, Check, FileCode, Clock, Globe, Pencil, X, Eye } from 'lucide-react';
```
Change to:
```ts
import { Copy, Check, FileCode, Clock, Globe, Pencil, X, Eye, BookOpen, Wrench, FileText } from 'lucide-react';
```

- [ ] **Step 2: Add onCodeAction to Props interface**

Add to the `Props` interface:
```ts
  onCodeAction?: (action: 'explain' | 'refactor' | 'docs', content: string, filename: string) => void;
```

Add `onCodeAction` to the destructured params.

- [ ] **Step 3: Add helper to get selected or full content**

Add this helper function inside the component body (before the return statement):
```ts
  const getActionContent = (): { content: string; filename: string } => {
    const file = displayFile;
    if (!file) return { content: '', filename: '' };
    const fname = file.path.split('/').pop() ?? file.path;
    if (editMode && editorRef.current) {
      const { selectionStart, selectionEnd } = editorRef.current;
      if (selectionStart !== selectionEnd) {
        return { content: editorRef.current.value.slice(selectionStart, selectionEnd), filename: fname };
      }
    }
    return { content: file.content, filename: fname };
  };
```

- [ ] **Step 4: Add the 3 buttons to the toolbar**

In the `<div className="code-actions">` section, add these buttons BEFORE the Edit/View toggle (i.e., right after `{/* Edit / View toggle */}` comment, before the `{displayFile && !isStreamingActive && (` block):

```tsx
          {/* Code Intelligence */}
          {displayFile && !isStreamingActive && onCodeAction && (
            <>
              <button
                className="icon-btn"
                title="Explain this code"
                onClick={() => { const { content, filename } = getActionContent(); if (content) onCodeAction('explain', content, filename); }}
              >
                <BookOpen size={13} />
              </button>
              <button
                className="icon-btn"
                title="Refactor this code"
                onClick={() => { const { content, filename } = getActionContent(); if (content) onCodeAction('refactor', content, filename); }}
              >
                <Wrench size={13} />
              </button>
              <button
                className="icon-btn"
                title="Add documentation"
                onClick={() => { const { content, filename } = getActionContent(); if (content) onCodeAction('docs', content, filename); }}
              >
                <FileText size={13} />
              </button>
            </>
          )}
```

- [ ] **Step 5: Verify TypeScript**

Run: `cd C:\Lovable && npx tsc --noEmit 2>&1 | head -30`
Expected: no errors

---

## Task 2: App.tsx — handleCodeAction + wiring

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add handleCodeAction function**

Add this function in App.tsx after `handleFixWithAI`:
```ts
  const handleCodeAction = (action: 'explain' | 'refactor' | 'docs', content: string, filename: string) => {
    const MODE_MAP = {
      explain:  'explain',
      refactor: 'refactor',
      docs:     'chat',
    } as const;
    const PROMPT_MAP = {
      explain:  `Explain the following code from \`${filename}\` in clear terms:\n\n\`\`\`\n${content}\n\`\`\``,
      refactor: `Refactor the following code from \`${filename}\`. Improve readability, maintainability, and performance:\n\n\`\`\`\n${content}\n\`\`\``,
      docs:     `Add documentation comments to the following code from \`${filename}\`. Use appropriate doc-comment style for the language:\n\n\`\`\`\n${content}\n\`\`\``,
    };
    setChatMode(MODE_MAP[action]);
    // Use build mode for docs (generates file output); chat endpoint for explain/refactor
    const endpoint = action === 'docs' ? '/api/generate' : '/api/chat';
    project.sendMessage(PROMPT_MAP[action], undefined, endpoint, action === 'docs');
  };
```

- [ ] **Step 2: Wire onCodeAction to CodePanel**

In `<CodePanel ...>` JSX, add:
```tsx
              onCodeAction={handleCodeAction}
```

- [ ] **Step 3: Final TypeScript check**

Run: `cd C:\Lovable && npx tsc --noEmit 2>&1 | head -30`
Expected: no errors
