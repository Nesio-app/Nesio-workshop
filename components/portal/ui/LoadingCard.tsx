'use client';

/**
 * LoadingCard — 统一的「正在加载」卡片(2026-07-29,用户标注:家务页卡在「加载中…」、
 * 车页卡在「正在向车问好…」,而且都是**裸文字、无卡片、无动效**)。
 *
 * 两件事在这里一起解决:
 *   ① 观感:等待态和站内其他内容一样是圆角卡片 + 骨架条呼吸(portal-shimmer),
 *      而不是一行孤零零的灰字 —— 一行灰字看不出「在动」,所以像卡死。
 *   ② 兜底:`timeoutMs` 到了还没结果,就把这块交给调用方渲染失败态。
 *      光有动效不够 —— 真正让人以为卡死的是「fetch 没有超时」:
 *      网关不回 / 车在深度休眠时,浏览器的 fetch 会一直挂着,
 *      加载态就永远停在那儿。超时必须在数据层(见 AbortSignal.timeout)+ 这里双保险。
 */
import { useEffect } from 'react';

export default function LoadingCard({
  label, lines = 2, timeoutMs, onTimeout,
}: {
  label: string;
  /** 骨架条数量,按内容体量给 1~4 条 */
  lines?: number;
  /** 超过这个时长仍在加载 → 调 onTimeout(调用方切失败态)。不传则不看时间。 */
  timeoutMs?: number;
  onTimeout?: () => void;
}) {
  useEffect(() => {
    if (!timeoutMs) return;
    const id = window.setTimeout(() => { onTimeout?.(); }, timeoutMs);
    return () => window.clearTimeout(id);
    // onTimeout 常是内联箭头,放进依赖会每次渲染重置计时器 —— 那样永远不会触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeoutMs]);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--portal-line)',
        background: 'var(--portal-accent-soft)',
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
    >
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>
        {label}
      </span>
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className="nesio-skeleton-bar"
          style={{ width: i === lines - 1 ? '58%' : '100%' }}
        />
      ))}
    </div>
  );
}
