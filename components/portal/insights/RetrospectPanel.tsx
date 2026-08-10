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
import { DailyReportOffNotice } from './DailyReportOffNotice';
import { ReportListItem, type ReportListKind } from './report-list-item';

const DailyReportPanel = dynamic(() => import('./DailyReportPanel'), { ssr: false });
const DailyReportSheet = dynamic(() => import('../DailyReportSheet'), { ssr: false });

const MAX_LIST = 8;

export function PeriodList({
  label, items, kind, nodes, onOpen,
}: {
  label: string;
  kind: ReportListKind;
  nodes: LifeNode[];
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
          <ReportListItem
            key={r.periodKey}
            kind={kind}
            dateLabel={r.periodKey}
            headline={r.report ? r.headline : L(dict, `${r.headline}(没存下版面)`, `${r.headline} (layout not saved)`)}
            nodes={nodes}
            dayKey={r.report?.date || r.periodKey.slice(0, 10)}
            disabled={!r.report}
            onOpen={() => r.report && onOpen(r.report)}
          />
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
  if (!enabled) return <DailyReportOffNotice />;

  return (
    <div className="nesio-reflection-tab">
      <DailyReportPanel />
      <PeriodList label={L(dict, '每周回顾', 'Weekly review')} kind="week" nodes={nodes} items={weekly} onOpen={setOpen} />
      <PeriodList label={L(dict, '每月回顾', 'Monthly review')} kind="month" nodes={nodes} items={monthly} onOpen={setOpen} />
      {open && (
        <DailyReportSheet
          report={open}
          elevated
          onClose={() => setOpen(null)}
          footNote={L(dict, '周日 / 月末最后一天下午 4 点定稿 · 这一期不再变', 'Fixed Sunday / the last day of the month at 4pm · unchanged for this period')}
        />
      )}
    </div>
  );
}
