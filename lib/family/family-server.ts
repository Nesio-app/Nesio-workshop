/**
 * 家庭分享 · 服务端操作(workshop 域实验 M2b)。信任模型 A:服务端授权。
 *
 * 职责:解析登录用户 → 查其在某家庭的成员身份/权限 → 用 lib/family/chores-core 强制能力
 * (fail-closed)→ service-role 访问 Supabase 家庭表。所有受控写(审核/记付款/建模板)都在
 * 这里过能力门,**不信任客户端**。RLS 是纵深防御,真正的门在这。
 *
 * 永不碰钱:recordPayout 只写一条 family_payouts(amount>0 记账),没有任何转账/支付路径。
 */
import type { NextRequest } from 'next/server';
import { getCloudConfig, getSignedInUser, serviceRoleRestHeaders, type CloudRuntimeConfig } from '@/lib/portal/cloud-server-runtime';
import {
  markChoreDone, approveChore, sendBackChore, memberCan, computeBalance, generateDueInstances,
  type FamilyMember, type ChoreInstance, type Payout, type ChoreState, type Cadence,
} from '@/lib/family/chores-core';

export type FamilyError =
  | 'not_configured' | 'not_signed_in' | 'not_member' | 'forbidden'
  | 'not_found' | 'bad_request' | 'conflict' | 'upstream';

export type FamilyResult<T> = { ok: true; value: T } | { ok: false; error: FamilyError; status: number };

function fail(error: FamilyError, status: number): FamilyResult<never> { return { ok: false, error, status }; }

// ── Supabase PostgREST(service-role)薄封装 ────────────────────────────────────
function restUrl(config: CloudRuntimeConfig, table: string, query = ''): string {
  return `${config.supabaseUrl}/rest/v1/${table}${query ? `?${query}` : ''}`;
}

