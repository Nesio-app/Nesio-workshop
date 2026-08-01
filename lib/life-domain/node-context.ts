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
import { classifyDomainFromText } from './context-extractor';

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

/**
 * 2026-08-01 用户点名:大多数节点根本没走 extractContext(只有语音捕获这一条路调用它,
 * 见 VoiceInputSheet.tsx)—— 照片/邮件/连接器同步/银行流水等全部落进下面粗粒度的
 * TYPE_DOMAIN(所有 object 一律 assets、所有 event 一律 growth,不看内容)。这里在
 * type 兜底**之前**插一道关键词判据,复用同一张表(与 extractContext 同源,不重复维护),
 * 让已经存在的大多数节点也能被内容判出更准的 domain,而不是只靠类型硬猜。
 */
export function nodeDomain(node: LifeNode): FrontDomain | null {
  const ctx = readNodeContext(node);
  if (ctx?.domain && ctx.domain in DOMAINS) return ctx.domain;
  const text = [node.name, node.rawInput, (node.tags || []).join(' ')].filter(Boolean).join(' ');
  const byKeyword = text ? classifyDomainFromText(text) : null;
  if (byKeyword) return byKeyword;
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
