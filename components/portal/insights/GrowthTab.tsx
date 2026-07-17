'use client';

/**
 * GrowthTab — 洞察「成长」tab(用户定:被动观察 → 个性化引导提升)。
 * 三层:今日引导卡(growth-guide 规则,零 AI 成本)→ 回看流(已答卡时间线,
 * 本 tab 的灵魂:当时的问题+数据快照+你的回答)→ 框架书架(结构化提问模板,
 * 复制后带自己的内容去问一问)。进度只用「连续回看天数」轻轻带过,不搞段位。
 */

import { useEffect, useState } from 'react';
import {
  todayGrowthCards, recordGrowthAnswer, growthHistory, growthStreakDays,
  GROWTH_FRAMEWORKS, runFrameworkInline, composeArgumentTeardown, type GrowthCard, type GrowthAnswer,
} from '@/lib/portal/growth-guide';
import { collectSeeds, generateObservation, DIMENSION_LABEL, type Observation } from '@/lib/portal/growth-engine';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

const ARG_EXAMPLES = [
  '你作为负责人，要起模范带头作用，学会鼓舞团队士气。',
  '你都不给项目投资，说明你对自己的产品没信心吧？',
  '别那么自私，格局大一点，不就是搭把手的事。',
];

export default function GrowthTab() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const en = dict === 'en';
  const [cards, setCards] = useState<GrowthCard[]>([]);
  const [history, setHistory] = useState<GrowthAnswer[]>([]);
  const [streak, setStreak] = useState(0);
  const [draft, setDraft] = useState<Record<string, string>>({});

  // 帮你吵(bangnichao)内联表单
  const [said, setSaid] = useState('');
  const [ctx, setCtx] = useState('');
  const [argState, setArgState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [argOut, setArgOut] = useState('');
  const [argErr, setArgErr] = useState('');

  // 框架书架:展开的框架 id + 各自的输入/输出/状态
  const [openFw, setOpenFw] = useState('');
  const [fwInput, setFwInput] = useState<Record<string, string>>({});
  const [fwOut, setFwOut] = useState<Record<string, { state: 'running' | 'done' | 'error'; text: string }>>({});

  // 智能观察(引擎:真实记忆 → 镜头 → 三态)。obsState: loading→有几条 / done→渲染 / empty→回落规则卡
  const [obs, setObs] = useState<Observation[]>([]);
  const [obsLoading, setObsLoading] = useState(true);
  const [quizPick, setQuizPick] = useState<Record<string, number>>({});

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
        const answered = new Set(growthHistory().map((a) => `${a.kind}:${a.refId}`));
        const seeds = collectSeeds(Date.now(), answered, 2);
        if (!seeds.length) { if (!cancelled) setObsLoading(false); return; }
        const results = await Promise.all(seeds.map((s) => generateObservation(s, en ? 'en' : 'zh')));
        if (!cancelled) { setObs(results.filter((o): o is Observation => o !== null)); setObsLoading(false); }
      } catch { if (!cancelled) setObsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [en]);

  function answerObservation(o: Observation, text: string) {
    recordGrowthAnswer({ id: o.id, kind: 'dusty_memory', refId: o.sourceId, question: o.title, questionEn: o.title, context: o.sourceText },
      text);
    setObs((prev) => prev.filter((x) => x.id !== o.id));
    refresh();
  }

  function submit(card: GrowthCard) {
    const text = (draft[card.id] || '').trim();
    if (!text) return;
    recordGrowthAnswer(card, text);
    setDraft((p) => ({ ...p, [card.id]: '' }));
    refresh();
  }

  const errText = (e?: string) => e === 'auth'
    ? L(dict, '要先登录 Nesio 才能用 AI 拆解。', 'Sign in to Nesio to use AI here.')
    : e === 'rate' ? L(dict, '太快了，喘口气再试一次。', 'Too fast — take a breath and retry.')
    : L(dict, '这会儿没接上，稍后再试一次。', "Couldn't reach the AI — try again shortly.");

  async function runArgument() {
    const s = said.trim();
    if (!s || argState === 'running') return;
    setArgState('running'); setArgOut(''); setArgErr('');
    const r = await runFrameworkInline(composeArgumentTeardown(s, ctx), '', en ? 'en' : 'zh');
    if (r.ok && r.text) { setArgOut(r.text); setArgState('done'); }
    else { setArgErr(errText(r.error)); setArgState('error'); }
  }

  async function runFramework(id: string, promptTemplate: string) {
    const content = (fwInput[id] || '').trim();
    if (!content) return;
    setFwOut((p) => ({ ...p, [id]: { state: 'running', text: '' } }));
    const r = await runFrameworkInline(promptTemplate, content, en ? 'en' : 'zh');
    setFwOut((p) => ({ ...p, [id]: r.ok && r.text ? { state: 'done', text: r.text } : { state: 'error', text: errText(r.error) } }));
  }

  const fmtDay = (iso: string) => en
    ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : `${new Date(iso).getMonth() + 1}月${new Date(iso).getDate()}日`;

  return (
    <div>
      {streak > 1 && (
        <p className="nesio-settings-option-hint" style={{ marginBottom: 'var(--space-3)' }}>
          {L(dict, `已连续回看 ${streak} 天`, `${streak} days of looking back in a row`)}
        </p>
      )}

      <p className="nesio-insights-section-label">{L(dict, '今日引导', "Today's prompts")}</p>

      {/* 智能观察(引擎三态):真实记忆 → 镜头 → 主动疏导 / 小测 / 趋势 */}
      {obsLoading && (
        <p className="nesio-settings-option-hint" style={{ marginBottom: 'var(--space-3)' }}>
          {L(dict, '念念在看你最近的记录…', 'Nessa is looking over your recent notes…')}
        </p>
      )}
      {obs.map((o) => (
        <div key={o.id} style={{ border: '1px solid var(--portal-accent-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', marginBottom: 'var(--space-3)', background: 'var(--portal-accent-soft)' }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: '0 0 var(--space-2)' }}>
            <span style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' }}>{o.title}</span>
            <span style={{ fontSize: '0.66rem', color: 'var(--portal-blue-deep)', background: 'var(--panel, rgba(255,255,255,0.5))', padding: '1px 7px', borderRadius: 'var(--radius-pill)' }}>{L(dict, DIMENSION_LABEL[o.dimension].zh, DIMENSION_LABEL[o.dimension].en)}</span>
          </p>

          {/* nudge / trend:一段话 + 答一句(存进回看流) */}
          {o.mode !== 'quiz' && (
            <>
              <p style={{ color: 'var(--portal-ink)', lineHeight: 1.7, margin: '0 0 var(--space-2)', whiteSpace: 'pre-wrap' }}>{o.body}</p>
              <textarea className="nesio-routine-input" style={{ minHeight: '3rem', resize: 'vertical', width: '100%' }}
                placeholder={o.mode === 'nudge' ? L(dict, '想说点什么就说一句 —— 会存进回看流', "Say a line if you'd like — saved to your review trail") : L(dict, '记一句你的想法', 'Jot a line')}
                value={draft[o.id] || ''} onChange={(e) => setDraft((p) => ({ ...p, [o.id]: e.target.value }))} />
              <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: 'var(--space-2)' }}
                disabled={!(draft[o.id] || '').trim()} onClick={() => answerObservation(o, draft[o.id])}>
                {L(dict, '记下这条回看', 'Save this reflection')}
              </button>
            </>
          )}

          {/* quiz:选项 → 揭晓正误 + 解释(思维利器形式,题是你的真实想法) */}
          {o.mode === 'quiz' && o.quiz && (
            <>
              <p style={{ color: 'var(--portal-ink)', lineHeight: 1.6, margin: '0 0 var(--space-1)' }}>{o.quiz.question}</p>
              <p className="nesio-settings-option-hint" style={{ margin: '0 0 var(--space-2)' }}>{o.sourceText}</p>
              {o.quiz.options.map((opt, i) => {
                const picked = quizPick[o.id];
                const revealed = picked != null;
                const isCorrect = i === o.quiz!.correctIndex;
                const bg = !revealed ? 'var(--panel, #fff)'
                  : isCorrect ? 'var(--status-go-soft)'
                  : i === picked ? 'var(--status-risk-soft)' : 'var(--panel, #fff)';
                return (
                  <button key={i} type="button" disabled={revealed}
                    onClick={() => setQuizPick((p) => ({ ...p, [o.id]: i }))}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: 'var(--space-3)', marginBottom: 'var(--space-2)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', background: bg, color: 'var(--portal-ink)', cursor: revealed ? 'default' : 'pointer' }}>
                    <span style={{ fontWeight: 'var(--weight-medium)' }}>{String.fromCharCode(65 + i)}. </span>{opt}
                  </button>
                );
              })}
              {quizPick[o.id] != null && (
                <div style={{ marginTop: 'var(--space-2)' }}>
                  <p style={{ color: quizPick[o.id] === o.quiz.correctIndex ? 'var(--status-go)' : 'var(--status-gentle)', fontWeight: 'var(--weight-semibold)', margin: '0 0 var(--space-1)' }}>
                    {quizPick[o.id] === o.quiz.correctIndex ? L(dict, '✓ 看得很准', '✓ Nicely spotted') : L(dict, '再体会一下 ——', 'Have another look —')}
                  </p>
                  <p style={{ color: 'var(--portal-ink)', lineHeight: 1.7, margin: '0 0 var(--space-2)', whiteSpace: 'pre-wrap' }}>{o.quiz.explanation}</p>
                  <button type="button" className="nesio-connector-connect" onClick={() => answerObservation(o, `[${DIMENSION_LABEL[o.dimension].zh}] ${o.quiz!.options[o.quiz!.correctIndex]}`)}>{L(dict, '记下这次觉察', 'Log this insight')}</button>
                </div>
              )}
            </>
          )}
        </div>
      ))}

      {/* 规则卡:引擎没产出时的兜底(commitment/spend/dusty,零 AI) */}
      {!obsLoading && obs.length === 0 && cards.length === 0 ? (
        <p className="nesio-settings-option-hint">
          {L(dict, '今天没有要回看的 —— 记录多了,这里会从你的数据里挑值得回头看一眼的事。',
            'Nothing to look back on today — as your records grow, prompts will surface from your own data.')}
        </p>
      ) : (!obsLoading && obs.length === 0) ? cards.map((c) => (
        <div key={c.id} style={{ border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', marginBottom: 'var(--space-3)' }}>
          <p style={{ color: 'var(--portal-ink)', lineHeight: 1.6, margin: 0 }}>{en ? c.questionEn : c.question}</p>
          <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-2) 0' }}>{c.context}</p>
          <textarea
            className="nesio-routine-input"
            style={{ minHeight: '3.4rem', resize: 'vertical', width: '100%' }}
            placeholder={L(dict, '答一句就够 —— 会存进回看流', 'One line is enough — saved to your review trail')}
            value={draft[c.id] || ''}
            onChange={(e) => setDraft((p) => ({ ...p, [c.id]: e.target.value }))}
          />
          <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: 'var(--space-2)' }}
            disabled={!(draft[c.id] || '').trim()} onClick={() => submit(c)}>
            {L(dict, '记下这条回看', 'Save this reflection')}
          </button>
        </div>
      )) : null}

      <p className="nesio-insights-section-label" style={{ marginTop: 'var(--space-5)' }}>{L(dict, '回看流', 'Review trail')}</p>
      {history.length === 0 ? (
        <p className="nesio-settings-option-hint">
          {L(dict, '答过的引导会留在这里:当时的问题、数据和你的回答 —— 复利在回看。',
            'Answered prompts live here: the question, the data, and what you said — the compounding is in the rereading.')}
        </p>
      ) : history.slice(0, 30).map((a, i) => (
        <div key={`${a.at}-${i}`} style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--portal-line)' }}>
          <p className="nesio-settings-option-hint" style={{ margin: 0 }}>{fmtDay(a.at)}{a.context ? ` · ${a.context}` : ''}</p>
          <p style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-sm)', margin: 'var(--space-1) 0' }}>{a.question}</p>
          <p style={{ color: 'var(--portal-ink)', margin: 0, lineHeight: 1.55 }}>{a.answer}</p>
        </div>
      ))}

      {/* ── 帮你吵:粘对方的话 → 直接内联拆解 + 回法(不跳转、不复制)── */}
      <p className="nesio-insights-section-label" style={{ marginTop: 'var(--space-5)' }}>{L(dict, '帮你吵', 'Win the argument')}</p>
      <p className="nesio-settings-option-hint" style={{ marginBottom: 'var(--space-2)' }}>
        {L(dict, '吵赢，不是把人说哑，是把架吵清楚。把对方那句话原样贴进来。', "Winning isn't silencing them — it's making the argument clear. Paste what they said.")}
      </p>
      <textarea className="nesio-routine-input" style={{ minHeight: '3.6rem', resize: 'vertical', width: '100%' }}
        placeholder={L(dict, '别人对你说了啥？（原样打进来）', 'What did they say to you? (paste it)')}
        value={said} onChange={(e) => setSaid(e.target.value)} />
      <input className="nesio-routine-input" style={{ width: '100%', marginTop: 'var(--space-2)' }}
        placeholder={L(dict, '当时是什么场合？（可不填）', 'What was the setting? (optional)')}
        value={ctx} onChange={(e) => setCtx(e.target.value)} />
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', margin: 'var(--space-2) 0' }}>
        {ARG_EXAMPLES.map((ex, i) => (
          <button key={i} type="button" className="nesio-connector-connect"
            style={{ fontSize: '0.72rem', background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)' }}
            onClick={() => setSaid(ex)}>{ex.slice(0, 12)}…</button>
        ))}
      </div>
      <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%' }}
        disabled={!said.trim() || argState === 'running'} onClick={() => void runArgument()}>
        {argState === 'running' ? L(dict, '正在拆这一架…', 'Working through it…') : L(dict, '帮我拆这一架 ⚔️', 'Break down the argument ⚔️')}
      </button>
      {argState === 'done' && argOut && (
        <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-4)', background: 'var(--portal-accent-soft)', borderRadius: 'var(--radius-md)', color: 'var(--portal-ink)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{argOut}</div>
      )}
      {argState === 'error' && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          <p className="nesio-settings-option-hint">{argErr}</p>
          <button type="button" className="nesio-connector-connect" onClick={() => void runArgument()}>{L(dict, '再试一次', 'Try again')}</button>
        </div>
      )}

      {/* ── 框架书架:点开 → 内联输入 → 直接出结果(去掉复制粘贴)── */}
      <p className="nesio-insights-section-label" style={{ marginTop: 'var(--space-5)' }}>{L(dict, '思维框架', 'Thinking frameworks')}</p>
      <p className="nesio-settings-option-hint" style={{ marginBottom: 'var(--space-2)' }}>
        {L(dict, '点开一个框架，把你的内容贴进去，直接帮你套着拆 —— 不用复制粘贴。', 'Open one, paste your content, and it applies the framework right here — no copy-paste.')}
      </p>
      {GROWTH_FRAMEWORKS.map((f) => {
        const open = openFw === f.id;
        const out = fwOut[f.id];
        return (
          <div key={f.id} style={{ borderBottom: '1px solid var(--portal-line)', padding: 'var(--space-3) 0' }}>
            <button type="button" onClick={() => setOpenFw(open ? '' : f.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', width: '100%', border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ color: 'var(--portal-ink)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>{en ? f.nameEn : f.name}</p>
                <p className="nesio-settings-option-hint" style={{ margin: 0 }}>{en ? f.descEn : f.desc}</p>
              </div>
              <span aria-hidden style={{ color: 'var(--portal-muted)', flexShrink: 0 }}>{open ? '−' : '+'}</span>
            </button>
            {open && (
              <div style={{ marginTop: 'var(--space-3)' }}>
                <textarea className="nesio-routine-input" style={{ minHeight: '3.4rem', resize: 'vertical', width: '100%' }}
                  placeholder={L(dict, '把要套用的内容贴到这里…', 'Paste the content to apply it to…')}
                  value={fwInput[f.id] || ''} onChange={(e) => setFwInput((p) => ({ ...p, [f.id]: e.target.value }))} />
                <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: 'var(--space-2)' }}
                  disabled={!(fwInput[f.id] || '').trim() || out?.state === 'running'} onClick={() => void runFramework(f.id, f.prompt)}>
                  {out?.state === 'running' ? L(dict, '拆解中…', 'Working…') : L(dict, '开始拆解', 'Apply framework')}
                </button>
                {out && out.state !== 'running' && (
                  <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-4)', background: 'var(--portal-accent-soft)', borderRadius: 'var(--radius-md)', color: out.state === 'error' ? 'var(--portal-muted)' : 'var(--portal-ink)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{out.text}</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
