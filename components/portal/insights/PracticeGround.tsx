'use client';

/**
 * PracticeGround — 练习场。用户定:别让 LLM 随机编谬误,靠**策展知识库 + 确定性算法**出题。
 * ① 今天一练:从 thinking-catalog 确定性造题(正确=命中的陷阱,干扰=同类,讲解取库)——专业、稳、可离线。
 * ② 陷阱图鉴:40 条思维陷阱分 6 类(逻辑谬误/认知偏差/决策偏差/统计偏差/认知扭曲/心理效应),
 *    met 从回看流派生(你在生活里认出过 = 点亮)。走 app 主题 token。
 */

import { useMemo, useState } from 'react';
import { growthHistory, type GrowthAnswer } from '@/lib/portal/growth-guide';
import {
  THINKING_TRAPS, CATEGORY_LABEL, CATEGORY_ORDER, trapById, trapsMet,
  pickDailyChallenge, nextChallenge, type Challenge, type TrapCategory,
} from '@/lib/portal/thinking-catalog';
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
  const met = useMemo(() => trapsMet(history), [history]);
  const metMemory = useMemo(() => {
    const m: Record<string, GrowthAnswer> = {};
    for (const t of THINKING_TRAPS) {
      if (!met.has(t.id)) continue;
      const hit = history.find((h) => `${h.question || ''} ${h.answer || ''} ${h.context || ''}`.includes(t.name));
      if (hit) m[t.id] = hit;
    }
    return m;
  }, [history, met]);

  const [ch, setCh] = useState<Challenge>(() => pickDailyChallenge());
  const [pick, setPick] = useState<number | null>(null);
  const [filter, setFilter] = useState<TrapCategory | 'all'>('all');
  const [pop, setPop] = useState<string | null>(null);

  function again() { setPick(null); setCh((c) => nextChallenge(c.trap.id, Date.now())); }

  const trap = ch.trap;
  const cat = CATEGORY_LABEL[trap.category];
  const traps = filter === 'all' ? THINKING_TRAPS : THINKING_TRAPS.filter((t) => t.category === filter);
  const fmtDay = (iso: string) => en
    ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : `${new Date(iso).getMonth() + 1}月${new Date(iso).getDate()}日`;

  return (
    <>
      <p className="ng-sub">{L(dict, '想磨的时候来 —— 一条条思维陷阱,来自成熟研究,不是随口编的', 'Come to sharpen — every trap here is from real research, not made up')}</p>
      <p className="ng-mastery">{met.size > 0 ? L(dict, `你在生活里认出过 ${met.size} 种思维陷阱了`, `You've spotted ${met.size} traps in real life`) : L(dict, '练着练着,你会越来越会认出这些陷阱', 'Keep practicing — you’ll start spotting these everywhere')}</p>

      {/* ── 今天一练(策展库确定性出题)── */}
      <div className="ng-sec"><span className="l">{L(dict, '今天一练', "Today's rep")}</span><span className="r">{L(dict, '闯关练习', 'Challenge')}</span></div>
      <div className="ng-today">
        <p className="ng-scene">「{ch.scene}」</p>
        <p className="ng-ques">↓ {ch.question}</p>
        {ch.options.map((opt, i) => {
          const revealed = pick != null;
          const cls = !revealed ? 'ng-opt' : i === ch.correctIndex ? 'ng-opt right' : i === pick ? 'ng-opt wrong' : 'ng-opt';
          return (
            <button key={i} type="button" className={cls} disabled={revealed} onClick={() => setPick(i)}>
              {String.fromCharCode(65 + i)}. {opt}
            </button>
          );
        })}
        {pick != null && (
          <div className="ng-reveal">
            <p style={{ fontWeight: 'var(--weight-semibold)', margin: '0 0 4px', color: pick === ch.correctIndex ? 'var(--status-go)' : 'var(--status-gentle)' }}>
              {pick === ch.correctIndex ? L(dict, '答对了 ✓', 'Correct ✓') : L(dict, '答错了 ✗', 'Not quite ✗')} · {L(dict, trap.name, trap.nameEn)} <span style={{ fontWeight: 'var(--weight-regular)', color: 'var(--portal-muted)' }}>{trap.nameEn}</span>
            </p>
            <span className="ng-chip blind" style={{ marginBottom: 10 }}>{trap.principle ? L(dict, trap.principle, trap.principle) : L(dict, cat.zh, cat.en)}</span>
            <div className="ng-lrow"><span className="k">{L(dict, '一句话识破', 'Spot it')}</span><span className="v">{trap.spot}</span></div>
            <div className="ng-lrow"><span className="k">{L(dict, '为什么中招', 'Why it lands')}</span><span className="v">{trap.why}</span></div>
            <div className="ng-life"><span className="t">{L(dict, `出处 · ${cat.zh}`, `Source · ${cat.en}`)}</span>{trap.domain}</div>
            <button type="button" className="ng-btn" style={{ width: '100%', marginTop: 13 }} onClick={again}>{L(dict, '下一题 ›', 'Next ›')}</button>
          </div>
        )}
        {pick == null && <p className="ng-quiet">{L(dict, '选一个看看 —— 敌人是那个陷阱,不是你', 'Pick one — the enemy is the trap, not you')}</p>}
      </div>

      <div className="ng-gap" />

      {/* ── 陷阱图鉴(策展库,分 6 类)── */}
      <div className="ng-sec"><span className="l">{L(dict, '陷阱图鉴', 'Trap atlas')}</span><span className="r">{L(dict, '你在生活里遇见过的', 'The ones you’ve met')}</span></div>
      <p style={{ fontSize: '0.78rem', color: 'var(--ng-faint)', margin: '0 0 11px' }}>
        {L(dict, `${THINKING_TRAPS.length} 种思维陷阱 · 遇见 `, `${THINKING_TRAPS.length} traps · met `)}
        <b style={{ color: 'var(--portal-accent)' }}>{met.size}</b>
        {L(dict, ' · 来自经济学 / 心理学 / 逻辑学 / 统计学,不是抽象解锁,是在你生活里一条条认出', ' · from economics, psychology, logic, statistics — recognized in your own life')}
      </p>
      <div className="ng-filters">
        <button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>{L(dict, '全部', 'All')}</button>
        {CATEGORY_ORDER.map((c) => (
          <button key={c} type="button" className={filter === c ? 'on' : ''} onClick={() => setFilter(c)}>{L(dict, CATEGORY_LABEL[c].zh, CATEGORY_LABEL[c].en)}</button>
        ))}
      </div>
      <div className="ng-grid">
        {traps.map((t) => {
          const idx = THINKING_TRAPS.indexOf(t);
          const isMet = met.has(t.id);
          return (
            <div key={t.id} className={`ng-cell ${isMet ? 'met' : 'locked'}`}
              onClick={isMet ? () => setPop(pop === t.id ? null : t.id) : undefined}
              role={isMet ? 'button' : undefined} tabIndex={isMet ? 0 : undefined}
              onKeyDown={isMet ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPop(pop === t.id ? null : t.id); } } : undefined}>
              <div className="cnum">{String(idx + 1).padStart(2, '0')}</div>
              <Icon path={CATEGORY_LABEL[t.category].icon} cls="cic" />
              <div className="cn">{L(dict, t.name, t.nameEn)}</div>
              <div className="cs">{isMet ? L(dict, '遇见过', 'met') : L(dict, '还没遇到', 'not yet')}</div>
            </div>
          );
        })}
      </div>
      {pop && trapById(pop) && (
        <div className="ng-pop">
          <p className="pt">{L(dict, trapById(pop)!.name, trapById(pop)!.nameEn)} · {L(dict, CATEGORY_LABEL[trapById(pop)!.category].zh, CATEGORY_LABEL[trapById(pop)!.category].en)}</p>
          <div>{trapById(pop)!.spot} —— {trapById(pop)!.why}</div>
          {metMemory[pop] && <div className="pe">{L(dict, '你在生活里撞见它:', 'You met it in life: ')}{fmtDay(metMemory[pop].at)} · {metMemory[pop].question || metMemory[pop].context}</div>}
        </div>
      )}

      <p className="ng-quiet" style={{ marginTop: 26, textAlign: 'left', lineHeight: 1.65 }}>
        {L(dict, '题目由策展知识库确定性生成(正确答案与讲解都来自成熟研究,不是大模型随口给的);图鉴是你在生活里遇见过的陷阱。进步只跟自己比,不搞段位。',
          'Questions are generated from a curated knowledge base (answers and explanations come from established research, not an LLM guessing). The atlas is traps you’ve met. Progress is only vs. your past self.')}
      </p>
    </>
  );
}
