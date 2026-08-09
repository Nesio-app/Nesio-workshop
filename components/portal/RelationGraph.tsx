'use client';

/**
 * RelationGraph — 通用关系图 SVG 组件(批次 20 重制:星图风)。
 * 参考稿:深色星图——实心彩色节点、节点内两行大字、虚线箭头边。
 * 交互:滚轮 / 双指捏合缩放,单指(单点)拖拽平移,双击重置;
 * 初始自动 fit 全部节点(修「会偏移」);字号跟随缩放,放大即可读。
 * 三个消费方(Memory 关联图 / 节点详情关联地图 / 认知关系图)共用。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { buildLayout, type GEdge, type GNode, type GNodePos } from '@/lib/platform/graph-engine';

interface Props {
  nodes: GNode[];
  edges: GEdge[];
  width?: number;
  height?: number;
  focusId?: string;           // highlight this node
  onNodeClick?: (id: string) => void;
  emptyText?: string;
}

/** 节点内两行标签:每行最多 4 个宽字符(中文),溢出加省略号 */
function splitLabel(label: string): [string, string] {
  const chars = Array.from(label);
  if (chars.length <= 4) return [label, ''];
  const line1 = chars.slice(0, 4).join('');
  const rest = chars.slice(4);
  const line2 = rest.length > 4 ? rest.slice(0, 3).join('') + '…' : rest.join('');
  return [line1, line2];
}

/**
 * 星图配色:按节点类型取设计系统的类别色 --viz-*(见 globals.css 那段说明)。
 * 原来是 7 个写死的 hex —— 换皮肤时整个界面都变了,只有这张关系图纹丝不动。
 * 现在跟着皮肤压饱和,而 7 个色相位仍然分散(相邻节点还是分得开)。
 */
// 2026-08-01 改名批:health_state+preference 合并成 Mind,取 health_state 原色(viz-2)。
const TYPE_FILL: Record<string, string> = {
  person: 'var(--viz-5)',
  Thing: 'var(--viz-1)',
  place: 'var(--viz-3)',
  // 与 Thing 同相位 —— 流水影子曾用 event,琥珀相位在关系图里像「错色褐色」。
  event: 'var(--viz-1)',
  task: 'var(--viz-6)',
  Mind: 'var(--viz-2)',
};
const DEFAULT_FILL = 'var(--viz-8)';

const NODE_R = 24;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3.5;

