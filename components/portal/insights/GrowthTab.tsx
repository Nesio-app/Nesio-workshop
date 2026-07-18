'use client';

/**
 * GrowthTab — 洞察「成长」·三子 tab 容器(成长 / 镜头 / 练习场,artifact 1170dd28/d7bd8990/59587b8d)。
 * 「成长」= 心智成长环 + 今天一件件 + 回看流;「镜头」= 挑记忆套镜头(LensTab);
 * 「练习场」= 每日一练 + 利器图鉴(PracticeGround)。三页共用 app 主题 token + 统一 --ng-ease。
 */

import { useEffect, useState } from 'react';
import { todayGrowthCards, recordGrowthAnswer, growthHistory, growthStreakDays, type GrowthCard, type GrowthAnswer } from '@/lib/portal/growth-guide';
import { collectSeeds, generateObservation, DIMENSION_LABEL, summarizeDimensions, ringEmptyPct, type Observation } from '@/lib/portal/growth-engine';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import PracticeGround from './PracticeGround';
import LensTab from './LensTab';

const CHIP_CLASS: Record<Observation['mode'], string> = { nudge: 'emo', quiz: 'blind', trend: 'trend' };

// 今天流:引擎观察优先;没有(无 key/无种子)时回落规则卡。统一成一件件过。
type TodayItem = { key: string; t: 'obs'; o: Observation } | { key: string; t: 'rule'; c: GrowthCard };
type SubTab = 'home' | 'lens' | 'practice';

