# Publish System Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add custom slug input to the publish dialog, show the full clickable URL after publishing, and fix two stale domain references.

**Architecture:** Four files change. Server gains a new `GET /api/check-slug/:slug` endpoint and slug validation in the existing publish route. The hook builds the full URL client-side. The dialog adds a controlled input with a debounced availability check and updates its `onPublish` signature to pass the slug. App.tsx threads the slug through.

**Tech Stack:** Express (server), React 18 + TypeScript (client), existing SQLite `published_apps` table, no new dependencies.

---

## File Map

| File | What changes |
|------|-------------|
| `server/providers/index.mjs` | `agapes.ai` → `agapes.us` in OpenRouter header |
| `server/index.mjs` | New `GET /api/check-slug/:slug`; accept `slug` body in POST publish |
| `src/hooks/usePublish.ts` | `publish(id, slug?)` sends body; both `publish` + `checkStatus` build full URL |
| `src/components/PublishDialog.tsx` | Slug input + debounced check; `onPublish(slug?)` signature; full URL in Open link |
| `src/App.tsx` | Pass slug from dialog through to `publishHook.publish()` |

---

## Task 1: Fix stale domain reference

**Files:**
- Modify: `server/providers/index.mjs` line 34

- [ ] **Step 1: Edit the file**

In `server/providers/index.mjs`, find and replace:
```js
headers: { 'HTTP-Referer': 'https://agapes.ai', 'X-Title': 'Agapes Ai Coder' },
```
with:
```js
headers: { 'HTTP-Referer': 'https://agapes.us', 'X-Title': 'Agapes Ai Coder' },
```

- [ ] **Step 2: Verify no other stale references**

```bash
grep -rn "agapes\.ai" server/ src/
```
Expected: zero matches (or only in comments).

- [ ] **Step 3: Commit**

```bash
git add server/providers/index.mjs
git commit -m "fix: update OpenRouter referer to agapes.us"
```

---

## Task 2: Server — slug validation helper + check-slug endpoint + custom slug in publish

**Files:**
- Modify: `server/index.mjs`

### Slug validation

- [ ] **Step 1: Add the slug validation function near the top of server/index.mjs (after the imports block, before the first route)**

Find the line `// ── System prompt` and insert above it:

```js
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
function isValidSlug(s) { return typeof s === 'string' && SLUG_RE.test(s); }
```

### check-slug endpoint

- [ ] **Step 2: Add the new check-slug route**

Find this line in `server/index.mjs`:
```js
app.get('/api/projects/:id/publish-status', authenticate, requireAuth, async (req, res) => {
```

Insert the following **before** that line:

```js
// ── Slug availability check (public) ──────────────────────────
app.get('/api/check-slug/:slug', (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) return res.json({ available: false, reason: 'invalid' });
  res.json({ available: !slugExists(slug) });
});

```

- [ ] **Step 3: Verify the route is in the right place by running the server**

```bash
cd server && node index.mjs &
sleep 1
curl http://localhost:3001/api/check-slug/hello-world
```
Expected output: `{"available":true}` (or false if slug exists)

Kill the server: `kill %1`

### Accept custom slug in POST publish

- [ ] **Step 4: Update the publish POST route**

Find this block in `server/index.mjs`:
```js
  // Check if already published
  const existing = getPublishedAppByProject(id, req.user.id);
  if (existing) {
    return res.json({ slug: existing.slug, url: `/app/${existing.slug}` });
  }

  // Generate unique slug
  let slug;
  let attempts = 0;
  do {
    slug = crypto.randomBytes(4).toString('hex');
    attempts++;
  } while (slugExists(slug) && attempts < 10);

  publishProject({ slug, projectId: id, userId: req.user.id });
  res.json({ slug, url: `/app/${slug}` });
```

Replace it with:
```js
  // Check if already published
  const existing = getPublishedAppByProject(id, req.user.id);
  if (existing) {
    return res.json({ slug: existing.slug, url: `/app/${existing.slug}` });
  }

  // Use custom slug if provided, otherwise generate random
  let slug;
  const requested = req.body?.slug?.trim();
  if (requested) {
    if (!isValidSlug(requested)) {
      return res.status(400).json({ error: 'Invalid slug. Use 3–50 lowercase letters, numbers, or hyphens.' });
    }
    if (slugExists(requested)) {
      return res.status(409).json({ error: 'Slug already taken. Choose a different name.' });
    }
    slug = requested;
  } else {
    let attempts = 0;
    do {
      slug = crypto.randomBytes(4).toString('hex');
      attempts++;
    } while (slugExists(slug) && attempts < 10);
  }

  publishProject({ slug, projectId: id, userId: req.user.id });
  res.json({ slug, url: `/app/${slug}` });
```

