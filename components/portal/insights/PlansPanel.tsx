'use client';

/**
 * PlansPanel —— 洞察「计划」tab(2026-08-01 用户拍板;同日追加:计划也要能
 * 「通过 filter 看往期不同时间段」,不只看当前这一期——过去的计划落库后仍在
 * (persistPeriodicReport 每期都存一条新的),用 listPeriodicReports 翻出来,
 * 和回顾同一套 PeriodList 展示)。
 *
 * 当前这一期(下周/下月)置顶单独展示(用户最关心的是"接下来要发生什么");
 * 往期计划折成「以往的周/月计划」列表,点开看当时定的是什么——是回顾"这周
 * 计划过什么"的唯一入口(回顾本身只记录已发生的事,不记录"当时计划了什么")。
 * 内容口径见 lib/portal/periodic-report.ts 顶部注释:只放已经确定落在窗口内
 * 的日历项/提醒 + 线头,不猜、不编「你可能想做什么」。
 */

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';
import { readCurrentPeriodicReport, listPeriodicReports, periodDue, type PeriodKind } from '@/lib/portal/periodic-report';
import type { DailyReport } from '@/lib/portal/daily-report';
import { loadProfileSettings } from '@/lib/portal/profile';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { PeriodList } from './RetrospectPanel';
import { ReportListItem } from './report-list-item';
import { DailyReportOffNotice } from './DailyReportOffNotice';

const DailyReportSheet = dynamic(() => import('../DailyReportSheet'), { ssr: false });

function PlanRow({ kind, report, dict, nodes, pendingLabel, dueLabel, onOpen }: {
  kind: PeriodKind;
  report: DailyReport | null;
  dict: 'zh' | 'en';
  nodes: LifeNode[];
  pendingLabel: string;
  dueLabel: string;
  onOpen: (r: DailyReport) => void;
}) {
  const listKind = kind === 'week' ? 'week' as const : 'month' as const;
  if (report) {
    return (
      <ReportListItem
        kind={listKind}
        dateLabel={kind === 'week' ? L(dict, '下周', 'Next week') : L(dict, '下月', 'Next month')}
        headline={report.headline}
        nodes={nodes}
        dayKey={report.date}
        onOpen={() => onOpen(report)}
      />
    );
  }
  return (
    <li className={`nesio-drhist-item nesio-drhist-item--${listKind}`}>
      <span className="nesio-drhist-cover" aria-hidden />
      <p className="nesio-drhist-pending">
        {periodDue(kind, new Date()) ? pendingLabel : dueLabel}
      </p>
    </li>
  );
}

export default function PlansPanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [nodes, setNodes] = useState<LifeNode[]>([]);
  const [open, setOpen] = useState<DailyReport | null>(null);

  useEffect(() => {
    const read = () => { try { setNodes(getLifeGraph()); } catch { setNodes([]); } };
    read();
    window.addEventListener('nesio-life-graph-updated', read);
    return () => window.removeEventListener('nesio-life-graph-updated', read);
  }, []);

  const now = useMemo(() => new Date(), [nodes]);
  const weekPlan = useMemo(() => readCurrentPeriodicReport(nodes, 'week', 'plan', now), [nodes, now]);
  const monthPlan = useMemo(() => readCurrentPeriodicReport(nodes, 'month', 'plan', now), [nodes, now]);
  // 往期计划:排除当前这一期(已经在上面单独置顶展示了,列表里不重复出现)。
  const weekHistory = useMemo(
    () => listPeriodicReports(nodes, 'week', 'plan').filter((p) => p.periodKey !== weekPlan?.date),
    [nodes, weekPlan],
  );
  const monthHistory = useMemo(
    () => listPeriodicReports(nodes, 'month', 'plan').filter((p) => p.periodKey !== monthPlan?.date),
    [nodes, monthPlan],
  );

  const enabled = loadProfileSettings().dailyReportEnabled;
  if (!enabled) return <DailyReportOffNotice />;

  return (
    <div className="nesio-reflection-tab">
      <div className="nesio-insights-section">
        <p className="nesio-insights-section-label">{L(dict, '下周计划', "Next week's plan")}</p>
        <ul className="nesio-drhist-list">
          <PlanRow
            kind="week" report={weekPlan} dict={dict} nodes={nodes} onOpen={setOpen}
            pendingLabel={L(dict, '这周还没转一圈生成 —— 回今天页看看就会出来。', "Hasn't generated yet — open Today once and it will.")}
            dueLabel={L(dict, '周日下午 4 点出 —— 到点后这一周不再变。', 'Ready Sunday 4pm — then it stays put for the week.')}
          />
        </ul>
      </div>
      <div className="nesio-insights-section">
        <p className="nesio-insights-section-label">{L(dict, '下月计划', "Next month's plan")}</p>
        <ul className="nesio-drhist-list">
          <PlanRow
            kind="month" report={monthPlan} dict={dict} nodes={nodes} onOpen={setOpen}
            pendingLabel={L(dict, '这个月还没转一圈生成 —— 回今天页看看就会出来。', "Hasn't generated yet — open Today once and it will.")}
            dueLabel={L(dict, '月末最后一天下午 4 点出 —— 到点后这个月不再变。', 'Ready 4pm on the last day of the month — then it stays put for the month.')}
          />
        </ul>
      </div>
      <PeriodList label={L(dict, '以往的周计划', 'Past weekly plans')} kind="week" nodes={nodes} items={weekHistory} onOpen={setOpen} />
      <PeriodList label={L(dict, '以往的月计划', 'Past monthly plans')} kind="month" nodes={nodes} items={monthHistory} onOpen={setOpen} />
      {open && (
        <DailyReportSheet
          report={open}
          elevated
          onClose={() => setOpen(null)}
          footNote={L(dict, '只列已经确定的事,不猜你可能想做什么', 'Only what is already set — no guessing what you might want to do')}
        />
      )}
    </div>
  );
}
