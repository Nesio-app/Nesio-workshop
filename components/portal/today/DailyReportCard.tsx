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
import { IconNote, IconCloudSun, IconCalendar, IconMail, IconBook } from '../icons';

const SECTION_ICON: Record<DailyReportSection['id'], React.ComponentType<{ size?: number }>> = {
  weather: IconCloudSun,
  calendar: IconCalendar,
  email: IconMail,
  memory: IconBook,
};

export function DailyReportCard({ report }: { report: DailyReport | null }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [open, setOpen] = useState(false);
  if (!report) return null;

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
              marginTop: '0.5rem', fontSize: '0.74rem', fontWeight: 600,
              padding: '0.28rem 0.7rem', borderRadius: 'var(--radius-sm, 12px)',
              border: '1px solid var(--portal-accent-border)', background: 'transparent',
              color: 'var(--portal-accent)', cursor: 'pointer',
            }}
          >
            {open ? L(dict, '收起', 'Hide') : L(dict, '展开今天', 'Open today')}
          </button>

          {open && (
            <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {report.sections.map((s) => {
                const SectionIcon = SECTION_ICON[s.id];
                return (
                <div key={s.id}>
                  <p style={{ margin: 0, fontSize: '0.76rem', fontWeight: 600, color: 'var(--portal-ink)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <SectionIcon size={15} /> {s.title}
                  </p>
                  <ul style={{ margin: '0.2rem 0 0', paddingLeft: '1.1rem', color: 'var(--portal-muted)', fontSize: '0.76rem', lineHeight: 1.55 }}>
                    {s.lines.map((line, i) => <li key={i}>{line}</li>)}
                  </ul>
                </div>
              );})}
              <p style={{ margin: 0, fontSize: '0.68rem', color: 'var(--portal-muted)' }}>
                {L(dict, '已存进记忆 · 在「记忆」里可回看', 'Saved to memory — revisit it under Memory')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
