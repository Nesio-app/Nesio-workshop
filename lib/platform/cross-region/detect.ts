/**
 * 跨区推理 · 检测层接线(P1)—— 把 fact-journal 喂进纯统计引擎,产出人类可复核的
 * 跨区洞察(带证据 + p 值)。展示层(洞察 tab 跨区明细)读这里。
 *
 * 边界:统计在 detect-core.mjs(纯、可单测);这里只做「列元数据 + 读 journal +
 * 组织成句」。列的域(domain)决定「跨区」——只有不同域的两列才配对,域内(如
 * 步数×睡眠都属健康)不算跨区、也避免刷屏平凡相关。
 */

import { ensureFactJournal, readFactJournal } from '@/lib/platform/fact-journal';
import { detectCrossRegion, detectLeadLag, DETECT_DEFAULTS } from './detect-core.mjs';

type Kind = 'continuous' | 'count';

interface ColumnMeta {
  key: string;
  domain: string;
  kind: Kind;
  /** 敏感度:health/finance/location 供 P2 投递层同意门用(P1 仅本人在洞察页看,记账即可)。 */
  sensitive?: boolean;
  zh: string;
  en: string;
}

/** journal 软 schema 列的元数据。新列加一行即自动进入跨区检测。 */
const COLUMNS: ColumnMeta[] = [
  { key: 'placeAwayMin', domain: 'location', kind: 'continuous', sensitive: true, zh: '在外时长', en: 'Time out' },
  { key: 'placeVisits', domain: 'location', kind: 'count', sensitive: true, zh: '到访次数', en: 'Visits' },
  { key: 'placeMoveKm', domain: 'location', kind: 'continuous', sensitive: true, zh: '移动距离', en: 'Distance moved' },
  { key: 'spend', domain: 'finance', kind: 'continuous', sensitive: true, zh: '支出', en: 'Spending' },
  { key: 'moodValence', domain: 'mood', kind: 'continuous', zh: '心情', en: 'Mood' },
  { key: 'trainingSessions', domain: 'fitness', kind: 'count', zh: '训练次数', en: 'Workouts' },
  { key: 'fbUseful', domain: 'feedback', kind: 'count', zh: '有用反馈', en: 'Useful reactions' },
  { key: 'fbNegative', domain: 'feedback', kind: 'count', zh: '负向反馈', en: 'Negative reactions' },
  { key: 'steps', domain: 'health', kind: 'continuous', sensitive: true, zh: '步数', en: 'Steps' },
  { key: 'sleepMin', domain: 'health', kind: 'continuous', sensitive: true, zh: '睡眠时长', en: 'Sleep' },
  { key: 'restingHR', domain: 'health', kind: 'continuous', sensitive: true, zh: '静息心率', en: 'Resting HR' },
  { key: 'hrv', domain: 'health', kind: 'continuous', sensitive: true, zh: '心率变异', en: 'HRV' },
  { key: 'weatherTempC', domain: 'weather', kind: 'continuous', zh: '气温', en: 'Temperature' },
  { key: 'weatherPrecipMm', domain: 'weather', kind: 'continuous', zh: '降水', en: 'Precipitation' },
  { key: 'calendarEvents', domain: 'calendar', kind: 'count', zh: '日程密度', en: 'Calendar load' },
];

const META = new Map(COLUMNS.map((c) => [c.key, c]));

/** 检测输入用的列三元组(key/domain/kind),投递层复用同一列表。 */
export const CROSS_REGION_COLUMNS = COLUMNS.map((c) => ({ key: c.key, domain: c.domain, kind: c.kind }));

/** 列的展示名(投递层成句复用,避免重复列表)。 */
export function columnLabel(key: string, zh: boolean): string {
  return labelOf(key, zh);
}

export interface CrossRegionInsight {
  /** 稳定 id(去重/冷却用):两列 + 类型,无序 */
  id: string;
  kind: 'corr' | 'cooccur' | 'leadlag';
  strength: number;
  pValue: number;
  n: number;
  differenced: boolean;
  sensitive: boolean;
  headline: string;
  detail: string;
  /** 证据小字:样本量 + p + 差分标记 */
  evidence: string;
}

function labelOf(key: string, zh: boolean): string {
  const m = META.get(key);
  if (!m) return key;
  return zh ? m.zh : m.en;
}

function pText(p: number): string {
  if (p < 0.001) return 'p<0.001';
  return `p=${p.toFixed(3)}`;
}

function strengthWord(abs: number, zh: boolean): string {
  if (abs >= 0.7) return zh ? '强' : 'strong';
  if (abs >= 0.5) return zh ? '中等' : 'moderate';
  return zh ? '弱但可留意' : 'weak but notable';
}

/**
 * 生成跨区洞察(按强度降序)。调用前保证 journal 就位(幂等)。
 * @param locale 'zh' | 其它=en
 * @param backfillDays 参与检测的历史窗口
 */
