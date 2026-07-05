'use client';

/**
 * RoutineSheet — 例行提醒管理(批次 19)。
 * 创建:内容 + 时间 + 重复(每天/工作日/自选);列表可开关、删除。
 * 到点后在 Today 出卡(RoutineDueCards);真·锁屏推送等原生壳,不做假通知。
 */

import { useEffect, useState } from 'react';
import { addRoutine, deleteRoutine, loadRoutines, ROUTINES_UPDATED_EVENT, updateRoutine, type Routine, type RoutineCategory } from '@/lib/portal/routines';
import { PROTOCOL_LIBRARY, startProtocol } from '@/lib/platform/training-protocol-engine';
import { InfoTip } from './InfoTip';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

const WEEKDAYS = [1, 2, 3, 4, 5];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const CATS: Array<{ key: RoutineCategory; zh: string; en: string }> = [
  { key: 'general', zh: '自定义', en: 'Custom' },
  { key: 'fitness', zh: '健身', en: 'Fitness' },
  { key: 'chore', zh: '家务', en: 'Chores' },
  { key: 'meds', zh: '吃药', en: 'Meds' },
];
const CAT_LABEL: Record<RoutineCategory, [string, string]> = {
  general: ['自定义', 'Custom'], fitness: ['健身', 'Fitness'], chore: ['家务', 'Chores'], meds: ['吃药', 'Meds'],
};

