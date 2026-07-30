/**
 * session-state —— 「我登录了吗」的**唯一答案**(2026-07-30,bug #21)。
 *
 * 现场:设置 → 数据与隐私,顶上写「已登录 · 云同步已开」,旁边说明气泡里写
 * 「未登录、未授权……登录后才开启跨设备云同步」。同一屏,两个相反的事实。
 *
 * 病根不在文案,在**同一个问题被问了六遍**:
 *   SettingsSheets 两处、ConnectorsHub、NesioProfileCard、PortalOnboarding、
 *   mirror-profile —— 每处各自 `fetch('/api/auth/session')`,各自定义失败怎么办。
 *   而且默认值还不一样:有的初值 `false`(= 直接说「未登录」),有的保持未知。
 *   于是只要有一路请求慢了、抖了一下,屏幕上就会出现两个互相矛盾的状态,
 *   而两边都言之凿凿。
 *
 * 这里定三件事:
 *   ① **三态**:signed-in / signed-out / unknown。「问不出来」不等于「没登录」——
 *      把未知当没登录,就是上面那半句「未登录、未授权」的由来。
 *   ② **一份缓存 + 在途去重**:同一时刻只有一趟请求,所有订阅者拿到同一个答案。
 *   ③ **只有服务器明确说 false 才是 signed-out**;网络错、非 200、解析失败 → 保持
 *      当前已知状态,不倒退成「未登录」。
 *
 * 不碰存储:登录态是服务器说了算的,缓存只活在内存里,刷新页面重新问。
 */

export type SessionState = 'signed-in' | 'signed-out' | 'unknown';

export interface SessionInfo {
  state: SessionState;
  email: string;
}

let current: SessionInfo = { state: 'unknown', email: '' };
let inFlight: Promise<SessionInfo> | null = null;
let fetchedAt = 0;

const listeners = new Set<(s: SessionInfo) => void>();

/** 多久之内不再重复问(毫秒)。够短能跟上登录/登出,够长不让一屏六个组件打六次。 */
export const SESSION_TTL_MS = 30_000;

export function currentSession(): SessionInfo {
  return current;
}

export function subscribeSession(fn: (s: SessionInfo) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function publish(next: SessionInfo): void {
  current = next;
  for (const fn of [...listeners]) {
    try { fn(next); } catch { /* 一个订阅者出错不能拖垮别人 */ }
  }
}

/** 登录/登出之后调一次,强制下一次读取重新问服务器。 */
export function invalidateSession(): void {
  fetchedAt = 0;
  inFlight = null;
}

/**
 * 读一次登录态。同一时刻只发一趟请求;TTL 内直接返回缓存。
 *
 * 失败**不会**把状态推成 signed-out —— 只有服务器明确回 `loggedIn: false` 才算没登录。
 */
export async function readSession(opts: { force?: boolean; now?: number } = {}): Promise<SessionInfo> {
  const now = opts.now ?? Date.now();
  if (opts.force) invalidateSession();
  if (!opts.force && current.state !== 'unknown' && now - fetchedAt < SESSION_TTL_MS) return current;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' });
      if (!res.ok) return current;                       // 非 200 = 问不出来,不是没登录
      const d = await res.json() as { loggedIn?: boolean; user?: { email?: string } } | null;
      if (!d || typeof d.loggedIn !== 'boolean') return current;   // 答非所问,同样不下结论
      const next: SessionInfo = {
        state: d.loggedIn ? 'signed-in' : 'signed-out',
        email: d.user?.email || '',
      };
      fetchedAt = now;
      publish(next);
      return next;
    } catch {
      return current;                                    // 断网 = 问不出来
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