- [ ] **Step 5: Commit**

```bash
git add server/index.mjs
git commit -m "feat: add check-slug endpoint and custom slug support in publish"
```

---

## Task 3: Update usePublish hook

**Files:**
- Modify: `src/hooks/usePublish.ts`

- [ ] **Step 1: Replace the entire file content**

```ts
import { useState, useCallback, useEffect } from 'react';

export interface PublishState {
  isPublished: boolean;
  slug:        string | null;
  url:         string | null;
  isLoading:   boolean;
  error:       string | null;
}

const INITIAL: PublishState = {
  isPublished: false,
  slug:        null,
  url:         null,
  isLoading:   false,
  error:       null,
};

function buildFullUrl(relativeUrl: string): string {
  return `${window.location.origin}${relativeUrl}`;
}

export function usePublish(projectId: string | null) {
  const [state, setState] = useState<PublishState>(INITIAL);

  const checkStatus = useCallback(async (id: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await fetch(`/api/projects/${id}/publish-status`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setState({
        isPublished: data.published,
        slug:        data.slug ?? null,
        url:         data.url  ? buildFullUrl(data.url) : null,
        isLoading:   false,
        error:       null,
      });
    } catch (err) {
      setState((s) => ({ ...s, isLoading: false, error: String(err) }));
    }
  }, []);

  useEffect(() => {
    if (projectId) checkStatus(projectId);
    else setState(INITIAL);
  }, [projectId, checkStatus]);

  const publish = useCallback(async (id: string, slug?: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await fetch(`/api/projects/${id}/publish`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ slug: slug?.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setState({ isPublished: true, slug: data.slug, url: buildFullUrl(data.url), isLoading: false, error: null });
    } catch (err) {
      setState((s) => ({ ...s, isLoading: false, error: String(err) }));
    }
  }, []);

  const unpublish = useCallback(async (id: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await fetch(`/api/projects/${id}/publish`, {
        method:      'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState(INITIAL);
    } catch (err) {
      setState((s) => ({ ...s, isLoading: false, error: String(err) }));
    }
  }, []);

  return { ...state, publish, unpublish, checkStatus };
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePublish.ts
git commit -m "feat: build full URL in usePublish, accept slug param"
```

---

## Task 4: Update PublishDialog with slug input + debounced availability check

**Files:**
- Modify: `src/components/PublishDialog.tsx`

- [ ] **Step 1: Replace the entire file content**

