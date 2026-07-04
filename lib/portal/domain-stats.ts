/**
 * Domain Stats — shared "count nodes per life domain" aggregation.
 *
 * memory-narrator's activity card and WrappedCard each counted domains their
 * own way (WrappedCard even kept a private keyword classifier with its own
 * five-domain taxonomy). Both now use the canonical nodeDomain() + DOMAINS
 * taxonomy through this helper.
 */

import type { LifeNode } from './life-graph';
import { nodeDomain } from '@/lib/life-domain';
import { DOMAINS, type FrontDomain } from '@/lib/life-domain/domain-taxonomy';

export interface DomainCount {
  domain: FrontDomain;
  label: string;
  icon: string;
  count: number;
}

/** Nodes-per-domain, sorted by count desc. Nodes with no domain are skipped. */
export function countByDomain(nodes: readonly LifeNode[]): DomainCount[] {
  const counts = new Map<FrontDomain, number>();
  for (const n of nodes) {
    const d = nodeDomain(n);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([domain, count]) => ({
      domain,
      label: DOMAINS[domain]?.label ?? domain,
      icon: DOMAINS[domain]?.icon ?? '·',
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

/** The single most active domain, or null when nothing is classified. */
export function topDomain(nodes: readonly LifeNode[]): DomainCount | null {
  return countByDomain(nodes)[0] ?? null;
}
