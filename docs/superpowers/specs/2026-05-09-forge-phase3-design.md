# FORGE Phase 3 — Input Superpowers — Design Spec

**Date:** 2026-05-09
**Status:** Approved
**Builds on:** Phase 1 (sandbox + multi-LLM) and Phase 2 (plan card, snapshots, auto-tester, web search)

---

## Goal

Give users three new ways to describe what they want to build (voice, image, URL) and add real browser-based E2E testing via Playwright. Every input method follows a "trigger → auto-generate" flow with no extra confirmation step, while remaining stable and easy to use.

---

## Architecture Overview

- **No new frontend dependencies.** Voice uses the browser-native Web Speech API. Image uses FileReader + the existing base64 pipeline. URL Clone uses Node's built-in `fetch`.
- **One new server endpoint:** `POST /api/clone` — fetches a URL, strips trackers/scripts, returns cleaned text content.
- **One new backend dependency:** `playwright` npm package (Chromium installed on first use via `npx playwright install chromium`).
- **Playwright testing** reuses Phase 2's `detectTestFramework` / `parseTestOutput` / `buildTestGenPrompt` infrastructure with a new `playwright` framework path.
- All three input buttons live in `ChatPanel.tsx`. The Playwright button lives in `CodePanel.tsx` alongside the existing TestBadge.

---

## 3.1 Voice-to-App

### Behaviour
- Mic button appears in the chat input bar (left of the textarea).
- Click → starts `SpeechRecognition`. A red pulsing "recording…" indicator replaces the button.
- Interim results stream into the textarea in real-time as the user speaks.
- After **2 seconds of silence** (`speechend` event + 2s timer), auto-submits the prompt exactly as if the user pressed Enter.
- A **Stop** button (visible during recording) cancels and leaves the transcript in the textarea for manual editing.
- If the browser does not support `window.SpeechRecognition` or `window.webkitSpeechRecognition`, the mic button is hidden and a tooltip explains: "Voice input requires Chrome or Edge."

### Implementation
- Entirely client-side — no server changes.
- New hook: `src/hooks/useSpeech.ts`
  - Returns: `{ listening, transcript, start, stop, supported }`
  - Manages `SpeechRecognition` lifecycle, interim vs. final results, silence timer.
- `ChatPanel.tsx` imports `useSpeech` — mic button wired to `start()`; silence callback calls `onSend(transcript)`.

### Error handling
| Scenario | Behaviour |
|---|---|
| Browser unsupported | Mic button hidden; no error shown unless user somehow triggers it |
| Mic permission denied | Show inline message: "Microphone access denied — check browser permissions" |
| No speech detected | Timer expires, nothing submitted (empty string guard in `handleSubmit`) |
| Generation already running | Mic button disabled while `isGenerating` or `isPlanLoading` |

---

## 3.2 Image-to-App

### Behaviour
- Paperclip button in the chat input bar (right of the textarea, left of Send).
- Accepts: PNG, JPG, WebP via file picker or drag-and-drop onto the chat panel, or **Ctrl+V paste** from clipboard.
- Selected image shown as a small thumbnail above the textarea with an ✕ remove button.
- Generation **auto-triggers immediately** when an image is attached — no separate submit needed. The image is sent as base64 alongside whatever text is in the textarea (default: empty, AI infers "recreate this design").
- If the active provider does not support vision, the button is greyed out with tooltip: "Switch to Claude or GPT-4o to use images."

### Vision-capable providers
| Provider | Vision support |
|---|---|
| Anthropic Claude (claude-3+) | Yes |
| OpenAI GPT-4o | Yes |
| Google Gemini 1.5+ | Yes |
| Ollama / LM Studio / Custom | No (greyed out) |

### Implementation
- Client-side only for capture; server receives image as part of the existing `/api/generate` messages array.
- New component: `src/components/ImageAttachment.tsx` — thumbnail + remove button.
- `ChatPanel.tsx` gains `imageData: string | null` state (base64 data URL).
- Messages sent to `/api/generate` include `{ role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: base64DataUrl } }] }` when an image is present.
- Provider adapters (`anthropic.mjs`, `openai.mjs`, `gemini.mjs`) updated to detect and forward image content blocks.
- `src/lib/visionProviders.ts` — exports `VISION_PROVIDERS: ProviderType[]` used to control button visibility.

### Error handling
| Scenario | Behaviour |
|---|---|
| File too large (>5MB) | Show: "Image too large — max 5MB" |
| Unsupported file type | Show: "Only PNG, JPG, and WebP are supported" |
| Non-vision provider | Button greyed out; tooltip explains |
| API rejects image | Error shown in chat as normal generation error |

---

## 3.3 URL Clone

### Behaviour
- A **"Clone" tab** appears at the top of the chat panel (next to the messages area).
- User pastes a URL and presses Enter or clicks "Clone".
- Loading state: "Fetching [url]…" → when content arrives, generation auto-triggers with a fixed prompt: *"Recreate this app/page as a clean, editable FORGE project. Match the design, colors, layout, and functionality."*
- The fetched content (cleaned HTML text) is injected as context into the generation request.
- After generation starts, the panel automatically switches back to the chat tab.

### Server: `POST /api/clone`
**Request:**
```json
{ "url": "https://example.com" }
```

**Response:**
```json
{ "content": "cleaned text representation of the page" }
```

