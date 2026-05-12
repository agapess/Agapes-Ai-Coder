# FORGE Phase 3 — Input Superpowers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add voice input, image-to-app, URL cloning, and Playwright E2E browser testing to FORGE.

**Architecture:** Voice uses browser-native Web Speech API entirely client-side. Image base64 is passed in the `/api/generate` request body as `imageData`; each provider adapter injects it into the last user message in its own format. URL cloning adds `POST /api/clone` (Node fetch + HTML stripping) plus a ClonePanel tab in ChatPanel. Playwright adds `POST /api/projects/:id/playwright-test` (SSE, same pattern as Phase 2 auto-tester) and a "Browser Test" button in CodePanel visible only for web files.

**Tech Stack:** Web Speech API (browser-native), FileReader API (browser-native), Node built-in `fetch` (server), `playwright` npm package, vitest + @testing-library/react (frontend tests), node:test (backend tests)

---

## File Map

**New files:**
- `src/hooks/useSpeech.ts` — SpeechRecognition lifecycle, silence timer, transcript state
- `src/hooks/useSpeech.test.ts` — vitest unit tests (mocked SpeechRecognition)
- `src/lib/visionProviders.ts` — `VISION_PROVIDERS` array + `supportsVision()` helper
- `src/components/ImageAttachment.tsx` — thumbnail + remove button
- `src/components/ImageAttachment.test.tsx` — vitest render tests
- `src/components/ClonePanel.tsx` — URL input form with loading/error states
- `src/components/ClonePanel.test.tsx` — vitest render + interaction tests
- `src/hooks/usePlaywrightTest.ts` — SSE consumer for playwright-test endpoint
- `server/mcp/clone.mjs` — `stripHtml()` and `checkRobotsDisallowed()` utilities
- `server/mcp/clone.test.mjs` — node:test tests for those utilities

**Modified files:**
- `src/components/ChatPanel.tsx` — mic button, paperclip button, paste handler, Clone tab
- `src/components/CodePanel.tsx` — Browser Test button (web files only), `playwrightResult` + `onRunPlaywrightTests` props; optional `label` prop on TestBadge call
- `src/components/TestBadge.tsx` — add optional `label?: string` prop
- `src/App.tsx` — wire voice/image/clone/playwright hooks and handlers
- `src/hooks/useProject.ts` — `sendMessage(text, imageData?)` accepts optional image
- `src/index.css` — mic, attachment, chat-tabs, clone panel, spin animation styles
- `server/index.mjs` — inject imageData into last message; add `/api/clone`; add `/api/projects/:id/playwright-test`
- `server/providers/anthropic.mjs` — `toAnthropicMsg()` helper handles imageData
- `server/providers/openai.mjs` — `toOpenAIMsg()` helper handles imageData
- `server/providers/gemini.mjs` — last-message parts handle imageData
- `server/mcp/tests.mjs` — extend `buildTestGenPrompt` for `'playwright'` framework
- `server/mcp/tests.test.mjs` — add playwright prompt test

---

### Task 1: useSpeech hook + tests

**Files:**
- Create: `src/hooks/useSpeech.ts`
- Create: `src/hooks/useSpeech.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/hooks/useSpeech.test.ts
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSpeech } from './useSpeech';

function makeMockRecog() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    continuous: false,
    interimResults: false,
    lang: '',
    onresult: null as any,
    onerror:  null as any,
    onend:    null as any,
  };
}

describe('useSpeech', () => {
  let mockRecog: ReturnType<typeof makeMockRecog>;

  beforeEach(() => {
    mockRecog = makeMockRecog();
    vi.stubGlobal('SpeechRecognition', vi.fn(() => mockRecog));
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('supported is true when SpeechRecognition is available', () => {
    const { result } = renderHook(() => useSpeech());
    expect(result.current.supported).toBe(true);
  });

  it('supported is false when SpeechRecognition is absent', () => {
    vi.unstubAllGlobals();
    const { result } = renderHook(() => useSpeech());
    expect(result.current.supported).toBe(false);
  });

  it('listening becomes true after start()', () => {
    const { result } = renderHook(() => useSpeech());
    act(() => result.current.start(() => {}));
    expect(result.current.listening).toBe(true);
    expect(mockRecog.start).toHaveBeenCalled();
  });

  it('listening becomes false after stop()', () => {
    const { result } = renderHook(() => useSpeech());
    act(() => result.current.start(() => {}));
    act(() => result.current.stop());
    expect(result.current.listening).toBe(false);
    expect(mockRecog.stop).toHaveBeenCalled();
  });

  it('transcript updates when onresult fires', () => {
    const { result } = renderHook(() => useSpeech());
    act(() => result.current.start(() => {}));
    act(() => {
      mockRecog.onresult({
        resultIndex: 0,
        results: [Object.assign([{ transcript: 'hello world' }], { isFinal: true })],
      });
    });
    expect(result.current.transcript).toBe('hello world');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd C:/Lovable && npx vitest run src/hooks/useSpeech.test.ts
```
Expected: FAIL — `Cannot find module './useSpeech'`

- [ ] **Step 3: Implement useSpeech**

