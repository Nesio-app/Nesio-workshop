'use client';

/**
 * 日报/周报/月报列表行 —— 彩色封面条 + 可选记忆缩略图,避免纯灰字列表。
 */

import { useEffect, useState } from 'react';
import type { LifeNode } from '@/lib/portal/life-graph';

export type ReportListKind = 'daily' | 'week' | 'month';

/** 当天有图的记忆 → 缩略 URL(云签名路径优先;本机 IDB 异步回填)。 */
function pickThumbAsset(nodes: LifeNode[], dayKey: string): { url?: string; assetId?: string } {
  if (!dayKey) return {};
  const dayStart = new Date(`${dayKey.slice(0, 10)}T00:00:00`).getTime();
  if (Number.isNaN(dayStart)) return {};
  const dayEnd = dayStart + 86_400_000;
  for (const n of nodes) {
    const t = new Date(n.createdAt).getTime();
    if (Number.isNaN(t) || t < dayStart || t >= dayEnd) continue;
    for (const a of n.assets || []) {
      if (a.kind !== 'image') continue;
      if (a.storagePath && /^https?:\/\//i.test(a.storagePath)) return { url: a.storagePath };
      if (a.id && a.local) return { assetId: a.id };
    }
  }
  return {};
}

export function ReportListItem({
  kind, dateLabel, headline, nodes, dayKey, disabled, onOpen,
}: {
  kind: ReportListKind;
  dateLabel: string;
  headline: string;
  nodes: LifeNode[];
  /** YYYY-MM-DD 或周期内任一代表日,用来找记忆图 */
  dayKey?: string;
  disabled?: boolean;
  onOpen: () => void;
}) {
  const picked = pickThumbAsset(nodes, dayKey || '');
  const [thumb, setThumb] = useState<string | null>(picked.url || null);

  useEffect(() => {
    if (picked.url) { setThumb(picked.url); return; }
    if (!picked.assetId) { setThumb(null); return; }
    let cancelled = false;
    void import('@/lib/portal/local-image-store').then(({ getLocalImage }) =>
      getLocalImage(picked.assetId!).then((url) => {
        if (!cancelled && url) setThumb(url);
      }),
    ).catch(() => { /* 无图就算了 */ });
    return () => { cancelled = true; };
  }, [picked.url, picked.assetId]);

  return (
    <li className={`nesio-drhist-item nesio-drhist-item--${kind}`}>
      <span className="nesio-drhist-cover" aria-hidden />
      <button type="button" className="nesio-drhist-head" disabled={disabled} onClick={onOpen}>
        <span className="nesio-drhist-row">
          {thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="nesio-drhist-thumb" draggable={false} />
          )}
          <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
            <span className="nesio-drhist-date">{dateLabel}</span>
            <span className="nesio-drhist-headline">{headline}</span>
          </span>
        </span>
      </button>
    </li>
  );
}
