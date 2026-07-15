-- Nesio 服务端权益真源表 —— 上线收费基建 A(批次195)
--
-- 定位:server-entitlement.ts 的「真源」。readServerTier 读本表的 plan 列判定 pro/free。
-- 客户端改不动(RLS:本人只读、service_role 才可写);StoreKit/支付回调服务端校验收据后写入。
--
-- 默认休眠:不建表 / 不设 env 则骨架 inert(fail-open 放行,线上体验一字不变)。
--
-- ── 启用步骤(部署侧,与 server-entitlement.ts 头注一致)────────────────────────
-- 1) 执行本 SQL 建表 + RLS。
-- 2) 支付回调(StoreKit App Store Server API 验签)成功后:
--      service_role upsert user_entitlements(user_id, plan='pro', expires_at)。
--    续订/退款/过期走 App Store Server Notifications v2 → 更新 plan/expires_at。
-- 3) 设环境变量:NESIO_SERVER_ENTITLEMENT=1、NESIO_ENTITLEMENT_TABLE=user_entitlements。
--    —— 此后免费用户打付费云 AI 路由 → 402;无需改任何应用代码。
--
-- 试用(批次195 D 骨架):首次登录若无行 → 插 trial_started_at=now();
--   readServerTier 之上可按账号级 trial 窗判 pro(设备级 localStorage 仅离线兜底,防重装重置)。

CREATE TABLE IF NOT EXISTS public.user_entitlements (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free',                -- 'free' | 'pro' | 'premium'
  trial_started_at timestamptz,                     -- 账号级试用起点(迁自设备级 localStorage)
  expires_at timestamptz,                           -- 订阅到期(续订回调刷新);null=不过期/非订阅
  source text,                                       -- 'storekit' | 'stripe' | 'grant' 等,溯源用
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;

-- 本人只读(客户端拿不到写权 —— 权益只能服务端 service_role 写,防篡改)。
CREATE POLICY "user_entitlements_select_own"
  ON public.user_entitlements FOR SELECT
  USING (auth.uid() = user_id);
