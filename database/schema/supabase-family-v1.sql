-- Nesio 家庭分享 v1 —— 家务 + 零花钱账本(workshop 域实验,信任模型 A:服务端授权)。
-- 在 Supabase SQL Editor 手动应用。幂等:CREATE ... IF NOT EXISTS + ADD COLUMN IF NOT EXISTS
-- + DROP POLICY IF EXISTS 后重建,反复应用安全。
--
-- 信任模型 A:每个家庭成员(含孩子)用自己的账号登录(Google/Gmail 等)。数据按 family_id
-- 共享给该家庭全体成员;**永不碰钱**——family_payouts 只是"线下现金已给"的记账,不是转账。
-- 细粒度能力(谁能审核/记付款)在服务端路由用 lib/family/chores-core 强制;这里 RLS 是纵深
-- 防御:同一家庭的成员可读写家庭数据,非成员一行都拿不到。

-- ── 成员判定(SECURITY DEFINER,避免 family_members 自引用导致 RLS 递归)──────────────
-- 用 plpgsql 而非 sql:sql 函数体在**创建时**就校验引用的表是否存在,而 family_members
-- 在本函数之后才建 → 会报 relation does not exist。plpgsql 的表名在**调用时**才解析,
-- 所以函数可以先声明、表后建,顺序不再要紧。
CREATE OR REPLACE FUNCTION public.is_family_member(fid uuid, uid uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.family_members m
    WHERE m.family_id = fid AND m.user_id = uid
  );
END;
$$;

-- ── families ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  invite_code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "families_select_member" ON public.families;
CREATE POLICY "families_select_member"
  ON public.families FOR SELECT
  USING (public.is_family_member(id, auth.uid()) OR created_by = auth.uid());

DROP POLICY IF EXISTS "families_insert_own" ON public.families;
CREATE POLICY "families_insert_own"
  ON public.families FOR INSERT
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "families_update_member" ON public.families;
CREATE POLICY "families_update_member"
  ON public.families FOR UPDATE
  USING (public.is_family_member(id, auth.uid()))
  WITH CHECK (public.is_family_member(id, auth.uid()));

-- ── family_members(每人权限 bool;非硬编码 kid/parent 枚举)─────────────────────────
CREATE TABLE IF NOT EXISTS public.family_members (
  family_id uuid NOT NULL REFERENCES public.families (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  identity_key text,
  display_name text NOT NULL,
  can_approve boolean NOT NULL DEFAULT false,
  needs_approval boolean NOT NULL DEFAULT true,
  can_record_payout boolean NOT NULL DEFAULT false,
  email text,                 -- 成员自报的账号邮箱(入伙时本人写自己的);供拥有者本地把成员配到 People 的 person 节点
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, user_id)
);

-- 反复应用安全:老表补列(email 早期用于 People 配对,现已解耦;保留不碍事)。
ALTER TABLE public.family_members ADD COLUMN IF NOT EXISTS email text;
-- 成员身份自成一套:名字/头像来自 TA 自己的账号资料(自报+自愈),不再匹配 People 联系人。
ALTER TABLE public.family_members ADD COLUMN IF NOT EXISTS avatar_url text;
-- 攒钱目标(孩子端动机):攒够 goal_amount 买 goal_label。进度 = 现攒 / 目标。
ALTER TABLE public.family_members ADD COLUMN IF NOT EXISTS goal_amount numeric;
ALTER TABLE public.family_members ADD COLUMN IF NOT EXISTS goal_label text;

CREATE INDEX IF NOT EXISTS idx_family_members_user
  ON public.family_members (user_id);

ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;

-- 成员可见同家庭全体成员(经 SECURITY DEFINER 判定,不递归);自己那行永远可见。
DROP POLICY IF EXISTS "family_members_select_same_family" ON public.family_members;
CREATE POLICY "family_members_select_same_family"
  ON public.family_members FOR SELECT
  USING (user_id = auth.uid() OR public.is_family_member(family_id, auth.uid()));

-- 写入/改权限:交给服务端(service role,按 can_approve 强制)。客户端仅允许"自己入伙"这一条
-- (insert 自己的成员行)——具体权限位由服务端邀请流程落定;这里给个自助入伙的最小 INSERT。
DROP POLICY IF EXISTS "family_members_insert_self" ON public.family_members;
CREATE POLICY "family_members_insert_self"
  ON public.family_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ── family_chore_templates ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.family_chore_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families (id) ON DELETE CASCADE,
  title text NOT NULL,
  cadence jsonb NOT NULL DEFAULT '{"kind":"once"}'::jsonb CHECK (jsonb_typeof(cadence) = 'object'),
  value numeric NOT NULL DEFAULT 0 CHECK (value >= 0),
  assignee_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  needs_approval boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_family_chore_templates_family
  ON public.family_chore_templates (family_id, updated_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.family_chore_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "family_chore_templates_member_rw" ON public.family_chore_templates;
CREATE POLICY "family_chore_templates_member_rw"
  ON public.family_chore_templates FOR ALL
  USING (public.is_family_member(family_id, auth.uid()))
  WITH CHECK (public.is_family_member(family_id, auth.uid()));

-- ── family_chore_instances(状态机 todo→done→approved→paid)────────────────────────
CREATE TABLE IF NOT EXISTS public.family_chore_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families (id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.family_chore_templates (id) ON DELETE SET NULL,
  assignee_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  due_date date NOT NULL,
  value numeric NOT NULL DEFAULT 0 CHECK (value >= 0),
  state text NOT NULL DEFAULT 'todo' CHECK (state IN ('todo','done','approved','paid')),
  needs_approval boolean NOT NULL DEFAULT true,
  done_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  proof_asset_ref text,
  title text,                 -- 由日历事件分派而来的家务:留原事件标题(模板家务为空,按 template 显示)
  source_event_id text,       -- 关联的来源记忆节点 id(日历事件)。一事件一实例的去重键。
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (family_id, template_id, due_date)
);

-- 反复应用安全:老表补列(闭环「日历家务 → 分派给家人」用)。
ALTER TABLE public.family_chore_instances ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.family_chore_instances ADD COLUMN IF NOT EXISTS source_event_id text;

-- 一个家庭里,一条来源日历事件只对应一条家务实例 → 再点「分派」= 改派(upsert),不重复生成。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_family_chore_source_event
  ON public.family_chore_instances (family_id, source_event_id)
  WHERE source_event_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_family_chore_instances_family
  ON public.family_chore_instances (family_id, due_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_family_chore_instances_assignee
  ON public.family_chore_instances (family_id, assignee_user_id, state)
  WHERE deleted_at IS NULL;

ALTER TABLE public.family_chore_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "family_chore_instances_member_rw" ON public.family_chore_instances;
CREATE POLICY "family_chore_instances_member_rw"
  ON public.family_chore_instances FOR ALL
  USING (public.is_family_member(family_id, auth.uid()))
  WITH CHECK (public.is_family_member(family_id, auth.uid()));

-- ── family_payouts(线下现金冲账;永不是转账。amount 恒正)──────────────────────────
CREATE TABLE IF NOT EXISTS public.family_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families (id) ON DELETE CASCADE,
  person_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  date date NOT NULL,
  note text,
  recorded_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_family_payouts_family
  ON public.family_payouts (family_id, date DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.family_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "family_payouts_member_rw" ON public.family_payouts;
CREATE POLICY "family_payouts_member_rw"
  ON public.family_payouts FOR ALL
  USING (public.is_family_member(family_id, auth.uid()))
  WITH CHECK (public.is_family_member(family_id, auth.uid()));
