'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { useProfileAvatar } from './use-profile-avatar';
import { usePortalLocale } from './use-portal-locale';
import { L } from '@/lib/portal/i18n';
import { buildTodayViewModel, focusTimeHint, markFocusNodeDone, deleteFocusNode, addCommitmentNode, addMeetingNotes, saveSubtasks, toggleSubtask, type FocusNode, type SubTask, type ProactiveContext, type ProactiveContextItem } from '@/lib/platform/view-models/today-view-model';
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
import { dismissProactiveById, getProactiveCardBudget } from './today/proactive-types';
import { ProactiveGuidanceCard } from './today/ProactiveGuidanceCard';
import { ExperimentCheckinCard } from './today/ExperimentCheckinCard';
import { RoutineDueCards } from './today/RoutineDueCards';
import { DailyReportCard } from './today/DailyReportCard';
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
    memoryCount, memoryNotes, todayReport,
    focusNodes, allNodes, receipt,
    dormantStore, setDormantStore,
    calendarEvents, proactiveContext,
    proactiveCards, setProactiveCards,
    dismissedCardIds, setDismissedCardIds,
  } = useTodayData(canUsePrivateData);
  const [mirrorOpen, setMirrorOpen] = useState(false);
  // 批次 31:焦点下方快捷输入(用户新指令)
  const [quickAdd, setQuickAdd] = useState('');
  const [quickSaved, setQuickSaved] = useState(false);
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
  // P1-6:称呼是本机数据(引导里填的),显示不需要登录 —— 此前 canUsePrivateData 门
  // 让匿名用户填了「J」头像还是「Me」(称呼存了但没接到显示)。
  const trimmedName = displayName.trim();
  const initials = trimmedName && trimmedName !== '我'
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
  // v1 规格 §1:回忆/引导 ≤1 张/天(晚间重心回忆,上限 2);没有强触发就整格消失,
  // 不硬凑 —— 轮播兜底(历史上的今天/小技巧)已废除,「页面活着」由收据首行负责。
  const hourNow = new Date().getHours();
  const isEvening = hourNow >= 21;
  const cardBudget = Math.min(TODAY_CARD_BUDGET, getProactiveCardBudget(), isEvening ? 2 : 1);
  // 架构审查 #2:统一仲裁 —— 置顶抢占的节点,其引导卡不再重复出现
  const [pinnedNodeId, setPinnedNodeId] = useState<string | null>(null);
  const guidanceNodeIds = useMemo(() => proactiveCards.map((c) => c.nodeId).filter((x): x is string => Boolean(x)), [proactiveCards]);
  const activeProactiveCards = proactiveCards
    .filter((c) => !dismissedCardIds.has(c.id) && (!c.nodeId || c.nodeId !== pinnedNodeId))
    .slice(0, cardBudget);

  // §1 ①收据首行:每次打开先兑现一次承诺(纯本地事实,绝不显示同步计数);时段三态。
  const receiptLine = useMemo(() => {
    if (receipt.realTotal === 0) {
      return L(uiLocale, '我在。记点什么,我替你记着。', "I'm here. Note anything — I'll hold it for you.");
    }
    if (hourNow < 11) {
      return receipt.yesterdayCount > 0
        ? L(uiLocale, `早。昨天的 ${receipt.yesterdayCount} 条都存着,想到什么随时说。`, `Morning. Yesterday's ${receipt.yesterdayCount} notes are safe — say anything, anytime.`)
        : L(uiLocale, '早。都记着呢,想到什么随时说。', "Morning. Everything's kept — say anything, anytime.");
    }
    if (isEvening) {
      return receipt.todayCount > 0
        ? L(uiLocale, `今天的 ${receipt.todayCount} 条都收好了。可以放心把今天放下了。`, `Today's ${receipt.todayCount} notes are tucked away. You can let today go.`)
        : L(uiLocale, '今天很安静。可以放心把今天放下了。', 'A quiet day. You can let it go now.');
    }
    return receipt.todayCount > 0
      ? L(uiLocale, `都记着呢。今天 ${receipt.todayCount} 条,都收好了。`, `All kept. ${receipt.todayCount} today, safely stored.`)
      : L(uiLocale, '都记着呢。想到什么,随时卸给我。', "All kept. Whatever comes to mind, hand it to me.");
  }, [receipt, uiLocale, hourNow, isEvening]);

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
        {/* §1 ①安心态收据(宋体 = Nesio 的声音):先兑现承诺,再看今天 */}
        <p className="nesio-today-receipt nesio-serif-voice">{receiptLine}</p>

        {/* 季度 Wrapped 卡片 */}
        {showWrapped && <WrappedCard onDismiss={dismissWrapped} />}

        {/* 每日图文日报(未来预测区首张;仅登录 + 开关开 + 有内容时,todayReport 已受私据门)*/}
        {canUsePrivateData && <DailyReportCard report={todayReport} />}

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

        {/* 冷冻到期提醒(批次 7:冷冻仓入口迁到拍一下,决定回路留在首屏) */}
        <ThawedReminder />

        {/* 今日焦点 — 重要安排 / 重要日子 / 重要提醒 */}
        <TodayFocusSection
          guidanceNodeIds={guidanceNodeIds}
          onPinnedResolved={setPinnedNodeId}
          focusNodes={focusNodes}
          calendarEvents={calendarEvents}
          specialDays={proactiveContext.upcomingSpecialDays}
          allNodes={allNodes}
          dormantStore={dormantStore}
          onSetDormantStore={setDormantStore}
          onOpenMemory={onOpenMemory}
          onOpenRecorder={(node) => setMeetingRecorderNode(node)}
          onFocusMode={(node) => setFocusModeNode(node)}
          onDeleteNode={(id) => deleteFocusNode(id)}
        />

        {/* 批次 31(用户指令,回收 §1④ 的一部分):焦点下方快捷输入行 ——
            只有输入功能:回车记下(像待办的进焦点),小话筒直达说一句。 */}
        <form
          className="nesio-focus-quick-add"
          onSubmit={(e) => {
            e.preventDefault();
            const name = quickAdd.trim();
            if (!name) return;
            addCommitmentNode(name);
            setQuickAdd('');
            setQuickSaved(true);
            setTimeout(() => setQuickSaved(false), 1400);
          }}
        >
          <input
            className="nesio-focus-quick-input"
            type="text"
            placeholder={quickSaved ? L(uiLocale, '✓ 记下了', '✓ Noted') : L(uiLocale, '想到什么,记下来…', 'Anything on your mind…')}
            value={quickAdd}
            onChange={(e) => setQuickAdd(e.target.value)}
          />
          {quickAdd.trim() ? (
            <button type="submit" className="nesio-focus-quick-btn">{L(uiLocale, '记下', 'Note it')}</button>
          ) : (
            <button
              type="button"
              className="nesio-focus-quick-mic"
              aria-label={L(uiLocale, '语音输入', 'Voice input')}
              onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-voice'))}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18" aria-hidden>
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <line x1="12" y1="18" x2="12" y2="21" />
              </svg>
            </button>
          )}
        </form>

        {/* 实验打卡(批次 8:按用户要求放到最下面) */}
        <RoutineDueCards />
        <ExperimentCheckinCard />

        {/* §1 ④捕获提示:指向导航 FAB(唯一英雄动作),文案随时段变 */}
        <p className="nesio-capture-hint">
          {isEvening
            ? L(uiLocale, '睡前想到什么,按住方块说一句,今天就能放下了', 'Anything left in your head — hold the cube, say it, and let today go')
            : L(uiLocale, '想到什么,按住方块说一句就卸下', 'Anything on your mind — hold the cube and say it')}
        </p>
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
