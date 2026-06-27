/**
 * DEC — Decision Engine (PRD Ch.36 / v3.0).
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
import { getRecentSignals } from '../life-domain/signal';
import { computeLifeState, type LifeState } from '../life-domain/life-state';
import {
  cardToRecommendation,
  hasEvidence,
  type Recommendation,
} from '../life-domain/recommendation';
import { checkPlatformHealth, type PlatformHealth } from './platform-health';
import { getDomains } from './registry';
import type { DECContext, WeatherView } from './contracts';
import './domains'; // side-effect: registers the Domain Engines

// ── Governance guardrails (PRD v3.0 Stage 1) ────────────────────────────────

/** Confidence Threshold (§2.2). Below this, a card never reaches Today. */
const CONFIDENCE_FLOOR = 0.6;

/** Attention Budget (§2.1). Today shows at most 3 cards. */
const TODAY_CARD_BUDGET = 3;

/** Two-Domain Constraint Sandbox (§4.2). The only cross-domain pairs DEC v1
 *  allows. Each cross-domain engine declares a sandboxPair that must be in here;
 *  widening the sandbox is a deliberate, reviewable change. */
export const DEC_SANDBOX_PAIRS = [
  ['health', 'calendar'],
  ['health', 'weather'],
  ['task', 'calendar'],
] as const;

function sandboxAllows(pair: readonly [string, string]): boolean {
  return DEC_SANDBOX_PAIRS.some(([a, b]) =>
    (a === pair[0] && b === pair[1]) || (a === pair[1] && b === pair[0]),
  );
}

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

export function runDEC(): DECOutput {
  const weather = readPortalCache<WeatherSnapshot>(PORTAL_CACHE_KEYS.weather);
  const signals = getRecentSignals();
  const lifeState = computeLifeState();
  const health = checkPlatformHealth();

  const ctx: DECContext = {
    signals,
    lifeState,
    weather: toWeatherView(weather),
    degraded: health.degraded,
  };

  // Discover domains; gather candidates. Cross-domain engines stand down when
  // platform health is degraded (§4.2) or their sandbox pair isn't allowed.
  const candidates = getDomains()
    .filter((d) => {
      if (!d.crossDomain) return true;
      if (ctx.degraded) return false;
      return d.sandboxPair ? sandboxAllows(d.sandboxPair) : true;
    })
    .flatMap((d) => d.provideInsights(ctx));

  const feedback = readCardFeedbackAll();
  const cards = candidates
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
export function generateTodayCards(): RecommendationCard[] {
  return runDEC().cards;
}
