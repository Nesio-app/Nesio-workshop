/**
 * Apple Health export parser — runs IN THE BROWSER on a text chunk of export.xml.
 * 批次 38:导出的 export.xml 常几百 MB,整个上传服务器会超限。改为客户端只解析文件
 * 尾部(最近数据在末尾,追加写入),正则提炼步数/睡眠/心率/锻炼/体重,建少量记忆节点。
 * 纯函数,可单测。返回 Omit<LifeNode,'id'|'createdAt'|'source'> 形状的节点。
 */

export interface HealthNode {
  type: 'health_state' | 'event';
  name: string;
  attributes: Record<string, string | number>;
  relations: never[];
  tags: string[];
  confidence: number;
  rawInput: string;
}

export interface HealthParseResult {
  nodes: HealthNode[];
  summary: string;
}

/** Apple 日期 "2024-01-01 08:00:00 -0800" → epoch ms(容错)。 */
function parseAppleDate(s: string): number {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\s*([+-]\d{2})(\d{2})?/);
  if (m) {
    const [, Y, Mo, D, H, Mi, S, tzH, tzM = '00'] = m;
    const t = Date.parse(`${Y}-${Mo}-${D}T${H}:${Mi}:${S}${tzH}:${tzM}`);
    if (!Number.isNaN(t)) return t;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

interface Rec { startDate: string; endDate: string; value: string }

/** 抽取某个 HK type 的所有 <Record ...>(自闭合或带子元素的开标签都能匹配到开头)。 */
function records(xml: string, hkType: string): Rec[] {
  const re = new RegExp(`<Record\\b[^>]*type="${hkType}"[^>]*>`, 'g');
  const out: Rec[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const tag = m[0];
    out.push({
      startDate: tag.match(/startDate="([^"]+)"/)?.[1] || '',
      endDate: tag.match(/endDate="([^"]+)"/)?.[1] || '',
      value: tag.match(/value="([^"]+)"/)?.[1] || '',
    });
  }
  return out;
}

const WORKOUT_LABEL: Record<string, string> = {
  Running: '跑步', Walking: '步行', Cycling: '骑行', Hiking: '徒步', Swimming: '游泳',
  TraditionalStrengthTraining: '力量训练', FunctionalStrengthTraining: '功能性训练',
  Yoga: '瑜伽', HighIntensityIntervalTraining: 'HIIT', Elliptical: '椭圆机', CoreTraining: '核心训练',
};

