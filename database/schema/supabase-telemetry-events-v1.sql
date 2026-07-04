-- Nesio Backend v1 — telemetry_events(匿名设备级计数,2026-07-04)
-- This schema supports app/api/telemetry/route.ts (writes),
-- lib/portal/ai-telemetry.ts (server ai_route writes) and
-- app/api/admin/metrics/route.ts (aggregated reads).
-- Anonymous product telemetry: event name + coarse props + per-device id.
-- Never content. RLS enabled with NO policies — service role only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.telemetry_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  props jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(props) = 'object'),
  device_id text NOT NULL DEFAULT 'unknown',
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_name_at
  ON public.telemetry_events (name, at DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_at
  ON public.telemetry_events (at DESC);

ALTER TABLE public.telemetry_events ENABLE ROW LEVEL SECURITY;

COMMIT;
