'use client';

/**
 * 每日图文日报卡(块3)——Today「未来预测」区。
 * 前瞻:今天的日程/提醒/天气/记忆,自动预生成(useTodayData 内 gated 触发 + 存记忆)。
 * 本组件只渲染 useTodayData 传来的 report(已受 canUsePrivateData 门:登出时 report=null)。
 * 颜色全用设计 token;温暖教练文案;可折叠展开各节。
 */
import { useState } from 'react';
import type { DailyReport, DailyReportSection } from '@/lib/portal/daily-report';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { IconNote, IconCloudSun, IconCalendar, IconMail, IconBook, IconCheckSquare, IconTrendingUp } from '../icons';

// 2026-07-30 跨面改版:段落从 4 个变 6 个。加新段时这张表必须同步 ——
// Record<DailyReportSectionId, …> 是穷举类型,漏一个 tsc 直接红,不会静默渲染成空图标。
const SECTION_ICON: Record<DailyReportSection['id'], React.ComponentType<{ size?: number }>> = {
  action: IconCheckSquare,     // 先处理这几件
  calendar: IconCalendar,      // 今日日程
  today: IconCloudSun,         // 今天(天气/穿/吃/练)
  domain: IconTrendingUp,      // 这几面有变化
  email: IconMail,
  memory: IconBook,
};

export function DailyReportCard({ report, pending = false }: { report: DailyReport | null; pending?: boolean }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [open, setOpen] = useState(false);

  /* 还没到 08:00 —— 说清楚它几点来,而不是让这块地方空着。
     2026-07-30 用户拍板「早上 8 点定稿、当天不再变」;天没亮时当天的天气/邮件本来
     也没同步全,先出一份再在中午自己改口,正是他要治的那个毛病。 */
  if (!report) {
    if (!pending) return null;
    return (
      <div className="nesio-proactive-card" style={{ borderColor: 'var(--portal-line)' }}>
        <div className="nesio-proactive-card-inner">
          <span className="nesio-proactive-card-icon" aria-hidden><IconNote size={18} /></span>
          <div className="nesio-proactive-card-text">
            <p className="nesio-proactive-card-title">{L(dict, '今日日报', 'Daily report')}</p>
            <p className="nesio-proactive-card-body">
              {L(dict, '早上 8:00 出 —— 到点后它一整天不再变。', 'Ready at 8:00 — then it stays put all day.')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="nesio-proactive-card"
      style={{ borderColor: 'var(--portal-accent-border)', background: 'var(--portal-accent-soft)' }}
    >
      <div className="nesio-proactive-card-inner">
        <span className="nesio-proactive-card-icon" aria-hidden><IconNote size={18} /></span>
        <div className="nesio-proactive-card-text" style={{ width: '100%' }}>
          <p className="nesio-proactive-card-title">{L(dict, '今日日报', 'Daily report')}</p>
          <p className="nesio-proactive-card-body">{report.headline}</p>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            style={{
              marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)',
              padding: 'var(--space-1) var(--space-3)', borderRadius: 'var(--radius-sm, 12px)',
              minHeight: 'var(--tap-min, 44px)',
              border: '1px solid var(--portal-accent-border)', background: 'transparent',
              color: 'var(--portal-accent)', cursor: 'pointer',
            }}
          >
            {open ? L(dict, '收起', 'Hide') : L(dict, '展开今天', 'Open today')}
          </button>

          {open && (
            <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {report.sections.map((s) => {
                const SectionIcon = SECTION_ICON[s.id];
                return (
                <div key={s.id}>
                  <p style={{ margin: 0, fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <SectionIcon size={15} /> {s.title}
                  </p>
                  <ul style={{ margin: 'var(--space-1) 0 0', paddingLeft: 'var(--space-4)', color: 'var(--portal-muted)', fontSize: 'var(--text-xs)', lineHeight: 1.55 }}>
                    {s.lines.map((line, i) => <li key={i}>{line}</li>)}
                  </ul>
                </div>
              );})}
              <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
                {L(dict, '早上 8:00 定稿 · 已存进记忆,洞察页可回看往日',
                        'Fixed at 8:00 · saved to Memory — past days under Insights')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
