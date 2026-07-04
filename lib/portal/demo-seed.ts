/**
 * Demo Seed — 未登录/空库时的示例数据(只读,永不写入 localStorage)。
 *
 * 收纳工具早有完整 demo 契约(inventory-first-launch-contract);主 Portal
 * 此前没有 —— 游客看到的是全空界面,听简报点了直接跳登录(网页测试问题 #1)。
 * 这份种子让游客在 30 秒内看懂「扔进来 → 找得到 → 自己冒出来」三件事。
 *
 * 约定:id 以 demo- 开头,tags 含 'demo'。任何写路径都必须拒绝 demo 节点。
 */

import type { LifeNode } from './life-graph';

function daysAgo(n: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function daysAhead(n: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export const DEMO_SEED_NODES: LifeNode[] = [
  {
    id: 'demo-keys',
    type: 'object',
    name: '备用钥匙',
    source: 'manual',
    confidence: 1,
    createdAt: daysAgo(12),
    attributes: { location: '玄关抽屉第二层', note: '和车库遥控放在一起' },
    tags: ['demo', '物品'],
    rawInput: '备用钥匙放在玄关抽屉第二层',
    relations: [],
  },
  {
    id: 'demo-gift',
    type: 'commitment',
    name: '给 Linda 准备生日礼物',
    source: 'manual',
    confidence: 1,
    createdAt: daysAgo(5),
    attributes: { dueDate: daysAhead(5), owner: '我', priority: 'medium' },
    tags: ['demo', '生日', '提醒'],
    rawInput: 'Linda 生日快到了,她喜欢蓝色的东西',
    relations: [],
  },
  {
    id: 'demo-linda',
    type: 'person',
    name: 'Linda',
    source: 'manual',
    confidence: 1,
    createdAt: daysAgo(5),
    attributes: { category: 'friend', birthday: daysAhead(5), note: '喜欢蓝色' },
    tags: ['demo', '朋友'],
    rawInput: 'Linda 喜欢蓝色的东西',
    relations: [],
  },
  {
    id: 'demo-review',
    type: 'event',
    name: '产品评审会',
    source: 'manual',
    confidence: 1,
    createdAt: daysAgo(1),
    attributes: { start: daysAhead(1, 10), location: '会议室 B', participants: '产品组' },
    tags: ['demo', '会议'],
    rawInput: '明天上午十点产品评审会,提前整理三个重点',
    relations: [],
  },
  {
    id: 'demo-med',
    type: 'health_state',
    name: '维生素 D 还剩半瓶',
    source: 'manual',
    confidence: 1,
    createdAt: daysAgo(3),
    attributes: { healthType: 'medication', note: '放在厨房第二层' },
    tags: ['demo', '健康'],
    rawInput: '维生素D还剩半瓶,放在厨房第二层',
    relations: [],
  },
  {
    id: 'demo-cafe',
    type: 'place',
    name: '巷口咖啡馆',
    source: 'manual',
    confidence: 1,
    createdAt: daysAgo(8),
    attributes: { category: 'restaurant', note: '下午人少,写东西效率高' },
    tags: ['demo', '地点'],
    rawInput: '巷口那家咖啡馆下午人少,写东西效率很高',
    relations: [],
  },
];

export function isDemoNode(node: { id?: string; tags?: string[] }): boolean {
  return Boolean(node.id?.startsWith('demo-')) || Boolean(node.tags?.includes('demo'));
}
