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
