'use client';

/**
 * useTodayData — Today 页的数据编排层(工程 PRD:业务判断离开组件层)。
 * 职责:view-model 构建、邮件轮询、guidance 管线(含 DEC 汇入)、
 * AI 文案缓存、gmail 后台同步、刷新事件订阅。
 * TodayFeed 容器只消费返回值,不再直接触碰任何数据源。
 */

import { useEffect, useRef, useState } from 'react';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { loadProfileSettings, portalLocaleToDictionaryLocale, PROFILE_UPDATED_EVENT } from '@/lib/portal/profile';
import { canUsePaidCloudAi } from '@/lib/portal/entitlement';
import { buildDailyReport, type DailyReport } from '@/lib/portal/daily-report';
import { autoPersistTodayReport } from '@/lib/portal/daily-report-persist';
import { loadSweepEvents, maybeRunSweep } from '@/lib/portal/llm-sweep-auto';
import { buildTodayViewModel, type FocusNode, type ProactiveContext, type TodayReceipt } from '@/lib/platform/view-models/today-view-model';
import { readPortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';
import type { CalendarEvent } from '@/lib/portal/types';
import { scoreCalendarEvents } from '@/lib/platform/attention-engine';
import type { EmailSignal } from '@/lib/platform/email-signals';
import { loadDormantStore, evaluateDormancy, type DormantStore } from '@/lib/platform/dormant-engine';
import { runGuidancePipelineDeferred } from '@/lib/platform/guidance-engine/guidance-pipeline';
import { emitFeedback, type Reaction } from '@/lib/platform/personalization';
import { getEnergyState } from '@/lib/platform/energy-state';
import type { RecommendationCard } from '@/lib/portal/reasoning-engine';
import { getBestInterruptionHours } from '@/lib/portal/mirror-profile';
import { topActiveHours } from '@/lib/portal/feature-usage';
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
  placeFindingsToGuidanceEvents,
  inventoryFindingsToGuidanceEvents,
  moodFindingsToGuidanceEvents,
  relationshipFindingsToGuidanceEvents,
  readingFindingsToGuidanceEvents,
  crossRegionToGuidanceEvents,
  objectContextEvents,
  outfitFindingsToGuidanceEvents,
  type WeatherSnapshot,
  decCardsToGuidanceEvents,
} from '@/lib/platform/guidance-engine/source-adapters';
import { listWardrobe, outfitFindings, inferFormalNeed } from '@/lib/portal/wardrobe';
import { computeDomainFindings } from '@/lib/portal/domain-insights';
import { buildCrossRegionDeliverables } from '@/lib/platform/cross-region/deliver';
import { cloudSignalRowsToSignals, type CloudSignalRow } from '@/lib/life-domain/signal-search';
import { isProactiveCardDismissed, type ProactiveCardData, registerDecCards } from './proactive-types';
import { localDayKey } from '@/lib/portal/local-day';

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
  // 跨区 P0:每日快照 journal(易逝上下文当天采样 + 历史回填)。空闲时跑,不阻塞首屏。
  useEffect(() => {
    const timer = setTimeout(() => {
      import('@/lib/platform/fact-journal').then((m) => m.ensureFactJournal()).catch(() => undefined);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  const [displayName, setDisplayName] = useState('');
  const [memoryCount, setMemoryCount] = useState(0);
  const [memoryNotes, setMemoryNotes] = useState<readonly string[]>([]);
  const [todayReport, setTodayReport] = useState<DailyReport | null>(null);
  const [focusNodes, setFocusNodes] = useState<readonly FocusNode[]>([]);
  const [allNodes, setAllNodes] = useState<readonly FocusNode[]>([]);
  const [receipt, setReceipt] = useState<TodayReceipt>({ realTotal: 0, todayCount: 0, yesterdayCount: 0 });
  const [dormantStore, setDormantStore] = useState<DormantStore>({});
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [proactiveContext, setProactiveContext] = useState<ProactiveContext>({ upcomingSpecialDays: [], healthItems: [] });
  const [proactiveCards, setProactiveCards] = useState<ProactiveCardData[]>([]);
  const [dismissedCardIds, setDismissedCardIds] = useState<Set<string>>(new Set());

  // 批次 79(用户定案「回顾和顶部卡片常驻」):卡片与划走记录按天落盘 ——
  // 重开 App 当天原样恢复(此前只是届内常驻,重开即丢、冷却又拦着不再出)。
  // 离场只有两条路:用户划走 / expiresAt 自然过期。
  useEffect(() => {
    try {
      const day = `${new Date().getFullYear()}-${new Date().getMonth() + 1}-${new Date().getDate()}`;
      const rawD = JSON.parse(localStorage.getItem('nesio-today-dismissed-v1') || 'null') as { day?: string; ids?: string[] } | null;
      if (rawD?.day === day && Array.isArray(rawD.ids)) setDismissedCardIds(new Set(rawD.ids));
      const rawC = JSON.parse(localStorage.getItem('nesio-today-cards-v1') || 'null') as { day?: string; cards?: ProactiveCardData[] } | null;
      if (rawC?.day === day && Array.isArray(rawC.cards)) {
        const now = Date.now();
        const alive = rawC.cards.filter((c) => c && typeof c.id === 'string'
          && (!c.expiresAt || new Date(c.expiresAt).getTime() > now));
        if (alive.length) {
          setProactiveCards((prev) => {
            const seen = new Set(prev.map((c) => c.id));
            return [...alive.filter((c) => !seen.has(c.id)), ...prev].slice(0, 8);
          });
        }
      }
    } catch { /* 恢复失败当没存过 */ }
  }, []);
  useEffect(() => {
    try {
      const day = `${new Date().getFullYear()}-${new Date().getMonth() + 1}-${new Date().getDate()}`;
      localStorage.setItem('nesio-today-cards-v1', JSON.stringify({ day, cards: proactiveCards.slice(0, 8) }));
    } catch { /* 配额满不拦渲染 */ }
  }, [proactiveCards]);
  useEffect(() => {
    try {
      const day = `${new Date().getFullYear()}-${new Date().getMonth() + 1}-${new Date().getDate()}`;
      localStorage.setItem('nesio-today-dismissed-v1', JSON.stringify({ day, ids: [...dismissedCardIds] }));
    } catch { /* 同上 */ }
  }, [dismissedCardIds]);

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
      if (!canUsePrivateData && !stale()) setTodayReport(null); // 登出:清私据派生的日报
      setFocusNodes(updated.focusNodes);
      setAllNodes(updated.allNodes);
      setReceipt(updated.receipt);
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
        const baseGuidanceEvents = [
          // DEC 域引擎卡(证据门控)— 此前 runDEC 输出被丢弃,现与其他源同台仲裁
          ...decCardsToGuidanceEvents(updated.cards),
          ...calendarEventsToGuidanceEvents(calEvents, now),
          ...emailSignalsToGuidanceEvents(latestEmailSignals),
          ...specialDaysToGuidanceEvents(updated.proactiveContext.upcomingSpecialDays, now),
          ...focusNodesToGuidanceEvents(updated.focusNodes, now),
          ...weatherToGuidanceEvents(weather),
          ...healthNodesToGuidanceEvents(updated.proactiveContext.healthItems),
          // 健康/财务/地图判定接入主循环 —— 与 问一问/简报同读一份判定源(computeDomainFindings),
          // 消除输出面口径漂移。呈现仍各走各的(这里经七层仲裁、达标项不打扰;问一问走文本投影)。
          ...(() => {
            const df = computeDomainFindings();
            return [
              ...healthFindingsToGuidanceEvents(df.health.findings, df.health.risks),
              ...financeFindingsToGuidanceEvents(df.finance),
              ...placeFindingsToGuidanceEvents(df.location),
              ...inventoryFindingsToGuidanceEvents(df.inventory),
              ...moodFindingsToGuidanceEvents(df.mood),
              ...relationshipFindingsToGuidanceEvents(df.relationship),
              ...readingFindingsToGuidanceEvents(df.reading),
              // 跨区 P2:已过同意/新鲜度/可打断性/预算门的跨区关联,进七层管线主动投递
              ...crossRegionToGuidanceEvents(buildCrossRegionDeliverables(now)),
            ];
          })(),
          // 穿搭:今日天气(冷热/降水)+ 今天的日程(正式度)→ 每日一套。规则版免费/端上;
          // 衣橱空则不打扰、太少给轻引导。点卡打开洞察「衣橱」tab。
          ...(() => {
            const w = weather as (WeatherSnapshot & { tempMinC?: number; tempMaxC?: number; precipProb?: number }) | null;
            const isToday = (iso?: string) => {
              if (!iso) return false;
              const d = new Date(iso);
              return !Number.isNaN(d.getTime())
                && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
            };
            const todayCal = calEvents.filter((e) => isToday(e.start));
            const outfitCtx = {
              repTempC: w?.tempMinC ?? w?.temperatureC ?? null,
              tempMinC: w?.tempMinC ?? null,
              tempMaxC: w?.tempMaxC ?? null,
              precipProb: w?.precipProb ?? null,
              formalNeed: inferFormalNeed(todayCal),
            };
            return outfitFindingsToGuidanceEvents(outfitFindings(listWardrobe(), outfitCtx, now.toISOString()));
          })(),
        ];
        const guidanceEvents = [
          ...baseGuidanceEvents,
          // 批次197:接回 objectContextEvents(此前是死代码,零调用点)—— 拿临近事件(开会/出行/
          // 就诊/生日)去比对你的物品,把「带名片/带护照/7天前吹风快过期物品」这类情境提物顶出来。
          ...objectContextEvents(baseGuidanceEvents, updated.allNodes, now),
          // 批次207:开放世界 Layer ③ —— 从缓存 ledger 读巡查抽出的到期/续期 finding(免费、本地重算窗口);
          // 每日一次的付费巡查(maybeRunSweep,见下)只负责填 ledger,不阻塞出卡。
          ...loadSweepEvents(updated.allNodes, now),
        ];

        const uiLocale = portalLocaleToDictionaryLocale(loadProfileSettings().locale);

        // 每日 AI 图文日报(块3):私据门已在此 if(canUsePrivateData) 内 —— 取材日历/邮件/记忆。
        // 开着才生成 + 每日幂等自动存记忆(autoPersistTodayReport 内部再判开关/空/当天已生成)。
        {
          const profile = loadProfileSettings();
          const reportInput = {
            displayName: profile.displayName,
            now,
            locale: uiLocale,
            weather: weather ? { temperatureC: weather.temperatureC, condition: weather.condition, forecastNote: weather.forecastNote } : undefined,
            events: calEvents.map((e) => ({ title: e.title, start: e.start, end: e.end, location: e.location, calendarName: e.calendarName })),
            emailHighlights: latestEmailSignals.map((s) => s.cardTitle || s.subject).filter(Boolean).slice(0, 3),
            memoryNotes: updated.memoryNotes.slice(0, 3),
          };
          const report = buildDailyReport(reportInput);
          if (!stale()) setTodayReport(profile.dailyReportEnabled && !report.empty ? report : null);
          autoPersistTodayReport(reportInput, { enabled: profile.dailyReportEnabled, now });
          // 批次207:开放世界 Layer ③ —— 搭日报的车,每日一次巡查低置信捕捉(付费门在路由端)。
          // fire-and-forget:填 ledger 供下次渲染的 loadSweepEvents 读;不阻塞本轮出卡。
          void maybeRunSweep(updated.allNodes, { now });
        }
        // deferred:出卡但先不写「已展示」(冷却/ranker),等确认这轮结果真的上屏再 commit
        // —— 否则慢轮被 runSeqRef 丢弃时,卡被记成已展示却从未出现,下一轮全被冷却拦掉。
        const { cards: guidanceCards, commitShown } = runGuidancePipelineDeferred({
          locale: uiLocale,
          events: guidanceEvents,
          scoredCalendar: scored,
          now,
          energy: getEnergyState(now),
          // 自动调工作流:好时段 = 学到的偏好时段 ∪ 你实际活跃的时段(在你真在用 App 时才出卡)
          goodHours: [...new Set([...getBestInterruptionHours(), ...topActiveHours(4)])],
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
          .filter((c) => !isProactiveCardDismissed(c.id, `${c.title}|${c.body}`))
          .filter((c) => !c.expiresAt || new Date(c.expiresAt).getTime() > now.getTime());

        // AI Language Generation (Layer 7) — enhance copy if cards exist.
        // Cached per card-set per day: the same cards used to trigger a fresh
        // AI rewrite on every app open (pipeline runs on load + 4 events +
        // 20-min poll), burning quota for identical output.
        let newProactiveCards = rawProactiveCards;
        if (rawProactiveCards.length > 0) {
          const LANG_CACHE_KEY = 'nesio-guidance-lang-cache-v1';
          const cacheSig = `${localDayKey()}|${rawProactiveCards.map((c) => c.id + c.title).join('§')}`;
          let cachedCopy: Array<{ id: string; title: string; body: string }> | null = null;
          try {
            const raw = JSON.parse(localStorage.getItem(LANG_CACHE_KEY) || 'null') as { sig: string; cards: Array<{ id: string; title: string; body: string }> } | null;
            if (raw?.sig === cacheSig) cachedCopy = raw.cards;
          } catch { /* ignore */ }

          // 安全审计 #2:引导语润色是付费云,后台被动增强 —— 免费(分层启用后)静默跳过,用原始文案,不打云、不弹窗。
          if (!cachedCopy && canUsePaidCloudAi()) {
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

        if (!stale()) {
          // 批次 76(用户定案「不要闪来闪去」):合并不替换 —— 已在场的卡届内常驻
          // (冷却机制会让它们下一轮不再返回,旧逻辑整组替换 = 卡片闪没)。
          // 移除只有两条路:用户亲手划走 / 卡片自然过期(cardExpiry)。
          if (newProactiveCards.length > 0) {
            setProactiveCards((prev) => {
              const seen = new Set(prev.map((c) => c.id));
              return [...prev, ...newProactiveCards.filter((c) => !seen.has(c.id))].slice(0, 6);
            });
          }
          commitShown(); // 这轮结果确认上屏,才记「已展示」(冷却 + ranker 特征)
        }
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

    // 连接器批②:Gmail 准实时 —— 核心在 connector-sync(runGmailSync,自带 5 分钟节流 +
    // 增量 after: 游标,只拉/只分析新邮件);触发面:进入 Today + 前台每 5 分钟 + 从后台切回。
    let gmailCleanup: (() => void) | null = null;
    if (canUsePrivateData && typeof window !== 'undefined') {
      const syncGmail = () => { import('@/lib/portal/connector-sync').then(({ runGmailSync }) => runGmailSync()).catch(() => {}); };
      syncGmail();
      const gmailTimer = window.setInterval(syncGmail, 5 * 60_000);
      const onVisible = () => { if (document.visibilityState === 'visible') syncGmail(); };
      document.addEventListener('visibilitychange', onVisible);
      gmailCleanup = () => { window.clearInterval(gmailTimer); document.removeEventListener('visibilitychange', onVisible); };
    }

    const refresh = () => { void applyViewModel(); };
    // 事件风暴合并窗(QA 冻结主因):每次写图都会派发 nesio-life-graph-updated,
    // 而 applyViewModel 是整条重算管线(全图 map + 域洞察 + guidance)。连接器同步/批量导入
    // 一秒内派发几十次 → 每次都全量重算 = 10-45s 冻结。合并为 400ms 拖尾一次。
    let refreshTimer: number | null = null;
    const refreshSoon = () => {
      if (refreshTimer != null) return;
      refreshTimer = window.setTimeout(() => { refreshTimer = null; void applyViewModel(); }, 400);
    };
    // 卡片反馈 → 统一反馈总线扇出到所有订阅者(事实日志 + guidance-ranker + 三原语)。
    // reasoning-engine 保持无依赖叶子,走它派发的 nesio-feedback-recorded 事件;
    // 这里把旧动词翻成统一 FeedbackEvent schema(not_now→snooze)投进总线,不再手工直调各 learner。
    const toReaction = (v: string): Reaction =>
      v === 'useful' ? 'useful' : v === 'wrong' ? 'wrong' : v === 'too_much' ? 'too_much' : 'snooze';
    const onFeedback = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cardId?: string; feedback?: string } | undefined;
      if (detail?.cardId && detail.feedback) {
        emitFeedback({ surface: 'today', dimension: 'card', key: detail.cardId, reaction: toReaction(detail.feedback), at: new Date().toISOString() });
      }
      refresh();
    };
    // 图1:改昵称后要立刻在今天页称呼上生效 —— 否则「改了名却处处没变」被当成保存失败。
    const onProfile = () => {
      if (canUsePrivateData) setDisplayName(loadProfileSettings().displayName || '');
      refresh();
    };
    window.addEventListener('nesio-life-graph-updated', refreshSoon);
    window.addEventListener('nesio-connectors-refreshed', refreshSoon);
    window.addEventListener('nesio-weather-updated', refreshSoon);
    window.addEventListener('nesio-calendar-updated', refreshSoon);
    window.addEventListener('nesio-feedback-recorded', onFeedback);
    window.addEventListener(PROFILE_UPDATED_EVENT, onProfile);

    return () => {
      cancelled = true;
      if (emailPollInterval) clearInterval(emailPollInterval);
      gmailCleanup?.();
      if (refreshTimer != null) window.clearTimeout(refreshTimer);
      window.removeEventListener('nesio-life-graph-updated', refreshSoon);
      window.removeEventListener('nesio-connectors-refreshed', refreshSoon);
      window.removeEventListener('nesio-weather-updated', refreshSoon);
      window.removeEventListener('nesio-calendar-updated', refreshSoon);
      window.removeEventListener('nesio-feedback-recorded', onFeedback);
      window.removeEventListener(PROFILE_UPDATED_EVENT, onProfile);
    };
  }, [canUsePrivateData]);

  return {
    displayName,
    memoryCount, memoryNotes, todayReport,
    focusNodes, allNodes, receipt,
    dormantStore, setDormantStore,
    calendarEvents, proactiveContext,
    proactiveCards, setProactiveCards,
    dismissedCardIds, setDismissedCardIds,
  };
}
