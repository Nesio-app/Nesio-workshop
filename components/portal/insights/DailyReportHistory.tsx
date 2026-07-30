'use client';

/**
 * DailyReportHistory —— 往日的每日日报(2026-07-30 用户要「日报历史」)。
 *
 * 日报本来就已经存进记忆了(externalId 幂等,同一天重生成原地更新),而读函数
 * `listDailyReports()` 早就写好、**零 UI 在用** —— 这一段几乎是白捡的。
 *
 * 只读,不重算:列表里显示的是**那天定稿的那一份**,不是拿今天的数据回溯生成的。
 * 回溯生成会让「我上周二看到的日报」和「我现在翻到的上周二」对不上,那就不是历史了。
 */

import { useEffect, useMemo, useState } from 'react';
import { getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';
import { listDailyReports } from '@/lib/portal/daily-report-persist';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

/** 最多往回翻多少天 —— 再往前请去记忆页搜「每日日报」。 */
const MAX_DAYS = 14;

export default function DailyReportHistory() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [nodes, setNodes] = useState<LifeNode[]>([]);
  const [openDate, setOpenDate] = useState<string | null>(null);

  useEffect(() => {
    const read = () => { try { setNodes(getLifeGraph()); } catch { setNodes([]); } };
    read();
    window.addEventListener('nesio-life-graph-updated', read);
    return () => window.removeEventListener('nesio-life-graph-updated', read);
  }, []);

  const rows = useMemo(() => listDailyReports(nodes).slice(0, MAX_DAYS), [nodes]);
  if (!rows.length) return null;

  const fmt = (date: string) => {
    // date 是 YYYY-MM-DD(本地日键)。用 T12:00 解析,免得跨时区被推到前一天。
    const d = new Date(`${date}T12:00:00`);
    if (Number.isNaN(d.getTime())) return date;
    return dict === 'en'
      ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' })
      : `${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`;
  };

  return (
    <div className="nesio-insights-section">
      <p className="nesio-insights-section-label">{L(dict, '往日日报', 'Past days')}</p>
      <ul className="nesio-drhist-list">
        {rows.map((r) => {
          const open = openDate === r.date;
          return (
            <li key={r.date} className="nesio-drhist-item">
              <button
                type="button"
                className="nesio-drhist-head"
                aria-expanded={open}
                onClick={() => setOpenDate(open ? null : r.date)}
              >
                <span className="nesio-drhist-date">{fmt(r.date)}</span>
                <span className="nesio-drhist-headline">{r.headline}</span>
              </button>
              {open && (
                /* 存的是 markdown。这里不引 markdown 渲染器 —— 日报的结构就是
                   「## 标题 / - 条目」两种,自己拆两行比拖一个库诚实。 */
                <div className="nesio-drhist-body">
                  {r.markdown.split('\n').map((line, i) => {
                    const t = line.trim();
                    if (!t || t.startsWith('# ') || t.startsWith('_')) return null;
                    if (t.startsWith('## ')) {
                      return <p key={i} className="nesio-drhist-h">{t.slice(3)}</p>;
                    }
                    if (t.startsWith('- ')) {
                      return <p key={i} className="nesio-drhist-li">{t.slice(2)}</p>;
                    }
                    return <p key={i} className="nesio-drhist-li">{t}</p>;
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