```typescript
// src/hooks/useSpeech.ts
import { useState, useRef, useCallback } from 'react';

export interface SpeechHook {
  supported:  boolean;
  listening:  boolean;
  transcript: string;
  start:      (onSubmit: (text: string) => void) => void;
  stop:       () => void;
}

export function useSpeech(): SpeechHook {
  const getSpeechRecog = () =>
    typeof window !== 'undefined'
      ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
      : null;

  const supported = !!getSpeechRecog();
  const [listening,  setListening]  = useState(false);
  const [transcript, setTranscript] = useState('');
  const recogRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    recogRef.current?.stop();
    recogRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback((onSubmit: (text: string) => void) => {
    const SpeechRec = getSpeechRecog();
    if (!SpeechRec) return;

    const recog = new SpeechRec();
    recog.continuous     = true;
    recog.interimResults = true;
    recog.lang           = 'en-US';
    recogRef.current     = recog;

    let finalText = '';

    recog.onresult = (e: any) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }
      setTranscript(finalText + interim);
      timerRef.current = setTimeout(() => {
        const text = (finalText + interim).trim();
        stop();
        setTranscript('');
        if (text) onSubmit(text);
      }, 2000);
    };

    recog.onerror = (e: any) => {
      if (e.error === 'not-allowed') {
        setTranscript('Microphone access denied — check browser permissions');
      }
      stop();
    };

    recog.onend = () => setListening(false);
    recog.start();
    setListening(true);
    setTranscript('');
    finalText = '';
  }, [stop]);

  return { supported, listening, transcript, start, stop };
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/hooks/useSpeech.test.ts
```
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSpeech.ts src/hooks/useSpeech.test.ts
git commit -m "feat: add useSpeech hook with silence auto-submit"
```

---

### Task 2: Voice button in ChatPanel + CSS

**Files:**
- Modify: `src/components/ChatPanel.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Add mic button to ChatPanel**

In `src/components/ChatPanel.tsx`, add these imports at the top:

```typescript
import { Send, Square, Zap, Mic, MicOff } from 'lucide-react';
import { useSpeech } from '../hooks/useSpeech';
```

Inside the `ChatPanel` component body, after the existing `useRef` declarations, add:

```typescript
const speech = useSpeech();

useEffect(() => {
  if (speech.listening) setInput(speech.transcript);
}, [speech.transcript, speech.listening]);

const handleMicClick = () => {
  if (speech.listening) {
    speech.stop();
  } else {
    speech.start((text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      onSend(trimmed);
      setInput('');
    });
  }
};
```

In the JSX, find the `<div className="input-row">` and add the mic button as the first child:

```tsx
<div className="input-row">
  {speech.supported && (
    <button
      type="button"
      className={`mic-btn${speech.listening ? ' mic-btn--recording' : ''}`}
      onClick={handleMicClick}
      disabled={isGenerating || isPlanLoading || !!pendingPlan}
      title={speech.listening ? 'Stop recording' : 'Voice input (auto-submits after 2s silence)'}
    >
      {speech.listening ? <MicOff size={13} /> : <Mic size={13} />}
    </button>
  )}
  <span className="input-hint">↵ send · shift+↵ newline</span>
  {/* existing stop/send buttons unchanged */}
```

- [ ] **Step 2: Add mic CSS to index.css**

Append to `src/index.css`:

```css
/* ── Voice input ─────────────────────────────────────────────── */
.mic-btn {
  display: flex;
  align-items: center;
  padding: 5px 8px;
  border: 1px solid #333;
  border-radius: 4px;
  background: transparent;
  color: #666;
  cursor: pointer;
  transition: color .15s, border-color .15s;
  flex-shrink: 0;
}
.mic-btn:hover:not(:disabled) { color: #FF5E1A; border-color: #FF5E1A; }
.mic-btn:disabled { opacity: 0.4; cursor: default; }
.mic-btn--recording {
  color: #ef4444;
  border-color: #ef4444;
  animation: mic-pulse 1.2s ease-in-out infinite;
}
@keyframes mic-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.55; }
}
```

- [ ] **Step 3: Run all frontend tests**

```bash
npx vitest run
```
Expected: all pass (no regressions)

- [ ] **Step 4: Commit**

```bash
git add src/components/ChatPanel.tsx src/index.css
git commit -m "feat: add voice-to-app mic button with 2s silence auto-submit"
```

---

### Task 3: visionProviders constant + ImageAttachment component + tests

**Files:**
- Create: `src/lib/visionProviders.ts`
- Create: `src/components/ImageAttachment.tsx`
- Create: `src/components/ImageAttachment.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/ImageAttachment.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ImageAttachment } from './ImageAttachment';

const DATA_URL = 'data:image/png;base64,abc123';

describe('ImageAttachment', () => {
  it('renders the image thumbnail with the given src', () => {
    render(<ImageAttachment dataUrl={DATA_URL} onRemove={() => {}} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', DATA_URL);
  });

  it('calls onRemove when the remove button is clicked', () => {
    const onRemove = vi.fn();
    render(<ImageAttachment dataUrl={DATA_URL} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('shows a different image when dataUrl changes', () => {
    const url = 'data:image/jpeg;base64,xyz789';
    render(<ImageAttachment dataUrl={url} onRemove={() => {}} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', url);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/ImageAttachment.test.tsx
```
Expected: FAIL — module not found

- [ ] **Step 3: Create visionProviders and ImageAttachment**

```typescript
// src/lib/visionProviders.ts
import type { ProviderType } from '../types';

export const VISION_PROVIDERS: ProviderType[] = ['anthropic', 'openai', 'gemini'];

export function supportsVision(provider: ProviderType): boolean {
  return VISION_PROVIDERS.includes(provider);
}
```

