/**
 * API Auth 决策核心(纯函数,供 api-auth.ts 与 node 行为测试共用)。
 *
 * guardAiRoute / isPortalRequestAuthorized / isRateLimited 的实际判定逻辑抽在这里,
 * 让最关键的安全原语能被真行为测试覆盖(此前零运行时测试:钉字符串的契约只能
 * 证明"文件里提到了 guardAiRoute",证明不了它真的放行/拦截/限流)。
 * api-auth.ts 的薄封装只负责从 NextRequest/cookies/env 取值,再委托这里。
 */

/**
 * 授权判定 —— 复刻 isPortalRequestAuthorized 的三重检查:
 *   1) 有会话 cookie;2) Stage-5 密钥匹配;3) 未配 Supabase 的本地部署 + 同源。
 * @param {object} i
 * @param {boolean} i.hasSession       是否带任一会话 cookie
 * @param {string}  i.stage5Secret     env NESIO_STAGE5_INVOCATION_SECRET(已 trim)
 * @param {string}  i.providedStage5   请求头 x-nesio-stage5-secret(已 trim)
 * @param {boolean} i.noSupabase       是否未配置 Supabase(=> 本地/个人部署)
 * @param {boolean} i.allowCrossOrigin 是否放行跨源(Capacitor iOS 壳)
 * @param {string}  i.host             请求 host 头
 * @param {string[]} i.originValues    存在的 origin/referer 头值(已过滤空)
 * @returns {boolean}
 */
export function authorizeDecision(i) {
  if (i.hasSession) return true;
  if (i.stage5Secret && i.providedStage5 === i.stage5Secret) return true;
  // 配了 Supabase 却没会话/密钥 → 拒绝。
  if (!i.noSupabase) return false;
  // 本地部署:UI 本就开放,守卫不能比 UI 更严;但浏览器带 Origin/Referer 时必须同源。
  if (i.allowCrossOrigin) return true;
  for (const value of i.originValues || []) {
    let vhost;
    try { vhost = new URL(value).host; } catch { return false; }
    if (vhost !== i.host) return false;
  }
  return true;
}

/**
 * 达到 key 上限时的内存回收 —— 不再 windows.clear() 清空所有人(那会给攻击者
 * 一个"刷唯一 key 就重置全体限流窗"的杠杆)。改为:
 *   1) 先删已过期条目(本就是死的,删了不影响任何人的有效限流窗);
 *   2) 仍超限 → 按最早 resetAt 增量淘汰最旧的到 ~90%,而不是一次清空。
 */
function evict(windows, now, maxTrackedKeys) {
  for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  if (windows.size < maxTrackedKeys) return;
  const oldestFirst = [...windows.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
  const target = Math.floor(maxTrackedKeys * 0.9);
  for (let i = 0; i < oldestFirst.length && windows.size > target; i++) {
    windows.delete(oldestFirst[i][0]);
  }
}

/**
 * 每实例、每 key 的滑动窗口限流器。now 由调用方注入(便于测试),
 * 复刻 isRateLimited:窗口过期或首次 → 记 1 放行;否则计数 +1,超过 limit 拦截。
 */
export function createRateLimiter({ maxTrackedKeys = 5000 } = {}) {
  const windows = new Map();
  return {
    check(key, now, { limit = 30, windowMs = 60_000 } = {}) {
      const win = windows.get(key);
      if (!win || win.resetAt <= now) {
        if (windows.size >= maxTrackedKeys) evict(windows, now, maxTrackedKeys);
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return false;
      }
      win.count++;
      return win.count > limit;
    },
    size: () => windows.size,
    reset: () => windows.clear(),
  };
}
