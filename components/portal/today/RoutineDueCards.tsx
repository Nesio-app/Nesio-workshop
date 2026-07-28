'use client';

/**
 * RoutineDueCards — 到点的例行提醒在 Today 出卡(批次 19)。
 * 每分钟检查一次;完成/今天跳过后当天不再出现,次日自动复活。
 */

import { useEffect, useState } from 'react';
import { dueRoutines, markRoutineDone, ROUTINES_UPDATED_EVENT, type Routine } from '@/lib/portal/routines';
import { protocolById, toRunSteps, loadTrainingState } from '@/lib/platform/training-protocol-engine';
import { pickPhaseIndex, pickTodaySessionIndex } from '@/lib/platform/fitness-home-core';
import { IconClock } from '../icons';
import { track } from '@/lib/portal/telemetry';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { canUse } from '@/lib/portal/entitlement';

export function RoutineDueCards() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [due, setDue] = useState<Routine[]>([]);

  useEffect(() => {
    // 批次 175:健身链先不做 —— 健身 routine 卡一律不出(老健身例行静默隐藏,数据保留不删)。
    const read = () => setDue(dueRoutines().filter((r) => r.category !== 'fitness'));
    read();
    const timer = setInterval(read, 60_000);
    window.addEventListener(ROUTINES_UPDATED_EVENT, read);
    return () => { clearInterval(timer); window.removeEventListener(ROUTINES_UPDATED_EVENT, read); };
  }, []);

  // 健身「开始练」→ 有训练计划就直接进跟练播放器,否则打开洞察健康 tab
  function startTraining(r: Routine) {
    const st = loadTrainingState();
    const p = (r.protocolId && protocolById(r.protocolId)) || (st.activeProtocolId ? protocolById(st.activeProtocolId) : undefined);
    if (p) {
      // 「今天练哪个」必须和健身首页给出同一个答案 —— 共用 fitness-home-core 的选法
      // (当前阶段 + 跳过本周已练的)。以前这里是 sessions[本周次数 % 总数] 的纯轮转,
      // 而且永远取 phases[0],用户在健身页看到「下肢 A」,回这里点开始练却进了别的。
      const today = new Date();
      const phase = p.phases[pickPhaseIndex(p.phases, st.startedAt, today)];
      const ids = (phase?.sessions ?? []).map((x) => x.id);
      const sess = phase?.sessions[pickTodaySessionIndex(ids, st.log, today, p.id)];
      if (sess) {
        window.dispatchEvent(new CustomEvent('nesio-start-workout', {
          detail: { name: dict === 'en' ? p.name.en : p.name.zh, steps: toRunSteps(sess.items), protocolId: p.id, sessionId: sess.id },
        }));
        track('routine_train_start', {});
        return;
      }
    }
    window.dispatchEvent(new CustomEvent('nesio-open-training'));
    track('routine_train_start', {});
  }

  if (due.length === 0) return null;

  return (
    <>
      {due.map((r) => r.kind === 'ai_brief' ? (
        <div key={r.id} className="nesio-proactive-card">
          <div className="nesio-proactive-card-inner">
            <span className="nesio-proactive-card-icon"><IconClock size={18} /></span>
            <div className="nesio-proactive-card-text">
              <p className="nesio-proactive-card-title">{L(dict, '今日 AI 简报', "Today's AI brief")}</p>
              <p className="nesio-proactive-card-body">{L(dict, `${r.time} · 今天的日程、提醒、天气,一段话给你`, `${r.time} · Your day in one short read — schedule, reminders, weather`)}</p>
              <div className="nesio-proactive-card-actions">
                <button
                  type="button"
                  className="nesio-proactive-action-btn"
                  onClick={() => {
                    // AI 例程是 Pro 整功能(试用期内可用);免费 → 升级引导
                    if (!canUse('ai_routine')) {
                      window.dispatchEvent(new CustomEvent('nesio-pro-gate', { detail: { feature: 'ai_routine' } }));
                      return;
                    }
                    window.dispatchEvent(new CustomEvent('nesio-open-brief'));
                    track('routine_brief_open', {});
                  }}
                >
                  {L(dict, '打开简报', 'Open brief')}
                </button>
                <button
                  type="button"
                  className="nesio-proactive-action-btn nesio-proactive-action-btn--snooze"
                  onClick={() => { markRoutineDone(r.id); }}
                >
                  {L(dict, '今天跳过', 'Skip today')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div key={r.id} className="nesio-proactive-card">
          <div className="nesio-proactive-card-inner">
            <span className="nesio-proactive-card-icon"><IconClock size={18} /></span>
            <div className="nesio-proactive-card-text">
              <p className="nesio-proactive-card-title">{r.text}</p>
              <p className="nesio-proactive-card-body">
                {r.category === 'fitness'
                  ? L(dict, `健身计划 · ${r.time}`, `Workout · ${r.time}`)
                  : L(dict, `例行提醒 · ${r.time}`, `Routine · ${r.time}`)}
              </p>
              <div className="nesio-proactive-card-actions">
                {r.category === 'fitness' && (
                  <button
                    type="button"
                    className="nesio-proactive-action-btn"
                    onClick={() => startTraining(r)}
                  >
                    {L(dict, '开始练', 'Start')}
                  </button>
                )}
                <button
                  type="button"
                  className={`nesio-proactive-action-btn${r.category === 'fitness' ? ' nesio-proactive-action-btn--snooze' : ''}`}
                  onClick={() => { markRoutineDone(r.id); track('routine_done', {}); }}
                >
                  {L(dict, '完成', 'Done')}
                </button>
                <button
                  type="button"
                  className="nesio-proactive-action-btn nesio-proactive-action-btn--snooze"
                  onClick={() => { markRoutineDone(r.id); track('routine_skip', {}); }}
                >
                  {L(dict, '今天跳过', 'Skip today')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
