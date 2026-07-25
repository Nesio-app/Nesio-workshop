/**
 * 家务 + 零花钱账本 · 确定性核心(workshop 域实验 M1)。
 *
 * 定位:纯逻辑、零依赖、零 ML、零网络 —— 状态机 + 派生账本 + 能力(权限)强制。
 * 这一层与"信任模型 / 共享 vault"无关,现在就能建、能测;M2 的家庭组地基、M3 的
 * 三屏 UI 都在这之上。数据将来落 Signal 图(ChoreInstance = 带状态的任务节点 +
 * edge→person),但核心函数一律**纯**:对传入的集合求值,不碰存储/图,便于契约钉死。
 *
 * 硬边界(见 CHORES-LEDGER-DESIGN.md):**永不碰钱**。"赚钱" = 私人账本里的一个数;
 * 真给钱在现实里发生,这里只记一笔 Payout 冲账。无支付/转账/发卡,永远。
 */

// ── 类型 ──────────────────────────────────────────────────────────────────────

/** 家务实例的生命周期。todo→done→approved→paid;done 可被"再来一次"退回 todo。 */
export type ChoreState = 'todo' | 'done' | 'approved' | 'paid';

/** 周期:每天 / 每周某几天(0=周日..6=周六)/ 每 N 天 / 一次性。 */
export type Cadence =
  | { kind: 'daily' }
  | { kind: 'weekly'; weekdays: number[] }
  | { kind: 'everyDays'; n: number }
  | { kind: 'once' };

/**
 * 家庭成员 = Person + 每人几个权限 bool(不是硬编码 kid/parent 枚举)。
 * 小朋友通常 needsApproval=on / canApprove=off;爸妈反过来。UI 藏不藏是体验,
 * 核心拒不拒才是安全 —— 所有受控命令都在这按这些 bool fail-closed。
 */
export interface FamilyMember {
  id: string;
  name: string;
  canApprove: boolean;        // 能审核他人家务 / 记付款 / 看全家总额
  needsApproval: boolean;     // 自己干完的活要进"待审"而非直接记账
  canRecordPayout: boolean;   // 能记一笔线下付款冲账
}

/** 家务模板(按周期生成实例)。value = 积分或金额(核心不区分,纯数)。 */
export interface ChoreTemplate {
  id: string;
  title: string;
  cadence: Cadence;
  value: number;
  assigneeId: string;
  needsApproval: boolean;
}

/** 家务实例(某个到期日的一件具体活)。 */
export interface ChoreInstance {
  id: string;
  templateId: string;
  assigneeId: string;
  dueDate: string;            // YYYY-MM-DD(到期日,归属家庭时区,由调用方给)
  value: number;
  state: ChoreState;
  needsApproval: boolean;
  doneAt?: string;
  approvedAt?: string;
  paidAt?: string;
  proofPhotoRef?: string;     // 可选存证照 —— 只指向家庭 vault,永不出门(核心不含上传路径)
  title?: string;            // 由日历事件分派而来的家务:显示原事件标题(模板家务留空,按 templateId 显示)
  sourceEventId?: string;    // 关联的来源(日历事件对应的记忆节点 id);一事件一实例的去重键
}

/** 付款记录:爸妈线下给了现金,在这记一笔冲账。永远不是一笔转账。 */
export interface Payout {
  id: string;
  personId: string;
  amount: number;
  date: string;
  note?: string;
}

/** 受控命令的结果:成功给新状态,失败给明确原因(fail-closed,绝不静默通过)。 */
export type CommandResult<T> = { ok: true; value: T } | { ok: false; error: CommandError };
export type CommandError = 'forbidden' | 'bad_state' | 'not_assignee' | 'invalid';

// ── 状态机 ────────────────────────────────────────────────────────────────────

const TRANSITIONS: Record<ChoreState, readonly ChoreState[]> = {
  todo: ['done'],
  done: ['approved', 'todo'],   // 审核通过 → approved;"再来一次" → 退回 todo
  approved: ['paid'],
  paid: [],
};

