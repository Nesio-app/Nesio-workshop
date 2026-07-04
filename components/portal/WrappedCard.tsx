'use client';

/**
 * 季度 Wrapped 卡片 — 每 90 天自动推送生命回顾
 * 规则引擎生成叙事，不依赖 LLM。
 */

import { useEffect, useState } from 'react';
import { getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';
import { countByDomain } from '@/lib/portal/domain-stats';
import { DOMAINS as DOMAIN_META } from '@/lib/life-domain/domain-taxonomy';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

const STORAGE_KEY = 'nesio-wrapped-last';
const INTERVAL_DAYS = 90;

interface WrappedData {
  quarterLabel: string;          // e.g. "2026 Q2"
  totalNodes: number;
  dominantDomain: string;
  dominantEmoji: string;
  topNodeName: string;
  narrativeLine: string;
  domainBreakdown: Array<{ label: string; emoji: string; count: number }>;
}

function getQuarterLabel(date: Date): string {
  const q = Math.floor(date.getMonth() / 3) + 1;
  return `${date.getFullYear()} Q${q}`;
}

function buildWrappedData(nodes: LifeNode[], quarterStart: Date, quarterEnd: Date, dict: string = 'zh'): WrappedData {
  const quarterNodes = nodes.filter((n) => {
    const d = new Date(n.createdAt);
    return d >= quarterStart && d <= quarterEnd;
  });

  const label = getQuarterLabel(quarterStart);
  const total = quarterNodes.length;

  // Canonical domain taxonomy (nodeDomain + DOMAINS) via shared aggregation
  const localizedDomainLabel = (d: { domain: keyof typeof DOMAIN_META; label: string }) =>
    L(dict, d.label, DOMAIN_META[d.domain]?.labelEn ?? d.label);
  const domainCounts = countByDomain(quarterNodes);
  const dominant = domainCounts[0] ? localizedDomainLabel(domainCounts[0]) : L(dict, '生活', 'Life');
  const dominantEmoji = domainCounts[0]?.icon ?? '✨';

  // Top node: most-tagged or highest confidence
  const topNode = quarterNodes
    .slice()
    .sort((a, b) => (b.tags?.length ?? 0) - (a.tags?.length ?? 0) || b.confidence - a.confidence)[0];

  const topNodeName = topNode?.name ?? L(dict, '一段珍贵的时光', 'a treasured stretch of time');

  // Generate narrative
  const sorted = domainCounts.map((d): [string, number] => [localizedDomainLabel(d), d.count]);
  const narrative = generateNarrative(label, total, dominant, topNodeName, sorted, dict);

  const breakdown = domainCounts
    .map((d) => ({ label: localizedDomainLabel(d), emoji: d.icon, count: d.count }))
    .slice(0, 4);

  return {
    quarterLabel: label,
    totalNodes: total,
    dominantDomain: dominant,
    dominantEmoji,
    topNodeName,
    narrativeLine: narrative,
    domainBreakdown: breakdown,
  };
}

function generateNarrative(
  quarter: string,
  total: number,
  dominant: string,
  topNode: string,
  sorted: [string, number][],
  dict: string = 'zh',
): string {
  const second = sorted[1]?.[0];
  const shift = second ? L(dict, `，同时在${second}上也有积累`, `, with steady gains in ${second} too`) : '';

  if (total === 0) {
    return L(dict, `${quarter}，你开始记录自己的生命轨迹。`, `${quarter} — you started recording your life's trail.`);
  }
  if (total < 5) {
    return L(dict, `${quarter}，你留下了 ${total} 条记忆，「${topNode}」是这段时间最深的印记。`, `${quarter} — you left ${total} memories; "${topNode}" marked this stretch the deepest.`);
  }

  const templates = [
    L(dict, `${quarter}，你的生命重心落在了${dominant}${shift}。「${topNode}」留下了深刻印记。`, `${quarter} — your center of gravity was ${dominant}${shift}. "${topNode}" left a deep mark.`),
    L(dict, `这个季度你记录了 ${total} 件事，大多关于${dominant}。「${topNode}」是其中最鲜活的一章。`, `You recorded ${total} things this quarter, mostly about ${dominant}. "${topNode}" was the most vivid chapter.`),
    L(dict, `${quarter}：${dominant}${shift}。每一条记录都是在告诉未来的自己——那段时光存在过。`, `${quarter}: ${dominant}${shift}. Every record tells your future self — that time really happened.`),
  ];

  return templates[total % templates.length];
}

function getQuarterRange(date: Date): { start: Date; end: Date } {
  const q = Math.floor(date.getMonth() / 3);
  const start = new Date(date.getFullYear(), q * 3, 1);
  const end = new Date(date.getFullYear(), q * 3 + 3, 0, 23, 59, 59);
  return { start, end };
}

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  onDismiss: () => void;
}

export function useWrappedTrigger(): { shouldShow: boolean; dismiss: () => void } {
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    try {
      const lastRaw = localStorage.getItem(STORAGE_KEY);
      if (!lastRaw) {
        // First time — don't show immediately, just record now
        localStorage.setItem(STORAGE_KEY, new Date().toISOString());
        return;
      }
      const lastDate = new Date(lastRaw);
      const daysSince = (Date.now() - lastDate.getTime()) / 86_400_000;
      if (daysSince >= INTERVAL_DAYS) {
        setShouldShow(true);
      }
    } catch {
      // localStorage not available
    }
  }, []);

  const dismiss = () => {
    setShouldShow(false);
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch { /* ignore */ }
  };

  return { shouldShow, dismiss };
}

export default function WrappedCard({ onDismiss }: Props) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [data, setData] = useState<WrappedData | null>(null);

  useEffect(() => {
    const nodes = getLifeGraph();
    const now = new Date();
    // Show the PREVIOUS quarter's wrap
    const prevQuarterEnd = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 0, 23, 59, 59);
    const { start, end } = getQuarterRange(prevQuarterEnd);
    const built = buildWrappedData(nodes, start, end, dict);
    setData(built);
  }, [dict]);

  if (!data) return null;

  return (
    <div className="wrapped-card">
      <button type="button" className="wrapped-card-close" onClick={onDismiss} aria-label="关闭">✕</button>

      <div className="wrapped-card-header">
        <span className="wrapped-card-season">{data.dominantEmoji}</span>
        <div>
          <p className="wrapped-card-quarter">{data.quarterLabel} 回顾</p>
          <p className="wrapped-card-count">{data.totalNodes} 条记忆</p>
        </div>
      </div>

      <p className="wrapped-card-narrative">{data.narrativeLine}</p>

      {data.domainBreakdown.length > 0 && (
        <div className="wrapped-card-domains">
          {data.domainBreakdown.map((d) => (
            <div key={d.label} className="wrapped-card-domain">
              <span className="wrapped-card-domain-emoji">{d.emoji}</span>
              <span className="wrapped-card-domain-label">{d.label}</span>
              <span className="wrapped-card-domain-count">{d.count}</span>
            </div>
          ))}
        </div>
      )}

      <p className="wrapped-card-footer">每段时光都值得被记录 · Nesio</p>
    </div>
  );
}
