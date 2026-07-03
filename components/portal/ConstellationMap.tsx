'use client';

/**
 * 认知模型星座图 — 固定布局 SVG，7个认知层=星座区域，洞察=星点
 * 不用力导向，手机原生友好。
 */

import { useState } from 'react';
import type { LivingModel, LivingModelLayerId } from '@/lib/platform/living-model';

// Fixed ring positions for 7 layers (unit circle, 0=top, clockwise)
const RING_ANGLES: Record<LivingModelLayerId, number> = {
  identity:   -90,   // top
  motivation: -34,
  principles:  26,
  patterns:    86,
  blind_spots: 146,
  evolution:   206,
  prediction:  266,
};

const LAYER_COLOR: Record<LivingModelLayerId, string> = {
  identity:   'var(--portal-accent)',
  motivation: 'var(--status-gentle)',
  principles: 'var(--status-go)',
  patterns:   'var(--status-calm)',
  blind_spots:'var(--status-risk)',
  evolution:  'var(--portal-cool-accent)',
  prediction: 'var(--portal-muted)',
};

// Demo insights for when model is null / empty
const DEMO_MODEL = {
  identity:   { label: '身份认同', icon: '🪞', insights: [{content:'追求深度而非广度', confidence: 78},{content:'独立决策风格强', confidence: 65}] },
  motivation: { label: '驱动力',   icon: '⚡', insights: [{content:'创造渴望是主要动力', confidence: 82}] },
  principles: { label: '原则',     icon: '⚖️', insights: [{content:'优先质量而非速度', confidence: 70}] },
  patterns:   { label: '模式',     icon: '🔄', insights: [{content:'压力下倾向独自消化', confidence: 74},{content:'夜晚思考更清晰', confidence: 60}] },
  blind_spots:{ label: '盲区',     icon: '🌑', insights: [{content:'低估关系维护成本', confidence: 68}] },
  evolution:  { label: '演化',     icon: '🌱', insights: [{content:'最近对健康关注增加', confidence: 72}] },
  prediction: { label: '预测',     icon: '🔭', insights: [{content:'下季度可能聚焦学习', confidence: 58}] },
};

function degToRad(deg: number) { return (deg * Math.PI) / 180; }

interface Props {
  model: LivingModel | null;
  onLayerClick?: (layerId: LivingModelLayerId) => void;
}

