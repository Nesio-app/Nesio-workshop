'use client';

/**
 * NesioMark — 水晶立方体品牌标记(批次 102)。
 *
 * 此前是静态 `nesio-mark.svg`(硬编码蓝渐变)+ 夜间变体,`<img>` 引用 —— CSS 变量
 * 进不去,所以整站换成灰粉皮肤后它还是蓝(用户实锤「logo 是蓝」)。改成**内联 SVG**,
 * 渐变停靠 `--portal-blue-*` 品牌 ramp:灰粉皮肤=玫瑰水晶,默认蓝=蓝水晶,夜间=夜蓝
 * (夜间 token 自带,一套组件三种皮肤自适应,不再需要昼夜双图切换)。
 *
 * 渐变 id 用 useId 保证同页多个实例(顶栏 + FAB + 空态…)不撞车。
 * mixBlendMode 内联置 normal,盖过旧尺寸类里的 multiply(那是给 img 消白框用的,
 * 内联 SVG 背景本就透明,不需要)。
 */
import { useId } from 'react';

const HEX = '84.64101615137756';
const LEX = '15.35898384862245';

export default function NesioMark({ className, size, style }: { className?: string; size?: number; style?: React.CSSProperties }) {
  const uid = useId().replace(/:/g, '');
  const gc1 = `nm-gc1-${uid}`;
  const gc2 = `nm-gc2-${uid}`;
  const glow = `nm-glow-${uid}`;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      style={{ mixBlendMode: 'normal', ...style }}
    >
      <defs>
        <linearGradient id={gc1} x1="0.15" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="var(--portal-blue-light)" />
          <stop offset="0.45" stopColor="var(--portal-blue-mid)" />
          <stop offset="1" stopColor="var(--portal-blue-deep)" />
        </linearGradient>
        <linearGradient id={gc2} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.05" />
        </linearGradient>
        <radialGradient id={glow} cx="0.5" cy="0.42" r="0.62">
          <stop offset="0" stopColor="var(--portal-blue-light)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--portal-blue-light)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill={`url(#${glow})`} />
      <polygon points="50,10 84.6,30 84.6,70 50,90 15.4,70 15.4,30" fill={`url(#${gc1})`} />
      <path d={`M${LEX},30 L50,10 L${HEX},30 L50,50 Z`} fill={`url(#${gc2})`} />
      <path d={`M${LEX},70 L50,50 L${HEX},70 L50,90 Z`} fill="var(--portal-blue-deep)" opacity="0.35" />
      <g stroke="#ffffff" strokeOpacity="0.7" strokeWidth="1.1" strokeLinejoin="round" fill="none">
        <polygon points="50,10 84.6,30 84.6,70 50,90 15.4,70 15.4,30" />
        <path d={`M${LEX},30 L50,50 L${HEX},30 M50,50 L50,90`} />
      </g>
    </svg>
  );
}
