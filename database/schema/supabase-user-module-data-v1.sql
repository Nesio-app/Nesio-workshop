-- Nesio cloud per-module data sync v1
-- Apply manually in Supabase SQL editor before relying on record-level module sync.
-- Supports app/api/cloud/module-data/route.ts.
--
-- 为什么要这张表(根因):健康/足迹/财务/物品 等本机大数据此前只能靠「整包备份」上云
-- (一个大文件、全有或全无、受 8MB/4.5MB 上限、压缩兼容/遮盖/刷新一堆坑)。改为**每个模块一行**
-- 的记录级同步(和 profile_settings / signals 同款:identity_key 键、upsert、updated_at 定胜负),
-- 换端登录逐模块自动拉回,不再需要备份/恢复按钮 —— 对齐「Google Contacts 式」跨端同步。
--
-- data 由客户端存 gz-base64(fflate 压缩)后的模块 JSON,故单模块即便原始几 MB,行体也很小,
-- 穿过 /api/cloud/module-data 函数不触 Vercel 4.5MB 请求体上限。服务端把 data 当不透明块存取。

CREATE TABLE IF NOT EXISTS public.user_module_data (
  identity_key text NOT NULL,
  module_key text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  PRIMARY KEY (identity_key, module_key)
);

CREATE INDEX IF NOT EXISTS idx_user_module_data_identity
  ON public.user_module_data (identity_key, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_module_data_user_updated
  ON public.user_module_data (user_id, updated_at DESC)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.user_module_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_module_data_select_own"
  ON public.user_module_data
  FOR SELECT
  TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "user_module_data_insert_own"
  ON public.user_module_data
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "user_module_data_update_own"
  ON public.user_module_data
  FOR UPDATE
  TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);
