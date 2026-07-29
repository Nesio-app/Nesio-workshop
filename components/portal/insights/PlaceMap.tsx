'use client';

/**
 * PlaceMap — 真实地图上的足迹打点(OpenStreetMap 瓦片,零依赖)。
 *
 * 不引 Leaflet:Web Mercator 数学 + <img> 瓦片网格 + 绝对定位圆点,
 * ~100 行覆盖「把常去地点画在真地图上」这一个需求(Google Timeline
 * Insights 的地图概览形态)。瓦片来自 tile.openstreetmap.org(轻量
 * 个人用途 + 版权署名,符合 OSM 瓦片使用政策);不加载任何 JS SDK。
 */

import { useEffect, useRef, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

export interface MapPoint {
  lat: number;
  lon: number;
  label: string;
  /** 停留分钟(决定圆点大小) */
  weightMin: number;
  color: string;
}

const TILE = 256;

function xWorld(lon: number, z: number): number {
  return ((lon + 180) / 360) * TILE * 2 ** z;
}
function yWorld(lat: number, z: number): number {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
}

export default function PlaceMap({ points, path, height = 200 }: { points: MapPoint[]; path?: Array<{ lat: number; lon: number }>; height?: number }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(340);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth || 340);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const pts = points.filter((p) => p.lat != null && p.lon != null);
  if (!pts.length) return null;

  const minLat = Math.min(...pts.map((p) => p.lat));
  const maxLat = Math.max(...pts.map((p) => p.lat));
  const minLon = Math.min(...pts.map((p) => p.lon));
  const maxLon = Math.max(...pts.map((p) => p.lon));

  // 选缩放:让 bbox(留 48px 内边距)装进容器;单点给街区级
  let z = 15;
  for (; z > 2; z--) {
    const w = xWorld(maxLon, z) - xWorld(minLon, z);
    const h = yWorld(minLat, z) - yWorld(maxLat, z);
    if (w <= width - 48 && h <= height - 48) break;
  }

  const cx = (xWorld(minLon, z) + xWorld(maxLon, z)) / 2;
  const cy = (yWorld(maxLat, z) + yWorld(minLat, z)) / 2;
  const left = cx - width / 2;
  const top = cy - height / 2;

  const tiles: Array<{ key: string; x: number; y: number; px: number; py: number }> = [];
  const n = 2 ** z;
  for (let tx = Math.floor(left / TILE); tx * TILE < left + width; tx++) {
    for (let ty = Math.max(0, Math.floor(top / TILE)); ty * TILE < top + height && ty < n; ty++) {
      tiles.push({ key: `${tx}-${ty}`, x: ((tx % n) + n) % n, y: ty, px: tx * TILE - left, py: ty * TILE - top });
    }
  }

  const maxW = Math.max(1, ...pts.map((p) => p.weightMin));

  return (
    <div ref={wrapRef} className="nesio-tl-realmap" style={{ height }} role="img" aria-label={L(dict, '足迹地图', 'Footprint map')}>
      {tiles.map((t) => (
        // OSM 栅格瓦片,惰性加载;地图不可交互(纯概览),点位才是主角
        // eslint-disable-next-line @next/next/no-img-element
        <img key={t.key} src={`https://tile.openstreetmap.org/${z}/${t.x}/${t.y}.png`} alt="" className="nesio-map-tile" loading="lazy" draggable={false}
          style={{ position: 'absolute', left: t.px, top: t.py, width: TILE, height: TILE }} />
      ))}
      {path && path.length >= 2 && (
        <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} width={width} height={height} aria-hidden>
          <path
            d={path.map((p, i) => `${i ? 'L' : 'M'}${(xWorld(p.lon, z) - left).toFixed(1)},${(yWorld(p.lat, z) - top).toFixed(1)}`).join(' ')}
            fill="none" stroke="var(--portal-accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.75"
          />
        </svg>
      )}
      {pts.map((p, i) => {
        const r = 5 + Math.sqrt(p.weightMin / maxW) * 8;
        return (
          <span key={i} title={p.label} style={{
            position: 'absolute',
            left: xWorld(p.lon, z) - left - r,
            top: yWorld(p.lat, z) - top - r,
            width: r * 2, height: r * 2, borderRadius: '50%',
            background: p.color, opacity: 0.82,
            border: '2px solid rgba(255,255,255,0.9)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
          }} />
        );
      })}
      <a className="nesio-tl-map-attr" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
    </div>
  );
}
