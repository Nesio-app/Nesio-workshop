'use client';

/**
 * RelationGraph — 通用关系图 SVG 组件
 * 用 graph-engine 弹簧布局，可点击节点导航。
 * 2026-07-04 视觉重制:曲线边 + 柔光节点 + 标签药丸,替代灰圆细线(用户反馈「太丑」)。
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

/** 中文按 2 个字符宽估算标签药丸宽度(SVG 无法自动测量) */
function pillWidth(label: string): number {
  let w = 0;
  for (const ch of label) w += ch.charCodeAt(0) > 255 ? 9 : 5.2;
  return w + 12;
}

function clampLabel(label: string): string {
  return label.length > 8 ? label.slice(0, 7) + '…' : label;
}

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
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(focusId ?? null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Recompute layout only when nodes/edges change
  const layout = useMemo(
    () => buildLayout(nodes, edges, width, height),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes.map(n => n.id).join(','), edges.map(e => `${e.source}-${e.target}`).join(','), width, height],
  );

  // Pan support for mobile
  const panRef = useRef<{ startX: number; startY: number; viewX: number; viewY: number } | null>(null);
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });

  useEffect(() => { setSelected(focusId ?? null); }, [focusId]);

  if (nodes.length === 0) {
    return (
      <div className="rg-empty">
        <span className="rg-empty-icon">◎</span>
        <p className="rg-empty-text">{resolvedEmptyText}</p>
      </div>
    );
  }

  const activeId = selected ?? hovered;
  const activeNeighbors = activeId
    ? new Set(
        edges
          .filter(e => e.source === activeId || e.target === activeId)
          .flatMap(e => [e.source, e.target]),
      )
    : null;

  const nodeMap = new Map<string, GNodePos>(layout.nodes.map(n => [n.id, n]));

  return (
    <div className="rg-wrap">
      <svg
        ref={svgRef}
        viewBox={`${viewOffset.x} ${viewOffset.y} ${width} ${height}`}
        width="100%"
        style={{ display: 'block' }}
        className="rg-svg"
        onTouchStart={e => {
          const t = e.touches[0];
          panRef.current = { startX: t.clientX, startY: t.clientY, viewX: viewOffset.x, viewY: viewOffset.y };
        }}
        onTouchMove={e => {
          if (!panRef.current) return;
          const t = e.touches[0];
          const scale = width / (svgRef.current?.clientWidth ?? width);
          setViewOffset({
            x: panRef.current.viewX - (t.clientX - panRef.current.startX) * scale,
            y: panRef.current.viewY - (t.clientY - panRef.current.startY) * scale,
          });
        }}
        onTouchEnd={() => { panRef.current = null; }}
      >
        <defs>
          <filter id="rg-node-shadow" x="-60%" y="-60%" width="220%" height="220%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="2" floodColor="var(--portal-blue-deep)" floodOpacity="0.28" />
          </filter>
        </defs>

        {/* Edges — 轻弧线,焦点边走强调色 */}
        {layout.edges.map((e, i) => {
          const a = nodeMap.get(e.source);
          const b = nodeMap.get(e.target);
          if (!a || !b) return null;
          const isActive = activeId === e.source || activeId === e.target;
          const isDimmed = activeId !== null && !isActive;
          // 控制点:边中点垂直偏移,画出柔和的弧
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.max(1, Math.hypot(dx, dy));
          const cx = mx - (dy / len) * Math.min(18, len * 0.18);
          const cy = my + (dx / len) * Math.min(18, len * 0.18);
          return (
            <g key={i}>
              <path
                d={`M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`}
                fill="none"
                stroke={isActive ? 'var(--portal-accent)' : 'var(--portal-line)'}
                strokeWidth={isActive ? 1.6 : 1}
                strokeOpacity={isDimmed ? 0.12 : isActive ? 0.75 : 0.5}
                strokeLinecap="round"
                style={{ transition: 'stroke 0.2s, stroke-opacity 0.2s' }}
              />
              {isActive && e.label && (
                <text
                  x={cx}
                  y={cy - 4}
                  textAnchor="middle"
                  fontSize={8}
                  fill="var(--portal-muted)"
                  style={{ pointerEvents: 'none' }}
                >
                  {e.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Nodes — 色环 + 白芯 + 投影;焦点节点更大并带光晕 */}
        {layout.nodes.map(n => {
          const isFocus = n.id === focusId;
          const isActive = n.id === activeId;
          const isNeighbor = activeNeighbors?.has(n.id) ?? false;
          const isDimmed = activeId !== null && !isActive && !isNeighbor;
          const col = n.color ?? 'var(--portal-accent)';
          const r = isFocus ? n.r + 3 : n.r;
          const label = clampLabel(n.label);
          const pw = pillWidth(label);

          return (
            <g
              key={n.id}
              style={{ cursor: 'pointer', opacity: isDimmed ? 0.3 : 1, transition: 'opacity 0.2s' }}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => {
                const next = selected === n.id ? null : n.id;
                setSelected(next);
                if (next) onNodeClick?.(n.id);
              }}
            >
              {/* 光晕 */}
              {(isActive || isNeighbor || isFocus) && (
                <circle cx={n.x} cy={n.y} r={r + 7} fill={col} opacity={0.14} />
              )}
              {/* 色环 */}
              <circle
                cx={n.x} cy={n.y} r={r}
                fill={col}
                fillOpacity={isActive || isFocus ? 1 : 0.85}
                filter="url(#rg-node-shadow)"
                style={{ transition: 'fill-opacity 0.2s' }}
              />
              {/* 白芯,让色环变成圆环感 */}
              <circle cx={n.x} cy={n.y} r={Math.max(2.5, r - 3.5)} fill="var(--glass-bg-solid, #fff)" opacity={0.92} />
              <circle cx={n.x} cy={n.y} r={Math.max(1.4, r * 0.22)} fill={col} />

              {/* 标签药丸 */}
              <rect
                x={n.x - pw / 2}
                y={n.y + r + 5}
                width={pw}
                height={14}
                rx={7}
                fill="var(--glass-bg-solid, #fff)"
                opacity={0.9}
                stroke="var(--portal-line)"
                strokeWidth={0.6}
              />
              <text
                x={n.x}
                y={n.y + r + 15}
                textAnchor="middle"
                fontSize={isActive ? 8.6 : 8}
                fontWeight={isActive || isFocus ? 700 : 500}
                fill="var(--portal-ink)"
                style={{ pointerEvents: 'none' }}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
