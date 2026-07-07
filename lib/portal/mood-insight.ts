/**
 * 心情洞察 —— 在 此刻(MoodSheet)的情绪记录之上做确定性判定(A 计划 Layer 1,铺开·心情域)。
 *
 * 定位(引擎/知识分离):moment-analytics = 算法知识(CUSUM,Page 1954;Russell 效价),
 * 这里 = 判定层(声明式 RULES + domain-rules 通用运行时)。此前 cusumUpdate 全仓零消费
 * ——算法躺在库里、心情数据活着,判定层是缺的那根线。
 *
 * warm-coach 从严(情绪域最敏感):只出 attention、绝不出红;文案不评判、不下"抑郁"之类结论,
 * 只说"记录里连着偏低"并给出口;记录太少沉默(不凭 2 条记录断言状态)。
 * 无持久态:对最近窗口做确定性回放(CUSUM 自带 lastAlert 按天去重;Today 管线另有冷却)。
 */
import type { LifeNode } from './life-graph';
import { cusumUpdate, defaultCusumState, getRecentMoments } from './moment-analytics';
import { evaluateRules, type DomainRule, type RuleSeverity } from './domain-rules';

export interface MoodFinding {
  id: string;
  severity: RuleSeverity;
  title: [string, string];  // [zh, en]
  detail: [string, string];
}

export interface MoodInsightInput {
  nodes: LifeNode[];
  now: Date;
}

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 14;   // 只看最近两周
const MIN_RECORDS = 5;    // 记录太少不判(不凭两三条断言状态)
const MIN_DAYS = 3;       // 至少跨 3 天(单日情绪波动不算"一阵子")
const RECENT_ALERT_DAYS = 3; // 警报须落在最近 3 天,陈年警报不翻旧账

interface MomentRecord { emotion: string; at: string }

function recentMoodRecords(input: MoodInsightInput): MomentRecord[] {
  const cutoff = input.now.getTime() - WINDOW_DAYS * DAY_MS;
  return getRecentMoments(input.nodes, 60)
    .map((n) => ({
      emotion: (n.attributes?.emotion as string) ?? '',
      at: ((n.attributes?.recordedAt as string) ?? n.createdAt ?? ''),
    }))
    .filter((r) => {
      if (!r.emotion) return false;
      const t = Date.parse(r.at);
      return !Number.isNaN(t) && t >= cutoff && t <= input.now.getTime();
    })
    .sort((a, b) => a.at.localeCompare(b.at)); // 回放按时间正序
}

const RULES: ReadonlyArray<DomainRule<MoodInsightInput, MoodFinding>> = [
  // ── 情绪持续偏低(CUSUM):区分"今天不爽"和"这阵子一直往下" ────────────────────
  {
    id: 'mood-drift-cusum',
    run: (i) => {
      const records = recentMoodRecords(i);
      if (records.length < MIN_RECORDS) return null; // 记录太少,沉默
      const days = new Set(records.map((r) => r.at.slice(0, 10)));
      if (days.size < MIN_DAYS) return null;         // 未跨足天数,沉默

      // 确定性回放:从默认态按时间正序折入,记录每次警报落在哪一天(CUSUM 自带按天去重)。
      let state = defaultCusumState();
      let lastAlertAt: string | null = null;
      for (const r of records) {
        const res = cusumUpdate(state, r.emotion, r.at.slice(0, 10));
        state = res.state;
        if (res.alert) lastAlertAt = r.at;
      }
      if (!lastAlertAt) return null;
      const ageDays = (i.now.getTime() - Date.parse(lastAlertAt)) / DAY_MS;
      if (ageDays > RECENT_ALERT_DAYS) return null;  // 陈年警报不翻旧账

      return {
        severity: 'attention',
        title: ['最近的心情记录连着偏低了一阵', 'Your mood notes have been low for a stretch'],
        detail: [
          `近两周 ${records.length} 条「此刻」记录里,低落情绪在持续累积(CUSUM 持续性检测,非 AI、非诊断)。偶尔低落很正常;要是想聊聊或歇歇,都可以。`,
          `Across ${records.length} recent check-ins, low moods have been accumulating (CUSUM persistence check — not AI, not a diagnosis). Dips are normal; talking it out or taking a break both count.`,
        ],
      };
    },
  },
];

/** 心情域 findings 总入口(确定性;情绪域从严 —— 只轻观察,绝不出红)。 */
export function moodFindings(input: MoodInsightInput): MoodFinding[] {
  if (!input.nodes.length) return [];
  return evaluateRules(RULES, input);
}
