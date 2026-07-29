'use client';

/**
 * RoutineDueCards — 到点的例行提醒在 Today 出卡(批次 19)。
 * 每分钟检查一次;完成/今天跳过后当天不再出现,次日自动复活。
 */

import { useEffect, useState } from 'react';
import { dueRoutines, markRoutineDone, deleteRoutine, ROUTINES_UPDATED_EVENT, type Routine } from '@/lib/portal/routines';
import { protocolById, toRunSteps, loadTrainingState } from '@/lib/platform/training-protocol-engine';
import { pickPhaseIndex, pickTodaySessionIndex } from '@/lib/platform/fitness-home-core';
import { activeProtocol } from '@/lib/platform/training-overrides';
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
    // 健身 routine 卡恢复出卡(批次 175 曾静默隐藏,但 RoutineSheet 一直在承诺「到点出开始练」——
    // 承诺什么就兑现什么;「开始练」直连训练计划/跟练播放器)。
    const read = () => setDue(dueRoutines());
    read();
    const timer = setInterval(read, 60_000);
    window.addEventListener(ROUTINES_UPDATED_EVENT, read);
    return () => { clearInterval(timer); window.removeEventListener(ROUTINES_UPDATED_EVENT, read); };
  }, []);

  // 健身「开始练」→ 有训练计划就直接进跟练播放器,否则打开洞察健康 tab
  function startTraining(r: Routine) {
    const st = loadTrainingState();
    const seed = (r.protocolId && protocolById(r.protocolId)) || (st.activeProtocolId ? protocolById(st.activeProtocolId) : undefined);
    // activeProtocol:种子 + 用户改写。直接用 protocolById 的话,用户改过的组数/次数
    // 不生效、删掉的动作照样练 —— 图8 的「计划可编辑」就只剩下健身页上的一个显示。
    const p = seed ? activeProtocol(seed) : undefined;
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
                <button
                  type="button"
                  className="nesio-proactive-action-btn nesio-proactive-action-btn--snooze"
                  onClick={() => { deleteRoutine(r.id); track('routine_delete', {}); }}
                >
                  {L(dict, '不再提醒', 'Stop this')}
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
                {/* 「不再提醒」 —— 这卡原来只有「完成 / 今天跳过」,两个都是**今天**的出口,
                    要真正停掉这条提醒得跑去设置里翻。整卡本身也不可点(用户试过:点了没反应),
                    于是一条不想要的提醒每天都会再来一次。CLAUDE.md 红线:每个提示都要有
                    「跳过 / 稍后 / 不再提醒」三个出口,这里缺的正是最后一个。 */}
                <button
                  type="button"
                  className="nesio-proactive-action-btn nesio-proactive-action-btn--snooze"
                  onClick={() => { deleteRoutine(r.id); track('routine_delete', {}); }}
                >
                  {L(dict, '不再提醒', 'Stop this')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