/** 纯查询:from → to 是否是合法迁移。 */
export function canTransition(from: ChoreState, to: ChoreState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** 已"挣到"(计入账本)的状态 —— approved 或 paid。paid 不从账本里减(减账靠 Payout)。 */
export function isEarnedState(state: ChoreState): boolean {
  return state === 'approved' || state === 'paid';
}

// ── 能力(权限)强制 —— 核心是权威,UI 只是化妆 ────────────────────────────────

export type GuardedAction = 'approve' | 'send_back' | 'record_payout' | 'create_template' | 'assign';

/** 某动作需要的权限判定(纯函数,单一事实源;别在别处散 if role==)。 */
export function memberCan(member: FamilyMember | null | undefined, action: GuardedAction): boolean {
  if (!member) return false; // fail-closed:身份缺失一律拒
  switch (action) {
    case 'approve':
    case 'send_back':
    case 'assign':
    case 'create_template':
      return member.canApprove === true;
    case 'record_payout':
      return member.canRecordPayout === true;
    default:
      return false;
  }
}

// ── 受控命令(全部先过能力门,再过状态机)──────────────────────────────────────

/**
 * 打勾"干完了"。只有本人(assignee)能打自己的勾;爸妈也可代打(canApprove)。
 * 需审核 → done(进待审);不需审核 → 直接 approved(即时记账,见 mockup"counts right away")。
 */
export function markChoreDone(
  instance: ChoreInstance,
  actor: FamilyMember,
  at: string,
): CommandResult<ChoreInstance> {
  if (instance.state !== 'todo') return { ok: false, error: 'bad_state' };
  const isAssignee = actor.id === instance.assigneeId;
  if (!isAssignee && !memberCan(actor, 'approve')) return { ok: false, error: 'not_assignee' };
  if (instance.needsApproval) {
    return { ok: true, value: { ...instance, state: 'done', doneAt: at } };
  }
  // 无需审核:一步到 approved(即时记账),approvedAt 记为完成时刻。
  return { ok: true, value: { ...instance, state: 'approved', doneAt: at, approvedAt: at } };
}

/** 审核通过:需要 canApprove(fail-closed);done → approved。 */
export function approveChore(
  instance: ChoreInstance,
  actor: FamilyMember,
  at: string,
): CommandResult<ChoreInstance> {
  if (!memberCan(actor, 'approve')) return { ok: false, error: 'forbidden' };
  if (!canTransition(instance.state, 'approved')) return { ok: false, error: 'bad_state' };
  return { ok: true, value: { ...instance, state: 'approved', approvedAt: at } };
}

/** "再来一次"(不是"失败"):需要 canApprove;done → todo,清掉 doneAt。 */
export function sendBackChore(
  instance: ChoreInstance,
  actor: FamilyMember,
): CommandResult<ChoreInstance> {
  if (!memberCan(actor, 'send_back')) return { ok: false, error: 'forbidden' };
  if (!canTransition(instance.state, 'todo')) return { ok: false, error: 'bad_state' };
  const next: ChoreInstance = { ...instance, state: 'todo' };
  delete next.doneAt;
  delete next.proofPhotoRef;
  return { ok: true, value: next };
}

/** 记一笔线下付款冲账:需要 canRecordPayout(fail-closed)。金额须为正。 */
export function recordPayout(
  actor: FamilyMember,
  input: { id: string; personId: string; amount: number; date: string; note?: string },
): CommandResult<Payout> {
  if (!memberCan(actor, 'record_payout')) return { ok: false, error: 'forbidden' };
  if (!(input.amount > 0) || !Number.isFinite(input.amount)) return { ok: false, error: 'invalid' };
  return { ok: true, value: { id: input.id, personId: input.personId, amount: input.amount, date: input.date, note: input.note } };
}

// ── 派生账本 —— 笨而精确,纯算术,零 ML ────────────────────────────────────────

export interface LedgerBalance {
  personId: string;
  earned: number;   // Σ(approved/paid 家务 value)
  paidOut: number;  // Σ(payout amount)
  owed: number;     // earned − paidOut(= "现在欠 TA 多少")
}

/**
 * 某成员的账本余额 = Σ(已挣家务 value) − Σ(付款)。纯函数、可对账、幂等:
 * - 同一实例只按 id 计一次(重复审核回传同 id 不会翻倍)。
 * - 顺序无关(先审后付 / 先付后审结果一致)。
 * - 付款把余额减下去(payday 归零)。
 */
export function computeBalance(
  personId: string,
  chores: readonly ChoreInstance[],
  payouts: readonly Payout[],
): LedgerBalance {
  const seen = new Set<string>();
  let earned = 0;
  for (const c of chores) {
    if (c.assigneeId !== personId) continue;
    if (seen.has(c.id)) continue;        // 幂等:同 id 只计一次
    seen.add(c.id);
    if (isEarnedState(c.state)) earned += c.value;
  }
  const paidSeen = new Set<string>();
  let paidOut = 0;
  for (const p of payouts) {
    if (p.personId !== personId) continue;
    if (paidSeen.has(p.id)) continue;
    paidSeen.add(p.id);
    paidOut += p.amount;
  }
  return { personId, earned, paidOut, owed: round2(earned - paidOut) };
}

/** 全家总额(能 approve 的人看)—— 各成员 owed 之和。 */
export function computeFamilyTotal(
  memberIds: readonly string[],
  chores: readonly ChoreInstance[],
  payouts: readonly Payout[],
): number {
  let total = 0;
  for (const id of memberIds) total += computeBalance(id, chores, payouts).owed;
  return round2(total);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── 周期生成 —— 复用"提醒引擎"的心智,但这里是纯函数 ──────────────────────────

/** 某日期(UTC 解析)对应的周几,0=周日..6=周六。入参 YYYY-MM-DD。 */
export function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

/** dateKey + n 天(纯字符串日期算术,UTC 锚点避开 DST)。 */
export function addDays(dateKey: string, n: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 某模板在 [fromKey, toKey] 闭区间内是否该在 dateKey 生成一件。 */
export function cadenceDue(cadence: Cadence, dateKey: string, firstKey: string): boolean {
  switch (cadence.kind) {
    case 'daily': return true;
    case 'weekly': return cadence.weekdays.includes(weekdayOf(dateKey));
    case 'everyDays': {
      const days = Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${firstKey}T00:00:00Z`)) / 86_400_000);
      return days >= 0 && days % Math.max(1, cadence.n) === 0;
    }
    case 'once': return dateKey === firstKey;
    default: return false;
  }
}

/**
 * 在 [fromKey, toKey] 窗口内,为模板生成缺失的家务实例(已存在的按 templateId|dueDate 跳过,
 * 幂等:反复生成不重复)。id 由调用方的确定式工厂给(便于测试与去重);这里不产生随机/时间。
 * 返回**新增**的实例(state=todo)。
 */
export function generateDueInstances(
  template: ChoreTemplate,
  window: { fromKey: string; toKey: string; firstKey?: string },
  existing: readonly ChoreInstance[],
  makeId: (templateId: string, dueDate: string) => string,
): ChoreInstance[] {
  const have = new Set(existing.map((c) => `${c.templateId}|${c.dueDate}`));
  const firstKey = window.firstKey ?? window.fromKey;
  const out: ChoreInstance[] = [];
  let cursor = window.fromKey;
  // 上限保护:窗口最多扫 400 天,防调用方传反区间导致死循环。
  for (let guard = 0; guard < 400 && cursor <= window.toKey; guard++, cursor = addDays(cursor, 1)) {
    if (!cadenceDue(template.cadence, cursor, firstKey)) continue;
    const key = `${template.id}|${cursor}`;
    if (have.has(key)) continue;
    out.push({
      id: makeId(template.id, cursor),
      templateId: template.id,
      assigneeId: template.assigneeId,
      dueDate: cursor,
      value: template.value,
      state: 'todo',
      needsApproval: template.needsApproval,
    });
  }
  return out;
}
