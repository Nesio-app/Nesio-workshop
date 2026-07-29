'use client';

/**
 * LabCurve — 化验指标曲线 + 参考区间绿带(健康镜头,2026-07-29)。
 *
 * 这条曲线是整个健康镜头的卖点:光看「空腹血糖 6.8」没意义,看「这三年在参考区间里怎么走的、
 * 从吃药那天起有没有变」才有意义。所以三件事必须同屏:
 *   ① 折线本身;
 *   ② **参考区间绿带** —— 不用记正常值是多少,落在带子里就是好的;
 *   ③ 用药起始日的虚线竖线 —— 「吃药后有没有用」一眼可读。
 *
 * 纵轴范围要把参考区间**包进去**:只按数据点取 min/max 的话,全部正常的序列会让绿带跑出画外,
 * 用户看到一条上下起伏的线却没有参照,反而更焦虑。
 *
 * 颜色全走 token(夜间自动翻转);偏离参考区间用 amber 不用红 —— 日常偏高不是风险。
 */

export interface LabPoint {
  date: string;   // YYYY-MM-DD
  value: number;
  low?: number;
  high?: number;
  flag?: string;
}

export interface MedMark {
  name: string;
  startedAt: string; // YYYY-MM-DD
}

const W = 300;
const H = 96;
const PAD_L = 4;
const PAD_R = 4;

export default function LabCurve({
  points, unit, meds = [], height = H,
}: { points: LabPoint[]; unit?: string; meds?: MedMark[]; height?: number }) {
  if (points.length < 2) return null;

  // 参考区间取最后一次化验带的那组(医院可能换过区间;以最新为准)。
  const last = points[points.length - 1];
  const low = last.low;
  const high = last.high;

  const vals = points.map((p) => p.value);
  // 纵轴必须包住参考区间,否则「全都正常」的序列会把绿带挤出画外 —— 曲线还在起伏,
  // 却没有参照物,看着像出了问题。
  const lo = Math.min(...vals, low ?? Infinity);
  const hi = Math.max(...vals, high ?? -Infinity);
  const span = hi - lo || Math.abs(hi) || 1;
  const pad = span * 0.12;
  const yMin = lo - pad;
  const yMax = hi + pad;

  const days = points.map((p) => Date.parse(p.date));
  const t0 = days[0];
  const t1 = days[days.length - 1];
  const tSpan = t1 - t0 || 1;

  const x = (ms: number) => PAD_L + ((ms - t0) / tSpan) * (W - PAD_L - PAD_R);
  const y = (v: number) => height - ((v - yMin) / (yMax - yMin)) * height;

  const line = points.map((p, i) => `${x(days[i]).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');

  // 绿带:只有真的有区间才画。没有区间就别画一条假的参照线。
  const bandTop = high != null ? y(high) : null;
  const bandBottom = low != null ? y(low) : null;
  const bandY = bandTop != null ? bandTop : (bandBottom != null ? 0 : null);
  const bandH = bandTop != null && bandBottom != null
    ? Math.max(1, bandBottom - bandTop)
    : (bandBottom != null ? bandBottom : (bandTop != null ? height - bandTop : 0));

  // 用药竖线:只画落在这段时间窗里的(窗外的线贴在边上没意义)。
  const marks = meds
    .map((m) => ({ ...m, ms: Date.parse(m.startedAt) }))
    .filter((m) => Number.isFinite(m.ms) && m.ms >= t0 && m.ms <= t1);

  const dotColor = (p: LabPoint) =>
    p.flag === 'high' || p.flag === 'low' ? 'var(--status-gentle)' : 'var(--portal-blue-deep)';

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img"
      aria-label={`${points.length} 次记录,最新 ${last.value}${unit ? ` ${unit}` : ''}`}>
      {/* ② 参考区间绿带。
          用 --status-go + fillOpacity,**不用** --status-go-soft:后者夜间是
          #7fb39f2e(18% 透明度),铺在暖色深底上读起来是一条灰印子 —— 而绿带的
          全部意义就是「一眼看出正常范围在哪」,看不见等于没画。实测过。
          再给上下界各画一条实线:边界本身就是信息(「过了这条线就是偏高」)。 */}
      {bandY != null && bandH > 0 && (
        <>
          <rect x="0" y={bandY} width={W} height={bandH} fill="var(--status-go)" fillOpacity="0.16" />
          {bandTop != null && (
            <line x1="0" x2={W} y1={bandTop} y2={bandTop} stroke="var(--status-go)" strokeOpacity="0.5"
              strokeWidth="1" vectorEffect="non-scaling-stroke" />
          )}
          {bandBottom != null && (
            <line x1="0" x2={W} y1={bandBottom} y2={bandBottom} stroke="var(--status-go)" strokeOpacity="0.5"
              strokeWidth="1" vectorEffect="non-scaling-stroke" />
          )}
        </>
      )}
      {/* ③ 用药起始日虚线 */}
      {marks.map((m, i) => (
        <line key={i} x1={x(m.ms)} x2={x(m.ms)} y1="0" y2={height}
          stroke="var(--portal-accent)" strokeWidth="1.2" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      ))}
      {/* ① 折线 */}
      <polyline points={line} fill="none" stroke="var(--portal-blue-deep)" strokeWidth="1.8"
        strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => (
        <circle key={i} cx={x(days[i])} cy={y(p.value)} r={i === points.length - 1 ? 3 : 1.8} fill={dotColor(p)} />
      ))}
    </svg>
  );
}