/** 解析 export.xml 的一段文本(通常是尾部),返回健康记忆节点。 */
export function parseAppleHealthText(xml: string): HealthParseResult {
  const summaryLines: string[] = [];
  const attrs: Record<string, string | number> = { source: 'Apple Health', importedAt: new Date().toISOString() };

  // ── 步数:按天聚合,取最近 7 天 ──
  const stepDay = new Map<string, number>();
  for (const r of records(xml, 'HKQuantityTypeIdentifierStepCount')) {
    const day = r.startDate.slice(0, 10);
    const v = Number(r.value);
    if (day && Number.isFinite(v)) stepDay.set(day, (stepDay.get(day) || 0) + v);
  }
  const stepDays = [...stepDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-7);
  if (stepDays.length) {
    const avg = Math.round(stepDays.reduce((s, [, v]) => s + v, 0) / stepDays.length);
    attrs.stepsAvg7d = avg;
    attrs.stepsLatest = Math.round(stepDays[stepDays.length - 1][1]);
    summaryLines.push(`近 ${stepDays.length} 天日均 ${avg.toLocaleString()} 步(最近一天 ${attrs.stepsLatest.toLocaleString()} 步)`);
  }

  // ── 心率:最近样本的均值/区间 ──
  const hr = records(xml, 'HKQuantityTypeIdentifierHeartRate').map((r) => Number(r.value)).filter((v) => Number.isFinite(v) && v > 0);
  const hrRecent = hr.slice(-100);
  if (hrRecent.length) {
    const avg = Math.round(hrRecent.reduce((s, v) => s + v, 0) / hrRecent.length);
    attrs.heartRateAvg = avg;
    attrs.heartRateMin = Math.round(Math.min(...hrRecent));
    attrs.heartRateMax = Math.round(Math.max(...hrRecent));
    summaryLines.push(`心率均值 ${avg} bpm(${attrs.heartRateMin}–${attrs.heartRateMax})`);
  }

  // ── 睡眠:统计最近一晚的入睡时长 ──
  const sleep = records(xml, 'HKCategoryTypeIdentifierSleepAnalysis').filter((r) => /Asleep|InBed/i.test(r.value));
  if (sleep.length) {
    const lastDay = sleep.map((r) => r.startDate.slice(0, 10)).sort().pop() || '';
    const lastNight = sleep.filter((r) => r.startDate.slice(0, 10) === lastDay && /Asleep/i.test(r.value));
    const ms = lastNight.reduce((s, r) => s + Math.max(0, parseAppleDate(r.endDate) - parseAppleDate(r.startDate)), 0);
    attrs.sleepRecords = sleep.length;
    if (ms > 0) {
      const hours = (ms / 3_600_000).toFixed(1);
      attrs.sleepLastNightHours = hours;
      summaryLines.push(`最近一晚睡眠约 ${hours} 小时`);
    }
  }

  // ── 体重:最近一条 ──
  const weight = records(xml, 'HKQuantityTypeIdentifierBodyMass').map((r) => Number(r.value)).filter((v) => Number.isFinite(v) && v > 0);
  if (weight.length) {
    attrs.weightLatest = weight[weight.length - 1];
    summaryLines.push(`体重 ${attrs.weightLatest} kg`);
  }

  // ── 锻炼:最近的当作事件节点(进时间线)──
  const workoutRe = /<Workout\b[^>]*>/g;
  const workoutNodes: HealthNode[] = [];
  let wm: RegExpExecArray | null;
  const workouts: Array<{ type: string; label: string; duration: string; start: string }> = [];
  while ((wm = workoutRe.exec(xml))) {
    const tag = wm[0];
    const rawType = (tag.match(/workoutActivityType="HKWorkoutActivityType([^"]+)"/)?.[1]) || 'Workout';
    workouts.push({
      type: rawType,
      label: WORKOUT_LABEL[rawType] || rawType,
      duration: tag.match(/duration="([^"]+)"/)?.[1] || '',
      start: tag.match(/startDate="([^"]+)"/)?.[1] || '',
    });
  }
  const recentWorkouts = workouts.slice(-10);
  if (recentWorkouts.length) {
    attrs.workoutCount = workouts.length;
    summaryLines.push(`锻炼 ${workouts.length} 次(最近 ${recentWorkouts[recentWorkouts.length - 1].label})`);
    for (const w of recentWorkouts) {
      const startMs = parseAppleDate(w.start);
      const durMin = w.duration ? Math.round(Number(w.duration)) : 0;
      workoutNodes.push({
        type: 'event',
        name: `${w.label}${durMin ? ` ${durMin} 分钟` : ''}`,
        attributes: {
          source: 'Apple Health',
          ...(startMs ? { start: new Date(startMs).toISOString() } : {}),
          ...(durMin ? { durationMin: durMin } : {}),
          activity: w.label,
        },
        relations: [],
        tags: ['健康', 'Apple Health', '锻炼', w.label],
        confidence: 0.85,
        rawInput: `${w.label}${durMin ? `,时长 ${durMin} 分钟` : ''}${w.start ? `,${w.start.slice(0, 10)}` : ''}`,
      });
    }
  }

  const summary = summaryLines.join(' · ') || '未识别到可用的健康记录';
  const nodes: HealthNode[] = [];
  if (summaryLines.length) {
    nodes.push({
      type: 'health_state',
      name: 'Apple Health · 健康概况',
      attributes: attrs,
      relations: [],
      tags: ['健康', 'Apple Health'],
      confidence: 0.85,
      rawInput: summary,
    });
  }
  nodes.push(...workoutNodes);
  return { nodes, summary };
}

/* ---------- 批次 39:健康 Dashboard —— 全指标提炼 ---------- */

export interface HealthMetric {
  key: string;
  label: [string, string]; // [zh, en]
  latest: number;
  latestDate: string;      // YYYY-MM-DD
  prev: number | null;     // 上一次(算 delta)
  unit: string;
  decimals: number;
  group: 'activity' | 'heart' | 'body' | 'vitals' | 'mind';
  series: Array<{ ym: string; v: number }>; // 批次 40:按月历史序列(画多年趋势曲线)
}

export interface HealthMetrics {
  metrics: HealthMetric[];
  workouts: number;
  importedAt: string;
}

