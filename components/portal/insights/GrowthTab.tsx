'use client';

/**
 * GrowthTab — 洞察「成长」·三子 tab 容器(成长 / 镜头 / 练习场,artifact 1170dd28/d7bd8990/59587b8d)。
 * 「成长」= 心智成长环 + 今天一件件 + 回看流;「镜头」= 挑记忆套镜头(LensTab);
 * 「练习场」= 每日一练 + 利器图鉴(PracticeGround)。三页共用 app 主题 token + 统一 --ng-ease。
 */

import { useEffect, useState } from 'react';
import { todayGrowthCards, recordGrowthAnswer, growthHistory, growthStreakDays, type GrowthCard, type GrowthAnswer } from '@/lib/portal/growth-guide';
import { collectSeeds, generateObservation, DIMENSION_LABEL, summarizeDimensions, ringEmptyPct, deepenNudge, recentSpendItems, gradeReflection, type Observation, type NudgeGuide } from '@/lib/portal/growth-engine';
import { REFLECTION_GRADE_LABEL } from '@/lib/portal/growth-protocols';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import PracticeGround from './PracticeGround';
import { useAutoGrow } from './use-auto-grow';
import LensTab from './LensTab';
import SegTabs from '../ui/SegTabs';
import HealingTab from './HealingTab';
import GrowthFootprint from './GrowthFootprint';
import { getLifeGraph } from '@/lib/portal/life-graph';

const CHIP_CLASS: Record<Observation['mode'], string> = { nudge: 'emo', quiz: 'blind', trend: 'trend' };

const LENS_MODE_LABEL: Record<string, { zh: string; en: string }> = {
  soothe: { zh: '情绪 · 主动疏导', en: 'Feeling · gentle' },
  reframe: { zh: '盲点 · 每日观察', en: 'Blind spot · daily' },
  'action-stall': { zh: '行动 · 卡点诊断', en: 'Action · stall check' },
  stoic: { zh: '掌控 · 控制二分', en: 'Control · dichotomy' },
  socratic: { zh: '逻辑 · 苏格拉底', en: 'Logic · Socratic' },
  'collision-read': { zh: '伴读 · 三岔碰撞', en: 'Reading · three forks' },
  'biz-equation': { zh: '事业 · 心智方程', en: 'Biz · mind equation' },
  'trend-spend': { zh: '趋势 · 主动发现', en: 'Trend · noticed' },
};

// 今天流:引擎观察优先;没有(无 key/无种子)时回落规则卡。统一成一件件过。
type TodayItem = { key: string; t: 'obs'; o: Observation } | { key: string; t: 'rule'; c: GrowthCard };
type SubTab = 'home' | 'lens' | 'practice' | 'healing';

