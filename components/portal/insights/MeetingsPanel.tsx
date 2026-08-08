'use client';

/**
 * MeetingsPanel — 只看会议记录的一处(洞察「会议」tab)。
 * 解决「Granola 同步进来后会议混在一大堆记忆里,找不着、也看不出哪条挂了日程」:
 * 读 tag=meeting-notes 的节点,按日期倒序列出,每条标出挂没挂到对应日历日程(挂哪条),
 * 点一下跳到那条记忆。数据只读 life-graph,随同步/记录事件自动刷新。
 */

import { useEffect, useMemo, useState } from 'react';
import { getLifeGraph } from '@/lib/portal/life-graph';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

interface MeetingRow {
  id: string;
  title: string;
  dateIso: string;
  linkedName: string | null; // 挂到的日历日程名;null=没挂上
  summary: string;
  source: string;
}

function stripPrefix(name: string): string {
  return name.replace(/^(会议记录|Meeting notes)\s*·\s*/, '').trim() || name;
}

export default function MeetingsPanel({ onOpenMemory }: { onOpenMemory: (query: string) => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [rows, setRows] = useState<MeetingRow[]>([]);

  useEffect(() => {
    const load = () => {
      const meetings = getLifeGraph().filter((n) => (n.tags || []).includes('meeting-notes'));
      const mapped: MeetingRow[] = meetings.map((n) => {
        const a = n.attributes || {};
        const linkedId = typeof a.calendarNodeId === 'string' ? a.calendarNodeId : '';
        return {
          id: n.id,
          title: stripPrefix(n.name),
          dateIso: typeof a.recordedAt === 'string' ? a.recordedAt : n.createdAt,
          linkedName: linkedId ? (typeof a.calendarName === 'string' && a.calendarName ? a.calendarName : L(dict, '对应日程', 'calendar event')) : null,
          summary: typeof a.summary === 'string' ? a.summary : (typeof a.notes === 'string' ? a.notes : ''),
          source: (n.tags || []).includes('Granola') ? 'Granola' : L(dict, '录音', 'Recording'),
        };
      }).sort((x, y) => (x.dateIso < y.dateIso ? 1 : x.dateIso > y.dateIso ? -1 : 0));
      setRows(mapped);
    };
    load();
    window.addEventListener('nesio-life-graph-updated', load);
    window.addEventListener('nesio-connectors-refreshed', load);
    return () => {
      window.removeEventListener('nesio-life-graph-updated', load);
      window.removeEventListener('nesio-connectors-refreshed', load);
    };
  }, [dict]);

  const linkedCount = useMemo(() => rows.filter((r) => r.linkedName).length, [rows]);

  const fmtDay = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return dict === 'en'
      ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : `${d.getMonth() + 1}月${d.getDate()}日`;
  };

  if (rows.length === 0) {
    return (
      <p className="nesio-insights-empty">
        {L(dict, '还没有会议记录', 'No meeting notes yet')}
      </p>
    );
  }

  return (
    <div className="nesio-analytics-tab">
      <p className="nesio-settings-option-hint" style={{ marginBottom: 'var(--space-3)' }}>
        {L(dict, `共 ${rows.length} 场 · ${linkedCount} 场已挂到对应日程`, `${rows.length} meetings · ${linkedCount} linked to calendar`)}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onOpenMemory(r.title)}
            style={{
              display: 'block', textAlign: 'left', width: '100%', cursor: 'pointer',
              border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)',
              background: 'var(--glass-bg-solid, var(--portal-bg))', padding: 'var(--space-4)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)' }}>
              <span style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
              <span style={{ flexShrink: 0, fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{fmtDay(r.dateIso)}</span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--text-xs)', padding: '0.1rem 0.5rem', borderRadius: 'var(--radius-pill)', background: 'var(--portal-accent-soft)', color: 'var(--portal-muted)' }}>{r.source}</span>
              {r.linkedName ? (
                <span style={{ fontSize: 'var(--text-xs)', padding: '0.1rem 0.5rem', borderRadius: 'var(--radius-pill)', background: 'var(--status-go-soft)', color: 'var(--status-go)' }}>
                  {L(dict, `已挂日程 · ${r.linkedName}`, `Linked · ${r.linkedName}`)}
                </span>
              ) : (
                <span style={{ fontSize: 'var(--text-xs)', padding: '0.1rem 0.5rem', borderRadius: 'var(--radius-pill)', background: 'var(--status-gentle-soft)', color: 'var(--status-gentle)' }}>
                  {L(dict, '未挂到日程', 'Not linked')}
                </span>
              )}
            </div>
            {r.summary && (
              <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', lineHeight: 1.5 }}>
                {r.summary.replace(/\s+/g, ' ').trim().slice(0, 120)}{r.summary.length > 120 ? '…' : ''}
              </p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
