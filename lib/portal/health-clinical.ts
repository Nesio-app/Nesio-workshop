/**
 * 健康「知识包」—— 指南接地的确定性判定(批次 49 / 医疗级路线 ①②层)。
 *
 * 定位:不重复 health-narrative(趋势句)/ fitness-integrator(体能趋势)/
 * health-correlations(跨域相关)。这里是**临床目标判定 + 模式识别**:
 *   ① 目标判定:把指标对照已发表共识的阈值(TIR≥70% / TBR<4% / CV<36% / 深睡 13–23% …)。
 *   ② 模式识别:专科医生一眼看出来的模式(黎明现象、静息心率/HRV 偏离你的基线)。
 * 全部确定性、可单测、带出处、不下诊断;红旗(如低血糖偏多)提示"与医生确认"。
 *
 * 结构上示范「引擎/知识分离」:RULES 是声明式知识,运行时已抽到 domain-rules.evaluateRules
 * (第二个板块 place-insight 到位后兑现"有第二个板块再抽"的注)。换板块只写一份 RULES。
 */
import type { GlucoseAnalysis, SleepStages, HealthMetric } from './apple-health';
import { evaluateRules } from './domain-rules';

export type Severity = 'info' | 'attention' | 'flag'; // info=正常/达标, attention=可关注, flag=建议就医

export interface ClinicalFinding {
  id: string;
  severity: Severity;
  title: [string, string];   // [zh, en]
  detail: [string, string];
  source: string;            // 出处(指南/共识)
}

export interface HealthFindingsInput {
  glucose?: GlucoseAnalysis;
  sleepStages?: SleepStages;
  metrics: HealthMetric[];
}

interface Rule {
  id: string;
  source: string;
  run: (i: HealthFindingsInput) => Omit<ClinicalFinding, 'id' | 'source'> | null;
}

/** latest 类指标的「你的基线」= 历史月度序列(除最近点)的中位数。 */
function baseline(m?: HealthMetric): number | null {
  if (!m || !m.series || m.series.length < 4) return null;
  const vals = m.series.slice(0, -1).map((s) => s.v).sort((a, b) => a - b);
  if (vals.length < 3) return null;
  return vals[Math.floor(vals.length / 2)];
}

