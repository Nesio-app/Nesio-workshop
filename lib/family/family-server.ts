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
  cadenceDue, addDays,
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

async function restDelete(config: CloudRuntimeConfig, table: string, query: string): Promise<boolean> {
  try {
    const res = await fetch(restUrl(config, table, query), { method: 'DELETE', headers: serviceRoleRestHeaders(config) });
    return res.ok;
  } catch { return false; }
}

// ── 行类型(DB 快照)────────────────────────────────────────────────────────────
interface MemberRow { family_id: string; user_id: string; display_name: string; can_approve: boolean; needs_approval: boolean; can_record_payout: boolean; email: string | null; avatar_url: string | null; goal_amount: number | null; goal_label: string | null; }
interface InstanceRow { id: string; family_id: string; template_id: string | null; assignee_user_id: string | null; due_date: string; value: number; state: ChoreState; needs_approval: boolean; done_at: string | null; approved_at: string | null; proof_asset_ref: string | null; title: string | null; source_event_id: string | null; }
interface PayoutRow { id: string; family_id: string; person_user_id: string | null; amount: number; date: string; note: string | null; }

function memberFromRow(r: MemberRow): FamilyMember {
  return {
    id: r.user_id, name: r.display_name, canApprove: r.can_approve, needsApproval: r.needs_approval, canRecordPayout: r.can_record_payout,
    avatarUrl: r.avatar_url ?? undefined,
    goalAmount: r.goal_amount != null ? Number(r.goal_amount) : undefined,
    goalLabel: r.goal_label ?? undefined,
  };
}
/** 成员 + 账号邮箱(供拥有者本地按邮箱配到 People 的 person 节点)。 */
export interface FamilyMemberWithEmail extends FamilyMember { email: string; }
function memberWithEmailFromRow(r: MemberRow): FamilyMemberWithEmail {
  return { ...memberFromRow(r), email: (r.email ?? '').toLowerCase() };
}
function instanceFromRow(r: InstanceRow): ChoreInstance {
  return {
    id: r.id, templateId: r.template_id ?? '', assigneeId: r.assignee_user_id ?? '', dueDate: r.due_date,
    value: Number(r.value), state: r.state, needsApproval: r.needs_approval,
    doneAt: r.done_at ?? undefined, approvedAt: r.approved_at ?? undefined, proofPhotoRef: r.proof_asset_ref ?? undefined,
    title: r.title ?? undefined, sourceEventId: r.source_event_id ?? undefined,
  };
}
function payoutFromRow(r: PayoutRow): Payout {
  return { id: r.id, personId: r.person_user_id ?? '', amount: Number(r.amount), date: r.date, note: r.note ?? undefined };
}

// ── 登录 + 成员解析 ───────────────────────────────────────────────────────────
export interface FamilyActor { config: CloudRuntimeConfig; userId: string; email: string; }

