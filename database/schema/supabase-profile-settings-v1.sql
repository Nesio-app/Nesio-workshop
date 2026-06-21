-- Nesio cloud profile settings v1
-- Apply manually in Supabase SQL editor before enabling CLOUD_DB_ENABLED=true.
-- This schema supports app/api/cloud/profile-settings/route.ts.

CREATE TABLE IF NOT EXISTS public.profile_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_settings_updated_at
  ON public.profile_settings (updated_at DESC);

ALTER TABLE public.profile_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_settings_select_own"
  ON public.profile_settings
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "profile_settings_insert_own"
  ON public.profile_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "profile_settings_update_own"
  ON public.profile_settings
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

