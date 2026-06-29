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