```tsx
// src/components/ImageAttachment.tsx
import { X } from 'lucide-react';

interface Props {
  dataUrl:  string;
  onRemove: () => void;
}

export function ImageAttachment({ dataUrl, onRemove }: Props) {
  return (
    <div className="image-attachment">
      <img src={dataUrl} alt="attachment" className="image-attachment__thumb" />
      <button
        className="image-attachment__remove"
        onClick={onRemove}
        title="Remove image"
        type="button"
      >
        <X size={10} />
        <span className="sr-only">Remove</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/components/ImageAttachment.test.tsx
```
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/visionProviders.ts src/components/ImageAttachment.tsx src/components/ImageAttachment.test.tsx
git commit -m "feat: add visionProviders helper and ImageAttachment component"
```

---

### Task 4: Image forwarding in server providers

**Files:**
- Modify: `server/providers/anthropic.mjs`
- Modify: `server/providers/openai.mjs`
- Modify: `server/providers/gemini.mjs`

- [ ] **Step 1: Update Anthropic provider**

In `server/providers/anthropic.mjs`, add this helper before the class:

```js
function toAnthropicMsg(m) {
  if (m.imageData) {
    const [header, b64] = m.imageData.split(',');
    const media_type = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
    return {
      role: m.role,
      content: [
        { type: 'image', source: { type: 'base64', media_type, data: b64 } },
        { type: 'text', text: m.content || 'Recreate this design as a clean web app.' },
      ],
    };
  }
  return { role: m.role, content: m.content };
}
```

In `stream()`, change the messages line from:
```js
messages: messages.map((m) => ({ role: m.role, content: m.content })),
```
to:
```js
messages: messages.map(toAnthropicMsg),
```

In `generate()`, change the messages line from:
```js
messages: messages.map((m) => ({ role: m.role, content: m.content })),
```
to:
```js
messages: messages.map(toAnthropicMsg),
```

- [ ] **Step 2: Update OpenAI provider**

In `server/providers/openai.mjs`, add this helper before the class:

```js
function toOpenAIMsg(m) {
  if (m.imageData) {
    return {
      role: m.role,
      content: [
        { type: 'image_url', image_url: { url: m.imageData } },
        { type: 'text', text: m.content || 'Recreate this design as a clean web app.' },
      ],
    };
  }
  return { role: m.role, content: m.content };
}
```

In `stream()`, change:
```js
...messages.map((m) => ({ role: m.role, content: m.content })),
```
to:
```js
...messages.map(toOpenAIMsg),
```

In `generate()`, make the same change.

- [ ] **Step 3: Update Gemini provider**

In `server/providers/gemini.mjs`, update `stream()`. Replace the two lines:
```js
const history = messages.slice(0, -1).map((m) => ({
  role:  m.role === 'assistant' ? 'model' : 'user',
  parts: [{ text: m.content }],
}));
const lastMsg = messages[messages.length - 1]?.content ?? '';
```
with:
```js
const history = messages.slice(0, -1).map((m) => ({
  role:  m.role === 'assistant' ? 'model' : 'user',
  parts: [{ text: m.content }],
}));
const lastRaw = messages[messages.length - 1];
let lastMsg;
if (lastRaw?.imageData) {
  const [header, b64] = lastRaw.imageData.split(',');
  const mimeType = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
  lastMsg = [
    { inlineData: { mimeType, data: b64 } },
    { text: lastRaw.content || 'Recreate this design as a clean web app.' },
  ];
} else {
  lastMsg = lastRaw?.content ?? '';
}
```

Apply the same change to `generate()`.

- [ ] **Step 4: Inject imageData in server/index.mjs**

In `server/index.mjs`, in the `/api/generate` handler, change:

```js
const { messages, llmConfig } = req.body;
```
to:
```js
const { messages, llmConfig, imageData } = req.body;
```

And just before `const provider = createProvider(llmConfig);`, add:

```js
const processedMessages = imageData
  ? messages.map((m, i) =>
      i === messages.length - 1 && m.role === 'user'
        ? { ...m, imageData }
        : m
    )
  : messages;
```

Then change `provider.stream(res, messages, systemPrompt)` to:
```js
provider.stream(res, processedMessages, systemPrompt);
```

- [ ] **Step 5: Run all backend tests**

```bash
node --test server/mcp/search.test.mjs server/providers/plan.test.mjs server/mcp/snapshot.test.mjs server/mcp/tests.test.mjs
```
Expected: 24 passed

- [ ] **Step 6: Commit**

```bash
git add server/providers/anthropic.mjs server/providers/openai.mjs server/providers/gemini.mjs server/index.mjs
git commit -m "feat: add image forwarding to all LLM providers"
```

---

### Task 5: Image button in ChatPanel + wire through App.tsx and useProject

**Files:**
- Modify: `src/components/ChatPanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/hooks/useProject.ts`
- Modify: `src/index.css`

- [ ] **Step 1: Change onSend signature in ChatPanel**

In `src/components/ChatPanel.tsx`, update the Props interface:

```typescript
interface Props {
  // ... existing props unchanged ...
  onSend: (text: string, imageData?: string) => void;  // was (text: string) => void
  // ...
}
```

Add these imports:
```typescript
import { Send, Square, Zap, Mic, MicOff, Paperclip } from 'lucide-react';
import { ImageAttachment } from './ImageAttachment';
import { supportsVision }  from '../lib/visionProviders';
```

Inside the component body, add state and ref:
```typescript
const fileInputRef = useRef<HTMLInputElement>(null);

