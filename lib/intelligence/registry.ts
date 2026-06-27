/**
 * Capability Registry (PRD v3.0 §6.3, minimal).
 *
 * The platform's source of truth for which Domain Engines exist. The DEC
 * discovers domains here rather than importing them directly, so a new domain
 * is added by registering it — DEC and Today never change (§28.7).
 *
 * Keyed by domain id. The version tag is carried for the future evolution
 * contract, but multi-version concurrent mounting is intentionally not built
 * yet (Implementation Thin).
 */

import type { DomainEngine } from './contracts';

const registry = new Map<string, DomainEngine>();

export function registerDomain(engine: DomainEngine): void {
  registry.set(engine.domain, engine);
}

export function getDomains(): DomainEngine[] {
  return Array.from(registry.values());
}

export function getDomain(id: string): DomainEngine | undefined {
  return registry.get(id);
}
