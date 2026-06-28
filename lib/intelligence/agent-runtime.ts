import type { RecommendationCard } from '../portal/reasoning-engine';
import { checkPlatformHealth } from './platform-health';
import { DEC_SANDBOX_PAIRS } from './dec';
import { getAgent, getAgents } from './agent-registry';
import type {
  AgentRunInput,
  AgentRunResult,
  AgentRuntimeContext,
  AgentToolKey,
  DomainAgent,
} from './agent-contracts';

const REQUIRED_STAGE4_TOOLS: readonly AgentToolKey[] = [
  'read_signals',
  'read_life_state',
  'emit_recommendation_candidate',
];

function sandboxAllows(pair: readonly [string, string]): boolean {
  return DEC_SANDBOX_PAIRS.some(([a, b]) =>
    (a === pair[0] && b === pair[1]) || (a === pair[1] && b === pair[0]),
  );
}

function blocked(agentId: string, reason: string, sandboxPair?: readonly [string, string]): AgentRunResult {
  return {
    agentId,
    status: 'blocked',
    cards: [],
    audit: {
      sandboxPair,
      usedTools: [],
      evidenceSignalIds: [],
      reason,
    },
  };
}

function validateAgent(agent: DomainAgent): string | null {
  if (agent.promptPolicy.mode !== 'bounded-template') return 'unsupported_prompt_policy';
  if (agent.promptPolicy.promptInjectionAllowed) return 'prompt_injection_not_allowed';
  if (agent.promptPolicy.rawUserDataAllowed) return 'raw_user_data_not_allowed';
  if (agent.promptPolicy.externalToolCallsAllowed) return 'external_tool_calls_not_allowed';
  if (!REQUIRED_STAGE4_TOOLS.every((tool) => agent.allowedTools.includes(tool))) {
    return 'missing_required_runtime_tools';
  }
  if (agent.sandboxPair && !sandboxAllows(agent.sandboxPair)) return 'sandbox_pair_not_allowed';
  return null;
}

function normalizeResult(agent: DomainAgent, result: AgentRunResult): AgentRunResult {
  const allowed = new Set(agent.allowedTools);
  const usedTools = result.audit.usedTools.filter((tool) => allowed.has(tool));
  const cards = result.cards.filter((card) => card.evidence.length > 0);
  return {
    ...result,
    status: cards.length > 0 ? result.status : result.status === 'blocked' ? 'blocked' : 'silent',
    cards,
    audit: {
      ...result.audit,
      sandboxPair: agent.sandboxPair,
      usedTools,
      evidenceSignalIds: Array.from(new Set(result.audit.evidenceSignalIds)),
    },
  };
}

export function runAgent(
  agentId: string,
  ctx: AgentRuntimeContext,
  input: AgentRunInput = { purpose: 'today_guidance' },
): AgentRunResult {
  const agent = getAgent(agentId);
  if (!agent) return blocked(agentId, 'unknown_agent');
  const validationError = validateAgent(agent);
  if (validationError) return blocked(agent.id, validationError, agent.sandboxPair);
  if (ctx.degraded || checkPlatformHealth().degraded) {
    return blocked(agent.id, 'platform_degraded', agent.sandboxPair);
  }
  return normalizeResult(agent, agent.run(ctx, input));
}

export function runAgentsForToday(ctx: AgentRuntimeContext): RecommendationCard[] {
  return getAgents()
    .filter((agent) => agent.lifecycle !== 'deprecated')
    .flatMap((agent) => runAgent(agent.id, ctx, { purpose: 'today_guidance' }).cards);
}

export function inspectAgentRuntime() {
  const agents = getAgents();
  const entries = agents.map((agent) => ({
    agentId: agent.id,
    domain: agent.domain,
    version: agent.version,
    lifecycle: agent.lifecycle,
    sandboxPair: agent.sandboxPair || null,
    allowedTools: [...agent.allowedTools],
    promptPolicy: { ...agent.promptPolicy },
    validationError: validateAgent(agent),
  }));
  return {
    version: 'agent-runtime-v0',
    implementation: 'bounded-local-runtime',
    agentCount: entries.length,
    entries,
    boundaries: {
      agentToAgentDirectCallsAllowed: false,
      promptInjectionAllowed: false,
      rawUserDataAllowed: false,
      externalToolCallsAllowed: false,
      memoryInjection: 'evidence_summary_only',
      sandboxPairs: DEC_SANDBOX_PAIRS.map((pair) => [...pair]),
    },
  };
}
