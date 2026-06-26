/**
 * Life Domain Layer (PRD Ch.3.1) — the cross-page core.
 *
 * Today, Memory, Voice and Mirror all share these objects. UI consumes the
 * Domain's view models; it does not reach into raw connector payloads.
 *
 * Phase 1 (current): Signal, Life State, Recommendation.
 * Phase 2 (next): Domain Agent, DEC, Platform Runtime.
 */

export * from './signal';
export * from './life-state';
export * from './recommendation';
