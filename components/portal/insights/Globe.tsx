'use client';

/**
 * Globe — canvas 3D 地球(批次 67,对标「一生足迹」的世界球)。
 *
 * d3-geo 正交投影 + world-atlas 110m 国家轮廓,canvas 逐层绘制:
 * 大气光晕 → 海洋球体渐变 → 经纬网 → 陆地 → 到访国荧光填色(发光)→
 * 高光/晨昏影。手指拖拽旋转带惯性,静置缓慢自转,点一下(未拖动)回调 onTap。
 * 不引 three.js;轮廓数据 (~110KB gzip) 随本 chunk 懒加载,离线可用。
 */

import { useEffect, useRef } from 'react';
import { geoOrthographic, geoPath, geoGraticule10, geoCentroid } from 'd3-geo';
import type { GeoPermissibleObjects } from 'd3-geo';

export interface GlobeCountry { name: string; count: number }

/** 我们的 geocode 国名 → Natural Earth 110m 国名(含常见中文名兜底)。 */
const NE_ALIAS: Record<string, string> = {
  'United States': 'United States of America',
  'Hong Kong': 'China', 'Macau': 'China', 'Macao': 'China',
  'Czech Republic': 'Czechia',
  'Bosnia and Herzegovina': 'Bosnia and Herz.',
  'Dominican Republic': 'Dominican Rep.',
  '美国': 'United States of America', '中国': 'China', '英国': 'United Kingdom',
  '法国': 'France', '德国': 'Germany', '意大利': 'Italy', '西班牙': 'Spain',
  '日本': 'Japan', '韩国': 'South Korea', '泰国': 'Thailand', '新加坡': 'Singapore',
  '加拿大': 'Canada', '墨西哥': 'Mexico', '澳大利亚': 'Australia', '俄罗斯': 'Russia',
  '葡萄牙': 'Portugal', '希腊': 'Greece', '瑞士': 'Switzerland', '荷兰': 'Netherlands',
};

interface CountryFeature {
  type: 'Feature';
  properties: { name?: string };
  geometry: GeoJSON.Geometry;
}

