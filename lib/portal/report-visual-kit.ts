/**
 * 报告可视化底座(财务㉘抽出,健康月报复用)——彩色图文报告的公共零件:
 * 设计 token 的 day 值镜像、转义、SVG 柱形/环形图、占比条、整页外壳。
 * 输出自包含 HTML(内联 SVG/CSS、无外部资源);打印保色(print-color-adjust)。
 * 调色板经 CVD 校验(相邻对 ΔE≥12);「其他」恒中性灰;文字不穿数据色。
 */

/* 设计 token 的 day 值镜像(独立文档拿不到 app 的 CSS 变量;与 design-system/nesio 同源) */
export const INK = '#1e2a3a';
export const MUTED = '#5a6d82';
export const LINE = '#dfe6ef';
export const BG_SOFT = '#f4f8fd';
export const ACCENT = '#588ce3';
export const GO = '#5a9e7a';
export const GO_SOFT = '#d9ece1';
export const GENTLE = '#c9923f';
export const GENTLE_SOFT = '#f3e4cc';
export const RISK = '#cf6b6b';
export const RISK_SOFT = '#f5d9d9';
/* 分类调色板:蓝/橙/绿/紫/玫红/金/青(校验通过的固定顺序,不轮换);灰=「其他」 */
export const CAT_COLORS = ['#588ce3', '#e0954a', '#3d9f6e', '#7c6ee6', '#c25d7a', '#c98a2d', '#17a28b'];
export const OTHER_GRAY = '#9aa7b8';

export const esc = (x: string) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const r1 = (v: number) => Math.round(v * 10) / 10;

/** 顶部圆角(4px)、底边平直的柱形 path(规范:data-end 圆角、基线方角)。 */
export function roundedBar(x: number, y: number, w: number, h: number, color: string): string {
  if (h <= 0.5) return '';
  const r = Math.min(4, w / 2, h);
  return `<path d="M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z" fill="${color}"/>`;
}

/** 环形图(SVG stroke 法,切片间 2px 表面留缝)。 */
export function donutSvg(slices: Array<{ label: string; value: number; color: string }>, centerTop: string, centerVal: string): string {
  const R = 54;
  const C = 2 * Math.PI * R;
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return '';
  const GAP = 2;
  let acc = 0;
  const segs: string[] = [];
  for (const s of slices) {
    const len = (s.value / total) * C;
    const draw = Math.max(0, len - (slices.length > 1 ? GAP : 0));
    segs.push(`<circle r="${R}" fill="none" stroke="${s.color}" stroke-width="17" stroke-dasharray="${r1(draw)} ${r1(C - draw)}" stroke-dashoffset="${r1(-acc)}"/>`);
    acc += len;
  }
  return `<svg viewBox="0 0 150 150" width="150" height="150" role="img" aria-label="${esc(centerTop)}">
<g transform="translate(75,75) rotate(-90)">${segs.join('')}</g>
<text x="75" y="70" text-anchor="middle" font-size="9.5" fill="${MUTED}">${esc(centerTop)}</text>
<text x="75" y="88" text-anchor="middle" font-size="15" font-weight="700" fill="${INK}">${esc(centerVal)}</text>
</svg>`;
}

/** 干净刻度:1/2/2.5/5 × 10^k 向上取。 */
export function niceCeil(rawMax: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1, rawMax))));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((m) => m >= rawMax) ?? rawMax;
}

