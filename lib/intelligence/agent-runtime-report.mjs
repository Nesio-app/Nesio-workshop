const STAGE4_AGENT_RUNTIME_VERSION = 'agent-runtime-v0';

const STAGE4_ALLOWED_SANDBOX_PAIRS = Object.freeze([
  Object.freeze(['health', 'calendar']),
  Object.freeze(['health', 'weather']),
  Object.freeze(['task', 'calendar']),
]);

const STAGE4_AGENT_ENTRIES = Object.freeze([
  Object.freeze({
    agentId: 'energy-calendar-agent',
    domain: 'energy-calendar',
    version: 1,
    lifecycle: 'labs',
    sandboxPair: Object.freeze(['health', 'calendar']),
    allowedTools: Object.freeze(['read_signals', 'read_life_state', 'emit_recommendation_candidate']),
    promptPolicy: Object.freeze({
      mode: 'bounded-template',
      promptInjectionAllowed: false,
      rawUserDataAllowed: false,
      externalToolCallsAllowed: false,
      memoryInjectionAllowed: 'evidence_summary_only',
    }),
    blockedReason: null,
  }),
]);

function sandboxAllowed(pair) {
  return STAGE4_ALLOWED_SANDBOX_PAIRS.some(([a, b]) =>
    (a === pair?.[0] && b === pair?.[1]) || (a === pair?.[1] && b === pair?.[0]),
  );
}

function blockedReasonForAgent(agent) {
  if (!agent.sandboxPair || !sandboxAllowed(agent.sandboxPair)) return 'sandbox_pair_not_allowed';
  if (agent.promptPolicy.promptInjectionAllowed) return 'prompt_injection_not_allowed';
  if (agent.promptPolicy.rawUserDataAllowed) return 'raw_user_data_not_allowed';
  if (agent.promptPolicy.externalToolCallsAllowed) return 'external_tool_calls_not_allowed';
  if (!agent.allowedTools.includes('emit_recommendation_candidate')) return 'missing_recommendation_tool';
  return null;
}

export function buildAgentRuntimeReportV0() {
  const entries = STAGE4_AGENT_ENTRIES.map((agent) => ({
    ...agent,
    sandboxPair: [...agent.sandboxPair],
    allowedTools: [...agent.allowedTools],
    promptPolicy: { ...agent.promptPolicy },
    blockedReason: blockedReasonForAgent(agent),
  }));
  const blocked = entries.filter((entry) => entry.blockedReason);
  return {
    version: STAGE4_AGENT_RUNTIME_VERSION,
    implementation: 'bounded-local-agent-runtime',
    summary: {
      version: STAGE4_AGENT_RUNTIME_VERSION,
      agentCount: entries.length,
      activeAgentCount: entries.filter((entry) => !entry.blockedReason && entry.lifecycle !== 'deprecated').length,
      blockedAgentCount: blocked.length,
      sandboxPairCount: STAGE4_ALLOWED_SANDBOX_PAIRS.length,
      externalToolCallsEnabled: false,
      promptInjectionEnabled: false,
      rawMemoryInjectionEnabled: false,
      providerCallsFromRuntimeEnabled: false,
    },
    boundaries: {
      agentToAgentDirectCallsAllowed: false,
      externalToolExecutionAllowed: false,
      promptInjectionAllowed: false,
      rawUserDataAllowed: false,
      rawMemoryInjectionAllowed: false,
      unauditedProviderCallsAllowed: false,
      runtimeProviderCallsAllowed: false,
      stage5Enabled: false,
    },
    allowedSandboxPairs: STAGE4_ALLOWED_SANDBOX_PAIRS.map((pair) => [...pair]),
    agents: entries,
    blockedReasons: blocked.map((entry) => ({
      agentId: entry.agentId,
      blockedReason: entry.blockedReason,
    })),
    stage5Prerequisites: [
      'Agent Runtime report must stay visible in report:modules.',
      'At least one bounded Agent must pass runtime smoke with dual-domain evidence.',
      'External tool execution must have explicit audit, policy, timeout, and rollback contracts.',
      'Provider calls must route through audited provider runtime; no direct provider calls from agents.',
      'Raw memory injection must remain disabled until redaction and evidence-bundle policy are implemented.',
    ],
  };
}
