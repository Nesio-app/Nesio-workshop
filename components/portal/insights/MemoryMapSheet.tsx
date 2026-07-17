'use client';

/**
 * MemoryMapSheet — 地图上的记忆(批次 59,用户愿景:Journal 的 Memories in Maps)。
 *
 * 全屏交互地图:PlaceMap 同款 Web Mercator + OSM 瓦片数学,加上
 * 拖拽平移(pointer 事件,拖动时 CSS 位移、松手重排瓦片)与 ± 缩放。
 * 数据 = 带 capturedLat/Lon 的记忆节点,按屏幕像素距离(<44px)聚簇,
 * 气泡上直接显示「这里记了几条」;点气泡在底部列出该处记忆。
 * 零依赖 —— 不引 Leaflet/Mapbox,CSP 不变。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import NesioSheet from '../ui/NesioSheet';
import { getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { NodeTypeIcon } from '../icons';

const TILE = 256;
const MIN_Z = 3;
const MAX_Z = 18;

function xWorld(lon: number, z: number): number {
  return ((lon + 180) / 360) * TILE * 2 ** z;
}
function yWorld(lat: number, z: number): number {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
}
function lonOfX(x: number, z: number): number {
  return (x / (TILE * 2 ** z)) * 360 - 180;
}
function latOfY(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / (TILE * 2 ** z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

interface GeoNode { node: LifeNode; lat: number; lon: number }
interface Cluster { lat: number; lon: number; items: GeoNode[] }

function geoNodes(): GeoNode[] {
  return getLifeGraph()
    .map((node) => {
      const lat = node.attributes?.capturedLat;
      const lon = node.attributes?.capturedLon;
      return typeof lat === 'number' && typeof lon === 'number' ? { node, lat, lon } : null;
    })
    .filter((g): g is GeoNode => g !== null);
}

/** 按当前缩放的屏幕像素距离聚簇(<44px 归一簇)—— 缩放越大簇越散。 */
function clusterAtZoom(items: GeoNode[], z: number): Cluster[] {
  const out: Array<Cluster & { px: number; py: number }> = [];
  for (const g of items) {
    const px = xWorld(g.lon, z);
    const py = yWorld(g.lat, z);
    const hit = out.find((c) => Math.hypot(c.px - px, c.py - py) < 44);
    if (hit) {
      hit.items.push(g);
      // 簇心取均值,气泡随成员轻微居中
      hit.px = (hit.px * (hit.items.length - 1) + px) / hit.items.length;
      hit.py = (hit.py * (hit.items.length - 1) + py) / hit.items.length;
      hit.lat = latOfY(hit.py, z);
      hit.lon = lonOfX(hit.px, z);
    } else {
      out.push({ lat: g.lat, lon: g.lon, items: [g], px, py });
    }
  }
  return out;
}

