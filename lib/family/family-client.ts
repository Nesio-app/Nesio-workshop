/**
 * 家庭分享 · 客户端数据层(M3)。对 /api/portal/family/* 的类型化封装。
 * 所有调用回 { ok, data } | { ok:false, error },供 UI 显式失败态(设计红线)。
 * 纯 fetch,不 import 服务端模块(client 安全)。
 */
import type { Cadence } from '@/lib/family/chores-core';

export type ChoreStateView = 'todo' | 'done' | 'approved' | 'paid';
export interface FamilyMemberView { id: string; name: string; canApprove: boolean; needsApproval: boolean; canRecordPayout: boolean; email?: string; avatarUrl?: string; }
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
  everyone: Array<{ member: FamilyMemberView; owed: number }>;
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

async function api<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { cache: 'no-store', ...init });
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
export function getEventAssignment(sourceEventId: string): Promise<ApiResult<EventAssignmentView>> {
  return api(`/api/portal/family/assignment?sourceEventId=${encodeURIComponent(sourceEventId)}`);
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
