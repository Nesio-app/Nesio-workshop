'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import type { LifeNode, LifeNodeType } from '@/lib/portal/life-graph';
import { stack, stackOffsetWiggle, stackOrderInsideOut, area, curveCatmullRom } from 'd3-shape';
import { scaleTime, scaleLinear } from 'd3-scale';
import { extent, max } from 'd3-array';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

// ── Domain config ────────────────────────────────────────────────────────────

const DOMAINS = [
  { id: 'relations', label: '关系', labelEn: 'Ties',    cssVar: '--portal-accent' },
  { id: 'work',      label: '事业', labelEn: 'Work',    cssVar: '--status-gentle' },
  { id: 'health',    label: '健康', labelEn: 'Health',  cssVar: '--status-go' },
  { id: 'growth',    label: '成长', labelEn: 'Growth',  cssVar: '--status-calm' },
  { id: 'self',      label: '自我', labelEn: 'Self',    cssVar: '--portal-cool-accent' },
] as const;

type DomainId = typeof DOMAINS[number]['id'];

const TYPE_TO_DOMAIN: Record<LifeNodeType, DomainId> = {
  person:       'relations',
  event:        'self',
  commitment:   'work',
  health_state: 'health',
  preference:   'self',
  place:        'growth',
  object:       'self',
  note:         'growth',
};

const TAG_KEYWORDS: Record<DomainId, string[]> = {
  relations: ['朋友', 'friend', '家人', 'family', '爱', '关系', '社交', '恋爱'],
  work:      ['工作', 'work', '项目', 'project', '目标', 'goal', '事业', '职场', '创业'],
  health:    ['健康', 'health', '睡眠', 'sleep', '运动', '身体', '情绪', '疲惫', '医'],
  growth:    ['学习', 'learn', '成长', 'grow', '书', 'book', '技能', '知识', '课程'],
  self:      ['自我', '反思', 'reflect', '感受', '内心', '旅行', '探索', '创作', '梦想'],
};

// ── Data pipeline ────────────────────────────────────────────────────────────

function detectDomain(node: LifeNode): DomainId {
  const searchText = [
    node.name,
    node.rawInput ?? '',
    ...(node.tags ?? []),
  ].join(' ').toLowerCase();

  for (const [id, kws] of Object.entries(TAG_KEYWORDS) as [DomainId, string[]][]) {
    if (kws.some(kw => searchText.includes(kw))) return id;
  }
  return TYPE_TO_DOMAIN[node.type] ?? 'self';
}

function meaningScore(node: LifeNode): number {
  const base = node.confidence ?? 0.5;
  const conn = Math.min((node.relations?.length ?? 0) * 0.12, 0.35);
  const tags = Math.min((node.tags?.length ?? 0) * 0.08, 0.25);
  const asset = (node.assets?.length ?? 0) > 0 ? 0.15 : 0;
  return Math.min(base + conn + tags + asset, 1.0);
}

interface Bucket {
  date: Date;
  relations: number;
  work: number;
  health: number;
  growth: number;
  self: number;
  peakNodes: Partial<Record<DomainId, LifeNode>>;
}

