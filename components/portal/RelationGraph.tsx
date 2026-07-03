'use client';

/**
 * RelationGraph — 通用关系图 SVG 组件
 * 用 graph-engine 弹簧布局，可点击节点导航
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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

export default function RelationGraph({
  nodes,
  edges,
  width = 320,
  height = 280,
  focusId,
  onNodeClick,
  emptyText = '暂无关联节点',
}: Props) {
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
        <p className="rg-empty-text">{emptyText}</p>
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
        {/* Edge lines */}
        {layout.edges.map((e, i) => {
          const a = nodeMap.get(e.source);
          const b = nodeMap.get(e.target);
          if (!a || !b) return null;
          const isActive = activeId === e.source || activeId === e.target;
          const isDimmed = activeId !== null && !isActive;
          return (
            <g key={i}>
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={isActive ? 'var(--portal-accent)' : 'var(--portal-line)'}
                strokeWidth={isActive ? 1.5 : 0.8}
                strokeOpacity={isDimmed ? 0.15 : isActive ? 0.7 : 0.4}
                style={{ transition: 'stroke 0.2s, stroke-opacity 0.2s' }}
              />
              {/* Edge label on active */}
              {isActive && e.label && (
                <text
                  x={(a.x + b.x) / 2}
                  y={(a.y + b.y) / 2 - 4}
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

        {/* Nodes */}
        {layout.nodes.map(n => {
          const isActive = n.id === activeId;
          const isNeighbor = activeNeighbors?.has(n.id) ?? false;
          const isDimmed = activeId !== null && !isActive && !isNeighbor;
          const col = n.color ?? 'var(--portal-accent)';

          return (
            <g
              key={n.id}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => {
                const next = selected === n.id ? null : n.id;
                setSelected(next);
                if (next) onNodeClick?.(n.id);
              }}
            >
              {/* Halo */}
              {(isActive || isNeighbor) && (
                <circle cx={n.x} cy={n.y} r={n.r + 6} fill={col} opacity={0.1} />
              )}
              <circle
                cx={n.x} cy={n.y} r={n.r}
                fill={col}
                fillOpacity={isDimmed ? 0.15 : isActive ? 0.9 : 0.55}
                stroke={col}
                strokeWidth={isActive ? 1.5 : 0.5}
                strokeOpacity={0.6}
                style={{ transition: 'fill-opacity 0.2s' }}
              />
              <circle cx={n.x} cy={n.y} r={2} fill="white" opacity={isDimmed ? 0.2 : 0.8} />

              {/* Label */}
              <text
                x={n.x}
                y={n.y + n.r + 11}
                textAnchor="middle"
                fontSize={isActive ? 9 : 8}
                fontWeight={isActive ? 700 : 400}
                fill={isDimmed ? 'var(--portal-muted)' : 'var(--portal-ink)'}
                opacity={isDimmed ? 0.3 : 1}
                style={{ pointerEvents: 'none', transition: 'opacity 0.2s' }}
              >
                {n.label.length > 10 ? n.label.slice(0, 9) + '…' : n.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
