import type { DomainAgent } from './agent-contracts';

const agentRegistry = new Map<string, DomainAgent>();

export function registerAgent(agent: DomainAgent): void {
  agentRegistry.set(agent.id, agent);
}

export function getAgent(id: string): DomainAgent | undefined {
  return agentRegistry.get(id);
}

export function getAgents(): DomainAgent[] {
  return Array.from(agentRegistry.values());
}

export function clearAgentRegistryForTests(): void {
  agentRegistry.clear();
}
