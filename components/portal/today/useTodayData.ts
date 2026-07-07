'use client';

/**
 * useTodayData — Today 页的数据编排层(工程 PRD:业务判断离开组件层)。
 * 职责:view-model 构建、邮件轮询、guidance 管线(含 DEC 汇入)、
 * AI 文案缓存、gmail 后台同步、刷新事件订阅。
 * TodayFeed 容器只消费返回值,不再直接触碰任何数据源。
 */

import { useEffect, useRef, useState } from 'react';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { loadProfileSettings, portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { buildTodayViewModel, type FocusNode, type ProactiveContext } from '@/lib/platform/view-models/today-view-model';
import { readPortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';
import type { CalendarEvent } from '@/lib/portal/types';
import { scoreCalendarEvents } from '@/lib/platform/attention-engine';
import type { EmailSignal } from '@/lib/platform/email-signals';
import { loadDormantStore, evaluateDormancy, type DormantStore } from '@/lib/platform/dormant-engine';
import { runGuidancePipeline } from '@/lib/platform/guidance-engine/guidance-pipeline';
import { applyGuidanceFeedback, type GuidanceFeedback } from '@/lib/platform/guidance-engine/guidance-ranker';
import { getEnergyState } from '@/lib/platform/energy-state';
import type { RecommendationCard } from '@/lib/portal/reasoning-engine';
import { getBestInterruptionHours } from '@/lib/portal/mirror-profile';
import { rememberAI, recallAI, sig } from '@/lib/portal/ai-cache';
import {
  calendarEventsToGuidanceEvents,
  emailSignalsToGuidanceEvents,
  specialDaysToGuidanceEvents,
  focusNodesToGuidanceEvents,
  weatherToGuidanceEvents,
  healthNodesToGuidanceEvents,
  healthFindingsToGuidanceEvents,
  financeFindingsToGuidanceEvents,
  type WeatherSnapshot,
  decCardsToGuidanceEvents,
} from '@/lib/platform/guidance-engine/source-adapters';
import { computeDomainFindings } from '@/lib/portal/domain-insights';
import { cloudSignalRowsToSignals, type CloudSignalRow } from '@/lib/life-domain/signal-search';
import { isProactiveCardDismissed, type ProactiveCardData, registerDecCards } from './proactive-types';

const EMPTY_SIGNAL_CARDS: RecommendationCard[] = [
  {
    id: 'needs-input-public',
    domain: 'home',
    domainLabel: '从一件小事开始',
    confidence: 0.6,
    urgency: 1,
    icon: '✦',
    iconBg: 'var(--chip-periwinkle)',
    title: '先放进来一件事就好',
    body: '说一句、拍一下，Nesio 会帮你留到以后找得到。',
    tags: ['本地优先 · 可确认'],
    evidence: [],
    primaryAction: '先记一件事',
    secondaryAction: '稍后',
    type: 'standard',
    expiresAt: new Date(Date.now() + 24 * 3600000).toISOString(),
    sourceStatus: 'needs_input',
  },
];

async function loadCloudSignals(canUsePrivateData: boolean) {
  if (!canUsePrivateData) return [];
  try {
    const response = await fetch('/api/cloud/signals?limit=80', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) return [];
    const data = await response.json() as { signals?: CloudSignalRow[] };
    return cloudSignalRowsToSignals(data.signals || []);
  } catch {
    return [];
  }
}

const EMAIL_SIGNALS_KEY = 'nesio-email-signals-cache';
const EMAIL_SIGNALS_TTL_MS = 20 * 60_000; // 20 minutes

async function loadEmailSignals(canUsePrivateData: boolean): Promise<EmailSignal[]> {
  if (!canUsePrivateData || typeof window === 'undefined') return [];
  try {
    const cached = localStorage.getItem(EMAIL_SIGNALS_KEY);
    if (cached) {
      const { ts, signals } = JSON.parse(cached) as { ts: number; signals: EmailSignal[] };
      if (Date.now() - ts < EMAIL_SIGNALS_TTL_MS) return signals;
    }
    const res = await fetch('/api/portal/gmail-quick', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json() as { ok?: boolean; signals?: EmailSignal[] };
    const signals = data.signals ?? [];
    localStorage.setItem(EMAIL_SIGNALS_KEY, JSON.stringify({ ts: Date.now(), signals }));
    return signals;
  } catch { return []; }
}

export function useTodayData(canUsePrivateData: boolean) {
  const [displayName, setDisplayName] = useState('');
  const [memoryCount, setMemoryCount] = useState(0);
  const [memoryNotes, setMemoryNotes] = useState<readonly string[]>([]);
  const [focusNodes, setFocusNodes] = useState<readonly FocusNode[]>([]);
  const [allNodes, setAllNodes] = useState<readonly FocusNode[]>([]);
  const [dormantStore, setDormantStore] = useState<DormantStore>({});
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [proactiveContext, setProactiveContext] = useState<ProactiveContext>({ upcomingSpecialDays: [], healthItems: [] });
  const [proactiveCards, setProactiveCards] = useState<ProactiveCardData[]>([]);
  const [dismissedCardIds, setDismissedCardIds] = useState<Set<string>>(new Set());

  // 并发运行序号:初始加载 + 20 分轮询 + 多个 window 事件都会触发 applyViewModel,
  // 每次有多段 await。只有最新一次运行允许写 state,否则慢的旧运行会覆盖新结果。
  const runSeqRef = useRef(0);

  // Meeting recorder state

  useEffect(() => {
    if (canUsePrivateData) {
      const profile = loadProfileSettings();
      setDisplayName(profile.displayName || '');
    } else {
      setDisplayName('');
    }

    let cancelled = false;

    const applyViewModel = async () => {
      const myRun = ++runSeqRef.current; // 本次运行序号;被更新的运行取代后不再写 state
      const stale = () => cancelled || myRun !== runSeqRef.current;
      const cloudSignals = await loadCloudSignals(canUsePrivateData);
      const updated = buildTodayViewModel({ canUsePrivateData, fallbackCards: EMPTY_SIGNAL_CARDS, cloudSignals });
      if (stale()) return;
      setMemoryCount(updated.memoryCount);
      setMemoryNotes(updated.memoryNotes);
      setFocusNodes(updated.focusNodes);
      setAllNodes(updated.allNodes);
      const store = loadDormantStore();
      const evaluated = evaluateDormancy(updated.allNodes, store);
      setDormantStore(evaluated);
      setProactiveContext(updated.proactiveContext);

      // Read calendar events from cache for the focus section
      const cal = readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar);
      if (!stale()) setCalendarEvents(cal?.events ?? []);

      // Build guidance cards (up to 2) and show independently
      if (canUsePrivateData) {
        const now = new Date();
        // Load email signals from quick scan (20min TTL cache)
        const latestEmailSignals = await loadEmailSignals(canUsePrivateData);

        // ── Guidance Engine pipeline ──────────────────────────────────────
        const calEvents = readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar)?.events ?? [];
        const weather = readPortalCache<WeatherSnapshot>(PORTAL_CACHE_KEYS.weather);
        const scored = scoreCalendarEvents(calEvents, now);

        registerDecCards(updated.cards); // 反馈环回写:完整卡(含 evidenceSignalIds)登记
        const guidanceEvents = [
          // DEC 域引擎卡(证据门控)— 此前 runDEC 输出被丢弃,现与其他源同台仲裁
          ...decCardsToGuidanceEvents(updated.cards),
          ...calendarEventsToGuidanceEvents(calEvents, now),
          ...emailSignalsToGuidanceEvents(latestEmailSignals),
          ...specialDaysToGuidanceEvents(updated.proactiveContext.upcomingSpecialDays, now),
          ...focusNodesToGuidanceEvents(updated.focusNodes, now),
          ...weatherToGuidanceEvents(weather),
          ...healthNodesToGuidanceEvents(updated.proactiveContext.healthItems),
          // 健康/财务判定接入主循环 —— 与 问一问/简报同读一份判定源(computeDomainFindings),
          // 消除两个输出面口径漂移。呈现仍各走各的(这里经七层仲裁、达标项不打扰;问一问走文本投影)。
          ...(() => {
            const df = computeDomainFindings();
            return [
              ...healthFindingsToGuidanceEvents(df.health.findings, df.health.risks),
              ...financeFindingsToGuidanceEvents(df.finance),
            ];
          })(),
        ];

        const uiLocale = portalLocaleToDictionaryLocale(loadProfileSettings().locale);
        const guidanceCards = runGuidancePipeline({
          locale: uiLocale,
          events: guidanceEvents,
          scoredCalendar: scored,
          now,
          energy: getEnergyState(now),
          goodHours: getBestInterruptionHours(),
        });
        const rawProactiveCards: ProactiveCardData[] = guidanceCards
          .map((card) => ({
            id: card.id,
            title: card.title,
            body: card.body,
            confidence: 90,
            sourceTags: [],
            icon: card.icon,
            priority: card.priority,
            cardType: card.type,
            nodeId: card.nodeId,
            actions: [{ label: card.action.cta, actionType: card.action.actionType }],
            expiresAt: card.expiresAt?.toISOString(),
            evidence: card.evidence,
            reason: card.reason,
          }))
          .filter((c) => !isProactiveCardDismissed(c.id))
          .filter((c) => !c.expiresAt || new Date(c.expiresAt).getTime() > now.getTime());

        // AI Language Generation (Layer 7) — enhance copy if cards exist.
        // Cached per card-set per day: the same cards used to trigger a fresh
        // AI rewrite on every app open (pipeline runs on load + 4 events +
        // 20-min poll), burning quota for identical output.
        let newProactiveCards = rawProactiveCards;
        if (rawProactiveCards.length > 0) {
          const LANG_CACHE_KEY = 'nesio-guidance-lang-cache-v1';
          const cacheSig = `${new Date().toISOString().slice(0, 10)}|${rawProactiveCards.map((c) => c.id + c.title).join('§')}`;
          let cachedCopy: Array<{ id: string; title: string; body: string }> | null = null;
          try {
            const raw = JSON.parse(localStorage.getItem(LANG_CACHE_KEY) || 'null') as { sig: string; cards: Array<{ id: string; title: string; body: string }> } | null;
            if (raw?.sig === cacheSig) cachedCopy = raw.cards;
          } catch { /* ignore */ }

          if (!cachedCopy) {
            try {
              const langRes = await fetch('/api/portal/guidance-language', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  cards: guidanceCards.map((c) => ({
                    id: c.id, type: c.type, icon: c.icon,
                    title: c.title, body: c.body, priority: c.priority,
                    action: c.action, expiresAt: c.expiresAt?.toISOString(), nodeId: c.nodeId,
                  })),
                  userName: displayName || undefined,
                }),
              });
              if (langRes.ok) {
                const langData = await langRes.json() as { ok: boolean; cards: Array<{ id: string; title: string; body: string }> };
                if (langData.ok && langData.cards.length === rawProactiveCards.length) {
                  cachedCopy = langData.cards;
                  try { localStorage.setItem(LANG_CACHE_KEY, JSON.stringify({ sig: cacheSig, cards: cachedCopy })); } catch { /* ignore */ }
                }
              }
            } catch { /* fall back to rule-generated copy */ }

            if (cachedCopy) {
              // 从 AI 的改写里学:逐卡记住(以卡片内容为键,跨天可复用),离线也能给出 AI 级文案
              for (let i = 0; i < rawProactiveCards.length; i++) {
                const c = cachedCopy[i];
                if (c) rememberAI('guidance-lang', sig(rawProactiveCards[i].id + '|' + rawProactiveCards[i].title), { title: c.title, body: c.body });
              }
            } else {
              // AI 离线 + 今日缓存未命中 → 复用过去 AI 给过的同款改写;凑不齐就退回原文(下方按长度判定)
              const recalled = rawProactiveCards.map((card) => recallAI<{ title: string; body: string }>('guidance-lang', sig(card.id + '|' + card.title)));
              if (recalled.every(Boolean)) {
                cachedCopy = rawProactiveCards.map((card, i) => ({ id: card.id, title: recalled[i]!.title, body: recalled[i]!.body }));
              }
            }
          }

          if (cachedCopy && cachedCopy.length === rawProactiveCards.length) {
            newProactiveCards = rawProactiveCards.map((card, i) => ({
              ...card,
              title: cachedCopy![i]?.title || card.title,
              body: cachedCopy![i]?.body || card.body,
            }));
          }
        }

        if (!stale() && newProactiveCards.length > 0) setProactiveCards(newProactiveCards);
        // 管线空窗时的兜底轮播移到 TodayFeed 渲染层(buildRotatingFallback):
        // 那里能看到「被 dismiss 后还剩几张」,保证未来预测区永远有内容。
      }
    };
    void applyViewModel();

    // Email quick scan: re-poll every 20 minutes while the page is open.
    // Re-runs the full guidance pipeline so new email signals pass through
    // cooling/budget gates like everything else (no side-channel cards).
    const emailPollInterval = canUsePrivateData
      ? setInterval(() => { void applyViewModel(); }, 20 * 60_000)
      : null;

    // Background Gmail full sync — at most once every 6h, non-blocking
    if (canUsePrivateData && typeof window !== 'undefined') {
      const GMAIL_SYNC_KEY = 'nesio-gmail-last-sync';
      const lastSync = parseInt(localStorage.getItem(GMAIL_SYNC_KEY) || '0', 10);
      if (Date.now() - lastSync > 6 * 3_600_000) {
        localStorage.setItem(GMAIL_SYNC_KEY, String(Date.now()));
        fetch('/api/portal/gmail?includeBody=true&analyze=true')
          .then((r) => r.json())
          .then((d: { ok?: boolean; nodes?: Array<Record<string, unknown>> }) => {
            if (d.ok && d.nodes && d.nodes.length > 0) {
              import('@/lib/portal/life-graph').then(({ addLifeNode }) => {
                d.nodes!.forEach((n) => ingestLifeNode(n as Parameters<typeof addLifeNode>[0]));
                window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
              });
            }
          })
          .catch(() => {});
      }
    }

    const refresh = () => { void applyViewModel(); };
    // 批次 52:卡片反馈 → 在线学习排序器做一次更新(reasoning-engine 保持无依赖叶子,
    // 走它派发的 nesio-feedback-recorded 事件,不反向 import)。
    const onFeedback = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cardId?: string; feedback?: string } | undefined;
      if (detail?.cardId) applyGuidanceFeedback(detail.cardId, detail.feedback as GuidanceFeedback);
      refresh();
    };
    window.addEventListener('nesio-life-graph-updated', refresh);
    window.addEventListener('nesio-connectors-refreshed', refresh);
    window.addEventListener('nesio-weather-updated', refresh);
    window.addEventListener('nesio-calendar-updated', refresh);
    window.addEventListener('nesio-feedback-recorded', onFeedback);

    return () => {
      cancelled = true;
      if (emailPollInterval) clearInterval(emailPollInterval);
      window.removeEventListener('nesio-life-graph-updated', refresh);
      window.removeEventListener('nesio-connectors-refreshed', refresh);
      window.removeEventListener('nesio-weather-updated', refresh);
      window.removeEventListener('nesio-calendar-updated', refresh);
      window.removeEventListener('nesio-feedback-recorded', onFeedback);
    };
  }, [canUsePrivateData]);

  return {
    displayName,
    memoryCount, memoryNotes,
    focusNodes, allNodes,
    dormantStore, setDormantStore,
    calendarEvents, proactiveContext,
    proactiveCards, setProactiveCards,
    dismissedCardIds, setDismissedCardIds,
  };
}