/** 解析登录用户(未配置/未登录 fail-closed)。 */
export async function resolveActor(_req: NextRequest): Promise<FamilyResult<FamilyActor>> {
  const config = getCloudConfig();
  if (!config.configured) return fail('not_configured', 503);
  const { user } = await getSignedInUser(config);
  if (!user?.id) return fail('not_signed_in', 401);
  return { ok: true, value: { config, userId: user.id, email: (user.email ?? '').toLowerCase() } };
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
export async function createFamily(actor: FamilyActor, input: { name: string; displayName: string; avatarUrl?: string }): Promise<FamilyResult<{ familyId: string; inviteCode: string }>> {
  const name = (input.name || '').trim();
  const displayName = (input.displayName || '').trim() || 'Me';
  if (!name) return fail('bad_request', 400);
  const inviteCode = shortInviteCode();
  const famRows = await restInsert<{ id: string; invite_code: string }>(actor.config, 'families',
    { name, created_by: actor.userId, invite_code: inviteCode });
  if (!famRows?.length) return fail('upstream', 502);
  const familyId = famRows[0].id;
  const memberRows = await restInsert<MemberRow>(actor.config, 'family_members', {
    family_id: familyId, user_id: actor.userId, display_name: displayName, email: actor.email || null, avatar_url: input.avatarUrl || null,
    can_approve: true, needs_approval: false, can_record_payout: true,
  });
  if (!memberRows?.length) return fail('upstream', 502);
  return { ok: true, value: { familyId, inviteCode: famRows[0].invite_code } };
}

/** 入伙:凭邀请码加入,默认孩子权限(needs_approval=on / can_approve=off)。家长可在成员管理里改。 */
export async function joinFamily(actor: FamilyActor, input: { inviteCode: string; displayName: string; avatarUrl?: string }): Promise<FamilyResult<{ familyId: string }>> {
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
    family_id: familyId, user_id: actor.userId, display_name: displayName, email: actor.email || null, avatar_url: input.avatarUrl || null,
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
  assigned: ChoreInstance[];        // 所有已安排(todo/done)的活,含未来到期 —— 让「谁被派了什么、什么状态」可见
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

  // 已安排(含未来到期):按到期日升序,让「派了什么给谁、什么状态」在板上一眼可见。
  const assigned = instances
    .filter((c) => c.state === 'todo' || c.state === 'done')
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));

  const everyone = memberRows.map((m) => ({
    member: memberFromRow(m),
    owed: computeBalance(m.user_id, instances, payouts).owed,
  }));

  return { ok: true, value: { familyId, me, myChoresToday, toReview, assigned, everyone } };
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

/** 同步「我」自己的账号资料(名字/头像)到我在各家庭的成员行 —— 家庭成员身份自成一套,
 *  名字头像来自 TA 本人的账号,不再匹配 People。TA 每次打开家庭分享时刷新一次。 */
export async function syncMyProfileOp(actor: FamilyActor, input: { displayName?: string; avatarUrl?: string }): Promise<FamilyResult<{ updated: number }>> {
  const patch: Record<string, unknown> = {};
  const dn = (input.displayName || '').trim();
  if (dn) patch.display_name = dn;
  if (typeof input.avatarUrl === 'string') patch.avatar_url = input.avatarUrl || null;
  if (!Object.keys(patch).length) return { ok: true, value: { updated: 0 } };
  const rows = await restPatch<MemberRow>(actor.config, 'family_members', `user_id=eq.${actor.userId}`, patch);
  if (rows === null) return fail('upstream', 502);
  return { ok: true, value: { updated: rows.length } };
}

/** 设「我」自己在某家庭的攒钱目标(攒够 amount 买 label)。只能设自己的。amount<=0 = 清除目标。 */
export async function setMyGoalOp(actor: FamilyActor, input: { familyId: string; amount: number; label: string }): Promise<FamilyResult<{ ok: true }>> {
  const gate = await requireMember(actor, input.familyId);
  if (!gate.ok) return gate;
  const amount = Number(input.amount);
  const label = (input.label || '').trim().slice(0, 40);
  const patch = amount > 0 && Number.isFinite(amount)
    ? { goal_amount: amount, goal_label: label || null }
    : { goal_amount: null, goal_label: null };
  const saved = await restPatch<MemberRow>(actor.config, 'family_members',
    `family_id=eq.${input.familyId}&user_id=eq.${actor.userId}`, patch);
  if (saved === null) return fail('upstream', 502);
  return { ok: true, value: { ok: true } };
}

