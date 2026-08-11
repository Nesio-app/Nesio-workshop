'use client';

/**
 * DailyReportSheet —— 每日日报的弹出层(2026-07-30 用户定案:
 * 「今天不要入口,用弹出卡片,在洞察开入口」)。
 *
 * 为什么从 Today 挪走:日报是一份**读物**,不是一张待办卡。Today 那一列每张卡都在
 * 要求你做点什么(拍一下、回一句、划掉),而日报是「坐下来看两分钟」——
 * 混在里面既不像卡片也不像文章,还天天占着最上面那块地方。
 * 收进洞察页当一段,点开弹出全屏读,各归各位。
 *
 * 只渲染,不生成:日报的定稿与落库仍然只有 useTodayData 一处
 * (见 daily-report-persist 的 08:00 锚点 + 冻结件)。这里给什么就画什么 ——
 * 两处都能写的话,今天这份到底是谁定的稿就说不清了。
 */

import type { DailyReport } from '@/lib/portal/daily-report';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import NesioSheet from './ui/NesioSheet';
import {
  IconNote, IconCloudSun, IconCalendar, IconMail, IconBook, IconCheckSquare, IconTrendingUp, IconClock, IconAlertTriangle,
} from './icons';

// 段落图标。Record<DailyReportSectionId, …> 是穷举类型 —— 日报/周报/月报加新段时
// 这里漏一个 tsc 直接红,不会静默渲染成空图标。
const SECTION_ICON: Record<DailyReport['sections'][number]['id'], React.ComponentType<{ size?: number }>> = {
  action: IconCheckSquare,     // 先处理这几件
  calendar: IconCalendar,      // 今日日程 / 计划里的日程
  today: IconCloudSun,         // 今天(天气/穿/吃/练)
  domain: IconTrendingUp,      // 新进展 / 这几面
  ahead: IconClock,            // 往前看(未来两周)
  email: IconMail,
  memory: IconBook,
  completed: IconCheckSquare,  // 回顾:这一期做完的
  tally: IconTrendingUp,       // 回顾:各域被提到几次
  threads: IconBook,           // 计划:还没接上的线头
  conflicts: IconAlertTriangle, // 计划:日历时间冲突
};

export default function DailyReportSheet({
  report, elevated = false, onClose,
  // 日报「早上 8:00 定稿 · 这一天不再变」——周报/月报口径不同,由调用方传自己的说法。
  footNote,
}: {
  report: DailyReport;
  /** 从洞察(fullscreen,z-930)里打开时必须抬层,否则会被整个盖住。 */
  elevated?: boolean;
  onClose: () => void;
  footNote?: string;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());

  return (
    <NesioSheet
      variant="bottom"
      open
      elevated={elevated}
      onOpenChange={(next) => { if (!next) onClose(); }}
      card={false}
      className="nesio-settings-sheet-card"
      ariaLabel={report.title}
    >
      <div className="nesio-brief-head">
        <div>
          <p className="nesio-brief-greeting">
            <span style={{ display: 'inline-flex', verticalAlign: '-3px', marginRight: 'var(--space-2)' }}>
              <IconNote size={16} />
            </span>
            {report.greeting || report.title}
          </p>
          <p className="nesio-brief-date">{report.headline || report.title}</p>
        </div>
        <button type="button" className="nesio-voice-sheet-close" onClick={onClose}
          aria-label={L(dict, '关闭', 'Close')}>✕</button>
      </div>

      <div className="nesio-settings-sheet-body">
        {report.sections.map((s) => {
          const SectionIcon = SECTION_ICON[s.id];
          const items = s.items?.length ? s.items : s.lines.map((text) => ({ text }));
          return (
            <div key={s.id} className={`nesio-drsheet-section nesio-drsheet-section--${s.id}`}>
              <p className="nesio-drsheet-h">
                <span className="nesio-drsheet-h-ico" aria-hidden><SectionIcon size={15} /></span>
                {s.title}
              </p>
              <ul className="nesio-drsheet-ul">
                {items.map((it, i) => (
                  <li key={i} className="nesio-drsheet-item">
                    {it.when ? <span className="nesio-drsheet-when">{it.when}</span> : null}
                    <p className="nesio-drsheet-text">{it.text}</p>
                    {it.notes?.length ? (
                      <ul className="nesio-drsheet-notes">
                        {it.notes.map((n, j) => <li key={j}>{n}</li>)}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        <p className="nesio-drsheet-foot">
          {footNote ?? L(dict, '早上 8:00 定稿 · 这一天不再变', 'Fixed at 8:00 · unchanged for the rest of the day')}
        </p>
      </div>
    </NesioSheet>
  );
}
