'use client';

/**
 * DormantReviewCard — 休眠任务复访判断卡(每日一张)。
 * 从 FocusSection 拆出;无共享状态,动作全部经 props 回调。
 * 三种形态:软归档复活 / 过期有日期任务 / 普通休眠(带搁置次数升级提示)。
 */

import { getReviewTier, type DormantCandidate } from '@/lib/platform/dormant-engine';
import { t } from '@/lib/portal/i18n';
import { usePortalLocale } from '../use-portal-locale';

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
  const locale = usePortalLocale();
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
            <span className="nesio-dormant-question">{t(locale, 'dormantSoftArchiveQuestion')}</span>
            <span className="nesio-collapsed-title">{name}</span>
          </div>
        </div>
        <div className="nesio-collapsed-overdue-actions">
          <button type="button" onClick={onDo}>{t(locale, 'dormantPickUpAgain')}</button>
          <button type="button" className="nesio-dormant-btn--primary" onClick={onFinalize}>{t(locale, 'dormantFinalize')}</button>
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
              {dueDateStr ? t(locale, 'dormantOverdueQuestionTemplate', { date: dueDateStr }) : t(locale, 'dormantOverdueQuestionNoDate')}
            </span>
            <span className="nesio-collapsed-title">{name}</span>
          </div>
        </div>
        <div className="nesio-collapsed-overdue-actions">
          <button type="button" onClick={onDo}>{t(locale, 'dormantStillDo')}</button>
          <button type="button" onClick={onSnooze}>{t(locale, 'dormantLater')}</button>
          <button type="button" onClick={onArchive}>{t(locale, 'dormantLetGo')}</button>
        </div>
      </li>
    );
  }

  // ── 普通休眠任务（带升级提示） ───────────────────────────────────────────────
  const question =
    tier === 'letting-go'   ? t(locale, 'dormantLettingGoTemplate', { count: rec.snoozeCount }) :
    tier === 'gentle-nudge' ? t(locale, 'dormantGentleNudgeTemplate', { count: rec.snoozeCount }) :
                              t(locale, 'dormantDefaultQuestion');

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
            <button type="button" className="nesio-dormant-btn--primary" onClick={onArchive}>{t(locale, 'dormantLetGo')}</button>
            <button type="button" onClick={onSnooze}>{t(locale, 'dormantWaitMore')}</button>
            <button type="button" onClick={onDo}>{t(locale, 'dormantDoNow')}</button>
          </>
        ) : (
          <>
            <button type="button" onClick={onDo}>{t(locale, 'dormantDoNow')}</button>
            <button type="button" onClick={onSnooze}>{t(locale, 'dormantLater')}</button>
            <button type="button" onClick={onArchive}>{t(locale, 'dormantLetGo')}</button>
          </>
        )}
      </div>
    </li>
  );
}