export default function RelationGraph({
  nodes,
  edges,
  width = 320,
  height = 280,
  focusId,
  onNodeClick,
  emptyText,
}: Props) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const resolvedEmptyText = emptyText ?? L(dict, '暂无关联节点', 'No connections yet');
  const [selected, setSelected] = useState<string | null>(focusId ?? null);
  const svgRef = useRef<SVGSVGElement>(null);

  // 布局:节点更疏(星图感),只随数据变化重算
  const layout = useMemo(
    () => buildLayout(nodes, edges, width * 1.6, height * 1.6),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes.map(n => n.id).join(','), edges.map(e => `${e.source}-${e.target}`).join(','), width, height],
  );

  // 初始 fit:把全部节点(含半径)装进视口,居中——不再偏移
  const fit = useMemo(() => {
    const xs = layout.nodes.map((n) => n.x);
    const ys = layout.nodes.map((n) => n.y);
    if (!xs.length) return { x: 0, y: 0, w: width, h: height };
    const pad = NODE_R * 2 + 12;
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad;
    const maxY = Math.max(...ys) + pad;
    const w = Math.max(maxX - minX, 80);
    const h = Math.max(maxY - minY, 80);
    // 保持宽高比,取能装下的一边
    const scale = Math.min(width / w, height / h);
    const vw = width / scale;
    const vh = height / scale;
    return { x: minX - (vw - w) / 2, y: minY - (vh - h) / 2, w: vw, h: vh };
  }, [layout, width, height]);

  // 视口:缩放 + 平移(viewBox 驱动,文字随缩放同倍放大)
  const [view, setView] = useState(fit);
  useEffect(() => { setView(fit); }, [fit]);

  const gesture = useRef<{
    mode: 'pan' | 'pinch' | null;
    axis: 'x' | 'y' | null; // 批次187:单指轴锁 —— 纵向让外层 sheet 滚,横向才平移图
    startX: number; startY: number;
    viewX: number; viewY: number;
    startDist: number; startW: number; startH: number;
    cx: number; cy: number;
  }>({ mode: null, axis: null, startX: 0, startY: 0, viewX: 0, viewY: 0, startDist: 0, startW: 0, startH: 0, cx: 0, cy: 0 });

  useEffect(() => { setSelected(focusId ?? null); }, [focusId]);

  function clientScale(): number {
    return view.w / (svgRef.current?.clientWidth || width);
  }

  function zoomAt(factor: number, clientX?: number, clientY?: number) {
    setView((v) => {
      const zoom = width / v.w;
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
      const nw = width / nextZoom;
      const nh = height / nextZoom;
      // 围绕指针位置缩放;缺省围绕中心
      const rect = svgRef.current?.getBoundingClientRect();
      const fx = rect && clientX != null ? (clientX - rect.left) / rect.width : 0.5;
      const fy = rect && clientY != null ? (clientY - rect.top) / rect.height : 0.5;
      return {
        x: v.x + (v.w - nw) * fx,
        y: v.y + (v.h - nh) * fy,
        w: nw,
        h: nh,
      };
    });
  }

  // 批次 39:视口夹取 —— 平移时不让图漂出视口(用户反馈「关系网络会漂移」)。
  // 保证至少露出内容边界内的一部分,拖过头会停住而不是飞走。
  function clampView(v: { x: number; y: number; w: number; h: number }) {
    const xs = layout.nodes.map((n) => n.x);
    const ys = layout.nodes.map((n) => n.y);
    if (!xs.length) return v;
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const m = NODE_R * 3;
    return {
      ...v,
      x: Math.max(minX - v.w + m, Math.min(maxX - m, v.x)),
      y: Math.max(minY - v.h + m, Math.min(maxY - m, v.y)),
    };
  }

  if (nodes.length === 0) {
    return (
      <div className="rg-empty">
        <span className="rg-empty-icon">◎</span>
        <p className="rg-empty-text">{resolvedEmptyText}</p>
      </div>
    );
  }

  const nodeMap = new Map<string, GNodePos>(layout.nodes.map(n => [n.id, n]));
  const activeId = selected;
  const activeNeighbors = activeId
    ? new Set(
        edges
          .filter(e => e.source === activeId || e.target === activeId)
          .flatMap(e => [e.source, e.target]),
      )
    : null;

  return (
    <div className="rg-wrap rg-wrap--starmap">
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        width="100%"
        height={height}
        style={{ display: 'block', touchAction: 'pan-y' }}
        className="rg-svg"
        onWheel={(e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 0.87, e.clientX, e.clientY); }}
        onDoubleClick={() => setView(fit)}
        onTouchStart={(e) => {
          const g = gesture.current;
          g.axis = null;
          if (e.touches.length === 2) {
            const [a, b] = [e.touches[0], e.touches[1]];
            g.mode = 'pinch';
            g.startDist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
            g.startW = view.w; g.startH = view.h;
            g.cx = (a.clientX + b.clientX) / 2; g.cy = (a.clientY + b.clientY) / 2;
            g.viewX = view.x; g.viewY = view.y;
          } else if (e.touches.length === 1) {
            const t = e.touches[0];
            g.mode = 'pan';
            g.startX = t.clientX; g.startY = t.clientY;
            g.viewX = view.x; g.viewY = view.y;
          }
        }}
        onTouchMove={(e) => {
          const g = gesture.current;
          if (g.mode === 'pinch' && e.touches.length === 2) {
            const [a, b] = [e.touches[0], e.touches[1]];
            const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
            const raw = g.startDist / Math.max(1, dist);
            const zoomLimited = Math.min(width / (MIN_ZOOM * width), Math.max(width / (MAX_ZOOM * width), raw));
            const nw = Math.min(width / MIN_ZOOM, Math.max(width / MAX_ZOOM, g.startW * zoomLimited));
            const nh = nw * (g.startH / g.startW);
            const rect = svgRef.current?.getBoundingClientRect();
            const fx = rect ? (g.cx - rect.left) / rect.width : 0.5;
            const fy = rect ? (g.cy - rect.top) / rect.height : 0.5;
            setView({
              x: g.viewX + (g.startW - nw) * fx,
              y: g.viewY + (g.startH - nh) * fy,
              w: nw,
              h: nh,
            });
          } else if (g.mode === 'pan' && e.touches.length === 1) {
            const t = e.touches[0];
            const dx = t.clientX - g.startX;
            const dy = t.clientY - g.startY;
            // 批次187:轴锁 —— 第一次明显位移定方向。纵向交给外层 sheet 滚(touch-action: pan-y),
            // 只有横向才平移图,否则嵌在可滚动详情里的图会把整页滚动吃掉(用户实锤:关系 tab 卡死不能滚)。
            if (g.axis == null) {
              if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
              g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
            }
            if (g.axis === 'y') return;
            const s = clientScale();
            setView((v) => clampView({ ...v, x: g.viewX - dx * s, y: g.viewY - dy * s }));
          }
        }}
        onTouchEnd={() => { gesture.current.mode = null; }}
      >
        <defs>
          <marker id="rg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="rgba(160,175,205,0.65)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>

        {/* 边:虚线 + 箭头(参考稿) */}
        {layout.edges.map((e, i) => {
          const a = nodeMap.get(e.source);
          const b = nodeMap.get(e.target);
          if (!a || !b) return null;
          const isActive = activeId === e.source || activeId === e.target;
          const isDimmed = activeId !== null && !isActive;
          // 端点缩到节点边缘,箭头不插进圆里
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.max(1, Math.hypot(dx, dy));
          const ux = dx / len;
          const uy = dy / len;
          const x1 = a.x + ux * (NODE_R + 3);
          const y1 = a.y + uy * (NODE_R + 3);
          const x2 = b.x - ux * (NODE_R + 6);
          const y2 = b.y - uy * (NODE_R + 6);
          return (
            <line
              key={i}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={isActive ? 'rgba(140,170,230,0.9)' : 'rgba(160,175,205,0.45)'}
              strokeWidth={isActive ? 2 : 1.4}
              strokeDasharray="5 5"
              strokeOpacity={isDimmed ? 0.15 : 1}
              markerEnd="url(#rg-arrow)"
              style={{ transition: 'stroke-opacity 0.2s' }}
            />
          );
        })}

        {/* 节点:实心彩圆 + 内嵌两行白字(参考稿) */}
        {layout.nodes.map(n => {
          const isFocus = n.id === focusId;
          const isActive = n.id === activeId;
          const isNeighbor = activeNeighbors?.has(n.id) ?? false;
          const isDimmed = activeId !== null && !isActive && !isNeighbor;
          const fill = TYPE_FILL[String(n.type ?? '')] ?? (n.color || DEFAULT_FILL);
          const r = isFocus || isActive ? NODE_R + 3 : NODE_R;
          const [l1, l2] = splitLabel(n.label);

          return (
            <g
              key={n.id}
              style={{ cursor: 'pointer', opacity: isDimmed ? 0.28 : 1, transition: 'opacity 0.2s' }}
              onClick={() => {
                const next = selected === n.id ? null : n.id;
                setSelected(next);
                if (next) onNodeClick?.(n.id);
              }}
            >
              {(isActive || isFocus) && (
                <circle cx={n.x} cy={n.y} r={r + 8} fill={fill} opacity={0.18} />
              )}
              <circle
                cx={n.x} cy={n.y} r={r}
                fill={fill}
                stroke="rgba(255,255,255,0.85)"
                strokeWidth={1.6}
              />
              <text
                x={n.x}
                y={l2 ? n.y - 2 : n.y + 4}
                textAnchor="middle"
                fontSize={11}
                fontWeight={600}
                fill="var(--portal-on-accent, #fff)"
                style={{ pointerEvents: 'none' }}
              >
                {l1}
              </text>
              {l2 && (
                <text
                  x={n.x}
                  y={n.y + 11}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill="var(--portal-on-accent, #fff)"
                  style={{ pointerEvents: 'none' }}
                >
                  {l2}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="rg-zoom-hint">{L(dict, '双指缩放 · 拖动平移 · 双击复位', 'Pinch to zoom · drag to pan · double-tap to reset')}</p>
    </div>
  );
}
