import type { RecommendationCard } from '../portal/reasoning-engine';
import type { DECContext, DomainEngine } from './contracts';

export const DEC_SANDBOX_PAIRS = [
  ['health', 'calendar'],
  ['health', 'weather'],
  ['task', 'calendar'],
] as const;

export type DECSandboxPair = typeof DEC_SANDBOX_PAIRS[number];
export type DECPolicyKind =
  | 'single_domain'
  | 'two_domain'
  | 'three_domain_lab_only'
  | 'user_confirmed_cross_domain'
  | 'agent_action';

export interface DECEvidencePolicy {
  id: string;
  kind?: DECPolicyKind;
  requiredEvidenceDomains: string[];
  maxDomains: number;
  riskTier: 'low' | 'medium' | 'high_trust';
  silenceWhenMissingEvidence: boolean;
  requiresUserConfirmation?: boolean;
  labOnly?: boolean;
  agentActionAllowed?: boolean;
}

export const DEC_POLICY_REGISTRY: DECEvidencePolicy[] = [
  {
    id: 'single-domain-observation',
    kind: 'single_domain',
    requiredEvidenceDomains: [],
    maxDomains: 1,
    riskTier: 'low',
    silenceWhenMissingEvidence: false,
  },
  ...DEC_SANDBOX_PAIRS.map((pair) => ({
    id: `${pair[0]}:${pair[1]}`,
    kind: 'two_domain' as const,
    requiredEvidenceDomains: [...pair],
    maxDomains: 2,
    riskTier: (pair as readonly string[]).includes('health') ? 'high_trust' as const : 'medium' as const,
    silenceWhenMissingEvidence: true,
  })),
  {
    id: 'lab-three-domain-synthesis',
    kind: 'three_domain_lab_only',
    requiredEvidenceDomains: ['health', 'calendar', 'task'],
    maxDomains: 3,
    riskTier: 'high_trust',
    silenceWhenMissingEvidence: true,
    labOnly: true,
  },
  {
    id: 'user-confirmed-cross-domain',
    kind: 'user_confirmed_cross_domain',
    requiredEvidenceDomains: [],
    maxDomains: 4,
    riskTier: 'high_trust',
    silenceWhenMissingEvidence: true,
    requiresUserConfirmation: true,
  },
  {
    id: 'agent-action-execution',
    kind: 'agent_action',
    requiredEvidenceDomains: [],
    maxDomains: 2,
    riskTier: 'high_trust',
    silenceWhenMissingEvidence: true,
    requiresUserConfirmation: true,
    agentActionAllowed: false,
  },
];

export const DEC_EVIDENCE_POLICIES: DECEvidencePolicy[] = DEC_POLICY_REGISTRY.filter((policy) => policy.kind === 'two_domain');

export function sandboxAllows(pair: readonly [string, string]): boolean {
  return DEC_SANDBOX_PAIRS.some(([a, b]) =>
    (a === pair[0] && b === pair[1]) || (a === pair[1] && b === pair[0]),
  );
}

export function signalMatchesDomain(ctx: DECContext, domain: string): boolean {
  if (domain === 'calendar') return ctx.signals.some((s) => s.source === 'calendar' && s.type === 'event');
  if (domain === 'health') return ctx.signals.some((s) => s.source === 'health' || s.sensitivity === 'health');
  if (domain === 'weather') return ctx.signals.some((s) => s.source === 'weather') || Boolean(ctx.weather);
  if (domain === 'task') return ctx.signals.some((s) => s.source === 'task' || String(s.type).startsWith('task.'));
  return ctx.signals.some((s) => s.source === domain);
}

export function sandboxHasEvidence(ctx: DECContext, pair: readonly [string, string]): boolean {
  return signalMatchesDomain(ctx, pair[0]) && signalMatchesDomain(ctx, pair[1]);
}

export function policyHasEvidence(ctx: DECContext, policy: DECEvidencePolicy): boolean {
  return policy.requiredEvidenceDomains.every((domain) => signalMatchesDomain(ctx, domain));
}

export function policyForPair(pair: readonly [string, string]): DECEvidencePolicy | null {
  return DEC_EVIDENCE_POLICIES.find((policy) =>
    policy.requiredEvidenceDomains.length === 2 &&
    sandboxAllows([policy.requiredEvidenceDomains[0], policy.requiredEvidenceDomains[1]]) &&
    sandboxAllows(pair) &&
    pair.every((domain) => policy.requiredEvidenceDomains.includes(domain)),
  ) || null;
}

export function canRunDomain(engine: DomainEngine, ctx: DECContext): boolean {
  if (!engine.crossDomain) return true;
  if (ctx.degraded) return false;
  if (!engine.sandboxPair) return false;
  const policy = policyForPair(engine.sandboxPair);
  if (!policy) return false;
  return sandboxAllows(engine.sandboxPair) && (!policy.silenceWhenMissingEvidence || policyHasEvidence(ctx, policy));
}

export function cardEvidenceSignalIds(card: RecommendationCard): string[] {
  return Array.from(new Set([
    ...(card.evidenceSignalIds || []),
    ...card.evidence.map((e) => e.signalId).filter((id): id is string => Boolean(id)),
  ]));
}

export function withEvidenceSignalIds(card: RecommendationCard): RecommendationCard {
  return { ...card, evidenceSignalIds: cardEvidenceSignalIds(card) };
}

export function cardHasSignalEvidence(card: RecommendationCard): boolean {
  return cardEvidenceSignalIds(card).length > 0;
}
