/**
 * 本地通知 → 打开详情的深链簿记。
 *
 * 当前壳 `NesioLocalNotify.schedule` 不带 userInfo/URL,点通知只能把 App 拉到前台。
 * 这里用「刚响过的那几条」做启发式:回前台后若有一条计划时刻在近几分钟内、且带 memory 深链,
 * 就打开对应记忆详情,并记成已点过(当天不再重排)。
 */
import { notifyIdOf } from './native-local-notifications';
import type { PlannedNotification } from './reminder-notifications';
import { dismissFocusNotification } from './surface-notifications';

const DEEP_LINK_KEY = 'nesio-notify-deep-links-v1';
const OPEN_EVENT = 'nesio-open-notify-target';

export type NotifyDeepLink = {
  key: string;
  kind: 'memory' | 'today';
  id?: string;
  atMs: number;
};

function loadMap(): Record<string, NotifyDeepLink> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = JSON.parse(localStorage.getItem(DEEP_LINK_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw as Record<string, NotifyDeepLink> : {};
  } catch { return {}; }
}

function saveMap(map: Record<string, NotifyDeepLink>): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(DEEP_LINK_KEY, JSON.stringify(map)); } catch { /* quota */ }
}

export function rememberNotifyDeepLinks(planned: readonly PlannedNotification[]): void {
  const map = loadMap();
  const keep = new Set<string>();
  for (const p of planned) {
    if (!p.deepLink) continue;
    const id = String(notifyIdOf(p.key));
    keep.add(id);
    map[id] = { key: p.key, kind: p.deepLink.kind, id: p.deepLink.id, atMs: p.at.getTime() };
  }
  // 清掉已不在计划里的旧链
  for (const k of Object.keys(map)) if (!keep.has(k) && !map[k].key.startsWith('focus:')) {
    // 保留近期 focus 链供回前台启发式
  }
  const cut = Date.now() - 3 * 86_400_000;
  for (const [k, v] of Object.entries(map)) {
    if (v.atMs < cut && !keep.has(k)) delete map[k];
  }
  saveMap(map);
}

/** App 回前台时调用:若刚有一条到期提醒「应该响过」,打开其详情。 */
export function tryOpenRecentNotifyTarget(now = new Date()): boolean {
  if (typeof window === 'undefined') return false;
  const map = loadMap();
  const nowMs = now.getTime();
  // 计划时刻在「过去 15 分钟 ~ 未来 30 秒」内 → 多半是用户刚点了这条通知进来
  let best: NotifyDeepLink | null = null;
  for (const v of Object.values(map)) {
    if (v.kind !== 'memory' || !v.id) continue;
    const delta = nowMs - v.atMs;
    if (delta < -30_000 || delta > 15 * 60_000) continue;
    if (!best || v.atMs > best.atMs) best = v;
  }
  if (!best?.id) return false;
  dismissFocusNotification(best.id);
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { kind: best.kind, id: best.id } }));
  // 用过就清掉,避免反复弹
  for (const [k, v] of Object.entries(map)) {
    if (v.id === best.id && v.key === best.key) delete map[k];
  }
  saveMap(map);
  return true;
}

export const NOTIFY_OPEN_EVENT = OPEN_EVENT;