export default function GrowthTab({ onOpenNode }: { onOpenNode?: (nodeId: string) => void } = {}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const en = dict === 'en';
  const [tab, setTab] = useState<SubTab>('home');
  const [healingSeed, setHealingSeed] = useState<string | null>(null); // 从情绪卡「去疗愈馆」带过来的那条记忆

  const [cards, setCards] = useState<GrowthCard[]>([]);
  const [history, setHistory] = useState<GrowthAnswer[]>([]);
  const [streak, setStreak] = useState(0);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const growTa = useAutoGrow();   // 文本框随字数长高(iOS 兜底)
  const [quizPick, setQuizPick] = useState<Record<string, number>>({});

  const [obs, setObs] = useState<Observation[]>([]);
  const [obsLoading, setObsLoading] = useState(true);
  const [obsError, setObsError] = useState(false);
  const [obsRetry, setObsRetry] = useState(0);
  const [idx, setIdx] = useState(0);          // 今天一次一件的游标
  const [freshAt, setFreshAt] = useState<string | null>(null); // 刚答完的回看流条目(滑入动效)
  const [openTrail, setOpenTrail] = useState<string | null>(null); // 点开回看的条目 key

  /**
   * 从回看流条目回到它当时那条记忆。
   * 2026-07-29 标注(Bug4 P7「点回看,要进入对应具体记忆,不是搜索列表」):
   * 回看条目其实**存了 refId**(derivedFrom 就是它),之前却一直按原话去记忆页搜 ——
   * 搜出一页结果让用户自己找,而且原话截断 24 字常常零命中。改为:refId 能在图谱里
   * 找到就直接开那条详情;实在找不到(节点被删)才退回搜索。
   */
  const backToMemory = (a: GrowthAnswer) => {
    if (a.refId) {
      const node = getLifeGraph().find((n) => n.id === a.refId);
      if (node) { onOpenNode?.(node.id); return; }
    }
    const q = (a.context || a.question || '').replace(/^你写\s*/, '').replace(/[「」“”]/g, '').slice(0, 24).trim();
    if (!q) return;
    window.dispatchEvent(new CustomEvent('nesio-memory-search', { detail: { query: q } }));
  };

  const refresh = () => {
    try {
      setCards(todayGrowthCards());
      setHistory(growthHistory());
      setStreak(growthStreakDays());
    } catch { /* 本地数据读取失败:空态兜底 */ }
  };
  useEffect(() => { refresh(); }, []);

  // 引擎:选种子 → 逐个 AI 生成(失败/无 key → obs 为空,回落规则卡;有种子全失败则显式错误+重试)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setObsLoading(true);
      setObsError(false);
      try {
        const answered = new Set(growthHistory().map((a) => a.refId));
        const seeds = collectSeeds(Date.now(), answered, 3);
        if (!seeds.length) {
          if (!cancelled) { setObs([]); setObsLoading(false); }
          return;
        }
        const results = await Promise.all(seeds.map((s) => generateObservation(s, en ? 'en' : 'zh')));
        if (cancelled) return;
        const ok = results.filter((o): o is Observation => o !== null);
        setObs(ok);
        setObsError(ok.length === 0);
        setObsLoading(false);
      } catch {
        if (!cancelled) { setObs([]); setObsError(true); setObsLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [en, obsRetry]);

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

  const basisLine = (o: Observation) => {
    if (o.lensId === 'action-stall') return L(dict, '依据:未完成的承诺 · 点出卡点,给最小一步', 'From an open commitment · name the stall, one tiny step');
    if (o.lensId === 'collision-read') return L(dict, '依据:久放的高置信记忆 · 赞同 / 质疑 / 延伸', 'From a dusty high-confidence note · agree / challenge / extend');
    if (o.lensId === 'biz-equation') return L(dict, '依据:你的事业/内容记录 · 张丽心智方程', 'From your work notes · Zhang Li mind-share equation');
    if (o.mode === 'nudge') return L(dict, '依据:你最近的一条记录 · 热情绪只疏导,不考你', 'From a recent note · heavy feelings get comfort, not a quiz');
    if (o.mode === 'quiz') return L(dict, '依据:你自己写下的想法 · 敌人是思维陷阱,不是你', 'From your own words · the enemy is the trap, not you');
    return L(dict, '依据:你的真实数据 · 只是让你自己看见', 'From your real data · just so you can see it');
  };

  const ruleDraft = current?.t === 'rule' ? (draft[current.c.id] || '') : '';
  const ruleGrade = ruleDraft.trim() ? gradeReflection(ruleDraft, current?.t === 'rule' ? current.c.question : '') : null;
  return (
    <div className="nesio-growth">
      {/* 2026-07-29:原 .ng-subtabs 是全站五套 tab 之一,统一到 SegTabs。 */}
      <SegTabs
        items={[
          { key: 'home' as SubTab, label: L(dict, '成长', 'Growth') },
          { key: 'lens' as SubTab, label: L(dict, '镜头', 'Lenses') },
          { key: 'practice' as SubTab, label: L(dict, '练习场', 'Practice') },
          { key: 'healing' as SubTab, label: L(dict, '疗愈', 'Healing') },
        ]}
        active={tab}
        onSelect={(k) => { if (k === 'healing') setHealingSeed(null); setTab(k); }}
        ariaLabel={L(dict, '成长视图', 'Growth view')}
      />

      {tab === 'lens' ? <LensTab /> : tab === 'practice' ? <PracticeGround /> : tab === 'healing' ? <HealingTab seed={healingSeed} /> : (
        <>
          <GrowthFootprint onGoTab={(t) => setTab(t)} />
          {/* 2026-07-29 标注(Bug4 P9):「今天教练带你看一件事」与「已连续回看 N 天」两句划掉 ——
              过渡文案不承载信息,下面的卡片本身就是那一件事。 */}

          {/* ── 心智成长环(弱化仪表盘感)──
              图9 的红叉盖住的是**四句**,不只是上面两句:「你走过的面向」和
              「不是积分,是痕迹」这一行小标题也在里面。下面卡片第一行
              「在 N 个面向上留下过痕迹 · 共 M 次回看」已经把这件事说完了,
              这一行是它的前言。 */}
          <div className="ng-mind">
            <p className="ng-mind-top">
              {total === 0
                ? L(dict, '每答一条引导,就在一个面向留下痕迹 —— 教练陪你看,不考你。',
                    'Each prompt leaves a trace on one facet — your coach looks with you, no quiz.')
                : L(dict, `在 ${litCount} 个面向上留下过痕迹 · 共 ${total} 次回看`,
                    `Traces on ${litCount} facets · ${total} look-backs`)}
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
          {/* 2026-07-28 UI 精修(标注 图22):标题行「今天这一件」+ 右侧「第 N 件 / 1/3」计数删掉 ——
              卡片自己就说明了是今天这一件,底下还有一句「今天先看这一件」,标题只是重复。 */}

          {obsError && !obsLoading && (
            <div className="ng-done" style={{ marginBottom: 'var(--space-3)' }}>
              <p>{L(dict, '念念这会儿没接上 —— 先用规则引导。', "Couldn't reach Nessa — using rule prompts for now.")}</p>
              <button type="button" className="ng-btn" style={{ marginTop: 'var(--space-2)' }}
                onClick={() => setObsRetry((n) => n + 1)}>{L(dict, '再试一次', 'Try again')}</button>
            </div>
          )}

          {obsLoading ? (
            <div className="ng-done">{L(dict, '念念在从你最近的记忆里,挑值得回头看一眼的事…', 'Nessa is picking what is worth a second look…')}</div>
          ) : todayItems.length === 0 ? (
            <div className="ng-done">{L(dict, '今天没有要回看的 —— 记录多了,这里会从你自己的数据里挑事情。', 'Nothing to look back on — as your records grow, prompts surface from your own data.')}</div>
          ) : !current ? (
            <div className="ng-done">{L(dict, '今天的回看做完了。都从你自己的记忆里长出来 —— 明天是新的几条。', 'Done for today. All grown from your own memories — tomorrow brings new ones.')}</div>
          ) : current.t === 'obs' ? (
            <TodayObsCard key={current.o.id} o={current.o} dict={dict} en={en}
              basis={basisLine(current.o)}
              pick={quizPick[current.o.id]} onPick={(i) => setQuizPick((p) => ({ ...p, [current.o.id]: i }))}
              onSave={(text) => answerObservation(current.o, text)} onSkip={skip}
              onGoHealing={() => { setHealingSeed(current.o.sourceText); setTab('healing'); }} />
          ) : (
            <div className="ng-today">
              <span className="ng-chip blind">{L(dict, '今日引导', "Today's prompt")}</span>
              <p className="ng-ask">{en ? current.c.questionEn : current.c.question}</p>
              <p className="ng-basis">{current.c.context}</p>
              <textarea ref={growTa} className="ng-ta" rows={2}
                placeholder={L(dict, '答一句就够 —— 会存进回看流', 'One line is enough — saved to your trail')}
                value={draft[current.c.id] || ''} onChange={(e) => setDraft((p) => ({ ...p, [current.c.id]: e.target.value }))} />
              {ruleGrade != null && ruleDraft.trim().length >= 6 && (
                <p className="ng-basis">{L(dict, `这句回看大约是「${REFLECTION_GRADE_LABEL[ruleGrade].zh}」`, `This look-back reads like “${REFLECTION_GRADE_LABEL[ruleGrade].en}”`)}</p>
              )}
              <div className="ng-acts">
                <button type="button" className="ng-btn" disabled={!(draft[current.c.id] || '').trim()}
                  onClick={() => recordAndAdvance(current.c, (draft[current.c.id] || '').trim())}>{L(dict, '记下这条回看', 'Save')}</button>
                <button type="button" className="ng-btn ghost" onClick={skip}>{L(dict, '先跳过', 'Skip')}</button>
              </div>
              {/* Bug4 图8「底部字删掉」:回看卡下面那句「今天先看这一件。」删掉 ——
                  卡里本来就只有一件,这句话是在解释一件显而易见的事。 */}
            </div>
          )}

          <div className="ng-gap" />

          {/* ── 回看流 ── */}
          <div className="ng-sec"><span className="l">{L(dict, '回看流', 'Review trail')}</span><span className="r">{L(dict, '复利在回看', 'Compounds on rereading')}</span></div>
          {history.length === 0 ? (
            <p className="ng-empty">{L(dict, '答过的引导会留在这里:当时的问题、数据和你的回答 —— 复利在回看。', 'Answered prompts live here: the question, the data, your answer.')}</p>
          ) : (
            <div className="ng-trail">
              {history.slice(0, 30).map((a, i) => {
                const k = `${a.at}-${i}`;
                const open = openTrail === k;
                const dim = a.dimension && a.dimension in DIMENSION_LABEL ? DIMENSION_LABEL[a.dimension as keyof typeof DIMENSION_LABEL] : null;
                return (
                  <button key={k} type="button" className={`ng-tr${a.at === freshAt ? ' fresh' : ''}${open ? ' open' : ''}`}
                    aria-expanded={open} onClick={() => setOpenTrail(open ? null : k)}>
                    <p className="ng-tr-meta">{fmtDay(a.at)}{dim ? ` · ${L(dict, dim.zh, dim.en)}` : ''}</p>
                    <p className="ng-tr-q">{a.question}</p>
                    <p className={`ng-tr-a${open ? '' : ' clamp'}`}>{a.answer}</p>
                    {open && a.context && <p className="ng-tr-ctx">{L(dict, '当时的数据 · ', 'The data then · ')}{a.context}</p>}
                    {/* 2026-07-28(标注 图23「点击应该可以完全回到原来的页面」):展开后给一条回去的路 ——
                        按当时那条记忆的原话去记忆页搜,落回它自己的详情。原来点开只能读,回不去。 */}
                    {open && (
                      <span className="ng-tr-back" role="link" tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); backToMemory(a); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); backToMemory(a); } }}>
                        {L(dict, '回到这条记忆 ›', 'Back to this memory ›')}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// 今天卡 · 引擎观察(nudge/trend 文本;quiz 选项+揭晓)
function TodayObsCard({ o, dict, en, basis, pick, onPick, onSave, onSkip, onGoHealing }: {
  o: Observation; dict: 'zh' | 'en'; en: boolean; basis: string;
  pick: number | undefined; onPick: (i: number) => void; onSave: (text: string) => void; onSkip: () => void;
  onGoHealing: () => void;
}) {
  const chip = CHIP_CLASS[o.mode];
  const chipLabel = L(dict, DIMENSION_LABEL[o.dimension].zh, DIMENSION_LABEL[o.dimension].en);
  const modeLabel = LENS_MODE_LABEL[o.lensId]
    ? L(dict, LENS_MODE_LABEL[o.lensId].zh, LENS_MODE_LABEL[o.lensId].en)
    : (o.mode === 'nudge' ? L(dict, '情绪 · 主动疏导', 'Feeling · gentle') : o.mode === 'quiz' ? L(dict, '盲点 · 每日观察', 'Blind spot · daily') : L(dict, '趋势 · 主动发现', 'Trend · noticed'));
  // 记忆原话由代码保证引出来(不靠 AI):sourceText 就是你的真实记忆/数据,永远显示
  const lead = o.mode === 'nudge' ? L(dict, '你记下 —— ', 'You noted — ') : o.mode === 'quiz' ? L(dict, '你写 ', 'You wrote ') : '';
  const memQuote = o.mode === 'trend' ? `${o.sourceText}。` : `${lead}「${o.sourceText}」。`;
  const tail = o.mode === 'quiz'
    ? (o.lensId === 'biz-equation'
      ? L(dict, '用张丽心智方程看 —— 此刻最短的是哪一力?', "Through Zhang Li's equation — which force is shortest now?")
      : L(dict, '这句话里藏着一个常见的思维陷阱 —— 你抓得出是哪个吗?', 'A common thinking trap hides in this line — can you spot it?'))
    : (o.body || L(dict, '要不要陪你看看?', 'Want to look at it together?'));

  // 引导态:念念的引导链(情绪:疏导 + 图鉴小测)/ 明细(趋势)—— 主按钮做事,不是让你记
  const [guide, setGuide] = useState<NudgeGuide | null>(null);
  const [gpick, setGpick] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [talkError, setTalkError] = useState(false);
  const [detail, setDetail] = useState(false);
  const opened = guide !== null || detail;
  const gq = guide?.quiz;
  async function talk() {
    setLoading(true);
    setTalkError(false);
    const g = await deepenNudge(o.sourceText, en ? 'en' : 'zh');
    setLoading(false);
    if (!g) {
      setTalkError(true);
      return;
    }
    setGuide(g);
  }
  const spend = detail ? recentSpendItems() : [];
  function saveNudge() {
    const label = o.mode === 'trend'
      ? `[${chipLabel}] ${L(dict, '看了明细', 'saw the details')}`
      : (gq && gpick != null ? `[${chipLabel}] ${gq.tool || gq.options[gq.correctIndex]}` : `[${chipLabel}] ${L(dict, '和念念聊过', 'talked it through')}`);
    onSave(label);
  }

  return (
    <div className="ng-today">
      <span className={`ng-chip ${chip}`}>{modeLabel} · {chipLabel}</span>
      <p className="ng-ask"><span className="ng-mem">{memQuote}</span>{tail}</p>
      {o.nextStep && <p className="ng-basis">{L(dict, '最小一步 · ', 'Tiny step · ')}{o.nextStep}</p>}
      <p className="ng-basis">{basis}</p>

      {o.mode !== 'quiz' ? (
        <>
          {/* 念念的引导链(情绪):先陪你看 → 再一道图鉴小测,选错继续讲 */}
          {guide && (
            <>
              <div className="ng-reveal" style={{ whiteSpace: 'pre-wrap' }}>{guide.reflection}</div>
              {gq && (
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <p className="ng-ask" style={{ fontSize: 'var(--text-body)' }}>{gq.question}</p>
                  {gq.options.map((opt, i) => {
                    const revealed = gpick != null;
                    const cls = !revealed ? 'ng-opt' : i === gq.correctIndex ? 'ng-opt right' : i === gpick ? 'ng-opt wrong' : 'ng-opt';
                    return <button key={i} type="button" className={cls} disabled={revealed} onClick={() => setGpick(i)}>{String.fromCharCode(65 + i)}. {opt}</button>;
                  })}
                  {gpick != null && (
                    <div className="ng-reveal">
                      {gpick !== gq.correctIndex && <b>{L(dict, '再看看 —— ', 'Look again — ')}</b>}
                      {gq.tool && <b>「{gq.tool}」</b>} {gq.explanation}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {/* 消费明细(趋势) */}
          {detail && (
            <div className="ng-reveal">
              {spend.length > 0 ? spend.map((t, i) => (
                <div key={i} className="ng-spend-row"><span>{new Date(t.date).getMonth() + 1}/{new Date(t.date).getDate()} · {t.name}</span><b>${t.amount.toFixed(0)}</b></div>
              )) : <span>{L(dict, '这几笔在「财务」tab 里能看到完整明细。', 'Full details are in the Finance tab.')}</span>}
            </div>
          )}
          {talkError && (
            <p className="ng-basis">{L(dict, '这会儿没接上 —— 可以再试一次,或先跳过。', "Couldn't reach me — retry, or skip for now.")}</p>
          )}
          <div className="ng-acts">
            {o.mode === 'nudge' && !guide && (
              <button type="button" className="ng-btn" disabled={loading} onClick={() => void talk()}>{loading ? L(dict, '念念在想…', 'Nessa is thinking…') : talkError ? L(dict, '再试一次', 'Try again') : L(dict, '念念', 'Nessa')}</button>
            )}
            {o.mode === 'trend' && !detail && (
              <button type="button" className="ng-btn" onClick={() => setDetail(true)}>{L(dict, '看看明细', 'See the details')}</button>
            )}
            {(opened || (o.mode === 'nudge' && o.nextStep)) && (
              <button type="button" className="ng-btn" onClick={saveNudge}>{L(dict, '记下这次觉察', 'Log this insight')}</button>
            )}
            {/* 2026-07-29 标注(Bug4 P8「下面三个按钮并排:念念、疗愈馆、稍后」):
                疗愈馆原来是下面独立一行的通栏按钮,和上面两个动作分了两行。并成一排。 */}
            {o.mode === 'nudge' && (
              <button type="button" className="ng-btn ifs" onClick={onGoHealing}>{L(dict, '疗愈馆', 'Healing')}</button>
            )}
            <button type="button" className="ng-btn ghost" onClick={onSkip}>{o.mode === 'nudge' ? L(dict, '稍后', 'Later') : L(dict, '知道了', 'Got it')}</button>
          </div>
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
