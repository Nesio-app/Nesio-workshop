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
      {/* 2026-07-28 UI 精修(标注 图24):顶部两行说明划掉 —— 卡片右上角每条都写着「用镜头看看 ›」,
          说明句只是把真正能点的东西往下推。 */}
      {memories.length === 0 ? (
        <div className="ng-done" style={{ marginTop: 16 }}>{L(dict, '先去记点什么 —— 有了记忆,就能在它上面套镜头看清楚一点。', 'Capture something first — then you can hold a lens up to it.')}</div>
      ) : (
        <div style={{ marginTop: 16 }}>
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

      {openNode && <MemoryLensSheet open={openNode !== null} onOpenChange={(o) => { if (!o) setOpenNode(null); }} node={openNode} />}
    </>
  );
}
