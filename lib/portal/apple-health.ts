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

/** 抽取某个 HK type 的所有 <Record ...>(自闭合或带子元素的开标签都能匹配到开头)。
 *  ⚠️ 属性值可能含 '>':Apple 对摩尔浓度的单位写作 `mmol<180.15588…>/L`(血糖/部分血脂)。
 *  故不能用 `[^>]*` 匹配整段标签 —— 会在单位里的 '>' 处截断,把其后的 startDate/value 丢掉
 *  (value 变空→按 0 落在合理范围外被当脏值弃、startDate 变空→latest 分支跳过),
 *  结果整类血糖一条都进不来。用「完整引号串 | 非引号非'>' 字符」重复,正确跨过引号内的 '>'。 */
function records(xml: string, hkType: string): Rec[] {
  const re = new RegExp(`<Record\\b(?:"[^"]*"|[^>"])*?type="${hkType}"(?:"[^"]*"|[^>"])*>`, 'g');
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
  group: 'activity' | 'heart' | 'body' | 'vitals' | 'mind' | 'nutrition';
  series: Array<{ ym: string; v: number }>; // 批次 40:按月历史序列(画多年趋势曲线)
}

/** 批次 42(A):血糖深度分析 —— CGM/指尖血级密集数据,不再只留「最新一个读数」。
 *  内部一律按 mg/dL 计算(规范单位),按用户原始单位(mmol/L 或 mg/dL)显示。 */
export interface GlucoseAnalysis {
  unit: 'mmol/L' | 'mg/dL';    // 显示单位(按用户数据里的原始单位)
  count: number;               // 有效读数条数
  avg: number; min: number; max: number;   // 显示单位
  cv: number;                  // 变异系数 %(std/mean,血糖稳定性的金标准指标)
  gmi: number;                 // 血糖管理指标 %(≈糖化血红蛋白 A1c),GMI=3.31+0.02392×平均mg/dL
  tirPct: number;              // 时间在目标范围内 %(3.9–10.0 mmol/L = 70–180 mg/dL)
  belowPct: number; abovePct: number;       // 低于/高于目标 %
  targetLow: number; targetHigh: number;    // 显示单位的目标区间(画范围带用)
  daily: Array<{ date: string; avg: number; min: number; max: number }>;  // 近 90 天日序列(显示单位)
  hourly: Array<{ hour: number; avg: number }>;   // 0–23 点平均(看黎明现象/餐后峰值,显示单位)
}

/** 批次 42(A):每日事实表 —— 把各领域指标对齐到「天」,作为跨板块关系挖掘(综合层)的地基。
 *  值一律用规范单位(与 METRIC_DEFS 一致);后续 B/C 往这张表加列。 */
export interface DailyFact {
  date: string;                       // YYYY-MM-DD
  glucoseAvg?: number; glucoseMin?: number; glucoseMax?: number;  // mg/dL
  steps?: number; activeEnergy?: number; distance?: number;       // sumDay 类
  restingHR?: number; hrv?: number;                               // latest 类当日均值
  sleepH?: number;                    // 当晚睡眠小时(按夜键归属)
  daylight?: number;                  // 当日日照(分钟)
  moodValence?: number;               // 当日情绪效价 [-1,1]
}

/** 批次 44(C):睡眠分期 —— 最近一晚的 Core/Deep/REM/清醒(iOS 16+),单位小时。 */
export interface SleepStages {
  night: string;                      // 夜键 YYYY-MM-DD
  core: number; deep: number; rem: number; awake: number;
  total: number;                      // core+deep+rem(实际睡着)
}

/** 批次 44(C):活动三环 —— 最近一天的 Move/Exercise/Stand + 目标(<ActivitySummary>)。 */
export interface ActivityRings {
  date: string;
  move: number; moveGoal: number;         // kcal
  exercise: number; exerciseGoal: number; // min
  stand: number; standGoal: number;       // 小时
}

