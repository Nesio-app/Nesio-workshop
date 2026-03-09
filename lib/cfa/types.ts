export type CFALevel = 'L1' | 'L2' | 'L3';

export type TopicArea =
  | 'Ethical and Professional Standards'
  | 'Quantitative Methods'
  | 'Economics'
  | 'Financial Statement Analysis'
  | 'Corporate Issuers'
  | 'Equity Investments'
  | 'Fixed Income'
  | 'Derivatives'
  | 'Alternative Investments'
  | 'Portfolio Management'
  | 'Wealth Planning';

export interface Question {
  id: string;
  level: CFALevel;
  topic: TopicArea;
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
  source?: string;
}

export interface AnswerRecord {
  questionId: string;
  correct: boolean;
  timestamp: number;
  selectedIndex: number;
}

export interface WrongQuestion extends Question {
  wrongCount: number;
  lastWrongAt: number;
  notionSynced?: boolean;
}

export interface PracticeStats {
  totalAnswered: number;
  totalCorrect: number;
  byTopic: Record<string, { answered: number; correct: number }>;
  byLevel: Record<CFALevel, { answered: number; correct: number }>;
  streak: number;
  lastPracticeAt: number | null;
}

export interface VideoItem {
  id: string;
  title: string;
  url: string;
  duration?: string;
  topic?: TopicArea;
  thumbnail?: string;
}

export interface LibraryItem {
  id: string;
  title: string;
  type: 'pdf' | 'note' | 'formula' | 'summary';
  topic?: TopicArea;
  keywords: string[];
  url?: string;
  description?: string;
}
