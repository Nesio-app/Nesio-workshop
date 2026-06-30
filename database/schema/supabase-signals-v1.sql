-- Nesio cloud Signals v1
-- Apply manually in Supabase SQL editor before treating Signal as the primary data atom.
-- Signals are append/upsert facts. Memory, Today, DEC, and search should read
-- from this table or its local-first projection instead of connector raw data.

CREATE EXTENSION IF NOT EXISTS vector;

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
  embedding_model text,
  embedding_vector vector(768),
  embedding_updated_at timestamptz,
  feedback jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(feedback) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (identity_key, signal_id)
);

-- Existing projects may already have an earlier public.signals table. CREATE
-- TABLE IF NOT EXISTS will not add new columns, so keep this migration
-- idempotent for both fresh and partially-created installs.
ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS schema_version text NOT NULL DEFAULT 'Signal@v1',
  ADD COLUMN IF NOT EXISTS embedding_text text,
  ADD COLUMN IF NOT EXISTS embedding_model text,
  ADD COLUMN IF NOT EXISTS embedding_vector vector(768),
  ADD COLUMN IF NOT EXISTS embedding_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS feedback jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_signals_identity_captured
  ON public.signals (identity_key, captured_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_signals_user_captured
  ON public.signals (user_id, captured_at DESC)
  WHERE user_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_signals_identity_source_type
  ON public.signals (identity_key, source, type, occurred_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_signals_embedding_vector
  ON public.signals USING hnsw (embedding_vector vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_signals_feedback_gin
  ON public.signals USING gin (feedback);

ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "signals_select_own" ON public.signals;
DROP POLICY IF EXISTS "signals_insert_own" ON public.signals;
DROP POLICY IF EXISTS "signals_update_own" ON public.signals;

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

CREATE OR REPLACE FUNCTION public.match_own_signals(
  match_identity_key text,
  query_embedding vector(768),
  match_count integer DEFAULT 8
)
RETURNS TABLE (
  signal_id text,
  source text,
  type text,
  occurred_at timestamptz,
  captured_at timestamptz,
  title text,
  payload jsonb,
  entities jsonb,
  evidence jsonb,
  confidence numeric,
  sensitivity text,
  retention_policy text,
  embedding_text text,
  embedding_model text,
  embedding_updated_at timestamptz,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    s.signal_id,
    s.source,
    s.type,
    s.occurred_at,
    s.captured_at,
    s.title,
    s.payload,
    s.entities,
    s.evidence,
    s.confidence,
    s.sensitivity,
    s.retention_policy,
    s.embedding_text,
    s.embedding_model,
    s.embedding_updated_at,
    1 - (s.embedding_vector <=> query_embedding) AS similarity
  FROM public.signals s
  WHERE s.identity_key = match_identity_key
    AND (auth.role() = 'service_role' OR (s.user_id IS NOT NULL AND auth.uid() = s.user_id))
    AND s.deleted_at IS NULL
    AND s.embedding_vector IS NOT NULL
  ORDER BY s.embedding_vector <=> query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 50);
$$;

GRANT EXECUTE ON FUNCTION public.match_own_signals(text, vector, integer) TO authenticated, service_role;