/** 批次 45(D1):State of Mind 情绪(iOS 17+)—— 效价 valence 在 [-1,1]。 */
export interface MoodAnalysis {
  count: number;
  avgValence: number;                 // 近期平均效价 [-1,1]
  tone: 'pleasant' | 'neutral' | 'unpleasant';
  daily: Array<{ date: string; valence: number }>;  // 近 90 天日均效价
}

/** 批次 45(D1):基础档案 <Me> —— 生理性别/血型/生日(→ 年龄)。 */
export interface Profile {
  age?: number;
  sex?: string;                       // male / female / other
  bloodType?: string;                 // O+ / A- / …
}

export interface HealthMetrics {
  metrics: HealthMetric[];
  workouts: number;
  importedAt: string;
  glucose?: GlucoseAnalysis;          // A:血糖深度分析(数据足够时才有)
  daily?: DailyFact[];                // A:每日事实表(跨域分析地基)
  sleepStages?: SleepStages;          // C:最近一晚睡眠分期
  activityRings?: ActivityRings;      // C:最近一天活动三环
  mood?: MoodAnalysis;                // D1:State of Mind 情绪
  profile?: Profile;                  // D1:基础档案
}

// latest 类指标的合理范围(规范单位),超出即当脏值丢弃,不让离谱读数直接上卡片。
const PLAUSIBLE_RANGE: Record<string, [number, number]> = {
  restingHR: [25, 250], walkingHR: [40, 250], hrv: [1, 500], vo2max: [5, 90],
  spo2: [50, 100], respiratory: [3, 60], bpSys: [50, 270], bpDia: [25, 200],
  glucose: [20, 700], bodyTemp: [30, 45], weight: [2, 500], bodyFat: [1, 70],
  bmi: [8, 90], leanMass: [2, 200], height: [30, 260],
  wristTemp: [30, 45], walkingSteadiness: [0, 100], walkingSpeed: [0, 20], // B
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
  // ── 批次 43(B):现成便宜指标 —— 加 def 即出卡,不新增解析结构 ──
  { key: 'standTime', hk: 'HKQuantityTypeIdentifierAppleStandTime', label: ['站立时长', 'Stand time'], unit: 'min', decimals: 0, agg: 'sumDay', group: 'activity' },
  { key: 'walkingSpeed', hk: 'HKQuantityTypeIdentifierWalkingSpeed', label: ['步行速度', 'Walking speed'], unit: 'km/h', decimals: 1, agg: 'latest', group: 'activity' },
  { key: 'walkingSteadiness', hk: 'HKQuantityTypeIdentifierAppleWalkingSteadiness', label: ['步行稳定性', 'Walking steadiness'], unit: '%', decimals: 0, agg: 'latest', group: 'activity' },
  { key: 'daylight', hk: 'HKQuantityTypeIdentifierTimeInDaylight', label: ['日照时长', 'Time in daylight'], unit: 'min', decimals: 0, agg: 'sumDay', group: 'mind' },
  { key: 'wristTemp', hk: 'HKQuantityTypeIdentifierAppleSleepingWristTemperature', label: ['睡眠腕温', 'Sleeping wrist temp'], unit: '°C', decimals: 1, agg: 'latest', group: 'vitals' },
  { key: 'dietEnergy', hk: 'HKQuantityTypeIdentifierDietaryEnergyConsumed', label: ['摄入热量', 'Dietary energy'], unit: 'kcal', decimals: 0, agg: 'sumDay', group: 'nutrition' },
  { key: 'dietProtein', hk: 'HKQuantityTypeIdentifierDietaryProtein', label: ['蛋白质', 'Protein'], unit: 'g', decimals: 0, agg: 'sumDay', group: 'nutrition' },
  { key: 'dietCarbs', hk: 'HKQuantityTypeIdentifierDietaryCarbohydrates', label: ['碳水', 'Carbs'], unit: 'g', decimals: 0, agg: 'sumDay', group: 'nutrition' },
  { key: 'dietFat', hk: 'HKQuantityTypeIdentifierDietaryFatTotal', label: ['脂肪', 'Fat'], unit: 'g', decimals: 0, agg: 'sumDay', group: 'nutrition' },
  { key: 'dietCaffeine', hk: 'HKQuantityTypeIdentifierDietaryCaffeine', label: ['咖啡因', 'Caffeine'], unit: 'mg', decimals: 0, agg: 'sumDay', group: 'nutrition' },
  { key: 'dietWater', hk: 'HKQuantityTypeIdentifierDietaryWater', label: ['饮水', 'Water'], unit: 'L', decimals: 1, agg: 'sumDay', group: 'nutrition' },
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
    case 'wristTemp': // B:睡眠腕温同样 degF→°C
      if (u === 'degf' || u === '°f' || u === 'f') return (v - 32) * 5 / 9;
      return v; // degC
    case 'glucose': // → mg/dL
      if (u.includes('mmol')) return v * 18.0182;
      return v; // mg/dL
    case 'activeEnergy': // → kcal
    case 'dietEnergy': // B:摄入热量同样 kJ→kcal
      if (u === 'kj') return v / 4.184;
      return v; // kcal/Cal
    case 'walkingSpeed': // B → km/h
      if (u === 'mi/hr' || u === 'mph') return v * 1.609344;
      if (u === 'm/s') return v * 3.6;
      return v; // km/hr
    case 'dietWater': // B → L
      if (u === 'ml') return v / 1000;
      if (u === 'fl_oz_us' || u === 'floz' || u === 'fl oz') return v * 0.0295735;
      return v; // L
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
  private workoutList: Array<{ type: string; label: string; duration: string; start: string; distKm: number; kcal: number }> = [];
  workouts = 0;
  // A:血糖深度采集(全部按 mg/dL 规范单位累计;显示时再按用户单位换算)。
  private gluDay = new Map<string, { sum: number; count: number; min: number; max: number }>();
  private gluHour = new Map<number, { sum: number; count: number }>();
  private glu = { count: 0, sum: 0, sumSq: 0, inRange: 0, below: 0, above: 0, mmol: false };
  // C:睡眠分期(夜 → 来源 → 各期毫秒)与活动三环(日期 → 三环值+目标)。
  private sleepStage = new Map<string, Map<string, { core: number; deep: number; rem: number; awake: number }>>();
  private activityByDate = new Map<string, { move: number; moveGoal: number; exercise: number; exerciseGoal: number; stand: number; standGoal: number }>();
  // D1:情绪效价(日 → {sum,count})与基础档案。
  private moodDay = new Map<string, { sum: number; count: number }>();
  private moodTotal = { sum: 0, count: 0 };
  private profile: Profile = {};
  // E:跨域分析需要的 latest 类指标「按天均值」(restingHR/hrv)。
  private dayLatest = new Map<string, Map<string, { sum: number; count: number }>>(); // key → date → {sum,count}
  private static DAILY_LATEST_KEYS = new Set(['restingHR', 'hrv']);

  private feedGlucose(r: Rec, mgdl: number) {
    const day = r.startDate.slice(0, 10);
    if (!day) return;
    const g = this.gluDay.get(day) || { sum: 0, count: 0, min: Infinity, max: -Infinity };
    g.sum += mgdl; g.count += 1;
    if (mgdl < g.min) g.min = mgdl;
    if (mgdl > g.max) g.max = mgdl;
    this.gluDay.set(day, g);
    const hour = Number(r.startDate.slice(11, 13));
    if (Number.isFinite(hour)) {
      const h = this.gluHour.get(hour) || { sum: 0, count: 0 };
      h.sum += mgdl; h.count += 1; this.gluHour.set(hour, h);
    }
    this.glu.count += 1; this.glu.sum += mgdl; this.glu.sumSq += mgdl * mgdl;
    if (mgdl < 70) this.glu.below += 1;
    else if (mgdl > 180) this.glu.above += 1;
    else this.glu.inRange += 1;
    if ((r.unit || '').toLowerCase().includes('mmol')) this.glu.mmol = true;
  }

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
          if (def.key === 'glucose') this.feedGlucose(r, sv); // A:同一次扫描顺带深度采集,不重复读
          if (HealthAggregator.DAILY_LATEST_KEYS.has(def.key)) { // E:按天均值(跨域相关用)
            const day = r.startDate.slice(0, 10);
            let dm = this.dayLatest.get(def.key);
            if (!dm) { dm = new Map(); this.dayLatest.set(def.key, dm); }
            const cell = dm.get(day) || { sum: 0, count: 0 };
            cell.sum += sv; cell.count += 1; dm.set(day, cell);
          }
          this.pushLatest(def.key, r.startDate.slice(0, 10), sv);
          if (!mm) { mm = new Map(); this.monthlyLatest.set(def.key, mm); }
          const ym = r.startDate.slice(0, 7);
          const b = mm.get(ym) || { sum: 0, count: 0 };
          b.sum += sv; b.count += 1; mm.set(ym, b);
        }
      } else if (def.agg === 'sleep') {
        for (const r of records(text, def.hk)) {
          const asleep = /Asleep/i.test(r.value);
          const awake = /Awake/i.test(r.value);
          if (!asleep && !awake) continue; // InBed 不算睡着也不算清醒段
          // 用"夜"键(凌晨段归前一晚),与摘要路径一致 —— 否则跨午夜整晚被拆成两天,
          // latest/prev 变成同一晚两段相比(如 6.0h ▲ 较上次 +5.3)。
          const key = sleepNightKey(r.startDate);
          if (!key) continue;
          const ms = Math.max(0, parseAppleDate(r.endDate) - parseAppleDate(r.startDate));
          if (asleep) {
            let s = this.sleepMs.get(key);
            if (!s) { s = new Map(); this.sleepMs.set(key, s); }
            s.set(r.sourceName, (s.get(r.sourceName) || 0) + ms); // 按来源分开,finalize 取最大源
          }
          // C:分期(iOS 16+ 才有 Core/Deep/REM;旧版只有 Asleep → 计入 total 但无分期)。
          let st = this.sleepStage.get(key);
          if (!st) { st = new Map(); this.sleepStage.set(key, st); }
          let src = st.get(r.sourceName);
          if (!src) { src = { core: 0, deep: 0, rem: 0, awake: 0 }; st.set(r.sourceName, src); }
          if (/Core/i.test(r.value)) src.core += ms;
          else if (/Deep/i.test(r.value)) src.deep += ms;
          else if (/REM/i.test(r.value)) src.rem += ms;
          else if (awake) src.awake += ms;
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
    // C:顺带读 totalDistance / totalEnergyBurned(在 Workout 开标签上时),换算到 km / kcal。
    const workoutRe = /<Workout\b(?:"[^"]*"|[^>"])*>/g;
    let wm: RegExpExecArray | null;
    while ((wm = workoutRe.exec(text))) {
      const tag = wm[0];
      const rawType = (tag.match(/workoutActivityType="HKWorkoutActivityType([^"]+)"/)?.[1]) || 'Workout';
      const dist = Number(tag.match(/totalDistance="([^"]+)"/)?.[1] || '');
      const distU = (tag.match(/totalDistanceUnit="([^"]+)"/)?.[1] || '').toLowerCase();
      const en = Number(tag.match(/totalEnergyBurned="([^"]+)"/)?.[1] || '');
      const enU = (tag.match(/totalEnergyBurnedUnit="([^"]+)"/)?.[1] || '').toLowerCase();
      this.workoutList.push({
        type: rawType,
        label: WORKOUT_LABEL[rawType] || rawType,
        duration: tag.match(/duration="([^"]+)"/)?.[1] || '',
        start: tag.match(/startDate="([^"]+)"/)?.[1] || '',
        distKm: Number.isFinite(dist) ? (distU === 'mi' ? dist * 1.609344 : distU === 'm' ? dist / 1000 : dist) : 0,
        kcal: Number.isFinite(en) ? (enU === 'kj' ? en / 4.184 : en) : 0,
      });
    }
    this.workouts = this.workoutList.length;

    // C:活动三环 —— <ActivitySummary> 每日一条,含三环值与目标(属性可能含 '>',用引号感知匹配)。
    const asRe = /<ActivitySummary\b(?:"[^"]*"|[^>"])*>/g;
    let am: RegExpExecArray | null;
    while ((am = asRe.exec(text))) {
      const tag = am[0];
      const date = tag.match(/dateComponents="([^"]+)"/)?.[1] || '';
      if (!date) continue;
      const num = (attr: string) => Number(tag.match(new RegExp(`${attr}="([^"]+)"`))?.[1] || '0') || 0;
      const enU = (tag.match(/activeEnergyBurnedUnit="([^"]+)"/)?.[1] || '').toLowerCase();
      const move = num('activeEnergyBurned');
      this.activityByDate.set(date, {
        move: enU === 'kj' ? move / 4.184 : move,
        moveGoal: (() => { const g = num('activeEnergyBurnedGoal'); return enU === 'kj' ? g / 4.184 : g; })(),
        exercise: num('appleExerciseTime'),
        exerciseGoal: num('appleExerciseTimeGoal'),
        stand: num('appleStandHours'),
        standGoal: num('appleStandHoursGoal'),
      });
    }

    // D1:State of Mind 情绪(iOS 17+)—— 效价 valence ∈ [-1,1],按天聚合。
    const somRe = /<StateOfMind\b(?:"[^"]*"|[^>"])*>/g;
    let sm: RegExpExecArray | null;
    while ((sm = somRe.exec(text))) {
      const tag = sm[0];
      const day = (tag.match(/startDate="([^"]+)"/)?.[1] || '').slice(0, 10);
      const val = Number(tag.match(/valence="([^"]+)"/)?.[1] || '');
      if (!day || !Number.isFinite(val)) continue;
      const d = this.moodDay.get(day) || { sum: 0, count: 0 };
      d.sum += val; d.count += 1; this.moodDay.set(day, d);
      this.moodTotal.sum += val; this.moodTotal.count += 1;
    }

    // D1:基础档案 <Me>(生理性别/血型/生日)。
    const me = text.match(/<Me\b(?:"[^"]*"|[^>"])*>/)?.[0];
    if (me) {
      const dob = me.match(/HKCharacteristicTypeIdentifierDateOfBirth="([^"]+)"/)?.[1];
      const sex = me.match(/HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSex([^"]+)"/)?.[1];
      const blood = me.match(/HKCharacteristicTypeIdentifierBloodType="HKBloodType([^"]+)"/)?.[1];
      if (dob) { const y = Number(dob.slice(0, 4)); if (y > 1900) this.profile.age = new Date().getFullYear() - y; }
      if (sex && sex !== 'NotSet') this.profile.sex = sex.toLowerCase();
      if (blood && blood !== 'NotSet') this.profile.bloodType = blood.replace('Positive', '+').replace('Negative', '−');
    }
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
        const collapsed = this.sleepAsleepByNight(); // 有分期就用 Core+Deep+REM(不重复计),每夜取最大源
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
    const glucose = this.buildGlucose();
    const daily = this.buildDailyFacts();
    const sleepStages = this.buildSleepStages();
    const activityRings = this.buildActivityRings();
    const mood = this.buildMood();
    const profile = (this.profile.age || this.profile.sex || this.profile.bloodType) ? this.profile : undefined;
    return { metrics: out, workouts: this.workouts, importedAt: new Date().toISOString(), glucose, daily, sleepStages, activityRings, mood, profile };
  }

  /** D1:State of Mind 情绪分析 —— 平均效价 + 基调 + 近 90 天日均序列。 */
  private buildMood(): MoodAnalysis | undefined {
    if (this.moodTotal.count < 3) return undefined;
    const avg = this.moodTotal.sum / this.moodTotal.count;
    const daily = [...this.moodDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-90)
      .map(([date, d]) => ({ date, valence: Math.round((d.sum / d.count) * 100) / 100 }));
    return {
      count: this.moodTotal.count,
      avgValence: Math.round(avg * 100) / 100,
      tone: avg > 0.3 ? 'pleasant' : avg < -0.3 ? 'unpleasant' : 'neutral',
      daily,
    };
  }

  /** 每夜「实际睡着」毫秒(每夜取最大源)。修睡眠总时长虚高:一个来源常同时记录
   *  概况 Asleep 段 + 细分 Core/Deep/REM 段(时间重叠),把它们全 /Asleep/ 求和会 2–3× 翻倍
   *  (用户见「21.5h」)。有分期就用 Core+Deep+REM(彼此不重叠),否则用通用 Asleep 求和。 */
  private sleepAsleepByNight(): Map<string, number> {
    const byNight = new Map<string, Map<string, number>>();
    const nights = new Set<string>([...this.sleepMs.keys(), ...this.sleepStage.keys()]);
    for (const night of nights) {
      const stageSrc = this.sleepStage.get(night);
      const genSrc = this.sleepMs.get(night);
      const srcNames = new Set<string>([...(stageSrc ? stageSrc.keys() : []), ...(genSrc ? genSrc.keys() : [])]);
      const sources = new Map<string, number>();
      for (const s of srcNames) {
        const st = stageSrc?.get(s);
        const staged = st ? st.core + st.deep + st.rem : 0;
        sources.set(s, staged > 0 ? staged : (genSrc?.get(s) ?? 0));
      }
      byNight.set(night, sources);
    }
    return collapseBySource(byNight);
  }

  /** C:最近一晚睡眠分期 —— 取最后一夜、该夜睡着最多的来源(避免多设备重叠重复)的各期时长。 */
  private buildSleepStages(): SleepStages | undefined {
    if (!this.sleepStage.size) return undefined;
    const night = [...this.sleepStage.keys()].sort().pop()!;
    const bySource = this.sleepStage.get(night)!;
    let best: { core: number; deep: number; rem: number; awake: number } | undefined;
    let bestAsleep = -1;
    for (const s of bySource.values()) {
      const asleep = s.core + s.deep + s.rem;
      if (asleep > bestAsleep) { bestAsleep = asleep; best = s; }
    }
    if (!best) return undefined;
    const h = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10;
    const total = best.core + best.deep + best.rem;
    if (total <= 0) return undefined; // 旧版只有 Asleep 无分期 → 不给空分期卡
    return { night, core: h(best.core), deep: h(best.deep), rem: h(best.rem), awake: h(best.awake), total: h(total) };
  }

  /** C:最近一天活动三环 + 目标。 */
  private buildActivityRings(): ActivityRings | undefined {
    if (!this.activityByDate.size) return undefined;
    const date = [...this.activityByDate.keys()].sort().pop()!;
    const a = this.activityByDate.get(date)!;
    if (a.moveGoal <= 0 && a.exerciseGoal <= 0 && a.standGoal <= 0) return undefined; // 无目标=无有效三环
    return {
      date,
      move: Math.round(a.move), moveGoal: Math.round(a.moveGoal),
      exercise: Math.round(a.exercise), exerciseGoal: Math.round(a.exerciseGoal),
      stand: Math.round(a.stand), standGoal: Math.round(a.standGoal),
    };
  }

  /** A:血糖深度分析 —— 日序列 + TIR + 变异系数 + GMI + 小时模式。内部 mg/dL,按用户单位显示。 */
  private buildGlucose(): GlucoseAnalysis | undefined {
    if (this.glu.count < 14) return undefined; // 太少不做深度分析(避免几条读数就给结论)
    const mmol = this.glu.mmol;
    const dv = (mgdl: number) => (mmol ? Math.round((mgdl / 18.0182) * 10) / 10 : Math.round(mgdl));
    const n = this.glu.count;
    const meanMgdl = this.glu.sum / n;
    const variance = Math.max(0, this.glu.sumSq / n - meanMgdl * meanMgdl);
    const cv = meanMgdl > 0 ? (Math.sqrt(variance) / meanMgdl) * 100 : 0;
    const daily = [...this.gluDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-90)
      .map(([date, g]) => ({ date, avg: dv(g.sum / g.count), min: dv(g.min), max: dv(g.max) }));
    const hourly = [...this.gluHour.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hour, h]) => ({ hour, avg: dv(h.sum / h.count) }));
    return {
      unit: mmol ? 'mmol/L' : 'mg/dL',
      count: n,
      avg: dv(meanMgdl),
      min: dv(Math.min(...[...this.gluDay.values()].map((g) => g.min))),
      max: dv(Math.max(...[...this.gluDay.values()].map((g) => g.max))),
      cv: Math.round(cv * 10) / 10,
      gmi: Math.round((3.31 + 0.02392 * meanMgdl) * 10) / 10,
      tirPct: Math.round((this.glu.inRange / n) * 1000) / 10,
      belowPct: Math.round((this.glu.below / n) * 1000) / 10,
      abovePct: Math.round((this.glu.above / n) * 1000) / 10,
      targetLow: mmol ? 3.9 : 70,
      targetHigh: mmol ? 10 : 180,
      daily,
      hourly,
    };
  }

  /** A:每日事实表 —— 把各领域已聚合到「天」的指标并到一张表,作跨板块关系挖掘的地基。 */
  private buildDailyFacts(): DailyFact[] {
    const byDate = new Map<string, DailyFact>();
    const get = (d: string) => { let f = byDate.get(d); if (!f) { f = { date: d }; byDate.set(d, f); } return f; };
    for (const [date, g] of this.gluDay) { const f = get(date); f.glucoseAvg = round(g.sum / g.count, 0); f.glucoseMin = round(g.min, 0); f.glucoseMax = round(g.max, 0); }
    for (const key of ['steps', 'activeEnergy', 'distance'] as const) {
      const raw = this.sumDay.get(key);
      if (!raw) continue;
      const dec = key === 'distance' ? 2 : 0;
      for (const [date, v] of collapseBySource(raw)) get(date)[key] = round(v, dec);
    }
    for (const [night, ms] of this.sleepAsleepByNight()) get(night).sleepH = round(ms / 3_600_000, 1);
    // E:latest 类按天均值(restingHR/hrv)
    for (const key of ['restingHR', 'hrv'] as const) {
      const dm = this.dayLatest.get(key);
      if (!dm) continue;
      for (const [date, c] of dm) get(date)[key] = round(c.sum / c.count, 0);
    }
    // 日照(sumDay)与情绪效价(moodDay)也并入,作跨域相关的列
    const dl = this.sumDay.get('daylight');
    if (dl) for (const [date, v] of collapseBySource(dl)) get(date).daylight = round(v, 0);
    for (const [date, m] of this.moodDay) get(date).moodValence = round(m.sum / m.count, 2);
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-180);
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
      // C:富数据 —— 距离 km / 消耗 kcal(有则进属性与文案,锻炼节点从「跑步 30 分钟」升级)。
      const distKm = wk.distKm > 0 ? Math.round(wk.distKm * 100) / 100 : 0;
      const kcal = wk.kcal > 0 ? Math.round(wk.kcal) : 0;
      nodes.push({
        type: 'event', name: `${wk.label}${durMin ? ` ${durMin} 分钟` : ''}`,
        attributes: {
          source: 'Apple Health',
          ...(startMs ? { start: startIso } : {}),
          ...(durMin ? { durationMin: durMin } : {}),
          ...(distKm ? { distanceKm: distKm } : {}),
          ...(kcal ? { energyKcal: kcal } : {}),
          activity: wk.label,
          ...(startIso ? { externalId: `health:workout:${startIso}:${wk.type}` } : {}),
        },
        relations: [], tags: ['健康', 'Apple Health', '锻炼', wk.label], confidence: 0.85,
        rawInput: `${wk.label}${durMin ? `,时长 ${durMin} 分钟` : ''}${distKm ? `,${distKm} 公里` : ''}${kcal ? `,${kcal} 千卡` : ''}${wk.start ? `,${wk.start.slice(0, 10)}` : ''}`,
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

export interface HealthStreamParser {
  /** 喂一段解压出的字节;final=true 表示这是最后一块(冲刷 TextDecoder 与残尾缓冲)。 */
  push: (bytes: Uint8Array, final?: boolean) => void;
  /** 只要看板指标。 */
  finishMetrics: () => HealthMetrics;
  /** 看板指标 + 记忆节点(概况/锻炼)。 */
  finish: () => { metrics: HealthMetrics; nodes: HealthNode[] };
}

/**
 * 批次 41:增量流式解析器 —— 调用方边解压边 push,任何时刻只持有一小块文本,
 * 不再把整份 export.xml materialize 成一个巨大的 Uint8Array/字符串。
 * 修 1GB zip 在手机上闪退(export.xml 解压后常达 10GB+,一次性装载即 OOM)。
 * 内部沿用「只处理到最后一个完整标签 '>'」的边界逻辑,跨 push 的半个 <Record> 不会被切断。
 */
/** 找最后一个「引号外」的 '>'(真正的标签结束),跳过 Apple 摩尔单位 `mmol<180.156>/L`
 *  里字面的 '<'/'>'。用它切分块边界,才不会把血糖等记录从单位中间切碎。
 *  buf 始终从一个完整标签之后开始(引号外),故从头扫描的引号状态可信。 */
function lastTagClose(s: string): number {
  let inQuote = false;
  let last = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 34 /* " */) inQuote = !inQuote;
    else if (c === 62 /* > */ && !inQuote) last = i;
  }
  return last;
}

