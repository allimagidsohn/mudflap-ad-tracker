-- Mudflap Ad Tracker Schema
-- Target: Neon Postgres

CREATE TABLE IF NOT EXISTS ads (
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

-- Indexes for the queries the app actually makes
CREATE INDEX IF NOT EXISTS idx_ads_status     ON ads (status);
CREATE INDEX IF NOT EXISTS idx_ads_funnel     ON ads (funnel_stage);
CREATE INDEX IF NOT EXISTS idx_ads_created_at ON ads (created_at DESC);