/** 单系列柱形图(健康:每日睡眠/步数等;hairline 网格 + 干净刻度 + 可选参考线)。 */
export function singleBarSvg(
  rows: Array<{ label: string; v: number }>,
  color: string,
  opts?: { refLine?: { v: number; label: string }; yFmt?: (v: number) => string; maxXLabels?: number },
): string {
  if (rows.length < 2) return '';
  const W = 640; const H = 170;
  const padL = 44; const padR = 8; const padT = 12; const padB = 22;
  const plotW = W - padL - padR; const plotH = H - padT - padB;
  const rawMax = Math.max(1, ...rows.map((r) => r.v), opts?.refLine?.v ?? 0);
  const niceMax = niceCeil(rawMax);
  const y = (v: number) => padT + plotH * (1 - v / niceMax);
  const fmt = opts?.yFmt ?? ((v: number) => String(Math.round(v)));
  const parts: string[] = [];
  for (const frac of [0, 0.5, 1]) {
    const gy = r1(y(niceMax * frac));
    parts.push(`<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" stroke="${LINE}" stroke-width="1"/>`);
    parts.push(`<text x="${padL - 6}" y="${gy + 3.5}" text-anchor="end" font-size="9" fill="${MUTED}">${esc(fmt(niceMax * frac))}</text>`);
  }
  if (opts?.refLine) {
    const gy = r1(y(opts.refLine.v));
    parts.push(`<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" stroke="${GO}" stroke-width="1" stroke-dasharray="4 3"/>`);
    // 白描边晕圈:参考线标签压在柱子上时仍可读(paint-order 先描边后填充)
    parts.push(`<text x="${W - padR}" y="${gy - 3}" text-anchor="end" font-size="9" fill="${GO}" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(opts.refLine.label)}</text>`);
  }
  const band = plotW / rows.length;
  const bw = Math.min(18, Math.max(2, band * 0.6));
  const every = Math.max(1, Math.ceil(rows.length / (opts?.maxXLabels ?? 10)));
  rows.forEach((row, i) => {
    const cx = padL + band * i + band / 2;
    parts.push(roundedBar(r1(cx - bw / 2), r1(y(row.v)), r1(bw), r1(plotH - (y(row.v) - padT)), color));
    if (i % every === 0) parts.push(`<text x="${r1(cx)}" y="${H - 8}" text-anchor="middle" font-size="8.5" fill="${MUTED}">${esc(row.label)}</text>`);
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img">${parts.join('')}</svg>`;
}

/** 水平占比条(进度/结构占比共用;fill 数组按序渲染,2px 留缝)。 */
export function hbar(fills: Array<{ pct: number; color: string }>, track = BG_SOFT): string {
  const segs = fills
    .filter((f) => f.pct > 0)
    .map((f) => `<i style="width:${Math.min(100, r1(f.pct))}%;background:${f.color}"></i>`)
    .join('');
  return `<span class="hbar" style="background:${track}">${segs}</span>`;
}

/** 整页外壳:标题 + 落款 + 分节 HTML → 自包含文档(打印保色)。 */
export function docShell(title: string, subtitle: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
/* 打印默认剥掉背景色 → KPI 卡/进度条/色点全变黑白;exact 强制按屏幕配色出 PDF */
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font:14px/1.6 -apple-system,"Noto Sans SC",sans-serif;color:${INK};max-width:760px;margin:0 auto;padding:28px;background:#fff}
h1{font-size:22px;margin:0}
.sub{color:${MUTED};font-size:11.5px;margin:2px 0 18px}
h2{font-size:14px;margin:0 0 10px;color:${INK};letter-spacing:.02em}
h2::before{content:"";display:inline-block;width:4px;height:13px;border-radius:2px;background:${ACCENT};margin-right:7px;vertical-align:-2px}
section{margin:0 0 22px;break-inside:avoid}
.kpis{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}
.kpi{flex:1;min-width:130px;background:${BG_SOFT};border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:2px}
.kl{font-size:11px;color:${MUTED}}
.kv{font-size:22px;font-weight:700}.kv.sm{font-size:17px}
.delta{font-size:11px;font-weight:600}
.hbar{display:flex;gap:2px;height:12px;border-radius:6px;overflow:hidden;margin:6px 0}
.hbar i{display:block;height:100%;border-radius:2px}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:${MUTED};margin:6px 0}
.lg i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px;vertical-align:-.5px}
.donutrow{display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.donutrow table{flex:1;min-width:280px}
table.clean{border-collapse:collapse;width:100%;font-size:12.5px}
table.clean td{padding:5px 8px;border-bottom:1px solid ${LINE};vertical-align:middle}
table.clean tr:last-child td{border-bottom:none}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.mname{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:7px;vertical-align:-1px}
.muted{color:${MUTED}}.small{font-size:11.5px;margin:4px 0 0}
.lede{color:${MUTED};font-size:12.5px;margin:0 0 8px}
ul.dots{list-style:none;padding:0;margin:0;font-size:12.5px}
ul.dots li{margin:6px 0;padding-left:16px;position:relative}
.dot{position:absolute;left:0;top:5px;width:8px;height:8px;border-radius:50%}
.score{margin:10px 0}
.scoretop{display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:2px}
ul.fine{color:${MUTED};font-size:11px;padding-left:16px;margin:0}
ul.fine li{margin:3px 0}
@media print{body{padding:0}section{break-inside:avoid}}
</style></head><body>
<h1>${esc(title)}</h1>
<p class="sub">${subtitle}</p>
${body}
</body></html>`;
}
