'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { useProfileAvatar } from './use-profile-avatar';
import NesioMark from './NesioMark';
import RetrospectCard from './RetrospectCard';
import { usePortalLocale } from './use-portal-locale';
import { L } from '@/lib/portal/i18n';
import { buildTodayViewModel, focusTimeHint, markFocusNodeDone, deleteFocusNode, addCommitmentNode, addMeetingNotes, saveSubtasks, toggleSubtask, type FocusNode, type SubTask, type ProactiveContext, type ProactiveContextItem, getLiveMemoryNode, type LiveMemoryNode } from '@/lib/platform/view-models/today-view-model';
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
import { createPortal } from 'react-dom';
import { dismissProactiveById, getProactiveCardBudget } from './today/proactive-types';
import { ProactiveGuidanceCard } from './today/ProactiveGuidanceCard';
import { ExperimentCheckinCard } from './today/ExperimentCheckinCard';
import { RoutineDueCards } from './today/RoutineDueCards';
import { DailyReportCard } from './today/DailyReportCard';
import { ThawedReminder } from './today/ThawedReminder';
import { ReengageNudgeCard } from './today/ReengageNudgeCard';
import { TodayFocusSection } from './today/FocusSection';
import { NightTimeline } from './today/NightTimeline';
import { useTodayData } from './today/useTodayData';
import { FocusModeSheet } from './today/FocusModeSheet';
import { MeetingRecorderSheet } from './today/MeetingRecorderSheet';

