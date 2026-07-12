'use client';

/**
 * RetrospectCard — 今天页「回顾卡(去年今日)」(批次 105,设计规范今天页第 2 段)。
 *
 * 念念主动翻出一条旧记忆(周年/月纪念优先,详见 lib/portal/retrospect),放问候下面。
 * 自读全量 life-graph 挑一条;没有符合的不渲染(不硬凑)。点开走 onOpen(nodeId)→
 * 复用 TodayFeed 的 MemoryNodeDetail 详情。文案是念念口吻,衬线嗓音。
 */

import { useEffect, useState } from 'react';
import { getLifeGraph } from '@/lib/portal/life-graph';
import { pickRetrospect, type Retrospect } from '@/lib/portal/retrospect';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

export default function RetrospectCard({ onOpen }: { onOpen: (nodeId: string) => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [retro, setRetro] = useState<Retrospect | null>(null);

  useEffect(() => {
    try {
      setRetro(pickRetrospect(getLifeGraph() as unknown as Parameters<typeof pickRetrospect>[0]));
    } catch { /* 回顾失败不打扰首屏 */ }
  }, []);

  if (!retro) return null;
  return (
    <button type="button" className="nesio-retro-card" onClick={() => onOpen(retro.nodeId)}>
      <span className="nesio-retro-kicker">{L(dict, retro.labelZh, retro.labelEn)}</span>
      <span className="nesio-retro-name">{retro.name}</span>
      <span className="nesio-retro-hint">{L(dict, '还记得吗?', 'Remember this?')}</span>
    </button>
  );
}
