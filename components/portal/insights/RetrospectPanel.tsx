'use client';

/**
 * RetrospectPanel —— 洞察「回顾」tab(2026-08-01 用户拍板:洞察拆出回顾/计划两个
 * 新 tab)。每日日报(DailyReportPanel,原样保留,唯一定稿/落库处仍是
 * useTodayData)之外,加两段:本周回顾、本月回顾——都是**只读**,数据来自
 * lib/portal/periodic-report.ts 的自动预生成(同一套「到点未生成才写」口径)。
 */

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';
import { listPeriodicReports } from '@/lib/portal/periodic-report';
import type { DailyReport } from '@/lib/portal/daily-report';
import { loadProfileSettings } from '@/lib/portal/profile';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

const DailyReportPanel = dynamic(() => import('./DailyReportPanel'), { ssr: false });
const DailyReportSheet = dynamic(() => import('../DailyReportSheet'), { ssr: false });

const MAX_LIST = 8;

export function PeriodList({
  label, items, onOpen,
}: {
  label: string;
  items: Array<{ periodKey: string; title: string; headline: string; report: DailyReport | null }>;
  onOpen: (r: DailyReport) => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  if (!items.length) return null;
  return (
    <div className="nesio-insights-section">
      <p className="nesio-insights-section-label">{label}</p>
      <ul className="nesio-drhist-list">
        {items.slice(0, MAX_LIST).map((r) => (
          <li key={r.periodKey} className="nesio-drhist-item">
            <button
              type="button"
              className="nesio-drhist-head"
              disabled={!r.report}
              onClick={() => r.report && onOpen(r.report)}
            >
              <span className="nesio-drhist-date">{r.periodKey}</span>
              <span className="nesio-drhist-headline">
                {r.report ? r.headline : L(dict, `${r.headline}(没存下版面)`, `${r.headline} (layout not saved)`)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function RetrospectPanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [nodes, setNodes] = useState<LifeNode[]>([]);
  const [open, setOpen] = useState<DailyReport | null>(null);

  useEffect(() => {
    const read = () => { try { setNodes(getLifeGraph()); } catch { setNodes([]); } };
    read();
    window.addEventListener('nesio-life-graph-updated', read);
    return () => window.removeEventListener('nesio-life-graph-updated', read);
  }, []);

  const weekly = useMemo(() => listPeriodicReports(nodes, 'week', 'retrospect'), [nodes]);
  const monthly = useMemo(() => listPeriodicReports(nodes, 'month', 'retrospect'), [nodes]);

  const enabled = loadProfileSettings().dailyReportEnabled;
  if (!enabled) return null;

  return (
    <div className="nesio-reflection-tab">
      <DailyReportPanel />
      <PeriodList label={L(dict, '每周回顾', 'Weekly review')} items={weekly} onOpen={setOpen} />
      <PeriodList label={L(dict, '每月回顾', 'Monthly review')} items={monthly} onOpen={setOpen} />
      {open && (
        <DailyReportSheet
          report={open}
          elevated
          onClose={() => setOpen(null)}
          footNote={L(dict, '周一 / 每月 1 日 8:00 定稿 · 这一期不再变', 'Fixed Monday / the 1st at 8:00 · unchanged for this period')}
        />
      )}
    </div>
  );
}
