/**
 * 可打断性接线(cross-region-reasoning.md §2.4)——把反馈日志喂进 NB,给「现在合不合适
 * 被打扰」打分。纯逻辑在 interruptibility-core.mjs。
 *
 * 训练样本 = 今天面(surface==='today')上的引导卡反馈:useful/done → 受纳,
 * dismiss/wrong/too_much → 拒绝。情境由反馈时间戳还原(时段 + 星期类型);活动态
 * 历史不可靠回溯,训练取 'unknown',预测时用足迹当天是否有移动补上(present-only 特征,
 * NB 对未训练值走 Laplace 中性,不伤判别)。
 */

import { readFeedbackLog } from '@/lib/platform/personalization';
const localDayKey = (d: Date = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // 本地日键(vm 测试壳 stub require,lib 层内联不 import)
import { loadPlaceTrail } from '@/lib/portal/place-trail';
import {
  trainInterruptibility, predictAccept, contextFromTime, INTERRUPTIBILITY_DEFAULTS,
} from './interruptibility-core.mjs';

const ACCEPT = new Set(['useful', 'done']);
const REJECT = new Set(['dismiss', 'wrong', 'too_much']);

/** 当天是否有移动(足迹最近点在今天且有位移)→ 'active' / 'still' / 'unknown'。 */
function currentActivity(now: Date): string {
  try {
    const trail = loadPlaceTrail() as Array<{ at?: string; lat?: number; lon?: number }>;
    if (!Array.isArray(trail) || trail.length < 2) return 'unknown';
    const today = localDayKey(now);
    const todayPts = trail.filter((p) => String(p.at || '').slice(0, 10) === today && p.lat != null);
    if (todayPts.length === 0) return 'unknown';
    if (todayPts.length >= 2) {
      const a = todayPts[todayPts.length - 2];
      const b = todayPts[todayPts.length - 1];
      const moved = Math.abs((a.lat ?? 0) - (b.lat ?? 0)) + Math.abs((a.lon ?? 0) - (b.lon ?? 0));
      return moved > 0.002 ? 'active' : 'still'; // ~200m 量级
    }
    return 'still';
  } catch { return 'unknown'; }
}

/**
 * P(现在被打扰会被受纳)。用于跨区主动投递的可打断性门(非 critical 须 ≥ 阈)。
 * 样本不足 → 冷启动先验(默认 0.6 ≥ 0.5,先放行,攒够反馈再收紧)。
 */
export function currentAcceptProbability(now: Date = new Date()): number {
  const samples = readFeedbackLog()
    .filter((e) => e.surface === 'today' && (ACCEPT.has(e.reaction) || REJECT.has(e.reaction)))
    .map((e) => ({ ctx: contextFromTime(new Date(e.at), 'unknown'), accepted: ACCEPT.has(e.reaction) }));
  const model = trainInterruptibility(samples);
  return predictAccept(contextFromTime(now, currentActivity(now)), model);
}

export { INTERRUPTIBILITY_DEFAULTS };
