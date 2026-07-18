'use client';

/**
 * PracticeGround — 练习场(artifact 59587b8d)。用户定:想磨的时候来,你去找它(不推给你)。
 * ① 每日一练:照真实记忆改写的场景题 → 选项 → 讲解(怎么回事/怎么一眼认出/连回你的生活)。
 * ② 利器图鉴:24 把思维利器分 5 维,你在自己生活里一把把认出(met 从回看流派生,可点看撞见的记忆)。
 * 走 app 主题 token + 统一 --ng-ease。题从真实记忆改写,不搞题库/段位。
 */

import { useEffect, useMemo, useState } from 'react';
import { growthHistory, type GrowthAnswer } from '@/lib/portal/growth-guide';
import {
  THINKING_TOOLS, TOOL_DIM_LABEL, DIM_ORDER, DIM_ICON, toolById, toolsMet, masteryLine,
  pickDailyStatic, pickPracticeSeed, generatePractice, STATIC_PRACTICES, type Practice, type ToolDim,
} from '@/lib/portal/practice';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

function Icon({ path, cls }: { path: string; cls: string }) {
  return <svg className={cls} viewBox="0 0 24 24" aria-hidden dangerouslySetInnerHTML={{ __html: path }} />;
}

export default function PracticeGround() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const en = dict === 'en';

  const history = useMemo<GrowthAnswer[]>(() => { try { return growthHistory(); } catch { return []; } }, []);
  const met = useMemo(() => toolsMet(history), [history]);
  const mastery = masteryLine(history);
  // met 工具 → 撞见它的那条真实记忆(取第一条提到它的回看)
  const metMemory = useMemo(() => {
    const m: Record<string, GrowthAnswer> = {};
    for (const t of THINKING_TOOLS) {
      if (!met.has(t.id)) continue;
      const hit = history.find((h) => `${h.question || ''} ${h.answer || ''} ${h.context || ''}`.includes(t.name));
      if (hit) m[t.id] = hit;
    }
    return m;
  }, [history, met]);

  const [practice, setPractice] = useState<Practice>(() => pickDailyStatic());
  const [staticIdx, setStaticIdx] = useState(0);
  const [pick, setPick] = useState<number | null>(null);
  const [filter, setFilter] = useState<ToolDim | 'all'>('all');
  const [pop, setPop] = useState<string | null>(null);

  // 进场:能生成就用真实记忆改写一题(失败/无 key/无记忆 → 保留静态起手题)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seed = pickPracticeSeed();
      if (!seed) return;
      const p = await generatePractice(seed, en ? 'en' : 'zh');
      if (p && !cancelled) { setPractice(p); setPick(null); }
    })();
    return () => { cancelled = true; };
  }, [en]);

  async function nextQuestion() {
    setPick(null);
    const seed = pickPracticeSeed();
    if (seed) {
      const p = await generatePractice(seed, en ? 'en' : 'zh');
      if (p) { setPractice(p); return; }
    }
    const ni = (staticIdx + 1) % STATIC_PRACTICES.length;
    setStaticIdx(ni);
    setPractice(STATIC_PRACTICES[ni]);
  }

  const tools = filter === 'all' ? THINKING_TOOLS : THINKING_TOOLS.filter((t) => t.dim === filter);
  const fmtDay = (iso: string) => en
    ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : `${new Date(iso).getMonth() + 1}月${new Date(iso).getDate()}日`;

  return (
    <>
      <p className="ng-sub">{L(dict, '想磨的时候来 —— 不推给你,你来找它', 'Come when you want to sharpen — you find it, it won’t push')}</p>
      <p className="ng-mastery">{L(dict, mastery.zh, mastery.en)}</p>

      {/* ── 每日一练 ── */}
      <div className="ng-sec"><span className="l">{L(dict, '今天一练', "Today's rep")}</span><span className="r">{L(dict, '场景来自你的生活', 'From your own life')}</span></div>
      <div className="ng-today">
        <span className="ng-chip blind">{L(dict, TOOL_DIM_LABEL[practice.dim].zh, TOOL_DIM_LABEL[practice.dim].en)} · {L(dict, practice.toolName, practice.toolNameEn)}</span>
        {practice.source && <p className="ng-src">{practice.source}</p>}
        <p className="ng-scene">{practice.scene}</p>
        <p className="ng-ques">{practice.question}</p>
        {practice.options.map((opt, i) => {
          const revealed = pick != null;
          const cls = !revealed ? 'ng-opt' : i === practice.correctIndex ? 'ng-opt right' : i === pick ? 'ng-opt wrong' : 'ng-opt';
          return (
            <button key={i} type="button" className={cls} disabled={revealed} onClick={() => setPick(i)}>
              {String.fromCharCode(65 + i)}. {opt}
            </button>
          );
        })}
        {pick != null && (
          <div className="ng-reveal">
            <p style={{ fontWeight: 'var(--weight-semibold)', margin: '0 0 8px', color: pick === practice.correctIndex ? 'var(--status-go)' : 'var(--status-gentle)' }}>
              {pick === practice.correctIndex ? L(dict, '认出来了 ——', 'Spotted it —') : L(dict, '再看看 ——', 'Look again —')} {L(dict, `这是「${practice.toolName}」`, `this is “${practice.toolNameEn}”`)}
            </p>
            <div className="ng-lrow"><span className="k">{L(dict, '怎么回事', 'What it is')}</span><span className="v">{practice.lesson.how}</span></div>
            <div className="ng-lrow"><span className="k">{L(dict, '怎么一眼认出', 'How to spot it')}</span><span className="v">{practice.lesson.spot}</span></div>
            <div className="ng-life"><span className="t">{L(dict, '连回你的生活', 'Back to your life')}</span>{practice.lesson.life}</div>
            <button type="button" className="ng-btn" style={{ width: '100%', marginTop: 13 }} onClick={() => void nextQuestion()}>{L(dict, '再来一题', 'Another one')}</button>
          </div>
        )}
        {pick == null && <p className="ng-quiet">{L(dict, '选一个看看 —— 敌人是那个陷阱,不是你', 'Pick one — the enemy is the trap, not you')}</p>}
      </div>

      <div className="ng-gap" />

      {/* ── 利器图鉴 ── */}
      <div className="ng-sec"><span className="l">{L(dict, '利器图鉴', 'Tool atlas')}</span><span className="r">{L(dict, '你在生活里遇见过的', 'The ones you’ve met')}</span></div>
      <p style={{ fontSize: '0.78rem', color: 'var(--ng-faint)', margin: '0 0 11px' }}>
        {L(dict, `${THINKING_TOOLS.length} 把思维利器 · 遇见 `, `${THINKING_TOOLS.length} thinking tools · met `)}
        <b style={{ color: 'var(--portal-accent)' }}>{met.size}</b>
        {L(dict, ' · 名字都看得见,不搞盲盒 —— 你是在自己的生活里一把把认出它们', ' · names all visible — you recognize them in your own life')}
      </p>
      <div className="ng-filters">
        <button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>{L(dict, '全部', 'All')}</button>
        {DIM_ORDER.map((d) => (
          <button key={d} type="button" className={filter === d ? 'on' : ''} onClick={() => setFilter(d)}>{L(dict, TOOL_DIM_LABEL[d].zh, TOOL_DIM_LABEL[d].en)}</button>
        ))}
      </div>
      <div className="ng-grid">
        {tools.map((t) => {
          const idx = THINKING_TOOLS.indexOf(t);
          const isMet = met.has(t.id);
          return (
            <div key={t.id} className={`ng-cell ${isMet ? 'met' : 'locked'}`}
              onClick={isMet ? () => setPop(pop === t.id ? null : t.id) : undefined}
              role={isMet ? 'button' : undefined} tabIndex={isMet ? 0 : undefined}
              onKeyDown={isMet ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPop(pop === t.id ? null : t.id); } } : undefined}>
              <div className="cnum">{String(idx + 1).padStart(2, '0')}</div>
              <Icon path={DIM_ICON[t.dim]} cls="cic" />
              <div className="cn">{L(dict, t.name, t.nameEn)}</div>
              <div className="cs">{isMet ? L(dict, '遇见过', 'met') : L(dict, '还没遇到', 'not yet')}</div>
            </div>
          );
        })}
      </div>
      {pop && toolById(pop) && (
        <div className="ng-pop">
          <p className="pt">{L(dict, `${toolById(pop)!.name} · 你在生活里遇见过`, `${toolById(pop)!.nameEn} · you’ve met it`)}</p>
          <div>{L(dict, '同一个思维陷阱,底层是公共的;但你认出它的那个场景,是你自己的。', 'The trap is universal; the scene where you caught it is yours.')}</div>
          {metMemory[pop]
            ? <div className="pe">{fmtDay(metMemory[pop].at)} · {metMemory[pop].question || metMemory[pop].context}</div>
            : <div className="pe">{toolById(pop)!.spot}</div>}
        </div>
      )}

      <p className="ng-quiet" style={{ marginTop: 26, textAlign: 'left', lineHeight: 1.65 }}>
        {L(dict, '题从你的真实记忆改写(换了细节,留了那个念头);图鉴是你在生活里遇见过的陷阱,不是抽象解锁。进步只跟自己比,不搞段位。',
          'Questions are rewritten from your real memories; the atlas is traps you’ve met in life, not abstract unlocks. Progress is only vs. your past self.')}
      </p>
    </>
  );
}