```tsx
import { useState, useEffect, useRef } from 'react';
import { Globe, Copy, X, Loader } from 'lucide-react';
import type { PublishState } from '../hooks/usePublish';

interface Props {
  projectId:   string;
  state:       PublishState;
  onPublish:   (slug?: string) => void;
  onUnpublish: () => void;
  onClose:     () => void;
}

type SlugStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

export function PublishDialog({ projectId: _projectId, state, onPublish, onUnpublish, onClose }: Props) {
  const [slug,       setSlug]       = useState('');
  const [slugStatus, setSlugStatus] = useState<SlugStatus>('idle');
  const [copied,     setCopied]     = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef    = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current)    abortRef.current.abort();

    const trimmed = slug.trim();
    if (!trimmed) { setSlugStatus('idle'); return; }
    if (!SLUG_RE.test(trimmed)) { setSlugStatus('invalid'); return; }

    setSlugStatus('checking');
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res  = await fetch(`/api/check-slug/${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        const data = await res.json();
        setSlugStatus(data.available ? 'available' : 'taken');
      } catch {
        setSlugStatus('idle');
      }
    }, 400);
  }, [slug]);

  const slugHint: { text: string; color: string } | null =
    slugStatus === 'checking'  ? { text: 'Checking…',                          color: '#888' }  :
    slugStatus === 'available' ? { text: '✓ Available',                        color: '#7fff7f' } :
    slugStatus === 'taken'     ? { text: '✗ Already taken',                    color: '#ff7f7f' } :
    slugStatus === 'invalid'   ? { text: '✗ Lowercase letters, numbers, hyphens only (3–50 chars)', color: '#ff7f7f' } :
    null;

  const canPublish = !state.isLoading && slugStatus !== 'checking' && slugStatus !== 'taken' && slugStatus !== 'invalid';

  const handlePublish = () => onPublish(slug.trim() || undefined);

  const copyUrl = () => {
    if (!state.url) return;
    navigator.clipboard.writeText(state.url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="publish-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="publish-dialog">
        <div className="publish-header">
          <div className="publish-title">
            <Globe size={15} />
            Publish App
          </div>
          <button className="icon-btn" onClick={onClose}><X size={14} /></button>
        </div>

        <div className="publish-body">
          {!state.isPublished ? (<>
            <p className="publish-desc">
              Publish this project as a static web app accessible at a public URL.
            </p>

            <div className="settings-row" style={{ marginBottom: 8 }}>
              <label className="settings-label">Custom URL (optional)</label>
              <input
                className="settings-input"
                type="text"
                placeholder="my-tetris"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                spellCheck={false}
                disabled={state.isLoading}
              />
              {slugHint && (
                <span style={{ fontSize: 10, color: slugHint.color, marginTop: 4, display: 'block' }}>
                  {slugHint.text}
                </span>
              )}
            </div>

            <p className="publish-note">
              Static only — visitors see the generated files. No AI generation, no data storage.
            </p>

            {state.error && <p className="publish-error">{state.error}</p>}

            <div className="publish-actions">
              <button className="publish-btn" onClick={handlePublish} disabled={!canPublish}>
                {state.isLoading ? <Loader size={13} className="clone-btn__spin" /> : <Globe size={13} />}
                {state.isLoading ? 'Publishing…' : 'Publish'}
              </button>
              <button className="publish-cancel" onClick={onClose}>Cancel</button>
            </div>
          </>) : (<>
            <p className="publish-desc publish-desc--success">Your app is live!</p>

            <div className="publish-url-row">
              <input
                className="publish-url-input"
                readOnly
                value={state.url ?? ''}
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button className="icon-btn" onClick={copyUrl} title="Copy URL">
                <Copy size={13} />
              </button>
            </div>

            {copied && (
              <span style={{ fontSize: 10, color: '#7fff7f', marginTop: 4, display: 'block' }}>
                Copied!
              </span>
            )}

            <p className="publish-note">
              Static only — visitors see the generated files. No AI generation, no data storage.
            </p>

            {state.error && <p className="publish-error">{state.error}</p>}

            <div className="publish-actions">
              <a className="publish-open" href={state.url ?? ''} target="_blank" rel="noreferrer">
                Open App ↗
              </a>
              <button
                className="publish-unpublish"
                onClick={onUnpublish}
                disabled={state.isLoading}
              >
                {state.isLoading ? 'Unpublishing…' : 'Unpublish'}
              </button>
            </div>
          </>)}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/PublishDialog.tsx
git commit -m "feat: add slug input with availability check to PublishDialog"
```

---

## Task 5: Update App.tsx to thread slug through

**Files:**
- Modify: `src/App.tsx` (the `onPublish` prop passed to `PublishDialog`)

- [ ] **Step 1: Update the onPublish handler in App.tsx**

Find:
```tsx
        <PublishDialog
          state={publishHook}
          onPublish={() => publishHook.publish(project.projectId)}
```

Replace with:
```tsx
        <PublishDialog
          state={publishHook}
          onPublish={(slug) => publishHook.publish(project.projectId, slug)}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Restart server and manually test the full flow**

```bash
# Kill existing server, start fresh
cd server && node index.mjs &
```

Test checklist:
1. Open the app → open a project → click the Globe/Publish button
2. Type `test-app` in the Custom URL field → should show `✓ Available` in green
3. Click Publish → dialog should switch to "Your app is live!" showing `http://localhost:3001/app/test-app`
4. Copy button → paste in notepad → should be the full URL
5. Open App ↗ → should open in new tab and show the app
6. Close dialog → reopen → should still show published state with full URL
7. Click Unpublish → slug becomes available again
8. Open a second project → try slug `test-app` again → should work (not taken anymore)
9. Try slug `x` (too short) → should show invalid error instantly, Publish button disabled
10. Try slug `Test-App` (uppercase) — input auto-lowercases as you type

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire slug from PublishDialog through to publish hook"
```

---

## Self-Review

**Spec coverage:**
- ✅ Custom slug input with validation
- ✅ Real-time availability check (`GET /api/check-slug/:slug`)
- ✅ Full URL displayed after publish (`window.location.origin + relative`)
- ✅ Copy button with "Copied!" feedback
- ✅ Open in new tab with full URL
- ✅ Empty slug → random hex fallback
- ✅ Taken slug → 409 error surfaced in UI
- ✅ Invalid slug → instant client-side feedback, no network call
- ✅ agapes.ai → agapes.us domain fix
- ✅ Multi-file serving already works (existing `/app/:slug/*` route unchanged)

**No placeholders:** All steps contain complete code.

**Type consistency:** `publish(id: string, slug?: string)` defined in Task 3, called in Task 5 as `publish(project.projectId, slug)` ✓. `onPublish: (slug?: string) => void` defined in Task 4, wired in Task 5 ✓.
