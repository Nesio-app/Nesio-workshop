/**
 * Node Schema — the single source of truth for LifeNode's standard
 * attribute keys per type.
 *
 * Before this file, the "schema" only existed inside AI prompts: code that
 * read attributes had no reference for which keys are canonical, which is
 * how dates ended up scattered across nine ad-hoc keys. The extraction
 * prompt (lib/extraction) is now GENERATED from this table, so prompt and
 * code can't drift apart again.
 */

import type { LifeNodeType } from './life-graph';

export interface AttributeSpec {
  key: string;
  /** Short hint rendered into the extraction prompt. */
  hint: string;
}

export const NODE_ATTRIBUTE_SCHEMA: Record<LifeNodeType, AttributeSpec[]> = {
  commitment: [
    { key: 'dueDate', hint: 'ISO' },
    { key: 'priority', hint: 'high/medium/low' },
    { key: 'owner', hint: '' },
    { key: 'recurring', hint: '' },
    { key: 'done', hint: '' },
  ],
  event: [
    { key: 'start', hint: 'ISO' },
    { key: 'end', hint: 'ISO' },
    { key: 'location', hint: '' },
    { key: 'url', hint: '' },
    { key: 'participants', hint: '' },
  ],
  person: [
    { key: 'category', hint: 'family/colleague/friend' },
    { key: 'lastSeen', hint: '' },
    { key: 'birthday', hint: 'ISO' },
    { key: 'note', hint: '' },
  ],
  object: [
    { key: 'location', hint: '' },
    { key: 'purchaseDate', hint: '' },
    { key: 'price', hint: '' },
    { key: 'expiry', hint: 'ISO' },
    { key: 'note', hint: '' },
  ],
  place: [
    { key: 'address', hint: '' },
    { key: 'category', hint: 'work/home/shopping/school/restaurant' },
    { key: 'note', hint: '' },
  ],
  health_state: [
    { key: 'healthType', hint: 'medication/appointment/fitness/sleep/diet' },
    { key: 'date', hint: 'ISO' },
    { key: 'value', hint: '' },
    { key: 'unit', hint: '' },
  ],
  preference: [
    { key: 'category', hint: '' },
    { key: 'note', hint: '' },
  ],
};

export const NODE_TYPES = Object.keys(NODE_ATTRIBUTE_SCHEMA) as LifeNodeType[];

/** "commitment: dueDate (ISO), priority (high/medium/low), owner, …" */
export function renderAttributeSchemaLines(): string {
  return NODE_TYPES
    .map((type) => {
      const keys = NODE_ATTRIBUTE_SCHEMA[type]
        .map((a) => (a.hint ? `${a.key} (${a.hint})` : a.key))
        .join(', ');
      return `- ${type}: ${keys}`;
    })
    .join('\n');
}

/** Canonical keys for one type — for validators and normalizers. */
export function standardKeysFor(type: LifeNodeType): string[] {
  return (NODE_ATTRIBUTE_SCHEMA[type] ?? []).map((a) => a.key);
}
