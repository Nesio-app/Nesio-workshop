'use client';

/**
 * HealingTab — 洞察「成长 · 疗愈」子 tab(inner-space 整合 P1)。
 * 三层疗愈栈里更深的两层:此刻先落地(身体层:5-4-3-2-1 / 呼吸,静默、无积分、随时可用)
 * + 和内在的部分待一会儿(部分层:阴影整合 IFS —— 保护者 → 清醒自我 → 念念洞察 → 躯体微动作)。
 * 积分不奖励「记一下」这个点击,而是奖励真的把躯体接地动作做了一遍 —— 每天一次,进奖品商城。
 * 全程走 app 主题 token + 统一 --ng-ease,无 emoji 图标。
 */

import { useEffect, useState } from 'react';
import { collectSeeds, applyIFS, type Seed, type IFSResult } from '@/lib/portal/growth-engine';
import { recordGrowthAnswer } from '@/lib/portal/growth-guide';
import { earnPoints, POINTS_PER_HEALING } from '@/lib/platform/rewards-engine';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

const HEAL_EARNED_KEY = 'nesio-heal-earned';
const todayKey = () => new Date().toISOString().slice(0, 10);
function earnedToday(): boolean {
  try { return localStorage.getItem(HEAL_EARNED_KEY) === todayKey(); } catch { return false; }
}
function markEarnedToday() {
  try { localStorage.setItem(HEAL_EARNED_KEY, todayKey()); } catch { /* 无存储 */ }
}

