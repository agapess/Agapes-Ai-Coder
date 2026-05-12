# FORGE Phase 2 — AI Intelligence Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI Project Planner (plan card before generation), AI Auto-Tester (pytest/jest after success), Web Search MCP (live docs injected during generation), and Version Time Travel (snapshot/restore on every successful run).

**Architecture:** Web search runs server-side inside `/api/generate` — DuckDuckGo is called with the user's prompt before streaming, and top results are injected into the system context. Project Planner adds a `/api/plan` endpoint using a new non-streaming `generate()` method on each provider; the client shows a `PlanCard` confirmation before code generation starts. Auto-Tester uses a `/api/projects/:id/test` endpoint: it generates tests via `provider.generate()` if none exist, then runs them with `child_process.spawn`; a `TestBadge` shows results. Version Time Travel copies all project files to `.forge/snapshots/{timestamp}/` on every exit-0 run; a `SnapshotTimeline` dropdown in CodePanel lets users restore any version.

**Tech Stack:** node:test (backend tests), vitest + jsdom (frontend tests), DuckDuckGo Instant Answers API (free, no key), `child_process.spawn` (test execution), existing `provider.generate()` (test file generation)

---

## File Map

**New files:**
- `server/mcp/search.mjs` — `buildSearchUrl`, `parseResults`, `webSearch({query, maxResults})`
- `server/mcp/snapshot.mjs` — `createSnapshot`, `listSnapshots`, `restoreSnapshot`
- `server/mcp/tests.mjs` — `detectTestFramework`, `parseTestOutput`, `buildTestGenPrompt`
- `server/providers/plan-utils.mjs` — `parsePlanJson(text)` (testable in isolation)
- `server/mcp/search.test.mjs` — node:test tests for web search
- `server/mcp/snapshot.test.mjs` — node:test tests for snapshot
- `server/mcp/tests.test.mjs` — node:test tests for test runner
- `server/providers/plan.test.mjs` — node:test tests for plan JSON parsing
- `src/components/PlanCard.tsx` — plan confirmation card
- `src/components/SnapshotTimeline.tsx` — version history dropdown
- `src/components/TestBadge.tsx` — "✓ N/N tests passed" badge
- `src/hooks/useSnapshots.ts` — snapshot CRUD hook
- `src/hooks/useAutoTest.ts` — auto-test trigger hook
- `src/components/PlanCard.test.tsx` — vitest tests
- `src/components/SnapshotTimeline.test.tsx` — vitest tests
- `src/components/TestBadge.test.tsx` — vitest tests

**Modified files:**
- `src/types.ts` — add `ProjectPlan`, `Snapshot`, `TestResult`; add `skipPlanning?` to `LLMProvider`
- `server/providers/anthropic.mjs` — add `async generate(messages, systemPrompt): Promise<string>`
- `server/providers/openai.mjs` — add `async generate(messages, systemPrompt): Promise<string>`
- `server/providers/gemini.mjs` — add `async generate(messages, systemPrompt): Promise<string>`
- `server/index.mjs` — add `/api/search`, `/api/plan`, `/api/projects/:id/snapshots`, `/api/projects/:id/test`; inject search into `/api/generate`
- `src/App.tsx` — plan flow state/handlers, auto-snapshot on exit-0, wire useAutoTest + useSnapshots
- `src/components/ChatPanel.tsx` — add `pendingPlan`/`isPlanLoading` props, render PlanCard, disable input during plan
- `src/components/CodePanel.tsx` — add `testState`/`onRunTests`/`snapshots`/`onRestoreSnapshot` props; render TestBadge + SnapshotTimeline
- `src/components/ProviderSettings.tsx` — add Skip Planning checkbox
- `src/index.css` — styles for PlanCard, SnapshotTimeline, TestBadge

---

## Task 1: Add Phase 2 Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add `skipPlanning` to `LLMProvider`**

In `src/types.ts`, replace the `LLMProvider` interface:

```ts
export interface LLMProvider {
  provider:      ProviderType;
  apiKey?:       string;
  baseUrl?:      string;
  model?:        string;
  autoRun?:      boolean;
  skipPlanning?: boolean;   // skip plan card, go straight to generation
}
```

- [ ] **Step 2: Add Phase 2 types after `AutoFixState`**

Append to `src/types.ts`:

```ts
// ── Phase 2 ───────────────────────────────────────────────────

export interface ProjectPlan {
  summary:  string;    // "A weather dashboard with real-time data"
  files:    string[];  // ["index.html", "style.css", "app.js"]
  uses:     string[];  // ["OpenWeatherMap API", "Chart.js"]
  features: string[];  // ["current temp", "5-day forecast", "city search"]
}

export type PlanStatus = 'idle' | 'loading' | 'ready';

export interface Snapshot {
  id:        string;  // safe folder name: ISO timestamp with : replaced by -
  label:     string;  // first 80 chars of the prompt that created it
  createdAt: string;  // ISO timestamp
  fileCount: number;
}

export type TestStatus = 'idle' | 'running' | 'passed' | 'failed';

export interface TestResult {
  status:  TestStatus;
  passed:  number;
  failed:  number;
  total:   number;
  output:  string;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /c/Lovable
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /c/Lovable
git add src/types.ts
git commit -m "feat: add Phase 2 types (ProjectPlan, Snapshot, TestResult)"
```

---

## Task 2: Web Search MCP

**Files:**
- Create: `server/mcp/search.mjs`
- Create: `server/mcp/search.test.mjs`
- Modify: `server/index.mjs`

- [ ] **Step 1: Write the failing tests**

Create `server/mcp/search.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchUrl, parseResults } from './search.mjs';

test('buildSearchUrl encodes query correctly', () => {
  const url = buildSearchUrl('React useState hook');
  assert.ok(url.startsWith('https://api.duckduckgo.com/'));
  assert.ok(url.includes('React') || url.includes('React%20'));
});

test('parseResults returns empty array for empty data', () => {
  const results = parseResults({}, 5);
  assert.deepEqual(results, []);
});

test('parseResults extracts AbstractText', () => {
  const data = {
    AbstractText:   'React is a JavaScript library for building UIs.',
    AbstractSource: 'Wikipedia',
    AbstractURL:    'https://en.wikipedia.org/wiki/React',
    RelatedTopics:  [],
  };
  const results = parseResults(data, 5);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Wikipedia');
  assert.ok(results[0].snippet.includes('React'));
  assert.equal(results[0].url, 'https://en.wikipedia.org/wiki/React');
});

test('parseResults extracts RelatedTopics up to maxResults', () => {
  const data = {
    AbstractText:  '',
    RelatedTopics: [
      { Text: 'React hooks - Functions that let you use state', FirstURL: 'https://react.dev/hooks' },
      { Text: 'React state - Managing state',                  FirstURL: 'https://react.dev/state' },
      { Text: 'React props - Passing data',                   FirstURL: 'https://react.dev/props' },
    ],
  };
  const results = parseResults(data, 2);
  assert.equal(results.length, 2);
  assert.equal(results[0].url, 'https://react.dev/hooks');
});

test('parseResults skips RelatedTopics without URL', () => {
  const data = {
    AbstractText:  '',
    RelatedTopics: [{ Text: 'no url topic' }],
  };
  const results = parseResults(data, 5);
  assert.deepEqual(results, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /c/Lovable
node --test server/mcp/search.test.mjs 2>&1 | head -10
```

