/**
 * Intelligence Layer (PRD Ch.3.1) — unified AI reasoning.
 *
 * The DEC (Decision Engine) is the cross-domain reasoning center. Pages must
 * not call providers directly; all reasoning enters through here.
 *
 * Phase 1: DEC reads Signal + Life State, emits evidence-backed Recommendations.
 * Phase 2 (next): Domain Agents, Agent Runtime, prompt orchestration.
 */

export * from './dec';
export * from './platform-health';
export * from './contracts';
export * from './registry';
