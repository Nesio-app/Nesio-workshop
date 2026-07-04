/**
 * Email Signal Engine — platform-layer email classification.
 *
 * Classifies email subject lines into actionable signals using regex rules.
 * No AI, no async, no HTTP — pure classification logic.
 *
 * Designed for 20-min polling: cheap, fast, privacy-respecting (no body read).
 * Other surfaces (Daily Brief, proactive card pipeline, widgets) can import
 * the same rules without duplicating them.
 */

import { LEXICON } from './keyword-lexicon';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EmailSignal {
  id: string;
  type: string;
  subject: string;
  from: string;
  date: string;
  icon: string;
  cardTitle: string;
  cardBody: string;
  priority: number; // 1–10, higher = more urgent
}

// ── Classification rules ──────────────────────────────────────────────────────

interface SignalRule {
  type: string;
  icon: string;
  priority: number;
  subjectRe: RegExp;
  fromRe?: RegExp;
  makeCard: (subject: string, from: string) => { title: string; body: string };
}

export const EMAIL_SIGNAL_RULES: SignalRule[] = [
  {
    type: 'flight',
    icon: '✈️',
    priority: 9,
    subjectRe: LEXICON.flight,
    makeCard: (subject) => ({
      title: '机票已确认',
      body: `"${subject.slice(0, 28)}" — 记得提前2小时到机场，核对证件。`,
    }),
  },
  {
    type: 'hotel',
    icon: '🏨',
    priority: 8,
    subjectRe: LEXICON.travel,
    makeCard: (subject) => ({
      title: '住宿已预订',
      body: `"${subject.slice(0, 28)}" — 出发前确认入住时间和地址。`,
    }),
  },
  {
    type: 'package',
    icon: '📦',
    priority: 7,
    subjectRe: LEXICON.package,
    makeCard: (subject) => ({
      title: '有快递待签收',
      body: `"${subject.slice(0, 28)}" — 注意查收或安排代收。`,
    }),
  },
  {
    type: 'appointment',
    icon: '📅',
    priority: 9,
    subjectRe: LEXICON.appointment,
    makeCard: (subject) => ({
      title: '预约/面试提醒',
      body: `"${subject.slice(0, 28)}" — 提前确认时间和地点，备好材料。`,
    }),
  },
  {
    type: 'deadline',
    icon: '⏰',
    priority: 8,
    subjectRe: LEXICON.deadline,
    makeCard: (subject) => ({
      title: '有截止日期提醒',
      body: `"${subject.slice(0, 28)}" — 检查是否需要今天处理。`,
    }),
  },
  {
    type: 'bill',
    icon: '💳',
    priority: 7,
    subjectRe: LEXICON.bill,
    makeCard: (subject) => ({
      title: '账单/扣款提醒',
      body: `"${subject.slice(0, 28)}" — 确认余额是否充足。`,
    }),
  },
  {
    type: 'verification',
    icon: '🔑',
    priority: 6,
    subjectRe: LEXICON.verification,
    makeCard: () => ({
      title: '验证码邮件',
      body: '收到验证邮件，需要的话及时处理（验证码通常有效期短）。',
    }),
  },
  {
    type: 'reminder',
    icon: '🔔',
    priority: 6,
    subjectRe: LEXICON.reminder,
    makeCard: (subject) => ({
      title: '邮件提醒',
      body: `"${subject.slice(0, 28)}" — 查看详情确认是否需要操作。`,
    }),
  },
];

// ── Classifier ────────────────────────────────────────────────────────────────

export function classifyEmailSubject(subject: string, from: string): SignalRule | null {
  for (const rule of EMAIL_SIGNAL_RULES) {
    if (!rule.subjectRe.test(subject)) continue;
    if (rule.fromRe && !rule.fromRe.test(from)) continue;
    return rule;
  }
  return null;
}

// ── Signal builder (used by API route after fetching metadata) ────────────────

export function buildEmailSignal(
  msgId: string,
  subject: string,
  from: string,
  date: string,
): EmailSignal | null {
  const rule = classifyEmailSubject(subject, from);
  if (!rule) return null;
  const { title, body } = rule.makeCard(subject, from);
  return {
    id: `${rule.type}-${msgId}`,
    type: rule.type,
    subject,
    from,
    date,
    icon: rule.icon,
    cardTitle: title,
    cardBody: body,
    priority: rule.priority,
  };
}
