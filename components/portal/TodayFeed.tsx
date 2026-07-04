'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PROFILE_UPDATED_EVENT, loadProfileSettings, portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { L } from '@/lib/portal/i18n';
import { IconThermometer } from './icons';
import { buildTodayViewModel, focusTimeHint, markFocusNodeDone, addCommitmentNode, addMeetingNotes, saveSubtasks, toggleSubtask, type FocusNode, type SubTask, type ProactiveContext, type ProactiveContextItem } from '@/lib/platform/view-models/today-view-model';
import type { CalendarEvent } from '@/lib/portal/types';
import {
  loadDormantStore, evaluateDormancy, selectReviewCandidate, applyReviewAction,
  touchNode, getReviewTier,
  type DormantStore, type DormantCandidate,
} from '@/lib/platform/dormant-engine';
import { runGuidancePipeline, TODAY_CARD_BUDGET } from '@/lib/platform/guidance-engine/guidance-pipeline';
import { recordCardFeedback, type EvidenceRef } from '@/lib/portal/reasoning-engine';
import { loadCoolingStore, recordDismissed, saveCoolingStore } from '@/lib/platform/guidance-engine/cooling-store';
import {
  calendarEventsToGuidanceEvents,
  emailSignalsToGuidanceEvents,
  specialDaysToGuidanceEvents,
  focusNodesToGuidanceEvents,
  weatherToGuidanceEvents,
  healthNodesToGuidanceEvents,
  type WeatherSnapshot,
  decCardsToGuidanceEvents,
} from '@/lib/platform/guidance-engine/source-adapters';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import DailyBriefCard from './DailyBriefCard';
import dynamic from 'next/dynamic';
import { buildRotatingFallback, dismissProactiveById, getProactiveCardBudget, isProactiveCardDismissed, type ProactiveCardData } from './today/proactive-types';
import { ProactiveGuidanceCard } from './today/ProactiveGuidanceCard';
import { ExperimentCheckinCard } from './today/ExperimentCheckinCard';
import { ThawedReminder } from './today/ThawedReminder';
import { TodayFocusSection } from './today/FocusSection';
import { NightTimeline } from './today/NightTimeline';
import { useTodayData } from './today/useTodayData';
import { FocusModeSheet } from './today/FocusModeSheet';
import { MeetingRecorderSheet } from './today/MeetingRecorderSheet';

// 1143-line analytics sheet — load on open, not at boot
const InsightsSheet = dynamic(() => import('./InsightsSheet'), { ssr: false });
import MemoryFlashBanner, { useMemoryFlash } from './MemoryFlashBanner';
import WrappedCard, { useWrappedTrigger } from './WrappedCard';

// ---- Main TodayFeed component ----

