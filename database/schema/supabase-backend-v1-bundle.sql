-- Nesio Supabase Backend v1 Bundle
-- Generated at 2026-06-29T16:11:35.405Z
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
-- Source: database/schema/supabase-inventory-items-v1.sql
-- ============================================================================
-- Nesio cloud inventory items v1
-- Apply manually in Supabase SQL editor before enabling CLOUD_DB_ENABLED=true.
-- This schema supports app/api/cloud/inventory/route.ts.
-- identity_key supports Supabase auth users and linked third-party auth identities.

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_key text NOT NULL,
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  local_id text NOT NULL,
  schema_version text NOT NULL DEFAULT 'LocalInventoryItem@v1',
  item jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(item) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (identity_key, local_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_identity_updated
  ON public.inventory_items (identity_key, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_items_user_updated
  ON public.inventory_items (user_id, updated_at DESC)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_items_select_own"
  ON public.inventory_items
  FOR SELECT
  TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "inventory_items_insert_own"
  ON public.inventory_items
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "inventory_items_update_own"
  ON public.inventory_items
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

COMMIT;
