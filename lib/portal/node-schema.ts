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
    // 批次197:机票/行程确认 → subtype=flight。抽出起飞时间(=start)+ 航班号/始发到达/PNR,
    // 下游按 flight 走 48h/26h/4h 值机窗(action-window.ts)。
    { key: 'subtype', hint: 'flight(机票时用)' },
    { key: 'flightNo', hint: '航班号,如 CA1234' },
    { key: 'from', hint: '始发机场/城市' },
    { key: 'to', hint: '到达机场/城市' },
    { key: 'pnr', hint: '订座编号' },
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
    // 批次197:证件(护照/签证/驾照/身份证)与保修 → subtype 标类,expiry=到期日/保修截止,
    // 下游按 renewal 提前半年催续办/趁保送修(action-window.ts)。
    { key: 'subtype', hint: 'passport/visa/license/id/warranty(证件或保修时)' },
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
  // 批次 143:note = 外部笔记软件/收藏(Notion / Flomo / 微信收藏…)的正文型记忆。
  // 正文走 rawInput/article,关键信息只留最小几项;preference 不再当笔记垃圾桶。
  note: [
    { key: 'category', hint: '' },
    { key: 'sourceApp', hint: 'notion/flomo/wechat/web' },
    { key: 'date', hint: 'ISO' },
    { key: 'url', hint: '' },
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