/** 停掉/删除一条(含周期全部)来自日历事件的家务 —— 软删,不再出现在板/今天页。管理动作,需 can_approve。 */
export async function cancelEventChoreOp(actor: FamilyActor, input: { familyId: string; sourceEventId: string }): Promise<FamilyResult<{ cancelled: number }>> {
  const gate = await requireMember(actor, input.familyId);
  if (!gate.ok) return gate;
  if (!memberCan(memberFromRow(gate.value), 'approve')) return fail('forbidden', 403);
  const base = (input.sourceEventId || '').trim();
  if (!base) return fail('bad_request', 400);
  const inst = await restGet<InstanceRow>(actor.config, 'family_chore_instances',
    `family_id=eq.${input.familyId}&deleted_at=is.null&select=id,source_event_id`);
  if (inst === null) return fail('upstream', 502);
  const ids = inst.filter((r) => r.source_event_id === base || (r.source_event_id ?? '').startsWith(`${base}#`)).map((r) => r.id);
  if (!ids.length) return { ok: true, value: { cancelled: 0 } };
  const saved = await restPatch<InstanceRow>(actor.config, 'family_chore_instances',
    `id=in.(${ids.join(',')})&family_id=eq.${input.familyId}`, { deleted_at: new Date().toISOString() });
  if (saved === null) return fail('upstream', 502);
  return { ok: true, value: { cancelled: ids.length } };
}

/** 改某成员的权限(家长动作,需 can_approve)。防锁死:不把最后一个能审核的人降级。 */
export async function setMemberRoleOp(actor: FamilyActor, input: { familyId: string; memberUserId: string; canApprove: boolean; needsApproval: boolean; canRecordPayout: boolean }): Promise<FamilyResult<{ ok: true }>> {
  const gate = await requireMember(actor, input.familyId);
  if (!gate.ok) return gate;
  if (!memberCan(memberFromRow(gate.value), 'approve')) return fail('forbidden', 403);
  const rows = await restGet<MemberRow>(actor.config, 'family_members', `family_id=eq.${input.familyId}&select=user_id,can_approve`);
  if (rows === null) return fail('upstream', 502);
  const target = rows.find((r) => r.user_id === input.memberUserId);
  if (!target) return fail('not_found', 404);
  const approvers = rows.filter((r) => r.can_approve).length;
  if (target.can_approve && !input.canApprove && approvers <= 1) return fail('conflict', 409); // 别把唯一家长降级
  const saved = await restPatch<MemberRow>(actor.config, 'family_members',
    `family_id=eq.${input.familyId}&user_id=eq.${input.memberUserId}`,
    { can_approve: !!input.canApprove, needs_approval: !!input.needsApproval, can_record_payout: !!input.canRecordPayout });
  if (saved === null) return fail('upstream', 502);
  return { ok: true, value: { ok: true } };
}

/** 移出成员(踢别人需 can_approve;踢自己=退出,任何成员可)。防锁死:不踢掉唯一家长(除非只剩自己)。 */
export async function removeMemberOp(actor: FamilyActor, input: { familyId: string; memberUserId: string }): Promise<FamilyResult<{ ok: true }>> {
  const gate = await requireMember(actor, input.familyId);
  if (!gate.ok) return gate;
  const isSelf = input.memberUserId === actor.userId;
  if (!isSelf && !memberCan(memberFromRow(gate.value), 'approve')) return fail('forbidden', 403);
  const rows = await restGet<MemberRow>(actor.config, 'family_members', `family_id=eq.${input.familyId}&select=user_id,can_approve`);
  if (rows === null) return fail('upstream', 502);
  const target = rows.find((r) => r.user_id === input.memberUserId);
  if (!target) return { ok: true, value: { ok: true } };  // 已不在,幂等
  const approvers = rows.filter((r) => r.can_approve).length;
  if (target.can_approve && approvers <= 1 && rows.length > 1) return fail('conflict', 409); // 别留一堆孩子没家长
  const del = await restDelete(actor.config, 'family_members', `family_id=eq.${input.familyId}&user_id=eq.${input.memberUserId}`);
  if (!del) return fail('upstream', 502);
  return { ok: true, value: { ok: true } };
}

