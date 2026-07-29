/**
 * fetchWithTimeout — 带上限的 fetch。
 *
 * 2026-07-29,用户标注「家务页卡死在加载中…」「车页卡死在正在向车问好…」。
 * 两处的真因是同一个,而且不是 UI 问题:**裸 fetch 没有超时**。
 * 网关半挂 / 上游(Tesla 深度休眠)不回时,浏览器会一直等下去,于是
 * `setLoading(false)` 这行永远执行不到 —— 界面就停在加载态,看起来像卡死。
 *
 * 这个 helper 把「超时 = 一次失败」这件事固定下来:到点主动 abort,
 * 调用方在 catch 里拿到的就是普通的失败,照常渲染显式失败态 + 重试
 * (CLAUDE.md 红线:每个异步动作都必须有看得见的失败态)。
 *
 * 注意 signal 的合并:调用方自己也可能传 signal(例如组件卸载时取消)。
 * 两者任一触发都要中断,所以这里做**两路 abort 合流**,而不是简单覆盖 ——
 * 直接覆盖会悄悄吃掉调用方的取消能力。
 *
 * 契约:scripts/ui-consistency.test.mjs。
 */

/** 默认 15s。经验值:比 Vercel 函数上限略长,足够慢网络完成,又不至于让人以为死机。 */
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const outer = init.signal;
  const onOuterAbort = () => ctrl.abort();
  if (outer) {
    if (outer.aborted) ctrl.abort();
    else outer.addEventListener('abort', onOuterAbort, { once: true });
  }
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}

/** 超时/取消导致的失败?用来给用户一句更准的话,而不是笼统的「网络错误」。 */
export function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
}
