/**
 * Intelligence Layer (PRD Ch.3.1) — unified AI reasoning.
 *
 * The DEC (Decision Engine) is the cross-domain reasoning center. Pages must
 * not call providers directly; all reasoning enters through here.
 *
 * Stage 4 foundation: Domain Agents run through a bounded Agent Runtime.
 * Runtime stays fail-closed: no prompt injection, no raw user data, no external
 * tool calls, and no agent-to-agent direct calls.
 */

import './agents';

export * from './dec';
export * from './platform-health';
export * from './contracts';
export * from './registry';
export * from './agent-contracts';
export * from './agent-registry';
export * from './agent-runtime';