type Agg = 'sumDay' | 'latest' | 'sleep' | 'mindful';
interface MetricDef {
  key: string; hk: string; label: [string, string]; unit: string; decimals: number; agg: Agg;
  group: HealthMetric['group'];
}

// 覆盖常见 HealthKit 类型;缺的会自动跳过(不同人开的权限不一样)。
const METRIC_DEFS: MetricDef[] = [
  { key: 'steps', hk: 'HKQuantityTypeIdentifierStepCount', label: ['步数', 'Steps'], unit: '步', decimals: 0, agg: 'sumDay', group: 'activity' },
  { key: 'distance', hk: 'HKQuantityTypeIdentifierDistanceWalkingRunning', label: ['步行+跑步距离', 'Walk+Run distance'], unit: 'km', decimals: 2, agg: 'sumDay', group: 'activity' },
  { key: 'activeEnergy', hk: 'HKQuantityTypeIdentifierActiveEnergyBurned', label: ['活动能量', 'Active energy'], unit: 'kcal', decimals: 0, agg: 'sumDay', group: 'activity' },
  { key: 'exerciseTime', hk: 'HKQuantityTypeIdentifierAppleExerciseTime', label: ['锻炼时长', 'Exercise time'], unit: 'min', decimals: 0, agg: 'sumDay', group: 'activity' },
  { key: 'flights', hk: 'HKQuantityTypeIdentifierFlightsClimbed', label: ['爬楼', 'Flights climbed'], unit: '层', decimals: 0, agg: 'sumDay', group: 'activity' },
  { key: 'restingHR', hk: 'HKQuantityTypeIdentifierRestingHeartRate', label: ['静息心率', 'Resting HR'], unit: 'bpm', decimals: 0, agg: 'latest', group: 'heart' },
  { key: 'heartRate', hk: 'HKQuantityTypeIdentifierHeartRate', label: ['心率', 'Heart rate'], unit: 'bpm', decimals: 0, agg: 'latest', group: 'heart' },
  { key: 'hrv', hk: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN', label: ['心率变异 HRV', 'HRV'], unit: 'ms', decimals: 0, agg: 'latest', group: 'heart' },
  { key: 'vo2max', hk: 'HKQuantityTypeIdentifierVO2Max', label: ['最大摄氧量', 'VO₂ max'], unit: 'mL/kg·min', decimals: 1, agg: 'latest', group: 'heart' },
  { key: 'walkingHR', hk: 'HKQuantityTypeIdentifierWalkingHeartRateAverage', label: ['步行平均心率', 'Walking avg HR'], unit: 'bpm', decimals: 0, agg: 'latest', group: 'heart' },
  { key: 'spo2', hk: 'HKQuantityTypeIdentifierOxygenSaturation', label: ['血氧饱和度', 'Blood oxygen'], unit: '%', decimals: 0, agg: 'latest', group: 'vitals' },
  { key: 'respiratory', hk: 'HKQuantityTypeIdentifierRespiratoryRate', label: ['呼吸频率', 'Respiratory rate'], unit: '次/分', decimals: 0, agg: 'latest', group: 'vitals' },
  { key: 'bpSys', hk: 'HKQuantityTypeIdentifierBloodPressureSystolic', label: ['收缩压', 'Systolic BP'], unit: 'mmHg', decimals: 0, agg: 'latest', group: 'vitals' },
  { key: 'bpDia', hk: 'HKQuantityTypeIdentifierBloodPressureDiastolic', label: ['舒张压', 'Diastolic BP'], unit: 'mmHg', decimals: 0, agg: 'latest', group: 'vitals' },
  { key: 'glucose', hk: 'HKQuantityTypeIdentifierBloodGlucose', label: ['血糖', 'Blood glucose'], unit: 'mg/dL', decimals: 0, agg: 'latest', group: 'vitals' },
  { key: 'bodyTemp', hk: 'HKQuantityTypeIdentifierBodyTemperature', label: ['体温', 'Body temp'], unit: '°C', decimals: 1, agg: 'latest', group: 'vitals' },
  { key: 'weight', hk: 'HKQuantityTypeIdentifierBodyMass', label: ['体重', 'Weight'], unit: 'kg', decimals: 1, agg: 'latest', group: 'body' },
  { key: 'bodyFat', hk: 'HKQuantityTypeIdentifierBodyFatPercentage', label: ['体脂率', 'Body fat'], unit: '%', decimals: 1, agg: 'latest', group: 'body' },
  { key: 'bmi', hk: 'HKQuantityTypeIdentifierBodyMassIndex', label: ['BMI', 'BMI'], unit: '', decimals: 1, agg: 'latest', group: 'body' },
  { key: 'leanMass', hk: 'HKQuantityTypeIdentifierLeanBodyMass', label: ['瘦体重', 'Lean mass'], unit: 'kg', decimals: 1, agg: 'latest', group: 'body' },
  { key: 'height', hk: 'HKQuantityTypeIdentifierHeight', label: ['身高', 'Height'], unit: 'cm', decimals: 0, agg: 'latest', group: 'body' },
  { key: 'sleep', hk: 'HKCategoryTypeIdentifierSleepAnalysis', label: ['睡眠', 'Sleep'], unit: 'h', decimals: 1, agg: 'sleep', group: 'mind' },
  { key: 'mindful', hk: 'HKCategoryTypeIdentifierMindfulSession', label: ['正念', 'Mindfulness'], unit: 'min', decimals: 0, agg: 'mindful', group: 'mind' },
];

// unit 换算:米→千米,秒→分钟(部分类型 Apple 用基础单位)
function scaleValue(key: string, raw: number): number {
  if (key === 'distance') return raw / 1000; // Apple 距离常以 m 记(也可能已是 km)
  return raw;
}

// 批次 39:增量聚合器 —— 支持把超大 export.xml 分块喂进来。
// 关键:Apple 导出常「按类型分块」(先全部步数、再全部心率…),所以只看尾部会漏掉大多数
// 指标(用户遇到「只出 1 项 HRV」)。必须扫全文件,才能拿到所有类型。
// 从「按天」的 Map 汇成「按月平均」的历史序列(画多年曲线),末尾截近 60 个月。
function monthlySeriesAvg(daily: Map<string, number>, transform: (v: number) => number = (v) => v, dec = 1): Array<{ ym: string; v: number }> {
  const byMonth = new Map<string, { sum: number; count: number }>();
  for (const [day, val] of daily) {
    const ym = day.slice(0, 7);
    const b = byMonth.get(ym) || { sum: 0, count: 0 };
    b.sum += transform(val); b.count += 1;
    byMonth.set(ym, b);
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-60)
    .map(([ym, b]) => ({ ym, v: Math.round((b.sum / b.count) * 10 ** dec) / 10 ** dec }));
}

class HealthAggregator {
  private sumDay = new Map<string, Map<string, number>>();
  private latest = new Map<string, { d: string; v: number; pd: string; pv: number }>();
  private monthlyLatest = new Map<string, Map<string, { sum: number; count: number }>>(); // latest 类指标的按月均值
  private sleepMs = new Map<string, number>();
  private mindMin = new Map<string, number>();
  workouts = 0;

  private pushLatest(key: string, d: string, v: number) {
    const cur = this.latest.get(key);
    if (!cur) { this.latest.set(key, { d, v, pd: '', pv: NaN }); return; }
    if (d >= cur.d) { cur.pd = cur.d; cur.pv = cur.v; cur.d = d; cur.v = v; }
    else if (d > cur.pd) { cur.pd = d; cur.pv = v; }
  }

  feed(text: string) {
    for (const def of METRIC_DEFS) {
      if (def.agg === 'sumDay') {
        let m = this.sumDay.get(def.key);
        for (const r of records(text, def.hk)) {
          const day = r.startDate.slice(0, 10);
          const v = Number(r.value);
          if (!day || !Number.isFinite(v)) continue;
          if (!m) { m = new Map(); this.sumDay.set(def.key, m); }
          m.set(day, (m.get(day) || 0) + scaleValue(def.key, v));
        }
      } else if (def.agg === 'latest') {
        let mm = this.monthlyLatest.get(def.key);
        for (const r of records(text, def.hk)) {
          const v = Number(r.value);
          if (!r.startDate || !Number.isFinite(v)) continue;
          const sv = scaleValue(def.key, v);
          this.pushLatest(def.key, r.startDate.slice(0, 10), sv);
          if (!mm) { mm = new Map(); this.monthlyLatest.set(def.key, mm); }
          const ym = r.startDate.slice(0, 7);
          const b = mm.get(ym) || { sum: 0, count: 0 };
          b.sum += sv; b.count += 1; mm.set(ym, b);
        }
      } else if (def.agg === 'sleep') {
        for (const r of records(text, def.hk)) {
          if (!/Asleep/i.test(r.value)) continue;
          const day = r.startDate.slice(0, 10);
          const ms = Math.max(0, parseAppleDate(r.endDate) - parseAppleDate(r.startDate));
          if (day) this.sleepMs.set(day, (this.sleepMs.get(day) || 0) + ms);
        }
      } else if (def.agg === 'mindful') {
        for (const r of records(text, def.hk)) {
          const day = r.startDate.slice(0, 10);
          const min = Math.max(0, parseAppleDate(r.endDate) - parseAppleDate(r.startDate)) / 60_000;
          if (day) this.mindMin.set(day, (this.mindMin.get(day) || 0) + min);
        }
      }
    }
    this.workouts += (text.match(/<Workout\b/g) || []).length;
  }

  finalize(): HealthMetrics {
    const out: HealthMetric[] = [];
    for (const def of METRIC_DEFS) {
      if (def.agg === 'sumDay') {
        const m = this.sumDay.get(def.key);
        if (!m || !m.size) continue;
        const days = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        const last = days[days.length - 1];
        const prev = days.length > 1 ? days[days.length - 2][1] : null;
        out.push({ ...toMetric(def), latest: round(last[1], def.decimals), latestDate: last[0], prev: prev == null ? null : round(prev, def.decimals), series: monthlySeriesAvg(m, (v) => v, def.decimals) });
      } else if (def.agg === 'latest') {
        const c = this.latest.get(def.key);
        if (!c) continue;
        const mm = this.monthlyLatest.get(def.key);
        const series = mm ? [...mm.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-60).map(([ym, b]) => ({ ym, v: round(b.sum / b.count, def.decimals) })) : [];
        out.push({ ...toMetric(def), latest: round(c.v, def.decimals), latestDate: c.d, prev: Number.isNaN(c.pv) ? null : round(c.pv, def.decimals), series });
      } else if (def.agg === 'sleep') {
        if (!this.sleepMs.size) continue;
        const nights = [...this.sleepMs.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        const last = nights[nights.length - 1];
        const prev = nights.length > 1 ? nights[nights.length - 2][1] / 3_600_000 : null;
        out.push({ ...toMetric(def), latest: round(last[1] / 3_600_000, 1), latestDate: last[0], prev: prev == null ? null : round(prev, 1), series: monthlySeriesAvg(this.sleepMs, (ms) => ms / 3_600_000, 1) });
      } else if (def.agg === 'mindful') {
        if (!this.mindMin.size) continue;
        const days = [...this.mindMin.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        const last = days[days.length - 1];
        const prev = days.length > 1 ? days[days.length - 2][1] : null;
        out.push({ ...toMetric(def), latest: round(last[1], 0), latestDate: last[0], prev: prev == null ? null : round(prev, 0), series: monthlySeriesAvg(this.mindMin, (v) => v, 0) });
      }
    }
    return { metrics: out, workouts: this.workouts, importedAt: new Date().toISOString() };
  }
}

/** 单串解析(小文件/尾部)。 */
export function parseHealthMetrics(xml: string): HealthMetrics {
  const agg = new HealthAggregator();
  agg.feed(xml);
  return agg.finalize();
}

/** 批次 39:全文件流式解析 —— 解压后的字节分块喂,扫全部记录,不漏任何指标类型。 */
export function parseHealthMetricsFromBytes(bytes: Uint8Array): HealthMetrics {
  const agg = new HealthAggregator();
  const dec = new TextDecoder('utf-8');
  const CHUNK = 8_000_000;
  let buf = '';
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(bytes.length, start + CHUNK);
    buf += dec.decode(bytes.subarray(start, end), { stream: end < bytes.length });
    // 只处理到最后一个完整标签('>'),不完整的尾巴留到下一块,避免切断记录
    const cut = buf.lastIndexOf('>');
    if (cut < 0) continue;
    agg.feed(buf.slice(0, cut + 1));
    buf = buf.slice(cut + 1);
  }
  if (buf) agg.feed(buf);
  return agg.finalize();
}

function toMetric(def: MetricDef): Omit<HealthMetric, 'latest' | 'latestDate' | 'prev' | 'series'> {
  return { key: def.key, label: def.label, unit: def.unit, decimals: def.decimals, group: def.group };
}
function round(v: number, d: number): number {
  const p = Math.pow(10, d);
  return Math.round(v * p) / p;
}
