'use client';

/**
 * HealingTab — 洞察「成长 · 疗愈」子 tab(inner-space 整合)。
 * 参与式引导仪式(照旧版 inner-shelter 的阴影整合舱):不是弹几张卡让你读,而是一步步陪你走 ——
 *   ① 你自己写下心里的声音(实时扫出思维陷阱)→ ② 先自己感觉它在怕什么 → ③ 看见保护者 →
 *   ④ 清醒自我接管、对它说一句 → ⑤ 落到身体真做一遍(才发分)。
 * 视觉做成时间线:当前步放大高亮,已完成收起,未来步灰。积分每天一次,只奖励真做完躯体动作。
 * 全程走 app 主题 token + 统一 --ng-ease,无 emoji。
 */

import { useEffect, useMemo, useState } from 'react';
import { collectSeeds, applyIFS, scanAnts, type Seed, type IFSResult } from '@/lib/portal/growth-engine';
import { recordGrowthAnswer } from '@/lib/portal/growth-guide';
import { earnPoints, POINTS_PER_HEALING } from '@/lib/platform/rewards-engine';
import { EMOTIONS, recordMoment, emotionOf } from '@/lib/portal/mood';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

const HEAL_EARNED_KEY = 'nesio-heal-earned';
const todayKey = () => new Date().toISOString().slice(0, 10);
const earnedToday = () => { try { return localStorage.getItem(HEAL_EARNED_KEY) === todayKey(); } catch { return false; } };
const markEarnedToday = () => { try { localStorage.setItem(HEAL_EARNED_KEY, todayKey()); } catch { /* 无存储 */ } };

const PHASES = ['voice', 'fear', 'protector', 'self', 'body', 'feel'] as const;
type Phase = typeof PHASES[number] | 'done';
const phaseRank = (p: Phase) => (p === 'done' ? PHASES.length : PHASES.indexOf(p));

