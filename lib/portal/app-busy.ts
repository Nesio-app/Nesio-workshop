/**
 * 全局"忙"标记 —— 抑制会打断用户操作的自动行为(尤其部署版本变更时的自动整页刷新)。
 *
 * 场景:用户点"上传健康数据"→ 打开系统文件选择器 → app 退到后台 → 选完文件回到前台,
 * visibilitychange 触发版本检查,恰好赶上新部署 → window.location.reload() 把正在进行的
 * 上传/同步冲掉,页面跳回主页、连接器显示未连接。
 * 打开文件选择器/开始同步前 markBusy(),版本检查在 busy 期间跳过刷新。
 */
let busyUntil = 0;

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
