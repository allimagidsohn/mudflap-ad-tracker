# Next Steps — Mudflap Ad Tracker Refactor

This document covers the full plan to refactor the Mudflap Ad Tracker from its current state (static HTML + Supabase client-side + Vercel serverless) to a unified dynamic app with a proper backend, modular codebase, and Neon Postgres.

---

## Table of Contents

1. [Current State](#1-current-state)
2. [Why We're Changing](#2-why-were-changing)
3. [Target Architecture](#3-target-architecture)
4. [Technology Choices](#4-technology-choices)
5. [Directory Structure](#5-directory-structure)
6. [Backend API Specification](#6-backend-api-specification)
7. [Database Schema](#7-database-schema)
8. [Frontend Refactor Plan](#8-frontend-refactor-plan)
9. [Environment Variables](#9-environment-variables)
10. [Deployment — Render](#10-deployment--render)
11. [Migration Checklist](#11-migration-checklist)
12. [Files to Delete](#12-files-to-delete)
13. [Future Considerations](#13-future-considerations)

---

## 1. Current State

### What exists today

| File | Purpose | Status |
|------|---------|--------|
| `create.html` | Brief builder form. Sends creative brief to Claude via `/api/generate`, shows 3 AI-generated ad concepts. User edits inline, approves to pipeline or retires. | ✅ Active |
| `index.html` | Pipeline board. Kanban view with 4 stages (Waiting for Review → Needs Revision → Ready for Production → Archived). Inline editing, search/filter, revision notes, CSV export. | ✅ Active |
| `generate.html` | Earlier/alternate version of the brief builder with a slightly different UI flow and fewer channel options. | ⚠️ Stale — to be deleted |
| `tracker-old.html` | Original tracker with a 7-stage status model (Briefs → In Copy Production → Needs Copy Review → In Design → Live → Winner → Archive). Complex modal form. | ❌ Deprecated — to be deleted |
| `api/generate.js` | Vercel serverless function. 10-line proxy that forwards requests to `https://api.anthropic.com/v1/messages`. | 🔁 To be replaced |
| `schema.sql` | Neon Postgres table definition. Already created and applied. | ✅ Done |
| `seed.js` | One-time migration script that pulled 87 rows from Supabase into Neon. | ✅ Done — can be deleted |

### How it currently works

```
Browser
  │
  ├── create.html / index.html
  │     │
  │     ├── Loads @supabase/supabase-js@2 from CDN
  │     ├── Connects directly to Supabase using hardcoded anon key
  │     ├── All CRUD operations go: Browser → Supabase REST API → Postgres
  │     │
  │     └── AI generation goes: Browser → Vercel /api/generate → Anthropic API
  │
  └── No build step. No bundler. Everything is inline <script> and <style>.
```

### Services currently used

| Service | Role | Credentials |
|---------|------|-------------|
| **Supabase** | Database + REST API | Anon key hardcoded in HTML (public, no auth, no RLS) |
| **Anthropic (Claude)** | AI ad generation via `claude-sonnet-4-20250514` | API key on Vercel env only |
| **Vercel** | Static hosting + serverless function (`api/generate.js`) | Connected to GitHub repo |
| **Google Fonts CDN** | Bebas Neue + DM Sans | Public |
| **jsDelivr CDN** | Supabase JS SDK v2 | Public |

---

## 2. Why We're Changing

### Problems with the current setup

1. **No auth, no RLS.** The Supabase anon key is in the HTML source. Anyone who opens DevTools can read/write all data. There are no Row Level Security policies on the `ads` table.

2. **Vendor lock-in.** Vercel serverless function convention (`export default async function handler`). Supabase SDK coupled into every page. Can't move without rewriting.

3. **No modularity.** `create.html` is ~1400 lines of inline JS + CSS. `index.html` is ~1200 lines. No shared components. The nav bar is copy-pasted across files. Constants are duplicated.

4. **No build tooling.** No `package.json` (until we added one for the seed script). No `.env` file. No bundling. Secrets in source code.

5. **Dead weight.** `tracker-old.html` and `generate.html` are stale versions still in the repo.

### Why we can't stay purely static

Supabase exposes a public REST API — that's why the browser could talk to it directly. Neon is raw Postgres with **no public REST API**. If we kept a purely static site, we'd have to expose database credentials in client-side JavaScript, which is unacceptable.

We need a backend. The question was: one service or two? We chose **one**.

### Why a single dynamic service instead of static + separate API

| Concern | Single dynamic | Static site + separate API |
|---------|---------------|---------------------------|
| CORS | None — same origin | Must configure on both sides |
| Deployment | One thing to deploy | Two services that need to coordinate |
| Environment variables | One place | Duplicated across services |
| Cookie-based auth (future) | Trivial — same origin | Annoying — credentials mode, CORS headers |
| Cost on Render | Free tier or $7/mo | Two services minimum = $14/mo |
| Complexity | Lower | Higher |

---

## 3. Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Render Web Service (Node.js)                               │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Hono server                                          │  │
│  │                                                       │  │
│  │  Static file serving (built by Vite):                 │  │
│  │    GET /           → pipeline page (index.html)       │  │
│  │    GET /create     → brief builder page               │  │
│  │    GET /assets/*   → CSS and JS bundles               │  │
│  │                                                       │  │
│  │  API routes:                                          │  │
│  │    GET    /api/ads          → list all ads            │  │
│  │    POST   /api/ads          → create an ad            │  │
│  │    PATCH  /api/ads/:id      → update an ad            │  │
│  │    DELETE /api/ads/:id      → delete an ad            │  │
│  │    POST   /api/generate     → Anthropic proxy         │  │
│  │                                                       │  │
│  │  Database connection:                                 │  │
│  │    node-postgres (pg) → Neon Postgres                 │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Data flow after refactor

```
Browser
  │
  ├── / (pipeline page)
  │     │
  │     ├── Loads bundled JS + CSS (from same origin, no CDN for app code)
  │     ├── All data operations go: Browser → /api/ads → Hono → Neon Postgres
  │     │
  │     └── AI generation goes: Browser → /api/generate → Hono → Anthropic API
  │
  └── No Supabase SDK. No hardcoded DB credentials. No CDN dependencies for app code.
```

---

## 4. Technology Choices

### Build tool: Vite

**What it is:** A dev server + bundler. Not a framework.

**Why Vite:**
- Gives us `import`/`export` (ES modules) in the browser during dev
- Handles CSS imports that get extracted to a stylesheet at build time
- Reads `.env` files for environment variables
- Hot module reload during development
- Outputs plain static HTML/CSS/JS — deployable anywhere
- No opinion about React/Vue/Svelte — works great with vanilla JS

**Why not:**
- Webpack (overkill, config-heavy)
- esbuild directly (no dev server, no env vars out of the box)
- No build tool at all (we'd be stuck with inline scripts forever)

### Backend: Hono

**What it is:** A tiny, fast web framework for Node.js. Think Express but smaller.

**Why Hono:**
- ~14KB. Nearly zero overhead.
- Express-compatible routing (`app.get`, `app.post`, middleware).
- Built-in static file serving.
- Works on Node.js, but also Cloudflare Workers, Deno, Bun if we ever move.
- No magic — it's just request in, response out.

**Why not:**
- Express (perfectly fine, just heavier. Happy to use Express if preferred.)
- Fastify (good, but more opinionated than we need.)
- Next.js / Nuxt / any SSR framework (massive overkill.)

### Database driver: node-postgres (`pg`)

**What it is:** The standard Postgres client for Node.js.

**Why pg:**
- Already installed (we used it for `seed.js`).
- Direct Postgres wire protocol — no ORM, no abstraction layer.
- Neon is Postgres. This is the correct tool.
- We could use `@neondatabase/serverless` for HTTP-based connections, but `pg` over TCP is simpler and more portable.

**Why not:**
- Prisma / Drizzle / any ORM (overkill for one table with ~10 CRUD operations.)
- Supabase JS SDK (defeats the purpose of moving off Supabase.)
- `@neondatabase/serverless` (adds a Neon-specific import — `pg` is vendor-neutral.)

### CSS: Plain CSS with Vite imports

No Tailwind, no CSS-in-JS, no preprocessor. Just `.css` files imported in JS modules. Vite extracts them into a stylesheet at build time.

The existing CSS custom properties (`--bg`, `--surface`, `--accent`, etc.) already form a solid design token system. We'll extract those into `tokens.css` and split the rest by component.

### No framework (React, Vue, Svelte, etc.)

The current code uses a pattern that works well: **functions that return HTML strings**. This is a lightweight, framework-free approach that's easy to understand and maintain. We'll keep it.

Example:
```js
// components/ad-card.js
export function adCard(ad, isExpanded) {
  return `
    <div class="ad-card">
      <div class="card-main">
        <div class="card-title">${esc(ad.concept)}</div>
        <div class="card-insight">${esc(ad.coreInsight)}</div>
      </div>
      ${isExpanded ? expandedSection(ad) : ''}
    </div>
  `
}
```

This is essentially a minimal template engine. It's what the code already does — we're just splitting it into files.

---

## 5. Directory Structure

```
mudflap-ad-tracker/
├── .env                        # Local environment variables (gitignored)
├── .env.example                # Template for required env vars (committed)
├── .gitignore
├── package.json
├── vite.config.js              # Vite config (dev server, build output, proxy)
│
├── schema.sql                  # Database schema (already done)
├── seed.js                     # One-time migration script (already done)
├── README.md                   # Project documentation
├── NEXT_STEPS.md               # This file
│
├── src/
│   ├── server/
│   │   ├── index.js            # Hono app entry point
│   │   ├── db.js               # Neon connection pool + query helpers
│   │   └── routes/
│   │       ├── ads.js          # CRUD endpoints for /api/ads
│   │       └── generate.js     # POST /api/generate → Anthropic proxy
│   │
│   ├── client/
│   │   ├── main.js             # Entry point for pipeline page (index.html)
│   │   ├── create.js           # Entry point for brief builder page
│   │   │
│   │   ├── api/
│   │   │   └── ads.js          # fetch() wrappers for /api/ads endpoints
│   │   │   └── generate.js     # fetch() wrapper for /api/generate
│   │   │
│   │   ├── components/
│   │   │   ├── nav.js          # Shared navigation bar
│   │   │   ├── ad-card.js      # Single ad card for pipeline view
│   │   │   ├── stage-tabs.js   # Pipeline stage filter tabs
│   │   │   ├── filter-bar.js   # Search + funnel stage filter
│   │   │   ├── brief-form.js   # The multi-step brief builder form
│   │   │   └── generated-ad.js # AI-generated ad preview card
│   │   │
│   │   ├── utils/
│   │   │   ├── toast.js        # Toast notification helper
│   │   │   ├── csv.js          # CSV export (all + single)
│   │   │   ├── helpers.js      # esc(), clipboard copy, etc.
│   │   │   └── render.js       # Simple DOM helper: getElementById + innerHTML
│   │   │
│   │   └── data/
│   │       └── constants.js    # STAGES, FORMATS, CHANNELS, TONES, STATUS_MAP, etc.
│   │
│   ├── styles/
│   │   ├── tokens.css          # CSS custom properties (colors, fonts, spacing)
│   │   ├── base.css            # Reset, body, typography
│   │   ├── nav.css             # Nav bar styles
│   │   ├── cards.css           # Ad card styles (shared between pages)
│   │   ├── pipeline.css        # Pipeline-specific styles (stage tabs, filter bar)
│   │   ├── forms.css           # Form styles (tiles, pills, toggles, inputs)
│   │   └── create.css          # Brief builder specific styles
│   │
│   └── index.html              # Pipeline page HTML shell (minimal — JS renders content)
│   └── create.html             # Brief builder HTML shell (minimal — JS renders content)
│
└── dist/                       # Build output (gitignored)
    ├── index.html
    ├── create.html
    ├── assets/
    │   ├── index-[hash].js
    │   ├── index-[hash].css
    │   ├── create-[hash].js
    │   └── create-[hash].css
    └── server.js               # Bundled server for production
```

---

## 6. Backend API Specification

All endpoints are on the same origin. No CORS configuration needed.

### `GET /api/ads`

List all ads, ordered by most recent first.

**Query parameters:**
| Param | Type | Example | Description |
|-------|------|---------|-------------|
| `status` | string | `Waiting for Review` | Filter by pipeline status |
| `funnel_stage` | string | `Awareness` | Filter by funnel stage |
| `search` | string | `fuel savings` | Search concept, core_insight, notes |
| `order` | string | `created_at.desc` | Sort order |

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "created_at": "2026-04-01T01:01:08.492Z",
    "concept": "The Exhale",
    "status": "Waiting for Review",
    "funnel_stage": "Consideration",
    "job": "Reframe",
    "format": "Reel",
    "tone": "Empathetic",
    "production_method": "Live Shoot",
    "visual_style": "Cinematic",
    "core_insight": "...",
    "hypothesis": "...",
    "notes": "...",
    "scenes": [...],
    "meta_copy": {...},
    "metrics": {...},
    "revision_notes": "",
    "primary_text": "..."
  }
]
```

---

### `POST /api/ads`

Create a new ad.

**Request body:**
```json
{
  "concept": "The Confession",
  "status": "Waiting for Review",
  "funnel_stage": "Awareness",
  "job": "Interrupt",
  "format": "Reel",
  "tone": "Deadpan",
  "production_method": "AI-Generated",
  "visual_style": "Cinematic",
  "core_insight": "...",
  "hypothesis": "...",
  "notes": "...",
  "scenes": [...],
  "meta_copy": {...},
  "primary_text": "..."
}
```

**Response:** `201 Created`
```json
{
  "id": "new-uuid",
  "created_at": "2026-05-08T...",
  ...all fields
}
```

---

### `PATCH /api/ads/:id`

Update one or more fields on an existing ad.

**Request body:** (partial — only send what's changing)
```json
{
  "status": "Needs Revision",
  "revision_notes": "The hook doesn't land. Try a bolder opening."
}
```

**Response:** `200 OK`
```json
{
  "id": "uuid",
  ...all updated fields
}
```

---

### `DELETE /api/ads/:id`

Delete an ad.

**Response:** `204 No Content` (empty body)

---

### `POST /api/generate`

Proxy to Anthropic API. Keeps the API key server-side.

**Request body:**
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1500,
  "messages": [
    { "role": "user", "content": "..." }
  ]
}
```

**Response:** `200 OK` — proxied Anthropic response (unchanged)

**Error responses:**
- `401` if `ANTHROPIC_API_KEY` is not set
- `502` if Anthropic returns an error

---

### Static files

| Route | Serves |
|-------|--------|
| `GET /` | Pipeline page (`index.html`) |
| `GET /create` | Brief builder (`create.html`) |
| `GET /assets/*` | Bundled CSS and JS files |

---

## 7. Database Schema

Already applied to Neon. Documented here for reference.

### Table: `ads`

```sql
CREATE TABLE ads (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Creative identity
    concept           TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'Waiting for Review',
    core_insight      TEXT NOT NULL DEFAULT '',
    hypothesis        TEXT NOT NULL DEFAULT '',
    notes             TEXT NOT NULL DEFAULT '',

    -- Funnel & strategy
    funnel_stage      TEXT NOT NULL DEFAULT '',
    job               TEXT NOT NULL DEFAULT '',

    -- Format & style
    format            TEXT NOT NULL DEFAULT '',
    tone              TEXT NOT NULL DEFAULT '',
    production_method TEXT NOT NULL DEFAULT '',
    visual_style      TEXT NOT NULL DEFAULT '',

    -- Structured content (JSONB)
    scenes            JSONB NOT NULL DEFAULT '[]'::jsonb,
    meta_copy         JSONB NOT NULL DEFAULT '{}'::jsonb,
    metrics           JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Revision tracking
    revision_notes    TEXT NOT NULL DEFAULT '',

    -- Denormalized convenience
    primary_text      TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_ads_status     ON ads (status);
CREATE INDEX idx_ads_funnel     ON ads (funnel_stage);
CREATE INDEX idx_ads_created_at ON ads (created_at DESC);
```

### JSONB shapes

**`scenes`** — array of objects:
```json
[
  {
    "id": "ha",
    "label": "Scene 1 — Hook A",
    "timing": "0–2s",
    "vo": "Remember the last time something got easier?",
    "prompt": "Fleet manager pausing mid-day..."
  }
]
```

**`meta_copy`** — flat object:
```json
{
  "primaryText": "...",
  "headline": "...",
  "description": "...",
  "displayUrl": "..."
}
```

**`metrics`** — flat object:
```json
{
  "thumbStop": "",
  "viewRate": "",
  "completionRate": "",
  "ctr": "",
  "cpa": "",
  "notes": ""
}
```

### Status values

The app uses 4 normalized statuses:

| Status | Meaning |
|--------|---------|
| `Waiting for Review` | New ads, not yet reviewed |
| `Needs Revision` | Reviewed, needs changes (revision notes required) |
| `Ready for Production` | Approved, ready to produce |
| `Archived` | Done / no longer active |

The old Supabase data had 7+ statuses (Briefs, Editing, Review / Allocation, In Design, Live, Winner, Archive, etc.). These were all mapped to the 4 new statuses during the seed migration.

---

## 8. Frontend Refactor Plan

### What changes

| Current | Refactored |
|---------|------------|
| Supabase JS SDK loaded from CDN | Removed. Replaced with `fetch()` calls to `/api/ads` |
| All JS inline in `<script>` tags | Separate `.js` modules with `import`/`export` |
| All CSS inline in `<style>` tags | Separate `.css` files imported via Vite |
| Nav bar copy-pasted in every HTML file | Shared `nav.js` component |
| Constants duplicated across files | Single `constants.js` data file |
| Google Fonts loaded from CDN | Still from CDN (fonts are fine from CDN) |
| HTML files are 1200-1400 lines each | HTML shells are ~20 lines. JS renders content. |

### What stays the same

- **Rendering pattern:** Functions returning HTML strings. No React, no virtual DOM, no framework.
- **Visual design:** Same CSS custom properties, same look and feel.
- **Data model:** Same fields, same JSONB shapes.
- **User flow:** Create brief → generate 3 ads → approve to pipeline → manage in kanban.

### Client-side API layer

The Supabase SDK calls get replaced with simple `fetch()` wrappers:

```js
// client/api/ads.js

export async function loadAds(params = {}) {
  const query = new URLSearchParams(params).toString()
  const res = await fetch(`/api/ads${query ? '?' + query : ''}`)
  if (!res.ok) throw new Error(`Failed to load ads: ${res.status}`)
  return res.json()
}

export async function createAd(data) {
  const res = await fetch('/api/ads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  if (!res.ok) throw new Error(`Failed to create ad: ${res.status}`)
  return res.json()
}

export async function updateAd(id, updates) {
  const res = await fetch(`/api/ads/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  })
  if (!res.ok) throw new Error(`Failed to update ad: ${res.status}`)
  return res.json()
}

export async function deleteAd(id) {
  const res = await fetch(`/api/ads/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Failed to delete ad: ${res.status}`)
}
```

Usage in the pipeline page:

```js
// Before (Supabase):
const { data, error } = await sb.from('ads').select('*').order('created_at', { ascending: false })

// After:
const data = await loadAds()
```

### HTML shells

Instead of 1400-line HTML files, each page becomes a minimal shell:

```html
<!-- src/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pipeline — Mudflap Creative</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/client/main.js"></script>
</body>
</html>
```

The JavaScript module handles all rendering into `#app`.

### CSS organization

Split the existing ~400 lines of CSS per page into focused files:

```
styles/
├── tokens.css      # ~30 lines — CSS custom properties
├── base.css        # ~20 lines — reset, body, typography
├── nav.css         # ~40 lines — shared navigation
├── cards.css       # ~80 lines — ad card (shared between pipeline + create)
├── pipeline.css    # ~100 lines — stage tabs, filter bar, pipeline layout
├── forms.css       # ~120 lines — tiles, pills, toggles, inputs, selects
└── create.css      # ~60 lines — brief builder specific (output grid, generating state)
```

Each JS module imports only the CSS it needs:

```js
// client/main.js
import '../styles/tokens.css'
import '../styles/base.css'
import '../styles/nav.css'
import '../styles/cards.css'
import '../styles/pipeline.css'
```

Vite handles bundling and extracting CSS at build time.

---

## 9. Environment Variables

### Required

| Variable | Used by | Description |
|----------|---------|-------------|
| `NEON_POSTGRES_CONNECTION_STRING` | Server (`db.js`) | Full Postgres connection URL for Neon |
| `ANTHROPIC_API_KEY` | Server (`routes/generate.js`) | API key for Claude |

### Local development

Stored in `.env` (gitignored):

```env
NEON_POSTGRES_CONNECTION_STRING=postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require
ANTHROPIC_API_KEY=sk-ant-...
```

A `.env.example` file is committed as a template:

```env
NEON_POSTGRES_CONNECTION_STRING=
ANTHROPIC_API_KEY=
```

### Build/dev access

Vite exposes env vars to client code only if prefixed with `VITE_`. Our env vars are **server-side only** and should never be prefixed with `VITE_`. The client accesses them through the API, not directly.

---

## 10. Deployment — Render

### Provisioning

1. **Create a new Web Service** on [render.com](https://render.com)
2. **Connect to GitHub repo:** `allimagidsohn/mudflap-ad-tracker`
3. **Branch:** `main`

### Configuration

| Setting | Value |
|---------|-------|
| **Runtime** | Node |
| **Build Command** | `pnpm install && pnpm build` |
| **Start Command** | `node dist/server.js` |
| **Plan** | Free (dev) or Starter $7/mo (production, no spin-down) |

### Environment variables on Render

Set in Render dashboard → Environment:

```
NEON_POSTGRES_CONNECTION_STRING=postgresql://neondb_owner:...@ep-xxx.neon.tech/neondb?sslmode=require
ANTHROPIC_API_KEY=sk-ant-...
NODE_ENV=production
```

### Build output

Vite will produce:

```
dist/
├── index.html          # Pipeline page
├── create.html         # Brief builder page
├── assets/
│   ├── index-[hash].js
│   ├── index-[hash].css
│   ├── create-[hash].js
│   └── create-[hash].css
└── server.js           # Bundled Hono server
```

The server serves static files from `dist/` and handles `/api/*` routes.

### Vite build config (conceptual)

```js
// vite.config.js
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: 'src/index.html',
        create: 'src/create.html'
      }
    }
  }
})
```

The server build will be handled separately (likely a second rollup entry or esbuild call for `src/server/index.js`).

---

## 11. Migration Checklist

### ✅ Already done

- [x] Reverse-engineer the app architecture and data model
- [x] Document all services used (Supabase, Anthropic, Vercel)
- [x] Create Neon Postgres database
- [x] Apply `schema.sql` to Neon
- [x] Export 87 rows from Supabase
- [x] Migrate data into Neon with status normalization
- [x] Write `README.md`
- [x] Write `NEXT_STEPS.md` (this file)

### 🔜 To do (in order)

1. **Set up Vite project structure**
   - Initialize `vite.config.js`
   - Create directory structure (`src/server/`, `src/client/`, `src/styles/`)
   - Set up `.gitignore` for `node_modules/`, `dist/`, `.env`

2. **Build the server**
   - Install Hono (`pnpm add hono`)
   - Create `src/server/index.js` — Hono app with static file serving
   - Create `src/server/db.js` — Neon connection pool using `pg`
   - Create `src/server/routes/ads.js` — CRUD endpoints
   - Create `src/server/routes/generate.js` — Anthropic proxy (port from `api/generate.js`)

3. **Refactor the pipeline page** (`index.html` → `src/client/main.js`)
   - Extract constants → `src/client/data/constants.js`
   - Extract helpers → `src/client/utils/helpers.js`
   - Extract toast → `src/client/utils/toast.js`
   - Extract CSV export → `src/client/utils/csv.js`
   - Extract nav → `src/client/components/nav.js`
   - Extract ad card → `src/client/components/ad-card.js`
   - Extract stage tabs → `src/client/components/stage-tabs.js`
   - Extract filter bar → `src/client/components/filter-bar.js`
   - Replace Supabase calls with `fetch('/api/ads')` calls
   - Split CSS → `src/styles/`

4. **Refactor the brief builder** (`create.html` → `src/client/create.js`)
   - Extract brief form → `src/client/components/brief-form.js`
   - Extract generated ad card → `src/client/components/generated-ad.js`
   - Replace Supabase calls with `fetch('/api/ads')` calls
   - Split CSS → `src/styles/`

5. **Create HTML shells**
   - `src/index.html` — minimal shell for pipeline page
   - `src/create.html` — minimal shell for brief builder

6. **Build and deploy**
   - Test locally with `pnpm dev`
   - Verify all CRUD operations work against Neon
   - Verify AI generation works through server proxy
   - Push to GitHub
   - Set up Render Web Service
   - Configure environment variables on Render
   - Deploy

7. **Cleanup**
   - Delete stale files (`tracker-old.html`, `generate.html`, `api/generate.js`)
   - Delete `seed.js` (one-time migration, no longer needed)
   - Remove Vercel deployment (deactivate or delete project)
   - Decommission Supabase project (after confirming everything works)

---

## 12. Files to Delete

After the refactor is complete and deployed:

| File | Reason |
|------|--------|
| `tracker-old.html` | Deprecated. Replaced by `index.html` pipeline view. |
| `generate.html` | Stale version of `create.html`. |
| `api/generate.js` | Vercel serverless function. Replaced by Hono route. |
| `api/` (directory) | Empty after removing `generate.js`. |
| `seed.js` | One-time migration script. Already ran. |
| `supabase_export.json` | Export artifact from migration. |

---

## 13. Future Considerations

These are **not** in scope for the initial refactor, but worth keeping in mind:

### Authentication

Right now, anyone with the URL can read and write all ads. The most practical near-term fix would be simple password protection middleware on the Hono server — a single shared password stored as an env var, checked via a session cookie. No user accounts needed for a small internal team.

Later, if needed, this could evolve to individual accounts with something like Lucia Auth or a simple JWT setup.

### Performance metrics

The pipeline page currently loads **all** ads at once. With 87 rows that's fine. At 500+ it might start feeling slow. The `/api/ads` endpoint should support pagination (`?limit=50&offset=0`) when that becomes relevant.

### Real-time updates

Supabase has realtime subscriptions. Neon does not (out of the box). If the team ever needs live-updating when multiple people are editing simultaneously, options include:
- Polling (simple, works fine for low-frequency updates)
- Neon's WebSocket support with `@neondatabase/serverless`
- A lightweight WebSocket layer on the server

For now, a page refresh is perfectly fine.

### API key for Anthropic

The current code sends `model` and `max_tokens` from the client. The server proxy should probably set these server-side instead, so the client can't change the model or request excessive tokens.

### Input validation

The current code has no server-side input validation. The Hono routes should validate request bodies before writing to the database — at minimum, check that required fields exist and strings aren't absurdly long.

### Backup

Neon free tier includes point-in-time recovery. But it's worth setting up a daily `pg_dump` to S3 or similar as a safety net, especially once the team is actively using this in production.
