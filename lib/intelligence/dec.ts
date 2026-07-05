/**
 * DEC — Decision Engine (PRD Ch.36 / v3.0).
 *
 * ⚠️ 命名消歧:与 lib/portal/dec-data-*(运营数据目录 API)无关,
 * 那是另一个 "DEC"。详见 STATE.md 命名词典。
 *
 * The cross-domain reasoning center. Belongs to no single domain. It does NOT
 * hold rules anymore — it discovers Domain Engines from the registry, gathers
 * their recommendation candidates, then applies platform governance:
 * health-aware degrade → confidence threshold → feedback filter → evidence gate.
 *
 * 注意力预算不在这里:DEC 输出经 decCardsToGuidanceEvents 汇入 guidance 管线,
 * 由那里统一仲裁「首页最多 3 张」(单一预算,PRD TODAY-003)。DEC 不再自设
 * 第二个 slice(0,3) —— 否则强候选可能在到达全局仲裁前就被上游预算截掉。
 *
 * Adding a domain never touches this file (§28.7). The rules now live with
 * their domains in ./domains.ts.
 */

import {
  type RecommendationCard,
  scoreCard,
  readCardFeedbackAll,
} from '../portal/reasoning-engine';
import { PORTAL_CACHE_KEYS, readPortalCache } from '../portal/prefetch-cache';
import type { WeatherSnapshot } from '../portal/weather';
import { getRecentSignals, type Signal } from '../life-domain/signal';
import { computeLifeState, type LifeState } from '../life-domain/life-state';
import {
  cardToRecommendation,
  hasEvidence,
  type Recommendation,
} from '../life-domain/recommendation';
import { checkPlatformHealth, type PlatformHealth } from './platform-health';
import { getDomains } from './registry';
import type { DECContext, WeatherView } from './contracts';
import {
  DEC_SANDBOX_PAIRS,
  canRunDomain,
  cardHasSignalEvidence,
  withEvidenceSignalIds,
} from './dec-policy';
import './domains'; // side-effect: registers the Domain Engines

// ── Governance guardrails (PRD v3.0 Stage 1) ────────────────────────────────

/**
 * Confidence Threshold (§2.2):DEC 侧的**硬门**,0–1 刻度,低于此的推荐物理上到不了
 * Today。注意与 guidance 管线里的置信**软权重**(0–100,占 interrupt 分 15%)区分:
 * 这里是"够不够格进候选",那里是"进了候选之后排多前"——两者刻度/职责不同,不是重复。
 */
const CONFIDENCE_FLOOR = 0.6;

export { DEC_SANDBOX_PAIRS };

function toWeatherView(w: WeatherSnapshot | null): WeatherView | null {
  if (!w) return null;
  return { temperatureC: w.temperatureC, condition: w.condition, forecastNote: w.forecastNote };
}

// ── DEC entry point ──────────────────────────────────────

export interface DECOutput {
  lifeState: LifeState;
  cards: RecommendationCard[];
  recommendations: Recommendation[];
  health: PlatformHealth;
}

export interface DECInput {
  signals?: readonly Signal[];
}

export function runDEC(input: DECInput = {}): DECOutput {
  const weather = readPortalCache<WeatherSnapshot>(PORTAL_CACHE_KEYS.weather);
  const signals = input.signals?.length ? [...input.signals] : getRecentSignals();
  const lifeState = computeLifeState();
  const health = checkPlatformHealth();

  const ctx: DECContext = {
    signals,
    lifeState,
    weather: toWeatherView(weather),
    degraded: health.degraded,
  };

  // Discover domains; gather candidates. Cross-domain engines stand down when
  // platform health is degraded (§4.2), their sandbox pair isn't allowed, or
  // the two domains do not both have traceable Signal evidence.
  const candidates = getDomains()
    .filter((d) => canRunDomain(d, ctx))
    .flatMap((d) => d.provideInsights(ctx));

  const feedback = readCardFeedbackAll();
  const cards = candidates
    .map(withEvidenceSignalIds)
    .filter(cardHasSignalEvidence)
    // Confidence Threshold: physically degrade low-confidence guesses.
    .filter((c) => c.confidence >= CONFIDENCE_FLOOR)
    .filter((c) => {
      const fb = feedback[c.id];
      if (!fb) return true;
      if (fb.feedback === 'too_much' || fb.feedback === 'useful') return false;
      if (fb.feedback === 'not_now') return Date.now() - new Date(fb.at).getTime() > 4 * 3_600_000;
      return true;
    })
    // 排序给出确定性次序;不再在此截断——首页「最多 3 张」由 guidance 管线统一仲裁。
    .sort((a, b) => scoreCard(b) - scoreCard(a));

  // Canonical recommendations, gated on evidence (PRD: no evidence → not Today).
  const recommendations = cards.map(cardToRecommendation).filter(hasEvidence);
  lifeState.recommendedGuidanceIds = recommendations.map((r) => r.id);

  return { lifeState, cards, recommendations, health };
}

/** Backward-compatible: existing Today UI consumes view-model cards. */
export function generateTodayCards(input: DECInput = {}): RecommendationCard[] {
  return runDEC(input).cards;
}
