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
