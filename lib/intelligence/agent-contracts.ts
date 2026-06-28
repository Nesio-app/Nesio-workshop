import type { Signal } from '../life-domain/signal';
import type { LifeState } from '../life-domain/life-state';
import type { RecommendationCard } from '../portal/reasoning-engine';
import type { WeatherView } from './contracts';

export type AgentLifecycle = 'experimental' | 'labs' | 'preview' | 'stable' | 'deprecated';
export type AgentToolKey =
  | 'read_signals'
  | 'read_life_state'
  | 'read_weather_view'
  | 'emit_recommendation_candidate';

export interface AgentPromptPolicy {
  readonly mode: 'bounded-template';
  readonly promptInjectionAllowed: false;
  readonly rawUserDataAllowed: false;
  readonly externalToolCallsAllowed: false;
  readonly memoryInjectionAllowed: 'none' | 'evidence_summary_only';
}

export interface AgentRuntimeContext {
  readonly signals: readonly Signal[];
  readonly lifeState: LifeState;
  readonly weather: WeatherView | null;
  readonly degraded: boolean;
}

export interface AgentRunInput {
  readonly purpose: 'today_guidance' | 'evidence_explanation' | 'action_proposal';
  readonly locale?: 'zh' | 'en';
}

export interface AgentRunResult {
  readonly agentId: string;
  readonly status: 'success' | 'silent' | 'blocked';
  readonly cards: RecommendationCard[];
  readonly audit: {
    readonly sandboxPair?: readonly [string, string];
    readonly usedTools: readonly AgentToolKey[];
    readonly evidenceSignalIds: readonly string[];
    readonly reason: string;
  };
}

export interface DomainAgent {
  readonly id: string;
  readonly domain: string;
  readonly version: number;
  readonly lifecycle: AgentLifecycle;
  readonly sandboxPair?: readonly [string, string];
  readonly allowedTools: readonly AgentToolKey[];
  readonly promptPolicy: AgentPromptPolicy;
  run(ctx: AgentRuntimeContext, input: AgentRunInput): AgentRunResult;
}

export const STAGE4_DEFAULT_PROMPT_POLICY: AgentPromptPolicy = Object.freeze({
  mode: 'bounded-template',
  promptInjectionAllowed: false,
  rawUserDataAllowed: false,
  externalToolCallsAllowed: false,
  memoryInjectionAllowed: 'evidence_summary_only',
});
