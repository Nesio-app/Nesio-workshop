/**
 * Read a Memory node's front-stage Domain + Context (Domain-Capability PRD v1 §4–7).
 *
 * createSignal() stores the structured SignalContext as a JSON string in the
 * LifeNode attribute `context`. Memory consumes it here to surface the Domain
 * (财物 / 生活 / …) and its entities, without reaching into raw payloads.
 *
 * When a node predates Context extraction (e.g. a photo node written straight
 * through addLifeNode), we fall back to a type-based Domain so nothing is
 * invisible — an object lands in 财物, a place/person in 生活, etc.
 */

import type { LifeNode } from '../portal/life-graph';
import { DOMAINS, type FrontDomain } from './domain-taxonomy';
import type { SignalContext } from './context';

export function readNodeContext(node: LifeNode): SignalContext | null {
  const raw = node.attributes?.context;
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as SignalContext;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Type-based salvage when a node carries no explicit context.domain. */
const TYPE_DOMAIN: Record<string, FrontDomain> = {
  object: 'assets',
  place: 'life',
  person: 'life',
  event: 'growth',
  commitment: 'growth',
  health_state: 'health',
  preference: 'life',
};

export function nodeDomain(node: LifeNode): FrontDomain | null {
  const ctx = readNodeContext(node);
  if (ctx?.domain && ctx.domain in DOMAINS) return ctx.domain;
  return TYPE_DOMAIN[node.type] ?? null;
}

/** Distinct entity chips (people / places / objects) for a node, capped. */
export function nodeContextChips(node: LifeNode, limit = 4): string[] {
  const ctx = readNodeContext(node);
  if (!ctx) return [];
  const chips = [
    ...(ctx.people || []),
    ...(ctx.places || []),
    ...(ctx.objects || []),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(chips)).slice(0, limit);
}
