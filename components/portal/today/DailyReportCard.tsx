'use client';

/**
 * DailyReportCard —— 每日日报在今天页的**卡片**入口(2026-08-01 用户拍板,
 * 推翻 2026-07-30 的旧定案「今天不要入口,用弹出卡片,在洞察开入口」——
 * 用户这次明确要「形式为每天上午 8 点做成卡片推到今天」;同日追加:去掉左侧
 * 图标,且不要「常驻」——看过全文之后这张卡也该收起,不该在「今天先不看」
 * 之外还有个「已经看过了但还杵在 feed 里」的第三态)。
 *
 * 只读:定稿与落库仍然只有 useTodayData 一处(08:00 锚点 + 冻结件,daily-report-persist)。
 * 这里给什么就画什么。到点之前(还没定稿)不占地方——不给一张空卡片。
 *
 * 和 DailyBriefRow(「今天这一段」,AI 按需生成的聊天式简报)是两个不同功能,
 * 不合并——那个是 Pro 功能、点了才生成;这个是免费确定性引擎、到点自动生成。
 *
 * 图15:壳统一 nesio-proactive-card + Button size=sm(与 Family / 实验打卡同族)。
 */

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { readTodayReport } from '@/lib/portal/daily-report-persist';
import type { DailyReport } from '@/lib/portal/daily-report';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import Button from '../ui/Button';

const DailyReportSheet = dynamic(() => import('../DailyReportSheet'), { ssr: false });

/** 今天不想看了——只压到明天,不是「再也不要」(那个开关在设置里)。 */
const DISMISS_KEY = 'nesio-daily-report-card-dismiss-v1';

/** 只要读得到 readTodayReport 认的那几个字段就够——不强求整份 LifeNode
 *  (调用方手上常常是更窄的投影,比如 TodayFeed 的 FocusNode)。 */
type ReportNode = { name?: string; rawInput?: string; attributes?: Record<string, unknown> };

export function DailyReportCard({ nodes }: { nodes: ReadonlyArray<ReportNode> }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === todayKey(); } catch { return false; }
  });

  const report: DailyReport | null = readTodayReport(nodes);
  if (!report || dismissed) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, todayKey()); } catch { /* 记不住就明天再见一次,不阻断 */ }
    setDismissed(true);
  };

  return (
    <>
      <div className="nesio-proactive-card" role="note">
        <div className="nesio-proactive-card-inner">
          <div className="nesio-proactive-card-text">
            <p className="nesio-proactive-card-title">{report.greeting || report.title}</p>
            <p className="nesio-proactive-card-body">{report.headline}</p>
            <div className="nesio-proactive-card-actions">
              <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
                {L(dict, '看全文', 'Read it')}
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss}>
                {L(dict, '今天先不看', 'Not today')}
              </Button>
            </div>
          </div>
        </div>
      </div>
      {/* 看完全文也算「今天见过了」——收起来,别在 feed 里常驻。 */}
      {open && <DailyReportSheet report={report} onClose={() => { setOpen(false); dismiss(); }} />}
    </>
  );
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default DailyReportCard;