export default function HealingTab({ seed }: { seed?: string | null }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const en = dict === 'en';

  // 身体层:此刻先落地(可点掉的 5-4-3-2-1 + 呼吸)
  const grounds = [
    L(dict, '说出你看见的 5 样东西', 'Name 5 things you can see'),
    L(dict, '摸到的 4 样', '4 things you can touch'),
    L(dict, '听到的 3 样', '3 things you can hear'),
    L(dict, '闻到的 2 样', '2 things you can smell'),
    L(dict, '尝到的 1 样', '1 thing you can taste'),
    L(dict, '吸气 4 秒,呼气 6 秒,重复三次', 'In for 4, out for 6 — three times'),
  ];
  const [gChecked, setGChecked] = useState<Set<number>>(new Set());
  const toggleGround = (i: number) => setGChecked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const groundDone = gChecked.size === grounds.length;

  // 部分层:阴影整合仪式
  const [seeds, setSeeds] = useState<Seed[]>([]);
  useEffect(() => { try { setSeeds(collectSeeds(Date.now(), new Set(), 6).filter((s) => s.mode === 'nudge')); } catch { /* 空 */ } }, []);

  const [phase, setPhase] = useState<Phase>('voice');
  const [voice, setVoice] = useState(() => seed || ''); // 从成长页那条记忆带过来,直接引用不用重填
  const ants = useMemo(() => scanAnts(voice), [voice]);
  const [fear, setFear] = useState<string | null>(null);
  const [ifs, setIfs] = useState<IFSResult | null>(null);
  const [ifsLoading, setIfsLoading] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [feelEm, setFeelEm] = useState<string | null>(null); // 此刻心情:接现有心情系统的 12 情绪
  const [feelNote, setFeelNote] = useState('');
  const [earned, setEarned] = useState(false);
  const rank = phaseRank(phase);
  const feelEmObj = feelEm ? emotionOf(feelEm) : null;

  const fears = en
    ? ['Being left', 'Losing control', 'Not enough', 'Getting hurt again', "Can't say"]
    : ['被抛弃', '失控', '不够好', '再次受伤', '说不清'];
  const replyLines = en
    ? ['“Thank you for protecting me — I can slow down now.”', '“I see you. You’ve worked so hard.”', '“Let me take this one — you can rest.”']
    : ['「谢谢你想保护我,现在我可以慢一点。」', '「我看见你了,你辛苦了。」', '「这次让我来,你可以歇一歇。」'];

  async function pickFear(f: string) {
    setFear(f);
    setPhase('protector');
    setIfsLoading(true);
    const r = await applyIFS(voice, en ? 'en' : 'zh', f);
    setIfsLoading(false);
    setIfs(r ?? {
      protector: L(dict, '你心里有个部分,一直用最严的方式守着你 —— 它怕你不安全,才这么逼你。谢谢它一直在。', 'A part of you has guarded you the hardest way it knows — because it feared you weren’t safe. Thank it for staying.'),
      self: L(dict, '但现在你已经安全了,有力量建立边界 —— 可以让它先歇一歇。', 'But you’re safe now, and strong enough to set boundaries — it can rest.'),
      insight: L(dict, '这句话背后是一个怕你受伤的部分;你的价值,不靠它挣来。', 'Behind these words is a part afraid you’ll be hurt — your worth isn’t earned by it.'),
      action: L(dict, '把手放在心口,深呼吸三次,对自己说「我已经足够了」。', 'Hand on your heart, three slow breaths — “I am already enough.”'),
    });
  }

  // 闭环:做完躯体动作 + 记下此刻心情 → 写进心情系统 + 存进回看(带前后对照)+ 发分(每天一次)
  function closeLoop() {
    if (!feelEmObj) return;
    // 此刻心情进「留住这一刻」同一套情绪记录(自然汇入情绪趋势),带 healing 来源标
    recordMoment(feelEmObj.id, { en, thought: feelNote.trim(), tags: ['healing'] });
    const said = reply ? reply.replace(/[「」“”]/g, '') : '';
    const now = en ? feelEmObj.labelEn : feelEmObj.label;
    const note = feelNote.trim();
    const answer = [said, `${L(dict, '此刻', 'Now')}:${now}`, note].filter(Boolean).join(' · ');
    recordGrowthAnswer(
      { id: `heal:${Date.now()}`, kind: 'dusty_memory', refId: `heal:${voice.slice(0, 12)}`, question: `和内在的部分待了一会儿:「${voice.slice(0, 24)}」`, questionEn: `Sat with a part: “${voice.slice(0, 24)}”`, context: voice, dimension: 'emotion' },
      answer,
    );
    if (!earnedToday()) {
      try { earnPoints(POINTS_PER_HEALING, 'healing', `${L(dict, '深度疗愈', 'Deep healing')}:${voice.slice(0, 18)}`); window.dispatchEvent(new CustomEvent('nesio-rewards-updated')); } catch { /* 无存储 */ }
      markEarnedToday(); setEarned(true);
    }
    setPhase('done');
  }

  function restart() {
    setPhase('voice'); setVoice(''); setFear(null); setIfs(null); setReply(null); setFeelEm(null); setFeelNote(''); setEarned(false);
  }

  // 时间线单步:done 收起摘要 / active 放大高亮 / todo 灰
  const steps: { key: typeof PHASES[number]; n: number; title: string; sum: string }[] = [
    { key: 'voice', n: 1, title: L(dict, '说出此刻心里的声音', 'Name the voice inside'), sum: voice ? `「${voice.slice(0, 16)}${voice.length > 16 ? '…' : ''}」` : '' },
    { key: 'fear', n: 2, title: L(dict, '它在怕什么', 'What it fears'), sum: fear || '' },
    { key: 'protector', n: 3, title: L(dict, '看见保护者', 'Meet the protector'), sum: L(dict, '已看见它在守着你', 'Seen — it was guarding you') },
    { key: 'self', n: 4, title: L(dict, '清醒自我接管', 'Your calm self leads'), sum: reply ? reply.replace(/[「」“”]/g, '').slice(0, 18) : L(dict, '让保护者歇一歇', 'Let the protector rest') },
    { key: 'body', n: 5, title: L(dict, '落到身体,真做一遍', 'Ground it in the body'), sum: L(dict, '已做一遍', 'Done') },
    { key: 'feel', n: 6, title: L(dict, '此刻,心里怎么样', 'How you feel now'), sum: feelEmObj ? `${feelEmObj.emoji} ${en ? feelEmObj.labelEn : feelEmObj.label}${earned ? ' · +' + POINTS_PER_HEALING : ''}` : '' },
  ];
  const stateOf = (k: typeof PHASES[number]) => {
    const mine = PHASES.indexOf(k);
    return mine < rank ? 'done' : mine === rank ? 'active' : 'todo';
  };

  return (
    <div className="nesio-growth ng-heal">
      <p className="ng-streak">{L(dict, '越重的地方,越值得慢慢待 —— 这里不考你,一步步陪你落地。', 'The heaviest places deserve the slowest care — one step at a time.')}</p>

      {/* ── 身体层:此刻先落地(可点掉) ── */}
      <div className="ng-sec"><span className="l">{L(dict, '此刻先落地', 'Ground first')}</span><span className="r">{groundDone ? L(dict, '落地了 · 身体安全了', 'Grounded · you’re safe') : L(dict, '心跳快就先做这个', 'Racing? do this first')}</span></div>
      <div className="ng-ground">
        <p className="ng-ground-lead">{L(dict, '一项项点掉,不用想:', 'Tap them off, no thinking:')}</p>
        <div className="ng-ground-list">
          {grounds.map((g, i) => (
            <button key={i} type="button" className={`ng-ground-item${gChecked.has(i) ? ' on' : ''}`} onClick={() => toggleGround(i)}>
              <span className="tick" aria-hidden>{gChecked.has(i) ? '✓' : ''}</span>{g}
            </button>
          ))}
        </div>
      </div>

      <div className="ng-gap" />

      {/* ── 部分层:阴影整合时间线 ── */}
      <div className="ng-sec"><span className="l">{L(dict, '和内在的部分待一会儿', 'Sit with a part of you')}</span><span className="r">{L(dict, '那个声音在保护你', 'That voice protects you')}</span></div>

      <div className="ng-tl">
        {steps.map((s) => {
          const st = stateOf(s.key);
          return (
            <div key={s.key} className={`ng-tl-step ${st}`}>
              <div className="ng-tl-rail"><span className="ng-tl-node">{st === 'done' ? '✓' : ''}</span></div>
              <div className="ng-tl-body">
                <div className="ng-tl-head"><span className="ng-tl-n">{s.n}</span><span className="ng-tl-t">{s.title}</span></div>

                {st === 'done' && s.sum && <p className="ng-tl-sum">{s.sum}</p>}

                {st === 'active' && s.key === 'voice' && (
                  <div className="ng-tl-in">
                    <textarea className="ng-ta" rows={2} value={voice} onChange={(e) => setVoice(e.target.value)}
                      placeholder={L(dict, '我必须…… / 我应该早就…… / 全搞砸了……', 'I must… / I should have… / I ruined it all…')} />
                    {seed && (
                      <p className="ng-heal-from">{L(dict, '从你成长页那条带过来的 · 想改可以改', 'Carried over from your Growth note — edit if you like')}</p>
                    )}
                    {seeds.length > 0 && !voice && (
                      <div className="ng-heal-chips">
                        {seeds.slice(0, 3).map((sd) => (
                          <button key={sd.id} type="button" className="ng-heal-chip" onClick={() => setVoice(sd.sourceText)}>{sd.sourceText.slice(0, 14)}{sd.sourceText.length > 14 ? '…' : ''}</button>
                        ))}
                      </div>
                    )}
                    {ants && (
                      <div className="ng-ant">
                        <p className="ng-ant-h">{L(dict, `念念注意到「${ants.label}」`, `Nessa noticed “${ants.label}”`)}</p>
                        <p className="ng-ant-b">{L(dict, '这不是你的错 —— 是保护者在用它唯一会的方式照顾你。', 'Not your fault — it’s a protector caring the only way it knows.')}</p>
                        <div className="ng-ant-ch">{ants.words.map((w) => <span key={w} className="ng-ant-w">{w}</span>)}</div>
                      </div>
                    )}
                    <div className="ng-acts">
                      <button type="button" className="ng-btn" disabled={!voice.trim()} onClick={() => setPhase('fear')}>{L(dict, '让念念陪我看看', 'Look at it with Nessa')}</button>
                    </div>
                  </div>
                )}

                {st === 'active' && s.key === 'fear' && (
                  <div className="ng-tl-in">
                    <p className="ng-tl-q">{L(dict, '先自己感觉一下 —— 这个声音最怕你遇到什么?', 'Feel into it first — what does this voice fear most?')}</p>
                    <div className="ng-heal-chips">
                      {fears.map((f) => <button key={f} type="button" className="ng-heal-chip pick" onClick={() => void pickFear(f)}>{f}</button>)}
                    </div>
                  </div>
                )}

                {st === 'active' && s.key === 'protector' && (
                  <div className="ng-tl-in">
                    {ifsLoading || !ifs ? (
                      <p className="ng-quiet">{L(dict, '念念在陪你看…', 'Nessa is with you…')}</p>
                    ) : (
                      <>
                        <div className="ng-ifs-part protector"><span className="lbl">{L(dict, '保护者', 'The protector')}</span>{ifs.protector}</div>
                        <div className="ng-acts"><button type="button" className="ng-btn" onClick={() => setPhase('self')}>{L(dict, '继续', 'Continue')}</button></div>
                      </>
                    )}
                  </div>
                )}

                {st === 'active' && s.key === 'self' && ifs && (
                  <div className="ng-tl-in">
                    <div className="ng-ifs-part self"><span className="lbl">{L(dict, '清醒的自己', 'Your calm self')}</span>{ifs.self}</div>
                    {ifs.insight && <div className="ng-ifs-part insight"><span className="lbl">{L(dict, '念念的洞察', 'Nessa’s read')}</span>{ifs.insight}</div>}
                    <p className="ng-tl-q">{L(dict, '对这个保护者说一句(点一句,或跳过):', 'Say one thing to it (tap one, or skip):')}</p>
                    <div className="ng-heal-chips col">
                      {replyLines.map((r) => (
                        <button key={r} type="button" className={`ng-heal-chip line${reply === r ? ' on' : ''}`} onClick={() => setReply(r)}>{r}</button>
                      ))}
                    </div>
                    <div className="ng-acts"><button type="button" className="ng-btn" onClick={() => setPhase('body')}>{L(dict, '落到身体', 'Into the body')}</button></div>
                  </div>
                )}

                {st === 'active' && s.key === 'body' && ifs && (
                  <div className="ng-tl-in">
                    <div className="ng-ground-step"><span className="lbl">{L(dict, '现在,给身体一个动作', 'Now, one thing for the body')}</span>{ifs.action}</div>
                    <div className="ng-acts">
                      <button type="button" className="ng-btn" onClick={() => setPhase('feel')}>{L(dict, '我按着做了一遍', 'I did it')}</button>
                    </div>
                  </div>
                )}

                {st === 'active' && s.key === 'feel' && (
                  <div className="ng-tl-in">
                    <p className="ng-tl-q">{L(dict, '走完这一遍,此刻心里是什么感受?', 'After all that — how do you feel right now?')}</p>
                    <div className="ng-mood-grid">
                      {EMOTIONS.map((m) => (
                        <button key={m.id} type="button" className={`ng-mood-chip${feelEm === m.id ? ' on' : ''}`} onClick={() => setFeelEm(m.id)}>
                          <span className="em" aria-hidden>{m.emoji}</span>{en ? m.labelEn : m.label}
                        </button>
                      ))}
                    </div>
                    <p className="ng-heal-from">{L(dict, '会记进你的心情记录,汇入情绪趋势。', 'Saved to your mood log — it flows into your emotion trends.')}</p>
                    <textarea className="ng-ta" rows={2} value={feelNote} onChange={(e) => setFeelNote(e.target.value)}
                      placeholder={L(dict, '想补一句就写(可跳过)', 'Add a line if you want (optional)')} />
                    <div className="ng-acts">
                      <button type="button" className="ng-btn" disabled={!feelEm} onClick={closeLoop}>
                        {earnedToday() ? L(dict, '记下此刻 · 存进回看', 'Log this moment · save') : L(dict, `记下此刻 · +${POINTS_PER_HEALING}`, `Log this moment · +${POINTS_PER_HEALING}`)}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {phase === 'done' && (
        <div className="ng-heal-close">
          <div className="ng-loop">
            <div className="ng-loop-row"><span className="k">{L(dict, '开始时', 'At the start')}</span><span className="v">「{voice.slice(0, 20)}{voice.length > 20 ? '…' : ''}」</span></div>
            <div className="ng-loop-arrow" aria-hidden>↓</div>
            <div className="ng-loop-row now"><span className="k">{L(dict, '此刻', 'Now')}</span><span className="v">{feelEmObj ? `${feelEmObj.emoji} ${en ? feelEmObj.labelEn : feelEmObj.label}` : ''}{feelNote.trim() ? ` · ${feelNote.trim()}` : ''}</span></div>
          </div>
          <p className="ng-done" style={{ marginTop: 12 }}>
            {earned
              ? L(dict, `+${POINTS_PER_HEALING} 进奖品商城 —— 你不是记了一下,是真的陪自己走完了一次。`, `+${POINTS_PER_HEALING} to your rewards — you didn’t just log it, you walked yourself through it.`)
              : L(dict, '已存进回看 —— 今天的疗愈积分记过了,但这一次的照顾一样算数。', 'Saved — today’s healing points were already counted, but this care still matters.')}
          </p>
          <div className="ng-acts">
            <button type="button" className="ng-btn ghost" onClick={restart}>{L(dict, '再走一遍', 'Again')}</button>
          </div>
        </div>
      )}

      <p className="ng-todaynote">{L(dict, '积分只奖励真的把动作做了一遍 —— 每天一次就够。回看留在「成长」的回看流里。', 'Points reward actually doing the grounding — once a day. Look-backs live in the Growth trail.')}</p>
    </div>
  );
}