export default function GrowthTab() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const en = dict === 'en';
  const [tab, setTab] = useState<SubTab>('home');

  const [cards, setCards] = useState<GrowthCard[]>([]);
  const [history, setHistory] = useState<GrowthAnswer[]>([]);
  const [streak, setStreak] = useState(0);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [quizPick, setQuizPick] = useState<Record<string, number>>({});

  const [obs, setObs] = useState<Observation[]>([]);
  const [obsLoading, setObsLoading] = useState(true);
  const [idx, setIdx] = useState(0);          // 今天一次一件的游标
  const [freshAt, setFreshAt] = useState<string | null>(null); // 刚答完的回看流条目(滑入动效)

  const refresh = () => {
    try {
      setCards(todayGrowthCards());
      setHistory(growthHistory());
      setStreak(growthStreakDays());
    } catch { /* 本地数据读取失败:空态兜底 */ }
  };
  useEffect(() => { refresh(); }, []);

  // 引擎:选种子 → 逐个 AI 生成(失败/无 key → obs 为空,回落规则卡)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const answered = new Set(growthHistory().map((a) => a.refId));
        const seeds = collectSeeds(Date.now(), answered, 3);
        if (!seeds.length) { if (!cancelled) setObsLoading(false); return; }
        const results = await Promise.all(seeds.map((s) => generateObservation(s, en ? 'en' : 'zh')));
        if (!cancelled) { setObs(results.filter((o): o is Observation => o !== null)); setObsLoading(false); }
      } catch { if (!cancelled) setObsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [en]);

  // 记一条回看 → 滑进回看流 → 出下一件
  function recordAndAdvance(card: GrowthCard, text: string) {
    recordGrowthAnswer(card, text);
    const h = growthHistory();
    setHistory(h);
    setStreak(growthStreakDays());
    setFreshAt(h[0]?.at ?? null);
    setIdx((i) => i + 1);
  }
  function answerObservation(o: Observation, text: string) {
    recordAndAdvance({ id: o.id, kind: 'dusty_memory', refId: o.id, question: o.title, questionEn: o.title, context: o.sourceText, dimension: o.dimension }, text);
  }
  function skip() { setIdx((i) => i + 1); }

  const fmtDay = (iso: string) => en
    ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : `${new Date(iso).getMonth() + 1}月${new Date(iso).getDate()}日`;

  // 心智成长环
  const codex = summarizeDimensions(history);
  const litCount = codex.filter((d) => d.count > 0).length;
  const total = codex.reduce((s, d) => s + d.count, 0);

  // 今天流
  const todayItems: TodayItem[] = obs.length
    ? obs.map((o) => ({ key: o.id, t: 'obs' as const, o }))
    : cards.map((c) => ({ key: c.id, t: 'rule' as const, c }));
  const current = todayItems[idx];

  const basisLine = (o: Observation) => o.mode === 'nudge'
    ? L(dict, '依据:你最近的一条记录 · 热情绪只疏导,不考你', 'From a recent note · heavy feelings get comfort, not a quiz')
    : o.mode === 'quiz'
      ? L(dict, '依据:你自己写下的想法 · 敌人是思维陷阱,不是你', 'From your own words · the enemy is the trap, not you')
      : L(dict, '依据:你的真实数据 · 只是让你自己看见', 'From your real data · just so you can see it');

  return (
    <div className="nesio-growth">
      <div className="ng-subtabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'home'} className={tab === 'home' ? 'on' : ''} onClick={() => setTab('home')}>{L(dict, '成长', 'Growth')}</button>
        <button type="button" role="tab" aria-selected={tab === 'lens'} className={tab === 'lens' ? 'on' : ''} onClick={() => setTab('lens')}>{L(dict, '镜头', 'Lenses')}</button>
        <button type="button" role="tab" aria-selected={tab === 'practice'} className={tab === 'practice' ? 'on' : ''} onClick={() => setTab('practice')}>{L(dict, '练习场', 'Practice')}</button>
      </div>

      {tab === 'lens' ? <LensTab /> : tab === 'practice' ? <PracticeGround /> : (
        <>
          <p className="ng-streak">
            {streak > 1 ? L(dict, `已连续回看 ${streak} 天 · 慢慢来`, `${streak} days in a row · no rush`) : L(dict, '慢慢来 —— 一次看清一件就好', 'No rush — one clear look at a time')}
          </p>

          {/* ── 心智成长环 ── */}
          <div className="ng-sec"><span className="l">{L(dict, '心智成长', 'Mind growth')}</span><span className="r">{L(dict, '你留下觉察的地方', 'Where you left insight')}</span></div>
          <div className="ng-mind">
            <p className="ng-mind-top">
              {total === 0
                ? L(dict, '每答一条引导,就在一个维度上留下觉察 —— 底层模型共享,场景全是你自己的。',
                    'Each prompt you answer leaves insight on one facet — shared models, your own scenes.')
                : L(dict, `在 ${litCount} 个维度上留下过觉察 · 共 ${total} 次回看 —— 底层模型共享,场景全是你自己的`,
                    `Insight on ${litCount} facets · ${total} look-backs — shared models, your own scenes`)}
            </p>
            <div className="ng-dims">
              {codex.map((d) => (
                <div key={d.dimension} className={`ng-dim${d.count === 0 ? ' locked' : ''}`}>
                  <div className="ng-ring"><i style={{ ['--empty' as string]: `${ringEmptyPct(d.count)}%` }} /></div>
                  <div className="ng-dim-nm">{L(dict, DIMENSION_LABEL[d.dimension].zh, DIMENSION_LABEL[d.dimension].en)}</div>
                  <div className="ng-dim-ct">{d.count > 0 ? L(dict, `${d.count} 次`, `${d.count}×`) : L(dict, '还没', 'yet')}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="ng-gap" />

          {/* ── 今天:一次一件 ── */}
          <div className="ng-sec">
            <span className="l">{L(dict, '今天', 'Today')}</span>
            <span className="r">
              {obsLoading ? L(dict, '念念在看你的记录…', 'Nessa is reading your notes…')
                : todayItems.length === 0 ? L(dict, '今天很清静', 'A quiet day')
                : idx >= todayItems.length ? L(dict, '今天做完了', 'Done for today')
                : L(dict, `第 ${idx + 1} / ${todayItems.length} 条 · 答完再出下一条`, `${idx + 1} / ${todayItems.length} · one at a time`)}
            </span>
          </div>

          {obsLoading ? (
            <div className="ng-done">{L(dict, '念念在从你最近的记忆里,挑值得回头看一眼的事…', 'Nessa is picking what is worth a second look…')}</div>
          ) : todayItems.length === 0 ? (
            <div className="ng-done">{L(dict, '今天没有要回看的 —— 记录多了,这里会从你自己的数据里挑事情。', 'Nothing to look back on — as your records grow, prompts surface from your own data.')}</div>
          ) : !current ? (
            <div className="ng-done">{L(dict, '今天的回看做完了。都从你自己的记忆里长出来 —— 明天是新的几条。', 'Done for today. All grown from your own memories — tomorrow brings new ones.')}</div>
          ) : current.t === 'obs' ? (
            <TodayObsCard o={current.o} dict={dict} en={en}
              basis={basisLine(current.o)}
              draft={draft} setDraft={setDraft}
              pick={quizPick[current.o.id]} onPick={(i) => setQuizPick((p) => ({ ...p, [current.o.id]: i }))}
              onSave={(text) => answerObservation(current.o, text)} onSkip={skip} />
          ) : (
            <div className="ng-today">
              <span className="ng-chip blind">{L(dict, '今日引导', "Today's prompt")}</span>
              <p className="ng-ask">{en ? current.c.questionEn : current.c.question}</p>
              <p className="ng-basis">{current.c.context}</p>
              <textarea className="ng-ta" rows={2}
                placeholder={L(dict, '答一句就够 —— 会存进回看流', 'One line is enough — saved to your trail')}
                value={draft[current.c.id] || ''} onChange={(e) => setDraft((p) => ({ ...p, [current.c.id]: e.target.value }))} />
              <div className="ng-acts">
                <button type="button" className="ng-btn" disabled={!(draft[current.c.id] || '').trim()}
                  onClick={() => recordAndAdvance(current.c, (draft[current.c.id] || '').trim())}>{L(dict, '记下这条回看', 'Save')}</button>
                <button type="button" className="ng-btn ghost" onClick={skip}>{L(dict, '先跳过', 'Skip')}</button>
              </div>
              <p className="ng-todaynote">{L(dict, '今天先看这一件。', 'Just this one for today.')}</p>
            </div>
          )}

          <div className="ng-gap" />

          {/* ── 回看流 ── */}
          <div className="ng-sec"><span className="l">{L(dict, '回看流', 'Review trail')}</span><span className="r">{L(dict, '复利在回看', 'Compounds on rereading')}</span></div>
          {history.length === 0 ? (
            <p className="ng-empty">{L(dict, '答过的引导会留在这里:当时的问题、数据和你的回答 —— 复利在回看。', 'Answered prompts live here: the question, the data, your answer.')}</p>
          ) : (
            <div className="ng-trail">
              {history.slice(0, 30).map((a, i) => (
                <div key={`${a.at}-${i}`} className={`ng-tr${a.at === freshAt ? ' fresh' : ''}`}>
                  <p className="ng-tr-meta">{fmtDay(a.at)}{a.context ? ` · ${a.context}` : ''}</p>
                  <p className="ng-tr-q">{a.question}</p>
                  <p className="ng-tr-a">{a.answer}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// 今天卡 · 引擎观察(nudge/trend 文本;quiz 选项+揭晓)
function TodayObsCard({ o, dict, en, basis, draft, setDraft, pick, onPick, onSave, onSkip }: {
  o: Observation; dict: 'zh' | 'en'; en: boolean; basis: string;
  draft: Record<string, string>; setDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  pick: number | undefined; onPick: (i: number) => void; onSave: (text: string) => void; onSkip: () => void;
}) {
  const chip = CHIP_CLASS[o.mode];
  const chipLabel = L(dict, DIMENSION_LABEL[o.dimension].zh, DIMENSION_LABEL[o.dimension].en);
  return (
    <div className="ng-today">
      <span className={`ng-chip ${chip}`}>{o.mode === 'nudge' ? L(dict, '情绪 · 主动疏导', 'Feeling · gentle') : o.mode === 'quiz' ? L(dict, '盲点 · 每日观察', 'Blind spot · daily') : L(dict, '趋势 · 主动发现', 'Trend · noticed')} · {chipLabel}</span>
      <p className="ng-ask">{o.mode === 'quiz' && o.quiz ? o.quiz.question : o.body}</p>
      <p className="ng-basis">{basis}</p>

      {o.mode !== 'quiz' ? (
        <>
          <textarea className="ng-ta" rows={2}
            placeholder={o.mode === 'nudge' ? L(dict, '想说点什么就说一句 —— 会存进回看流', "Say a line if you'd like — saved to your trail") : L(dict, '记一句你的想法', 'Jot a line')}
            value={draft[o.id] || ''} onChange={(e) => setDraft((p) => ({ ...p, [o.id]: e.target.value }))} />
          <div className="ng-acts">
            <button type="button" className="ng-btn" disabled={!(draft[o.id] || '').trim()} onClick={() => onSave((draft[o.id] || '').trim())}>{L(dict, '记下这条回看', 'Save')}</button>
            <button type="button" className="ng-btn ghost" onClick={onSkip}>{L(dict, '先跳过', 'Skip')}</button>
          </div>
          <p className="ng-todaynote">{L(dict, '今天先看这一件。', 'Just this one for today.')}</p>
        </>
      ) : o.quiz ? (
        <>
          {o.quiz.options.map((opt, i) => {
            const revealed = pick != null;
            const cls = !revealed ? 'ng-opt' : i === o.quiz!.correctIndex ? 'ng-opt right' : i === pick ? 'ng-opt wrong' : 'ng-opt';
            return (
              <button key={i} type="button" className={cls} disabled={revealed} onClick={() => onPick(i)}>
                {String.fromCharCode(65 + i)}. {opt}
              </button>
            );
          })}
          {pick != null && (
            <div className="ng-reveal">
              {pick !== o.quiz.correctIndex && <b>{L(dict, '再看看 —— ', 'Look again — ')}</b>}
              {o.quiz.explanation}
              <div className="ng-acts" style={{ marginTop: 10 }}>
                <button type="button" className="ng-btn" onClick={() => onSave(`[${chipLabel}] ${o.quiz!.options[o.quiz!.correctIndex]}`)}>{L(dict, '记下这次觉察', 'Log this insight')}</button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
