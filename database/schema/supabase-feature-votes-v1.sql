-- Nesio Backend v1 — feature_votes(Roadmap 功能评分,2026-07-04)
-- This schema supports app/api/portal/feature-vote/route.ts.
-- Users rate backlog features 1-5; one vote per (feature, device),
-- re-voting overwrites. Feature id whitelist lives in lib/portal/roadmap.ts.
-- RLS enabled with NO policies — service role only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.feature_votes (
  feature_id text NOT NULL,
  device_id text NOT NULL,
  score int NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (feature_id, device_id)
);

ALTER TABLE public.feature_votes ENABLE ROW LEVEL SECURITY;

COMMIT;
