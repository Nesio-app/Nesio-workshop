/**
 * 地点洞察 —— 在 place-trail 的足迹数据之上做确定性判定(A 计划 Layer 1,health 范式铺开·地图域)。
 *
 * 定位(引擎/知识分离):place-trail = 数据层(足迹/分类/聚合),这里 = 判定层(声明式 RULES +
 * domain-rules 通用运行时)。全部确定性、可单测、warm-coach(不制造焦虑,只轻观察)。
 *
 * 数据诚实红线:没有足迹 ≠ 没出门(可能只是没开定位)。每条规则都带「追踪存活」门 ——
 * 近期必须有足够的真实记录,才敢对"少了什么"下判断;历史不够长也不判(冷启动沉默)。
 * 只出 attention(轻观察),不出 flag:活动范围/习惯断档不是安全风险,红色只给真实风险。
 */
import { categoryOfPlace, type PlaceVisit, type PlaceCategory } from './place-trail';
import { evaluateRules, type DomainRule, type RuleSeverity } from './domain-rules';

export interface PlaceFinding {
  id: string;
  severity: RuleSeverity;
  title: [string, string];  // [zh, en]
  detail: [string, string];
}

export interface PlaceInsightInput {
  visits: PlaceVisit[];
  now: Date;
  /** 可注入分类器(单测用);默认 place-trail 的 categoryOfPlace(读用户纠正)。 */
  categorize?: (label: string) => PlaceCategory;
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** 按「距 now 第几周」分桶(0 = 最近 7 天),越界/坏时间戳丢弃。 */
function weekIndex(ts: string, now: Date): number | null {
  const t = Date.parse(ts);
  if (Number.isNaN(t) || t > now.getTime()) return null;
  return Math.floor((now.getTime() - t) / WEEK_MS);
}

const RULES: ReadonlyArray<DomainRule<PlaceInsightInput, PlaceFinding>> = [
  // ── 活动范围收窄:本周去过的「非家」地点数明显低于你自己的常态 ────────────────
  // 门:本周有 ≥3 条记录(追踪存活)+ 此前 ≥3 个完整周、每周非家地点中位数 ≥4(常态确实更活跃)。
  {
    id: 'place-range-narrow',
    run: (i) => {
      const cat = i.categorize ?? ((label: string) => categoryOfPlace(label));
      const byWeek = new Map<number, { records: number; nonHome: Set<string> }>();
      for (const v of i.visits) {
        const w = weekIndex(v.ts, i.now);
        if (w == null || w > 8) continue; // 只看最近 ~9 周
        const b = byWeek.get(w) ?? { records: 0, nonHome: new Set<string>() };
        b.records += 1;
        if (cat(v.label) !== 'home') b.nonHome.add(v.label);
        byWeek.set(w, b);
      }
      const cur = byWeek.get(0);
      if (!cur || cur.records < 3) return null; // 追踪不活跃,不判
      const history = [...byWeek.entries()].filter(([w]) => w >= 1 && w <= 8).map(([, b]) => b.nonHome.size);
      if (history.length < 3) return null;      // 历史不够,冷启动沉默
      const sorted = [...history].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      if (median < 4 || cur.nonHome.size > 1) return null;
      return {
        severity: 'attention',
        title: ['这周的活动范围比平时小', 'This week your range is smaller than usual'],
        detail: [
          `本周去过 ${cur.nonHome.size} 个家以外的地点(你平时每周约 ${median} 个)。想的话,散个步也算出门。`,
          `${cur.nonHome.size} places beyond home this week (you usually visit ~${median}). A short walk counts too.`,
        ],
      };
    },
  },
  // ── 健身习惯断档:此前稳定的健身足迹,最近两周没有了 ─────────────────────────
  // 门:近 14 天有 ≥5 条记录(追踪存活)+ 之前 8 周里 ≥3 个不同周有健身地点(习惯确实存在)。
  {
    id: 'place-fitness-lapse',
    run: (i) => {
      const cat = i.categorize ?? ((label: string) => categoryOfPlace(label));
      let recentRecords = 0;
      let recentFitness = 0;
      const fitnessWeeks = new Set<number>();
      for (const v of i.visits) {
        const t = Date.parse(v.ts);
        if (Number.isNaN(t) || t > i.now.getTime()) continue;
        const ageDays = (i.now.getTime() - t) / DAY_MS;
        const isFitness = cat(v.label) === 'fitness';
        if (ageDays <= 14) {
          recentRecords += 1;
          if (isFitness) recentFitness += 1;
        } else if (ageDays <= 14 + 8 * 7 && isFitness) {
          fitnessWeeks.add(Math.floor((ageDays - 14) / 7));
        }
      }
      if (recentRecords < 5 || recentFitness > 0) return null; // 追踪不活跃 / 没断档,不判
      if (fitnessWeeks.size < 3) return null;                  // 此前习惯不成立,不判
      return {
        severity: 'attention',
        title: ['健身足迹有阵子没出现了', 'Workout visits have paused for a while'],
        detail: [
          `最近两周没有健身地点的足迹(此前 8 周里有 ${fitnessWeeks.size} 周去过)。不用补课,从一次轻松的开始就好。`,
          `No workout-place visits in the last two weeks (you went in ${fitnessWeeks.size} of the prior 8 weeks). No catch-up needed — start easy.`,
        ],
      };
    },
  },
];

/** 地图域 findings 总入口(确定性,红旗不适用于本域 —— 只轻观察)。 */
export function placeFindings(input: PlaceInsightInput): PlaceFinding[] {
  if (!input.visits.length) return [];
  return evaluateRules(RULES, input);
}
