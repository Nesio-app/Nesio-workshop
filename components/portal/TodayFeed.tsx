'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { useProfileAvatar } from './use-profile-avatar';
import { usePortalLocale } from './use-portal-locale';
import { L } from '@/lib/portal/i18n';
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
import dynamic from 'next/dynamic';
import { buildRotatingFallback, dismissProactiveById, getProactiveCardBudget, isProactiveCardDismissed, type ProactiveCardData } from './today/proactive-types';
import { ProactiveGuidanceCard } from './today/ProactiveGuidanceCard';
import { ExperimentCheckinCard } from './today/ExperimentCheckinCard';
import { RoutineDueCards } from './today/RoutineDueCards';
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
  const [insightsTab, setInsightsTab] = useState<'reflection' | 'health'>('reflection');

  // 健身 routine 卡「开始练」→ 打开洞察的健康 tab(训练计划在那)
  useEffect(() => {
    const openTraining = () => { setInsightsTab('health'); setMirrorOpen(true); };
    window.addEventListener('nesio-open-training', openTraining);
    return () => window.removeEventListener('nesio-open-training', openTraining);
  }, []);

  // Proactive cards: up to 2, each independently dismissable
  const [meetingRecorderNode, setMeetingRecorderNode] = useState<FocusNode | null>(null);
  const [focusModeNode, setFocusModeNode] = useState<FocusNode | null>(null);


  const uiLocale = portalLocaleToDictionaryLocale(usePortalLocale());
  // 批次 13:profile store 的缺省名是 zh「我」,英文界面下按语言回落 Me
  const trimmedName = displayName.trim();
  const initials = canUsePrivateData && trimmedName && trimmedName !== '我'
    ? trimmedName.slice(0, 1)
    : L(uiLocale, '我', 'Me');
  const { shouldShow: showWrapped, dismiss: dismissWrapped } = useWrappedTrigger();

  // 头像统一走 useProfileAvatar(批次 11:签名 URL 过期自动换新,修「头像丢失」)
  const { avatarUrl, refreshAvatar } = useProfileAvatar(canUsePrivateData);

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
    // 批次 22:确定性选卡(hourSeed + rotation),同一小时稳定不跳;
    // fallbackTick 作为 rotation 传入,划掉才换下一张
    () => buildRotatingFallback(new Date(), allNodes, uiLocale, fallbackTick),
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
          onClick={() => { setInsightsTab('reflection'); setMirrorOpen(true); }}
        >
          <img src="/assets/logo/nesio-mark.svg" alt="Nesio" className="nesio-today-brand-icon nesio-logo-day" />
          <img src="/assets/logo/nesio-mark-night.svg" alt="" aria-hidden className="nesio-today-brand-icon nesio-logo-night" />
        </button>
        <div className="nesio-today-header-tools">
          {/* 批次 39:听简报暂时收进「设置 → 路线图」(还在打磨);记录心情移到中央「+」扇形菜单 */}
          <a href="/settings" className="nesio-today-avatar" aria-label={L(uiLocale, '我的设置', 'My settings')}>
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- 头像是运行时签名 URL,next/image 无法静态优化
              <img src={avatarUrl} alt="" className="nesio-today-avatar-img" draggable={false} onError={refreshAvatar} />
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
        <RoutineDueCards />
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
        <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label={L(uiLocale, 'Nesio 的洞察', "Nesio's insights")}>
          <button type="button" className="nesio-settings-sheet-backdrop" onClick={() => setMirrorOpen(false)} aria-label={L(uiLocale, '关闭', 'Close')} />
          <div className="nesio-settings-sheet-card nesio-insights-sheet-card">
            <div className="nesio-sheet-handle" aria-hidden />
            <InsightsSheet onClose={() => setMirrorOpen(false)} canUsePrivateData={canUsePrivateData} initialTab={insightsTab} />
          </div>
        </div>
      )}
    </div>
  );
}
