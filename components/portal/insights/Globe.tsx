'use client';

/**
 * Globe — 3D 地球(批次 63,用户点名:世界板块 = 可旋转地球,到访国高亮)。
 *
 * 零依赖 SVG 正交投影:经纬网线(30° 网格)+ 球体渐变 + 到访国家发光点
 * (小型国家质心表,~50 国;查不到质心的国家仍在下方列表里,不丢数据)。
 * 手指拖拽旋转(yaw/pitch,pointer 事件),与关系图同一套星图审美。
 * 不引 three.js/d3-geo,不加载外部地理数据 —— CSP 与包体积零成本。
 */

import { useRef, useState } from 'react';

const RAD = Math.PI / 180;

/** 常见国家质心(EN 全名,与 geocode 的 countryName 输出对齐)。 */
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  'United States': [39.8, -98.6], Canada: [56.1, -106.3], Mexico: [23.6, -102.6],
  Brazil: [-14.2, -51.9], Argentina: [-38.4, -63.6], Chile: [-35.7, -71.5], Peru: [-9.2, -75.0], Colombia: [4.6, -74.3],
  'United Kingdom': [54.0, -2.5], Ireland: [53.4, -8.2], France: [46.6, 2.5], Germany: [51.2, 10.4], Italy: [42.8, 12.6],
  Spain: [40.3, -3.7], Portugal: [39.6, -8.0], Netherlands: [52.2, 5.5], Belgium: [50.6, 4.5], Switzerland: [46.8, 8.2],
  Austria: [47.6, 14.1], Sweden: [62.2, 17.6], Norway: [64.5, 13.1], Denmark: [56.0, 9.5], Finland: [64.5, 26.0],
  Iceland: [64.9, -18.6], Greece: [39.1, 22.9], Turkey: [39.0, 35.2], Poland: [52.1, 19.4], Czechia: [49.8, 15.5],
  Hungary: [47.2, 19.4], Russia: [61.5, 105.3],
  China: [35.9, 104.2], Japan: [36.2, 138.3], 'South Korea': [36.5, 127.8], Taiwan: [23.7, 121.0], 'Hong Kong': [22.3, 114.2],
  Singapore: [1.35, 103.8], Malaysia: [4.2, 102.0], Thailand: [15.9, 101.0], Vietnam: [14.1, 108.3],
  Philippines: [12.9, 121.8], Indonesia: [-0.8, 113.9], India: [20.6, 79.0], 'United Arab Emirates': [23.4, 53.8],
  Israel: [31.0, 34.9], 'Saudi Arabia': [23.9, 45.1], Egypt: [26.8, 30.8], 'South Africa': [-30.6, 22.9],
  Australia: [-25.3, 133.8], 'New Zealand': [-40.9, 174.9],
};

export interface GlobeCountry { name: string; count: number }

export default function Globe({ countries, size = 300, onTap }: {
  countries: GlobeCountry[];
  size?: number;
  onTap?: () => void;
}) {
  // 初始朝向:第一个有质心的到访国转到正面
  const first = countries.map((c) => COUNTRY_CENTROIDS[c.name]).find(Boolean);
  const [rot, setRot] = useState<{ yaw: number; pitch: number }>({ yaw: first ? -first[1] : 98.6, pitch: first ? first[0] * 0.6 : 24 });
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number; moved: boolean } | null>(null);

  const R = size / 2 - 8;
  const C = size / 2;
  const sinP = Math.sin(rot.pitch * RAD);
  const cosP = Math.cos(rot.pitch * RAD);

  /** 正交投影;背半球返回 null */
  function project(lat: number, lon: number): { x: number; y: number } | null {
    const φ = lat * RAD;
    const λ = (lon + rot.yaw) * RAD;
    const cosc = sinP * Math.sin(φ) + cosP * Math.cos(φ) * Math.cos(λ);
    if (cosc < 0.02) return null;
    return {
      x: C + R * Math.cos(φ) * Math.sin(λ),
      y: C - R * (cosP * Math.sin(φ) - sinP * Math.cos(φ) * Math.cos(λ)),
    };
  }

  /** 经纬网折线(隐藏段断笔) */
  function gratPath(points: Array<[number, number]>): string {
    let d = '';
    let pen = false;
    for (const [la, lo] of points) {
      const p = project(la, lo);
      if (!p) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      pen = true;
    }
    return d;
  }

  const grats: string[] = [];
  for (let lon = -180; lon < 180; lon += 30) {
    grats.push(gratPath(Array.from({ length: 73 }, (_, i) => [-90 + i * 2.5, lon] as [number, number])));
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    grats.push(gratPath(Array.from({ length: 145 }, (_, i) => [lat, -180 + i * 2.5] as [number, number])));
  }

  const maxN = Math.max(1, ...countries.map((c) => c.count));
  const dots = countries
    .map((c) => {
      const cen = COUNTRY_CENTROIDS[c.name];
      if (!cen) return null;
      const p = project(cen[0], cen[1]);
      return p ? { ...p, name: c.name, count: c.count } : null;
    })
    .filter((d): d is { x: number; y: number; name: string; count: number } => d !== null);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="nesio-globe"
      role="img"
      aria-label="Globe"
      style={{ touchAction: 'none', cursor: 'grab' }}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, yaw: rot.yaw, pitch: rot.pitch, moved: false };
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const dx = e.clientX - drag.current.x;
        const dy = e.clientY - drag.current.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) drag.current.moved = true;
        setRot({
          yaw: drag.current.yaw + dx * (140 / size),
          pitch: Math.max(-75, Math.min(75, drag.current.pitch + dy * (100 / size))),
        });
      }}
      onPointerUp={() => {
        const moved = drag.current?.moved;
        drag.current = null;
        if (!moved) onTap?.();
      }}
      onPointerCancel={() => { drag.current = null; }}
    >
      <defs>
        <radialGradient id="nesio-globe-sphere" cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="var(--portal-blue-light, #cddefc)" stopOpacity="0.9" />
          <stop offset="60%" stopColor="var(--portal-blue-mid, #96c7f3)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--portal-blue-deep, #588ce3)" stopOpacity="0.5" />
        </radialGradient>
      </defs>
      <circle cx={C} cy={C} r={R} fill="url(#nesio-globe-sphere)" stroke="var(--portal-line)" strokeWidth="1" />
      {grats.map((d, i) => d && (
        <path key={i} d={d} fill="none" stroke="var(--portal-accent)" strokeOpacity="0.22" strokeWidth="0.8" />
      ))}
      {dots.map((d) => {
        const r = 4 + Math.sqrt(d.count / maxN) * 6;
        return (
          <g key={d.name}>
            <circle cx={d.x} cy={d.y} r={r + 5} fill="var(--portal-accent)" opacity="0.18" />
            <circle cx={d.x} cy={d.y} r={r} fill="var(--portal-accent)" stroke="#fff" strokeWidth="1.5" />
            <text x={d.x} y={d.y - r - 7} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--portal-ink)">{d.name}</text>
          </g>
        );
      })}
    </svg>
  );
}
