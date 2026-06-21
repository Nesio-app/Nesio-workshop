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