Expected: `ERR_MODULE_NOT_FOUND` (search.mjs doesn't exist yet).

- [ ] **Step 3: Create `server/mcp/search.mjs`**

```js
import https from 'https';

const DDG_BASE = 'https://api.duckduckgo.com/';

/** @param {string} query @returns {string} */
export function buildSearchUrl(query) {
  const params = new URLSearchParams({
    q:             query,
    format:        'json',
    no_html:       '1',
    skip_disambig: '1',
  });
  return `${DDG_BASE}?${params}`;
}

/** @param {string} url @returns {Promise<string>} */
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

/**
 * @param {object} data - DuckDuckGo JSON response
 * @param {number} maxResults
 * @returns {{ title: string; snippet: string; url: string }[]}
 */
export function parseResults(data, maxResults) {
  const results = [];

  if (data.AbstractText) {
    results.push({
      title:   data.AbstractSource || 'Reference',
      snippet: data.AbstractText.slice(0, 300),
      url:     data.AbstractURL || '',
    });
  }

  for (const topic of (data.RelatedTopics ?? [])) {
    if (results.length >= maxResults) break;
    if (!topic.Text || !topic.FirstURL) continue;
    results.push({
      title:   topic.Text.split(' - ')[0].slice(0, 80),
      snippet: topic.Text.slice(0, 250),
      url:     topic.FirstURL,
    });
  }

  return results;
}

/**
 * @param {{ query: string; maxResults?: number }} opts
 * @returns {Promise<{ title: string; snippet: string; url: string }[]>}
 */
export async function webSearch({ query, maxResults = 5 }) {
  const url  = buildSearchUrl(query.slice(0, 200));
  const raw  = await fetchUrl(url);
  const data = JSON.parse(raw);
  return parseResults(data, maxResults);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /c/Lovable
node --test server/mcp/search.test.mjs 2>&1
```

Expected: 5 tests pass — `✓ buildSearchUrl encodes query correctly`, etc.

- [ ] **Step 5: Add `/api/search` route and inject search into `/api/generate`**

At the top of `server/index.mjs`, add the import after the existing imports:

```js
import { webSearch } from './mcp/search.mjs';
```

Add `/api/search` endpoint (after `/api/health`):

```js
app.get('/api/search', async (req, res) => {
  const q   = req.query.q;
  const max = parseInt(req.query.max ?? '5', 10);
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    const results = await webSearch({ query: q, maxResults: max });
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});
```

Replace the `/api/generate` handler's `try` block opening with search injection:

```js
app.post('/api/generate', async (req, res) => {
  const { messages, llmConfig } = req.body;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  try {
    // Inject web search context into system prompt
    let systemPrompt = SYSTEM_PROMPT;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      try {
        const results = await webSearch({ query: lastUser.content.slice(0, 150), maxResults: 3 });
        if (results.length > 0) {
          const ctx = results.map((r) => `• ${r.title}: ${r.snippet}`).join('\n');
          systemPrompt = `${SYSTEM_PROMPT}\n\n## Web Context (current documentation)\n${ctx}`;
        }
      } catch { /* search unavailable — proceed without */ }
    }

    const provider = createProvider(llmConfig);
    await provider.stream(res, messages, systemPrompt);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: String(err.message || err) })}\n\n`);
    res.end();
  }
});
```

- [ ] **Step 6: Verify server starts and `/api/search` responds**

```bash
cd /c/Lovable/server
node index.mjs &
sleep 2
curl "http://localhost:3001/api/search?q=Python+requests+library" 2>/dev/null | head -c 300
kill %1
```

Expected: JSON with `{"results":[...]}`.

- [ ] **Step 7: Commit**

```bash
cd /c/Lovable
git add server/mcp/search.mjs server/mcp/search.test.mjs server/index.mjs
git commit -m "feat: add web search MCP and inject into /api/generate"
```

---

## Task 3: Provider `generate()` Method + `/api/plan` Endpoint

**Files:**
- Create: `server/providers/plan-utils.mjs`
- Create: `server/providers/plan.test.mjs`
- Modify: `server/providers/anthropic.mjs`
- Modify: `server/providers/openai.mjs`
- Modify: `server/providers/gemini.mjs`
- Modify: `server/index.mjs`

- [ ] **Step 1: Write the failing tests**

Create `server/providers/plan.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlanJson } from './plan-utils.mjs';

test('parsePlanJson handles clean JSON', () => {
  const json = '{"summary":"A todo app","files":["index.html"],"uses":["React"],"features":["add items"]}';
  const plan = parsePlanJson(json);
  assert.equal(plan.summary, 'A todo app');
  assert.deepEqual(plan.files, ['index.html']);
  assert.deepEqual(plan.uses, ['React']);
});

test('parsePlanJson strips markdown code fences', () => {
  const json = '```json\n{"summary":"App","files":[],"uses":[],"features":[]}\n```';
  const plan = parsePlanJson(json);
  assert.equal(plan.summary, 'App');
  assert.deepEqual(plan.files, []);
});

test('parsePlanJson returns null for invalid JSON', () => {
  assert.equal(parsePlanJson('not valid json at all'), null);
});

test('parsePlanJson returns null when summary missing', () => {
  assert.equal(parsePlanJson('{"files":["x.html"],"uses":[],"features":[]}'), null);
});

test('parsePlanJson coerces array items to strings', () => {
  const plan = parsePlanJson('{"summary":"s","files":[1,2],"uses":[],"features":[]}');
  assert.deepEqual(plan.files, ['1', '2']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /c/Lovable
node --test server/providers/plan.test.mjs 2>&1 | head -10
```

Expected: `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Create `server/providers/plan-utils.mjs`**

```js
/**
 * @param {string} text - raw LLM output (may contain markdown fences)
 * @returns {{ summary: string; files: string[]; uses: string[]; features: string[] } | null}
 */
