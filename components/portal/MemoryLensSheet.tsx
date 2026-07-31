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
import { isTopicTag } from '@/lib/portal/topic-tags';
import { recordGrowthAnswer } from '@/lib/portal/growth-guide';
import { DIMENSION_LABEL } from '@/lib/portal/growth-engine';
import { MEMORY_LENSES, lensesForMemory, applyLens, lensEcho, type MemoryLens, type LensResult } from '@/lib/portal/lens';
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

  const { recommended, rest, locked, withheldPersonal } = useMemo(() => lensesForMemory(text), [text]);
  const [applied, setApplied] = useState<MemoryLens | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LensResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);

  // 念念还记得:另一条更早、**共享同一个主题标签**的记忆 = 记忆优势(别的工具做不到)。
  //
  // Bug4 图6「念念还记得的内容逻辑正确吗?」—— 原来不对,而且错法和「健身邮件被认成
  // 健康打卡」是同一族:它对 tag **一视同仁**地取交集。可是记忆上挂的标签一大半根本
  // 不是主题 —— 采集方式(手记 / Voice)、来源(邮件 / flomo / 日历)、内部维度
  // (domain: / facet:)。任意两条邮件都共享「邮件」,于是这句「你 X/Y 也记过类似的一次」
  // 对**几乎任何一条记忆**都会出现,而两条之间毫无关系。它不是在回忆,是在凑数。
  //
  // 改三处:
  //  ① 只认主题标签 —— isTopicTag 是仓库里「什么算主题」的唯一判据(主题门也用它),
  //     再挡掉 domain:/facet: 这类内部前缀;
  //  ② 把**共享的那个标签**印出来。说不出凭什么像,这句话就没法被用户检验;
  //  ③ 只有更早的同标签记忆 ≥2 条才敢说「模式」。n=1 就说模式是硬凑。
  const relatedHint = useMemo(() => {
    try {
      const echo = lensEcho(node, getLifeGraph(), isTopicTag);
      if (!echo) return null;
      const d = new Date(echo.at);
      const day = en ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : `${d.getMonth() + 1}/${d.getDate()}`;
      return {
        text: en
          ? `You logged “${echo.tag}” on ${day} too${echo.many ? ` — ${echo.count} times before this` : ''}`
          : `你 ${day} 也记过「${echo.tag}」${echo.many ? ` —— 在这之前一共 ${echo.count} 次` : ''}`,
        many: echo.many,
        background: echo.background,
      };
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
            {/* 2026-07-29 标注(Bug4 P4):标题与副标题划掉 —— 弹层本身就是"挑个镜头",
                两行说明只是把镜头列表往下推。sheet 的 ariaLabel 已承担无障碍标题。 */}
            {recommended.length > 0 && <>
              <p className="ng-lbl">{L(dict, '为这条推荐', 'Picked for this one')}</p>
              {recommended.map((l) => <LensRow key={l.id} l={l} rec />)}
            </>}
            <p className="ng-lbl">{L(dict, '全部镜头', 'All lenses')}</p>
            {rest.map((l) => <LensRow key={l.id} l={l} />)}
            {/* #35:「前提·事实·逻辑·情绪」「认知扭曲识别」拆的是**人说的话**。
                套在一条系统通知上,输出的「情绪」一栏只能生硬地编 ——
                与其让用户挨个点开发现都很勉强,不如直接说清楚为什么没有它们。 */}
            {withheldPersonal > 0 && (
              <p className="ng-quiet" style={{ textAlign: 'left', marginTop: 8 }}>
                {L(dict, '这条像是事务性记录 —— 拆「你的前提 / 情绪」那几个镜头先收起来了,它们是给你自己说的话准备的。',
                  'This reads like a transactional record — the lenses that unpack your premises and feelings are tucked away; they are meant for things you said yourself.')}
              </p>
            )}
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
            <p style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-body)', margin: '0 0 12px', color: 'var(--portal-accent)' }}>
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
                  <div className="ng-life">
                    {/* 图6:标题里那句「这是别的工具做不到的」删掉 —— 自夸不是内容。
                        「模式」只在真有 ≥2 条更早的同标签记忆时才说,n=1 就把话说完即止。 */}
                    <span className="t">{L(dict, '念念还记得', 'Nessa remembers')}</span>
                    {relatedHint.text}
                    {relatedHint.many && ` —— ${L(dict, '也许是个值得留意的模式,不只是这一次。', 'maybe a pattern worth noticing, not just this once.')}`}
                    {/* #36:天天出现的东西不是模式。lensEcho 判成背景常量时不许说「模式」,
                        还得说清它为什么天天出现 —— 否则用户会以为自己在反复关注它。 */}
                    {relatedHint.background && ` —— ${L(dict, '不过它几乎天天出现,更像是这类记录里固定带的名字,不是你最近在关注它。', 'It shows up nearly every day though — more a fixed name in this kind of record than something you have been focusing on.')}`}
                  </div>
                )}
                {saved ? (
                  <div className="ng-done" style={{ marginTop: 13 }}>{L(dict, `已存 · 记入「${DIMENSION_LABEL[applied.dim].zh}」维度 · 这条记忆现在带着你的回看`, `Saved · logged to “${DIMENSION_LABEL[applied.dim].en}” · this memory now carries your reflection`)}</div>
                ) : (
                  <button type="button" className="ng-btn" style={{ width: '100%', marginTop: 13 }} onClick={saveBack}>{L(dict, '存入记忆', 'Save to memory')}</button>
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