function buildStream(nodes: LifeNode[]): Bucket[] {
  // v1 规格 §2.2:绝不以示例地形冒充 —— 数据不够就不画,门槛(90 天)由调用方把守。
  if (nodes.length === 0) return [];

  const sorted = [...nodes].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const earliest = new Date(sorted[0].createdAt);
  const latest = new Date();

  // Build month buckets
  const map = new Map<string, Bucket>();
  let cur = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
  while (cur <= latest) {
    const key = `${cur.getFullYear()}-${cur.getMonth()}`;
    map.set(key, {
      date: new Date(cur),
      relations: 0, work: 0, health: 0, growth: 0, self: 0,
      peakNodes: {},
    });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }

  // Fill
  for (const node of nodes) {
    const d = new Date(node.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const b = map.get(key);
    if (!b) continue;
    const domain = detectDomain(node);
    const score = meaningScore(node);
    b[domain] += score;
    const prev = b.peakNodes[domain];
    if (!prev || score > meaningScore(prev)) b.peakNodes[domain] = node;
  }

  const result = Array.from(map.values());

  // Relative normalization: each bucket sums to 1 (territory proportions)
  for (const b of result) {
    const total = DOMAINS.reduce((s, d) => s + b[d.id], 0);
    if (total > 0) {
      for (const d of DOMAINS) b[d.id] = b[d.id] / total;
    } else {
      for (const d of DOMAINS) b[d.id] = 0.2; // equal share in empty periods
    }
  }

  // 至少 2 个月才画得出河流;不够就不画,不再回落示例地形。
  if (result.length < 2) return [];

  return result;
}

// ── Insight generation ───────────────────────────────────────────────────────

function generateInsight(data: Bucket[], dict: string = 'zh'): string | null {
  if (data.length < 4) return null;

  // Find biggest single-period domain shift
  let maxShift = 0;
  let shiftIdx = -1;
  let gainDomain: DomainId = 'self';
  let lossDomain: DomainId = 'work';

  for (let i = 2; i < data.length; i++) {
    for (const d of DOMAINS) {
      const delta = data[i][d.id] - data[i - 2][d.id];
      if (delta > maxShift) {
        maxShift = delta;
        shiftIdx = i;
        gainDomain = d.id;
        // find what lost most
        lossDomain = DOMAINS
          .filter(x => x.id !== d.id)
          .sort((a, b) => (data[i - 2][b.id] - data[i][b.id]) - (data[i - 2][a.id] - data[i][a.id]))[0].id;
      }
    }
  }

  if (shiftIdx < 0 || maxShift < 0.06) return null;

  const d = data[shiftIdx].date;
  const gainMeta = DOMAINS.find(x => x.id === gainDomain);
  const lossMeta = DOMAINS.find(x => x.id === lossDomain);
  const gain = L(dict, gainMeta?.label ?? gainDomain, gainMeta?.labelEn ?? gainDomain);
  const loss = L(dict, lossMeta?.label ?? lossDomain, lossMeta?.labelEn ?? lossDomain);
  const period = L(dict, `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`, d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' }));

  return L(dict,
    `${period}前后，「${gain}」开始扩张，逐渐从「${loss}」手中接管你更多的能量`,
    `Around ${period}, "${gain}" began expanding, gradually taking over more of your energy from "${loss}"`);
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  nodes: LifeNode[];
}

export default function LifeMap({ nodes }: Props) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<DomainId | null>(null);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [containerW, setContainerW] = useState(680);

  // eslint-disable-next-line no-restricted-syntax -- 运行时 getComputedStyle 兜底需真实色值,镜像 --portal-blue-deep
  const FALLBACK_DOMAIN_COLOR = '#588ce3';

  // Resolve CSS variable colors at runtime (Canvas/SVG can't use var())
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const resolved: Record<string, string> = {};
    for (const d of DOMAINS) {
      resolved[d.id] = cs.getPropertyValue(d.cssVar).trim() || FALLBACK_DOMAIN_COLOR;
    }
    setColors(resolved);
  }, []);

  // Responsive width
  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setContainerW(entry.contentRect.width || 680);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const HEIGHT = 240;
  const MARGIN = { top: 20, right: 12, bottom: 28, left: 8 };
  const W = Math.max(containerW, 300);

  const streamData = useMemo(() => buildStream(nodes), [nodes]);
  const insight    = useMemo(() => generateInsight(streamData, dict), [streamData, dict]);

  // D3 computation (pure math, no DOM)
  const { paths, xTicks, domainCenters } = useMemo(() => {
    if (streamData.length < 2) return { paths: [], xTicks: [], domainCenters: [] };
    const innerW = W - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

    const xSc = scaleTime()
      .domain([streamData[0].date, streamData[streamData.length - 1].date])
      .range([0, innerW]);

    const stacker = stack<Bucket, DomainId>()
      .keys(DOMAINS.map(d => d.id) as DomainId[])
      .offset(stackOffsetWiggle)
      .order(stackOrderInsideOut);

    const stacked = stacker(streamData);

    const allY = stacked.flatMap(s => s.flatMap(pt => [pt[0], pt[1]]));
    const [yMin = 0, yMax = 1] = extent(allY) as [number, number];
    const ySc = scaleLinear().domain([yMin, yMax]).range([innerH, 0]);

    const areaGen = area<ReturnType<typeof stacker>[0][0]>()
      .x((_, i) => xSc(streamData[i].date))
      .y0(pt => ySc(pt[0]))
      .y1(pt => ySc(pt[1]))
      .curve(curveCatmullRom.alpha(0.5));

    const paths = stacked.map((series, idx) => {
      // Find widest point for label placement
      let maxW = 0, maxI = 0;
      series.forEach((pt, i) => {
        const w = pt[1] - pt[0];
        if (w > maxW) { maxW = w; maxI = i; }
      });
      const cx = xSc(streamData[maxI].date);
      const cy = ySc((series[maxI][0] + series[maxI][1]) / 2);

      return {
        domainId: DOMAINS[idx].id as DomainId,
        d: areaGen(series) ?? '',
        labelX: cx,
        labelY: cy,
        labelVisible: maxW > 0.08,
      };
    });

    // X axis: show ~5 ticks
    const step = Math.max(1, Math.floor(streamData.length / 5));
    const xTicks = streamData
      .filter((_, i) => i % step === 0 || i === streamData.length - 1)
      .map(b => ({
        x: xSc(b.date),
        label: `${b.date.getFullYear()}.${String(b.date.getMonth() + 1).padStart(2, '0')}`,
      }));

    return { paths, xTicks, domainCenters: paths.map(p => ({ id: p.domainId, x: p.labelX, y: p.labelY })) };
  }, [streamData, W, HEIGHT]);

  // 数据不满两个月:什么都不画(调用方负责显示"需要 90 天"的诚实说明)
  if (streamData.length < 2) return null;

  return (
    <div className="life-map-wrap">
      {/* 顶部解读:最大迁移标注(全部来自真实数据 —— 示例地形已废除) */}
      {insight && (
        <div className="life-map-insight">
          <span className="life-map-insight-icon">◉</span>
          <span>{insight}</span>
        </div>
      )}

      {/* Stream SVG */}
      <div className="life-map-svg-wrap">
        <svg
          ref={svgRef}
          width={W}
          height={HEIGHT}
          className="life-map-svg"
          role="img"
          aria-label={L(dict, '生命版图：各领域随时间演变的意义分布', 'Life map: how meaning shifts across life domains over time')}
        >
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {/* Territory paths */}
            {paths.map(({ domainId, d }) => {
              const col = colors[domainId] ?? FALLBACK_DOMAIN_COLOR;
              const isDimmed = hovered !== null && hovered !== domainId;
              return (
                <path
                  key={domainId}
                  d={d}
                  fill={col}
                  fillOpacity={isDimmed ? 0.15 : 0.70}
                  stroke={col}
                  strokeWidth={hovered === domainId ? 1.5 : 0}
                  strokeOpacity={0.6}
                  style={{ transition: 'fill-opacity 0.25s ease, stroke-width 0.2s ease' }}
                  onMouseEnter={() => setHovered(domainId)}
                  onMouseLeave={() => setHovered(null)}
                  onTouchStart={() => setHovered(prev => prev === domainId ? null : domainId)}
                />
              );
            })}

            {/* Domain labels */}
            {paths.map(({ domainId, labelX, labelY, labelVisible }) => {
              if (!labelVisible) return null;
              const domain = DOMAINS.find(d => d.id === domainId)!;
              const col = colors[domainId] ?? FALLBACK_DOMAIN_COLOR;
              const isDimmed = hovered !== null && hovered !== domainId;
              return (
                <text
                  key={`lbl-${domainId}`}
                  x={labelX}
                  y={labelY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={col}
                  fontSize={11}
                  fontWeight={700}
                  letterSpacing="0.02em"
                  opacity={isDimmed ? 0.2 : 1}
                  style={{ pointerEvents: 'none', transition: 'opacity 0.25s ease' }}
                >
                  {L(dict, domain.label, domain.labelEn)}
                </text>
              );
            })}

            {/* X axis */}
            {xTicks.map(({ x, label }, i) => (
              <g key={i} transform={`translate(${x},${HEIGHT - MARGIN.top - MARGIN.bottom})`}>
                <line y2={4} stroke="var(--portal-line)" />
                <text
                  y={14}
                  textAnchor="middle"
                  fill="var(--portal-muted)"
                  fontSize={9}
                  opacity={0.7}
                >
                  {label}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>

      {/* Legend */}
      <div className="life-map-legend">
        {DOMAINS.map(d => (
          <button
            key={d.id}
            className={`life-map-legend-btn${hovered === d.id ? ' life-map-legend-btn--on' : ''}`}
            onMouseEnter={() => setHovered(d.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => setHovered(prev => prev === d.id ? null : d.id)}
          >
            <span
              className="life-map-legend-dot"
              style={{ background: colors[d.id] ?? 'var(--portal-accent)' }}
            />
            {L(dict, d.label, d.labelEn)}
          </button>
        ))}
      </div>
    </div>
  );
}
