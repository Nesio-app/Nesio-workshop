'use client';

/**
 * MoodWheel — 心情系统情绪转盘(mood-wheel2)点选版,纯 HTML 绝对定位(不用 SVG)。
 * 用 HTML 圆点是为了避开 iOS PWA 里「SVG 放进可滚动 sheet 下半圈不重绘/被切」的老坑;
 * 12 情绪按同一角度(开心正上、顺时针)排一圈,复用 mood.ts 的语义色;选中点放大描白边,中心大圈染当前色。
 */

import { EMOTIONS } from '@/lib/portal/mood';

const N = EMOTIONS.length;
const RING = 37; // 圆点中心所在环半径(容器宽度的百分比)
const dotPct = (i: number): { left: number; top: number } => {
  const a = ((i * 360) / N - 90) * (Math.PI / 180);
  return { left: 50 + RING * Math.cos(a), top: 50 + RING * Math.sin(a) };
};

export default function MoodWheel({ value, onPick, en }: { value: string | null; onPick: (id: string) => void; en: boolean }) {
  const sel = value ? EMOTIONS.find((e) => e.id === value) : null;
  const lbl = (e: typeof EMOTIONS[number]) => (en ? e.labelEn : e.label);
  return (
    <div className="ng-wheel" role="group" aria-label={en ? 'Mood wheel' : '情绪转盘'}>
      {EMOTIONS.map((em, i) => {
        const on = value === em.id;
        const p = dotPct(i);
        return (
          <button key={em.id} type="button" className={`ng-wheel-dot${on ? ' on' : ''}`}
            style={{ left: `${p.left}%`, top: `${p.top}%` }} aria-pressed={on} aria-label={lbl(em)}
            onClick={() => onPick(em.id)}>
            <span className="d" style={{ background: em.color }} aria-hidden />
            <span className="l">{lbl(em)}</span>
          </button>
        );
      })}
      <div className="ng-wheel-center" style={sel ? { background: sel.color, borderColor: 'rgba(255,255,255,0.6)' } : undefined}>
        {sel ? (
          <span className="nm on">{lbl(sel)}</span>
        ) : (
          <>
            <span className="nm">{en ? 'Now' : '此刻'}</span>
            <span className="hint">{en ? 'tap one' : '点一个'}</span>
          </>
        )}
      </div>
    </div>
  );
}
