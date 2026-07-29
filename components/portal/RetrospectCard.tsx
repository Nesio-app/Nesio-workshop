'use client';

/**
 * RetrospectCard — 今天页「回顾卡(去年今日)」(批次 105,设计规范今天页第 2 段)。
 *
 * 念念主动翻出一条旧记忆(周年/月纪念优先,详见 lib/portal/retrospect),放问候下面。
 * 自读全量 life-graph 挑一条;没有符合的不渲染(不硬凑)。点开走 onOpen(nodeId)→
 * 复用 TodayFeed 的 MemoryNodeDetail 详情。文案是念念口吻,衬线嗓音。
 *
 * 批次 167:用户实锤「顶部卡向右拉不动」—— 加右滑收起(带提示),小位移仍是点开。
 * Pointer + Touch 双绑(iOS PWA 的 Pointer 对水平手势不稳)。
 */

import { useEffect, useRef, useState } from 'react';
import { getLifeGraph } from '@/lib/portal/life-graph';
import { pickRetrospect, type Retrospect } from '@/lib/portal/retrospect';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { localDayKey } from '@/lib/portal/local-day';

const RETRO_DISMISS_KEY = 'nesio-retro-dismissed-v1';
function todayStr() { return localDayKey(); }

export default function RetrospectCard({ onOpen }: { onOpen: (nodeId: string) => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [retro, setRetro] = useState<Retrospect | null>(null);
  const [dx, setDx] = useState(0);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    try {
      const r = pickRetrospect(getLifeGraph() as unknown as Parameters<typeof pickRetrospect>[0]);
      if (!r) return;
      // 当天收起过就不再出(次日自然复活)
      const d = JSON.parse(localStorage.getItem(RETRO_DISMISS_KEY) || '{}') as { date?: string; nodeId?: string };
      if (d.date === todayStr() && d.nodeId === r.nodeId) return;
      setRetro(r);
    } catch { /* 回顾失败不打扰首屏 */ }
  }, []);

  function begin(x: number, y: number) { startRef.current = { x, y }; }
  function move(x: number, y: number) {
    if (!startRef.current) return;
    const ddx = x - startRef.current.x;
    const ddy = y - startRef.current.y;
    if (Math.abs(ddx) > Math.abs(ddy) && Math.abs(ddx) > 8) setDx(Math.max(-40, Math.min(140, ddx)));
  }
  function end(x: number) {
    const s = startRef.current;
    startRef.current = null;
    const ddx = s ? x - s.x : 0;
    setDx(0);
    if (ddx > 72) { dismiss(); return; }               // 右滑 = 收起(今天不再出)
    if (Math.abs(ddx) < 8 && retro) onOpen(retro.nodeId); // 轻点 = 打开那条旧记忆
  }
  function dismiss() {
    try { localStorage.setItem(RETRO_DISMISS_KEY, JSON.stringify({ date: todayStr(), nodeId: retro?.nodeId })); } catch { /* ignore */ }
    setRetro(null);
  }

  if (!retro) return null;
  return (
    <div className="nesio-retro-wrap">
      {dx > 0 && (
        <span
          className={`nesio-swipe-hint nesio-swipe-hint--right${dx > 72 ? ' nesio-swipe-hint--ready' : ''}`}
          aria-hidden
          style={{ opacity: Math.min(1, dx / 72) }}
        >{L(dict, '收起', 'Dismiss')}</span>
      )}
      <div
        className="nesio-retro-card"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(retro.nodeId); }}
        onPointerDown={(e) => begin(e.clientX, e.clientY)}
        onPointerMove={(e) => move(e.clientX, e.clientY)}
        onPointerUp={(e) => end(e.clientX)}
        onPointerCancel={() => { startRef.current = null; setDx(0); }}
        onTouchStart={(e) => { const t = e.touches[0]; if (t) begin(t.clientX, t.clientY); }}
        onTouchMove={(e) => { const t = e.touches[0]; if (t) move(t.clientX, t.clientY); }}
        onTouchEnd={(e) => end(e.changedTouches[0]?.clientX ?? startRef.current?.x ?? 0)}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? 'none' : 'transform 0.2s ease', touchAction: 'pan-y' }}
      >
        <span className="nesio-retro-kicker">{L(dict, retro.labelZh, retro.labelEn)}</span>
        <span className="nesio-retro-name">{retro.name}</span>
        <span className="nesio-retro-hint">{L(dict, '还记得吗?', 'Remember this?')}</span>
      </div>
    </div>
  );
}