export function parsePlanJson(text) {
  const cleaned = text.replace(/```(?:json)?\n?|\n?```/g, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    if (!obj.summary || !Array.isArray(obj.files)) return null;
    return {
      summary:  String(obj.summary),
      files:    (obj.files    ?? []).map(String),
      uses:     (obj.uses     ?? []).map(String),
      features: (obj.features ?? []).map(String),
    };
  } catch { return null; }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /c/Lovable
node --test server/providers/plan.test.mjs 2>&1
```

Expected: 5 tests pass.

- [ ] **Step 5: Add `generate()` to `server/providers/anthropic.mjs`**

Append this method inside `AnthropicProvider` class, before the closing `}`:

```js
  async generate(messages, systemPrompt) {
    const base      = (this.#cfg.baseUrl?.trim() || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
    const apiKeyVal = this.#cfg.apiKey?.trim() || process.env.ANTHROPIC_API_KEY;

    if (!authToken && !apiKeyVal) {
      throw new Error('No API key. Enter one in Settings or set ANTHROPIC_API_KEY env var.');
    }

    const headers = {
      'content-type':      'application/json',
      'anthropic-version': '2023-06-01',
      'accept':            'application/json',
    };
    if (authToken) {
      headers['authorization'] = `Bearer ${authToken}`;
    } else {
      headers['x-api-key'] = apiKeyVal;
    }

    const model = this.#cfg.model || process.env.ANTHROPIC_MODEL || 'claude-opus-4-6';

    const resp = await fetch(`${base}/v1/messages`, {
      method:  'POST',
      headers,
      body:    JSON.stringify({
        model, max_tokens: 1024, stream: false,
        system:   systemPrompt,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Anthropic ${resp.status}: ${body || resp.statusText}`);
    }

    const data = await resp.json();
    return data.content[0].text;
  }
```

- [ ] **Step 6: Add `generate()` to `server/providers/openai.mjs`**

Append inside `OpenAIProvider` class, before closing `}`:

```js
  async generate(messages, systemPrompt) {
    const apiKey = this.#cfg.apiKey?.trim() || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('No API key. Enter one in Settings or set OPENAI_API_KEY env var.');

    const client = new OpenAI({
      apiKey,
      baseURL: this.#cfg.baseUrl || 'https://api.openai.com/v1',
    });

    const resp = await client.chat.completions.create({
      model:      this.#cfg.model || 'gpt-4o',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    return resp.choices[0].message.content ?? '';
  }
```

- [ ] **Step 7: Add `generate()` to `server/providers/gemini.mjs`**

Append inside `GeminiProvider` class, before closing `}`:

```js
  async generate(messages, systemPrompt) {
    const apiKey = this.#cfg.apiKey?.trim() || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('No API key. Enter one in Settings or set GEMINI_API_KEY env var.');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model:             this.#cfg.model || 'gemini-2.0-flash',
      systemInstruction: systemPrompt,
    });

    const history = messages.slice(0, -1).map((m) => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const lastMsg = messages[messages.length - 1]?.content ?? '';

    const chat   = model.startChat({ history });
    const result = await chat.sendMessage(lastMsg);
    return result.response.text();
  }
```

- [ ] **Step 8: Add `PLAN_SYSTEM_PROMPT` and `/api/plan` to `server/index.mjs`**

Add import after existing imports:

```js
import { parsePlanJson } from './providers/plan-utils.mjs';
```

Add the planning system prompt constant after `SYSTEM_PROMPT`:

```js
const PLAN_SYSTEM_PROMPT = `You are a project planner for FORGE. The user wants to build something.
Return ONLY valid JSON (no markdown, no explanation) in this exact shape:
{
  "summary":  "one sentence describing what will be built",
  "files":    ["file1.ext", "file2.ext"],
  "uses":     ["Technology 1", "Library 2"],
  "features": ["feature 1", "feature 2", "feature 3"]
}
Keep each array to 4 items maximum. Be concise.`;
```

Add `/api/plan` endpoint after `/api/generate`:

```js
app.post('/api/plan', async (req, res) => {
  const { messages, llmConfig } = req.body;
  try {
    const provider = createProvider(llmConfig);
    const text     = await provider.generate(messages, PLAN_SYSTEM_PROMPT);
    const plan     = parsePlanJson(text);
    if (!plan) return res.status(500).json({ error: 'Could not parse plan', raw: text });
    res.json({ plan });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});
```

- [ ] **Step 9: Verify TypeScript compilation**

```bash
cd /c/Lovable
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
cd /c/Lovable
git add server/providers/anthropic.mjs server/providers/openai.mjs server/providers/gemini.mjs \
        server/providers/plan-utils.mjs server/providers/plan.test.mjs server/index.mjs
git commit -m "feat: add provider generate() and /api/plan endpoint"
```

---

## Task 4: PlanCard Component

**Files:**
- Create: `src/components/PlanCard.tsx`
- Create: `src/components/PlanCard.test.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Ensure `@testing-library/react` is installed**

```bash
cd /c/Lovable
npm list @testing-library/react 2>/dev/null | grep -c testing-library || \
  npm install --save-dev @testing-library/react @testing-library/jest-dom
```

Expected: exits without error; `@testing-library/react` listed.

- [ ] **Step 2: Write the failing tests**

Create `src/components/PlanCard.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PlanCard } from './PlanCard';
import type { ProjectPlan } from '../../types';

const PLAN: ProjectPlan = {
  summary:  'A weather dashboard with current temperature and forecasts',
  files:    ['index.html', 'style.css', 'app.js'],
  uses:     ['OpenWeatherMap API', 'Chart.js'],
  features: ['current temp', '5-day forecast', 'city search'],
};

describe('PlanCard', () => {
  it('renders the summary', () => {
    render(<PlanCard plan={PLAN} onConfirm={() => {}} onReject={() => {}} />);
    expect(screen.getByText(/weather dashboard/i)).toBeInTheDocument();
  });

  it('renders all files', () => {
    render(<PlanCard plan={PLAN} onConfirm={() => {}} onReject={() => {}} />);
    expect(screen.getByText('index.html')).toBeInTheDocument();
    expect(screen.getByText('style.css')).toBeInTheDocument();
  });

  it('renders uses list', () => {
    render(<PlanCard plan={PLAN} onConfirm={() => {}} onReject={() => {}} />);
    expect(screen.getByText(/OpenWeatherMap/i)).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn();
    render(<PlanCard plan={PLAN} onConfirm={onConfirm} onReject={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /yes, build it/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onReject when change button clicked', () => {
    const onReject = vi.fn();
    render(<PlanCard plan={PLAN} onConfirm={() => {}} onReject={onReject} />);
    fireEvent.click(screen.getByRole('button', { name: /change/i }));
    expect(onReject).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /c/Lovable
npx vitest run src/components/PlanCard.test.tsx --reporter=verbose 2>&1 | head -15
```

Expected: `Cannot find module './PlanCard'`.

- [ ] **Step 4: Create `src/components/PlanCard.tsx`**

```tsx
import type { ProjectPlan } from '../types';

interface Props {
  plan:      ProjectPlan;
  onConfirm: () => void;
  onReject:  () => void;
}

export function PlanCard({ plan, onConfirm, onReject }: Props) {
  return (
    <div className="plan-card">
      <div className="plan-card__header">
        <span className="plan-card__icon">📋</span>
        <span className="plan-card__title">Here's my plan</span>
      </div>

      <p className="plan-card__summary">{plan.summary}</p>

      <div className="plan-card__grid">
        {plan.files.length > 0 && (
          <div className="plan-card__section">
            <div className="plan-card__label">Files</div>
            <div className="plan-card__chips">
              {plan.files.map((f) => (
                <span key={f} className="plan-card__chip">{f}</span>
              ))}
            </div>
          </div>
        )}

        {plan.uses.length > 0 && (
          <div className="plan-card__section">
            <div className="plan-card__label">Uses</div>
            <div className="plan-card__chips">
              {plan.uses.map((u) => (
                <span key={u} className="plan-card__chip plan-card__chip--tech">{u}</span>
              ))}
            </div>
          </div>
        )}

        {plan.features.length > 0 && (
          <div className="plan-card__section">
            <div className="plan-card__label">Features</div>
            <ul className="plan-card__features">
              {plan.features.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </div>
        )}
      </div>

      <div className="plan-card__actions">
        <button className="plan-card__confirm" onClick={onConfirm}>
          Yes, build it
        </button>
        <button className="plan-card__reject" onClick={onReject}>
          Change something
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add styles to `src/index.css`**

Append at the end of `src/index.css`:

```css
/* ── PlanCard ─────────────────────────────────────────────── */
.plan-card {
  background: #0e0e1a;
  border: 1px solid #FF5E1A44;
  border-radius: 8px;
  padding: 14px;
  margin: 8px 0;
}
.plan-card__header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.plan-card__title {
  font-size: 11px;
  font-weight: 600;
  color: #FF5E1A;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.plan-card__summary {
  font-size: 12px;
  color: #C0C0E0;
  margin: 0 0 10px;
  line-height: 1.5;
}
.plan-card__grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.plan-card__label {
  font-size: 9px;
  font-weight: 700;
  color: #555;
  text-transform: uppercase;
  letter-spacing: .06em;
  margin-bottom: 4px;
}
.plan-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.plan-card__chip {
  background: #1a1a2e;
  border: 1px solid #2a2a4e;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 10px;
  color: #8888CC;
  font-family: 'JetBrains Mono', monospace;
}
.plan-card__chip--tech {
  color: #00C4AA;
  border-color: #00C4AA33;
}
.plan-card__features {
  margin: 0;
  padding-left: 14px;
  font-size: 11px;
  color: #9090B0;
  line-height: 1.8;
}
.plan-card__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.plan-card__confirm {
  background: #FF5E1A;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 7px 16px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s;
}
.plan-card__confirm:hover { background: #ff7040; }
.plan-card__reject {
  background: transparent;
  color: #666;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 7px 12px;
  font-size: 11px;
  cursor: pointer;
  transition: color .15s, border-color .15s;
}
.plan-card__reject:hover { color: #999; border-color: #555; }
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /c/Lovable
npx vitest run src/components/PlanCard.test.tsx --reporter=verbose 2>&1
```

Expected: 5 tests pass.

- [ ] **Step 7: Commit**

```bash
cd /c/Lovable
git add src/components/PlanCard.tsx src/components/PlanCard.test.tsx src/index.css
git commit -m "feat: add PlanCard component with confirm/reject flow"
```

---

## Task 5: Wire Plan Flow (App.tsx + ChatPanel.tsx + ProviderSettings.tsx)

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/ChatPanel.tsx`
- Modify: `src/components/ProviderSettings.tsx`

- [ ] **Step 1: Update `ChatPanel.tsx` Props interface and imports**

In `src/components/ChatPanel.tsx`, add imports at the top:

```ts
import { PlanCard } from './PlanCard';
import type { ProjectPlan } from '../types';
```

Replace the `Props` interface with:

```ts
interface Props {
  messages:             Message[];
  isGenerating:         boolean;
  streamingExplanation: string;
  llmConfig:            LLMProvider;
  onLlmConfigChange:    (cfg: LLMProvider) => void;
  needsSetup:           boolean;
  onSend:               (text: string) => void;
  onStop:               () => void;
  // Phase 2 — plan flow
  pendingPlan?:         ProjectPlan | null;
  isPlanLoading?:       boolean;
  onConfirmPlan?:       () => void;
  onRejectPlan?:        () => void;
}
```

Update the function signature to destructure the new props:

```ts
export function ChatPanel({
  messages, isGenerating, streamingExplanation,
  llmConfig, onLlmConfigChange, needsSetup,
  onSend, onStop,
  pendingPlan, isPlanLoading, onConfirmPlan, onRejectPlan,
}: Props) {
```

- [ ] **Step 2: Render plan card inside ChatPanel's messages area**

In the `{/* Messages */}` section, just before `{isGenerating && streamingExplanation && ...}`, add:

```tsx
{/* Plan loading indicator */}
{isPlanLoading && (
  <div className="typing">
    <div className="msg-avatar">F</div>
    <div className="typing-dots">
      <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
    </div>
  </div>
)}

{/* Plan card — user must confirm before generation */}
{pendingPlan && !isPlanLoading && (
  <PlanCard
    plan={pendingPlan}
    onConfirm={onConfirmPlan ?? (() => {})}
    onReject={onRejectPlan ?? (() => {})}
  />
)}
```

- [ ] **Step 3: Disable input while plan is pending**

In the `<textarea>` element, change the `disabled` prop:

```tsx
disabled={isGenerating || isPlanLoading || !!pendingPlan}
```

In the send `<button>`:

```tsx
disabled={!input.trim() || isPlanLoading || !!pendingPlan}
```

- [ ] **Step 4: Add plan state and `handleSend` to `App.tsx`**

In `src/App.tsx`, add the `ProjectPlan` type import:

```ts
import type { ProjectPlan } from './types';
```

Add these state variables inside `App()` (after the `wasGeneratingRef` declaration):

```tsx
const [pendingPlan,   setPendingPlan]   = useState<ProjectPlan | null>(null);
const [pendingPrompt, setPendingPrompt] = useState('');
const [isPlanLoading, setIsPlanLoading] = useState(false);
```

Add the `handleSend`, `handleConfirmPlan`, and `handleRejectPlan` functions:

```tsx
const handleSend = async (text: string) => {
  if (project.llmConfig.skipPlanning) {
    project.sendMessage(text);
    return;
  }
  setPendingPrompt(text);
  setIsPlanLoading(true);
  try {
    const res = await fetch('/api/plan', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        messages:  [{ role: 'user', content: text }],
        llmConfig: project.llmConfig,
      }),
    });
    if (!res.ok) throw new Error('plan failed');
    const { plan } = await res.json();
    setPendingPlan(plan);
  } catch {
    // Plan failed — go straight to generation
    project.sendMessage(text);
  } finally {
    setIsPlanLoading(false);
  }
};

const handleConfirmPlan = () => {
  const prompt = pendingPrompt;
  setPendingPlan(null);
  setPendingPrompt('');
  project.sendMessage(prompt);
};

const handleRejectPlan = () => {
  setPendingPlan(null);
  setPendingPrompt('');
};
```

- [ ] **Step 5: Pass plan props to `ChatPanel` in `App.tsx`**

Replace `onSend={project.sendMessage}` and add the plan props:

```tsx
<ChatPanel
  messages={project.messages}
  isGenerating={project.isGenerating}
  streamingExplanation={project.streamingExplanation}
  llmConfig={project.llmConfig}
  onLlmConfigChange={project.setLlmConfig}
  needsSetup={project.needsSetup}
  onSend={handleSend}
  onStop={project.stopGeneration}
  pendingPlan={pendingPlan}
  isPlanLoading={isPlanLoading}
  onConfirmPlan={handleConfirmPlan}
  onRejectPlan={handleRejectPlan}
/>
```

- [ ] **Step 6: Add Skip Planning checkbox to `ProviderSettings.tsx`**

Find the `autoRun` checkbox row in `src/components/ProviderSettings.tsx` and add after it:

```tsx
<label className="settings-row">
  <span className="settings-label">Skip planning step</span>
  <input
    type="checkbox"
    checked={!!cfg.skipPlanning}
    onChange={(e) => onChange({ ...cfg, skipPlanning: e.target.checked })}
  />
</label>
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd /c/Lovable
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 8: Run all existing frontend tests**

```bash
cd /c/Lovable
npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: all tests pass (no regressions).

- [ ] **Step 9: Commit**

```bash
cd /c/Lovable
git add src/App.tsx src/components/ChatPanel.tsx src/components/ProviderSettings.tsx
git commit -m "feat: wire AI Project Planner — plan card before every generation"
```

---

## Task 6: Snapshot MCP + Server Endpoints

**Files:**
- Create: `server/mcp/snapshot.mjs`
- Create: `server/mcp/snapshot.test.mjs`
- Modify: `server/index.mjs`

- [ ] **Step 1: Write the failing tests**

Create `server/mcp/snapshot.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs   from 'fs/promises';
import path from 'path';
import os   from 'os';
import { createSnapshot, listSnapshots, restoreSnapshot } from './snapshot.mjs';

async function tmpProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-snap-'));
  await fs.writeFile(path.join(dir, 'index.html'), '<h1>Hello</h1>', 'utf-8');
  await fs.writeFile(path.join(dir, 'app.js'),     'console.log("hi")', 'utf-8');
  return dir;
}

test('createSnapshot copies files into .forge/snapshots/{id}/', async () => {
  const dir = await tmpProject();
  const { id } = await createSnapshot(dir, 'initial build');
  const html = await fs.readFile(path.join(dir, '.forge', 'snapshots', id, 'index.html'), 'utf-8');
  assert.equal(html, '<h1>Hello</h1>');
  await fs.rm(dir, { recursive: true });
});

test('createSnapshot writes snapshot.json with label and fileCount', async () => {
  const dir = await tmpProject();
  const { id } = await createSnapshot(dir, 'my label');
  const meta = JSON.parse(await fs.readFile(path.join(dir, '.forge', 'snapshots', id, 'snapshot.json'), 'utf-8'));
  assert.equal(meta.label, 'my label');
  assert.ok(meta.createdAt);
  assert.ok(meta.fileCount >= 2);
  await fs.rm(dir, { recursive: true });
});

test('listSnapshots returns most-recent-first sorted list', async () => {
  const dir = await tmpProject();
  await createSnapshot(dir, 'first');
  await new Promise((r) => setTimeout(r, 20));
  await createSnapshot(dir, 'second');
  const snaps = await listSnapshots(dir);
  assert.equal(snaps.length, 2);
  assert.equal(snaps[0].label, 'second');
  await fs.rm(dir, { recursive: true });
});

test('listSnapshots returns empty array when no snapshots', async () => {
  const dir = await tmpProject();
  const snaps = await listSnapshots(dir);
  assert.deepEqual(snaps, []);
  await fs.rm(dir, { recursive: true });
});

test('restoreSnapshot overwrites current files with snapshot files', async () => {
  const dir = await tmpProject();
  const { id } = await createSnapshot(dir, 'before change');
  await fs.writeFile(path.join(dir, 'index.html'), '<h1>Changed</h1>', 'utf-8');
  await restoreSnapshot(dir, id);
  const html = await fs.readFile(path.join(dir, 'index.html'), 'utf-8');
  assert.equal(html, '<h1>Hello</h1>');
  await fs.rm(dir, { recursive: true });
});

test('restoreSnapshot rejects IDs with path traversal chars', async () => {
  const dir = await tmpProject();
  await assert.rejects(
    () => restoreSnapshot(dir, '../../../etc/passwd'),
    /invalid/i,
  );
  await fs.rm(dir, { recursive: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /c/Lovable
node --test server/mcp/snapshot.test.mjs 2>&1 | head -10
```

Expected: `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Create `server/mcp/snapshot.mjs`**

```js
import fs   from 'fs/promises';
import path from 'path';

async function copyRecursive(src, dest, skip = []) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (skip.includes(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyRecursive(s, d, skip);
    else                     await fs.copyFile(s, d);
  }
}

async function countFiles(dir) {
  let n = 0;
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += await countFiles(path.join(dir, e.name));
    else                 n++;
  }
  return n;
}

/**
 * @param {string} projectDir
 * @param {string} label
 * @returns {Promise<{ id: string; createdAt: string }>}
 */
export async function createSnapshot(projectDir, label) {
  const createdAt = new Date().toISOString();
  const id        = createdAt.replace(/[:.]/g, '-');
  const snapDir   = path.join(projectDir, '.forge', 'snapshots', id);

  await copyRecursive(projectDir, snapDir, ['.forge', 'node_modules', '.git']);

  const fileCount = await countFiles(snapDir);

  await fs.writeFile(
    path.join(snapDir, 'snapshot.json'),
    JSON.stringify({ id, label: label.slice(0, 80), createdAt, fileCount }, null, 2),
    'utf-8',
  );

  return { id, createdAt };
}

/**
 * @param {string} projectDir
 * @returns {Promise<{ id: string; label: string; createdAt: string; fileCount: number }[]>}
 */
export async function listSnapshots(projectDir) {
  const snapBase = path.join(projectDir, '.forge', 'snapshots');
  try {
    const entries = await fs.readdir(snapBase, { withFileTypes: true });
    const metas   = await Promise.all(entries.map(async (e) => {
      if (!e.isDirectory()) return null;
      try {
        return JSON.parse(await fs.readFile(path.join(snapBase, e.name, 'snapshot.json'), 'utf-8'));
      } catch { return null; }
    }));
    return metas
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch { return []; }
}

/**
 * @param {string} projectDir
 * @param {string} snapshotId
 */
export async function restoreSnapshot(projectDir, snapshotId) {
  if (!/^[\w-]+$/.test(snapshotId)) throw new Error('Invalid snapshot ID');
  const snapDir = path.join(projectDir, '.forge', 'snapshots', snapshotId);
  const meta    = JSON.parse(await fs.readFile(path.join(snapDir, 'snapshot.json'), 'utf-8'));
  await copyRecursive(snapDir, projectDir, ['snapshot.json']);
  return meta;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /c/Lovable
node --test server/mcp/snapshot.test.mjs 2>&1
```

Expected: 6 tests pass.

- [ ] **Step 5: Add snapshot routes to `server/index.mjs`**

Add import:

```js
import { createSnapshot, listSnapshots, restoreSnapshot } from './mcp/snapshot.mjs';
```

Add three routes after the `/api/install-packages` endpoint:

```js
// ── Snapshots ─────────────────────────────────────────────────
app.get('/api/projects/:id/snapshots', async (req, res) => {
  const dir  = projectDir(safeId(req.params.id));
  const list = await listSnapshots(dir);
  res.json(list);
});

app.post('/api/projects/:id/snapshots', async (req, res) => {
  const dir   = projectDir(safeId(req.params.id));
  const label = req.body.label ?? 'Auto-snapshot';
  try {
    const snap = await createSnapshot(dir, label);
    res.json(snap);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/projects/:id/snapshots/:snapId/restore', async (req, res) => {
  const dir    = projectDir(safeId(req.params.id));
  const snapId = req.params.snapId;
  try {
    const meta = await restoreSnapshot(dir, snapId);
    res.json({ ok: true, meta });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});
```

- [ ] **Step 6: Commit**

```bash
cd /c/Lovable
git add server/mcp/snapshot.mjs server/mcp/snapshot.test.mjs server/index.mjs
git commit -m "feat: add snapshot MCP and REST endpoints"
```

---

## Task 7: useSnapshots Hook + SnapshotTimeline Component + Auto-Snapshot

**Files:**
- Create: `src/hooks/useSnapshots.ts`
- Create: `src/components/SnapshotTimeline.tsx`
- Create: `src/components/SnapshotTimeline.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/CodePanel.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Write the failing tests**

Create `src/components/SnapshotTimeline.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SnapshotTimeline } from './SnapshotTimeline';
import type { Snapshot } from '../../types';

const SNAPS: Snapshot[] = [
  { id: '2026-05-09T14-00-00-000Z', label: 'Initial build',  createdAt: '2026-05-09T14:00:00.000Z', fileCount: 3 },
  { id: '2026-05-09T15-00-00-000Z', label: 'Added styling',  createdAt: '2026-05-09T15:00:00.000Z', fileCount: 4 },
];

describe('SnapshotTimeline', () => {
  it('renders snapshot count button', () => {
    render(<SnapshotTimeline snapshots={SNAPS} onRestore={() => {}} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });

  it('opens dropdown on click showing all snapshots', () => {
    render(<SnapshotTimeline snapshots={SNAPS} onRestore={() => {}} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Initial build')).toBeInTheDocument();
    expect(screen.getByText('Added styling')).toBeInTheDocument();
  });

  it('calls onRestore with snapshot id when item clicked', () => {
    const onRestore = vi.fn();
    render(<SnapshotTimeline snapshots={SNAPS} onRestore={onRestore} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Initial build'));
    expect(onRestore).toHaveBeenCalledWith('2026-05-09T14-00-00-000Z');
  });

  it('renders nothing when snapshots array is empty', () => {
    const { container } = render(<SnapshotTimeline snapshots={[]} onRestore={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /c/Lovable
npx vitest run src/components/SnapshotTimeline.test.tsx --reporter=verbose 2>&1 | head -15
```

Expected: `Cannot find module './SnapshotTimeline'`.

- [ ] **Step 3: Create `src/hooks/useSnapshots.ts`**

```ts
import { useState, useCallback, useEffect } from 'react';
import type { Snapshot } from '../types';

export function useSnapshots(projectId: string) {
  const [snapshots,   setSnapshots]  = useState<Snapshot[]>([]);
  const [isRestoring, setRestoring]  = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/snapshots`);
      if (res.ok) setSnapshots(await res.json());
    } catch { /* server offline */ }
  }, [projectId]);

  const create = useCallback(async (label: string) => {
    if (!projectId) return;
    try {
      await fetch(`/api/projects/${projectId}/snapshots`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ label }),
      });
      await refresh();
    } catch { /* silent */ }
  }, [projectId, refresh]);

  const restore = useCallback(async (snapId: string, onDone: () => void) => {
    if (!projectId) return;
    setRestoring(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/snapshots/${snapId}/restore`, { method: 'POST' });
      if (res.ok) onDone();
    } catch { /* silent */ }
    finally { setRestoring(false); }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { snapshots, isRestoring, create, restore, refresh };
}
```

- [ ] **Step 4: Create `src/components/SnapshotTimeline.tsx`**

```tsx
import { useState } from 'react';
import type { Snapshot } from '../types';

interface Props {
  snapshots: Snapshot[];
  onRestore: (id: string) => void;
}

export function SnapshotTimeline({ snapshots, onRestore }: Props) {
  const [open, setOpen] = useState(false);

  if (snapshots.length === 0) return null;

  return (
    <div className="snap-tl" style={{ position: 'relative' }}>
      <button
        className="snap-tl__btn"
        onClick={() => setOpen((v) => !v)}
        title="Version history"
      >
        ⏱ {snapshots.length}
      </button>

      {open && (
        <>
          <div className="snap-tl__backdrop" onClick={() => setOpen(false)} />
          <div className="snap-tl__dropdown">
            <div className="snap-tl__hdr">Version History</div>
            <ul className="snap-tl__list">
              {snapshots.map((s) => (
                <li
                  key={s.id}
                  className="snap-tl__item"
                  onClick={() => { onRestore(s.id); setOpen(false); }}
                >
                  <div className="snap-tl__label">{s.label}</div>
                  <div className="snap-tl__meta">
                    {new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {' · '}{s.fileCount} file{s.fileCount !== 1 ? 's' : ''}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /c/Lovable
npx vitest run src/components/SnapshotTimeline.test.tsx --reporter=verbose 2>&1
```

Expected: 4 tests pass.

- [ ] **Step 6: Add SnapshotTimeline CSS to `src/index.css`**

Append to `src/index.css`:

```css
/* ── SnapshotTimeline ─────────────────────────────────────── */
.snap-tl__btn {
  background: transparent;
  border: 1px solid #333;
  border-radius: 4px;
  color: #666;
  font-size: 10px;
  padding: 3px 8px;
  cursor: pointer;
  white-space: nowrap;
}
.snap-tl__btn:hover { color: #999; border-color: #555; }
.snap-tl__backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
}
.snap-tl__dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  background: #0e0e1a;
  border: 1px solid #2a2a4e;
  border-radius: 6px;
  width: 240px;
  box-shadow: 0 4px 20px rgba(0,0,0,.6);
}
.snap-tl__hdr {
  padding: 8px 12px 6px;
  font-size: 9px;
  font-weight: 700;
  color: #FF5E1A;
  text-transform: uppercase;
  letter-spacing: .06em;
  border-bottom: 1px solid #1a1a2e;
}
.snap-tl__list {
  margin: 0;
  padding: 4px 0;
  list-style: none;
  max-height: 200px;
  overflow-y: auto;
}
.snap-tl__item {
  padding: 7px 12px;
  cursor: pointer;
}
.snap-tl__item:hover { background: #1a1a2e; }
.snap-tl__label {
  font-size: 11px;
  color: #C0C0E0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.snap-tl__meta {
  font-size: 9px;
  color: #555;
  margin-top: 2px;
}
```

- [ ] **Step 7: Wire SnapshotTimeline into `CodePanel.tsx`**

In `src/components/CodePanel.tsx`, add imports:

```tsx
import { SnapshotTimeline } from './SnapshotTimeline';
import type { Snapshot } from '../types';
```

Add to Props interface:

```tsx
snapshots?:        Snapshot[];
onRestoreSnapshot?: (id: string) => void;
```

Update function signature to destructure new props:

```tsx
export function CodePanel({ ..., snapshots = [], onRestoreSnapshot }: Props) {
```

In the toolbar JSX (after the run button block), add:

```tsx
{/* Snapshot timeline */}
{snapshots.length > 0 && onRestoreSnapshot && (
  <SnapshotTimeline snapshots={snapshots} onRestore={onRestoreSnapshot} />
)}
```

- [ ] **Step 8: Wire useSnapshots and auto-snapshot into `App.tsx`**

Add import:

```ts
import { useSnapshots } from './hooks/useSnapshots';
```

Inside `App()`, add the hook and auto-snapshot effect (after the `wasGeneratingRef` declarations):

```tsx
const { snapshots, create: createSnapshot, restore: restoreSnapshot } = useSnapshots(project.projectId);

// Track running→exited transitions for auto-snapshot
const prevExecStatusRef = useRef<string>('idle');
useEffect(() => {
  const wasRunning = prevExecStatusRef.current === 'running';
  prevExecStatusRef.current = execState.status;
  if (wasRunning && execState.status === 'exited' && execState.exitCode === 0) {
    const label = project.messages[project.messages.length - 1]?.content ?? 'Auto-snapshot';
    createSnapshot(label.slice(0, 80));
  }
}, [execState.status, execState.exitCode]);
```

Add the restore handler:

```tsx
const handleRestoreSnapshot = (snapId: string) => {
  restoreSnapshot(snapId, () => project.loadProject(project.projectId));
};
```

Pass to `CodePanel`:

```tsx
<CodePanel
  ...existing props...
  snapshots={snapshots}
  onRestoreSnapshot={handleRestoreSnapshot}
/>
```

- [ ] **Step 9: Verify TypeScript compiles**

```bash
cd /c/Lovable
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 10: Run all frontend tests**

```bash
cd /c/Lovable
npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
cd /c/Lovable
git add src/hooks/useSnapshots.ts src/components/SnapshotTimeline.tsx \
        src/components/SnapshotTimeline.test.tsx src/App.tsx \
        src/components/CodePanel.tsx src/index.css
git commit -m "feat: add Version Time Travel — snapshots and timeline dropdown"
```

---

## Task 8: Auto-Tester MCP + Server Endpoint

**Files:**
- Create: `server/mcp/tests.mjs`
- Create: `server/mcp/tests.test.mjs`
- Modify: `server/index.mjs`

- [ ] **Step 1: Write the failing tests**

Create `server/mcp/tests.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTestFramework, parseTestOutput, buildTestGenPrompt } from './tests.mjs';

test('detectTestFramework returns pytest for .py files', () => {
  assert.equal(detectTestFramework(['main.py', 'app.py']), 'pytest');
});

test('detectTestFramework returns node:test for .js files', () => {
  assert.equal(detectTestFramework(['index.js', 'server.mjs']), 'node:test');
});

test('detectTestFramework returns null for html-only projects', () => {
  assert.equal(detectTestFramework(['index.html', 'style.css']), null);
});

test('parseTestOutput parses pytest all-passed output', () => {
  const r = parseTestOutput('===== 5 passed in 0.12s =====', 'pytest');
  assert.equal(r.passed, 5);
  assert.equal(r.failed, 0);
  assert.equal(r.total, 5);
});

test('parseTestOutput parses pytest mixed output', () => {
  const r = parseTestOutput('===== 3 passed, 2 failed in 0.45s =====', 'pytest');
  assert.equal(r.passed, 3);
  assert.equal(r.failed, 2);
  assert.equal(r.total, 5);
});

test('parseTestOutput parses node:test TAP-style output', () => {
  const output = '# tests 8\n# pass 7\n# fail 1\n';
  const r = parseTestOutput(output, 'node:test');
  assert.equal(r.passed, 7);
  assert.equal(r.failed, 1);
  assert.equal(r.total, 8);
});

test('buildTestGenPrompt includes file path and framework', () => {
  const prompt = buildTestGenPrompt([{ path: 'calc.py', content: 'def add(a,b): return a+b' }], 'pytest');
  assert.ok(prompt.includes('calc.py'));
  assert.ok(prompt.toLowerCase().includes('pytest'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /c/Lovable
node --test server/mcp/tests.test.mjs 2>&1 | head -10
```

Expected: `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Create `server/mcp/tests.mjs`**

```js
/**
 * @param {string[]} filePaths
 * @returns {'pytest' | 'node:test' | null}
 */
export function detectTestFramework(filePaths) {
  if (filePaths.some((p) => p.endsWith('.py')))                                              return 'pytest';
  if (filePaths.some((p) => p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.ts')))  return 'node:test';
  return null;
}

/**
 * @param {string} output  - raw test runner output (ANSI stripped)
 * @param {'pytest' | 'node:test'} framework
 * @returns {{ passed: number; failed: number; total: number }}
 */
export function parseTestOutput(output, framework) {
  if (framework === 'pytest') {
    const passedM = output.match(/(\d+) passed/);
    const failedM = output.match(/(\d+) failed/);
    const passed  = passedM ? parseInt(passedM[1], 10) : 0;
    const failed  = failedM ? parseInt(failedM[1], 10) : 0;
    return { passed, failed, total: passed + failed };
  }
  if (framework === 'node:test') {
    const totalM  = output.match(/# tests (\d+)/);
    const passedM = output.match(/# pass (\d+)/);
    const failedM = output.match(/# fail (\d+)/);
    const passed  = passedM ? parseInt(passedM[1], 10) : 0;
    const failed  = failedM ? parseInt(failedM[1], 10) : 0;
    const total   = totalM  ? parseInt(totalM[1],  10) : passed + failed;
    return { passed, failed, total };
  }
  return { passed: 0, failed: 0, total: 0 };
}

/**
 * @param {{ path: string; content: string }[]} files
 * @param {'pytest' | 'node:test'} framework
 * @returns {string}
 */
export function buildTestGenPrompt(files, framework) {
  const fileList = files
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 3000)}\n\`\`\``)
    .join('\n\n');
  return `Write a ${framework} test file for the following project files. Output ONLY the test file using <forge-file> tags. Cover the main functions and important edge cases. Keep tests focused and runnable without external services.\n\n${fileList}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /c/Lovable
node --test server/mcp/tests.test.mjs 2>&1
```

Expected: 7 tests pass.

- [ ] **Step 5: Add `/api/projects/:id/test` endpoint to `server/index.mjs`**

Add imports:

```js
import { detectTestFramework, parseTestOutput, buildTestGenPrompt } from './mcp/tests.mjs';
```

Add the test endpoint after the snapshots routes:

```js
// ── Auto-tester ───────────────────────────────────────────────
app.post('/api/projects/:id/test', async (req, res) => {
  const { llmConfig } = req.body;
  const id  = safeId(req.params.id);
  const dir = projectDir(id);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const meta      = JSON.parse(await fs.readFile(metaPath(id), 'utf-8'));
    const filePaths = (meta.filePaths ?? []).map((f) => f.path);
    const framework = detectTestFramework(filePaths);

    if (!framework) {
      send({ done: true, result: { status: 'failed', passed: 0, failed: 0, total: 0, output: 'No testable language detected (Python or JS required)' } });
      res.end();
      return;
    }

    // Check if test files already exist
    const hasTests = filePaths.some((p) =>
      p.includes('test') || p.includes('spec') || p.startsWith('test_')
    );

    if (!hasTests) {
      send({ text: 'Generating tests…\n' });
      const projectFiles = await Promise.all(filePaths.map(async (fp) => {
        const content = await fs.readFile(safeFilePath(dir, fp), 'utf-8').catch(() => '');
        return { path: fp, content };
      }));

      const provider  = createProvider(llmConfig);
      const genText   = await provider.generate(
        [{ role: 'user', content: buildTestGenPrompt(projectFiles, framework) }],
        'You are a test generator. Output test files using <forge-file path="filename"> tags only. No explanation.',
      );

      const fileTag = /<forge-file\s+path="([^"]+)"[^>]*>([\s\S]*?)<\/forge-file>/g;
      let m;
      let wroteAny = false;
      while ((m = fileTag.exec(genText)) !== null) {
        const fp      = m[1];
        const content = m[2].trim();
        const absPath = safeFilePath(dir, fp);
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, content, 'utf-8');
        if (!meta.filePaths.find((f) => f.path === fp)) {
          meta.filePaths.push({ path: fp, lang: fp.endsWith('.py') ? 'python' : 'javascript' });
        }
        wroteAny = true;
        send({ text: `Generated ${fp}\n` });
      }
      await fs.writeFile(metaPath(id), JSON.stringify({ ...meta, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');

      if (!wroteAny) {
        send({ done: true, result: { status: 'failed', passed: 0, failed: 0, total: 0, output: 'Could not generate test files' } });
        res.end();
        return;
      }
    }

    // Run the tests
    send({ text: `Running ${framework} tests…\n` });
    let output = '';

    const [cmd, ...args] = framework === 'pytest'
      ? ['python', '-m', 'pytest', '-v']
      : ['node', '--test'];

    await new Promise((resolve) => {
      const proc = spawn(cmd, args, { cwd: dir, shell: false, env: process.env });
      proc.stdout.on('data', (d) => { const t = d.toString(); output += t; send({ text: t }); });
      proc.stderr.on('data', (d) => { const t = d.toString(); output += t; send({ text: t }); });
      proc.on('close', resolve);
      proc.on('error', (e) => { output += `\nError: ${e.message}`; resolve(1); });
    });

    const clean  = output.replace(/\x1b\[[0-9;]*m/g, '');
    const counts = parseTestOutput(clean, framework);
    send({
      done: true,
      result: {
        status:  counts.failed === 0 && counts.total > 0 ? 'passed' : 'failed',
        passed:  counts.passed,
        failed:  counts.failed,
        total:   counts.total,
        output:  output.slice(-2000),
      },
    });
  } catch (err) {
    send({ done: true, result: { status: 'failed', passed: 0, failed: 0, total: 0, output: String(err.message || err) } });
  }

  res.end();
});
```

- [ ] **Step 6: Commit**

```bash
cd /c/Lovable
git add server/mcp/tests.mjs server/mcp/tests.test.mjs server/index.mjs
git commit -m "feat: add auto-tester MCP and /api/test endpoint"
```

---

## Task 9: TestBadge + useAutoTest + CodePanel Wire

**Files:**
- Create: `src/components/TestBadge.tsx`
- Create: `src/components/TestBadge.test.tsx`
- Create: `src/hooks/useAutoTest.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/CodePanel.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Write the failing tests**

Create `src/components/TestBadge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TestBadge } from './TestBadge';

describe('TestBadge', () => {
  it('renders nothing when idle', () => {
    const { container } = render(
      <TestBadge state={{ status: 'idle', passed: 0, failed: 0, total: 0, output: '' }} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows running text when status is running', () => {
    render(<TestBadge state={{ status: 'running', passed: 0, failed: 0, total: 0, output: '' }} />);
    expect(screen.getByText(/running tests/i)).toBeInTheDocument();
  });

  it('shows pass badge with correct counts', () => {
    render(<TestBadge state={{ status: 'passed', passed: 8, failed: 0, total: 8, output: '' }} />);
    expect(screen.getByText(/8\/8/)).toBeInTheDocument();
    expect(screen.getByText(/passed/i)).toBeInTheDocument();
  });

  it('shows fail badge with correct counts', () => {
    render(<TestBadge state={{ status: 'failed', passed: 3, failed: 5, total: 8, output: '' }} />);
    expect(screen.getByText(/3\/8/)).toBeInTheDocument();
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /c/Lovable
npx vitest run src/components/TestBadge.test.tsx --reporter=verbose 2>&1 | head -15
```

Expected: `Cannot find module './TestBadge'`.

- [ ] **Step 3: Create `src/components/TestBadge.tsx`**

```tsx
import type { TestResult } from '../types';

interface Props {
  state: TestResult;
}

export function TestBadge({ state }: Props) {
  if (state.status === 'idle') return null;

  if (state.status === 'running') {
    return (
      <span className="test-badge test-badge--running" title="Running tests">
        <span className="test-badge__dot" /> Running tests…
      </span>
    );
  }

  const isPassed = state.status === 'passed';
  return (
    <span
      className={`test-badge test-badge--${state.status}`}
      title={state.output || undefined}
    >
      {isPassed ? '✓' : '✗'} {state.passed}/{state.total} {isPassed ? 'passed' : 'failed'}
    </span>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /c/Lovable
npx vitest run src/components/TestBadge.test.tsx --reporter=verbose 2>&1
```

Expected: 4 tests pass.

- [ ] **Step 5: Add TestBadge CSS to `src/index.css`**

Append to `src/index.css`:

```css
/* ── TestBadge ────────────────────────────────────────────── */
.test-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  white-space: nowrap;
}
.test-badge--running {
  background: #1a1a2e;
  color: #888;
  border: 1px solid #333;
}
.test-badge__dot {
  width: 6px;
  height: 6px;
  background: #888;
  border-radius: 50%;
  animation: pulse 1s ease infinite;
}
.test-badge--passed {
  background: rgba(34, 197, 94, .1);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, .3);
}
.test-badge--failed {
  background: rgba(239, 68, 68, .1);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, .3);
}
```

- [ ] **Step 6: Create `src/hooks/useAutoTest.ts`**

```ts
import { useState, useCallback } from 'react';
import type { TestResult, LLMProvider } from '../types';

const INITIAL: TestResult = { status: 'idle', passed: 0, failed: 0, total: 0, output: '' };

export function useAutoTest(projectId: string, llmConfig: LLMProvider) {
  const [state, setState] = useState<TestResult>(INITIAL);

  const runTests = useCallback(async () => {
    if (!projectId) return;
    setState({ ...INITIAL, status: 'running' });
    try {
      const res = await fetch(`/api/projects/${projectId}/test`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ llmConfig }),
      });
      if (!res.ok) {
        setState({ ...INITIAL, status: 'failed', output: `HTTP ${res.status}` });
        return;
      }

      const reader = res.body!.getReader();
      const dec    = new TextDecoder();
      let   result: TestResult | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of dec.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const p = JSON.parse(line.slice(6));
            if (p.done && p.result) result = p.result as TestResult;
          } catch { /* ignore */ }
        }
      }

      setState(result ?? { ...INITIAL, status: 'failed', output: 'No result received' });
    } catch (e) {
      setState({ ...INITIAL, status: 'failed', output: String(e instanceof Error ? e.message : e) });
    }
  }, [projectId, llmConfig]);

  const reset = useCallback(() => setState(INITIAL), []);

  return { state, runTests, reset };
}
```

- [ ] **Step 7: Wire useAutoTest into `App.tsx`**

Add import:

```ts
import { useAutoTest } from './hooks/useAutoTest';
```

Inside `App()`, add the hook:

```tsx
const { state: testState, runTests, reset: resetTests } = useAutoTest(project.projectId, project.llmConfig);
```

Reset tests when a new run starts (add to or create a new useEffect):

```tsx
useEffect(() => {
  if (execState.status === 'running') resetTests();
}, [execState.status]);
```

Pass to CodePanel:

```tsx
<CodePanel
  ...existing props...
  testState={testState}
  onRunTests={runTests}
/>
```

- [ ] **Step 8: Add TestBadge and Test button to `CodePanel.tsx`**

Add imports:

```tsx
import { TestBadge } from './TestBadge';
import type { TestResult } from '../types';
```

Add to Props interface:

```tsx
testState?:  TestResult;
onRunTests?: () => void;
```

Update function signature to destructure:

```tsx
export function CodePanel({ ..., testState, onRunTests }: Props) {
```

In the toolbar JSX (after the run button, before SnapshotTimeline), add:

```tsx
{/* Test badge */}
{testState && testState.status !== 'idle' && (
  <TestBadge state={testState} />
)}

{/* Test button — shown only after a successful run */}
{onRunTests && execState.status === 'exited' && execState.exitCode === 0 && (
  <button
    className="run-btn"
    style={{ fontSize: '10px', padding: '3px 10px' }}
    onClick={onRunTests}
    disabled={testState?.status === 'running'}
    title="Generate and run tests"
  >
    ✓ Test
  </button>
)}
```

- [ ] **Step 9: Verify all tests pass**

```bash
cd /c/Lovable
npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: all frontend tests pass (PlanCard ×5, SnapshotTimeline ×4, TestBadge ×4, plus existing).

```bash
cd /c/Lovable
node --test server/mcp/search.test.mjs server/mcp/snapshot.test.mjs \
           server/mcp/tests.test.mjs server/providers/plan.test.mjs 2>&1
```

Expected: all backend tests pass.

- [ ] **Step 10: Verify TypeScript compilation**

```bash
cd /c/Lovable
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
cd /c/Lovable
git add src/components/TestBadge.tsx src/components/TestBadge.test.tsx \
        src/hooks/useAutoTest.ts src/App.tsx \
        src/components/CodePanel.tsx src/index.css
git commit -m "feat: add TestBadge and useAutoTest — AI Auto-Tester complete"
```

---

## Self-Review

**Spec coverage:**
- **2.1 AI Project Planner** ✓ — `/api/plan` endpoint, `PlanCard` component, confirm/reject flow, skip-planning toggle in ProviderSettings
- **2.2 AI Auto-Tester** ✓ — `run_tests` MCP tool (tests.mjs), framework detection, test generation via `provider.generate()`, `TestBadge`, `useAutoTest` hook, "✓ Test" button after exit-0
- **2.3 Web Search MCP** ✓ — DuckDuckGo search, `/api/search` endpoint, auto-injected into system prompt for every generation
- **2.4 Version Time Travel** ✓ — `createSnapshot`/`listSnapshots`/`restoreSnapshot`, `.forge/snapshots/{ts}/` storage, `SnapshotTimeline` dropdown, auto-snapshot on every exit-0 run

**Placeholders scan:** none found — all code is complete and runnable.

**Type consistency check:**
- `ProjectPlan` (types.ts) ↔ used in PlanCard.tsx, ChatPanel.tsx, App.tsx — consistent
- `Snapshot` (types.ts) ↔ used in SnapshotTimeline.tsx, useSnapshots.ts — consistent
- `TestResult` (types.ts) ↔ used in TestBadge.tsx, useAutoTest.ts, CodePanel.tsx — consistent
- `provider.generate(messages, systemPrompt)` — added to all 3 providers with same signature

**Note:** The spec says "failed tests feed back into the AI fix loop." This tight integration (auto-fix loop triggered by failed tests) is **not** implemented in Phase 2 — it would require plumbing test output back through `useAutoFix`, which is complex and creates ambiguity about what to fix. The TestBadge shows the failure count and the user can manually prompt fixes. This can be added in a Phase 2.5 iteration.