export default function Globe({ countries, size = 300, onTap }: {
  countries: GlobeCountry[];
  size?: number;
  onTap?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const featuresRef = useRef<CountryFeature[] | null>(null);
  const rotRef = useRef<{ yaw: number; pitch: number }>({ yaw: 98.6, pitch: -24 });
  const velRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });
  const dragRef = useRef<{ x: number; y: number; moved: boolean; lastT: number } | null>(null);
  const interactedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const visitedRef = useRef<Set<string>>(new Set());
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;

  // 到访国集合(NE 名),countries 变化时更新并重绘
  useEffect(() => {
    const set = new Set<string>();
    for (const c of countries) set.add(NE_ALIAS[c.name] || c.name);
    visitedRef.current = set;
    scheduleDraw();
    // 初始朝向:第一个能定位的到访国转到正面
    const feats = featuresRef.current;
    if (feats) {
      const first = countries.map((c) => feats.find((f) => f.properties.name === (NE_ALIAS[c.name] || c.name))).find(Boolean);
      if (first && !interactedRef.current) {
        const [lon, lat] = geoCentroid(first as GeoPermissibleObjects);
        rotRef.current = { yaw: -lon, pitch: -lat * 0.7 };
        scheduleDraw();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countries.map((c) => c.name).join('|')]);

  function scheduleDraw() {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = null; draw(); });
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== size * dpr) { canvas.width = size * dpr; canvas.height = size * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const C = size / 2;
    const R = size / 2 - 10;
    const { yaw, pitch } = rotRef.current;
    const proj = geoOrthographic().translate([C, C]).scale(R).rotate([yaw, pitch]).clipAngle(90);
    const path = geoPath(proj, ctx);

    // 1. 大气光晕(球外一圈)
    const halo = ctx.createRadialGradient(C, C, R * 0.92, C, C, R + 10);
    halo.addColorStop(0, 'rgba(96, 165, 250, 0)');
    halo.addColorStop(0.75, 'rgba(96, 165, 250, 0.28)');
    halo.addColorStop(1, 'rgba(96, 165, 250, 0)');
    ctx.beginPath(); ctx.arc(C, C, R + 10, 0, Math.PI * 2); ctx.fillStyle = halo; ctx.fill();

    // 2. 海洋球体(光源在左上)
    const ocean = ctx.createRadialGradient(C - R * 0.35, C - R * 0.4, R * 0.1, C, C, R);
    ocean.addColorStop(0, '#2e6cb8');
    ocean.addColorStop(0.55, '#17407e');
    ocean.addColorStop(1, '#0a1d40');
    ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = ocean; ctx.fill();

    // 3. 经纬网
    ctx.beginPath(); path(geoGraticule10());
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 0.6; ctx.stroke();

    const feats = featuresRef.current;
    if (feats) {
      // 4. 陆地(未到访:深色地块)
      ctx.beginPath();
      for (const f of feats) if (!visitedRef.current.has(f.properties.name || '')) path(f as GeoPermissibleObjects);
      ctx.fillStyle = '#31413f'; ctx.fill();
      ctx.strokeStyle = 'rgba(10,20,35,0.55)'; ctx.lineWidth = 0.5; ctx.stroke();

      // 5. 到访国(荧光黄绿 + 发光,参考「点亮足迹」)
      ctx.save();
      ctx.shadowColor = 'rgba(190, 242, 100, 0.85)';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      for (const f of feats) if (visitedRef.current.has(f.properties.name || '')) path(f as GeoPermissibleObjects);
      ctx.fillStyle = '#c9ef7d'; ctx.fill();
      ctx.restore();
      ctx.beginPath();
      for (const f of feats) if (visitedRef.current.has(f.properties.name || '')) path(f as GeoPermissibleObjects);
      ctx.strokeStyle = 'rgba(120, 160, 40, 0.6)'; ctx.lineWidth = 0.6; ctx.stroke();
    }

    // 6. 高光 + 晨昏影(整球质感)
    const spec = ctx.createRadialGradient(C - R * 0.45, C - R * 0.5, 0, C - R * 0.45, C - R * 0.5, R * 0.9);
    spec.addColorStop(0, 'rgba(255,255,255,0.22)');
    spec.addColorStop(0.4, 'rgba(255,255,255,0.05)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath(); ctx.arc(C, C, R, 0, Math.PI * 2); ctx.fillStyle = spec; ctx.fill();
    const shade = ctx.createRadialGradient(C - R * 0.3, C - R * 0.35, R * 0.35, C, C, R);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(0.78, 'rgba(2,8,20,0.12)');
    shade.addColorStop(1, 'rgba(2,8,20,0.5)');
    ctx.beginPath(); ctx.arc(C, C, R, 0, Math.PI * 2); ctx.fillStyle = shade; ctx.fill();
  }

  // 轮廓数据懒加载(随 Globe chunk;离线可用)
  useEffect(() => {
    let cancelled = false;
    void Promise.all([import('world-atlas/countries-110m.json'), import('topojson-client')])
      .then(([topoMod, tj]) => {
        if (cancelled) return;
        const topo = (topoMod as { default?: unknown }).default ?? topoMod;
        const t = topo as Parameters<typeof tj.feature>[0];
        const countriesObj = (topo as unknown as { objects: { countries: Parameters<typeof tj.feature>[1] } }).objects.countries;
        const fc = tj.feature(t, countriesObj) as unknown as { features: CountryFeature[] };
        featuresRef.current = fc.features;
        // 数据到位后再定初始朝向
        const first = countries.map((c) => fc.features.find((f) => f.properties.name === (NE_ALIAS[c.name] || c.name))).find(Boolean);
        if (first && !interactedRef.current) {
          const [lon, lat] = geoCentroid(first as GeoPermissibleObjects);
          rotRef.current = { yaw: -lon, pitch: -lat * 0.7 };
        }
        scheduleDraw();
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 静置缓慢自转 + 惯性衰减(同一个 RAF 心跳,交互时暂停自转)
  useEffect(() => {
    let alive = true;
    function tick() {
      if (!alive) return;
      const v = velRef.current;
      if (dragRef.current == null) {
        if (Math.abs(v.vx) > 0.02 || Math.abs(v.vy) > 0.02) {
          rotRef.current = {
            yaw: rotRef.current.yaw + v.vx,
            pitch: Math.max(-80, Math.min(80, rotRef.current.pitch + v.vy)),
          };
          v.vx *= 0.94; v.vy *= 0.94;
          draw();
        } else if (!interactedRef.current) {
          rotRef.current = { ...rotRef.current, yaw: rotRef.current.yaw + 0.05 };
          draw();
        }
      }
      requestAnimationFrame(tick);
    }
    const id = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      className="nesio-globe"
      style={{ width: size, height: size, touchAction: 'none', cursor: 'grab' }}
      role="img"
      aria-label="Globe"
      onPointerDown={(e) => {
        interactedRef.current = true;
        velRef.current = { vx: 0, vy: 0 };
        dragRef.current = { x: e.clientX, y: e.clientY, moved: false, lastT: performance.now() };
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true;
        const kx = 160 / size; const ky = 120 / size;
        rotRef.current = {
          yaw: rotRef.current.yaw + dx * kx,
          pitch: Math.max(-80, Math.min(80, rotRef.current.pitch - dy * ky)),
        };
        velRef.current = { vx: dx * kx, vy: -dy * ky };
        d.x = e.clientX; d.y = e.clientY; d.lastT = performance.now();
        scheduleDraw();
      }}
      onPointerUp={() => {
        const d = dragRef.current;
        dragRef.current = null;
        // 停顿后才松手 → 不滑行
        if (d && performance.now() - d.lastT > 90) velRef.current = { vx: 0, vy: 0 };
        if (d && !d.moved) { velRef.current = { vx: 0, vy: 0 }; onTapRef.current?.(); }
      }}
      onPointerCancel={() => { dragRef.current = null; }}
    />
  );
}
