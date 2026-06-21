import React from 'react';

export interface ReminderItem {
  /** Soft category eyebrow, e.g. 重要日期 / 下一步. */
  kind?: string;
  text: string;
  /** Defaults to gentle. Use risk only for real expiry/safety. */
  status?: 'go' | 'gentle' | 'calm' | 'risk';
  /** Label for the primary, doable action. Defaults to 轻轻处理. */
  action?: string;
}

export interface ReminderCardProps {
  title?: string;
  subtitle?: string;
  items?: ReminderItem[];
  onAct?: (item: ReminderItem) => void;
  onSkip?: (item: ReminderItem) => void;
  onLater?: (item: ReminderItem) => void;
  style?: React.CSSProperties;
}

/**
 * "陪你看见" — gentle AI/DB reminders; one small step, always an escape.
 * @startingPoint section="Portal" subtitle="Warm-coach reminder module" viewport="700x320"
 */
export function ReminderCard(props: ReminderCardProps): JSX.Element;
