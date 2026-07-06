/**
 * Apple Health export parser — runs IN THE BROWSER on a text chunk of export.xml.
 * 批次 38:导出的 export.xml 常几百 MB,整个上传服务器会超限。改为客户端只解析文件
 * 尾部(最近数据在末尾,追加写入),正则提炼步数/睡眠/心率/锻炼/体重,建少量记忆节点。
 * 纯函数,可单测。返回 Omit<LifeNode,'id'|'createdAt'|'source'> 形状的节点。
 */

import { pickLatestCompleteDay } from './health-latest.mjs';

/** 本机今天的 YYYY-MM-DD(本地时区)—— 用于识别残缺的导入当日。 */
function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

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

/** 一段睡眠归属的"夜"键(按本地钟点):凌晨(<12 点)起始的段归到前一晚,
 *  否则归当天 —— 让跨午夜的一整晚(23:30 入睡 + 次日凌晨段)聚成一条,不被拆成两天。 */
function sleepNightKey(startDate: string): string {
  const day = startDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const hour = Number(startDate.slice(11, 13));
  if (Number.isFinite(hour) && hour < 12) {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  return day;
}

/** 多设备(iPhone + Apple Watch + 第三方 app)同一天各记一份步数/距离/能量;HealthKit 只在
 *  查询时去重、XML 里不去。每天取"记得最多的那个来源"而非跨来源裸加,避免总量虚高 ~1.5–2×。 */
function collapseBySource(byDaySource: Map<string, Map<string, number>>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [day, sources] of byDaySource) {
    let max = 0;
    for (const v of sources.values()) if (v > max) max = v;
    out.set(day, max);
  }
  return out;
}

