-- Nesio cloud Signals v1
-- Apply manually in Supabase SQL editor before treating Signal as the primary data atom.
-- Signals are append/upsert facts. Memory, Today, DEC, and search should read
-- from this table or its local-first projection instead of connector raw data.

CREATE TABLE IF NOT EXISTS public.signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_key text NOT NULL,
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  signal_id text NOT NULL,
  schema_version text NOT NULL DEFAULT 'Signal@v1',
  source text NOT NULL,
  type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  title text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  entities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(entities) = 'array'),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  confidence numeric NOT NULL DEFAULT 0.6 CHECK (confidence >= 0 AND confidence <= 1),
  sensitivity text NOT NULL DEFAULT 'normal',
  retention_policy text NOT NULL DEFAULT 'Normal',
  embedding_text text,
  feedback jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(feedback) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (identity_key, signal_id)
);

CREATE INDEX IF NOT EXISTS idx_signals_identity_captured
  ON public.signals (identity_key, captured_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_signals_user_captured
  ON public.signals (user_id, captured_at DESC)
  WHERE user_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_signals_identity_source_type
  ON public.signals (identity_key, source, type, occurred_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signals_select_own"
  ON public.signals
  FOR SELECT
  TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "signals_insert_own"
  ON public.signals
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "signals_update_own"
  ON public.signals
  FOR UPDATE
  TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);
