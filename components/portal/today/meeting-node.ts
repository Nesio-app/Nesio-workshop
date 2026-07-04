/**
 * Meeting-node helpers — shared by TodayFeed and the focus/recorder sheets.
 */

import type { FocusNode } from '@/lib/platform/view-models/today-view-model';

// ---- Meeting helpers ----

const MEETING_KEYWORDS = ['会议', 'meeting', '视频会', '电话会', '面试', 'standup', '周会', '月会', '汇报', '面谈', '1on1', '同步'];

export function isMeetingNode(node: FocusNode): boolean {
  if (node.type === 'event') return true;
  const text = [node.name, node.rawInput || ''].join(' ').toLowerCase();
  return MEETING_KEYWORDS.some((kw) => text.includes(kw));
}

export function getMeetingTime(node: FocusNode): Date | null {
  for (const v of Object.values(node.attributes)) {
    if (typeof v === 'string') {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

export function safeExternalUrl(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('zoommtg://')) return url.replace('zoommtg://', 'https://');
  return `https://${url}`;
}

export function getMeetingUrl(node: FocusNode): string | null {
  const urlLike = Object.values(node.attributes).find(
    (v) => typeof v === 'string' && (v.startsWith('http') || v.startsWith('zoom') || v.includes('meet.'))
  );
  return typeof urlLike === 'string' ? safeExternalUrl(urlLike) : null;
}

