# Mudflap Ad Creative Tracker

A lightweight web app for managing Mudflap's paid social ad creative pipeline — from AI-generated briefs through review, revision, and production. Built as a set of static HTML pages with a single serverless API proxy.

> **Note:** This project was assembled quickly and has no build tooling, no package manager, and no `.env` file. Secrets are hardcoded in client-side HTML (see [Security Notes](#security-notes)).

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Static HTML Pages (client-side only)                   │
│                                                         │
│  create.html  ──► Brief builder + AI ad generation      │
│  index.html   ──► Pipeline board (kanban-style tracker) │
│  generate.html ──► (earlier/alt version of create.html) │
│  tracker-old.html ──► Original tracker (deprecated)     │
│                                                         │
│  api/generate.js ──► Serverless proxy to Anthropic API  │
└──────────────────┬──────────────────────────────────────┘
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
   Supabase   Anthropic   Vercel
   (database) (AI/LLM)   (hosting)
```

## Services Used

### 1. Supabase — Database & Backend
- **Purpose:** Primary data store for all ad creatives
- **Table:** `ads` — stores concept, status, funnel stage, scenes (JSONB), meta copy (JSONB), metrics, revision notes, etc.
- **Auth:** Anonymous key (anon role, no auth required)
- **Project URL:** `https://fngxmhqkowrkzpgcofbn.supabase.co`
- **SDK:** `@supabase/supabase-js@2` (loaded via CDN)

### 2. Anthropic (Claude) — AI Ad Generation
- **Purpose:** Generates 3 ad concepts at a time based on a creative brief
- **Model:** `claude-sonnet-4-20250514`
- **Proxy:** `api/generate.js` — a serverless function that proxies requests to `https://api.anthropic.com/v1/messages`
- **Auth:** Requires `ANTHROPIC_API_KEY` environment variable on the serverless host

### 3. Vercel — Hosting & Serverless Functions
- **Purpose:** Serves static HTML files and runs the `api/generate.js` serverless function
- **Evidence:** `api/` directory structure follows Vercel's serverless function convention (`export default async function handler(req, res)`)
- **Repo:** `https://github.com/allimagidsohn/mudflap-ad-tracker.git`

### 4. CDN Dependencies (loaded in browser)
- **Supabase JS SDK** — `cdn.jsdelivr.net/npm/@supabase/supabase-js@2`
- **Google Fonts** — Bebas Neue + DM Sans

---

## Pages

| File | Purpose | Status |
|------|---------|--------|
| `create.html` | **Brief builder.** Multi-step form to define channel, funnel stage, job-to-be-done, tone, visual style, etc. Sends brief to Claude via the API proxy, gets back 3 ad concepts. Edit inline, then approve to pipeline or retire. | ✅ Active |
| `index.html` | **Pipeline board.** Kanban-style tracker with stages: Waiting for Review → Needs Revision → Ready for Production → Archived. Inline editing, search/filter, revision notes, CSV export. | ✅ Active |
| `generate.html` | Earlier/alternate version of the brief builder with a different UI flow. | ⚠️ Possibly stale |
| `tracker-old.html` | Original tracker with a different status model (Briefs → In Copy Production → In Design → Live → Winner → Archive). More complex form modal. | ❌ Deprecated |

---

## Data Model (`ads` table in Supabase)

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `concept` | text | Ad concept title |
| `status` | text | Pipeline stage (Waiting for Review / Needs Revision / Ready for Production / Archived) |
| `funnel_stage` | text | Awareness / Consideration / Intent / Retargeting / Usage-Expansion |
| `job` | text | Job to be done (Interrupt / Reframe / Prove / Convert / Reinforce) |
| `format` | text | Channel format (Reel, Carousel, Static, Video, Bumper, etc.) |
| `tone` | text | Creative tone |
| `production_method` | text | AI-Generated / Live Shoot / Motion Design / Stock / Mixed / Influencer |
| `visual_style` | text | Cinematic / Handheld / Talking Head / Typography-Led / etc. |
| `core_insight` | text | The core creative insight driving the ad |
| `hypothesis` | text | Why this concept should work |
| `notes` | text | Freeform context notes |
| `scenes` | JSONB | Array of scene objects (`{id, label, timing, vo, prompt}`) |
| `meta_copy` | JSONB | `{primaryText, headline, description, displayUrl}` |
| `metrics` | JSONB | `{thumbStop, viewRate, completionRate, ctr, cpa, notes}` |
| `revision_notes` | text | Notes when ad is in "Needs Revision" state |
| `primary_text` | text | Denormalized primary text for convenience |
| `created_at` | timestamptz | Auto-generated |

---

## Local Development

Since there's no build step, you can serve the files locally:

```bash
# Simple static server (if you have python)
python3 -m http.server 8000

# Or with Node (npx)
npx serve .

# Note: The API proxy (/api/generate) only works when deployed to Vercel
# For local testing of AI generation, you'd need to set up a local proxy
```

**For the serverless API function**, you need:
- `ANTHROPIC_API_KEY` set as an environment variable
- A Vercel-like runtime (or just deploy to Vercel)

---

## Deployment (Vercel)

```bash
# Install Vercel CLI if needed
npm i -g vercel

# Deploy
vercel

# Set the Anthropic API key
vercel env add ANTHROPIC_API_KEY
```

The project root is the deploy root — Vercel will auto-detect the `api/` directory as serverless functions.

---

## Security Notes ⚠️

This project has several security concerns inherited from its rapid AI-assisted creation:

1. **Supabase anon key is hardcoded in client-side HTML** — This is the public anon key, so it's by design in Supabase's model, but there's **no Row Level Security (RLS) or authentication**. Anyone with the key can read/write all data.
2. **No `.env` file** — Environment variables are expected to be set on the hosting platform only.
3. **No input validation or sanitization** on the client or server side.
4. **No CORS restrictions** on the API proxy.
5. **`tracker-old.html`** contains the same Supabase credentials and is still in the repo.

**Recommendations:**
- Enable RLS policies on the `ads` table in Supabase
- Add authentication (even simple password protection)
- Move the Supabase URL/key to environment variables
- Remove or archive `tracker-old.html` and `generate.html` if no longer needed

---

## Channels Supported

The brief builder in `create.html` supports generating ads for:
- **Meta** (Facebook & Instagram Reels)
- **TikTok** (In-Feed Video)
- **YouTube In-Stream** (Skippable, 15–30s)
- **YouTube Bumper** (6s non-skippable)
- **LinkedIn** (Video/Image)
