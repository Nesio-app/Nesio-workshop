/**
 * hub-order — 洞察宫格的自定义顺序(2026-07-28,用户标注 图6:「可以调整按钮顺序」)。
 *
 * 存的是**一串 key**,不是整张宫格。这点很关键:宫格里的格子会变
 * (功能开关关掉一个、以后加一个新模块),如果把整张表存下来,那些变化就再也进不来。
 * 所以存顺序、渲染时合并:
 *   · 存过的 key 按存的顺序排在前面;
 *   · 存的时候还不存在的新格子,自动接在后面(不会因为「没在我的顺序里」而消失);
 *   · 已经不存在的 key 自动丢掉(功能关了/模块删了,不留空位)。
 *
 * 上半段是纯函数,可直接单测;只有下半段碰 localStorage。
 * 契约测试:scripts/hub-order.test.mjs。
 */

/**
 * 把用户存的顺序套到当前实际存在的格子上。
 *
 * @param present 当前这一刻真实可见的格子 key(已经过功能开关过滤)
 * @param saved   用户存过的顺序(可能含已消失的 key,也可能缺新格子)
 */
export function applyHubOrder(present: readonly string[], saved: readonly string[]): string[] {
  const alive = new Set(present);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of saved) {
    if (!alive.has(k) || seen.has(k)) continue;   // 已消失的 / 重复的,丢掉
    seen.add(k);
    out.push(k);
  }
  for (const k of present) {
    if (seen.has(k)) continue;                    // 新格子接在后面
    seen.add(k);
    out.push(k);
  }
  return out;
}

/**
 * 把 from 位置的格子挪到 to 位置(拖拽落点)。返回新数组,不改入参。
 * 越界的下标一律当作不动 —— 拖到列表外不该把东西弄丢。
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const n = list.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ── 存储(只有下面这段碰 localStorage)────────────────────────────────────────

const KEY = 'nesio-hub-order-v1';
export const HUB_ORDER_UPDATED = 'nesio-hub-order-updated';

export function loadHubOrder(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

/** 写不进去返回 false —— 调用方必须显式告诉用户,不许静默吞(CLAUDE.md 红线)。 */
export function saveHubOrder(order: readonly string[]): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(order));
    window.dispatchEvent(new CustomEvent(HUB_ORDER_UPDATED));
    return true;
  } catch {
    return false;
  }
}

/** 恢复默认顺序(把存的清掉)。 */
export function resetHubOrder(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent(HUB_ORDER_UPDATED));
    return true;
  } catch {
    return false;
  }
}
