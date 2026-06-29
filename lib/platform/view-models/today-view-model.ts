import { generateTodayCards } from '../../intelligence';
import { getRecentNodes } from '../../portal/life-graph';
import type { RecommendationCard } from '../../portal/reasoning-engine';

export interface TodayViewModel {
  readonly cards: RecommendationCard[];
  readonly memoryCount: number;
  readonly memoryNotes: readonly string[];
}

export function buildTodayViewModel(input: {
  canUsePrivateData: boolean;
  fallbackCards: readonly RecommendationCard[];
}): TodayViewModel {
  if (!input.canUsePrivateData) {
    return {
      cards: [...input.fallbackCards],
      memoryCount: 0,
      memoryNotes: [],
    };
  }

  const cards = generateTodayCards();
  const nodes = getRecentNodes(5);
  return {
    cards: cards.length > 0 ? cards : [...input.fallbackCards],
    memoryCount: getRecentNodes().length,
    memoryNotes: nodes.map((node) => node.name),
  };
}
