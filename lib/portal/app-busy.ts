/**
 * 全局"忙"标记 —— 抑制会打断用户操作的自动行为(尤其部署版本变更时的自动整页刷新)。
 *
 * 场景:用户点"上传健康数据"→ 打开系统文件选择器 → app 退到后台 → 选完文件回到前台,
 * visibilitychange 触发版本检查,恰好赶上新部署 → window.location.reload() 把正在进行的
 * 上传/同步冲掉,页面跳回主页、连接器显示未连接。
 * 打开文件选择器/开始同步前 markBusy(),版本检查在 busy 期间跳过刷新。
 *
 * 另:洞察/家务/跟练等浮层开着时 holdUiOverlay()——否则后台同步/版本检查整页 reload
 * 会把 React 状态打回「今天」,用户正在填的家务/看的车页瞬间没了。
 */
let busyUntil = 0;
let overlayHold = 0;
/** 浮层期间被推迟的整页刷新:浮层全关后再刷一次(拿新代码/水合)。 */
let reloadDeferred = false;

/** 标记接下来一段时间"忙"(默认 2 分钟,够一次文件选择 + 解析)。 */
export function markBusy(ms = 120_000): void {
  busyUntil = Math.max(busyUntil, Date.now() + ms);
}

export function clearBusy(): void {
  busyUntil = 0;
}

export function isBusy(): boolean {
  return Date.now() < busyUntil;
}

/** 洞察/家务/相机等交互浮层开着时调用;可叠加,各自 release。 */
export function holdUiOverlay(): () => void {
  overlayHold += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    overlayHold = Math.max(0, overlayHold - 1);
    if (overlayHold === 0 && reloadDeferred) {
      reloadDeferred = false;
      if (typeof window !== 'undefined' && !shouldDeferDestructiveReload()) {
        try { window.location.reload(); } catch { /* ignore */ }
      }
    }
  };
}

export function isUiOverlayHeld(): boolean {
  return overlayHold > 0;
}

/** 版本检查 / 模块水合 / chunk 治愈 —— 一切会整页 reload 的路径先问这个。 */
export function shouldDeferDestructiveReload(): boolean {
  return isBusy() || overlayHold > 0;
}

/**
 * 需要整页刷新时调用。若当前忙/浮层开着 → 记下,等 release 后再刷;
 * 否则立刻 reload。返回是否**已经**执行了 reload。
 */
export function requestDestructiveReload(): boolean {
  if (typeof window === 'undefined') return false;
  if (shouldDeferDestructiveReload()) {
    reloadDeferred = true;
    return false;
  }
  try {
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}