export default function HealingTab() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const en = dict === 'en';

  // 从最近的记忆里挑「有情绪重量」的几条(soothe/stoic/socratic = nudge 镜头命中的)
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    try {
      const all = collectSeeds(Date.now(), new Set(), 6).filter((s) => s.mode === 'nudge');
      setSeeds(all);
    } catch { /* 空态兜底 */ }
  }, []);
  const seed = seeds[idx];

  const [ifs, setIfs] = useState<IFSResult | null>(null);
  const [ifsLoading, setIfsLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [earned, setEarned] = useState(false); // 本次是否发了分(区别于「今天已发过」)
  const alreadyToday = earnedToday();

  async function talkProtector() {
    if (!seed) return;
    setIfsLoading(true);
    const r = await applyIFS(seed.sourceText, en ? 'en' : 'zh');
    setIfsLoading(false);
    setIfs(r ?? {
      protector: L(dict, '你心里有个部分,一直用最严的方式守着你 —— 它怕你不安全,才这么逼你。谢谢它一直在。', 'A part of you has guarded you the hardest way it knows — because it feared you weren’t safe. Thank it for staying.'),
      self: L(dict, '但现在你已经安全了,有力量建立边界 —— 可以让它先歇一歇。', 'But you’re safe now, and strong enough to set boundaries — it can rest.'),
      insight: '', action: L(dict, '把手放在心口,深呼吸三次,对自己说「我已经足够了」。', 'Hand on your heart, three slow breaths — “I am already enough.”'),
    });
  }

  // 真的把躯体接地动作做了一遍 → 才发分(每天一次),并存进回看
  function completeGrounding() {
    if (!seed || !ifs) return;
    recordGrowthAnswer(
      { id: seed.id, kind: 'dusty_memory', refId: seed.id, question: `和保护者待了一会儿:「${seed.sourceText.slice(0, 24)}」`, questionEn: `Sat with a protector: “${seed.sourceText.slice(0, 24)}”`, context: seed.sourceText, dimension: 'emotion' },
      L(dict, '做完了躯体接地', 'Did the grounding'),
    );
    if (!earnedToday()) {
      try {
        earnPoints(POINTS_PER_HEALING, 'healing', `${L(dict, '深度疗愈', 'Deep healing')}:${seed.sourceText.slice(0, 18)}`);
        window.dispatchEvent(new CustomEvent('nesio-rewards-updated'));
      } catch { /* 无存储 */ }
      markEarnedToday();
      setEarned(true);
    }
    setDone(true);
  }

  function nextOne() {
    setIfs(null); setDone(false); setEarned(false);
    setIdx((i) => i + 1);
  }

  return (
    <div className="nesio-growth ng-heal">
      <p className="ng-streak">{L(dict, '越重的地方,越值得慢慢待 —— 这里不考你,只陪你落地。', 'The heaviest places deserve the slowest care — no quiz here, just grounding.')}</p>

      {/* ── 身体层:此刻先落地(静默、随时、无积分) ── */}
      <div className="ng-sec"><span className="l">{L(dict, '此刻先落地', 'Ground first')}</span><span className="r">{L(dict, '身体先安全,想法才松动', 'Safe body, softer mind')}</span></div>
      <div className="ng-ground">
        <p className="ng-ground-lead">{L(dict, '如果心跳很快 —— 先做这个,不用想:', 'If your heart is racing — do this first, no thinking:')}</p>
        <ul className="ng-ground-list">
          <li>{L(dict, '说出你看见的 5 样东西', 'Name 5 things you can see')}</li>
          <li>{L(dict, '摸到的 4 样、听到的 3 样', '4 you can touch, 3 you can hear')}</li>
          <li>{L(dict, '闻到的 2 样、尝到的 1 样', '2 you can smell, 1 you can taste')}</li>
          <li>{L(dict, '吸气 4 秒,呼气 6 秒,重复三次', 'In for 4, out for 6 — three times')}</li>
        </ul>
      </div>

      <div className="ng-gap" />

      {/* ── 部分层:和内在的部分待一会儿(阴影整合 IFS) ── */}
      <div className="ng-sec"><span className="l">{L(dict, '和内在的部分待一会儿', 'Sit with a part of you')}</span><span className="r">{L(dict, '那个声音在保护你', 'That voice is protecting you')}</span></div>

      {!seed ? (
        <div className="ng-done">{L(dict, '这几天没有太重的记录 —— 真好。等哪天有情绪压过来,这里会陪你把它接住。', 'No heavy notes lately — good. When something weighs on you, this room will help you hold it.')}</div>
      ) : (
        <div className="ng-today">
          <p className="ng-ask"><span className="ng-mem">「{seed.sourceText}」</span>{L(dict, '这句话背后,像是有个一直在紧绷的部分。要不要跟它待一会儿?', 'There seems to be a part behind these words that’s been bracing for a long time. Want to sit with it?')}</p>
          <p className="ng-basis">{L(dict, '依据:你最近的一条记录 · 这里只疏导,不评判', 'From a recent note · comfort here, never judgment')}</p>

          {ifs && (
            <div className="ng-ifs">
              <div className="ng-ifs-part protector"><span className="lbl">{L(dict, '保护者', 'The protector')}</span>{ifs.protector}</div>
              <div className="ng-ifs-part self"><span className="lbl">{L(dict, '清醒的自己', 'Your calm self')}</span>{ifs.self}</div>
              {ifs.insight && <div className="ng-ifs-part insight"><span className="lbl">{L(dict, '念念的洞察', 'Nessa’s read')}</span>{ifs.insight}</div>}
              {ifs.action && (
                <div className="ng-ground-step">
                  <span className="lbl">{L(dict, '现在,给身体一个动作', 'Now, one thing for the body')}</span>
                  {ifs.action}
                </div>
              )}
            </div>
          )}

          {done ? (
            <div className="ng-done" style={{ marginTop: 13 }}>
              {earned
                ? L(dict, `已存进回看 · +${POINTS_PER_HEALING} 进奖品商城 —— 你不是记了一下,是真的照顾了自己一次。`, `Saved · +${POINTS_PER_HEALING} to your rewards — you didn’t just log it, you actually cared for yourself.`)
                : L(dict, '已存进回看 —— 今天的疗愈积分记过了,但这一次的照顾一样算数。', 'Saved — today’s healing points were already counted, but this care still matters.')}
            </div>
          ) : (
            <div className="ng-acts">
              {!ifs ? (
                <button type="button" className="ng-btn" disabled={ifsLoading} onClick={() => void talkProtector()}>
                  {ifsLoading ? L(dict, '念念在陪你看…', 'Nessa is with you…') : L(dict, '和保护者对话', 'Meet the protector')}
                </button>
              ) : (
                <button type="button" className="ng-btn" onClick={completeGrounding}>
                  {alreadyToday
                    ? L(dict, '我按着做了一遍 · 存进回看', 'I did it · save')
                    : L(dict, `我按着做了一遍 · +${POINTS_PER_HEALING}`, `I did it · +${POINTS_PER_HEALING}`)}
                </button>
              )}
              <button type="button" className="ng-btn ghost" onClick={nextOne} disabled={idx + 1 >= seeds.length}>
                {L(dict, '先待别的', 'Another one')}
              </button>
            </div>
          )}

          {done && idx + 1 < seeds.length && (
            <div className="ng-acts" style={{ marginTop: 10 }}>
              <button type="button" className="ng-btn ghost" onClick={nextOne}>{L(dict, '再待一条', 'Sit with another')}</button>
            </div>
          )}
          <p className="ng-todaynote">{L(dict, '积分只奖励真的把动作做了一遍 —— 每天一次就够。回看留在「成长」的回看流里。', 'Points reward actually doing the grounding — once a day is enough. Look-backs live in the Growth trail.')}</p>
        </div>
      )}
    </div>
  );
}
