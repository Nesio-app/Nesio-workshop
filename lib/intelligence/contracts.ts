/**
 * Domain Capability Contracts (PRD v3.0 §3.2).
 *
 * The fine-grained, atomized capability interfaces a Domain Engine implements.
 * A Domain composes only what it can deliver — early domains implement just one
 * contract; deep ones compose more. This keeps the platform from forcing a
 * god-interface onto every domain.
 *
 * Stage 3/4: the atomized contracts are now first-class. A domain advertises
 * exactly the capabilities it can actually serve; runtime registries can stay
 * thin while product/report layers stop guessing from implementation details.
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

export interface PlatformAction {
  readonly actionKey: string;
  readonly moduleId?: string;
  readonly payload?: Record<string, unknown>;
  readonly evidenceSignalIds?: readonly string[];
}

export interface ActionResult {
  readonly ok: boolean;
  readonly status: 'executed' | 'blocked' | 'deferred' | 'requires_approval';
  readonly message?: string;
  readonly evidenceSignalIds?: readonly string[];
}

export interface Scenario {
  readonly scenarioKey: string;
  readonly inputSignals?: readonly Signal[];
  readonly assumptions?: Record<string, unknown>;
}

export interface SimulationResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly evidenceSignalIds: readonly string[];
  readonly warnings?: readonly string[];
}

export interface DomainInsight {
  readonly id: string;
  readonly domain: string;
  readonly title: string;
  readonly body: string;
  readonly evidenceSignalIds: readonly string[];
}

export interface SignalContract {
  readonly contract: 'signal';
  publishSignals(input: unknown): Promise<Signal[]> | Signal[];
}

export interface ActionContract {
  readonly contract: 'action';
  executeAction(action: PlatformAction): Promise<ActionResult> | ActionResult;
}

/**
 * InsightContract (§3.2) — a Domain Engine that turns context into Today
 * recommendation candidates. The DEC discovers and invokes these instead of
 * hard-coding rules, so adding a domain never touches DEC/Today logic (§28.7).
 */
export interface InsightContract {
  readonly contract?: 'insight';
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

export interface SimulationContract {
  readonly contract: 'simulation';
  runSimulation(scenario: Scenario): Promise<SimulationResult> | SimulationResult;
}

export type DomainCapabilityContracts = Partial<{
  signal: SignalContract;
  action: ActionContract;
  insight: InsightContract;
  simulation: SimulationContract;
}>;

export type DomainEngine = InsightContract & {
  readonly capabilities?: DomainCapabilityContracts;
};