export default function MemoryMapSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 360, h: 480 });
  const [view, setView] = useState<{ lat: number; lon: number; z: number } | null>(null);
  const [dragPx, setDragPx] = useState<{ dx: number; dy: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  // 批次 61:真双指缩放 —— 跟踪多指,两指时算 scale 做 CSS 预览,松手提交 z 并锚定中点
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; midX: number; midY: number } | null>(null);
  const [pinch, setPinch] = useState<{ scale: number; midX: number; midY: number } | null>(null);
  const [picked, setPicked] = useState<Cluster | null>(null);

  const all = useMemo(() => (open ? geoNodes() : []), [open]);

  // 批次 60/61:时间 bar —— 左右拉,看记忆在地图上随**天**长出来(累计到所选日)
  const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const days = useMemo(() => {
    const set = new Set(all.map((g) => dayKey(new Date(g.node.createdAt))));
    return [...set].sort();
  }, [all]); // eslint-disable-line react-hooks/exhaustive-deps
  const [dayIdxRaw, setDayIdxRaw] = useState(-1); // -1 = 最新(全部)
  const activeIdx = dayIdxRaw < 0 ? days.length - 1 : dayIdxRaw;
  const visible = useMemo(() => {
    if (days.length === 0 || activeIdx >= days.length - 1) return all;
    const [y, m, d] = days[activeIdx].split('-').map(Number);
    const cutoff = new Date(y, m - 1, d + 1).getTime(); // 所选日的次日零点
    return all.filter((g) => new Date(g.node.createdAt).getTime() < cutoff);
  }, [all, days, activeIdx]);

  // 初始视野:装下全部点(单点给街区级)
  useEffect(() => {
    if (!open || view || all.length === 0) return;
    const lats = all.map((g) => g.lat);
    const lons = all.map((g) => g.lon);
    const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons); const maxLon = Math.max(...lons);
    let z = 15;
    for (; z > MIN_Z; z--) {
      const w = xWorld(maxLon, z) - xWorld(minLon, z);
      const h = yWorld(minLat, z) - yWorld(maxLat, z);
      if (w <= size.w - 80 && h <= size.h - 160) break;
    }
    setView({ lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2, z });
  }, [open, view, all, size]);

  useEffect(() => {
    if (!open) { setView(null); setPicked(null); setDragPx(null); return; }
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth || 360, h: el.clientHeight || 480 });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);

  if (!open) return null;

  const clusters = view ? clusterAtZoom(visible, view.z) : [];
  const cx = view ? xWorld(view.lon, view.z) : 0;
  const cy = view ? yWorld(view.lat, view.z) : 0;
  const left = cx - size.w / 2 - (dragPx?.dx ?? 0);
  const top = cy - size.h / 2 - (dragPx?.dy ?? 0);

  const tiles: Array<{ key: string; x: number; y: number; px: number; py: number }> = [];
  if (view) {
    const n = 2 ** view.z;
    for (let tx = Math.floor(left / TILE); tx * TILE < left + size.w; tx++) {
      for (let ty = Math.max(0, Math.floor(top / TILE)); ty * TILE < top + size.h && ty < n; ty++) {
        tiles.push({ key: `${view.z}-${tx}-${ty}`, x: ((tx % n) + n) % n, y: ty, px: tx * TILE - left, py: ty * TILE - top });
      }
    }
  }

  const zoomTo = (dz: number) => {
    setPicked(null);
    setView((v) => (v ? { ...v, z: Math.max(MIN_Z, Math.min(MAX_Z, v.z + dz)) } : v));
  };

  const canvasXY = (e: React.PointerEvent) => {
    const r = wrapRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, canvasXY(e));
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) {
      // 进入双指:取消单指拖拽,记录初始距离与中点
      dragStart.current = null;
      setDragPx(null);
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { dist: Math.max(24, Math.hypot(a.x - b.x, a.y - b.y)), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
    } else if (pointers.current.size === 1) {
      dragStart.current = { x: e.clientX, y: e.clientY };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, canvasXY(e));
    if (pointers.current.size >= 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.max(24, Math.hypot(a.x - b.x, a.y - b.y));
      setPinch({ scale: dist / pinchStart.current.dist, midX: pinchStart.current.midX, midY: pinchStart.current.midY });
      return; // 双指期间不拖拽(此前第二根手指被当拖拽 → 闪屏乱跳)
    }
    if (!dragStart.current) return;
    setDragPx({ dx: e.clientX - dragStart.current.x, dy: e.clientY - dragStart.current.y });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pinchStart.current && pointers.current.size < 2) {
      // 提交双指缩放:z 变整数级,几何锚定捏合中点
      const ps = pinchStart.current;
      const pv = pinch;
      pinchStart.current = null;
      setPinch(null);
      if (pv && view && Math.abs(Math.log2(pv.scale)) >= 0.32) {
        const dz = Math.max(-3, Math.min(3, Math.round(Math.log2(pv.scale))));
        const z2 = Math.max(MIN_Z, Math.min(MAX_Z, view.z + dz));
        if (z2 !== view.z) {
          const lonMid = lonOfX(left + ps.midX, view.z);
          const latMid = latOfY(top + ps.midY, view.z);
          const cLon = lonOfX(xWorld(lonMid, z2) - ps.midX + size.w / 2, z2);
          const cLat = latOfY(yWorld(latMid, z2) - ps.midY + size.h / 2, z2);
          setPicked(null);
          setView({ lat: cLat, lon: cLon, z: z2 });
        }
      }
      return;
    }
    if (!dragStart.current) return;
    const d = dragPx;
    dragStart.current = null;
    setDragPx(null);
    if (d && view && (Math.abs(d.dx) > 4 || Math.abs(d.dy) > 4)) {
      setView({ ...view, lon: lonOfX(cx - d.dx, view.z), lat: latOfY(cy - d.dy, view.z) });
    }
  };

  // 批次 60→W2:原语内部走 Radix Portal 到 body,天然逃出洞察 sheet 的 transform
  // 困在其内部(实测地图叠在 tab 下面而不是全屏)
  return (
    <NesioSheet
      variant="fullscreen"
      open
      onOpenChange={(next) => { if (!next) onClose(); }}
      card={false}
      className="nesio-memmap-overlay"
      ariaLabel={L(dict, '地图上的记忆', 'Memories on the map')}
    >
      <div className="nesio-memmap-header">
        <span className="nesio-memmap-title">{L(dict, '地图上的记忆', 'Memories on the map')}</span>
        <span className="nesio-memmap-count">{L(dict, `${all.length} 条带位置`, `${all.length} located`)}</span>
        <button type="button" className="nesio-memmap-close" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
      </div>
      <div
        ref={wrapRef}
        className="nesio-memmap-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {all.length === 0 && (
          <p className="nesio-memmap-empty">{L(dict, '还没有带位置的记忆。开启「记忆自动定位」后,亲手记的每一条都会出现在这里。', 'No located memories yet. Turn on auto-locate and every capture lands here.')}</p>
        )}
        <div style={pinch ? { position: 'absolute', inset: 0, transform: `scale(${pinch.scale})`, transformOrigin: `${pinch.midX}px ${pinch.midY}px` } : { position: 'absolute', inset: 0 }}>
        {tiles.map((t) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={t.key} src={`https://tile.openstreetmap.org/${view!.z}/${t.x}/${t.y}.png`} alt="" loading="lazy" draggable={false}
            style={{ position: 'absolute', left: t.px, top: t.py, width: TILE, height: TILE, pointerEvents: 'none' }} />
        ))}
        {view && clusters.map((c, i) => {
          const px = xWorld(c.lon, view.z) - left;
          const py = yWorld(c.lat, view.z) - top;
          const r = Math.min(26, 13 + Math.sqrt(c.items.length) * 3);
          // 热力色:记得越多越暖(hue 210 冷蓝 → 18 橙红)
          const maxN = Math.max(1, ...clusters.map((x) => x.items.length));
          const heat = 210 - Math.round(192 * Math.sqrt(c.items.length / maxN));
          return (
            <button
              key={i}
              type="button"
              className="nesio-memmap-bubble"
              style={{ left: px - r, top: py - r, width: r * 2, height: r * 2, background: `hsl(${heat} 76% 50%)` }}
              onClick={(e) => { e.stopPropagation(); setPicked(c); }}
              aria-label={L(dict, `这里记了 ${c.items.length} 条`, `${c.items.length} memories here`)}
            >{c.items.length}</button>
          );
        })}
        </div>
        <a className="nesio-tl-map-attr" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
        <div className="nesio-memmap-zoom">
          <button type="button" onClick={() => zoomTo(1)} aria-label={L(dict, '放大', 'Zoom in')}>+</button>
          <button type="button" onClick={() => zoomTo(-1)} aria-label={L(dict, '缩小', 'Zoom out')}>−</button>
        </div>
      </div>
      {days.length >= 1 && (
        <div className="nesio-memmap-timebar">
          {days.length > 1 && <input
            type="range"
            min={0}
            max={days.length - 1}
            value={activeIdx}
            onChange={(e) => { setDayIdxRaw(Number(e.target.value)); setPicked(null); }}
            aria-label={L(dict, '时间', 'Time')}
          />}
          <span className="nesio-memmap-timebar-label">
            {(() => {
              // 批次 63:数字语义说清楚 —— 地图显示的是**累计到所选日**的版图,
              // 标签同时给当天新增,不再让 14+2=16 看着像凭空多出来
              const [y, m, d] = days[activeIdx].split('-').map(Number);
              const dayN = all.filter((g) => dayKey(new Date(g.node.createdAt)) === days[activeIdx]).length;
              const dateStr = L(dict, `${m}月${d}日`, `${m}/${d}/${String(y).slice(2)}`);
              return L(dict, `至 ${dateStr} · 共 ${visible.length} 条 · 当天 ${dayN} 条`, `Through ${dateStr} · ${visible.length} total · ${dayN} that day`);
            })()}
          </span>
        </div>
      )}
      {picked && (
        <div className="nesio-memmap-list">
          <p className="nesio-memmap-list-title">
            {(() => {
              const named = picked.items.find((g) => typeof g.node.attributes.capturedPlace === 'string' && g.node.attributes.capturedPlace);
              const place = named ? String(named.node.attributes.capturedPlace) : `${picked.lat.toFixed(3)}, ${picked.lon.toFixed(3)}`;
              return L(dict, `${place} · ${picked.items.length} 条记忆`, `${place} · ${picked.items.length} memories`);
            })()}
          </p>
          <div className="nesio-memmap-list-scroll">
            {picked.items.slice(0, 20).map(({ node }) => (
              <div key={node.id} className="nesio-memmap-item">
                <NodeTypeIcon type={node.type} size={13} />
                <span className="nesio-memmap-item-name">{node.name}</span>
                <span className="nesio-memmap-item-time">
                  {new Date(node.createdAt).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'numeric', day: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </NesioSheet>
  );
}
