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

const DailyReportSheet = dynamic(() => import('../DailyReportSheet'), { ssr: false });

function PlanRow({ kind, report, dict, pendingLabel, dueLabel, onOpen }: {
  kind: PeriodKind;
  report: DailyReport | null;
  dict: 'zh' | 'en';
  pendingLabel: string;
  dueLabel: string;
  onOpen: (r: DailyReport) => void;
}) {
  if (report) {
    return (
      <button type="button" className="nesio-drhist-head" onClick={() => onOpen(report)}>
        <span className="nesio-drhist-date">{kind === 'week' ? L(dict, '下周', 'Next week') : L(dict, '下月', 'Next month')}</span>
        <span className="nesio-drhist-headline">{report.headline}</span>
      </button>
    );
  }
  return (
    <p className="nesio-drhist-pending">
      {periodDue(kind, new Date()) ? pendingLabel : dueLabel}
    </p>
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
  if (!enabled) return null;

  return (
    <div className="nesio-reflection-tab">
      <div className="nesio-insights-section">
        <p className="nesio-insights-section-label">{L(dict, '下周计划', "Next week's plan")}</p>
        <ul className="nesio-drhist-list">
          <li className="nesio-drhist-item">
            <PlanRow
              kind="week" report={weekPlan} dict={dict} onOpen={setOpen}
              pendingLabel={L(dict, '这周还没转一圈生成 —— 回今天页看看就会出来。', "Hasn't generated yet — open Today once and it will.")}
              dueLabel={L(dict, '周一 8:00 出 —— 到点后这一周不再变。', 'Ready Monday 8:00 — then it stays put for the week.')}
            />
          </li>
        </ul>
      </div>
      <div className="nesio-insights-section">
        <p className="nesio-insights-section-label">{L(dict, '下月计划', "Next month's plan")}</p>
        <ul className="nesio-drhist-list">
          <li className="nesio-drhist-item">
            <PlanRow
              kind="month" report={monthPlan} dict={dict} onOpen={setOpen}
              pendingLabel={L(dict, '这个月还没转一圈生成 —— 回今天页看看就会出来。', "Hasn't generated yet — open Today once and it will.")}
              dueLabel={L(dict, '每月 1 日 8:00 出 —— 到点后这个月不再变。', 'Ready the 1st at 8:00 — then it stays put for the month.')}
            />
          </li>
        </ul>
      </div>
      <PeriodList label={L(dict, '以往的周计划', 'Past weekly plans')} items={weekHistory} onOpen={setOpen} />
      <PeriodList label={L(dict, '以往的月计划', 'Past monthly plans')} items={monthHistory} onOpen={setOpen} />
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
