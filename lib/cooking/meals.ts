/**
 * meals — 「进食事件」原语(记一餐)。吃了 ≠ 做了 —— 一餐是身体账本求和的原子。
 * **就是一条「记忆」节点**(note,tag 一餐),items/来源/营养/时间 JSON 存 attributes。复用 addLifeNode,
 * 随生活图谱上你自己的云、可搜、和别的记忆一视同仁。不建独立竖井、不建 Supabase 表。
 */
import { getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';

const TAG = '一餐';
export type MealSource = '自己做' | '餐厅' | '外卖' | '其他';
export interface MealItem { name: string; grams?: number }
export interface Meal {
  id: string;
  source: MealSource;
  items: MealItem[];
  energyKCal: number; protein: number; fat: number; cho: number;
  occurredAt: string;   // 'YYYY-MM-DD'(真正吃的日子,身体账本按此归日)
  /**
   * 这一餐花了多少(正数,可空 —— 自己做的饭没有单笔价格)。
   *
   * **不自动记一笔支出**:在外面吃是刷卡的,Plaid 已经有那条流水,再记一笔就是双计。
   * 这个字段的用途是让这一餐能去**认领**银行里的那笔钱(receiptMatchCandidates),
   * 认领之后「这顿饭花了多少」才是一个能回答的问题 —— 在这之前它永远答不上来,
   * 因为 addMeal 根本没有金额(2026-07-30 R2 审计的结论)。
   */
  price?: number;
  currency?: string;
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
      // 写进去要读得回来 —— 只写不读的字段等于没写(而且会让人以为存下了)
      ...(a.price != null && Number.isFinite(Number(a.price)) ? { price: Number(a.price) } : {}),
      ...(a.currency ? { currency: String(a.currency) } : {}),
    };
  } catch { return null; }
}

/** 记一餐:落一条「一餐」记忆节点(喂身体账本)。返回节点 id。 */
export function addMeal(m: Omit<Meal, 'id'>): string {
  const title = m.items.map((i) => i.name).filter(Boolean).slice(0, 3).join(' · ') || '一餐';
  const node = ingestLifeNode({
    type: 'note', name: title, source: 'manual', confidence: 1, relations: [], tags: [TAG],
    attributes: {
      items: JSON.stringify(m.items), source: m.source,
      energyKCal: String(m.energyKCal), protein: String(m.protein), fat: String(m.fat), cho: String(m.cho),
      occurredAt: m.occurredAt,
      ...(typeof m.price === 'number' && Number.isFinite(m.price) && m.price > 0
        ? { price: Math.round(m.price * 100) / 100, ...(m.currency ? { currency: m.currency } : {}) }
        : {}),
      epistemic: 'observation',
      generator: 'user',
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