export function buildCrossRegionInsights(locale = 'zh', backfillDays = 90): CrossRegionInsight[] {
  const zh = locale === 'zh';
  ensureFactJournal(backfillDays);
  const rows = readFactJournal(400);
  if (rows.length < DETECT_DEFAULTS.minN) return [];

  const rels = detectCrossRegion(
    rows,
    COLUMNS.map((c) => ({ key: c.key, domain: c.domain, kind: c.kind })),
  ) as Array<{
    kind: 'corr' | 'cooccur';
    a: string;
    b: string;
    strength: number;
    pValue: number;
    n: number;
    differenced: boolean;
  }>;

  return rels.map((r) => {
    const la = labelOf(r.a, zh);
    const lb = labelOf(r.b, zh);
    const positive = r.strength >= 0;
    const sensitive = Boolean(META.get(r.a)?.sensitive || META.get(r.b)?.sensitive);
    const absS = Math.abs(r.strength);
    const sword = strengthWord(absS, zh);

    let headline: string;
    let detail: string;
    if (r.kind === 'cooccur') {
      headline = zh
        ? `${la} 与 ${lb} 常同时出现`
        : `${la} and ${lb} tend to co-occur`;
      detail = zh
        ? `有 ${la} 的日子往往也有 ${lb}(共现 φ=${r.strength})。相关不代表因果。`
        : `Days with ${la} often also have ${lb} (co-occurrence φ=${r.strength}). Correlation is not causation.`;
    } else {
      const dir = zh
        ? positive ? '同向' : '反向'
        : positive ? 'move together' : 'move opposite';
      const changeWord = r.differenced
        ? (zh ? '变化' : 'day-to-day changes')
        : (zh ? '水平' : 'levels');
      headline = zh
        ? `${la} 与 ${lb} 呈${sword}${positive ? '正' : '负'}相关`
        : `${la} and ${lb} are ${sword}ly ${positive ? 'positively' : 'negatively'} correlated`;
      detail = zh
        ? `最近这段时间,两者的${changeWord}${dir}(ρ=${r.strength})。相关不代表因果。`
        : `Over this window their ${changeWord} ${dir} (ρ=${r.strength}). Correlation is not causation.`;
    }

    const evidence = zh
      ? `${r.n} 天数据 · ${pText(r.pValue)}${r.differenced ? ' · 已平稳化(看变化)' : ''}`
      : `${r.n} days · ${pText(r.pValue)}${r.differenced ? ' · stationarized (changes)' : ''}`;

    const [k1, k2] = [r.a, r.b].sort();
    return {
      id: `${k1}~${k2}~${r.kind}`,
      kind: r.kind,
      strength: r.strength,
      pValue: r.pValue,
      n: r.n,
      differenced: r.differenced,
      sensitive,
      headline,
      detail,
      evidence,
    };
  });
}

/**
 * 生成先后线索(P1.5 lead-lag)。「X 变化 → 约 k 天后 Y 跟着变」——先后不等于因果,
 * 文案明示。同样只配跨域列、平稳化 + BH-FDR + 滞后须强于同期。
 */
export function buildLeadLagInsights(locale = 'zh', backfillDays = 90): CrossRegionInsight[] {
  const zh = locale === 'zh';
  ensureFactJournal(backfillDays);
  const rows = readFactJournal(400);
  if (rows.length < DETECT_DEFAULTS.minN + 1) return [];

  const rels = detectLeadLag(
    rows,
    COLUMNS.map((c) => ({ key: c.key, domain: c.domain, kind: c.kind })),
  ) as Array<{
    leader: string; follower: string; a: string; b: string;
    lag: number; strength: number; pValue: number; n: number; differenced: boolean;
  }>;

  return rels.map((r) => {
    const lead = labelOf(r.leader, zh);
    const foll = labelOf(r.follower, zh);
    const sensitive = Boolean(META.get(r.a)?.sensitive || META.get(r.b)?.sensitive);
    const positive = r.strength >= 0;
    const [k1, k2] = [r.a, r.b].sort();
    const headline = zh
      ? `${lead} 变化后约 ${r.lag} 天,${foll} 常跟着变`
      : `${foll} tends to shift ~${r.lag}d after ${lead}`;
    const detail = zh
      ? `数据里 ${lead} 的变化领先 ${foll} 约 ${r.lag} 天(${positive ? '同向' : '反向'},ρ=${r.strength})。这是先后线索,不是因果证明。`
      : `${lead} changes lead ${foll} by ~${r.lag}d (${positive ? 'same' : 'opposite'} direction, ρ=${r.strength}). A lead-lag hint, not proof of causation.`;
    const evidence = zh
      ? `${r.n} 天数据 · 滞后 ${r.lag} 天 · ${pText(r.pValue)}${r.differenced ? ' · 已平稳化' : ''}`
      : `${r.n} days · lag ${r.lag}d · ${pText(r.pValue)}${r.differenced ? ' · stationarized' : ''}`;
    return {
      id: `${k1}~${k2}~leadlag`,
      kind: 'leadlag',
      strength: r.strength,
      pValue: r.pValue,
      n: r.n,
      differenced: r.differenced,
      sensitive,
      headline,
      detail,
      evidence,
    };
  });
}
