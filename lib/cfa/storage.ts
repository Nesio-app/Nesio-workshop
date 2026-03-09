'use client';

import type { AnswerRecord, WrongQuestion, PracticeStats } from './types';

const KEYS = {
  answers: 'cfa-answers',
  wrongQuestions: 'cfa-wrong-questions',
  stats: 'cfa-stats',
  notionUrl: 'cfa-notion-url',
} as const;

export function getAnswerRecords(): AnswerRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEYS.answers);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveAnswerRecord(record: AnswerRecord): void {
  const records = getAnswerRecords();
  records.push(record);
  localStorage.setItem(KEYS.answers, JSON.stringify(records));
}

export function getWrongQuestions(): WrongQuestion[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEYS.wrongQuestions);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addWrongQuestion(q: WrongQuestion): void {
  const list = getWrongQuestions();
  const existing = list.find((x) => x.id === q.id);
  if (existing) {
    existing.wrongCount += 1;
    existing.lastWrongAt = Date.now();
  } else {
    list.push({ ...q, wrongCount: 1, lastWrongAt: Date.now() });
  }
  localStorage.setItem(KEYS.wrongQuestions, JSON.stringify(list));
}

export function removeWrongQuestion(id: string): void {
  const list = getWrongQuestions().filter((x) => x.id !== id);
  localStorage.setItem(KEYS.wrongQuestions, JSON.stringify(list));
}

export function getPracticeStats(): PracticeStats {
  if (typeof window === 'undefined') {
    return {
      totalAnswered: 0,
      totalCorrect: 0,
      byTopic: {},
      byLevel: { L1: { answered: 0, correct: 0 }, L2: { answered: 0, correct: 0 }, L3: { answered: 0, correct: 0 } },
      streak: 0,
      lastPracticeAt: null,
    };
  }
  try {
    const raw = localStorage.getItem(KEYS.stats);
    if (!raw) {
      return {
        totalAnswered: 0,
        totalCorrect: 0,
        byTopic: {},
        byLevel: { L1: { answered: 0, correct: 0 }, L2: { answered: 0, correct: 0 }, L3: { answered: 0, correct: 0 } },
        streak: 0,
        lastPracticeAt: null,
      };
    }
    return JSON.parse(raw);
  } catch {
    return {
      totalAnswered: 0,
      totalCorrect: 0,
      byTopic: {},
      byLevel: { L1: { answered: 0, correct: 0 }, L2: { answered: 0, correct: 0 }, L3: { answered: 0, correct: 0 } },
      streak: 0,
      lastPracticeAt: null,
    };
  }
}

export function updatePracticeStats(
  topic: string,
  level: string,
  correct: boolean
): void {
  const stats = getPracticeStats();
  stats.totalAnswered += 1;
  stats.totalCorrect += correct ? 1 : 0;

  if (!stats.byTopic[topic]) {
    stats.byTopic[topic] = { answered: 0, correct: 0 };
  }
  stats.byTopic[topic].answered += 1;
  stats.byTopic[topic].correct += correct ? 1 : 0;

  if (stats.byLevel[level as keyof typeof stats.byLevel]) {
    stats.byLevel[level as keyof typeof stats.byLevel].answered += 1;
    stats.byLevel[level as keyof typeof stats.byLevel].correct += correct ? 1 : 0;
  }

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (stats.lastPracticeAt) {
    const daysSince = Math.floor((now - stats.lastPracticeAt) / day);
    if (daysSince === 0) stats.streak = (stats.streak || 0) + 1;
    else if (daysSince === 1) stats.streak = (stats.streak || 0) + 1;
    else stats.streak = 1;
  } else {
    stats.streak = 1;
  }
  stats.lastPracticeAt = now;

  localStorage.setItem(KEYS.stats, JSON.stringify(stats));
}

export function getNotionUrl(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(KEYS.notionUrl) || '';
}

export function setNotionUrl(url: string): void {
  localStorage.setItem(KEYS.notionUrl, url);
}
