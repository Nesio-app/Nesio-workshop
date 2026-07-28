'use client';

/**
 * MemoryLensSheet — 镜头看记忆(artifact d7bd8990)。长在记忆详情上的「镜头库」底部弹层。
 * 吃这条记忆当输入(不用再打字)→ 选一个镜头当场拆(帮你吵/CBT/五问/事前验尸/逻辑谬误;
 * 投资类灰锁)→ 分层结果 + 念念还记得(记忆优势)→ 存回这条记忆 + 记入心智维度。
 * 走 app 主题 token + 统一 --ng-ease;NesioSheet(Vaul)底部手势。
 */

import { useMemo, useState } from 'react';
import NesioSheet from './ui/NesioSheet';
import { getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';
import { recordGrowthAnswer } from '@/lib/portal/growth-guide';
import { DIMENSION_LABEL } from '@/lib/portal/growth-engine';
import { MEMORY_LENSES, lensesForMemory, applyLens, type MemoryLens, type LensResult } from '@/lib/portal/lens';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

function Ico({ path, cls }: { path: string; cls: string }) {
  return <svg className={cls} viewBox="0 0 24 24" aria-hidden dangerouslySetInnerHTML={{ __html: path }} />;
}

export default function MemoryLensSheet({ open, onOpenChange, node }: { open: boolean; onOpenChange: (o: boolean) => void; node: LifeNode }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const en = dict === 'en';
  const text = `${node.name}${node.attributes?.notes ? ' —— ' + node.attributes.notes : node.rawInput ? ' —— ' + node.rawInput : ''}`;

  const { recommended, rest, locked } = useMemo(() => lensesForMemory(text), [text]);
  const [applied, setApplied] = useState<MemoryLens | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LensResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);

  // 念念还记得:另一条更早、共享标签的记忆 = 记忆优势(别的工具做不到)
  const relatedHint = useMemo(() => {
    try {
      const others = getLifeGraph().filter((x) => x.id !== node.id && (x.tags || []).some((t) => (node.tags || []).includes(t)) && new Date(x.createdAt) < new Date(node.createdAt));
      const prev = others.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      if (!prev) return null;
      const d = new Date(prev.createdAt);
      return en ? `You logged something similar on ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} too` : `你 ${d.getMonth() + 1}/${d.getDate()} 也记过类似的一次`;
    } catch { return null; }
  }, [node, en]);

  async function apply(lens: MemoryLens) {
    if (lens.locked) return;
    setApplied(lens); setBusy(true); setResult(null); setFailed(false); setSaved(false);
    const r = await applyLens(lens, text, en ? 'en' : 'zh');
    setBusy(false);
    if (r) setResult(r); else setFailed(true);
  }
  function reset() { setApplied(null); setResult(null); setFailed(false); setSaved(false); }
  function saveBack() {
    if (!applied) return;
    recordGrowthAnswer({
      id: `lens:${applied.id}:${node.id}`, kind: 'dusty_memory', refId: `lens:${applied.id}:${node.id}`,
      question: L(dict, `用「${applied.name}」看:${node.name}`, `“${applied.nameEn}” on: ${node.name}`),
      questionEn: `“${applied.nameEn}” on: ${node.name}`, context: text.slice(0, 40), dimension: applied.dim,
    }, L(dict, `[${DIMENSION_LABEL[applied.dim].zh}] 看清了`, `[${DIMENSION_LABEL[applied.dim].en}] seen clearly`));
    setSaved(true);
  }

  const LensRow = ({ l, rec }: { l: MemoryLens; rec?: boolean }) => (
    <button type="button" className={`ng-lens${rec ? ' rec' : ''}${l.locked ? ' locked' : ''}`} disabled={l.locked} onClick={() => apply(l)}>
      <Ico path={l.icon} cls="li" />
      <span className="lt">
        <span className="ln">{L(dict, l.name, l.nameEn)}{rec && <span className="rc">{L(dict, '荐', 'Pick')}</span>}</span>
        <span className="ld">{L(dict, l.desc, l.descEn)}</span>
      </span>
    </button>
  );

  return (
    // elevated:这个抽屉是从洞察(fullscreen,z-930)里点开的 —— 不抬层就被整个盖住,
    // 表现成「点了卡片没反应」(2026-07-28 标注 图24)。
    <NesioSheet variant="bottom" elevated open={open} onOpenChange={onOpenChange} ariaLabel={L(dict, '用镜头看这条记忆', 'Look at this memory with a lens')}>
      <div className="nesio-growth">
        {!applied ? (
          <>
            <p style={{ fontSize: '1.05rem', fontWeight: 'var(--weight-semibold)', margin: '0 0 3px', color: 'var(--portal-ink)' }}>{L(dict, '用一个镜头看这条记忆', 'Look at this memory with a lens')}</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--portal-muted)', margin: '0 0 8px' }}>{L(dict, '同一套心智模型,套在你自己真实的事上', 'One mental model, applied to your own real moment')}</p>
            {recommended.length > 0 && <>
              <p className="ng-lbl">{L(dict, '为这条推荐', 'Picked for this one')}</p>
              {recommended.map((l) => <LensRow key={l.id} l={l} rec />)}
            </>}
            <p className="ng-lbl">{L(dict, '全部镜头', 'All lenses')}</p>
            {rest.map((l) => <LensRow key={l.id} l={l} />)}
            {locked.map((l) => (
              <div key={l.id} className="ng-lens locked">
                <Ico path={l.icon} cls="li" />
                <span className="lt"><span className="ln">{L(dict, l.name, l.nameEn)}</span><span className="ld">{L(dict, l.desc, l.descEn)}</span></span>
              </div>
            ))}
          </>
        ) : (
          <>
            <button type="button" className="ng-nav" onClick={reset}>
              <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>{L(dict, '换个镜头', 'Another lens')}
            </button>
            <p style={{ fontWeight: 'var(--weight-semibold)', fontSize: '0.98rem', margin: '0 0 12px', color: 'var(--portal-accent)' }}>
              {L(dict, applied.name, applied.nameEn)}
            </p>

            {busy ? (
              <p className="ng-quiet" style={{ textAlign: 'left' }}>{L(dict, '念念在用这个镜头看…', 'Nessa is looking through this lens…')}</p>
            ) : failed ? (
              <>
                <p className="ng-quiet" style={{ textAlign: 'left' }}>{L(dict, '这会儿没接上 —— 稍后再试一次(需登录 + AI 可用)。', "Couldn't reach the AI — try again shortly (needs sign-in).")}</p>
                <button type="button" className="ng-btn" style={{ width: '100%', marginTop: 10 }} onClick={() => apply(applied)}>{L(dict, '再试一次', 'Try again')}</button>
              </>
            ) : result ? (
              <>
                {result.layers.map((ly, i) => (
                  <div key={i} className="ng-lrow"><span className="k">{ly.k}</span><span className="v">{ly.v}</span></div>
                ))}
                {result.cta && <div className="ng-lrow"><span className="k">↳</span><span className="v">{result.cta}</span></div>}
                {relatedHint && (
                  <div className="ng-life"><span className="t">{L(dict, '念念还记得(这是别的工具做不到的)', 'Nessa remembers (other tools can’t)')}</span>{relatedHint} —— {L(dict, '也许是个值得留意的模式,不只是这一次。', 'maybe a pattern worth noticing, not just this once.')}</div>
                )}
                {saved ? (
                  <div className="ng-done" style={{ marginTop: 13 }}>{L(dict, `已存 · 记入「${DIMENSION_LABEL[applied.dim].zh}」维度 · 这条记忆现在带着你的回看`, `Saved · logged to “${DIMENSION_LABEL[applied.dim].en}” · this memory now carries your reflection`)}</div>
                ) : (
                  <button type="button" className="ng-btn" style={{ width: '100%', marginTop: 13 }} onClick={saveBack}>{L(dict, '存进这条记忆的回看', 'Save into this memory')}</button>
                )}
              </>
            ) : null}
          </>
        )}
      </div>
    </NesioSheet>
  );
}

export { MEMORY_LENSES };
