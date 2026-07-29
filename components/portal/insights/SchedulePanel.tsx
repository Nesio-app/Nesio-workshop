'use client';

/**
 * SchedulePanel — 洞察「日程」tab(原「会议」扩展)。两个子 tab:
 *   ① 日历项:所有日历日程(source=calendar)+ 未挂到日历的独立会议记录(meeting-notes),
 *      按时间排;挂了会议记录的日程标「有记录」,点进对应记忆。保留原会议记录闭环。
 *   ② 邮件:source=email 的节点(广告在 gmail 抽取阶段已排除 —— CATEGORY_PROMOTIONS 不进 AI);
 *      这里再加一层关键词兜底,过滤明显促销。
 * 只读 life-graph,点条目跳记忆页搜索。随同步/记录事件自动刷新。
 */

import { useEffect, useMemo, useState } from 'react';
import { getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

type SubTab = 'calendar' | 'email';

interface Row {
  id: string;
  title: string;
  dateIso: string;
  meta: string;       // 副行(地点/来源/收件人等)
  badge?: string;     // 「有记录」/「会议记录」
  query: string;      // 点进记忆搜什么
}

const AD_RE = /退订|unsubscribe|优惠|促销|限时|折扣|秒杀|大促|% ?off|sale\b|coupon|deal[s]?\b/i;

function stripPrefix(name: string): string {
  return name.replace(/^(会议记录|Meeting notes)\s*·\s*/, '').trim() || name;
}

export default function SchedulePanel({ onOpenMemory, onOpenNode }: {
  onOpenMemory: (query: string) => void;
  /** 直接打开这条记录的详情。r.id 就是真实节点 id —— 此前一律走关键词搜索,
   *  而邮件/日历标题拿去全库搜多半零命中,点了像没反应(QA 死按钮)。 */
  onOpenNode?: (nodeId: string) => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [sub, setSub] = useState<SubTab>('calendar');
  const [nodes, setNodes] = useState<LifeNode[]>([]);

  useEffect(() => {
    const load = () => { try { setNodes(getLifeGraph()); } catch { setNodes([]); } };
    load();
    window.addEventListener('nesio-life-graph-updated', load);
    window.addEventListener('nesio-connectors-refreshed', load);
    window.addEventListener('nesio-calendar-updated', load);
    return () => {
      window.removeEventListener('nesio-life-graph-updated', load);
      window.removeEventListener('nesio-connectors-refreshed', load);
      window.removeEventListener('nesio-calendar-updated', load);
    };
  }, []);

  const calendarRows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const n of nodes) {
      const a = n.attributes || {};
      if (n.source === 'calendar') {
        const start = typeof a.start === 'string' ? a.start : n.createdAt;
        out.push({
          id: n.id,
          title: n.name,
          dateIso: start,
          meta: typeof a.location === 'string' && a.location ? a.location : (typeof a.calendarName === 'string' ? a.calendarName : ''),
          badge: a.meetingRecordId ? L(dict, '有记录', 'notes') : undefined,
          query: n.name,
        });
      } else if ((n.tags || []).includes('meeting-notes') && !a.calendarNodeId) {
        // 未挂到日历的独立会议记录(Granola/录音)也留在日程里
        out.push({
          id: n.id,
          title: stripPrefix(n.name),
          dateIso: typeof a.recordedAt === 'string' ? a.recordedAt : n.createdAt,
          meta: (n.tags || []).includes('Granola') ? 'Granola' : L(dict, '录音', 'Recording'),
          badge: L(dict, '会议记录', 'meeting'),
          query: stripPrefix(n.name),
        });
      }
    }
    return out.sort((x, y) => (x.dateIso < y.dateIso ? 1 : x.dateIso > y.dateIso ? -1 : 0));
  }, [nodes, dict]);

  const emailRows = useMemo<Row[]>(() => {
    return nodes
      .filter((n) => n.source === 'email')
      .filter((n) => !AD_RE.test(n.name) && !AD_RE.test(typeof n.rawInput === 'string' ? n.rawInput : ''))
      .map((n) => {
        const a = n.attributes || {};
        return {
          id: n.id,
          title: n.name,
          dateIso: typeof a.date === 'string' ? a.date : n.createdAt,
          meta: typeof a.from === 'string' ? a.from : (typeof a.sender === 'string' ? a.sender : ''),
          query: n.name,
        } as Row;
      })
      .sort((x, y) => (x.dateIso < y.dateIso ? 1 : x.dateIso > y.dateIso ? -1 : 0));
  }, [nodes]);

  const rows = sub === 'calendar' ? calendarRows : emailRows;

  const fmtDay = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return dict === 'en'
      ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : `${d.getMonth() + 1}月${d.getDate()}日`;
  };

  const chip = (id: SubTab, label: string) => (
    <button type="button"
      className={`nesio-settings-option${sub === id ? ' nesio-settings-option--active' : ''}`}
      style={{ flex: 1, justifyContent: 'center' }}
      onClick={() => setSub(id)}>
      <span className="nesio-settings-option-label">{label}</span>
    </button>
  );

  return (
    <div className="nesio-analytics-tab">
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: 'var(--space-3)' }}>
        {chip('calendar', L(dict, `日历项 ${calendarRows.length}`, `Calendar ${calendarRows.length}`))}
        {chip('email', L(dict, `邮件 ${emailRows.length}`, `Mail ${emailRows.length}`))}
      </div>

      {rows.length === 0 ? (
        <p className="nesio-insights-empty">
          {sub === 'calendar'
            ? L(dict, '还没有日程 —— 到「设置 → 数据接入」连 Google 日历,或连 Granola 同步会议。', 'No schedule yet — connect Google Calendar or Granola in Data sources.')
            : L(dict, '还没有邮件 —— 到「设置 → 数据接入」连 Gmail 同步(广告已自动过滤)。', 'No mail yet — connect Gmail in Data sources (ads auto-filtered).')}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {rows.slice(0, 60).map((r) => (
            <button key={r.id} type="button" onClick={() => (onOpenNode ? onOpenNode(r.id) : onOpenMemory(r.query))}
              style={{ display: 'block', textAlign: 'left', width: '100%', cursor: 'pointer', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)', background: 'var(--glass-bg-solid, var(--portal-bg))', padding: 'var(--space-3) var(--space-4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)' }}>
                <span style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                <span style={{ flexShrink: 0, fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{fmtDay(r.dateIso)}</span>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '0.2rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {r.meta && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{r.meta}</span>}
                {r.badge && (
                  <span style={{ fontSize: 'var(--text-xs)', padding: '0.05rem 0.45rem', borderRadius: 'var(--radius-pill)', background: 'var(--status-go-soft)', color: 'var(--status-go)' }}>{r.badge}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