export default function RoutineSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [text, setText] = useState('');
  const [time, setTime] = useState('09:00');
  const [days, setDays] = useState<number[]>(ALL_DAYS);
  const [category, setCategory] = useState<RoutineCategory>('general');
  const [protocolId, setProtocolId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    const read = () => setRoutines(loadRoutines());
    read();
    window.addEventListener(ROUTINES_UPDATED_EVENT, read);
    return () => window.removeEventListener(ROUTINES_UPDATED_EVENT, read);
  }, [open]);

  if (!open) return null;

  const dayLabel = (d: number) => L(dict, ['日', '一', '二', '三', '四', '五', '六'][d], ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][d]);
  const daysSummary = (r: Routine) => {
    const sorted = [...r.days].sort();
    if (sorted.length === 7) return L(dict, '每天', 'Daily');
    if (sorted.join(',') === WEEKDAYS.join(',')) return L(dict, '工作日', 'Weekdays');
    return sorted.map(dayLabel).join(' ');
  };

  function submit() {
    if (!text.trim() || !time || days.length === 0) return;
    const useProtocol = category === 'fitness' ? protocolId : undefined;
    addRoutine({ text, time, days, category, protocolId: useProtocol });
    // 健身计划:挂了训练计划就让它 active,Today 卡才出「开始练」
    if (useProtocol) startProtocol(useProtocol);
    setText('');
    setProtocolId(undefined);
  }

  return (
    <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label={L(dict, '例行提醒', 'Routines')}>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-settings-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">
            {L(dict, '例行提醒', 'Routines')}
            <InfoTip text={L(dict, '到点后提醒会出现在 Today 首屏,完成或跳过后当天不再出现,次日自动恢复。锁屏推送需要 App Store 原生版,上架后自动升级。', "When due, the reminder appears on Today. Done/skip hides it for the day; it returns tomorrow. Lock-screen push needs the native App Store build and will upgrade automatically once it ships.")} />
          </h2>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
        </div>
        <div className="nesio-settings-sheet-body">

          {/* 新建 */}
          <p className="nesio-settings-section-label">{L(dict, '新建提醒', 'New routine')}</p>
          {/* 批次 25:每日 AI 简报预设(像 Gemini daily brief) */}
          <button
            type="button"
            className="nesio-routine-brief-preset"
            onClick={() => { addRoutine({ text: 'AI 简报', time, days, kind: 'ai_brief' }); }}
          >
            {L(dict, `+ 每日 AI 简报(${time} · 播报当天日程/提醒/天气)`, `+ Daily AI brief (${time} · reads your schedule/reminders/weather)`)}
          </button>

          {/* 批次 45:重复计划分类 —— 自定义/健身/家务/吃药 */}
          <div className="nesio-routine-cat-row">
            {CATS.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`nesio-routine-cat${category === c.key ? ' is-active' : ''}`}
                onClick={() => { setCategory(c.key); if (c.key !== 'fitness') setProtocolId(undefined); }}
              >
                {L(dict, c.zh, c.en)}
              </button>
            ))}
          </div>

          {/* 健身:挂一个训练计划,Today 到点出「开始练」 */}
          {category === 'fitness' && (
            <div className="nesio-routine-plan-pick">
              <p className="nesio-settings-option-hint" style={{ margin: '0 0 0.35rem' }}>{L(dict, '挂一个训练计划(到点在首页出「开始练」)', 'Attach a training plan (Today shows "Start")')}</p>
              {PROTOCOL_LIBRARY.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`nesio-routine-plan-chip${protocolId === p.id ? ' is-active' : ''}`}
                  onClick={() => { setProtocolId(p.id); if (!text.trim()) setText(dict === 'en' ? p.name.en : p.name.zh); }}
                >
                  {L(dict, p.name.zh, p.name.en)}
                </button>
              ))}
            </div>
          )}

          <input
            className="nesio-routine-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={category === 'fitness'
              ? L(dict, '这个健身计划叫什么,如:下肢日', 'Name this workout, e.g. Leg day')
              : category === 'meds'
                ? L(dict, '吃什么药、剂量,如:维生素 D 1 粒', 'Which meds/dose, e.g. Vitamin D ×1')
                : category === 'chore'
                  ? L(dict, '哪件家务,如:倒垃圾、浇花', 'Which chore, e.g. take out trash')
                  : L(dict, '提醒内容,如:喝水、写复盘…', 'What to remind, e.g. drink water…')}
            maxLength={60}
          />
          <div className="nesio-routine-row">
            <input
              type="time"
              className="nesio-routine-time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label={L(dict, '提醒时间', 'Reminder time')}
            />
            <button type="button" className={`nesio-routine-day-preset${days.length === 7 ? ' is-active' : ''}`} onClick={() => setDays(ALL_DAYS)}>{L(dict, '每天', 'Daily')}</button>
            <button type="button" className={`nesio-routine-day-preset${days.join(',') === WEEKDAYS.join(',') ? ' is-active' : ''}`} onClick={() => setDays(WEEKDAYS)}>{L(dict, '工作日', 'Weekdays')}</button>
          </div>
          <div className="nesio-routine-days">
            {ALL_DAYS.map((d) => (
              <button
                key={d}
                type="button"
                className={`nesio-routine-day${days.includes(d) ? ' is-active' : ''}`}
                onClick={() => setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d])}
              >
                {dayLabel(d)}
              </button>
            ))}
          </div>
          <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: '0.5rem' }} onClick={submit} disabled={!text.trim()}>
            {L(dict, '添加', 'Add')}
          </button>

          {/* 列表 */}
          <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>
            {L(dict, `已有提醒(${routines.length})`, `Your routines (${routines.length})`)}
          </p>
          {routines.length === 0 && (
            <p className="nesio-settings-option-hint">{L(dict, '还没有例行提醒。', 'No routines yet.')}</p>
          )}
          {routines.map((r) => (
            <div key={r.id} className="nesio-routine-item">
              <div className="nesio-routine-item-main">
                <p className="nesio-routine-item-text" style={{ opacity: r.enabled ? 1 : 0.45 }}>{r.kind === 'ai_brief' ? L(dict, '每日 AI 简报', 'Daily AI brief') : r.text}</p>
                <p className="nesio-routine-item-meta">
                  {r.category && r.category !== 'general' && (
                    <span className="nesio-routine-cat-tag">{L(dict, CAT_LABEL[r.category][0], CAT_LABEL[r.category][1])}</span>
                  )}
                  {r.time} · {daysSummary(r)}
                </p>
              </div>
              <button
                type="button"
                className={`nesio-settings-toggle-btn${r.enabled ? ' nesio-settings-toggle-btn--on' : ''}`}
                onClick={() => updateRoutine(r.id, { enabled: !r.enabled })}
              >
                {r.enabled ? L(dict, '开', 'On') : L(dict, '关', 'Off')}
              </button>
              <button
                type="button"
                className="nesio-routine-delete"
                aria-label={L(dict, '删除', 'Delete')}
                onClick={() => deleteRoutine(r.id)}
              >✕</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
