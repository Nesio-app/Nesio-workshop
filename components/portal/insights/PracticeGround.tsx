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
  pickDailyChallenge, nextChallenge, trapSource, type Challenge, type TrapCategory,
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
  const [atlasOpen, setAtlasOpen] = useState(false); // 图20:图鉴默认折叠

  function again() { setPick(null); setCh((c) => nextChallenge(c.trap.id, Date.now())); }

  const trap = ch.trap;
  const cat = CATEGORY_LABEL[trap.category];
  const traps = filter === 'all' ? THINKING_TRAPS : THINKING_TRAPS.filter((t) => t.category === filter);
  const fmtDay = (iso: string) => en
    ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : `${new Date(iso).getMonth() + 1}月${new Date(iso).getDate()}日`;

  return (
    <>
      {/* 2026-07-28 UI 精修(标注 图18):顶部「想磨的时候来…」+「认出过 N 种陷阱」两行划掉 ——
          进来先读两行自我介绍,今天那道题被推到屏幕外。出处改在讲解里逐条给(见 图19)。 */}

      {/* ── 今天一练(策展库确定性出题)── */}
      <div className="ng-sec"><span className="l">{L(dict, '今天一练', "Today's rep")}</span><span className="r">{L(dict, '闯关练习', 'Challenge')}</span></div>
      <div className="ng-today">
        <p className="ng-scene">「{ch.scene}」</p>
        <p className="ng-ques">{ch.question}</p>
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
            {/* 图19「这些解释科学么」:原来只写学科名,看不出是谁提出的 —— 补上首次提出的文献/实验。 */}
            <div className="ng-life">
              <span className="t">{L(dict, `出处 · ${cat.zh}`, `Source · ${cat.en}`)}</span>
              {trapSource(trap.id) || trap.domain}
            </div>
            <button type="button" className="ng-btn" style={{ width: '100%', marginTop: 13 }} onClick={again}>{L(dict, '下一题 ›', 'Next ›')}</button>
          </div>
        )}
        {pick == null && <p className="ng-quiet">{L(dict, '选一个看看 —— 敌人是那个陷阱,不是你', 'Pick one — the enemy is the trap, not you')}</p>}
      </div>

      <div className="ng-gap" />

      {/* ── 陷阱图鉴(策展库,分 6 类)── */}
      {/* 2026-07-28(标注 图20):右上「你在生活里遇见过的」+「37 种 · 遇见 N」计数行都划掉;
          整块改成可折叠(默认收起)—— 图鉴是想看的时候翻的,不该每次进练习场都铺满一屏。 */}
      <button type="button" className="ng-fold-head" aria-expanded={atlasOpen} onClick={() => setAtlasOpen((v) => !v)}>
        <span className="l">{L(dict, '陷阱图鉴', 'Trap atlas')}</span>
        <span className="ng-fold-caret" aria-hidden>{atlasOpen ? '⌃' : '⌄'}</span>
      </button>
      {atlasOpen && (<>
      <div className="ng-filters">
        <button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>{L(dict, '全部', 'All')}</button>
        {CATEGORY_ORDER.map((c) => (
          <button key={c} type="button" className={filter === c ? 'on' : ''} onClick={() => setFilter(c)}>{L(dict, CATEGORY_LABEL[c].zh, CATEGORY_LABEL[c].en)}</button>
        ))}
      </div>
      <div className="ng-grid">
        {traps.map((t) => {
          const isMet = met.has(t.id);
          const flipped = pop === t.id;
          return (
            // 图20:编号去掉;遇见过的按分类上色;点一下卡片翻面,背面就是解释(不再另起一块弹层)。
            // 没遇见过的也能翻 —— 图鉴本来就是用来读的,锁着反而没人翻。
            <div key={t.id} className={`ng-cell ng-flip${isMet ? ' met' : ' locked'}${flipped ? ' flipped' : ''}`}
              data-cat={t.category}
              onClick={() => setPop(flipped ? null : t.id)}
              role="button" tabIndex={0}
              aria-label={L(dict, t.name, t.nameEn)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPop(flipped ? null : t.id); } }}>
              <div className="ng-flip-in">
                <div className="ng-flip-f">
                  <Icon path={CATEGORY_LABEL[t.category].icon} cls="cic" />
                  <div className="cn">{L(dict, t.name, t.nameEn)}</div>
                  <div className="cs">{isMet ? L(dict, '遇见过', 'met') : L(dict, '还没遇到', 'not yet')}</div>
                </div>
                <div className="ng-flip-b">
                  <div className="bs">{t.spot}</div>
                  <div className="bw">{t.why}</div>
                  {metMemory[t.id] && (
                    <div className="be">{fmtDay(metMemory[t.id].at)} · {(metMemory[t.id].question || metMemory[t.id].context || '').slice(0, 28)}</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </>)}

    </>
  );
}