const handleImageError = (msg: string) => {
  // show inline — reuse setInput temporarily then clear after 3s
  setInput(msg);
  setTimeout(() => setInput(''), 3000);
};

const handleImageSelect = (file: File) => {
  if (file.size > 5 * 1024 * 1024) {
    handleImageError('Image too large — max 5MB');
    return;
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    handleImageError('Only PNG, JPG, and WebP are supported');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target?.result as string;
    onSend(input.trim(), dataUrl);
    setInput('');
  };
  reader.readAsDataURL(file);
};

const handlePaste = (e: React.ClipboardEvent) => {
  const imageItem = Array.from(e.clipboardData.items)
    .find((item) => item.type.startsWith('image/'));
  if (imageItem) {
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (file) handleImageSelect(file);
  }
};
```

Update `handleSubmit` to pass no imageData (text-only submit):
```typescript
const handleSubmit = (e?: FormEvent) => {
  e?.preventDefault();
  const text = input.trim();
  if (!text || isGenerating) return;
  onSend(text);
  setInput('');
};
```

In the JSX, add paste handler to the form and the paperclip button + file input to `input-row`:

```tsx
<form className="chat-input-wrap" onSubmit={handleSubmit} onPaste={handlePaste}>
```

In `input-row`, after the mic button:
```tsx
{supportsVision(llmConfig.provider) && (
  <>
    <input
      ref={fileInputRef}
      type="file"
      accept="image/png,image/jpeg,image/webp"
      style={{ display: 'none' }}
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) handleImageSelect(file);
        e.target.value = '';
      }}
    />
    <button
      type="button"
      className="attachment-btn"
      onClick={() => fileInputRef.current?.click()}
      disabled={isGenerating || isPlanLoading || !!pendingPlan}
      title="Attach image (or paste from clipboard)"
    >
      <Paperclip size={13} />
    </button>
  </>
)}
```

- [ ] **Step 2: Update useProject.sendMessage to accept imageData**

In `src/hooks/useProject.ts`, change the `sendMessage` signature:

```typescript
const sendMessage = useCallback(async (userContent: string, imageData?: string) => {
```

And in the fetch call body, change:
```typescript
body: JSON.stringify({
  messages:  history.map((m) => ({ role: m.role, content: m.content })),
  llmConfig,
  ...(imageData ? { imageData } : {}),
}),
```

- [ ] **Step 3: Update App.tsx handleSend to accept and forward imageData**

In `src/App.tsx`, change `handleSend`:

```typescript
const handleSend = async (text: string, imageData?: string) => {
  // Image sends bypass the plan step — auto-trigger immediately
  if (imageData) {
    project.sendMessage(text, imageData);
    return;
  }
  if (project.llmConfig.skipPlanning) {
    project.sendMessage(text);
    return;
  }
  // ... rest of plan flow unchanged
};
```

- [ ] **Step 4: Add image attachment CSS**

Append to `src/index.css`:

```css
/* ── Image attachment ────────────────────────────────────────── */
.attachment-btn {
  display: flex;
  align-items: center;
  padding: 5px 8px;
  border: 1px solid #333;
  border-radius: 4px;
  background: transparent;
  color: #666;
  cursor: pointer;
  transition: color .15s, border-color .15s;
  flex-shrink: 0;
}
.attachment-btn:hover:not(:disabled) { color: #FF5E1A; border-color: #FF5E1A; }
.attachment-btn:disabled { opacity: 0.4; cursor: default; }
.image-attachment {
  position: relative;
  display: inline-block;
  margin: 4px 10px 0;
}
.image-attachment__thumb {
  width: 60px;
  height: 60px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid #333;
}
.image-attachment__remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #333;
  border: none;
  color: #ccc;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.image-attachment__remove:hover { background: #ef4444; color: #fff; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
```

- [ ] **Step 5: Run all frontend tests**

```bash
npx vitest run
```
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/components/ChatPanel.tsx src/App.tsx src/hooks/useProject.ts src/index.css
git commit -m "feat: image-to-app — paperclip button + clipboard paste auto-triggers generation"
```

---

### Task 6: ClonePanel component + tests

**Files:**
- Create: `src/components/ClonePanel.tsx`
- Create: `src/components/ClonePanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ClonePanel.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ClonePanel } from './ClonePanel';

describe('ClonePanel', () => {
  it('renders the URL input', () => {
    render(<ClonePanel onClone={() => {}} isCloning={false} error={null} />);
    expect(screen.getByPlaceholderText(/https/i)).toBeInTheDocument();
  });

  it('Clone button is disabled when input is empty', () => {
    render(<ClonePanel onClone={() => {}} isCloning={false} error={null} />);
    expect(screen.getByRole('button', { name: /clone/i })).toBeDisabled();
  });

  it('Clone button is disabled for an invalid URL', () => {
    render(<ClonePanel onClone={() => {}} isCloning={false} error={null} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'not-a-url' } });
    expect(screen.getByRole('button', { name: /clone/i })).toBeDisabled();
  });

  it('calls onClone with the URL when Clone is clicked', () => {
    const onClone = vi.fn();
    render(<ClonePanel onClone={onClone} isCloning={false} error={null} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /clone/i }));
    expect(onClone).toHaveBeenCalledWith('https://example.com');
  });

  it('shows the error message when error prop is set', () => {
    render(<ClonePanel onClone={() => {}} isCloning={false} error="Could not reach the site" />);
    expect(screen.getByText(/could not reach the site/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/ClonePanel.test.tsx
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement ClonePanel**

```tsx
// src/components/ClonePanel.tsx
import { useState, type FormEvent } from 'react';
import { Link, Loader } from 'lucide-react';

interface Props {
  onClone:   (url: string) => void;
  isCloning: boolean;
  error:     string | null;
}

function isValidUrl(s: string) {
  try { new URL(s); return true; } catch { return false; }
}

export function ClonePanel({ onClone, isCloning, error }: Props) {
  const [url, setUrl] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || !isValidUrl(trimmed) || isCloning) return;
    onClone(trimmed);
  };

  const canSubmit = url.trim() && isValidUrl(url.trim()) && !isCloning;

  return (
    <div className="clone-panel">
      <div className="clone-title">Clone a URL</div>
      <p className="clone-sub">
        Paste any URL — FORGE fetches it and rebuilds it as a clean, editable project.
      </p>
      <form className="clone-form" onSubmit={handleSubmit}>
        <input
          className="clone-input"
          type="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={isCloning}
          spellCheck={false}
        />
        <button
          className="clone-btn"
          type="submit"
          disabled={!canSubmit}
        >
          {isCloning
            ? <><Loader size={13} className="clone-btn__spin" /> Cloning…</>
            : <><Link size={13} /> Clone</>
          }
        </button>
      </form>
      {error && <div className="clone-error">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/components/ClonePanel.test.tsx
```
Expected: 5 passed

- [ ] **Step 5: Add ClonePanel CSS to index.css**

Append to `src/index.css`:

```css
/* ── Clone panel ─────────────────────────────────────────────── */
.chat-tabs {
  display: flex;
  border-bottom: 1px solid #1a1a2e;
  flex-shrink: 0;
}
.chat-tab {
  padding: 8px 14px;
  font-size: 11px;
  color: #666;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color .15s, border-color .15s;
}
.chat-tab.active { color: #FF5E1A; border-bottom-color: #FF5E1A; }
.chat-tab:hover:not(.active) { color: #aaa; }
.clone-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px 16px;
  flex: 1;
  overflow-y: auto;
}
.clone-title  { font-size: 13px; font-weight: 600; color: #eee; }
.clone-sub    { font-size: 11px; color: #666; margin: 0; line-height: 1.6; }
.clone-form   { display: flex; gap: 8px; }
.clone-input  {
  flex: 1;
  background: #0d0d1a;
  border: 1px solid #2a2a3e;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  color: #eee;
  outline: none;
}
.clone-input:focus { border-color: #FF5E1A; }
.clone-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 14px;
  background: #FF5E1A;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background .15s;
}
.clone-btn:hover:not(:disabled) { background: #ff7040; }
.clone-btn:disabled { opacity: 0.4; cursor: default; }
.clone-btn__spin { animation: spin 1s linear infinite; }
.clone-error {
  font-size: 11px;
  color: #ff7f7f;
  padding: 6px 10px;
  background: rgba(239,68,68,.08);
  border-radius: 5px;
  border: 1px solid rgba(239,68,68,.2);
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/ClonePanel.tsx src/components/ClonePanel.test.tsx src/index.css
git commit -m "feat: add ClonePanel component with URL validation"
```

---

### Task 7: /api/clone server endpoint + utilities + tests

**Files:**
- Create: `server/mcp/clone.mjs`
- Create: `server/mcp/clone.test.mjs`
- Modify: `server/index.mjs`

- [ ] **Step 1: Write failing tests**

```js
// server/mcp/clone.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripHtml, checkRobotsDisallowed } from './clone.mjs';

test('stripHtml removes script tags and content', () => {
  const html = '<p>Hello</p><script>alert("hi")</script><p>World</p>';
  const result = stripHtml(html);
  assert.ok(!result.includes('alert'));
  assert.ok(result.includes('Hello'));
  assert.ok(result.includes('World'));
});

test('stripHtml removes style tags', () => {
  const html = '<p>Text</p><style>body { color: red; }</style>';
  const result = stripHtml(html);
  assert.ok(!result.includes('color: red'));
  assert.ok(result.includes('Text'));
});

test('stripHtml removes HTML tags leaving text', () => {
  const html = '<h1>Title</h1><p>Para</p>';
  const result = stripHtml(html);
  assert.ok(result.includes('Title'));
  assert.ok(result.includes('Para'));
  assert.ok(!result.includes('<h1>'));
});

test('checkRobotsDisallowed returns true for disallow all', () => {
  const txt = 'User-agent: *\nDisallow: /\n';
  assert.equal(checkRobotsDisallowed(txt), true);
});

test('checkRobotsDisallowed returns false when only specific paths disallowed', () => {
  const txt = 'User-agent: *\nDisallow: /admin\n';
  assert.equal(checkRobotsDisallowed(txt), false);
});

test('checkRobotsDisallowed returns false for empty robots.txt', () => {
  assert.equal(checkRobotsDisallowed(''), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test server/mcp/clone.test.mjs 2>&1 | head -5
```
Expected: ERR_MODULE_NOT_FOUND

- [ ] **Step 3: Implement clone utilities**

```js
// server/mcp/clone.mjs

export function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<meta[^>]*>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function checkRobotsDisallowed(robotsTxt) {
  const lines = robotsTxt.split('\n');
  let inStarAgent = false;
  for (const line of lines) {
    const t = line.trim().toLowerCase();
    if (t === 'user-agent: *')    { inStarAgent = true;  continue; }
    if (t.startsWith('user-agent:')) { inStarAgent = false; continue; }
    if (inStarAgent && t === 'disallow: /') return true;
  }
  return false;
}
```

- [ ] **Step 4: Run utilities tests**

```bash
node --test server/mcp/clone.test.mjs
```
Expected: 6 passed

- [ ] **Step 5: Add /api/clone to server/index.mjs**

Add import at top of `server/index.mjs`:
```js
import { stripHtml, checkRobotsDisallowed } from './mcp/clone.mjs';
```

Add the route (place it after `/api/search` and before the project CRUD section):

```js
// ── URL Clone ─────────────────────────────────────────────────
app.post('/api/clone', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  let parsed;
  try { parsed = new URL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Check robots.txt
  try {
    const robotsRes = await fetch(`${parsed.origin}/robots.txt`, {
      headers: { 'User-Agent': 'FORGE/1.0 (educational web recreation tool)' },
      signal: AbortSignal.timeout(5000),
    });
    if (robotsRes.ok) {
      const txt = await robotsRes.text();
      if (checkRobotsDisallowed(txt)) {
        return res.status(403).json({ error: "This site doesn't allow automated access." });
      }
    }
  } catch { /* robots.txt unavailable — proceed */ }

  // Fetch the page
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 10000);
  try {
    const pageRes = await fetch(url, {
      headers: { 'User-Agent': 'FORGE/1.0 (educational web recreation tool)' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!pageRes.ok) {
      return res.status(502).json({ error: `Page not found (HTTP ${pageRes.status})` });
    }

    const html       = await pageRes.text();
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title      = titleMatch?.[1]?.trim() ?? '';
    const stripped   = stripHtml(html);
    const content    = (title ? `Page title: ${title}\n\n` : '') + stripped;
    const truncated  = content.slice(0, 12000);

    if (!truncated.trim()) {
      return res.status(422).json({ error: 'No readable content found — try a different URL.' });
    }
    res.json({ content: truncated, title });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return res.status(504).json({
        error: `Could not reach ${url} — the site took too long to respond.`,
      });
    }
    res.status(502).json({ error: String(err.message || err) });
  }
});
```

- [ ] **Step 6: Run all backend tests**

```bash
node --test server/mcp/search.test.mjs server/providers/plan.test.mjs server/mcp/snapshot.test.mjs server/mcp/tests.test.mjs server/mcp/clone.test.mjs
```
Expected: 30 passed

- [ ] **Step 7: Commit**

```bash
git add server/mcp/clone.mjs server/mcp/clone.test.mjs server/index.mjs
git commit -m "feat: add /api/clone endpoint with robots.txt check and HTML stripping"
```

---

### Task 8: Wire ClonePanel into ChatPanel + App.tsx

**Files:**
- Modify: `src/components/ChatPanel.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add Clone tab to ChatPanel**

In `src/components/ChatPanel.tsx`, add to the Props interface:
```typescript
onClone?:    (url: string) => void;
isCloning?:  boolean;
cloneError?: string | null;
```

Add to the destructured props:
```typescript
export function ChatPanel({
  // ... existing props ...
  onClone,
  isCloning,
  cloneError,
}: Props) {
```

Add tab state inside the component:
```typescript
const [activeTab, setActiveTab] = useState<'chat' | 'clone'>('chat');
```

Add import:
```typescript
import { ClonePanel } from './ClonePanel';
```

Wrap the entire return content so it becomes tab-aware. The `<aside className="chat-panel">` should contain:

```tsx
<aside className="chat-panel">
  {/* Tab bar */}
  <div className="chat-tabs">
    <button
      className={`chat-tab${activeTab === 'chat' ? ' active' : ''}`}
      onClick={() => setActiveTab('chat')}
    >
      Chat
    </button>
    <button
      className={`chat-tab${activeTab === 'clone' ? ' active' : ''}`}
      onClick={() => setActiveTab('clone')}
    >
      Clone URL
    </button>
  </div>

  {activeTab === 'clone' ? (
    <ClonePanel
      onClone={onClone ?? (() => {})}
      isCloning={isCloning ?? false}
      error={cloneError ?? null}
    />
  ) : (
    <>
      {/* Setup notice */}
      {needsSetup && ( ... )}

      {/* Messages */}
      <div className="messages">
        ...
      </div>

      {/* Input */}
      <form className="chat-input-wrap" ...>
        ...
      </form>
    </>
  )}
</aside>
```

(Keep all existing JSX inside the `<>` block unchanged — only wrap it.)

- [ ] **Step 2: Add clone handler to App.tsx**

In `src/App.tsx`, add clone state and handler:

```typescript
const [isCloning,  setIsCloning]  = useState(false);
const [cloneError, setCloneError] = useState<string | null>(null);

const handleClone = async (url: string) => {
  setIsCloning(true);
  setCloneError(null);
  try {
    const res  = await fetch('/api/clone', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    const prompt =
      `Recreate this app/page as a clean, editable FORGE project. ` +
      `Match the design, colors, layout, and functionality.\n\n` +
      `Source URL: ${url}\n\n${data.content}`;
    project.sendMessage(prompt);
  } catch (err) {
    setCloneError(err instanceof Error ? err.message : String(err));
  } finally {
    setIsCloning(false);
  }
};
```

Pass these to `<ChatPanel>`:
```tsx
<ChatPanel
  {/* ... existing props ... */}
  onClone={handleClone}
  isCloning={isCloning}
  cloneError={cloneError}
/>
```

- [ ] **Step 3: Run all frontend tests**

```bash
npx vitest run
```
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add src/components/ChatPanel.tsx src/App.tsx
git commit -m "feat: wire ClonePanel into ChatPanel with Clone URL tab"
```

---

### Task 9: Playwright support in tests.mjs + /api/playwright-test endpoint

**Files:**
- Modify: `server/mcp/tests.mjs`
- Modify: `server/mcp/tests.test.mjs`
- Modify: `server/index.mjs`

- [ ] **Step 1: Extend tests.mjs for Playwright**

In `server/mcp/tests.mjs`, update `buildTestGenPrompt`:

```js
export function buildTestGenPrompt(files, framework) {
  if (framework === 'playwright') {
    const htmlFile = files.find((f) => /\.html?$/.test(f.path));
    const htmlPath = htmlFile?.path ?? 'index.html';
    const htmlSnippet = htmlFile ? htmlFile.content.slice(0, 2000) : '';
    return `You are a test engineer. Write a Playwright test using @playwright/test.
Open the HTML file with: await page.goto('file://' + path.join(__dirname, '${htmlPath}'));
Use page.click(), page.fill(), expect(page.locator(...)) assertions. Do not rely on a running server.
Output ONLY the test file content — no explanation, no markdown fences.

// ${htmlPath}
${htmlSnippet}`;
  }

  // existing code below unchanged:
  const snippets = files
    .filter((f) => !f.path.includes('test') && !f.path.includes('spec'))
    .slice(0, 5)
    .map((f) => `// ${f.path}\n${f.content.slice(0, 800)}`)
    .join('\n\n---\n\n');

  return `You are a test engineer. Write a complete ${framework} test file for the code below.
Use the ${framework} testing library. Cover the main happy paths and at least one edge/error case.
Output ONLY the test file content — no explanation, no markdown fences.

${snippets}`;
}
```

- [ ] **Step 2: Add playwright test case to tests.test.mjs**

In `server/mcp/tests.test.mjs`, add:

```js
test('buildTestGenPrompt handles playwright framework with HTML file', () => {
  const files = [{ path: 'index.html', content: '<h1>Hello</h1>' }];
  const prompt = buildTestGenPrompt(files, 'playwright');
  assert.ok(prompt.toLowerCase().includes('playwright'));
  assert.ok(prompt.includes('file://'));
  assert.ok(prompt.includes('index.html'));
});
```

- [ ] **Step 3: Run backend tests**

```bash
node --test server/mcp/tests.test.mjs
```
Expected: 9 passed (8 existing + 1 new)

- [ ] **Step 4: Add /api/playwright-test endpoint to server/index.mjs**

Add after the existing `/api/projects/:id/test` route:

```js
// ── Playwright E2E ────────────────────────────────────────────
app.post('/api/projects/:id/playwright-test', async (req, res) => {
  const { llmConfig, files } = req.body;
  if (!files?.length) return res.status(400).json({ error: 'files required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    send({ status: 'generating', framework: 'playwright' });

    const prompt   = buildTestGenPrompt(files, 'playwright');
    const provider = createProvider(llmConfig);
    const testCode = await provider.generate(
      [{ role: 'user', content: prompt }],
      'You are a test engineer. Output only the Playwright test file content.',
    );

    const id    = safeId(req.params.id);
    const dir   = projectDir(id);
    const fpath = path.join(dir, 'forge_playwright.spec.js');
    await fs.writeFile(fpath, testCode, 'utf-8');
    send({ status: 'running', file: 'forge_playwright.spec.js' });

    let output = '';
    await new Promise((resolve) => {
      const proc = spawn(
        'npx',
        ['playwright', 'test', 'forge_playwright.spec.js', '--reporter=line'],
        { cwd: dir, shell: true },
      );
      proc.stdout.on('data', (d) => { output += d; send({ chunk: d.toString() }); });
      proc.stderr.on('data', (d) => { output += d; send({ chunk: d.toString() }); });
      proc.on('close', resolve);
    });

    const counts = parseTestOutput(output, 'playwright');
    send({ status: 'done', ...counts });
  } catch (err) {
    const msg  = String(err.message || err);
    const hint = msg.includes('not found') || msg.includes('ENOENT')
      ? 'Playwright not found. Run: npx playwright install chromium'
      : msg;
    send({ error: hint });
  }
  res.end();
});
```

- [ ] **Step 5: Run all backend tests**

```bash
node --test server/mcp/search.test.mjs server/providers/plan.test.mjs server/mcp/snapshot.test.mjs server/mcp/tests.test.mjs server/mcp/clone.test.mjs
```
Expected: 31 passed

- [ ] **Step 6: Commit**

```bash
git add server/mcp/tests.mjs server/mcp/tests.test.mjs server/index.mjs
git commit -m "feat: add Playwright E2E support — buildTestGenPrompt + /api/playwright-test endpoint"
```

---

### Task 10: usePlaywrightTest hook + Browser Test button in CodePanel + wire App.tsx

**Files:**
- Create: `src/hooks/usePlaywrightTest.ts`
- Modify: `src/components/TestBadge.tsx`
- Modify: `src/components/CodePanel.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create usePlaywrightTest hook**

```typescript
// src/hooks/usePlaywrightTest.ts
import { useState, useCallback } from 'react';
import type { GeneratedFile, LLMProvider, TestResult } from '../types';

const IDLE: TestResult = { status: 'idle', passed: 0, failed: 0, total: 0, output: '' };

export function usePlaywrightTest(projectId: string | null, llmConfig: LLMProvider) {
  const [result, setResult] = useState<TestResult>(IDLE);

  const runTests = useCallback(async (files: GeneratedFile[]) => {
    if (!projectId || !files.length) return;
    setResult({ status: 'running', passed: 0, failed: 0, total: 0, output: '' });

    try {
      const res = await fetch(`/api/projects/${projectId}/playwright-test`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ llmConfig, files }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body!.getReader();
      const dec    = new TextDecoder();
      let   output = '';
      let   final: Partial<TestResult> = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of dec.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            const obj = JSON.parse(line.slice(5).trim());
            if (obj.chunk)          output += obj.chunk;
            if (obj.status === 'done') final = obj;
            if (obj.error)          throw new Error(obj.error);
          } catch { /* skip parse errors */ }
        }
      }

      setResult({
        status: final.failed ? 'failed' : 'passed',
        passed: final.passed ?? 0,
        failed: final.failed ?? 0,
        total:  final.total  ?? 0,
        output,
      });
    } catch (err) {
      setResult({ status: 'failed', passed: 0, failed: 1, total: 1, output: String(err) });
    }
  }, [projectId, llmConfig]);

  const reset = useCallback(() => setResult(IDLE), []);

  return { result, runTests, reset };
}
```

- [ ] **Step 2: Add optional label prop to TestBadge**

In `src/components/TestBadge.tsx`, update the Props interface:
```typescript
interface Props {
  result: TestResult;
  onRun:  () => void;
  label?: string;
}
```

Update the idle-state button to use the label:
```tsx
export function TestBadge({ result, onRun, label = 'Run Tests' }: Props) {
  // ...
  // In the idle return:
  return (
    <button className="test-badge test-badge--idle" onClick={onRun} title="Generate and run tests">
      <FlaskConical size={11} />
      {label}
    </button>
  );
```

- [ ] **Step 3: Add Browser Test button to CodePanel**

In `src/components/CodePanel.tsx`, add to the Props interface:
```typescript
playwrightResult?:     TestResult;
onRunPlaywrightTests?: () => void;
```

Add to the destructured props:
```typescript
export function CodePanel({ ..., playwrightResult, onRunPlaywrightTests }: Props) {
```

In the `code-actions` div, after the existing `<TestBadge>`:
```tsx
{playwrightResult && onRunPlaywrightTests && files.some((f) => isWebFile(f.path)) && (
  <TestBadge
    result={playwrightResult}
    onRun={onRunPlaywrightTests}
    label="Browser Test"
  />
)}
```

- [ ] **Step 4: Wire usePlaywrightTest in App.tsx**

In `src/App.tsx`, add import:
```typescript
import { usePlaywrightTest } from './hooks/usePlaywrightTest';
```

Add the hook:
```typescript
const { result: playwrightResult, runTests: runPlaywrightTests, reset: resetPlaywright } =
  usePlaywrightTest(project.projectId, project.llmConfig);
```

In the effect that resets on project change, also reset playwright:
```typescript
useEffect(() => {
  refreshSnapshots();
  resetTest();
  resetPlaywright();
}, [refreshSnapshots, resetTest, resetPlaywright]);
```

Pass to `<CodePanel>`:
```tsx
<CodePanel
  {/* ... existing props ... */}
  playwrightResult={playwrightResult}
  onRunPlaywrightTests={() => runPlaywrightTests(project.files)}
/>
```

- [ ] **Step 5: Run all frontend tests**

```bash
npx vitest run
```
Expected: all pass

- [ ] **Step 6: Run all backend tests**

```bash
node --test server/mcp/search.test.mjs server/providers/plan.test.mjs server/mcp/snapshot.test.mjs server/mcp/tests.test.mjs server/mcp/clone.test.mjs
```
Expected: 31 passed

- [ ] **Step 7: Commit**

```bash
git add src/hooks/usePlaywrightTest.ts src/components/TestBadge.tsx src/components/CodePanel.tsx src/App.tsx
git commit -m "feat: Browser Test button — Playwright E2E from CodePanel toolbar"
```

---

## Self-Review

**Spec coverage:**
- 3.1 Voice-to-App: Tasks 1–2 ✓
- 3.2 Image-to-App: Tasks 3–5 ✓
- 3.3 URL Clone: Tasks 6–8 ✓
- 3.4 Playwright E2E: Tasks 9–10 ✓
- Disabled during generation: all buttons check `isGenerating` ✓
- Non-vision provider greyout: `supportsVision()` check in ChatPanel ✓
- Playwright install hint: endpoint catches ENOENT and returns helpful message ✓

**Type consistency:**
- `onSend(text, imageData?)` propagated through ChatPanel → App.tsx → sendMessage ✓
- `TestResult` reused for both auto-test and playwright results ✓
- `buildTestGenPrompt(files, 'playwright')` matches how the endpoint calls it ✓

**No placeholders:** All steps contain complete code. ✓
