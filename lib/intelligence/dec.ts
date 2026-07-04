/**
 * DEC — Decision Engine (PRD Ch.36 / v3.0).
 *
 * ⚠️ 命名消歧:与 lib/portal/dec-data-*(运营数据目录 API)无关,
 * 那是另一个 "DEC"。详见 STATE.md 命名词典。
 *
 * The cross-domain reasoning center. Belongs to no single domain. It does NOT
 * hold rules anymore — it discovers Domain Engines from the registry, gathers
 * their recommendation candidates, then applies platform governance:
 * health-aware degrade → confidence threshold → feedback filter → attention
 * budget → evidence gate.
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

/** Confidence Threshold (§2.2). Below this, a card never reaches Today. */
const CONFIDENCE_FLOOR = 0.6;

/** Attention Budget (§2.1). Today shows at most 3 cards. */
const TODAY_CARD_BUDGET = 3;

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
    .sort((a, b) => scoreCard(b) - scoreCard(a))
    // Attention Budget:末位淘汰，首页最多 3 张。
    .slice(0, TODAY_CARD_BUDGET);

  // Canonical recommendations, gated on evidence (PRD: no evidence → not Today).
  const recommendations = cards.map(cardToRecommendation).filter(hasEvidence);
  lifeState.recommendedGuidanceIds = recommendations.map((r) => r.id);

  return { lifeState, cards, recommendations, health };
}

/** Backward-compatible: existing Today UI consumes view-model cards. */
export function generateTodayCards(input: DECInput = {}): RecommendationCard[] {
  return runDEC(input).cards;
}
