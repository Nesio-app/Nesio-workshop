'use client';

/**
 * MoodWheel — 心情系统的情绪转盘(mood-wheel2)点选版。
 * 复用 MoodSheet 同一套几何 + 12 情绪语义色 + .nesio-mood-wheel-* 样式,但只做点选(无拖拽/能量层),
 * 好内联进别处(如疗愈闭环第 6 步),不用叠一层 sheet。选中的点放大描白边,中心大圈染当前情绪色。
 */

import { EMOTIONS } from '@/lib/portal/mood';

const N = EMOTIONS.length;
const CX = 150, CY = 150, R_DOT = 104, DOT_R = 15, CENTER_R = 64, LABEL_GAP = 11;
const rad = (d: number) => (d * Math.PI) / 180;
const dotPos = (i: number): [number, number] => {
  const a = rad((i * 360) / N - 90);
  return [CX + R_DOT * Math.cos(a), CY + R_DOT * Math.sin(a)];
};

export default function MoodWheel({ value, onPick, en }: { value: string | null; onPick: (id: string) => void; en: boolean }) {
  const sel = value ? EMOTIONS.find((e) => e.id === value) : null;
  const lbl = (e: typeof EMOTIONS[number]) => (en ? e.labelEn : e.label);
  return (
    <div className="nesio-mood-wheel-wrap">
      <svg viewBox="0 0 300 300" className="nesio-mood-wheel-svg" role="group" aria-label={en ? 'Mood wheel' : '情绪转盘'}>
        {EMOTIONS.map((em, i) => {
          const on = value === em.id;
          const [dx, dy] = dotPos(i);
          return (
            <g key={em.id} role="button" aria-label={lbl(em)} aria-pressed={on} tabIndex={0}
              onClick={() => onPick(em.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(em.id); } }}
              style={{ cursor: 'pointer' }}>
              {on && <circle cx={dx} cy={dy} r={DOT_R + 6} fill={em.color} opacity={0.3} style={{ filter: 'blur(3px)' }} />}
              <circle cx={dx} cy={dy} r={on ? DOT_R + 2 : DOT_R} fill={em.color}
                stroke={on ? '#fff' : 'rgba(255,255,255,0.55)'} strokeWidth={on ? 2.5 : 1} style={{ transition: 'r 0.12s' }} />
              <text x={dx} y={dy + DOT_R + LABEL_GAP} textAnchor="middle" dominantBaseline="middle"
                fontSize={on ? '10' : '9'} fontWeight={on ? '800' : '650'}
                fill={on ? 'var(--portal-ink)' : 'var(--portal-muted)'}
                style={{ pointerEvents: 'none', userSelect: 'none', transition: 'font-size 0.12s' }}>{lbl(em)}</text>
            </g>
          );
        })}
        <circle cx={CX} cy={CY} r={CENTER_R} fill={sel ? sel.color : 'var(--mood-card-bg, #fff)'}
          stroke={sel ? 'rgba(255,255,255,0.6)' : 'var(--portal-line)'} strokeWidth={sel ? 4 : 1.5}
          style={{ transition: 'fill 0.25s' }} />
        {sel ? (
          <>
            <ellipse cx={CX - 15} cy={CY - 22} rx={24} ry={14} fill="#fff" opacity={0.2} style={{ pointerEvents: 'none' }} />
            <text x={CX} y={CY} textAnchor="middle" dominantBaseline="middle" fontSize="21" fontWeight="800" fill="#fff"
              style={{ userSelect: 'none', pointerEvents: 'none', fontFamily: 'var(--font-portal-serif), Georgia, serif' }}>{lbl(sel)}</text>
          </>
        ) : (
          <>
            <text x={CX} y={CY - 6} textAnchor="middle" dominantBaseline="middle" fontSize="13" fill="var(--portal-muted)" fontWeight="700"
              style={{ userSelect: 'none', pointerEvents: 'none', fontFamily: 'var(--font-portal-serif), Georgia, serif' }}>{en ? 'Now' : '此刻'}</text>
            <text x={CX} y={CY + 12} textAnchor="middle" fontSize="8.5" fill="var(--portal-muted)"
              style={{ userSelect: 'none', pointerEvents: 'none' }}>{en ? 'Tap to pick' : '点一个'}</text>
          </>
        )}
      </svg>
    </div>
  );
}
