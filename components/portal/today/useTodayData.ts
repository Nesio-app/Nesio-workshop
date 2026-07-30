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
import { autoPersistTodayReport, reportAnchor } from '@/lib/portal/daily-report-persist';
import { collectDailyReportExtras, outfitNoteFor, collectOrders } from '@/lib/portal/daily-report-sources';
import { buildTodayViewModel, type FocusNode, type ProactiveContext, type TodayReceipt } from '@/lib/platform/view-models/today-view-model';
import { readPortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';
import type { CalendarEvent } from '@/lib/portal/types';
import type { EmailSignal } from '@/lib/platform/email-signals';
import { loadDormantStore, evaluateDormancy, type DormantStore } from '@/lib/platform/dormant-engine';
import { emitFeedback, type Reaction } from '@/lib/platform/personalization';
import type { RecommendationCard } from '@/lib/portal/reasoning-engine';
import type { WeatherSnapshot } from '@/lib/portal/providers/weather';
import { listWardrobe, outfitFindings, inferFormalNeed } from '@/lib/portal/wardrobe';
import { gatherDomainInsights } from '@/lib/portal/domain-insights';
import {
  maybeRunJudgeBatch, loadLiveJudgedCards, judgeNeedsFallback, type JudgeWeatherInput,
} from '@/lib/portal/guidance-judge-auto';
import { buildFallbackCards } from '@/lib/platform/guidance-engine/fallback-cards';
import { resolveCardTarget } from '@/lib/portal/card-target';
import { listInventoryItems } from '@/lib/portal/inventory';
import { loadBankAccounts, loadPlaidLiabilities } from '@/lib/portal/bank-tx';
import { cloudSignalRowsToSignals, type CloudSignalRow } from '@/lib/life-domain/signal-search';
import { isProactiveCardDismissed, type ProactiveCardData } from './proactive-types';
import { isCardSuppressed, fingerprint } from '@/lib/portal/card-verdict';

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

        // ── AI 判决层(实弹,2026-07-29 用户拍板硬拆 —— 8 层规则管线已物理删除)──
        // 真机实锤的病灶:GitHub PR 邮件标题里的「健身」被 LEXICON.health 抓成「今天的健康打卡」
        // 还配了打卡按钮。正则不懂上下文 —— 分类路径全部拆除,信号原样进判决,AI 看得出那是 PR 通知。
        const calEvents = readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar)?.events ?? [];
        const weather = readPortalCache<WeatherSnapshot>(PORTAL_CACHE_KEYS.weather);

        const uiLocale = portalLocaleToDictionaryLocale(loadProfileSettings().locale);

        /* ── 每日日报(2026-07-30 跨面改版)────────────────────────────────
           私据门已在此 if(canUsePrivateData) 内 —— 取材日历/邮件/记忆/各域判定。

           **定稿口径 = 当天 08:00**(用户拍板「早上 8 点、当天不再变」)。
           PWA 没有可靠后台定时,所以做不到 8 点整跑一次;改成把 now 钉在 08:00 ——
           buildDailyReport 是纯函数,同样输入必然同样输出,钉死 now 就是定稿。
           10 点才打开也拿到「早上八点那份」,里面照样有 9 点那场会。
           早于 8 点则不出今天这份(reportDue 为假)—— 天没亮时当天的天气/邮件本来
           也没同步全,出一份半成品再在中午自己改口,正是用户抱怨的那件事。 */
        {
          const profile = loadProfileSettings();
          const anchor = reportAnchor(now);
          const todayEvents = calEvents.filter((e) => {
            const t = new Date(e.start).getTime();
            const d0 = new Date(anchor); d0.setHours(0, 0, 0, 0);
            const d1 = new Date(anchor); d1.setHours(23, 59, 59, 999);
            return Number.isFinite(t) && t >= d0.getTime() && t <= d1.getTime();
          });
          // 跨面取数:七个域走已有的单一判定源,另加提醒/健身/吃/在途订单。
          const extras = collectDailyReportExtras(anchor);
          const reportInput = {
            displayName: profile.displayName,
            now: anchor,
            locale: uiLocale,
            weather: weather ? { temperatureC: weather.temperatureC, condition: weather.condition, forecastNote: weather.forecastNote, tempMinC: weather.tempMinC, tempMaxC: weather.tempMaxC, precipProb: weather.precipProb } : undefined,
            events: calEvents.map((e) => ({ title: e.title, start: e.start, end: e.end, location: e.location, calendarName: e.calendarName })),
            emailHighlights: latestEmailSignals.map((s) => s.cardTitle || s.subject).filter(Boolean).slice(0, 3),
            memoryNotes: updated.memoryNotes.slice(0, 3),
            ...extras,
            // 穿什么要今天的天气 + 今天的日历当输入,这两样这里手上就有,
            // 不回存储再读一遍(会读到另一个快照)。
            outfitNote: outfitNoteFor(weather ?? undefined, todayEvents, anchor),
            // 用 updated.allNodes,不用 allNodes 那个 state —— 后者是**上一轮渲染**的值
            // (本轮的 setAllNodes 就在几行之前,还没生效),会让日报比列表慢一天。
            orders: collectOrders(updated.allNodes),
          };
          /* 这一页只负责**定稿落库**,不再往 Today 画卡(2026-07-30 用户定案:
             「今天不要入口,用弹出卡片,在洞察开入口」)。
             展示唯一在洞察页的 DailyReportPanel,而它**只读冻结件、不 build** ——
             这样「当天不再变」是硬的:没有任何一处会拿新数据现算一份出来。
             autoPersistTodayReport 内部自己会用 08:00 锚点 build 并判 due/空/当天已生成。 */
          autoPersistTodayReport(reportInput, { enabled: profile.dailyReportEnabled, now });
          // AI 判决(实弹):结构化信号批量送判,落 ledger;取数惰性(30min 闸后才算)。
          // 付费门双层:客户端 canUsePaidCloudAi 前置拦下(免费档不出网),路由端
          // guardAiRoute + requirePaidCloudAi 强制。llm-sweep 已被吸收拆除。
          if (canUsePaidCloudAi()) void maybeRunJudgeBatch(
            () => ({
              calendarEvents: calEvents,
              emailSignals: latestEmailSignals,
              inventoryItems: listInventoryItems(),
              domainInsights: gatherDomainInsights(),
              weather: weather as JudgeWeatherInput | null,
              // Plaid 负债:还款日是结构化字段,联表出账户名给判决用人话称呼
              plaidLiabilities: (() => {
                const names = new Map(loadBankAccounts().map((a) => [a.id, a.name]));
                return loadPlaidLiabilities().map((l) => ({ ...l, accountName: names.get(l.accountId) }));
              })(),
              // 记忆节点:只有带日期的进(替代 llm-sweep 的低置信巡查)
              memoryNodes: updated.focusNodes,
              // 其他产品面折成 domain 信号:DEC 深度发现 + 每日穿搭。
              // 刻意不喂:specialDays/healthItems(两条正则路径,就是「健身打卡」误判的病根;
              // 生日走 relationship 域的 person 节点数据,健康走 health 域判定)。
              extras: [
                ...updated.cards.map((c) => ({ id: c.id, domain: c.domainLabel || 'dec', title: c.title, detail: c.body })),
                ...(() => {
                  const w = weather as (WeatherSnapshot & { tempMinC?: number; tempMaxC?: number; precipProb?: number }) | null;
                  const todayCal = calEvents.filter((e) => e.start && new Date(e.start).toDateString() === now.toDateString());
                  return outfitFindings(listWardrobe(), {
                    repTempC: w?.tempMinC ?? w?.temperatureC ?? null,
                    tempMinC: w?.tempMinC ?? null,
                    tempMaxC: w?.tempMaxC ?? null,
                    precipProb: w?.precipProb ?? null,
                    formalNeed: inferFormalNeed(todayCal),
                  }, now.toISOString()).map((f) => ({ id: f.id, domain: 'outfit', title: f.title[0], detail: f.body[0] }));
                })(),
              ],
            }),
            { now, uiLocale: uiLocale === 'en' ? 'en' : undefined },
          );
        }
        // ── 出卡:ledger 窗口重算 + 三门(同步免费)。文案就是判决文案,润色层已拆。──
        const live = loadLiveJudgedCards(now, 3);
        // 走 icons.tsx 的具名键(不是 emoji)—— 渲染层 GuidanceIcon 查这张表出描边图标。
        const GROUP_ICON: Record<string, string> = { 日程: 'calendar', 财务: 'card', 健康: 'health', 物品: 'box', 人: 'person', 其他: 'idea' };
        let newProactiveCards: ProactiveCardData[] = live
          .map((c) => {
            const target = resolveCardTarget(c.fingerprints);
            return {
              id: `judge-${c.fingerprints[0]}`,
              title: c.title,
              body: c.body,
              confidence: 90,
              sourceTags: [],
              icon: GROUP_ICON[c.group] ?? 'idea',
              priority: c.severity * 3,
              urgent: c.severity === 3,
              cardType: c.group,
              // 指纹 = 源信号指纹(AI 文案不参与)—— 静音「事实没变就永远闭嘴」的锚。
              factKey: c.fingerprints[0],
              fingerprints: c.fingerprints,
              nodeId: target?.kind === 'node' ? target.nodeId : undefined,
              actions: [],
              reason: c.whyNow,
              expiresAt: `${c.showUntil}T23:59:59`,
            } satisfies ProactiveCardData;
          })
          .filter((c) => !isProactiveCardDismissed(c.id, c.factKey));
        // 事件到了当天的判决卡让位时间线(当天日程=时间线地盘;临近提醒由置顶卡承担)
        newProactiveCards = newProactiveCards.filter((c) => {
          const src = live.find((l) => l.fingerprints[0] === c.factKey);
          if (!src?.eventStartMs) return true;
          const d = new Date(src.eventStartMs);
          return !(d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate());
        });

        // 承诺④:AI 从没成功过/最近失败且没有任何窗口内判决 → 结构化兜底(零分类),
        // 可见地标注(sourceTags 含 fallback,渲染层据此亮「AI 判决暂不可用」行,不许静默降级)。
        if (newProactiveCards.length === 0 && judgeNeedsFallback(now)) {
          const names = new Map(loadBankAccounts().map((a) => [a.id, a.name]));
          newProactiveCards = buildFallbackCards({
            calendarEvents: calEvents
              .map((e) => ({ id: e.id, title: e.title, startMs: Date.parse(e.start), endMs: e.end ? Date.parse(e.end) : undefined }))
              // 当天=时间线地盘,兜底也只收明天的
              .filter((e) => !Number.isNaN(e.startMs) && new Date(e.startMs).getDate() !== now.getDate()),
            expiryItems: listInventoryItems().filter((i) => i.expiry).map((i) => ({ id: i.id, name: i.name, expiry: i.expiry! })),
            dueBills: loadPlaidLiabilities().map((l) => ({ id: l.accountId, account: names.get(l.accountId) || l.accountId, dueDate: l.dueDate, minPayment: l.minPayment })),
          }, now)
            .map((f) => ({
              id: f.id,
              title: f.title,
              body: f.body,
              confidence: 100,
              sourceTags: ['fallback'],
              icon: '📌',
              priority: f.severity * 3,
              urgent: f.severity === 3,
              cardType: '提醒',
              factKey: fingerprint(`${f.title}|${f.body}`),
              actions: [],
            } satisfies ProactiveCardData))
            .filter((c) => !isProactiveCardDismissed(c.id, c.factKey));
        // 事件到了当天的判决卡让位时间线(当天日程=时间线地盘;临近提醒由置顶卡承担)
        newProactiveCards = newProactiveCards.filter((c) => {
          const src = live.find((l) => l.fingerprints[0] === c.factKey);
          if (!src?.eventStartMs) return true;
          const d = new Date(src.eventStartMs);
          return !(d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate());
        });
        }
        // 用户裁决优先于一切:静音门已在 loadLiveJudgedCards 内执行;兜底卡也过一遍
        newProactiveCards = newProactiveCards
          .filter((c) => !isCardSuppressed({ cardId: c.id, cardType: c.cardType, factKey: c.factKey }, now));

        if (!stale() && newProactiveCards.length > 0) {
          // 批次 76(用户定案「不要闪来闪去」):合并不替换 —— 已在场的卡届内常驻。
          // 移除只有两条路:用户亲手划走 / 卡片自然过期(showUntil)。
          setProactiveCards((prev) => {
            const seen = new Set(prev.map((c) => c.id));
            return [...prev, ...newProactiveCards.filter((c) => !seen.has(c.id))].slice(0, 6);
          });
        }
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
    // 「再试一次」按钮:clearJudgeError() 已把错误与闸的水位清掉,这里只负责再跑一遍。
    window.addEventListener('nesio-today-refresh', refreshSoon);
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
      window.removeEventListener('nesio-today-refresh', refreshSoon);
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
    memoryCount, memoryNotes,
    focusNodes, allNodes, receipt,
    dormantStore, setDormantStore,
    calendarEvents, proactiveContext,
    proactiveCards, setProactiveCards,
    dismissedCardIds, setDismissedCardIds,
  };
}
