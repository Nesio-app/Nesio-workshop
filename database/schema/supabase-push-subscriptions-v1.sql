-- Web Push 订阅表(Guidance 全 AI 化 Step 6,2026-07-29)。
-- 每行一个浏览器端点;identity_key 与 user_module_data 同口径(按已鉴权身份隔离)。
-- 需在 Supabase 手动 apply(与 user_module_data 同批部署侧动作)。
create table if not exists user_push_subscriptions (
  identity_key text not null,
  endpoint text not null,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  primary key (identity_key, endpoint)
);

alter table user_push_subscriptions enable row level security;
-- 仅 service_role 读写(路由端已按身份鉴权;客户端不直连本表)。
create policy push_subs_service_only on user_push_subscriptions
  for all using (false) with check (false);
