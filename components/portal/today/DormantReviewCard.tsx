'use client';

/**
 * DormantReviewCard — 休眠任务复访判断卡(每日一张)。
 * 从 FocusSection 拆出;无共享状态,动作全部经 props 回调。
 * 三种形态:软归档复活 / 过期有日期任务 / 普通休眠(带搁置次数升级提示)。
 */

import { getReviewTier, type DormantCandidate } from '@/lib/platform/dormant-engine';

export function DormantReviewCard({
  candidate,
  onDo,
  onSnooze,
  onArchive,
  onFinalize,
}: {
  candidate: DormantCandidate;
  onDo: () => void;
  onSnooze: () => void;
  onArchive: () => void;
  onFinalize: () => void;
}) {
  const { node, kind, rec } = candidate;
  const name = node.name.length > 22 ? node.name.slice(0, 22) + '…' : node.name;
  const tier = getReviewTier(rec.snoozeCount);

  // ── 软归档复活 ──────────────────────────────────────────────────────────────
  if (kind === 'soft-archive') {
    return (
      <li className="nesio-collapsed-item nesio-dormant-card nesio-dormant-card--soft-archive">
        <div className="nesio-collapsed-row">
          <span className="nesio-collapsed-icon">🕊️</span>
          <div className="nesio-dormant-content">
            <span className="nesio-dormant-question">你曾经放下了这件事</span>
            <span className="nesio-collapsed-title">{name}</span>
          </div>
        </div>
        <div className="nesio-collapsed-overdue-actions">
          <button type="button" onClick={onDo}>重新拾起</button>
          <button type="button" className="nesio-dormant-btn--primary" onClick={onFinalize}>彻底告别</button>
        </div>
      </li>
    );
  }

  // ── 过期有日期任务 ───────────────────────────────────────────────────────────
  if (kind === 'overdue') {
    const dueDateStr = rec.originalDueDate
      ? new Date(rec.originalDueDate).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
      : null;
    return (
      <li className="nesio-collapsed-item nesio-dormant-card nesio-dormant-card--overdue">
        <div className="nesio-collapsed-row">
          <span className="nesio-collapsed-icon">⏰</span>
          <div className="nesio-dormant-content">
            <span className="nesio-dormant-question">
              {dueDateStr ? `截止日（${dueDateStr}）已过，还想继续吗？` : '截止日期已过，还想继续吗？'}
            </span>
            <span className="nesio-collapsed-title">{name}</span>
          </div>
        </div>
        <div className="nesio-collapsed-overdue-actions">
          <button type="button" onClick={onDo}>还是要做</button>
          <button type="button" onClick={onSnooze}>以后再说</button>
          <button type="button" onClick={onArchive}>放下</button>
        </div>
      </li>
    );
  }

  // ── 普通休眠任务（带升级提示） ───────────────────────────────────────────────
  const question =
    tier === 'letting-go'   ? `已经搁置 ${rec.snoozeCount} 次了，建议为它做个决定` :
    tier === 'gentle-nudge' ? `已经搁置 ${rec.snoozeCount} 次了，这件事还是你的吗？` :
                              '这个还属于你吗？';

  return (
    <li className={`nesio-collapsed-item nesio-dormant-card${tier === 'letting-go' ? ' nesio-dormant-card--letting-go' : ''}`}>
      <div className="nesio-collapsed-row">
        <span className="nesio-collapsed-icon">🌿</span>
        <div className="nesio-dormant-content">
          <span className="nesio-dormant-question">{question}</span>
          <span className="nesio-collapsed-title">{name}</span>
        </div>
      </div>
      <div className="nesio-collapsed-overdue-actions">
        {tier === 'letting-go' ? (
          // 5次以上：放下变主按钮
          <>
            <button type="button" className="nesio-dormant-btn--primary" onClick={onArchive}>放下</button>
            <button type="button" onClick={onSnooze}>再等等</button>
            <button type="button" onClick={onDo}>现在做</button>
          </>
        ) : (
          <>
            <button type="button" onClick={onDo}>现在做</button>
            <button type="button" onClick={onSnooze}>以后再说</button>
            <button type="button" onClick={onArchive}>放下</button>
          </>
        )}
      </div>
    </li>
  );
}
