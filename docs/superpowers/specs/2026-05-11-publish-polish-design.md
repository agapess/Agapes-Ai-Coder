# Publish System Polish — Design Spec

**Goal:** Let users choose a custom slug when publishing, see the full clickable URL after publish, and fix minor domain references.

**Architecture:** Thin additions to the existing publish flow. No new data model — the `published_apps` table already stores slugs. New endpoint for slug availability check. Frontend dialog gains a controlled input + debounced check.

**Tech Stack:** Express (server), React + TypeScript (client), existing SQLite `published_apps` table.

---

## Backend

### 1. `POST /api/projects/:id/publish` — accept optional custom slug

**Current behaviour:** Generates a random 8-char hex slug, ignores request body.

**New behaviour:**
- Read `req.body.slug` (optional string).
- If provided:
  - Validate: `/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/` (3–50 chars, lowercase alphanumeric + hyphens, no leading/trailing hyphens).
  - If invalid → `400 { error: 'Invalid slug. Use 3–50 lowercase letters, numbers, or hyphens.' }`
  - If taken → `409 { error: 'Slug already taken.' }`
  - If valid and available → use it.
- If omitted → generate random hex slug as today.
- Response unchanged: `{ slug, url: /app/${slug} }` — URL remains relative; frontend builds full URL with `window.location.origin`.

### 2. `GET /api/check-slug/:slug` — availability check (new endpoint)

- No auth required (slug namespace is global).
- Validate slug format (same regex). If invalid → `{ available: false, reason: 'invalid' }`.
- Query `published_apps` table. Return `{ available: boolean }`.

### 3. Fix domain references

- `server/index.mjs` line ~1035: `'HTTP-Referer': 'https://agapes.ai'` → `'https://agapes.us'`
- `server/providers/index.mjs` line ~34: same change.

---

## Frontend

### 4. `usePublish.ts` — pass slug, build full URL

- `publish(id, slug?)` — send `{ slug }` in POST body (omit key if empty string).
- Build full URL: `const url = \`\${window.location.origin}/app/\${data.slug}\`` instead of using the relative URL from the server.
- Expose `url` in state as before.

### 5. `PublishDialog.tsx` — slug input + live availability check

**Unpublished state (before publishing):**
- New field above the Publish button:
  - Label: "Custom URL (optional)"
  - `<input>` placeholder: `my-tetris`
  - Debounce 400 ms on change → call `/api/check-slug/:slug`
  - Show inline status:
    - Empty → nothing shown
    - Checking → `Checking…` in grey
    - Available → `✓ Available` in green
    - Taken → `✗ Already taken` in red
    - Invalid format → `✗ Letters, numbers and hyphens only` in red
  - Disable Publish button while check is in-flight or slug is shown as taken/invalid.

**Published state (after publishing):**
- Show full URL in a read-only input: `http://localhost:3001/app/my-tetris`
- **Copy** button (copies URL to clipboard, briefly shows "Copied!")
- **Open ↗** button (opens in new tab) — already exists, just update href to full URL.
- Unpublish button unchanged.

---

## File Summary

| File | Change |
|------|--------|
| `server/index.mjs` | Accept `slug` in POST publish body; add `GET /api/check-slug/:slug`; fix agapes.ai ref |
| `server/providers/index.mjs` | Fix agapes.ai ref |
| `src/hooks/usePublish.ts` | Pass slug to API; build full URL with `window.location.origin` |
| `src/components/PublishDialog.tsx` | Add slug input with debounced availability check; show full URL with copy button |

---

## Validation Rules (shared between server and client)

```
/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/
```

- 3–50 characters total
- Lowercase letters and numbers only (a–z, 0–9)
- Hyphens allowed in the middle, not at start or end
- Client shows format error instantly (no network call needed for invalid format)

---

## Edge Cases

- **Already published project re-publishes:** If the project already has a slug (existing row in `published_apps`), return the existing slug/URL immediately without re-inserting. User must unpublish first to change slug.
- **Slug taken by another project:** Return `409`. Client shows `✗ Already taken`.
- **Empty slug field submitted:** Treat as omitted — server generates random hex slug.
- **Very fast typing:** Debounce 400 ms prevents excessive API calls; cancel previous in-flight request on new keystroke.
