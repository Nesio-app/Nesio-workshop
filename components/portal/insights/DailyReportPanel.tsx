'use client';

/**
 * DailyReportPanel —— 每日日报在洞察页的**唯一入口**(2026-07-30 用户定案:
 * 「今天不要入口,用弹出卡片,在洞察开入口」)。
 *
 * 一段里两件事:
 *   · 顶上是**今天那份**(点开弹出全文);
 *   · 下面是**往日**,最近 14 天,点哪天开哪天。
 * 两者点开的是同一个弹出层 —— 今天和往日在版面上没有区别,那才叫「历史」。
 *
 * 只读,不生成也不重算:
 *   · 日报的定稿与落库只有 useTodayData 一处(08:00 锚点 + 冻结件)。两处都能写的话,
 *     「今天这份到底是谁定的稿」就说不清了;
 *   · 往日显示的是**那天冻结的那一份**,不是拿今天的数据回溯生成的。
 *     回溯的话「我上周二看到的」和「现在翻到的上周二」对不上,那就不是历史了。
 */

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';
import { listDailyReports, readTodayReport, reportDue } from '@/lib/portal/daily-report-persist';
import type { DailyReport } from '@/lib/portal/daily-report';
import { loadProfileSettings } from '@/lib/portal/profile';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { DailyReportOffNotice } from './DailyReportOffNotice';

const DailyReportSheet = dynamic(() => import('../DailyReportSheet'), { ssr: false });

/** 最多往回翻多少天 —— 再往前请去记忆页搜「每日日报」。 */
const MAX_DAYS = 14;

export default function DailyReportPanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [nodes, setNodes] = useState<LifeNode[]>([]);
  const [open, setOpen] = useState<DailyReport | null>(null);

  useEffect(() => {
    const read = () => { try { setNodes(getLifeGraph()); } catch { setNodes([]); } };
    read();
    window.addEventListener('nesio-life-graph-updated', read);
    return () => window.removeEventListener('nesio-life-graph-updated', read);
  }, []);

  const today = useMemo(() => readTodayReport(nodes), [nodes]);
  const past = useMemo(
    () => listDailyReports(nodes).filter((r) => r.date !== today?.date).slice(0, MAX_DAYS),
    [nodes, today?.date],
  );

  const enabled = loadProfileSettings().dailyReportEnabled;
  // 关掉了就显式说明,不是留一块没解释的空地(见 DailyReportOffNotice 的长注释)。
  if (!enabled) return <DailyReportOffNotice />;

  const fmt = (date: string) => {
    // date 是 YYYY-MM-DD(本地日键)。用 T12:00 解析,免得跨时区被推到前一天。
    const d = new Date(`${date}T12:00:00`);
    if (Number.isNaN(d.getTime())) return date;
    return dict === 'en'
      ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' })
      : `${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`;
  };

  /* 今天还没有冻结件时的两种情形,分开说 —— 都不许空着一块地方:
     · 还没到 08:00 → 告诉他几点来;
     · 已过 08:00 却没有 → 今天确实没什么可报的(生成过但判为空,或还没回过今天页)。 */
  const todayRow = today ? (
    <button type="button" className="nesio-drhist-head" onClick={() => setOpen(today)}>
      <span className="nesio-drhist-date">{L(dict, '今天', 'Today')}</span>
      <span className="nesio-drhist-headline">{today.headline}</span>
    </button>
  ) : (
    <p className="nesio-drhist-pending">
      {reportDue(new Date())
        ? L(dict, '今天这份还没出来 —— 回今天页转一圈就会生成。',
                 'Not out yet — open the Today tab once and it will be generated.')
        : L(dict, '早上 8:00 出 —— 到点后它一整天不再变。',
                 'Ready at 8:00 — then it stays put all day.')}
    </p>
  );

  return (
    <div className="nesio-insights-section">
      <p className="nesio-insights-section-label">{L(dict, '每日日报', 'Daily report')}</p>
      <ul className="nesio-drhist-list">
        <li className="nesio-drhist-item">{todayRow}</li>
        {past.map((r) => (
          <li key={r.date} className="nesio-drhist-item">
            <button
              type="button"
              className="nesio-drhist-head"
              // 老节点没有冻结件 → 点开会是个空壳,所以直接禁掉并说明,
              // 不做「点了没反应」的假按钮。
              disabled={!r.report}
              onClick={() => r.report && setOpen(r.report)}
            >
              <span className="nesio-drhist-date">{fmt(r.date)}</span>
              <span className="nesio-drhist-headline">
                {r.report ? r.headline : L(dict, `${r.headline}(这天的版面没存下来)`, `${r.headline} (layout not saved)`)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && <DailyReportSheet report={open} elevated onClose={() => setOpen(null)} />}
    </div>
  );
}
