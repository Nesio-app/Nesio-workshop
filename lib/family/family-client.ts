/**
 * 家庭分享 · 客户端数据层(M3)。对 /api/portal/family/* 的类型化封装。
 * 所有调用回 { ok, data } | { ok:false, error },供 UI 显式失败态(设计红线)。
 * 纯 fetch,不 import 服务端模块(client 安全)。
 */
import type { Cadence } from '@/lib/family/chores-core';
import { fetchWithTimeout } from '@/lib/portal/fetch-timeout';

export type ChoreStateView = 'todo' | 'done' | 'approved' | 'paid';
export interface FamilyMemberView { id: string; name: string; canApprove: boolean; needsApproval: boolean; canRecordPayout: boolean; email?: string; avatarUrl?: string; goalAmount?: number; goalLabel?: string; }
export interface ChoreInstanceView {
  id: string; templateId: string; assigneeId: string; dueDate: string; value: number;
  state: ChoreStateView; needsApproval: boolean; doneAt?: string; approvedAt?: string; proofPhotoRef?: string;
  title?: string; sourceEventId?: string;
}
export interface FamilySummary { familyId: string; name: string; inviteCode: string; me: FamilyMemberView; }
export interface BoardView {
  familyId: string; me: FamilyMemberView;
  myChoresToday: ChoreInstanceView[]; toReview: ChoreInstanceView[];
  assigned: ChoreInstanceView[];
  everyone: Array<{ member: FamilyMemberView; owed: number; earned: number }>;
}
export interface EventAssignmentView {
  assigned: boolean; assigneeId?: string; assigneeName?: string;
  state?: ChoreStateView; familyId?: string; dueDate?: string; count?: number;
}
export interface PayoutView { id: string; personId: string; amount: number; date: string; note?: string; }
export interface LedgerView {
  balance: { personId: string; earned: number; paidOut: number; owed: number };
  approved: ChoreInstanceView[]; payouts: PayoutView[];
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * 2026-07-29(用户标注「家务页卡死在『加载中…』」的真因):这里原本没有超时。
 * fetch 不带 signal 时,网关不回 / 连接半挂,浏览器会**一直**等下去 ——
 * 于是 setLoading(false) 永远不执行,加载态就停在那儿,看起来像卡死。
 * 12s 到点就当 network 处理,UI 拿到显式失败态 + 重试(CLAUDE.md 红线)。
 * 超时实现走共用的 fetchWithTimeout,全站只有那一份。
 */
const TIMEOUT_MS = 12_000;

async function api<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetchWithTimeout(url, { cache: 'no-store', ...init }, TIMEOUT_MS);
    // 平台超时回非 JSON —— 安全解析,别炸进 catch 误报网络
    let body: unknown = null;
    try { body = JSON.parse(await res.text()); } catch { /* 网关页 */ }
    const b = (body ?? {}) as { ok?: boolean; error?: string };
    if (!res.ok || !b.ok) return { ok: false, error: b.error || `http_${res.status}` };
    return { ok: true, data: b as T };
  } catch {
    return { ok: false, error: 'network' };
  }
}

