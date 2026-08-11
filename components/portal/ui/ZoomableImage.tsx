'use client';

/**
 * 全屏看图:双指捏合 + 拖动 + 双击放大。iOS WKWebView 通常禁了页面 pinch,
 * 所以必须自己做 transform,不能指望 CSS touch-action: pinch-zoom。
 */
import { useRef, useState, type PointerEvent, type WheelEvent } from 'react';

const MIN = 1;
const MAX = 6;

export default function ZoomableImage({ src, alt }: { src: string; alt?: string }) {
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const tRef = useRef(t);
  tRef.current = t;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch0 = useRef<{ dist: number; s: number; x: number; y: number } | null>(null);
  const drag0 = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const lastTap = useRef(0);

  const apply = (next: { s: number; x: number; y: number }) => {
    const s = Math.min(MAX, Math.max(MIN, next.s));
    const x = s <= 1.01 ? 0 : next.x;
    const y = s <= 1.01 ? 0 : next.y;
    const v = { s: s <= 1.01 ? 1 : s, x, y };
    tRef.current = v;
    setT(v);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch0.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        s: tRef.current.s,
        x: tRef.current.x,
        y: tRef.current.y,
      };
      drag0.current = null;
      return;
    }
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0;
      if (tRef.current.s > 1.05) apply({ s: 1, x: 0, y: 0 });
      else apply({ s: 2.4, x: 0, y: 0 });
      return;
    }
    lastTap.current = now;
    if (tRef.current.s > 1) {
      drag0.current = { x: e.clientX, y: e.clientY, tx: tRef.current.x, ty: tRef.current.y };
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && pinch0.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const p = pinch0.current;
      apply({ s: p.s * (dist / p.dist), x: p.x, y: p.y });
      return;
    }
    if (drag0.current && tRef.current.s > 1) {
      const d = drag0.current;
      apply({
        s: tRef.current.s,
        x: d.tx + (e.clientX - d.x),
        y: d.ty + (e.clientY - d.y),
      });
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch0.current = null;
    if (pointers.current.size === 0) drag0.current = null;
  };

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const next = tRef.current.s * (e.deltaY < 0 ? 1.12 : 0.9);
    apply({ s: next, x: tRef.current.x, y: tRef.current.y });
  };

  return (
    <div
      className="nesio-zoomable-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt || ''}
        draggable={false}
        style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` }}
      />
    </div>
  );
}
