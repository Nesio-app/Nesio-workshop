'use client';

/**
 * LensTab — 成长下的「镜头」子 tab。镜头本要长在记忆上,做成 tab 就先给一个记忆挑选页:
 * 近期、情绪重的排前,点一条 → 弹出镜头库(MemoryLensSheet)当场拆。
 * 走 app 主题 token;文案/动效与成长其余两页一致。
 */

import { useMemo, useState } from 'react';
import { getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';
import { shouldNudge } from '@/lib/portal/lens';
import MemoryLensSheet from '../MemoryLensSheet';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

function nodeText(n: LifeNode): string {
  return `${n.name}${n.attributes?.notes ? ' —— ' + (n.attributes.notes as string) : n.rawInput ? ' —— ' + n.rawInput : ''}`.trim();
}

export default function LensTab() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const en = dict === 'en';
  const [openNode, setOpenNode] = useState<LifeNode | null>(null);

  // 挑可套镜头的记忆:有内容的;情绪重的排前,再按新近
  const memories = useMemo(() => {
    let nodes: LifeNode[] = [];
    try { nodes = getLifeGraph(); } catch { return []; }
    return nodes
      .filter((n) => nodeText(n).length >= 8 && n.type !== 'person' && n.type !== 'place')
      .map((n) => ({ n, heavy: shouldNudge(nodeText(n)), t: new Date(n.createdAt).getTime() }))
      .sort((a, b) => (a.heavy === b.heavy ? b.t - a.t : a.heavy ? -1 : 1))
      .slice(0, 12);
  }, []);

  const fmtDay = (iso: string) => en
    ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : `${new Date(iso).getMonth() + 1}月${new Date(iso).getDate()}日`;

  return (
    <>
      <div className="ng-hd">
        <svg viewBox="0 0 24 24" aria-hidden><path d="M2 12l4-7h12l4 7-10 8z" /><path d="M6 5l6 7 6-7M12 12v8" /></svg>
        <h1>{L(dict, '镜头', 'Lenses')}</h1>
      </div>
      <p className="ng-sub">{L(dict, '挑一段记忆,套个镜头看看 —— 同一套心智模型,套在你真实的事上', 'Pick a memory, look through a lens — one model, on your own real moment')}</p>

      {memories.length === 0 ? (
        <div className="ng-done" style={{ marginTop: 16 }}>{L(dict, '先去记点什么 —— 有了记忆,就能在它上面套镜头看清楚一点。', 'Capture something first — then you can hold a lens up to it.')}</div>
      ) : (
        <div style={{ marginTop: 16 }}>
          <div className="ng-sec"><span className="l">{L(dict, '最近的记忆', 'Recent memories')}</span><span className="r">{L(dict, '情绪重的排在前', 'heavy ones first')}</span></div>
          {memories.map(({ n, heavy }) => (
            <button key={n.id} type="button" className={`ng-mem${heavy ? ' heavy' : ''}`} onClick={() => setOpenNode(n)}>
              <div className="ng-mem-meta">
                <span className="dot" />
                {fmtDay(n.createdAt)}
                {heavy && ` · ${L(dict, '情绪重', 'heavy')}`}
                <span className="go">{L(dict, '用镜头看看 ›', 'Look ›')}</span>
              </div>
              <p className="ng-mem-text">{nodeText(n)}</p>
              {(n.tags || []).length > 0 && (
                <div className="ng-mem-tags">{(n.tags || []).slice(0, 3).map((t) => <span key={t} className="ng-mem-tag">{t}</span>)}</div>
              )}
            </button>
          ))}
        </div>
      )}

      <p className="ng-quiet" style={{ marginTop: 24, textAlign: 'left', lineHeight: 1.65 }}>
        {L(dict, '镜头库里有:前提·事实·逻辑·情绪(帮你吵)、认知扭曲识别、五问根因、事前验尸、逻辑谬误…… 拆完存回这条记忆,并记入你的心智维度。',
          'Lenses include: premise·fact·logic·feeling, cognitive distortion, five whys, pre-mortem, fallacy… Saved back onto the memory and into your mind facets.')}
      </p>

      {openNode && <MemoryLensSheet open={openNode !== null} onOpenChange={(o) => { if (!o) setOpenNode(null); }} node={openNode} />}
    </>
  );
}
