'use client';

/**
 * CalendarCreateSheet — 新建 Google 日程。两种模式:
 *  ① 一句话:自然语言 → 后端 LLM 解析(「周五下午3点约牙医」)
 *  ② 填表单:标题 + 日期 + 时间/全天 + 地点(结构化,精确)
 * 都打 POST /api/portal/calendar,写主日历。异步动作全显式失败态(红线)。
 */

import { useState } from 'react';
import NesioSheet from './ui/NesioSheet';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { createCalendarEvent, localDateTime, type CreatedEvent } from '@/lib/portal/calendar-client';

function todayYmd(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function CalendarCreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [mode, setMode] = useState<'nl' | 'form'>('nl');
  const [text, setText] = useState('');
  const [summary, setSummary] = useState('');
  const [date, setDate] = useState(todayYmd());
  const [allDay, setAllDay] = useState(false);
  const [time, setTime] = useState('09:00');
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');
  const [created, setCreated] = useState<CreatedEvent | null>(null);

  if (!open) return null;

  const t = (zh: string, en: string) => L(dict, zh, en);
  const label: React.CSSProperties = { fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', fontWeight: 'var(--weight-medium)' as unknown as number };
  const input: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: 'var(--space-3)',
    border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)',
    background: 'var(--portal-bg)', color: 'var(--portal-ink)', fontSize: 'var(--text-body)',
    fontFamily: 'var(--font-sans)',
  };

  function reset() {
    setStatus('idle'); setErrMsg(''); setCreated(null);
    setText(''); setSummary(''); setLocation(''); setAllDay(false);
    setDate(todayYmd()); setTime('09:00');
  }

  function close() { reset(); onClose(); }

  async function submit() {
    setStatus('saving'); setErrMsg('');
    const res = mode === 'nl'
      ? await createCalendarEvent({ text: text.trim() })
      : await createCalendarEvent({
          summary: summary.trim(),
          startISO: allDay ? date : localDateTime(date, time),
          allDay,
          location: location.trim() || undefined,
        });
    if (res.ok && res.event) {
      setCreated(res.event); setStatus('ok');
    } else {
      setErrMsg(res.message || t('没能建成日程,稍后再试。', 'Could not create the event. Try again.'));
      setStatus('error');
    }
  }

  const canSubmit = status !== 'saving' && (mode === 'nl' ? text.trim().length > 1 : summary.trim().length > 0);

  return (
    <NesioSheet open={open} onOpenChange={(o) => { if (!o) close(); }} ariaLabel={t('新建日程', 'New event')} variant="bottom">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', padding: 'var(--space-2) 0' }}>
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-h3)', color: 'var(--portal-ink)', fontWeight: 'var(--weight-semibold)' as unknown as number }}>
          {t('新建日程', 'New event')}
        </div>

        {status === 'ok' && created ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ padding: 'var(--space-4)', background: 'var(--status-go-soft)', borderRadius: 'var(--radius-md)', color: 'var(--portal-ink)' }}>
              <div style={{ fontWeight: 'var(--weight-semibold)' as unknown as number, marginBottom: 'var(--space-1)' }}>
                {t('已加到日历 ✓', 'Added to calendar ✓')}
              </div>
              <div style={{ fontSize: 'var(--text-sm)' }}>{created.summary}</div>
            </div>
            {created.htmlLink && (
              <a href={created.htmlLink} target="_blank" rel="noopener noreferrer"
                 style={{ color: 'var(--portal-accent)', fontSize: 'var(--text-sm)', textDecoration: 'none' }}>
                {t('在 Google 日历打开 ↗', 'Open in Google Calendar ↗')}
              </a>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button type="button" onClick={reset} style={{ ...input, width: 'auto', flex: 1, cursor: 'pointer', textAlign: 'center', background: 'var(--portal-accent-soft)', border: '1px solid var(--portal-accent-border)', color: 'var(--portal-accent)' }}>
                {t('再建一个', 'Add another')}
              </button>
              <button type="button" onClick={close} style={{ ...input, width: 'auto', flex: 1, cursor: 'pointer', textAlign: 'center' }}>
                {t('完成', 'Done')}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* 模式切换 */}
            <div style={{ display: 'flex', gap: 'var(--space-1)', background: 'var(--portal-bg)', padding: 'var(--space-1)', borderRadius: 'var(--radius-pill)' }}>
              {(['nl', 'form'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  style={{
                    flex: 1, padding: 'var(--space-2)', border: 'none', cursor: 'pointer',
                    borderRadius: 'var(--radius-pill)', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-sans)',
                    background: mode === m ? 'var(--portal-accent)' : 'transparent',
                    color: mode === m ? '#fff' : 'var(--portal-muted)',
                    fontWeight: 'var(--weight-medium)' as unknown as number,
                  }}>
                  {m === 'nl' ? t('一句话', 'Say it') : t('填表单', 'Form')}
                </button>
              ))}
            </div>

            {mode === 'nl' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <label style={label}>{t('一句话', 'One line')}</label>
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
                  placeholder=""
                  aria-label={t('一句话', 'One line')}
                  style={{ ...input, resize: 'none' }} />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                  <label style={label}>{t('标题', 'Title')}</label>
                  <input value={summary} onChange={(e) => setSummary(e.target.value)}
                    placeholder="" aria-label={t('标题', 'Title')} style={input} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                  <label style={label}>{t('日期', 'Date')}</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={input} />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', color: 'var(--portal-ink)', fontSize: 'var(--text-sm)' }}>
                  <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
                  {t('全天', 'All day')}
                </label>
                {!allDay && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                    <label style={label}>{t('时间', 'Time')}</label>
                    <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={input} />
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                  <label style={label}>{t('地点', 'Location')}</label>
                  <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="" aria-label={t('地点', 'Location')} style={input} />
                </div>
              </div>
            )}

            {status === 'error' && (
              <div style={{ padding: 'var(--space-3)', background: 'var(--status-risk-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--portal-ink)', fontSize: 'var(--text-sm)' }}>
                {errMsg}
              </div>
            )}

            <button type="button" disabled={!canSubmit} onClick={submit}
              style={{
                padding: 'var(--space-3)', border: 'none', borderRadius: 'var(--radius-sm)',
                background: canSubmit ? 'var(--portal-accent)' : 'var(--portal-line)',
                color: '#fff', fontSize: 'var(--text-body)', fontFamily: 'var(--font-sans)',
                fontWeight: 'var(--weight-semibold)' as unknown as number,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}>
              {status === 'saving' ? t('正在加入…', 'Adding…') : t('加入日历', 'Add to calendar')}
            </button>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', textAlign: 'center' }}>
              {t('会写进你的 Google 主日历', 'Saves to your primary Google Calendar')}
            </div>
          </>
        )}
      </div>
    </NesioSheet>
  );
}