/** 家庭全体成员(供「分派给家人」选人)。名字/头像来自各成员自己的账号资料。任何成员可读。 */
export async function listFamilyMembersOp(actor: FamilyActor, familyId: string): Promise<FamilyResult<{ familyId: string; me: FamilyMemberWithEmail; members: FamilyMemberWithEmail[] }>> {
  const gate = await requireMember(actor, familyId);
  if (!gate.ok) return gate;
  // 自愈:老成员行没存邮箱(建列之前入伙的)→ 用当前登录邮箱补上自己那行,配对才有料。
  if (!gate.value.email && actor.email) {
    await restPatch<MemberRow>(actor.config, 'family_members',
      `family_id=eq.${familyId}&user_id=eq.${actor.userId}`, { email: actor.email });
    gate.value.email = actor.email;
  }
  const rows = await restGet<MemberRow>(actor.config, 'family_members', `family_id=eq.${familyId}&select=*`);
  if (rows === null) return fail('upstream', 502);
  return { ok: true, value: { familyId, me: memberWithEmailFromRow(gate.value), members: rows.map(memberWithEmailFromRow) } };
}

/**
 * 闭环起点:把一条日历事件(记忆节点)分派给某个家庭成员。
 * 分派是**互相的** —— 任何家庭成员都能把活派给任何成员(孩子也能给爸妈派)。只要是本家庭成员即可。
 * (真正的「谁能审核/记账」仍是家长动作,在 applyChoreAction/recordPayout 里按 can_approve 强制。)
 * 一事件一实例:按 (family_id, source_event_id) upsert —— 再点即改派,不重复生成。
 * 改派给新的人 → 状态复位 todo(旧的完成/审核不带过去)。
 */
/** 查某条日历事件(记忆)当前的分派状态 —— 供详情按钮重开时显示「已交给谁 · 状态」而非又回到「派活」。 */
export async function getEventAssignmentOp(
  actor: FamilyActor, sourceEventId: string,
): Promise<FamilyResult<{ assigned: boolean; assigneeId?: string; assigneeName?: string; state?: ChoreState; familyId?: string; dueDate?: string; count?: number }>> {
  const base = (sourceEventId || '').trim();
  if (!base) return { ok: true, value: { assigned: false } };
  const mine = await restGet<MemberRow>(actor.config, 'family_members', `user_id=eq.${actor.userId}&select=family_id`);
  if (mine === null) return fail('upstream', 502);
  if (!mine.length) return { ok: true, value: { assigned: false } };
  const ids = mine.map((m) => m.family_id);
  const inst = await restGet<InstanceRow>(actor.config, 'family_chore_instances',
    `family_id=in.(${ids.join(',')})&deleted_at=is.null&select=*`);
  if (inst === null) return fail('upstream', 502);
  // 一次性:source_event_id === base;周期:base#YYYY-MM-DD。取最早到期的那条代表当前状态。
  const matches = inst.filter((r) => r.source_event_id === base || (r.source_event_id ?? '').startsWith(`${base}#`));
  if (!matches.length) return { ok: true, value: { assigned: false } };
  matches.sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
  const first = matches[0];
  let assigneeName = '';
  if (first.assignee_user_id) {
    const m = await restGet<MemberRow>(actor.config, 'family_members',
      `family_id=eq.${first.family_id}&user_id=eq.${first.assignee_user_id}&select=display_name`);
    assigneeName = m?.[0]?.display_name ?? '';
  }
  return { ok: true, value: { assigned: true, assigneeId: first.assignee_user_id ?? '', assigneeName, state: first.state, familyId: first.family_id, dueDate: first.due_date, count: matches.length } };
}

const ASSIGN_HORIZON_DAYS = 14;   // 周期分派向前铺的窗口

