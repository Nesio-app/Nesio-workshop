import {
  type AgentRunInput,
  type AgentRunResult,
  type AgentRuntimeContext,
  STAGE4_DEFAULT_PROMPT_POLICY,
} from './agent-contracts';
import { registerAgent } from './agent-registry';
import { runEnergyCalendarAgentCore } from './energy-calendar-agent-core.mjs';

function runEnergyCalendarAgent(ctx: AgentRuntimeContext, _input: AgentRunInput): AgentRunResult {
  return runEnergyCalendarAgentCore(ctx) as unknown as AgentRunResult;
}

registerAgent({
  id: 'energy-calendar-agent',
  domain: 'energy-calendar',
  version: 1,
  lifecycle: 'labs',
  sandboxPair: ['health', 'calendar'],
  allowedTools: ['read_signals', 'read_life_state', 'emit_recommendation_candidate'],
  promptPolicy: STAGE4_DEFAULT_PROMPT_POLICY,
  run: runEnergyCalendarAgent,
});
