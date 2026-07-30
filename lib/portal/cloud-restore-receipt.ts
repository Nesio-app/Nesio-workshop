/**
 * cloud-restore-receipt —— 「云端往本机填过什么」的回执。
 *
 * 由来(QA 第 3 条):积分从 0 无缘无故跳到 150。查证不是 bug —— 是模块同步把另一台
 * 设备的进度填了回来(按设计如此)。但**数据被悄悄改变而用户不知道,本身就是问题**:
 * 用户唯一能得出的结论是「这 App 会自己乱改我的数」,信任就是这么掉的。
 *
 * 这里只做纯记录:填了哪些模块、什么时候。读取即清(takeReceipt),由界面负责说一句。
 * 不碰网络。
 */

const KEY = 'nesio-cloud-restore-receipt-v1';

/** 用户认得出的模块名;不在表里的 key 不值得打扰用户(内部状态/水位)。 */
const NOTABLE: Record<string, [string, string]> = {
  'nesio-rewards-v1': ['积分', 'Points'],
  'nesio-workouts-v1': ['我的训练', 'My workouts'],
  'nesio-workout-history-v1': ['训练打卡', 'Workout log'],
  'nesio-expenses-v1': ['手动记账', 'Manual entries'],
  'nesio-fin-assets-v1': ['手动资产', 'Manual assets'],
  'nesio-inventory-v1': ['物品', 'Items'],
  'nesio-place-trail-v1': ['地点足迹', 'Place trail'],
  'nesio-health-v1': ['健康指标', 'Health metrics'],
  'nesio-wardrobe-v1': ['衣橱', 'Wardrobe'],
  'nesio-routines-v1': ['例行提醒', 'Routines'],
};

export interface RestoreReceipt {
  at: string;
  labels: Array<[string, string]>;
}

/** 从填充的 key 列表里挑出用户认得的,记一条回执。没有可说的就不写。 */
export function recordCloudRestore(filledKeys: readonly string[], now = new Date()): void {
  if (typeof window === 'undefined') return;
  const labels = filledKeys.map((k) => NOTABLE[k]).filter(Boolean) as Array<[string, string]>;
  if (!labels.length) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ at: now.toISOString(), labels } satisfies RestoreReceipt));
  } catch { /* 回执丢了不影响数据本身,不上报 */ }
}

/** 读并清除(一次性告知,不反复打扰)。 */
export function takeCloudRestoreReceipt(): RestoreReceipt | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    const v = JSON.parse(raw) as RestoreReceipt;
    return Array.isArray(v?.labels) && v.labels.length ? v : null;
  } catch { return null; }
}

/** 一句人话(warm-coach:说明发生了什么与来源,不用感叹号,不制造惊吓)。 */
export function restoreReceiptText(r: RestoreReceipt, dict: string): string {
  const zh = dict !== 'en';
  const names = r.labels.map((l) => (zh ? l[0] : l[1])).join(zh ? '、' : ', ');
  return zh
    ? `${names} 是从你账号里恢复到这台设备的 —— 不是本机新产生的。`
    : `${names} were restored to this device from your account — not created here.`;
}
