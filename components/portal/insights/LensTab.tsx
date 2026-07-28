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

  /**
   * 挑可套镜头的记忆(2026-07-28,用户标注 图25「没有情绪,类的应该不关联」)。
   *
   * 原来只筛「有内容 + 不是人/地点」,于是日历项、天气信号、亚马逊订单确认邮件全排进来了 ——
   * 镜头是拿来看**自己的想法**的,给一条「约 4 小时后转多云」套认知扭曲镜头毫无意义。
   *
   * 现在两道门,都得过:
   *   ① 来路得是你自己留下的(手记 / 语音 / 照片)—— 日历 / 邮件 / 系统信号一律不进;
   *   ② 内容得有情绪或第一人称的判断(shouldNudge 的词表,或带「情绪」类标签)。
   * 宁可少,不要拿系统噪音凑数。
   */
  const memories = useMemo(() => {
    let nodes: LifeNode[] = [];
    try { nodes = getLifeGraph(); } catch { return []; }
    const SELF_SOURCES = new Set(['manual', 'voice', 'photo']);
    const FEELING_TAGS = ['情绪', '心情', 'mood', 'emotion', 'healing', '手记'];
    return nodes
      .filter((n) => {
        if (nodeText(n).length < 8) return false;
        if (n.type === 'person' || n.type === 'place') return false;
        if (!SELF_SOURCES.has(n.source)) return false;
        const tags = (n.tags || []).map((t) => t.toLowerCase());
        const tagged = FEELING_TAGS.some((t) => tags.some((x) => x.includes(t.toLowerCase())));
        return tagged || shouldNudge(nodeText(n));
      })
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
        <div className="ng-done" style={{ marginTop: 16 }}>{L(dict, '还没有可以拆的想法 —— 说一句或写一笔带着感受的记录,它就会出现在这里。(日历、邮件、天气这类不进镜头)', 'Nothing to unpack yet — jot or say something with a feeling in it and it shows up here. (Calendar, email and weather never do.)')}</div>
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