interface Rec { startDate: string; endDate: string; value: string; sourceName: string; unit: string }

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
      sourceName: tag.match(/sourceName="([^"]+)"/)?.[1] || '',
      unit: tag.match(/unit="([^"]+)"/)?.[1] || '',
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

  // ── 步数:按天聚合(每天取最大来源,去多设备重复),取最近 7 天 ──
  const stepBySource = new Map<string, Map<string, number>>(); // day → source → sum
  for (const r of records(xml, 'HKQuantityTypeIdentifierStepCount')) {
    const day = r.startDate.slice(0, 10);
    const v = Number(r.value);
    if (!day || !Number.isFinite(v)) continue;
    let s = stepBySource.get(day);
    if (!s) { s = new Map(); stepBySource.set(day, s); }
    s.set(r.sourceName, (s.get(r.sourceName) || 0) + v);
  }
  const stepDay = collapseBySource(stepBySource);
  const stepDays = [...stepDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-7);
  if (stepDays.length) {
    const avg = Math.round(stepDays.reduce((s, [, v]) => s + v, 0) / stepDays.length);
    attrs.stepsAvg7d = avg;
    attrs.stepsLatest = Math.round(stepDays[stepDays.length - 1][1]);
    summaryLines.push(`近 ${stepDays.length} 天日均 ${avg.toLocaleString()} 步(最近一天 ${attrs.stepsLatest.toLocaleString()} 步)`);
  }

  // ── 心率:最近样本的均值/区间(按时间排序取最近 100 条,不假设文档顺序=时间顺序)──
  const hr = records(xml, 'HKQuantityTypeIdentifierHeartRate')
    .map((r) => ({ v: Number(r.value), t: parseAppleDate(r.startDate) }))
    .filter((x) => Number.isFinite(x.v) && x.v > 0)
    .sort((a, b) => a.t - b.t)
    .map((x) => x.v);
  const hrRecent = hr.slice(-100);
  if (hrRecent.length) {
    const avg = Math.round(hrRecent.reduce((s, v) => s + v, 0) / hrRecent.length);
    attrs.heartRateAvg = avg;
    attrs.heartRateMin = Math.round(Math.min(...hrRecent));
    attrs.heartRateMax = Math.round(Math.max(...hrRecent));
    summaryLines.push(`心率均值 ${avg} bpm(${attrs.heartRateMin}–${attrs.heartRateMax})`);
  }

  // ── 睡眠:统计最近一晚的入睡时长(按"夜"聚合,跨午夜不拆成两天)──
  const sleep = records(xml, 'HKCategoryTypeIdentifierSleepAnalysis').filter((r) => /Asleep|InBed/i.test(r.value));
  if (sleep.length) {
    // 每夜按来源分别累加,取最大来源 —— 若同时装了 Watch 和第三方睡眠 app 且时段重叠,
    // 裸加会把一晚算两遍;取最大源避免跨源重复(同源内的分期不重叠,照常求和)。
    const nightBySource = new Map<string, Map<string, number>>();
    for (const r of sleep) {
      if (!/Asleep/i.test(r.value)) continue;
      const key = sleepNightKey(r.startDate);
      if (!key) continue;
      let s = nightBySource.get(key);
      if (!s) { s = new Map(); nightBySource.set(key, s); }
      s.set(r.sourceName, (s.get(r.sourceName) || 0) + Math.max(0, parseAppleDate(r.endDate) - parseAppleDate(r.startDate)));
    }
    const nightMs = collapseBySource(nightBySource);
    attrs.sleepRecords = sleep.length;
    const lastKey = [...nightMs.keys()].sort().pop();
    const ms = lastKey ? nightMs.get(lastKey) || 0 : 0;
    if (ms > 0) {
      const hours = (ms / 3_600_000).toFixed(1);
      attrs.sleepLastNightHours = hours;
      summaryLines.push(`最近一晚睡眠约 ${hours} 小时`);
    }
  }

  // ── 体重:最近一条(按时间取,不假设文档顺序=时间顺序)──
  const weight = records(xml, 'HKQuantityTypeIdentifierBodyMass')
    .map((r) => ({ v: Number(r.value), t: parseAppleDate(r.startDate) }))
    .filter((x) => Number.isFinite(x.v) && x.v > 0)
    .sort((a, b) => a.t - b.t);
  if (weight.length) {
    attrs.weightLatest = weight[weight.length - 1].v;
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
      const startIso = startMs ? new Date(startMs).toISOString() : '';
      workoutNodes.push({
        type: 'event',
        name: `${w.label}${durMin ? ` ${durMin} 分钟` : ''}`,
        attributes: {
          source: 'Apple Health',
          ...(startMs ? { start: startIso } : {}),
          ...(durMin ? { durationMin: durMin } : {}),
          activity: w.label,
          // 稳定外部 id:同一场锻炼(起始时刻+活动)重导入时幂等,不再每周重传就多一条。
          ...(startIso ? { externalId: `health:workout:${startIso}:${w.type}` } : {}),
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
      // 固定外部 id:重导入时更新同一张概况节点,而不是每次新增一条。
      attributes: { ...attrs, externalId: 'health:summary' },
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
  prevDate?: string;       // 上一次的日期(用于提示"较 X 前",避免拿一年前读数当"较上次")
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

// latest 类指标的合理范围(规范单位),超出即当脏值丢弃,不让离谱读数直接上卡片。
const PLAUSIBLE_RANGE: Record<string, [number, number]> = {
  restingHR: [25, 250], walkingHR: [40, 250], hrv: [1, 500], vo2max: [5, 90],
  spo2: [50, 100], respiratory: [3, 60], bpSys: [50, 270], bpDia: [25, 200],
  glucose: [20, 700], bodyTemp: [30, 45], weight: [2, 500], bodyFat: [1, 70],
  bmi: [8, 90], leanMass: [2, 200], height: [30, 260],
};
function plausible(key: string, v: number): boolean {
  const r = PLAUSIBLE_RANGE[key];
  return !r || (v >= r[0] && v <= r[1]);
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
  // 瞬时心率(HKQuantityTypeIdentifierHeartRate)不作为看板指标:latest 只取单条样本,运动后
  // 一条 130bpm 会显示成"心率 130",误导。有意义的是静息心率/步行心率(下方保留)。
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

// 按 XML 里明写的 unit 把值换算到该指标的规范单位(METRIC_DEFS.unit)。
// 之前只对 distance 无条件 /1000、其余不换算 → 美制用户(lb/mi/in/°F/mmol)数字与标签系统性错配。
function convertUnit(key: string, v: number, unit: string): number {
  const u = (unit || '').toLowerCase().trim();
  switch (key) {
    case 'distance': // → km
      if (u === 'mi') return v * 1.609344;
      if (u === 'm') return v / 1000;
      return v; // km(或缺失:按已是 km,不再无条件 /1000 变近零)
    case 'weight':
    case 'leanMass': // → kg
      if (u === 'lb') return v * 0.45359237;
      if (u === 'st') return v * 6.35029;
      if (u === 'g') return v / 1000;
      return v; // kg
    case 'height': // → cm
      if (u === 'in') return v * 2.54;
      if (u === 'ft') return v * 30.48;
      if (u === 'm') return v * 100;
      return v; // cm
    case 'bodyTemp': // → °C
      if (u === 'degf' || u === '°f' || u === 'f') return (v - 32) * 5 / 9;
      return v; // degC
    case 'glucose': // → mg/dL
      if (u.includes('mmol')) return v * 18.0182;
      return v; // mg/dL
    case 'activeEnergy': // → kcal
      if (u === 'kj') return v / 4.184;
      return v; // kcal/Cal
    default:
      return v; // 计数/百分比/bpm/mmHg 等单位无关,原样
  }
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
  private sumDay = new Map<string, Map<string, Map<string, number>>>(); // key → day → source → sum
  private latest = new Map<string, { d: string; v: number; pd: string; pv: number }>();
  private monthlyLatest = new Map<string, Map<string, { sum: number; count: number }>>(); // latest 类指标的按月均值
  private sleepMs = new Map<string, Map<string, number>>(); // night → source → ms(finalize 时每夜取最大源)
  private mindMin = new Map<string, number>();
  private workoutList: Array<{ type: string; label: string; duration: string; start: string }> = [];
  workouts = 0;

  private pushLatest(key: string, d: string, v: number) {
    const cur = this.latest.get(key);
    if (!cur) { this.latest.set(key, { d, v, pd: '', pv: NaN }); return; }
    if (d > cur.d) { cur.pd = cur.d; cur.pv = cur.v; cur.d = d; cur.v = v; }        // 更新的一天 → 推进,旧的当 prev
    else if (d === cur.d) { cur.v = v; }                                            // 同一天另一样本 → 只更新当日值,不把 prev 设成同一天
    else if (d > cur.pd) { cur.pd = d; cur.pv = v; }                                // 更早但比现有 prev 新 → 当 prev(始终是不同的更早一天)
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
          // 按天+来源分别累加,finalize 时每天取最大来源,去多设备(iPhone+Watch)重复。
          let s = m.get(day);
          if (!s) { s = new Map(); m.set(day, s); }
          s.set(r.sourceName, (s.get(r.sourceName) || 0) + convertUnit(def.key, v, r.unit));
        }
      } else if (def.agg === 'latest') {
        let mm = this.monthlyLatest.get(def.key);
        for (const r of records(text, def.hk)) {
          const v = Number(r.value);
          if (!r.startDate || !Number.isFinite(v)) continue;
          const sv = convertUnit(def.key, v, r.unit);
          if (!plausible(def.key, sv)) continue; // 丢弃离谱脏值(换算后按规范单位判)
          this.pushLatest(def.key, r.startDate.slice(0, 10), sv);
          if (!mm) { mm = new Map(); this.monthlyLatest.set(def.key, mm); }
          const ym = r.startDate.slice(0, 7);
          const b = mm.get(ym) || { sum: 0, count: 0 };
          b.sum += sv; b.count += 1; mm.set(ym, b);
        }
      } else if (def.agg === 'sleep') {
        for (const r of records(text, def.hk)) {
          if (!/Asleep/i.test(r.value)) continue;
          // 用"夜"键(凌晨段归前一晚),与摘要路径一致 —— 否则跨午夜整晚被拆成两天,
          // latest/prev 变成同一晚两段相比(如 6.0h ▲ 较上次 +5.3)。
          const key = sleepNightKey(r.startDate);
          const ms = Math.max(0, parseAppleDate(r.endDate) - parseAppleDate(r.startDate));
          if (key) {
            let s = this.sleepMs.get(key);
            if (!s) { s = new Map(); this.sleepMs.set(key, s); }
            s.set(r.sourceName, (s.get(r.sourceName) || 0) + ms); // 按来源分开,finalize 取最大源
          }
        }
      } else if (def.agg === 'mindful') {
        for (const r of records(text, def.hk)) {
          const day = r.startDate.slice(0, 10);
          const min = Math.max(0, parseAppleDate(r.endDate) - parseAppleDate(r.startDate)) / 60_000;
          if (day) this.mindMin.set(day, (this.mindMin.get(day) || 0) + min);
        }
      }
    }
    // 锻炼:全文件流式收集明细(不只计数),供 buildNodes 建事件节点 —— 不再只看尾部 6MB。
    const workoutRe = /<Workout\b[^>]*>/g;
    let wm: RegExpExecArray | null;
    while ((wm = workoutRe.exec(text))) {
      const tag = wm[0];
      const rawType = (tag.match(/workoutActivityType="HKWorkoutActivityType([^"]+)"/)?.[1]) || 'Workout';
      this.workoutList.push({
        type: rawType,
        label: WORKOUT_LABEL[rawType] || rawType,
        duration: tag.match(/duration="([^"]+)"/)?.[1] || '',
        start: tag.match(/startDate="([^"]+)"/)?.[1] || '',
      });
    }
    this.workouts = this.workoutList.length;
  }

  finalize(): HealthMetrics {
    const out: HealthMetric[] = [];
    for (const def of METRIC_DEFS) {
      if (def.agg === 'sumDay') {
        const raw = this.sumDay.get(def.key);
        if (!raw || !raw.size) continue;
        const m = collapseBySource(raw); // 每天取最大来源,去多设备重复(iPhone+Watch 不再裸加)
        const days = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        // Apple 导出常在半天时导出 → 最后一天(=今天,导入日)是残缺的,当"最新"会显示偏低
        // + 吓人的负 delta(如"步数 3200 ▼ −6800")。有更早的完整日时,用最后一个完整日。
        const picked = pickLatestCompleteDay(days, todayLocal());
        if (!picked) continue;
        const { last, prev } = picked;
        // 月度序列也排除今天残缺日,免得当月均值被半日数据轻微拉低。
        const forSeries = new Map(days.filter(([d]) => d !== todayLocal()));
        out.push({ ...toMetric(def), latest: round(last[1], def.decimals), latestDate: last[0], prev: prev == null ? null : round(prev, def.decimals), series: monthlySeriesAvg(forSeries, (v) => v, def.decimals) });
      } else if (def.agg === 'latest') {
        const c = this.latest.get(def.key);
        if (!c) continue;
        const mm = this.monthlyLatest.get(def.key);
        const series = mm ? [...mm.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-60).map(([ym, b]) => ({ ym, v: round(b.sum / b.count, def.decimals) })) : [];
        out.push({ ...toMetric(def), latest: round(c.v, def.decimals), latestDate: c.d, prev: Number.isNaN(c.pv) ? null : round(c.pv, def.decimals), prevDate: c.pd || undefined, series });
      } else if (def.agg === 'sleep') {
        if (!this.sleepMs.size) continue;
        const collapsed = collapseBySource(this.sleepMs); // 每夜取最大来源,去跨源重复
        const nights = [...collapsed.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        const last = nights[nights.length - 1];
        const prev = nights.length > 1 ? nights[nights.length - 2][1] / 3_600_000 : null;
        out.push({ ...toMetric(def), latest: round(last[1] / 3_600_000, 1), latestDate: last[0], prev: prev == null ? null : round(prev, 1), series: monthlySeriesAvg(collapsed, (ms) => ms / 3_600_000, 1) });
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

  /** 从全文件聚合结果建记忆节点(概况 + 锻炼)—— 取代此前只解析尾部 6MB 的做法,
   *  避免 Apple 按类型分块导出时尾部恰好缺步数/心率/睡眠而漏进概况。需在 finalize 之后调用。 */
  buildNodes(metrics: HealthMetric[]): HealthNode[] {
    const summaryLines: string[] = [];
    const attrs: Record<string, string | number> = { source: 'Apple Health', importedAt: new Date().toISOString() };
    const find = (k: string) => metrics.find((m) => m.key === k);

    // 步数:近 7 天日均 + 最新完整日(全文件、去多设备重复、排除今天残缺日)
    const rawSteps = this.sumDay.get('steps');
    if (rawSteps && rawSteps.size) {
      let days = [...collapseBySource(rawSteps).entries()].sort((a, b) => a[0].localeCompare(b[0]));
      if (days.length > 1 && days[days.length - 1][0] === todayLocal()) days = days.slice(0, -1);
      const last7 = days.slice(-7);
      if (last7.length) {
        const avg = Math.round(last7.reduce((s, [, v]) => s + v, 0) / last7.length);
        attrs.stepsAvg7d = avg;
        attrs.stepsLatest = Math.round(last7[last7.length - 1][1]);
        summaryLines.push(`近 ${last7.length} 天日均 ${avg.toLocaleString()} 步(最近一天 ${attrs.stepsLatest.toLocaleString()} 步)`);
      }
    }
    const rhr = find('restingHR');
    if (rhr) { attrs.restingHR = rhr.latest; summaryLines.push(`静息心率 ${rhr.latest} bpm`); }
    const sl = find('sleep');
    if (sl) { attrs.sleepLastNightHours = sl.latest; summaryLines.push(`最近一晚睡眠约 ${sl.latest} 小时`); }
    const w = find('weight');
    if (w) { attrs.weightLatest = w.latest; summaryLines.push(`体重 ${w.latest} kg`); }

    const recent = [...this.workoutList].sort((a, b) => a.start.localeCompare(b.start)).slice(-10);
    if (this.workoutList.length) {
      attrs.workoutCount = this.workoutList.length;
      summaryLines.push(`锻炼 ${this.workoutList.length} 次(最近 ${recent[recent.length - 1].label})`);
    }

    const nodes: HealthNode[] = [];
    if (summaryLines.length) {
      nodes.push({
        type: 'health_state', name: 'Apple Health · 健康概况',
        attributes: { ...attrs, externalId: 'health:summary' },
        relations: [], tags: ['健康', 'Apple Health'], confidence: 0.85,
        rawInput: summaryLines.join(' · '),
      });
    }
    for (const wk of recent) {
      const startMs = parseAppleDate(wk.start);
      const durMin = wk.duration ? Math.round(Number(wk.duration)) : 0;
      const startIso = startMs ? new Date(startMs).toISOString() : '';
      nodes.push({
        type: 'event', name: `${wk.label}${durMin ? ` ${durMin} 分钟` : ''}`,
        attributes: {
          source: 'Apple Health',
          ...(startMs ? { start: startIso } : {}),
          ...(durMin ? { durationMin: durMin } : {}),
          activity: wk.label,
          ...(startIso ? { externalId: `health:workout:${startIso}:${wk.type}` } : {}),
        },
        relations: [], tags: ['健康', 'Apple Health', '锻炼', wk.label], confidence: 0.85,
        rawInput: `${wk.label}${durMin ? `,时长 ${durMin} 分钟` : ''}${wk.start ? `,${wk.start.slice(0, 10)}` : ''}`,
      });
    }
    return nodes;
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

/** 全文件流式解析,一次拿到看板指标 + 记忆节点(概况/锻炼)—— 概况节点也基于全文件,
 *  不再单独 tail 解析。取代 ConnectorsHub 里"看板扫全文件、概况只看尾部 6MB"的分裂做法。 */
export function parseHealthFromBytes(bytes: Uint8Array): { metrics: HealthMetrics; nodes: HealthNode[] } {
  const agg = new HealthAggregator();
  const dec = new TextDecoder('utf-8');
  const CHUNK = 8_000_000;
  let buf = '';
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(bytes.length, start + CHUNK);
    buf += dec.decode(bytes.subarray(start, end), { stream: end < bytes.length });
    const cut = buf.lastIndexOf('>');
    if (cut < 0) continue;
    agg.feed(buf.slice(0, cut + 1));
    buf = buf.slice(cut + 1);
  }
  if (buf) agg.feed(buf);
  const metrics = agg.finalize();
  return { metrics, nodes: agg.buildNodes(metrics.metrics) };
}

function toMetric(def: MetricDef): Omit<HealthMetric, 'latest' | 'latestDate' | 'prev' | 'series'> {
  return { key: def.key, label: def.label, unit: def.unit, decimals: def.decimals, group: def.group };
}
function round(v: number, d: number): number {
  const p = Math.pow(10, d);
  return Math.round(v * p) / p;
}