// ── 知识层:声明式规则(每条一个临床判定,带出处)──────────────────────────────
const RULES: Rule[] = [
  // ① 血糖达标率 TIR(目标 ≥70%)
  {
    id: 'glucose-tir', source: '国际共识 Time in Range(ADA/EASD)',
    run: (i) => {
      const g = i.glucose; if (!g) return null;
      if (g.tirPct >= 70) return { severity: 'info', title: ['血糖达标率良好', 'Time in range on target'], detail: [`达标 ${g.tirPct}%(共识目标 ≥70%)`, `${g.tirPct}% in range (target ≥70%)`] };
      return { severity: 'attention', title: ['血糖达标率偏低', 'Time in range below target'], detail: [`达标 ${g.tirPct}%,低于共识目标 70%`, `${g.tirPct}% in range, below the 70% target`] };
    },
  },
  // ① 低血糖时间 TBR(目标 <4%;>4% 是红旗)
  {
    id: 'glucose-tbr', source: '国际共识 Time Below Range(目标 <4%)',
    run: (i) => {
      const g = i.glucose; if (!g) return null;
      if (g.belowPct > 4) return { severity: 'flag', title: ['低血糖时间偏多', 'Low-glucose time is high'], detail: [`偏低 ${g.belowPct}%,超过共识上限 4% —— 建议与医生确认`, `${g.belowPct}% below range, above the 4% limit — check with a clinician`] };
      if (g.belowPct >= 1) return { severity: 'attention', title: ['偶有低血糖', 'Some low-glucose time'], detail: [`偏低 ${g.belowPct}%(共识建议 <4%)`, `${g.belowPct}% below range (target <4%)`] };
      return null;
    },
  },
  // ① 血糖波动 CV(<36% 稳定)
  {
    id: 'glucose-cv', source: '国际共识 Glycemic Variability(CV <36%)',
    run: (i) => {
      const g = i.glucose; if (!g) return null;
      if (g.cv < 36) return { severity: 'info', title: ['血糖稳定', 'Stable glucose'], detail: [`波动 CV ${g.cv}%(共识 <36% 为稳定)`, `CV ${g.cv}% (stable is <36%)`] };
      return { severity: 'attention', title: ['血糖波动偏大', 'Glucose variability elevated'], detail: [`波动 CV ${g.cv}%,高于共识稳定线 36%`, `CV ${g.cv}%, above the 36% stability line`] };
    },
  },
  // ② 黎明现象:清晨(4–8点)均值明显高于夜间谷值
  {
    id: 'glucose-dawn', source: '临床常见模式(黎明现象)',
    run: (i) => {
      const g = i.glucose; if (!g || g.hourly.length < 12) return null;
      const at = (lo: number, hi: number) => g.hourly.filter((h) => h.hour >= lo && h.hour < hi).map((h) => h.avg);
      const night = at(0, 4), morning = at(4, 8);
      if (!night.length || !morning.length) return null;
      const nadir = Math.min(...night);
      const mAvg = morning.reduce((s, v) => s + v, 0) / morning.length;
      const rise = mAvg - nadir;
      const thr = g.unit === 'mmol/L' ? 1.5 : 27; // ~1.5 mmol/L ≈ 27 mg/dL
      if (rise >= thr) return { severity: 'attention', title: ['疑似黎明现象', 'Possible dawn phenomenon'], detail: [`清晨血糖较夜间谷值升约 ${Math.round(rise * 10) / 10}${g.unit}`, `Morning glucose rises ~${Math.round(rise * 10) / 10}${g.unit} above the night low`] };
      return null;
    },
  },
  // ② 深睡比例(AASM 参考成人 13–23%)
  {
    id: 'sleep-deep', source: 'AASM 睡眠分期参考(深睡约 13–23%)',
    run: (i) => {
      const s = i.sleepStages; if (!s || s.total <= 0) return null;
      const pct = Math.round((s.deep / s.total) * 100);
      if (pct < 13) return { severity: 'attention', title: ['深睡比例偏低', 'Deep sleep is low'], detail: [`深睡占 ${pct}%(参考 13–23%)`, `Deep sleep ${pct}% (reference 13–23%)`] };
      return { severity: 'info', title: ['深睡比例正常', 'Deep sleep normal'], detail: [`深睡占 ${pct}%(参考 13–23%)`, `Deep sleep ${pct}% (reference 13–23%)`] };
    },
  },
  // ② 静息心率高于你的基线(疲劳/生病/压力的早期信号)
  {
    id: 'rhr-vs-baseline', source: '个人基线偏离(静息心率)',
    run: (i) => {
      const m = i.metrics.find((x) => x.key === 'restingHR'); const base = baseline(m);
      if (!m || base == null) return null;
      if (m.latest >= base + 7) return { severity: 'attention', title: ['静息心率高于你的基线', 'Resting HR above your baseline'], detail: [`最新 ${m.latest} bpm,你的基线约 ${base} bpm —— 可能疲劳/生病/压力`, `Latest ${m.latest} bpm vs your ~${base} bpm baseline`] };
      return null;
    },
  },
  // ② HRV 低于你的基线
  {
    id: 'hrv-vs-baseline', source: '个人基线偏离(心率变异 HRV)',
    run: (i) => {
      const m = i.metrics.find((x) => x.key === 'hrv'); const base = baseline(m);
      if (!m || base == null || base <= 0) return null;
      if (m.latest <= base * 0.85) return { severity: 'attention', title: ['HRV 低于你的基线', 'HRV below your baseline'], detail: [`最新 ${m.latest} ms,你的基线约 ${base} ms —— 恢复可能不足`, `Latest ${m.latest} ms vs your ~${base} ms baseline`] };
      return null;
    },
  },
];

// ── 引擎层:走通用运行时 domain-rules.evaluateRules(source 是本域的静态知识,包一层带上)──
export function evaluateHealthFindings(input: HealthFindingsInput): ClinicalFinding[] {
  return evaluateRules<HealthFindingsInput, ClinicalFinding>(
    RULES.map((r) => ({
      id: r.id,
      run: (i) => { const res = r.run(i); return res ? { ...res, source: r.source } : null; },
    })),
    input,
  );
}
