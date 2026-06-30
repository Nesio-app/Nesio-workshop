/**
 * Signal Context (Domain-Capability PRD v1 §4.5 / §7).
 *
 * Context is the structured semantics ON a Signal — who / when / where / what
 * goal / what state. The user-visible form is a Label; the system form is
 * signal.context. AI may only SUGGEST context; it becomes trusted only after
 * the user confirms (§6.2). The provenance flags record that.
 */

import type { FrontDomain } from './domain-taxonomy';

export interface ContextConfidence {
  ai: number;            // AI-suggested confidence 0-1
  userConfirmed: boolean;
  userEdited: boolean;
}

export interface SignalContext {
  domain?: FrontDomain;
  secondaryDomains?: FrontDomain[];
  labels?: string[];
  people?: string[];
  places?: string[];
  objects?: string[];
  time?: string;
  role?: string;
  goal?: string;
  state?: string;
  /** find_later | remind | schedule | log | reflect … */
  intent?: string;
  confidence?: ContextConfidence;
}

export function emptyContext(): SignalContext {
  return {};
}

/** A context is "useful" once it carries at least a domain or one entity. */
export function hasContext(ctx: SignalContext | undefined): boolean {
  if (!ctx) return false;
  return Boolean(
    ctx.domain ||
    ctx.people?.length ||
    ctx.places?.length ||
    ctx.objects?.length ||
    ctx.labels?.length,
  );
}