// 1143-line analytics sheet — load on open, not at boot
const InsightsSheet = dynamic(() => import('./InsightsSheet'), { ssr: false });
const MoodTrendSheet = dynamic(() => import('./MoodTrendSheet'), { ssr: false });
const MemoryNodeDetailLazy = dynamic(() => import('./MemoryNodeDetail'), { ssr: false });
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
  const [moodTrendOpen, setMoodTrendOpen] = useState(false);
  const [guideDetailNode, setGuideDetailNode] = useState<LiveMemoryNode | null>(null); // 批次 83:引导卡点开详情
  // 批次 31:焦点下方快捷输入(用户新指令)
  const [quickAdd, setQuickAdd] = useState('');
  const [quickSaved, setQuickSaved] = useState(false);
  // 批次 33:话筒 = 原地录音转文字直接入记忆(不跳说一句 sheet);无语音 API 才回落 sheet
  const [micState, setMicState] = useState<'idle' | 'recording'>('idle');
  const recogRef = useRef<{ stop: () => void } | null>(null);
  const quickInputRef = useRef<HTMLTextAreaElement | null>(null);

  // 批次 163:记一笔草稿持久化 —— 没点记下就退出 App,下次进来这条还在。
  useEffect(() => {
    try { const d = localStorage.getItem('nesio-jot-draft-v1'); if (d) setQuickAdd(d); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { if (quickAdd) localStorage.setItem('nesio-jot-draft-v1', quickAdd); else localStorage.removeItem('nesio-jot-draft-v1'); } catch { /* ignore */ }
  }, [quickAdd]);

  function startQuickMic() {
    // 批次 37 重做:边说边把文字写进输入框(interim 实时可见),说完文字留在框里
    // 由用户回车确认;识别起不来(iOS PWA 常见)立刻回落说一句 sheet,绝不装死。
    type SR = { new (): { lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void } };
    const w = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) { window.dispatchEvent(new CustomEvent('nesio-open-voice')); return; }
    if (micState === 'recording') { recogRef.current?.stop(); return; }
    let recog: InstanceType<SR>;
    try { recog = new Ctor(); } catch { window.dispatchEvent(new CustomEvent('nesio-open-voice')); return; }
    recog.lang = uiLocale === 'en' ? 'en-US' : 'zh-CN';
    recog.interimResults = true;
    recog.continuous = false;
    let got = false;
    recog.onresult = (e) => {
      got = true;
      const text = Array.from({ length: e.results.length }, (_, i) => e.results[i][0].transcript).join('');
      setQuickAdd(text); // 实时写进输入框,像在打字
    };
    recog.onend = () => {
      setMicState('idle');
      recogRef.current = null;
      // 一个字都没听到(常见于权限/引擎没起来)→ 回落说一句 sheet
      if (!got) window.dispatchEvent(new CustomEvent('nesio-open-voice'));
    };
    recog.onerror = () => {
      setMicState('idle');
      recogRef.current = null;
      window.dispatchEvent(new CustomEvent('nesio-open-voice'));
    };
    recogRef.current = recog;
    setMicState('recording');
    try { recog.start(); } catch {
      setMicState('idle');
      recogRef.current = null;
      window.dispatchEvent(new CustomEvent('nesio-open-voice'));
    }
  }
  const [insightsTab, setInsightsTab] = useState<'reflection' | 'health'>('reflection');

  // 健身 routine 卡「开始练」→ 打开洞察的健康 tab(训练计划在那)
  useEffect(() => {
    const openTraining = () => { setInsightsTab('health'); setMirrorOpen(true); };
    const openMoodTrend = () => setMoodTrendOpen(true); // 批次 136:心情第一拍「看趋势」→ 情绪趋势 sheet
    window.addEventListener('nesio-open-training', openTraining);
    window.addEventListener('nesio-open-mood-trend', openMoodTrend);
    return () => {
      window.removeEventListener('nesio-open-training', openTraining);
      window.removeEventListener('nesio-open-mood-trend', openMoodTrend);
    };
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
    .filter((c) => !dismissedCardIds.has(c.id) && (!c.nodeId || c.nodeId !== pinnedNodeId)
      && (!c.expiresAt || new Date(c.expiresAt).getTime() > Date.now()))
    .slice(0, cardBudget);

  // §1 ①收据首行 → 批次 80(用户定案「都记着呢N条意义不大」):
  // 称呼(首次设置的名字) + 时段问候 + **一条最有用的信息**
  // (最近的带时点焦点事项/到期物);没有要紧事才落回承诺文案。
  const receiptLine = useMemo(() => {
    // 默认兜底名(「我」/User)不是称呼 —— 只有用户亲自设置的名字才上问候语
    const GENERIC_NAMES = new Set(['我', 'me', 'user', '用户', '朋友']);
    const nameRaw = displayName.trim();
    const name = nameRaw.length > 0 && nameRaw.length <= 12 && !GENERIC_NAMES.has(nameRaw.toLowerCase()) && !GENERIC_NAMES.has(nameRaw) ? nameRaw : '';
    const hello = hourNow < 11
      ? L(uiLocale, '早', 'Morning')
      : isEvening ? L(uiLocale, '晚上好', 'Evening') : L(uiLocale, '下午好', 'Afternoon');
    const prefix = name ? `${name},${hello}。` : `${hello}。`;

    if (receipt.realTotal === 0) {
      return `${prefix}${L(uiLocale, '记点什么,我替你记着。', "Note anything — I'll hold it for you.")}`;
    }

    // 最有用的一条:焦点里最近的、带真实时间提示的事(跳过刚记录/已过期)
    let nextUp = '';
    for (const n of focusNodes) {
      const hint = focusTimeHint(n, uiLocale);
      if (!hint || hint === L(uiLocale, '刚记录', 'just noted') || hint === L(uiLocale, '已过期', 'expired')) continue;
      nextUp = `${hint} · ${n.name.slice(0, 14)}`;
      break;
    }
    if (nextUp) {
      return `${prefix}${L(uiLocale, `最近的一件事:${nextUp}。`, `Next up: ${nextUp}.`)}`;
    }
    if (isEvening) {
      return receipt.todayCount > 0
        ? `${prefix}${L(uiLocale, `今天的 ${receipt.todayCount} 条都收好了,可以放心把今天放下了。`, `Today's ${receipt.todayCount} notes are tucked away — you can let today go.`)}`
        : `${prefix}${L(uiLocale, '今天很安静,可以放心把今天放下了。', 'A quiet day. You can let it go now.')}`;
    }
    return `${prefix}${L(uiLocale, '没有要紧的事,想到什么随时说。', "Nothing pressing — say anything, anytime.")}`;
  }, [receipt, uiLocale, hourNow, isEvening, displayName, focusNodes]);

  return (
    <div className="nesio-today-root">
      <header className="nesio-today-header">
        <button
          type="button"
          data-tour="insights"
          className="nesio-today-brand"
          aria-label={L(uiLocale, '打开 Nesio 洞察', "Open Nesio insights")}
          onClick={() => { setInsightsTab('reflection'); setMirrorOpen(true); }}
        >
          <NesioMark className="nesio-today-brand-icon" />
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

        {/* 批次 105:回顾卡(去年今日)—— 念念翻出一条旧记忆,放问候下面(设计规范今天页第 2 段)。
            周年/月纪念优先;没有符合的不渲染。点开复用 MemoryNodeDetail。 */}
        <RetrospectCard onOpen={(id) => { const live = getLiveMemoryNode(id); if (live) setGuideDetailNode(live); }} />

        {/* 季度 Wrapped 卡片 */}
        {showWrapped && <WrappedCard onDismiss={dismissWrapped} />}

        {/* 每日图文日报(未来预测区首张;仅登录 + 开关开 + 有内容时,todayReport 已受私据门)*/}
        {canUsePrivateData && <DailyReportCard report={todayReport} />}

        {/* 回访再触达:来过好几回但某功能没碰过 → 轻轻探一句(全局两天一条,可稍后/不再提醒)*/}
        {canUsePrivateData && (
          <ReengageNudgeCard
            nodes={allNodes}
            onOpenInsights={() => { setInsightsTab('reflection'); setMirrorOpen(true); }}
          />
        )}

        {/* 未来引导卡 — up to 2, each independently dismissable */}
        {activeProactiveCards.map((card) => (
          <ProactiveGuidanceCard
            key={card.id}
            card={card}
            onOpen={card.nodeId ? () => { const live = getLiveMemoryNode(card.nodeId!); if (live) setGuideDetailNode(live); } : undefined}
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
          capture={{
            value: quickAdd,
            onChange: setQuickAdd,
            onSubmit: () => {
              const name = quickAdd.trim();
              if (!name) return;
              addCommitmentNode(name);
              setQuickAdd('');
              setQuickSaved(true);
              setTimeout(() => setQuickSaved(false), 1400);
            },
            onMic: startQuickMic,
            recording: micState === 'recording',
            inputRef: quickInputRef,
          }}
        />

        {/* 批次 132(用户「底部输入口需要删除」):独立快捷输入栏已删 ——
            记一笔输入内联进时间线「记一笔·话筒」节点(唯一极简输入入口)。 */}

        {/* 实验打卡(批次 8:按用户要求放到最下面) */}
        <RoutineDueCards />
        <ExperimentCheckinCard />

        {/* 批次 169:用户实锤去掉底部「想到什么…」提示行 */}
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

      {/* 批次 83:引导卡 → 记忆详情(portal 到 body,避 transform 祖先) */}
      {guideDetailNode && typeof document !== 'undefined' && createPortal(
        <MemoryNodeDetailLazy node={guideDetailNode} onClose={() => setGuideDetailNode(null)} />,
        document.body,
      )}

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

      {/* 批次 136:情绪趋势(心情第一拍「看趋势」进来) */}
      <MoodTrendSheet open={moodTrendOpen} onClose={() => setMoodTrendOpen(false)} />
    </div>
  );
}
