'use client';

import { useEffect, useRef, useState } from 'react';
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
import { buildTimeFallback, dismissProactiveById, isProactiveCardDismissed, type ProactiveCardData } from './today/proactive-types';
import { ProactiveGuidanceCard } from './today/ProactiveGuidanceCard';
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


  const initials = canUsePrivateData ? (displayName.trim().slice(0, 1) || '我') : '我';
  const { shouldShow: showWrapped, dismiss: dismissWrapped } = useWrappedTrigger();

  // All proactive cards come from the guidance pipeline (email included) —
  // single path so cooling-store and attention-budget always apply.
  const activeProactiveCards = proactiveCards.filter((c) => !dismissedCardIds.has(c.id)).slice(0, TODAY_CARD_BUDGET);

  return (
    <div className="nesio-today-root">
      <header className="nesio-today-header">
        <button
          type="button"
          className="nesio-today-brand"
          aria-label="打开 Nesio 洞察"
          onClick={() => setMirrorOpen(true)}
        >
          <img src="/icons/treasurebox.svg" alt="Nesio" className="nesio-today-brand-icon" />
        </button>
        <a href="/settings" className="nesio-today-avatar" aria-label="我的设置">{initials}</a>
      </header>

      <div className="nesio-today-scroll">
        {/* 季度 Wrapped 卡片 */}
        {showWrapped && <WrappedCard onDismiss={dismissWrapped} />}

        {/* 顶部双圆按钮：听简报 + 此刻 */}
        <div className="nesio-today-top-row">
          <DailyBriefCard
            circular
            canUsePrivateData={canUsePrivateData}
            memoryCount={memoryCount}
            memoryNotes={memoryNotes}
          />
          <button
            type="button"
            className="nesio-mood-circle"
            onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-mood'))}
            aria-label="记录此刻感受"
          >
            <span className="nesio-mood-circle-icon" aria-hidden>🌡</span>
            <span className="nesio-mood-circle-label">此刻</span>
          </button>
        </div>

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
