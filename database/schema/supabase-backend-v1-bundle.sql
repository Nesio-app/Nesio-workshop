-- Nesio Supabase Backend v1 Bundle
-- Generated at 2026-07-14T22:20:47.058Z
-- Apply manually in Supabase SQL Editor after CEO-approved production data operation window.
-- This file contains schema only. It does not contain secrets. It creates the private Storage bucket contract.

BEGIN;

-- ============================================================================
-- Source: database/schema/supabase-user-profiles-v1.sql
-- ============================================================================
-- Nesio cloud user profiles v1
-- Apply manually in Supabase SQL editor before enabling CLOUD_DB_ENABLED=true.
-- This schema supports app/api/cloud/account/route.ts.
-- user_profiles is the product-level account profile that mirrors Supabase Auth safely.

CREATE TABLE IF NOT EXISTS public.user_profiles (
  identity_key text PRIMARY KEY,
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  email text,
  phone text,
  provider text,
  providers text[] NOT NULL DEFAULT '{}'::text[],
  display_name text,
  avatar_url text,
  onboarding_completed boolean NOT NULL DEFAULT false,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(profile) = 'object'),
  last_seen_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_updated
  ON public.user_profiles (user_id, updated_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_email
  ON public.user_profiles (email)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_last_seen_at
  ON public.user_profiles (last_seen_at DESC);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_profiles_select_own"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "user_profiles_insert_own"
  ON public.user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "user_profiles_update_own"
  ON public.user_profiles
  FOR UPDATE
  TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

-- ── Access control(权限管理,2026-07-04)─────────────────────────────────
-- 服务器权威的用户访问角色:管理员在 /admin 设置,用户登录后经
-- /api/portal/access 领取。access_role: public / tester / personal_lab;
-- feature_flags: 模块布尔开关(true = 进该用户 testerAllowlist)。

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS access_role text NOT NULL DEFAULT 'public';

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── Integration tokens(Notion 修,2026-07-07)──────────────────────────
-- 每用户的 OAuth 集成 token(gmail/calendar/notion),跨设备/跨浏览器上下文。
-- lib/portal/integrations.ts 一直在读写这个列,但列此前从未建过 ——
-- 写入 400 被静默吞掉,是"跨设备 token 层从来没生效"的根因。

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS integrations jsonb;

-- ============================================================================
-- Source: database/schema/supabase-profile-settings-v1.sql
-- ============================================================================
-- Nesio cloud profile settings v1
-- Apply manually in Supabase SQL editor before enabling CLOUD_DB_ENABLED=true.
-- This schema supports app/api/cloud/profile-settings/route.ts.
-- identity_key supports Supabase auth users and linked third-party auth identities.

CREATE TABLE IF NOT EXISTS public.profile_settings (
  identity_key text PRIMARY KEY,
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_settings_updated_at
  ON public.profile_settings (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_profile_settings_user_updated
  ON public.profile_settings (user_id, updated_at DESC)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.profile_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_settings_select_own"
  ON public.profile_settings
  FOR SELECT
  TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "profile_settings_insert_own"
  ON public.profile_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "profile_settings_update_own"
  ON public.profile_settings
  FOR UPDATE
  TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

-- ============================================================================
-- Source: database/schema/supabase-memory-v1.sql
-- ============================================================================
-- Nesio cloud memory v1
-- Apply manually in Supabase SQL editor before enabling cloud Memory sync.
-- This schema supports app/api/cloud/memory/route.ts.
-- identity_key supports Supabase auth users and linked third-party identities.

CREATE TABLE IF NOT EXISTS public.memory_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_key text NOT NULL,
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  local_id text NOT NULL,
  schema_version text NOT NULL DEFAULT 'LifeNode@v1',
  node jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(node) = 'object'),
  source text NOT NULL DEFAULT 'manual',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (identity_key, local_id)
);

CREATE TABLE IF NOT EXISTS public.memory_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_key text NOT NULL,
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  source_node_local_id text,
  target_node_local_id text,
  relation text NOT NULL DEFAULT 'related',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.memory_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_key text NOT NULL,
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  local_id text NOT NULL,
  node_local_id text,
  asset jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(asset) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (identity_key, local_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_identity_updated
  ON public.memory_nodes (identity_key, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_memory_nodes_user_updated
  ON public.memory_nodes (user_id, updated_at DESC)
  WHERE user_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_memory_edges_identity_updated
  ON public.memory_edges (identity_key, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_memory_assets_identity_updated
  ON public.memory_assets (identity_key, updated_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.memory_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "memory_nodes_select_own"
  ON public.memory_nodes
  FOR SELECT
  TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "memory_nodes_insert_own"
  ON public.memory_nodes
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "memory_nodes_update_own"
  ON public.memory_nodes
  FOR UPDATE
  TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "memory_edges_select_own"
  ON public.memory_edges
  FOR SELECT
  TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "memory_edges_insert_own"
  ON public.memory_edges
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "memory_edges_update_own"
  ON public.memory_edges
  FOR UPDATE
  TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "memory_assets_select_own"
  ON public.memory_assets
  FOR SELECT
  TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "memory_assets_insert_own"
  ON public.memory_assets
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "memory_assets_update_own"
  ON public.memory_assets
  FOR UPDATE
  TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

-- ============================================================================
-- Source: database/schema/supabase-signals-v1.sql
-- ============================================================================
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

-- ============================================================================
-- Source: database/schema/supabase-storage-v1.sql
-- ============================================================================
-- Nesio Supabase Storage v1
-- Private product assets for avatars, Memory photos, audio, PDFs, and attachments.
-- Apply only after CEO-approved production data operation window.

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'nesio-product-assets',
  'nesio-product-assets',
  false,
  8388608,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'audio/mpeg',
    'audio/mp4',
    'audio/webm',
    'audio/wav',
    'application/pdf',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "nesio_assets_select_own_prefix" ON storage.objects;
CREATE POLICY "nesio_assets_select_own_prefix"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'nesio-product-assets'
  AND (storage.foldername(name))[1] = replace('supabase:' || auth.uid()::text, ':', '-')
);

DROP POLICY IF EXISTS "nesio_assets_insert_own_prefix" ON storage.objects;
CREATE POLICY "nesio_assets_insert_own_prefix"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'nesio-product-assets'
  AND (storage.foldername(name))[1] = replace('supabase:' || auth.uid()::text, ':', '-')
);

DROP POLICY IF EXISTS "nesio_assets_update_own_prefix" ON storage.objects;
CREATE POLICY "nesio_assets_update_own_prefix"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'nesio-product-assets'
  AND (storage.foldername(name))[1] = replace('supabase:' || auth.uid()::text, ':', '-')
)
WITH CHECK (
  bucket_id = 'nesio-product-assets'
  AND (storage.foldername(name))[1] = replace('supabase:' || auth.uid()::text, ':', '-')
);

DROP POLICY IF EXISTS "nesio_assets_delete_own_prefix" ON storage.objects;
CREATE POLICY "nesio_assets_delete_own_prefix"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'nesio-product-assets'
  AND (storage.foldername(name))[1] = replace('supabase:' || auth.uid()::text, ':', '-')
);

-- ============================================================================
-- Source: database/schema/supabase-product-events-v1.sql
-- ============================================================================
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

-- ============================================================================
-- Source: database/schema/supabase-telemetry-events-v1.sql
-- ============================================================================
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

-- ============================================================================
-- Source: database/schema/supabase-feature-votes-v1.sql
-- ============================================================================
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

COMMIT;