/** 按 source_event_id 幂等 upsert 一条事件家务实例(改派给新的人则复位 todo)。 */
async function upsertEventInstance(
  config: CloudRuntimeConfig, familyId: string,
  d: { sourceEventId: string; title: string; dueDate: string; assigneeId: string; value: number; needsApproval: boolean },
): Promise<FamilyResult<ChoreInstance>> {
  const existing = await restGet<InstanceRow>(config, 'family_chore_instances',
    `family_id=eq.${familyId}&source_event_id=eq.${encodeURIComponent(d.sourceEventId)}&deleted_at=is.null&select=*`);
  if (existing === null) return fail('upstream', 502);
  if (existing.length) {
    const reassigned = existing[0].assignee_user_id !== d.assigneeId;
    const patch: Record<string, unknown> = {
      assignee_user_id: d.assigneeId, title: d.title, due_date: d.dueDate, value: d.value, needs_approval: d.needsApproval,
      updated_at: new Date().toISOString(),
      // 改派给新的人:旧完成/审核不带过去,复位 todo。派回原人:保持现状。
      ...(reassigned ? { state: 'todo', done_at: null, approved_at: null, proof_asset_ref: null } : {}),
    };
    const saved = await restPatch<InstanceRow>(config, 'family_chore_instances',
      `id=eq.${existing[0].id}&family_id=eq.${familyId}`, patch);
    if (!saved?.length) return fail('upstream', 502);
    return { ok: true, value: instanceFromRow(saved[0]) };
  }
  const inserted = await restInsert<InstanceRow>(config, 'family_chore_instances', {
    family_id: familyId, template_id: null, assignee_user_id: d.assigneeId,
    due_date: d.dueDate, value: d.value, state: 'todo', needs_approval: d.needsApproval,
    title: d.title, source_event_id: d.sourceEventId,
  });
  if (!inserted?.length) return fail('upstream', 502);
  return { ok: true, value: instanceFromRow(inserted[0]) };
}

export async function assignChoreFromEventOp(
  actor: FamilyActor,
  input: { familyId: string; sourceEventId: string; title: string; dueDate: string; assigneeId: string; value?: number; needsApproval?: boolean; cadence?: Cadence },
): Promise<FamilyResult<ChoreInstance>> {
  const gate = await requireMember(actor, input.familyId);
  if (!gate.ok) return gate;   // 成员即可分派;不要求 can_approve(互相分派)

  const baseEventId = (input.sourceEventId || '').trim();
  const title = (input.title || '').trim();
  const dueDate = (input.dueDate || '').trim();
  const assigneeId = (input.assigneeId || '').trim();
  const value = Number.isFinite(input.value) && (input.value as number) >= 0 ? (input.value as number) : 0;
  const needsApproval = input.needsApproval !== false;
  const cadence: Cadence = input.cadence ?? { kind: 'once' };
  if (!baseEventId || !title || !assigneeId || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return fail('bad_request', 400);

  // 被分派人必须是本家庭成员(fail-closed:不给外人塞活)。
  const target = await restGet<MemberRow>(actor.config, 'family_members', `family_id=eq.${input.familyId}&user_id=eq.${assigneeId}&select=user_id`);
  if (target === null) return fail('upstream', 502);
  if (!target.length) return fail('bad_request', 400);

  const common = { title, assigneeId, value, needsApproval };

  // 一次性:一事件一实例(source_event_id = 记忆节点 id)。
  if (cadence.kind === 'once') {
    return upsertEventInstance(actor.config, input.familyId, { ...common, sourceEventId: baseEventId, dueDate });
  }

  // 周期:向前铺一个窗口,每个到期日各一条(source key = `${节点id}#${日期}`,天然去重 + 可改派)。
  // 复用 cadenceDue —— 吃到 chores-core 的周期机制,不再「明天得再派一次」。
  const toKey = addDays(dueDate, ASSIGN_HORIZON_DAYS - 1);
  let primary: ChoreInstance | null = null;
  for (let cursor = dueDate, guard = 0; guard < 400 && cursor <= toKey; guard++, cursor = addDays(cursor, 1)) {
    if (!cadenceDue(cadence, cursor, dueDate)) continue;
    const r = await upsertEventInstance(actor.config, input.familyId, { ...common, sourceEventId: `${baseEventId}#${cursor}`, dueDate: cursor });
    if (!r.ok) return r;
    if (!primary) primary = r.value;
  }
  if (!primary) return fail('bad_request', 400);   // 窗口内没有任何到期日(理论上不会发生)
  return { ok: true, value: primary };
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
