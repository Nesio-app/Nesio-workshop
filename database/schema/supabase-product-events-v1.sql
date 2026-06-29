-- Nesio cloud product events v1
-- Apply manually in Supabase SQL editor before enabling CLOUD_DB_ENABLED=true.
-- This schema supports app/api/cloud/events/route.ts.
-- Product events store user-confirmed feedback and UI interactions, not raw private content.

CREATE TABLE IF NOT EXISTS public.product_events (
  event_id text PRIMARY KEY,
  identity_key text NOT NULL,
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  source text NOT NULL,
  target_type text,
  target_id text,
  feedback text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_events_user_created
  ON public.product_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_events_identity_created
  ON public.product_events (identity_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_events_type_created
  ON public.product_events (event_type, created_at DESC);

ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_events_select_own"
  ON public.product_events
  FOR SELECT
  TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "product_events_insert_own"
  ON public.product_events
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);