const postJson = (body: unknown): RequestInit => ({
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

export function listFamilies(): Promise<ApiResult<{ families: FamilySummary[] }>> {
  return api('/api/portal/family');
}
export function createFamily(name: string, displayName: string, avatarUrl?: string): Promise<ApiResult<{ familyId: string; inviteCode: string }>> {
  return api('/api/portal/family', postJson({ name, displayName, avatarUrl }));
}
export function joinFamily(inviteCode: string, displayName: string, avatarUrl?: string): Promise<ApiResult<{ familyId: string }>> {
  return api('/api/portal/family/join', postJson({ inviteCode, displayName, avatarUrl }));
}
/** 把我的账号资料(名字/头像)同步到我在各家庭的成员行(打开家庭分享时刷新)。 */
export function syncMyFamilyProfile(displayName: string, avatarUrl: string): Promise<ApiResult<{ updated: number }>> {
  return api('/api/portal/family/profile', postJson({ displayName, avatarUrl }));
}
/** 设我在某家庭的攒钱目标(攒够 amount 买 label;amount<=0 清除)。 */
export function setMyGoal(familyId: string, amount: number, label: string): Promise<ApiResult<Record<string, never>>> {
  return api('/api/portal/family/goal', postJson({ familyId, amount, label }));
}
export function getBoard(familyId: string): Promise<ApiResult<{ board: BoardView }>> {
  return api(`/api/portal/family/board?familyId=${encodeURIComponent(familyId)}`);
}
export function getLedger(familyId: string, personId: string): Promise<ApiResult<{ ledger: LedgerView }>> {
  return api(`/api/portal/family/ledger?familyId=${encodeURIComponent(familyId)}&personId=${encodeURIComponent(personId)}`);
}
export function createChore(
  familyId: string,
  input: { title: string; cadence: Cadence; value: number; assigneeId: string; needsApproval: boolean },
): Promise<ApiResult<{ templateId: string; generated: number }>> {
  return api('/api/portal/family/chore', postJson({ familyId, ...input }));
}
export function choreAction(
  familyId: string, instanceId: string, action: 'done' | 'approve' | 'send_back', proofRef?: string,
): Promise<ApiResult<{ instance: ChoreInstanceView }>> {
  return api('/api/portal/family/chore/action', postJson({ familyId, instanceId, action, proofRef }));
}
export function listFamilyMembers(familyId: string): Promise<ApiResult<{ familyId: string; me: FamilyMemberView; members: FamilyMemberView[] }>> {
  return api(`/api/portal/family/members?familyId=${encodeURIComponent(familyId)}`);
}
/** 改某成员权限(需 can_approve)。 */
export function setMemberRole(familyId: string, memberUserId: string, role: { canApprove: boolean; needsApproval: boolean; canRecordPayout: boolean }): Promise<ApiResult<Record<string, never>>> {
  return api('/api/portal/family/member', postJson({ action: 'role', familyId, memberUserId, ...role }));
}
/** 移出成员(踢别人需 can_approve;memberUserId=自己=退出家庭)。 */
export function removeMember(familyId: string, memberUserId: string): Promise<ApiResult<Record<string, never>>> {
  return api('/api/portal/family/member', postJson({ action: 'remove', familyId, memberUserId }));
}
export function getEventAssignment(sourceEventId: string): Promise<ApiResult<EventAssignmentView>> {
  return api(`/api/portal/family/assignment?sourceEventId=${encodeURIComponent(sourceEventId)}`);
}
/** 停掉/删除一条(含周期全部)来自日历事件的家务(需 can_approve)。 */
export function cancelEventChore(familyId: string, sourceEventId: string): Promise<ApiResult<{ cancelled: number }>> {
  return api('/api/portal/family/cancel', postJson({ familyId, sourceEventId }));
}
export function assignChoreFromEvent(
  input: { familyId: string; sourceEventId: string; title: string; dueDate: string; assigneeId: string; value?: number; needsApproval?: boolean; cadence?: Cadence },
): Promise<ApiResult<{ instance: ChoreInstanceView }>> {
  return api('/api/portal/family/assign', postJson(input));
}
export function recordPayout(
  familyId: string, personId: string, amount: number, date?: string, note?: string,
): Promise<ApiResult<{ payout: PayoutView }>> {
  return api('/api/portal/family/payout', postJson({ familyId, personId, amount, date, note }));
}
/** 冲正一笔发薪(记错了撤掉;需 can_record_payout)。软删,账本自动回加。 */
export function reversePayout(familyId: string, payoutId: string): Promise<ApiResult<{ reversed: number }>> {
  return api('/api/portal/family/payout', postJson({ action: 'reverse', familyId, payoutId }));
}
