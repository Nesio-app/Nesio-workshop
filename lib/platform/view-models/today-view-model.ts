import { generateTodayCards } from '../../intelligence';
import type { Signal } from '../../life-domain/signal';
import { getLifeGraph, getRecentNodes, type LifeNode } from '../../portal/life-graph';
import type { RecommendationCard } from '../../portal/reasoning-engine';

/** Slimmed-down shape the Today surface needs for focus cards (no raw LifeNode exposure). */
export interface FocusNode {
  id: string;
  name: string;
  type: string;
  rawInput?: string;
  createdAt: string;
  attributes: Record<string, string | number | boolean | null>;
}

const FOCUS_TIME_WORDS = ['生日', '会议', '截止', '复诊', '今天', '明天', '后天', '本周', '这周', 'deadline', 'birthday', 'meeting', '到期', '提醒'];

function isFocusNode(node: LifeNode): boolean {
  const text = [node.name, node.rawInput || ''].join(' ').toLowerCase();
  if (FOCUS_TIME_WORDS.some((w) => text.includes(w))) return true;
  if (node.type === 'commitment' || node.type === 'event') return true;
  for (const v of Object.values(node.attributes)) {
    if (typeof v === 'string') {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime()) && d > new Date() && d < new Date(Date.now() + 30 * 86_400_000)) return true;
    }
  }
  return false;
}

export function focusTimeHint(node: FocusNode): string {
  const now = new Date();
  for (const v of Object.values(node.attributes)) {
    if (typeof v === 'string') {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime()) && d > now) {
        const days = Math.round((d.getTime() - now.getTime()) / 86_400_000);
        if (days === 0) return '今天';
        if (days === 1) return '明天';
        if (days <= 7) return `${days} 天后`;
        if (days <= 30) return `约 ${Math.round(days / 7)} 周后`;
        return `${days} 天后`;
      }
    }
  }
  const text = [node.name, node.rawInput || ''].join(' ').toLowerCase();
  if (text.includes('今天')) return '今天';
  if (text.includes('明天')) return '明天';
  const hours = (now.getTime() - new Date(node.createdAt).getTime()) / 3_600_000;
  if (hours < 24) return '刚记录';
  return '';
}

export interface TodayViewModel {
  readonly cards: RecommendationCard[];
  readonly memoryCount: number;
  readonly memoryNotes: readonly string[];
  readonly focusNodes: readonly FocusNode[];
}

export function buildTodayViewModel(input: {
  canUsePrivateData: boolean;
  fallbackCards: readonly RecommendationCard[];
  cloudSignals?: readonly Signal[];
}): TodayViewModel {
  if (!input.canUsePrivateData) {
    return {
      cards: [...input.fallbackCards],
      memoryCount: 0,
      memoryNotes: [],
      focusNodes: [],
    };
  }

  const cloudSignals = input.cloudSignals?.length ? [...input.cloudSignals] : [];
  const cards = generateTodayCards(cloudSignals.length ? { signals: cloudSignals } : undefined);
  const nodes = getRecentNodes(5);

  const focusNodes: FocusNode[] = getLifeGraph()
    .filter(isFocusNode)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)
    .map((n) => ({ id: n.id, name: n.name, type: n.type, rawInput: n.rawInput, createdAt: n.createdAt, attributes: n.attributes }));

  return {
    cards: cards.length > 0 ? cards : [...input.fallbackCards],
    memoryCount: cloudSignals.length || getRecentNodes().length,
    memoryNotes: cloudSignals.length ? cloudSignals.slice(0, 5).map((s) => s.title) : nodes.map((n) => n.name),
    focusNodes,
  };
}
