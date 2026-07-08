-- 分析师 Agent 的两张表(在 Supabase SQL Editor 执行)。
-- 不建也能跑:分析师会退回冷启动固定阈值,只是学不了历史/反馈。

-- 每日指标快照 —— 基线学习的历史序列(学「这个 app 自己的正常水位」)。
create table if not exists analyst_daily (
  date        text primary key,          -- YYYY-MM-DD,一天一行,upsert 合并
  signals     jsonb not null,            -- extractSignals() 的扁平数值记录
  created_at  timestamptz not null default now()
);

-- 用户对预警的反馈 —— 反馈学习(静音老被忽略的类型、把在乎的排前面)。
create table if not exists analyst_feedback (
  id          bigint generated always as identity primary key,
  alert_type  text not null,             -- 预警的稳定 type(activity_drop / ai_okrate / gov_drift …)
  reaction    text not null check (reaction in ('useful','dismiss','wrong')),
  report_date text,                       -- 该预警所属日报日期
  created_at  timestamptz not null default now()
);

create index if not exists analyst_feedback_type_idx on analyst_feedback (alert_type, created_at desc);

-- ⚠️ 安全(必须):启用 RLS。这两张表只由服务端(SUPABASE_SERVICE_ROLE_KEY,绕过 RLS)读写;
-- 而 NEXT_PUBLIC_SUPABASE_ANON_KEY 是公开的,任何人都能拿它直连 /rest/v1。
-- 不启用 RLS = anon 可任意读写这两张表(读产品指标、污染学习基线)。
-- 启用 RLS 且不建 anon 策略 = 默认拒绝 anon,service role 照常工作。
alter table analyst_daily    enable row level security;
alter table analyst_feedback enable row level security;
-- (刻意不为 anon/authenticated 建 policy → 客户端直连一律拒绝;仅服务端 service role 可访问。)
