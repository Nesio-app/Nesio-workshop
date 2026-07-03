/**
 * GraphEngine — 轻量弹簧布局算法（Fruchterman-Reingold 简化版）
 * 纯 TS，无 D3 依赖，供 RelationGraph 使用。
 */

export interface GNode {
  id: string;
  label: string;
  type?: string;
  weight?: number;   // 0-1, influences circle size
  color?: string;    // CSS color or var(--...)
  meta?: Record<string, unknown>;
}

export interface GEdge {
  source: string;
  target: string;
  label?: string;
  weight?: number;   // 0-1, edge thickness
}

export interface GNodePos extends GNode {
  x: number;
  y: number;
  r: number;         // computed radius
}

export interface GraphLayout {
  nodes: GNodePos[];
  edges: GEdge[];
  width: number;
  height: number;
}

interface Vec { x: number; y: number; }

function dist(a: Vec, b: Vec): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2) || 0.001;
}

/**
 * Compute a spring layout for the given nodes and edges.
 * Returns node positions scaled into [0, width] × [0, height].
 */
export function buildLayout(
  nodes: GNode[],
  edges: GEdge[],
  width: number,
  height: number,
  iterations = 60,
): GraphLayout {
  const n = nodes.length;
  if (n === 0) return { nodes: [], edges, width, height };

  // ── Initial positions: circular seed ──────────────────────────────────────
  const pos: Vec[] = nodes.map((_, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const r = Math.min(width, height) * 0.3;
    return { x: width / 2 + r * Math.cos(angle), y: height / 2 + r * Math.sin(angle) };
  });

  const idxMap = new Map(nodes.map((n, i) => [n.id, i]));

  // k = ideal spring length
  const k = Math.sqrt((width * height) / (n + 1)) * 0.85;
  let temp = Math.min(width, height) * 0.1; // initial temperature

  for (let iter = 0; iter < iterations; iter++) {
    const disp: Vec[] = Array.from({ length: n }, () => ({ x: 0, y: 0 }));

    // Repulsion between all pairs
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = dist(pos[i], pos[j]);
        const force = (k * k) / d;
        const dx = (pos[i].x - pos[j].x) / d;
        const dy = (pos[i].y - pos[j].y) / d;
        disp[i].x += dx * force;
        disp[i].y += dy * force;
        disp[j].x -= dx * force;
        disp[j].y -= dy * force;
      }
    }

    // Attraction along edges
    for (const e of edges) {
      const si = idxMap.get(e.source);
      const ti = idxMap.get(e.target);
      if (si === undefined || ti === undefined) continue;
      const d = dist(pos[si], pos[ti]);
      const force = (d * d) / k;
      const dx = (pos[ti].x - pos[si].x) / d;
      const dy = (pos[ti].y - pos[si].y) / d;
      disp[si].x += dx * force;
      disp[si].y += dy * force;
      disp[ti].x -= dx * force;
      disp[ti].y -= dy * force;
    }

    // Gravity toward center
    for (let i = 0; i < n; i++) {
      const dx = width / 2 - pos[i].x;
      const dy = height / 2 - pos[i].y;
      disp[i].x += dx * 0.03;
      disp[i].y += dy * 0.03;
    }

    // Apply displacement, capped by temperature
    for (let i = 0; i < n; i++) {
      const d = Math.sqrt(disp[i].x ** 2 + disp[i].y ** 2) || 1;
      const cap = Math.min(d, temp);
      pos[i].x += (disp[i].x / d) * cap;
      pos[i].y += (disp[i].y / d) * cap;
      // Keep within bounds
      pos[i].x = Math.max(20, Math.min(width - 20, pos[i].x));
      pos[i].y = Math.max(20, Math.min(height - 20, pos[i].y));
    }

    temp *= 0.92; // cool down
  }

  // Build output
  const posNodes: GNodePos[] = nodes.map((node, i) => ({
    ...node,
    x: pos[i].x,
    y: pos[i].y,
    r: 8 + (node.weight ?? 0.5) * 12,
  }));

  return { nodes: posNodes, edges, width, height };
}