**Implementation:**
- Uses Node's built-in `fetch` with a 10-second timeout.
- Checks `robots.txt` at `{origin}/robots.txt` — if `Disallow: /` for `*`, returns 403 with message "This site disallows scraping."
- Strips `<script>`, `<style>`, `<link>`, `<meta>`, `<svg>`, tracking pixels, HTML comments.
- Extracts: page title, visible text, `class` and `id` attribute hints (for layout/structure), `<a>` link labels, `<img>` alt texts, inline `style` color/font hints.
- Content truncated to 12,000 characters before sending to AI (fits all provider context windows).
- User-Agent header: `"FORGE/1.0 (educational web recreation tool)"`.

### Error handling
| Scenario | Behaviour |
|---|---|
| Timeout (>10s) | "Could not reach [url] — the site took too long to respond" |
| robots.txt disallows | "This site doesn't allow automated access" |
| 404 / non-200 | "Page not found (HTTP [status])" |
| Invalid URL | Client-side validation before fetch |
| Empty content | "No readable content found — try a different URL" |

---

## 3.4 Playwright E2E Browser Testing

### Behaviour
- A **"Browser Test"** button appears in CodePanel's toolbar, next to the existing TestBadge — visible only when the active file is a web file (`.html`, `.htm`).
- Click → AI generates a `forge_playwright.spec.js` test file (same code-gen pattern as Phase 2), then runs it via `npx playwright test`.
- Results shown in the existing `TestBadge` component (`passed` / `failed` / `running`).
- If Playwright is not installed, instead of failing silently, the button shows a tooltip: "Run `npx playwright install chromium` first" and the endpoint returns a clear error.
- **Not auto-run** — always manual, since Playwright startup takes 2–4 seconds.

### Server: `POST /api/projects/:id/playwright-test`
- Same SSE streaming pattern as `/api/projects/:id/test` from Phase 2.
- Generates test using `buildTestGenPrompt(files, 'playwright')` — Phase 2's function, extended to handle the `playwright` framework case.
- Test file written to project dir as `forge_playwright.spec.js`.
- Runs: `npx playwright test forge_playwright.spec.js --reporter=line`.
- Parses output with `parseTestOutput(raw, 'playwright')` — extended to handle Playwright's output format: `N passed (Xs)`, `N failed`.

### Playwright prompt additions to `buildTestGenPrompt`
When framework is `'playwright'`:
- System instruction: "Write a Playwright test using `@playwright/test`. Open the HTML file with `await page.goto('file://' + path.join(__dirname, 'index.html'))`. Use `page.click()`, `page.fill()`, `expect(page.locator(...))` assertions. Do not rely on a running server."
- Include the HTML file content as context so the AI knows the selectors.

### Error handling
| Scenario | Behaviour |
|---|---|
| Playwright not installed | SSE returns `{ error: "Playwright not found. Run: npx playwright install chromium" }` |
| Test generation fails | SSE returns error, TestBadge shows failed state |
| App not running | Playwright test fails at `page.goto()` — failure shown in output stream |
| Timeout in test | Playwright's built-in 30s timeout handles it |

---

## File Map

### New files
| File | Purpose |
|---|---|
| `src/hooks/useSpeech.ts` | Web Speech API hook |
| `src/components/ImageAttachment.tsx` | Image thumbnail + remove button |
| `src/components/ClonePanel.tsx` | URL Clone tab UI |
| `src/lib/visionProviders.ts` | `VISION_PROVIDERS` constant |
| `src/hooks/useSpeech.test.ts` | vitest unit tests |
| `src/components/ImageAttachment.test.tsx` | vitest unit tests |
| `src/components/ClonePanel.test.tsx` | vitest unit tests |

### Modified files
| File | Changes |
|---|---|
| `src/components/ChatPanel.tsx` | Add mic button, image attachment, Clone tab |
| `src/components/CodePanel.tsx` | Add "Browser Test" button for web files |
| `src/App.tsx` | Wire image state, clone handler, playwright test handler |
| `server/index.mjs` | Add `POST /api/clone`, `POST /api/projects/:id/playwright-test` |
| `server/providers/anthropic.mjs` | Forward image content blocks in `stream()` |
| `server/providers/openai.mjs` | Forward image content blocks in `stream()` |
| `server/providers/gemini.mjs` | Forward image content blocks in `stream()` |
| `server/mcp/tests.mjs` | Add `playwright` to `detectTestFramework`, `parseTestOutput`, `buildTestGenPrompt` |

---

## Testing Strategy

- **`useSpeech.ts`**: vitest unit tests mock `SpeechRecognition` (inject via `window`), test `supported` flag, start/stop lifecycle, silence timer.
- **`ImageAttachment.tsx`**: render tests — thumbnail shown, remove button calls callback, large-file error displayed.
- **`ClonePanel.tsx`**: render tests — input validation, loading state, error states.
- **`server/mcp/tests.mjs`**: extend existing node:test suite — add Playwright to `detectTestFramework` and `parseTestOutput` cases.
- **`/api/clone`**: node:test with mocked `fetch` — timeout, robots.txt block, content stripping.
- Provider image forwarding tested via existing provider unit tests extended with image message fixture.

---

## Non-Functional Requirements

- Voice recording indicator must be clearly visible (user must always know when mic is active).
- Image auto-submit must show the image thumbnail in chat so users know what was sent.
- URL Clone must never hang — 10s timeout is hard-enforced.
- All three input methods must be disabled while `isGenerating` is true.
- Playwright button only shown for web files — not Python, Node scripts, etc.
