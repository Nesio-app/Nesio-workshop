/**
 * Domain Capability Contracts (PRD v3.0 §3.2).
 *
 * The fine-grained, atomized capability interfaces a Domain Engine implements.
 * A Domain composes only what it can deliver — early domains implement just one
 * contract; deep ones compose more. This keeps the platform from forcing a
 * god-interface onto every domain.
 *
 * Stage 2 (Implementation Thin): only InsightContract has real implementations
 * today (domains produce Today recommendations). SignalContract / ActionContract
 * / SimulationContract are deliberately NOT defined yet — they enter main only
 * when a real implementation arrives (§6.2: no empty-interface placeholders).
 */

import type { Signal } from '../life-domain/signal';
import type { LifeState } from '../life-domain/life-state';
import type { RecommendationCard } from '../portal/reasoning-engine';

/** Minimal weather view — Intelligence must not depend on the Integration layer's
 *  WeatherSnapshot DTO. The DEC normalizes the cached snapshot into this. */
export interface WeatherView {
  temperatureC: number;
  condition: string;
  forecastNote?: string;
}

/** Everything a Domain Engine needs to reason. Read-only; domains never mutate. */
export interface DECContext {
  signals: readonly Signal[];
  lifeState: LifeState;
  weather: WeatherView | null;
  /** True when platform health is degraded — cross-domain engines must stand down. */
  degraded: boolean;
}

/**
 * InsightContract (§3.2) — a Domain Engine that turns context into Today
 * recommendation candidates. The DEC discovers and invokes these instead of
 * hard-coding rules, so adding a domain never touches DEC/Today logic (§28.7).
 */
export interface DomainEngine {
  /** Stable domain id: 'weather' | 'work' | 'health' | 'family' | 'state' ... */
  readonly domain: string;
  /** Capability version (evolution-contract framework; multi-version mounting
   *  is intentionally NOT built yet — only the version tag is reserved). */
  readonly version: number;
  /** Cross-domain engines are gated on platform health (§4.2 sandbox). */
  readonly crossDomain?: boolean;
  /** Declared two-domain sandbox pair when crossDomain — must fit DEC_SANDBOX_PAIRS. */
  readonly sandboxPair?: readonly [string, string];
  /** Produce candidate cards. Pure: same context → same output. */
  provideInsights(ctx: DECContext): RecommendationCard[];
}