export default function TodayFeed({
  canUsePrivateData,
  onOpenMemory,
}: {
  canUsePrivateData: boolean;
  onOpenMemory?: () => void;
}) {
  const {
    displayName,
    memoryCount, memoryNotes,
    focusNodes, allNodes,
    dormantStore, setDormantStore,
    calendarEvents, proactiveContext,
    proactiveCards, setProactiveCards,
    dismissedCardIds, setDismissedCardIds,
  } = useTodayData(canUsePrivateData);
  const [mirrorOpen, setMirrorOpen] = useState(false);

  // Proactive cards: up to 2, each independently dismissable
  const [meetingRecorderNode, setMeetingRecorderNode] = useState<FocusNode | null>(null);
  const [focusModeNode, setFocusModeNode] = useState<FocusNode | null>(null);


  const uiLocale = portalLocaleToDictionaryLocale(usePortalLocale());
  const initials = canUsePrivateData ? (displayName.trim().slice(0, 1) || L(uiLocale, '我', 'Me')) : L(uiLocale, '我', 'Me');
  const { shouldShow: showWrapped, dismiss: dismissWrapped } = useWrappedTrigger();

  // 设置页上传的头像同步到主页「我」按钮(PROFILE_UPDATED_EVENT 驱动)
  const [avatarUrl, setAvatarUrl] = useState('');
  useEffect(() => {
    const readAvatar = () => setAvatarUrl(canUsePrivateData ? (loadProfileSettings().avatarUrl || '') : '');
    readAvatar();
    window.addEventListener(PROFILE_UPDATED_EVENT, readAvatar);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, readAvatar);
  }, [canUsePrivateData]);

  // All proactive cards come from the guidance pipeline (email included) —
  // single path so cooling-store and attention-budget always apply.
  // 用户在 设置→通用→主动提醒程度 里可把预算降到 1 或 0(安静)。
  const [levelTick, setLevelTick] = useState(0);
  useEffect(() => {
    const onLevel = () => setLevelTick((v) => v + 1);
    window.addEventListener('nesio-proactive-level-changed', onLevel);
    return () => window.removeEventListener('nesio-proactive-level-changed', onLevel);
  }, []);
  void levelTick;
  const cardBudget = Math.min(TODAY_CARD_BUDGET, getProactiveCardBudget());
  const activeProactiveCards = proactiveCards.filter((c) => !dismissedCardIds.has(c.id)).slice(0, cardBudget);

  // 未来预测区永远有内容(批次 3):管线空窗/全被划掉时,轮播兜底
  // (历史上的今天/记忆回顾/时间段建议/小技巧),每次打开随机一张。
  const [fallbackTick, setFallbackTick] = useState(0);
  const fallbackCard = useMemo(
    () => buildRotatingFallback(new Date(), allNodes, uiLocale),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allNodes, fallbackTick, uiLocale],
  );
  const showFallback = activeProactiveCards.length === 0 && cardBudget > 0
    && fallbackCard && !isProactiveCardDismissed(fallbackCard.id)
    ? fallbackCard : null;

  return (
    <div className="nesio-today-root">
      <header className="nesio-today-header">
        <button
          type="button"
          className="nesio-today-brand"
          aria-label={L(uiLocale, '打开 Nesio 洞察', "Open Nesio insights")}
          onClick={() => setMirrorOpen(true)}
        >
          <img src="/assets/logo/nesio-mark.svg" alt="Nesio" className="nesio-today-brand-icon" />
        </button>
        <div className="nesio-today-header-tools">
          {/* 听简报/此刻 缩为图标圆钮,不再占首屏黄金位(批次 3) */}
          <DailyBriefCard
            compact
            canUsePrivateData={canUsePrivateData}
            memoryCount={memoryCount}
            memoryNotes={memoryNotes}
          />
          <button
            type="button"
            className="nesio-header-mini-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-mood'))}
            aria-label={L(uiLocale, '记录此刻感受', 'Log how you feel')}
            title={L(uiLocale, '此刻', 'This moment')}
          >
            <IconThermometer size={19} />
          </button>
          <a href="/settings" className="nesio-today-avatar" aria-label={L(uiLocale, '我的设置', 'My settings')}>
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- 头像是运行时签名 URL,next/image 无法静态优化
              <img src={avatarUrl} alt="" className="nesio-today-avatar-img" draggable={false} />
            ) : initials}
          </a>
        </div>
      </header>

      <div className="nesio-today-scroll">
        {/* 季度 Wrapped 卡片 */}
        {showWrapped && <WrappedCard onDismiss={dismissWrapped} />}

        {/* 未来引导卡 — up to 2, each independently dismissable */}
        {activeProactiveCards.map((card) => (
          <ProactiveGuidanceCard
            key={card.id}
            card={card}
            onDismiss={() => {
              dismissProactiveById(card.id);
              // Record in cooling store so adaptive cooldown can kick in after repeated ignores
              if (card.cardType) {
                saveCoolingStore(recordDismissed(card.cardType, loadCoolingStore()));
              }
              setDismissedCardIds((prev) => { const next = new Set(prev); next.add(card.id); return next; });
            }}
            onMarkDone={(nodeId) => markFocusNodeDone(nodeId)}
          />
        ))}

        {showFallback && (
          <ProactiveGuidanceCard
            key={showFallback.id}
            card={showFallback}
            onDismiss={() => {
              dismissProactiveById(showFallback.id);
              setFallbackTick((v) => v + 1);
            }}
          />
        )}

        {/* 冷冻到期提醒(批次 7:冷冻仓入口迁到拍一下,决定回路留在首屏) */}
        <ThawedReminder />

        {/* 今日焦点 — 重要安排 / 重要日子 / 重要提醒 */}
        <TodayFocusSection
          focusNodes={focusNodes}
          calendarEvents={calendarEvents}
          specialDays={proactiveContext.upcomingSpecialDays}
          allNodes={allNodes}
          dormantStore={dormantStore}
          onSetDormantStore={setDormantStore}
          onOpenMemory={onOpenMemory}
          onOpenRecorder={(node) => setMeetingRecorderNode(node)}
          onFocusMode={(node) => setFocusModeNode(node)}
        />

        {/* 实验打卡(批次 8:按用户要求放到最下面) */}
        <ExperimentCheckinCard />
      </div>

      {/* 聚焦模式 */}
      <FocusModeSheet
        node={focusModeNode}
        onClose={() => setFocusModeNode(null)}
        onDone={(node) => { markFocusNodeDone(node.id); setFocusModeNode(null); }}
      />

      {/* 会议记录 sheet */}
      <MeetingRecorderSheet
        open={meetingRecorderNode !== null}
        meetingNode={meetingRecorderNode}
        onClose={() => setMeetingRecorderNode(null)}
      />

      {/* Insights mirror */}
      {mirrorOpen && (
        <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label="Nesio 的洞察">
          <button type="button" className="nesio-settings-sheet-backdrop" onClick={() => setMirrorOpen(false)} aria-label="关闭" />
          <div className="nesio-settings-sheet-card nesio-insights-sheet-card">
            <div className="nesio-sheet-handle" aria-hidden />
            <InsightsSheet onClose={() => setMirrorOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