export function createHealthStreamParser(): HealthStreamParser {
  const agg = new HealthAggregator();
  const dec = new TextDecoder('utf-8');
  let buf = '';
  const flush = () => { if (buf) { agg.feed(buf); buf = ''; } };
  return {
    push(bytes: Uint8Array, final = false) {
      if (bytes.length) buf += dec.decode(bytes, { stream: !final });
      else if (final) buf += dec.decode(); // 冲刷多字节字符残留
      // 只切到「引号外」的最后一个 '>':血糖单位 mmol<180.156>/L 里的字面 '>' 不算标签结束,
      // 否则边界会把该记录切碎(startDate/value 落到下一块的孤儿尾巴里 → 整条丢失)。
      const cut = lastTagClose(buf);
      if (cut >= 0) { agg.feed(buf.slice(0, cut + 1)); buf = buf.slice(cut + 1); }
      if (final) flush();
    },
    finishMetrics(): HealthMetrics {
      flush();
      return agg.finalize();
    },
    finish(): { metrics: HealthMetrics; nodes: HealthNode[] } {
      flush();
      const metrics = agg.finalize();
      return { metrics, nodes: agg.buildNodes(metrics.metrics) };
    },
  };
}

/** 把一整块字节按 8MB 切片喂进流式解析器(内存已在手里的场景:小文件/裸 export.xml)。 */
function feedBytes(parser: HealthStreamParser, bytes: Uint8Array): void {
  const CHUNK = 8_000_000;
  if (bytes.length === 0) { parser.push(bytes, true); return; }
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(bytes.length, start + CHUNK);
    parser.push(bytes.subarray(start, end), end >= bytes.length);
  }
}

/** 批次 39:全文件流式解析 —— 解压后的字节分块喂,扫全部记录,不漏任何指标类型。 */
export function parseHealthMetricsFromBytes(bytes: Uint8Array): HealthMetrics {
  const parser = createHealthStreamParser();
  feedBytes(parser, bytes);
  return parser.finishMetrics();
}

/** 全文件流式解析,一次拿到看板指标 + 记忆节点(概况/锻炼)—— 概况节点也基于全文件,
 *  不再单独 tail 解析。取代 ConnectorsHub 里"看板扫全文件、概况只看尾部 6MB"的分裂做法。 */
export function parseHealthFromBytes(bytes: Uint8Array): { metrics: HealthMetrics; nodes: HealthNode[] } {
  const parser = createHealthStreamParser();
  feedBytes(parser, bytes);
  return parser.finish();
}

function toMetric(def: MetricDef): Omit<HealthMetric, 'latest' | 'latestDate' | 'prev' | 'series'> {
  return { key: def.key, label: def.label, unit: def.unit, decimals: def.decimals, group: def.group };
}
function round(v: number, d: number): number {
  const p = Math.pow(10, d);
  return Math.round(v * p) / p;
}
