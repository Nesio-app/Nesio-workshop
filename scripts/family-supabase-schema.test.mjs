/**
 * 契约:家庭分享 Supabase schema(database/schema/supabase-family-v1.sql)。
 * 钉死 M2 地基 —— 五张表、成员判定函数、membership RLS、状态/金额 CHECK、永不碰钱不变式。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const schemaPath = path.join(root, 'database', 'schema', 'supabase-family-v1.sql');
assert.ok(fs.existsSync(schemaPath), 'family schema migration must exist.');
const schema = fs.readFileSync(schemaPath, 'utf8');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const marker of [
  // 五张表
  'CREATE TABLE IF NOT EXISTS public.families',
  'CREATE TABLE IF NOT EXISTS public.family_members',
  'CREATE TABLE IF NOT EXISTS public.family_chore_templates',
  'CREATE TABLE IF NOT EXISTS public.family_chore_instances',
  'CREATE TABLE IF NOT EXISTS public.family_payouts',
  // 认证挂钩 + 邀请码
  'user_id uuid NOT NULL REFERENCES auth.users',
  'invite_code text NOT NULL UNIQUE',
  // 每人权限 bool(非硬编码枚举)
  'can_approve boolean NOT NULL DEFAULT false',
  'needs_approval boolean NOT NULL DEFAULT true',
  'can_record_payout boolean NOT NULL DEFAULT false',
  // 成员判定 SECURITY DEFINER(防 RLS 递归)
  'CREATE OR REPLACE FUNCTION public.is_family_member',
  'SECURITY DEFINER',
  // 全表启用 RLS
  'ALTER TABLE public.families ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE public.family_chore_templates ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE public.family_chore_instances ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE public.family_payouts ENABLE ROW LEVEL SECURITY',
  // membership RLS
  'public.is_family_member(family_id, auth.uid())',
  // 幂等 upsert 键
  'UNIQUE (family_id, template_id, due_date)',
  // 闭环「日历家务 → 分派给家人」:补列 + 一事件一实例去重键(可改派)
  'ADD COLUMN IF NOT EXISTS source_event_id text',
  'uniq_family_chore_source_event',
  // 成员身份自成一套:邮箱(早期 People 配对,已解耦保留)+ 头像(来自成员自己的账号资料)
  'ADD COLUMN IF NOT EXISTS email text',
  'ADD COLUMN IF NOT EXISTS avatar_url text',
]) {
  assert.match(schema, new RegExp(esc(marker)), `family schema missing marker: ${marker}`);
}

// 状态机取值被 CHECK 钉死
assert.match(schema, /state text NOT NULL DEFAULT 'todo' CHECK \(state IN \('todo','done','approved','paid'\)\)/,
  'chore state must be constrained to the 4-state machine.');

// 永不碰钱不变式:payout 只是记账,金额恒正(不是转账、无负数冲销把戏)
assert.match(schema, /amount numeric NOT NULL CHECK \(amount > 0\)/, 'payout amount must be > 0 (record-only, never a transfer).');

// cadence 约束为 JSON object
assert.match(schema, /CHECK\s*\(\s*jsonb_typeof\(cadence\)\s*=\s*'object'\s*\)/, 'cadence must be a JSON object.');

console.log('family-supabase-schema: OK');
