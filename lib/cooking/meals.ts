/**
 * meals — 「进食事件」原语(记一餐)。吃了 ≠ 做了 —— 一餐是身体账本求和的原子。
 * **就是一条「记忆」节点**(note,tag 一餐),items/来源/营养/时间 JSON 存 attributes。复用 addLifeNode,
 * 随生活图谱上你自己的云、可搜、和别的记忆一视同仁。不建独立竖井、不建 Supabase 表。
 */
import { addLifeNode, getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';

const TAG = '一餐';
export type MealSource = '自己做' | '餐厅' | '外卖' | '其他';
export interface MealItem { name: string; grams?: number }
export interface Meal {
  id: string;
  source: MealSource;
  items: MealItem[];
  energyKCal: number; protein: number; fat: number; cho: number;
  occurredAt: string;   // 'YYYY-MM-DD'(真正吃的日子,身体账本按此归日)
}

function parse(n: LifeNode): Meal | null {
  try {
    const a = n.attributes || {};
    const items = JSON.parse(String(a.items ?? '[]'));
    return {
      id: n.id, source: (a.source as MealSource) || '其他',
      items: Array.isArray(items) ? items : [],
      energyKCal: Number(a.energyKCal) || 0, protein: Number(a.protein) || 0, fat: Number(a.fat) || 0, cho: Number(a.cho) || 0,
      occurredAt: String(a.occurredAt || (n.createdAt || '').slice(0, 10)),
    };
  } catch { return null; }
}

/** 记一餐:落一条「一餐」记忆节点(喂身体账本)。返回节点 id。 */
export function addMeal(m: Omit<Meal, 'id'>): string {
  const title = m.items.map((i) => i.name).filter(Boolean).slice(0, 3).join(' · ') || '一餐';
  const node = addLifeNode({
    type: 'note', name: title, source: 'manual', confidence: 1, relations: [], tags: [TAG],
    attributes: {
      items: JSON.stringify(m.items), source: m.source,
      energyKCal: String(m.energyKCal), protein: String(m.protein), fat: String(m.fat), cho: String(m.cho),
      occurredAt: m.occurredAt,
    },
  });
  return node.id;
}

/** 读全部一餐(新到旧),给身体账本/时间轴求和。 */
export function getMeals(): Meal[] {
  return getLifeGraph()
    .filter((n) => n.type === 'note' && (n.tags || []).includes(TAG))
    .map(parse)
    .filter((m): m is Meal => m != null)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}
