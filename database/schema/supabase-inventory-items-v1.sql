-- Nesio cloud inventory items v1
-- Apply manually in Supabase SQL editor before enabling CLOUD_DB_ENABLED=true.
-- This schema supports app/api/cloud/inventory/route.ts.

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  local_id text NOT NULL,
  schema_version text NOT NULL DEFAULT 'LocalInventoryItem@v1',
  item jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(item) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (user_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_user_updated
  ON public.inventory_items (user_id, updated_at DESC);

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_items_select_own"
  ON public.inventory_items
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "inventory_items_insert_own"
  ON public.inventory_items
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "inventory_items_update_own"
  ON public.inventory_items
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