export default function ConstellationMap({ model, onLayerClick }: Props) {
  const [hovered, setHovered] = useState<LivingModelLayerId | null>(null);
  const [selected, setSelected] = useState<LivingModelLayerId | null>(null);

  const W = 320;
  const H = 320;
  const CX = 160;
  const CY = 160;
  const RING_R = 110; // radius of the ring

  const isDemo = !model || !model.layers.some(l => l.insights.length > 0);

  // Build node data from model or demo
  const nodes = (Object.entries(RING_ANGLES) as [LivingModelLayerId, number][]).map(([id, angleDeg]) => {
    const rad = degToRad(angleDeg);
    const x = CX + RING_R * Math.cos(rad);
    const y = CY + RING_R * Math.sin(rad);

    let insights: { content: string; confidence: number }[] = [];
    let label = '';
    let icon = '';

    if (!isDemo) {
      const layer = model!.layers.find(l => l.id === id);
      insights = (layer?.insights ?? []).filter(i => i.confidence >= 55).slice(0, 3);
      label = layer?.label ?? id;
      icon = layer?.icon ?? '';
    } else {
      const d = DEMO_MODEL[id];
      insights = d.insights;
      label = d.label;
      icon = d.icon;
    }

    const avgConf = insights.length
      ? insights.reduce((s, i) => s + i.confidence, 0) / insights.length / 100
      : 0.3;

    const r = 8 + avgConf * 12; // 8–20px radius

    return { id, x, y, r, label, icon, insights, angleDeg };
  });

  // Constellation edge lines (fixed topology)
  const EDGES: [LivingModelLayerId, LivingModelLayerId][] = [
    ['identity', 'motivation'],
    ['motivation', 'principles'],
    ['principles', 'patterns'],
    ['patterns', 'blind_spots'],
    ['blind_spots', 'evolution'],
    ['evolution', 'prediction'],
    ['prediction', 'identity'],
    ['identity', 'patterns'],  // cross-link
    ['motivation', 'blind_spots'],
  ];

  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));

  const activeNode = selected ?? hovered;
  const activeInsights = activeNode ? nodeMap[activeNode]?.insights : null;
  const activeLabel = activeNode ? nodeMap[activeNode]?.label : null;

  return (
    <div className="cst-wrap">
      {isDemo && (
        <p className="cst-demo-note">示例星图 · 积累 10+ 条记录后将展示你的认知模型</p>
      )}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        className="cst-svg"
        aria-label="认知模型星座图"
      >
        {/* Background dots (ambient stars) */}
        {AMBIENT_STARS.map((s, i) => (
          <circle key={i} cx={s[0]} cy={s[1]} r={s[2]} fill="var(--portal-muted)" opacity={0.18} />
        ))}

        {/* Edge lines */}
        {EDGES.map(([a, b], i) => {
          const na = nodeMap[a], nb = nodeMap[b];
          if (!na || !nb) return null;
          const isActive = activeNode === a || activeNode === b;
          return (
            <line
              key={i}
              x1={na.x} y1={na.y}
              x2={nb.x} y2={nb.y}
              stroke={isActive ? 'var(--portal-accent)' : 'var(--portal-line)'}
              strokeWidth={isActive ? 1.2 : 0.7}
              strokeOpacity={isActive ? 0.6 : 0.35}
              style={{ transition: 'stroke 0.2s, stroke-width 0.2s' }}
            />
          );
        })}

        {/* Glow halos for active node */}
        {nodes.map(n => {
          const isActive = n.id === activeNode;
          if (!isActive) return null;
          return (
            <circle
              key={`halo-${n.id}`}
              cx={n.x} cy={n.y}
              r={n.r + 8}
              fill={LAYER_COLOR[n.id]}
              opacity={0.12}
            />
          );
        })}

        {/* Layer nodes */}
        {nodes.map(n => {
          const col = LAYER_COLOR[n.id];
          const isActive = n.id === activeNode;
          const isDimmed = activeNode !== null && !isActive;
          return (
            <g
              key={n.id}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => {
                setSelected(prev => prev === n.id ? null : n.id);
                onLayerClick?.(n.id);
              }}
            >
              <circle
                cx={n.x} cy={n.y} r={n.r}
                fill={col}
                fillOpacity={isDimmed ? 0.2 : isActive ? 0.85 : 0.55}
                stroke={col}
                strokeWidth={isActive ? 1.5 : 0.5}
                strokeOpacity={0.6}
                style={{ transition: 'fill-opacity 0.2s, r 0.2s' }}
              />
              {/* Inner star sparkle */}
              <circle
                cx={n.x} cy={n.y} r={2}
                fill="white"
                opacity={isDimmed ? 0.2 : 0.7}
              />
              {/* Satellite dots for each insight */}
              {n.insights.map((ins, idx) => {
                const satAngle = degToRad(n.angleDeg + 90 + idx * (360 / Math.max(n.insights.length, 1)));
                const satR = n.r + 6;
                const sx = n.x + satR * Math.cos(satAngle);
                const sy = n.y + satR * Math.sin(satAngle);
                return (
                  <circle
                    key={idx}
                    cx={sx} cy={sy} r={2.5}
                    fill={col}
                    opacity={isDimmed ? 0.15 : 0.5}
                  />
                );
              })}
            </g>
          );
        })}

        {/* Layer labels */}
        {nodes.map(n => {
          const isDimmed = activeNode !== null && n.id !== activeNode;
          // Place label outside the ring
          const rad = degToRad(n.angleDeg);
          const lx = CX + (RING_R + n.r + 14) * Math.cos(rad);
          const ly = CY + (RING_R + n.r + 14) * Math.sin(rad);
          const anchor = lx < CX - 10 ? 'end' : lx > CX + 10 ? 'start' : 'middle';

          return (
            <text
              key={`lbl-${n.id}`}
              x={lx} y={ly}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize={9.5}
              fontWeight={n.id === activeNode ? 700 : 500}
              fill={LAYER_COLOR[n.id]}
              opacity={isDimmed ? 0.25 : 1}
              style={{ pointerEvents: 'none', transition: 'opacity 0.2s' }}
            >
              {n.icon} {n.label}
            </text>
          );
        })}
      </svg>

      {/* Insight detail panel */}
      {activeInsights && activeInsights.length > 0 && (
        <div className="cst-detail">
          <p className="cst-detail-title">{nodeMap[activeNode!]?.icon} {activeLabel}</p>
          {activeInsights.map((ins, i) => (
            <div key={i} className="cst-detail-insight">
              <div className="cst-detail-bar">
                <div
                  className="cst-detail-bar-fill"
                  style={{
                    width: `${ins.confidence}%`,
                    background: LAYER_COLOR[activeNode!],
                  }}
                />
              </div>
              <p className="cst-detail-text">{ins.content}</p>
              <span className="cst-detail-conf">{ins.confidence}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Pre-computed ambient background stars (static, decorative)
const AMBIENT_STARS: [number, number, number][] = [
  [32,28,1],[58,12,1.2],[98,22,0.8],[145,8,1],[195,18,1.1],[240,11,0.9],[278,30,1.2],
  [305,55,0.8],[315,98,1],[308,142,0.9],[295,185,1.1],[278,228,0.8],[248,268,1],
  [205,298,1.2],[158,308,0.9],[112,300,1],[68,282,0.8],[28,248,1.1],[12,198,0.9],
  [18,148,1],[22,98,0.8],[42,58,1.2],[88,42,0.9],[138,32,1],[188,38,1.1],
  [118,118,0.7],[178,88,0.8],[228,138,0.7],[188,198,0.8],[128,228,0.7],
];
