/**
 * sync-suspend — 全局「暂停云同步」闸门 + 空闲调度。
 *
 * 背景(真机「跟练卡死」根因):云同步的 gzip / JSON.stringify|parse / base64 / contentHash 全在**主线程**
 * 同步执行。全数据上云后本机 blob 变大(健康/财务/GPS 足迹/书籍),单个 gzip 或逐字符 hash 就能把主线程
 * 卡住数秒(yield 只能加在调用**之间**,单个大调用无法切分)。而同步批次会在**每次回到前台**
 * (visibilitychange→visible)整批重跑,跟练是盖在 Portal 上的浮层、这个监听一直活着 → 跟练中一锁屏/切换/
 * 来通知再回来点「跟拍做」,整批 gzip 就在那一帧跑,界面冻死。
 *
 * 对策(本模块):
 *  1) 计数式暂停:跟练等交互式全屏场景开着时 suspendCloudSync(),重同步一律跳过;退出时 release()。
 *     归零时派发 resume 事件,让 Portal 补跑一次(此时用户已离开交互场景,卡一下也无所谓)。
 *  2) whenIdle:同步批次永不在「挂载/回前台」那一帧同步跑,统一推到浏览器空闲时,避免抢正在用的界面。
 */

export const SYNC_RESUME_EVENT = 'nesio-sync-resume';

let suspendCount = 0;

/** 当前是否应暂停重云同步(跟练等交互式全屏开着时为 true)。 */
export function isCloudSyncSuspended(): boolean {
  return suspendCount > 0;
}

/**
 * 暂停重云同步。返回 release():调用即解除本次暂停。可叠加(多处 suspend 需各自 release)。
 * 归零时派发 SYNC_RESUME_EVENT,Portal 收到后补跑一次同步。
 */
export function suspendCloudSync(): () => void {
  suspendCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    suspendCount = Math.max(0, suspendCount - 1);
    if (suspendCount === 0 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(SYNC_RESUME_EVENT));
    }
  };
}

/**
 * 把 fn 推到浏览器空闲时执行(有 requestIdleCallback 用它、带 3s 兜底超时;没有则 setTimeout 1.2s)。
 * 关键:让重同步永不落在用户正在交互的那一帧上。
 */
export function whenIdle(fn: () => void): void {
  if (typeof window === 'undefined') { return; }
  const ric = (window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (typeof ric === 'function') { ric(() => fn(), { timeout: 3000 }); }
  else { setTimeout(fn, 1200); }
}