async function restGet<T>(config: CloudRuntimeConfig, table: string, query: string): Promise<T[] | null> {
  try {
    const res = await fetch(restUrl(config, table, query), { headers: serviceRoleRestHeaders(config), cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return Array.isArray(data) ? (data as T[]) : null;
  } catch { return null; }
}

async function restInsert<T>(config: CloudRuntimeConfig, table: string, rows: unknown, upsert = false): Promise<T[] | null> {
  try {
    const res = await fetch(restUrl(config, table), {
      method: 'POST',
      headers: serviceRoleRestHeaders(config, { Prefer: `return=representation${upsert ? ',resolution=merge-duplicates' : ''}` }),
      body: JSON.stringify(rows),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return Array.isArray(data) ? (data as T[]) : null;
  } catch { return null; }
}

async function restPatch<T>(config: CloudRuntimeConfig, table: string, query: string, patch: unknown): Promise<T[] | null> {
  try {
    const res = await fetch(restUrl(config, table, query), {
      method: 'PATCH',
      headers: serviceRoleRestHeaders(config, { Prefer: 'return=representation' }),
      body: JSON.stringify(patch),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return Array.isArray(data) ? (data as T[]) : null;
  } catch { return null; }
}

// ── 行类型(DB 快照)────────────────────────────────────────────────────────────
interface MemberRow { family_id: string; user_id: string; display_name: string; can_approve: boolean; needs_approval: boolean; can_record_payout: boolean; }
interface InstanceRow { id: string; family_id: string; template_id: string | null; assignee_user_id: string | null; due_date: string; value: number; state: ChoreState; needs_approval: boolean; done_at: string | null; approved_at: string | null; proof_asset_ref: string | null; }
interface PayoutRow { id: string; family_id: string; person_user_id: string | null; amount: number; date: string; note: string | null; }

function memberFromRow(r: MemberRow): FamilyMember {
  return { id: r.user_id, name: r.display_name, canApprove: r.can_approve, needsApproval: r.needs_approval, canRecordPayout: r.can_record_payout };
}
function instanceFromRow(r: InstanceRow): ChoreInstance {
  return {
    id: r.id, templateId: r.template_id ?? '', assigneeId: r.assignee_user_id ?? '', dueDate: r.due_date,
    value: Number(r.value), state: r.state, needsApproval: r.needs_approval,
    doneAt: r.done_at ?? undefined, approvedAt: r.approved_at ?? undefined, proofPhotoRef: r.proof_asset_ref ?? undefined,
  };
}
function payoutFromRow(r: PayoutRow): Payout {
  return { id: r.id, personId: r.person_user_id ?? '', amount: Number(r.amount), date: r.date, note: r.note ?? undefined };
}

// ── 登录 + 成员解析 ───────────────────────────────────────────────────────────
export interface FamilyActor { config: CloudRuntimeConfig; userId: string; }

/** 解析登录用户(未配置/未登录 fail-closed)。 */
export async function resolveActor(_req: NextRequest): Promise<FamilyResult<FamilyActor>> {
  const config = getCloudConfig();
  if (!config.configured) return fail('not_configured', 503);
  const { user } = await getSignedInUser(config);
  if (!user?.id) return fail('not_signed_in', 401);
  return { ok: true, value: { config, userId: user.id } };
}

/** 取 actor 在某家庭的成员行(非成员 → not_member,fail-closed)。 */
async function requireMember(actor: FamilyActor, familyId: string): Promise<FamilyResult<MemberRow>> {
  const rows = await restGet<MemberRow>(actor.config, 'family_members',
    `family_id=eq.${familyId}&user_id=eq.${actor.userId}&select=*`);
  if (rows === null) return fail('upstream', 502);
  if (!rows.length) return fail('not_member', 403);
  return { ok: true, value: rows[0] };
}

function shortInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混 O0I1
  let s = '';
  for (let i = 0; i < 7; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

// ── 操作 ──────────────────────────────────────────────────────────────────────

/** 建家:创建者自动成为家长成员(can_approve + can_record_payout,needs_approval=off)。 */
export async function createFamily(actor: FamilyActor, input: { name: string; displayName: string }): Promise<FamilyResult<{ familyId: string; inviteCode: string }>> {
  const name = (input.name || '').trim();
  const displayName = (input.displayName || '').trim() || 'Me';
  if (!name) return fail('bad_request', 400);
  const inviteCode = shortInviteCode();
  const famRows = await restInsert<{ id: string; invite_code: string }>(actor.config, 'families',
    { name, created_by: actor.userId, invite_code: inviteCode });
  if (!famRows?.length) return fail('upstream', 502);
  const familyId = famRows[0].id;
  const memberRows = await restInsert<MemberRow>(actor.config, 'family_members', {
    family_id: familyId, user_id: actor.userId, display_name: displayName,
    can_approve: true, needs_approval: false, can_record_payout: true,
  });
  if (!memberRows?.length) return fail('upstream', 502);
  return { ok: true, value: { familyId, inviteCode: famRows[0].invite_code } };
}

/** 入伙:凭邀请码加入,默认孩子权限(needs_approval=on / can_approve=off)。家长可在成员管理里改。 */
export async function joinFamily(actor: FamilyActor, input: { inviteCode: string; displayName: string }): Promise<FamilyResult<{ familyId: string }>> {
  const code = (input.inviteCode || '').trim().toUpperCase();
  const displayName = (input.displayName || '').trim() || 'Me';
  if (!code) return fail('bad_request', 400);
  const fam = await restGet<{ id: string }>(actor.config, 'families', `invite_code=eq.${code}&select=id`);
  if (fam === null) return fail('upstream', 502);
  if (!fam.length) return fail('not_found', 404);
  const familyId = fam[0].id;
  // 幂等:已是成员就直接回成功,不覆盖既有权限。
  const existing = await restGet<MemberRow>(actor.config, 'family_members', `family_id=eq.${familyId}&user_id=eq.${actor.userId}&select=user_id`);
  if (existing?.length) return { ok: true, value: { familyId } };
  const rows = await restInsert<MemberRow>(actor.config, 'family_members', {
    family_id: familyId, user_id: actor.userId, display_name: displayName,
    can_approve: false, needs_approval: true, can_record_payout: false,
  });
  if (!rows?.length) return fail('upstream', 502);
  return { ok: true, value: { familyId } };
}

/** 我所属的全部家庭 + 我在每个家庭的权限。 */
export async function listMyFamilies(actor: FamilyActor): Promise<FamilyResult<Array<{ familyId: string; name: string; inviteCode: string; me: FamilyMember }>>> {
  const mine = await restGet<MemberRow>(actor.config, 'family_members', `user_id=eq.${actor.userId}&select=*`);
  if (mine === null) return fail('upstream', 502);
  if (!mine.length) return { ok: true, value: [] };
  const ids = mine.map((m) => m.family_id);
  const fams = await restGet<{ id: string; name: string; invite_code: string }>(actor.config, 'families', `id=in.(${ids.join(',')})&select=id,name,invite_code`);
  const byId = new Map((fams ?? []).map((f) => [f.id, f]));
  return {
    ok: true,
    // 邀请码随家庭一起回,家庭板可随时展示 —— 修「创建后邀请码就找不到了」。
    value: mine.map((m) => ({ familyId: m.family_id, name: byId.get(m.family_id)?.name ?? 'Family', inviteCode: byId.get(m.family_id)?.invite_code ?? '', me: memberFromRow(m) })),
  };
}

export interface BoardView {
  familyId: string;
  me: FamilyMember;
  myChoresToday: ChoreInstance[];
  toReview: ChoreInstance[];        // 仅 can_approve 才非空
  everyone: Array<{ member: FamilyMember; owed: number }>;
}

/** 家庭板:我今天的活 + (可审核才有的)待审队列 + 全家余额。区块按权限,能力仍服务端判。 */
export async function getBoard(actor: FamilyActor, familyId: string, todayKey: string): Promise<FamilyResult<BoardView>> {
  const gate = await requireMember(actor, familyId);
  if (!gate.ok) return gate;
  const me = memberFromRow(gate.value);

  const [memberRows, instRows, payoutRows] = await Promise.all([
    restGet<MemberRow>(actor.config, 'family_members', `family_id=eq.${familyId}&select=*`),
    restGet<InstanceRow>(actor.config, 'family_chore_instances', `family_id=eq.${familyId}&deleted_at=is.null&select=*`),
    restGet<PayoutRow>(actor.config, 'family_payouts', `family_id=eq.${familyId}&deleted_at=is.null&select=*`),
  ]);
  if (memberRows === null || instRows === null || payoutRows === null) return fail('upstream', 502);

  const instances = instRows.map(instanceFromRow);
  const payouts = payoutRows.map(payoutFromRow);

  const myChoresToday = instances.filter((c) => c.assigneeId === actor.userId && c.dueDate <= todayKey && (c.state === 'todo' || c.state === 'done'));
  // 待审:只对 can_approve 暴露(服务端判定,不靠 UI 藏)
  const toReview = memberCan(me, 'approve') ? instances.filter((c) => c.state === 'done') : [];

  const everyone = memberRows.map((m) => ({
    member: memberFromRow(m),
    owed: computeBalance(m.user_id, instances, payouts).owed,
  }));

  return { ok: true, value: { familyId, me, myChoresToday, toReview, everyone } };
}

/** 某成员的账本明细(历史 + 余额)。任何成员可看(自己/家人的攒钱数是共享的)。 */
export async function getLedger(actor: FamilyActor, familyId: string, personId: string): Promise<FamilyResult<{ balance: ReturnType<typeof computeBalance>; approved: ChoreInstance[]; payouts: Payout[] }>> {
  const gate = await requireMember(actor, familyId);
  if (!gate.ok) return gate;
  const [instRows, payoutRows] = await Promise.all([
    restGet<InstanceRow>(actor.config, 'family_chore_instances', `family_id=eq.${familyId}&assignee_user_id=eq.${personId}&deleted_at=is.null&select=*`),
    restGet<PayoutRow>(actor.config, 'family_payouts', `family_id=eq.${familyId}&person_user_id=eq.${personId}&deleted_at=is.null&select=*`),
  ]);
  if (instRows === null || payoutRows === null) return fail('upstream', 502);
  const instances = instRows.map(instanceFromRow);
  const payouts = payoutRows.map(payoutFromRow);
  const balance = computeBalance(personId, instances, payouts);
  const approved = instances.filter((c) => c.state === 'approved' || c.state === 'paid');
  return { ok: true, value: { balance, approved, payouts } };
}

/** 受控命令:对一件家务实例做 done/approve/send_back。能力 + 状态机全在核心判,DB 只落结果。 */
export async function applyChoreAction(
  actor: FamilyActor,
  input: { familyId: string; instanceId: string; action: 'done' | 'approve' | 'send_back'; at: string; proofRef?: string },
): Promise<FamilyResult<ChoreInstance>> {
  const gate = await requireMember(actor, input.familyId);
  if (!gate.ok) return gate;
  const actorMember = memberFromRow(gate.value);

  const rows = await restGet<InstanceRow>(actor.config, 'family_chore_instances', `id=eq.${input.instanceId}&family_id=eq.${input.familyId}&select=*`);
  if (rows === null) return fail('upstream', 502);
  if (!rows.length) return fail('not_found', 404);
  const instance = instanceFromRow(rows[0]);

  let result: ReturnType<typeof markChoreDone>;
  if (input.action === 'done') result = markChoreDone(instance, actorMember, input.at);
  else if (input.action === 'approve') result = approveChore(instance, actorMember, input.at);
  else result = sendBackChore(instance, actorMember);

  if (!result.ok) {
    const status = result.error === 'forbidden' || result.error === 'not_assignee' ? 403 : 409;
    return fail(result.error === 'forbidden' || result.error === 'not_assignee' ? 'forbidden' : 'conflict', status);
  }
  const next = result.value;

  const patch: Record<string, unknown> = {
    state: next.state,
    done_at: next.doneAt ?? null,
    approved_at: next.approvedAt ?? null,
    proof_asset_ref: input.action === 'done' && input.proofRef ? input.proofRef : (next.proofPhotoRef ?? null),
    updated_at: new Date().toISOString(),
  };
  const saved = await restPatch<InstanceRow>(actor.config, 'family_chore_instances', `id=eq.${input.instanceId}&family_id=eq.${input.familyId}`, patch);
  if (!saved?.length) return fail('upstream', 502);
  return { ok: true, value: instanceFromRow(saved[0]) };
}

/** 建家务模板 + 在 [fromKey,toKey] 窗口内生成实例(需 can_approve)。实例按唯一键 upsert,幂等。 */
export async function createChoreTemplateOp(
  actor: FamilyActor,
  input: { familyId: string; title: string; cadence: Cadence; value: number; assigneeId: string; needsApproval: boolean; window: { fromKey: string; toKey: string } },
): Promise<FamilyResult<{ templateId: string; generated: number }>> {
  const gate = await requireMember(actor, input.familyId);
  if (!gate.ok) return gate;
  if (!memberCan(memberFromRow(gate.value), 'create_template')) return fail('forbidden', 403);
  const title = (input.title || '').trim();
  if (!title || !(input.value >= 0) || !Number.isFinite(input.value)) return fail('bad_request', 400);

  const tmplRows = await restInsert<{ id: string }>(actor.config, 'family_chore_templates', {
    family_id: input.familyId, title, cadence: input.cadence, value: input.value,
    assignee_user_id: input.assigneeId || null, needs_approval: input.needsApproval, created_by: actor.userId,
  });
  if (!tmplRows?.length) return fail('upstream', 502);
  const templateId = tmplRows[0].id;

  const template = { id: templateId, title, cadence: input.cadence, value: input.value, assigneeId: input.assigneeId, needsApproval: input.needsApproval };
  const dues = generateDueInstances(template, input.window, [], (t, d) => `${t}|${d}`);
  const rows = dues.map((d) => ({
    family_id: input.familyId, template_id: templateId, assignee_user_id: input.assigneeId || null,
    due_date: d.dueDate, value: input.value, state: 'todo', needs_approval: input.needsApproval,
  }));
  if (rows.length) {
    const inserted = await restInsert(actor.config, 'family_chore_instances', rows, true);
    if (inserted === null) return fail('upstream', 502);
  }
  return { ok: true, value: { templateId, generated: rows.length } };
}

/** 记一笔线下现金冲账。能力 can_record_payout 服务端强制;金额恒正。永不是转账。 */
export async function recordPayoutOp(
  actor: FamilyActor,
  input: { familyId: string; personId: string; amount: number; date: string; note?: string },
): Promise<FamilyResult<Payout>> {
  const gate = await requireMember(actor, input.familyId);
  if (!gate.ok) return gate;
  const actorMember = memberFromRow(gate.value);
  if (!memberCan(actorMember, 'record_payout')) return fail('forbidden', 403);
  if (!(input.amount > 0) || !Number.isFinite(input.amount)) return fail('bad_request', 400);

  const rows = await restInsert<PayoutRow>(actor.config, 'family_payouts', {
    family_id: input.familyId, person_user_id: input.personId, amount: input.amount,
    date: input.date, note: input.note ?? null, recorded_by: actor.userId,
  });
  if (!rows?.length) return fail('upstream', 502);
  return { ok: true, value: payoutFromRow(rows[0]) };
}
