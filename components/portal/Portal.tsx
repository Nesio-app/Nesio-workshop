'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import dynamic from 'next/dynamic';
import TodayFeed from './TodayFeed';
import MemoryTab from './MemoryTab';
import TellNesioSheet, { type CaptureMode } from './TellNesioSheet';
import PortalBottomNav from './PortalBottomNav';
import PortalOnboarding from './PortalOnboarding';

// Heavy sheets load on first open, not at boot — together they were ~3.5k
// lines of first-paint JS for UI the user may never touch in a session.
const CameraSheet = dynamic(() => import('./CameraSheet'), { ssr: false });
const VoiceInputSheet = dynamic(() => import('./VoiceInputSheet'), { ssr: false });
const ShareSheet = dynamic(() => import('./ShareSheet'), { ssr: false });
const MoodSheet = dynamic(() => import('./MoodSheet'), { ssr: false });
const NesioChatSheet = dynamic(() => import('./NesioChatSheet'), { ssr: false });
const PortalAiFriendsPreview = dynamic(() => import('./PortalAiFriendsPreview'), { ssr: false });
const NotePanelEnhanced = dynamic(() => import('./NotePanelEnhanced'), { ssr: false });
const ToolsTreasurePopup = dynamic(() => import('./ToolsTreasureSheet'), { ssr: false });
import { DEFAULT_PORTAL_CONFIG } from '@/lib/portal/defaults';
import { openToolHref } from '@/lib/portal/open-tool';
import {
  applyFeatureControlToolGate,
  applyFirstLaunchToolGate,
  isToolKilledByLocalFeatureControl,
} from '@/lib/portal/launch-safety';
import { readLaunchSurfaceContextFromBrowser } from '@/lib/portal/launch-surface.mjs';
import {
  resolveShellRuntimeTools,
  shouldShellOpenTool,
} from '@/lib/portal/shell-runtime-resolver.mjs';
import { buildPortalShellManifest } from '@/lib/portal/module-manifest';
import {
  fetchDecModules,
  readDecDataError,
  type DecModulesPayload,
} from '@/lib/portal/dec-data-client';
import {
  PORTAL_CACHE_KEYS,
  readPortalCache,
  TREASURE_TOOLBOX_KEY,
  writePortalCache,
} from '@/lib/portal/prefetch-cache';
import { configUrl } from '@/lib/portal/paths';
import { saveCalendarToLocal } from '@/lib/portal/calendar-local-store';
import {
  importSupabaseHashSession,
  markNesioOnboardingDoneForAuth,
  NESIO_ONBOARDING_COMPLETE_EVENT,
} from '@/lib/portal/auth-client';
import { loadProfileSettings, portalLocaleToDictionaryLocale, PROFILE_UPDATED_EVENT, type PortalLocale } from '@/lib/portal/profile';
import { L } from '@/lib/portal/i18n';
import { usePortalLocale } from './use-portal-locale';
import { runConnectors } from '@/lib/platform/runtime/integration-runtime';
import { pruneDisposableSignals } from '@/lib/life-domain';
import { hydrateSignalFactStore } from '@/lib/life-domain/signal-read-cache';
import { prunePrivateExternalNodes } from '@/lib/portal/life-graph';
import { STORAGE_FULL_EVENT, STORAGE_WARNING_EVENT } from '@/lib/portal/storage-health';
import { track, installErrorTracking } from '@/lib/portal/telemetry';
import type { PortalConfig, PortalDecMetadata, PortalTool } from '@/lib/portal/types';
import { type ToolForShellState } from './tool-state';

const DEC_METADATA_TTL_MS = 30_000;
const FIRST_MEMORY_RECEIPT_KEY = 'nesio-first-memory-receipt-shown-v1';
const HAPTIC_FEEDBACK_KEY = 'nesio-haptic-feedback-enabled-v1';
const ASK_GUIDE_KEY = 'nesio-ask-guide-seen-v1';

type ActiveSurface = 'today' | 'tell' | 'memory';
type AuthSessionPayload = {
  ok?: boolean;
  loggedIn?: boolean;
  status?: string;
  authReady?: boolean;
  profileBootstrapBlocking?: boolean;
};

async function fetchAuthSessionPayload(): Promise<AuthSessionPayload | null> {
  const res = await fetch('/api/auth/session', { cache: 'no-store' });
  return res.ok ? (res.json() as Promise<AuthSessionPayload>) : null;
}

function AskGuideSheet({
  open,
  onClose,
  onStart,
}: {
  open: boolean;
  onClose: () => void;
  onStart: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  if (!open) return null;
  return (
    <div className="nesio-ask-guide" role="dialog" aria-modal="true" aria-label={L(dict, '问宝盒', 'Ask Nesio')}>
      <button type="button" className="nesio-ask-guide-backdrop" onClick={onClose} aria-label={L(dict, '关闭问宝盒引导', 'Close Ask Nesio guide')} />
      <div className="nesio-ask-guide-card">
        <div className="nesio-sheet-handle" aria-hidden />
        <p className="nesio-ask-guide-kicker">{L(dict, '长按中间按钮', 'Long-press the center button')}</p>
        <h2>{L(dict, '问宝盒', 'Ask Nesio')}</h2>
        <p>{L(dict, '找东西、找线索，也可以问下一步。比如：钥匙在哪里？生日快到了该买什么礼物？', "Find things, find clues, or ask what's next. Like: where are my keys? What gift before the birthday?")}</p>
        <div className="nesio-ask-guide-examples" aria-label={L(dict, '问宝盒示例', 'Ask Nesio examples')}>
          <span>{L(dict, '钥匙在哪里', 'Where are my keys')}</span>
          <span>{L(dict, 'Linda 生日买什么', "What to buy for Linda's birthday")}</span>
          <span>{L(dict, '上次买的药还有吗', 'Any of that medicine left')}</span>
        </div>
        <div className="nesio-ask-guide-actions">
          <button type="button" className="nesio-ob-primary-btn" onClick={onStart}>{L(dict, '开始问宝盒', 'Start asking')}</button>
          <button type="button" className="nesio-ask-guide-later" onClick={onClose}>{L(dict, '稍后', 'Later')}</button>
        </div>
      </div>
    </div>
  );
}

function normalizeLaunchSurfaceContext(raw: {
  viewerRole?: unknown;
  testerAllowlist?: unknown;
  testerCohort?: unknown;
}) {
  return {
    viewerRole:
      raw.viewerRole === 'personal_lab'
        ? ('personal_lab' as const)
        : raw.viewerRole === 'tester'
          ? ('tester' as const)
          : ('public' as const),
    testerAllowlist: Array.isArray(raw.testerAllowlist)
      ? raw.testerAllowlist.filter((item): item is string => typeof item === 'string')
      : [],
    testerCohort: typeof raw.testerCohort === 'string' ? raw.testerCohort : null,
  };
}

function parseDecMetaFromModules(payload: DecModulesPayload): Map<string, PortalDecMetadata> {
  const map = new Map<string, PortalDecMetadata>();
  if (!payload.ok || !('modules' in payload) || !Array.isArray(payload.modules)) return map;
  for (const entry of payload.modules) {
    if (!entry || typeof entry !== 'object') continue;
    const moduleId =
      typeof (entry as { moduleId?: unknown }).moduleId === 'string'
        ? (entry as { moduleId?: string }).moduleId!
        : '';
    const mode =
      typeof (entry as { mode?: unknown }).mode === 'string'
        ? (entry as { mode?: string }).mode!
        : '';
    if (!moduleId || !mode) continue;
    const n = entry as {
      dependencyCount?: unknown;
      ownedData?: unknown;
      emittedEvents?: unknown;
      approvalRequiredActions?: unknown;
      dependencyDataKeys?: unknown;
    };
    map.set(moduleId, {
      moduleId,
      mode,
      dependencyCount: typeof n.dependencyCount === 'number' ? n.dependencyCount : undefined,
      ownedDataCount: Array.isArray(n.ownedData) ? n.ownedData.length : undefined,
      emittedEventsCount: Array.isArray(n.emittedEvents) ? n.emittedEvents.length : undefined,
      approvalActionCount: Array.isArray(n.approvalRequiredActions) ? n.approvalRequiredActions.length : undefined,
      dependencyDataKeys: Array.isArray(n.dependencyDataKeys) ? n.dependencyDataKeys : undefined,
    });
  }
  return map;
}

function parseDecShellRoutesFromModules(
  payload: DecModulesPayload,
): Map<string, Pick<ToolForShellState, 'entryStatus' | 'modeAvailability' | 'emptyStateKey' | 'approvalGateKeys'>> {
  const routes = new Map<
    string,
    Pick<ToolForShellState, 'entryStatus' | 'modeAvailability' | 'emptyStateKey' | 'approvalGateKeys'>
  >();
  if (!payload.ok || !payload.shellRoutes || !Array.isArray(payload.shellRoutes.routes)) return routes;
  for (const route of payload.shellRoutes.routes) {
    if (!route || typeof route !== 'object') continue;
    const moduleId =
      typeof (route as { moduleId?: unknown }).moduleId === 'string'
        ? (route as { moduleId?: string }).moduleId!
        : '';
    if (!moduleId) continue;
    routes.set(moduleId, {
      entryStatus: (route as { entryStatus?: unknown }).entryStatus,
      modeAvailability: (route as { modeAvailability?: unknown }).modeAvailability,
      emptyStateKey: (route as { emptyStateKey?: unknown }).emptyStateKey,
      approvalGateKeys: (route as { approvalGateKeys?: unknown }).approvalGateKeys,
    });
  }
  return routes;
}

function mergePortalConfigWithDecMetadata(
  config: PortalConfig,
  moduleMeta: Map<string, PortalDecMetadata>,
): PortalConfig {
  if (!moduleMeta.size) return config;
  return {
    ...config,
    tools: config.tools.map((tool) => {
      const meta = moduleMeta.get(tool.id);
      return meta ? { ...tool, decMeta: meta } : tool;
    }),
  };
}

export default function Portal() {
  const [config, setConfig] = useState<PortalConfig>(DEFAULT_PORTAL_CONFIG);
  const [decModules, setDecModules] = useState<Map<string, PortalDecMetadata>>(new Map());
  const [decShellRoutes, setDecShellRoutes] = useState<
    ReturnType<typeof parseDecShellRoutesFromModules>
  >(new Map());
  const [activeSurface, setActiveSurface] = useState<ActiveSurface>('today');
  const [storageAlert, setStorageAlert] = useState<{ kind: 'full' | 'warning'; percent: number } | null>(null);
  const [captureMode, setCaptureMode] = useState<CaptureMode | null>(null);

  // 批次 7:iOS PWA 后台驻留页面从不重载,用户会停在几天前的旧 UI。
  // 回到前台时对比部署版本,变了就整页刷新(间隔 ≥60s,不打扰输入中的表单:
  // 仅在没有打开任何 sheet/输入焦点时刷)。
  useEffect(() => {
    let known = '';
    let lastCheck = 0;
    const check = async () => {
      if (Date.now() - lastCheck < 60_000) return;
      lastCheck = Date.now();
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        const data = await res.json() as { v?: string };
        if (!data.v || data.v === 'dev') return;
        if (!known) { known = data.v; return; }
        if (data.v !== known) {
          const typing = document.activeElement instanceof HTMLInputElement
            || document.activeElement instanceof HTMLTextAreaElement;
          if (!typing) window.location.reload();
        }
      } catch { /* offline 等下次 */ }
    };
    void check();
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  // 拍一下直达:扇形按钮同手势调起原生相机,拍完的文件直接进 CameraSheet
  const [cameraFile, setCameraFile] = useState<File | null>(null);
  const [voiceIntent, setVoiceIntent] = useState<'note' | 'ask'>('note');
  const [noteOpen, setNoteOpen] = useState(false);
  const [locale, setLocale] = useState<PortalLocale>('zh');
  const dict = portalLocaleToDictionaryLocale(locale);
  const [authReady, setAuthReady] = useState(false);
  // 批次 14 数据完整性:会话接口网络失败/非 200 时不能当「未登录」——
  // 此前任何一次瞬时失败都会触发 prunePrivateExternalNodes 硬删日历/邮件
  // 节点(项目里引用的也跟着消失),下次重新同步 createdAt 全新 → 列表大洗牌。
  // 三态:true=确定登录 / false=服务器明确说未登录 / null=未知(网络问题),
  // 未知态既不跑连接器也不删数据。
  const [authDefinitelyAnonymous, setAuthDefinitelyAnonymous] = useState(false);
  const [authSessionLoggedIn, setAuthSessionLoggedIn] = useState(false);
  const [onboardingActive, setOnboardingActive] = useState(false);
  const [memoryReceipt, setMemoryReceipt] = useState(false);
  const [askGuideOpen, setAskGuideOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [moodOpen, setMoodOpen] = useState(false);
  const [launchSurfaceContext, setLaunchSurfaceContext] = useState({
    viewerRole: 'public' as 'public' | 'tester' | 'personal_lab',
    testerAllowlist: [] as string[],
    testerCohort: null as string | null,
  });

  const configWithDecMetadata = useMemo(
    () => mergePortalConfigWithDecMetadata(config, decModules),
    [config, decModules],
  );

  const configWithShellState = useMemo(() => {
    const tools = configWithDecMetadata.tools.map((rawTool) => {
      const tool = applyFeatureControlToolGate(applyFirstLaunchToolGate(rawTool));
      const shellState = decShellRoutes.get(tool.id);
      const mergedTool = shellState ? ({ ...tool, ...shellState } as ToolForShellState) : tool;
      return applyFeatureControlToolGate(applyFirstLaunchToolGate(mergedTool));
    });
    return { ...configWithDecMetadata, tools };
  }, [configWithDecMetadata, decShellRoutes]);

  const shellManifest = useMemo(
    () => buildPortalShellManifest(configWithShellState),
    [configWithShellState],
  );
  const shellRuntime = useMemo(
    () => resolveShellRuntimeTools(shellManifest.tools, launchSurfaceContext),
    [shellManifest.tools, launchSurfaceContext],
  );
  const canUsePrivateRuntime = authReady && authSessionLoggedIn;

  useEffect(() => {
    setLaunchSurfaceContext(normalizeLaunchSurfaceContext(readLaunchSurfaceContextFromBrowser()));
    setLocale(loadProfileSettings().locale);
  }, []);

  // 服务器授予的访问角色(权限管理):登录后领取,只增不减地并入
  // 浏览器侧上下文(personal_lab > tester > public;flags=true 的模块
  // 进 testerAllowlist)。管理员在 /admin 改角色,用户下次加载生效。
  useEffect(() => {
    if (!canUsePrivateRuntime) return;
    let cancelled = false;
    void fetch('/api/portal/access', { credentials: 'same-origin' })
      .then((res) => res.json() as Promise<{ ok?: boolean; role?: string; featureFlags?: Record<string, boolean> }>)
      .then((access) => {
        if (cancelled || !access?.ok) return;
        const rank = { public: 0, tester: 1, personal_lab: 2 } as const;
        const serverRole = access.role === 'personal_lab' ? 'personal_lab' : access.role === 'tester' ? 'tester' : 'public';
        const grantedModules = Object.entries(access.featureFlags || {})
          .filter(([, on]) => on === true)
          .map(([id]) => id);
        setLaunchSurfaceContext((prev) => ({
          ...prev,
          viewerRole: rank[serverRole] > rank[prev.viewerRole] ? serverRole : prev.viewerRole,
          testerAllowlist: Array.from(new Set([...prev.testerAllowlist, ...grantedModules])),
        }));
      })
      .catch(() => { /* 领取失败按本机上下文继续 */ });
    return () => { cancelled = true; };
  }, [canUsePrivateRuntime]);

  useEffect(() => {
    const onOnboardingVisibility = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean }>).detail;
      setOnboardingActive(Boolean(detail?.active));
    };
    window.addEventListener('nesio-onboarding-visibility-change', onOnboardingVisibility);
    return () => window.removeEventListener('nesio-onboarding-visibility-change', onOnboardingVisibility);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onMemoryReceived = () => {
      try {
        if (localStorage.getItem(FIRST_MEMORY_RECEIPT_KEY) === '1') return;
        localStorage.setItem(FIRST_MEMORY_RECEIPT_KEY, '1');
        if (localStorage.getItem(HAPTIC_FEEDBACK_KEY) !== '0') {
          navigator.vibrate?.(18);
        }
      } catch {
        navigator.vibrate?.(18);
      }
      setMemoryReceipt(true);
      timer = setTimeout(() => setMemoryReceipt(false), 1800);
    };
    window.addEventListener('nesio-memory-received', onMemoryReceived);
    return () => {
      window.removeEventListener('nesio-memory-received', onMemoryReceived);
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshAuthSession = () => {
      fetchAuthSessionPayload()
        .then((data) => {
          if (cancelled) return;
          const loggedIn = Boolean(data?.loggedIn);
          const sessionReady = loggedIn && data?.authReady !== false && data?.profileBootstrapBlocking !== true;
          setAuthSessionLoggedIn(loggedIn);
          // data 为 null(接口非 200)= 未知,不算「确定未登录」
          setAuthDefinitelyAnonymous(data != null && !loggedIn);
          if (sessionReady) {
            try {
              markNesioOnboardingDoneForAuth();
              window.dispatchEvent(new CustomEvent(NESIO_ONBOARDING_COMPLETE_EVENT, { detail: data }));
            } catch {
              // Auth state is still valid; local onboarding persistence is best-effort.
            }
          }
        })
        .catch(() => {
          // 网络失败 = 未知,不触发数据清理
          if (!cancelled) { setAuthSessionLoggedIn(false); setAuthDefinitelyAnonymous(false); }
        })
        .finally(() => {
          if (!cancelled) setAuthReady(true);
        });
    };
    importSupabaseHashSession()
      .catch(() => ({ imported: false, ok: false }))
      .then(() => refreshAuthSession())
      .catch(() => {
        if (!cancelled) setAuthSessionLoggedIn(false);
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });

    window.addEventListener('nesio-auth-session-ready', refreshAuthSession);
    window.addEventListener('nesio-auth-session-imported', refreshAuthSession);
    return () => {
      cancelled = true;
      window.removeEventListener('nesio-auth-session-ready', refreshAuthSession);
      window.removeEventListener('nesio-auth-session-imported', refreshAuthSession);
    };
  }, []);

  // Platform Runtime: the shell drives Integration collection + Pruning.
  // The Experience layer (Today) only consumes results, never calls connectors.
  useEffect(() => {
    if (!authReady) return;
    pruneDisposableSignals();
    // M3 读切换:回填 + 删除传导 + 水合事实缓存(见 signal-read-cache.ts)
    void hydrateSignalFactStore();
    if (!canUsePrivateRuntime) {
      // 只有服务器明确说「未登录」才清私有节点;未知态(网络抖动/超时)
      // 绝不删数据——删了的节点在项目里的引用会一起消失,且重新同步后
      // createdAt 全变导致列表重排(批次 14 用户报的三个数据问题同根)。
      if (authDefinitelyAnonymous) {
        const removed = prunePrivateExternalNodes();
        if (removed > 0) track('private_prune', { removed });
      }
      try {
        sessionStorage.removeItem(PORTAL_CACHE_KEYS.calendar);
      } catch { /* ignore unavailable storage */ }
      return;
    }
    runConnectors().catch(() => undefined);
  }, [authReady, canUsePrivateRuntime, authDefinitelyAnonymous]);

  useEffect(() => {
    const syncLocale = () => setLocale(loadProfileSettings().locale);
    window.addEventListener(PROFILE_UPDATED_EVENT, syncLocale);
    window.addEventListener('storage', syncLocale);
    return () => {
      window.removeEventListener(PROFILE_UPDATED_EVENT, syncLocale);
      window.removeEventListener('storage', syncLocale);
    };
  }, []);

  // Telemetry: app open + global error hooks (event counts only, no content)
  useEffect(() => {
    installErrorTracking();
    track('app_open');
    // Offline shell: data is local, so a cached shell = readable memories offline
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  // Storage quota alerts — a dropped write must never be silent
  useEffect(() => {
    const onFull = (e: Event) => {
      const detail = (e as CustomEvent<{ percent?: number }>).detail;
      setStorageAlert({ kind: 'full', percent: detail?.percent ?? 100 });
    };
    const onWarning = (e: Event) => {
      const detail = (e as CustomEvent<{ percent?: number }>).detail;
      setStorageAlert((prev) => prev?.kind === 'full' ? prev : { kind: 'warning', percent: detail?.percent ?? 80 });
    };
    window.addEventListener(STORAGE_FULL_EVENT, onFull);
    window.addEventListener(STORAGE_WARNING_EVENT, onWarning);
    return () => {
      window.removeEventListener(STORAGE_FULL_EVENT, onFull);
      window.removeEventListener(STORAGE_WARNING_EVENT, onWarning);
    };
  }, []);

  // Allow TodayFeed empty state / other surfaces to open Tell Nesio or capture directly
  useEffect(() => {
    const handler = () => setActiveSurface((s) => s === 'tell' ? 'today' : 'tell');
    const voiceHandler = () => { track('capture_voice_open'); setCaptureMode('voice'); };
    const moodHandler = () => { track('mood_open'); setMoodOpen(true); };
    window.addEventListener('nesio-open-tell', handler);
    window.addEventListener('nesio-open-voice', voiceHandler);
    window.addEventListener('nesio-open-mood', moodHandler);
    return () => {
      window.removeEventListener('nesio-open-tell', handler);
      window.removeEventListener('nesio-open-voice', voiceHandler);
      window.removeEventListener('nesio-open-mood', moodHandler);
    };
  }, []);

  // Handle OAuth callbacks from connectors (Calendar, Gmail)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // Gmail callback: ?connector=gmail&status=connected
    const connector = params.get('connector');
    const status = params.get('status');

    // Calendar callback: ?calendar=google_oauth_connected&status=calendar_session_established
    const calendarParam = params.get('calendar');
    const calendarStatus = params.get('status') || '';

    const oauthError = params.get('error');

    // Detect calendar connection
    const calendarConnected = calendarParam === 'google_oauth_connected' ||
      calendarStatus === 'calendar_session_established';

    if (!connector && !calendarParam) return;
    if (!authReady) return;

    // Clean URL immediately
    params.delete('connector'); params.delete('status'); params.delete('error');
    params.delete('calendar'); params.delete('safePublicStatus'); params.delete('secretsRedacted');
    const qs = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);

    function saveConnector(id: string) {
      try {
        const saved = JSON.parse(localStorage.getItem('nesio-connectors-v1') || '{}');
        saved[id] = true;
        localStorage.setItem('nesio-connectors-v1', JSON.stringify(saved));
      } catch { /* ignore */ }
    }

    function triggerCalendarRefresh() {
      if (!canUsePrivateRuntime) return;
      setTimeout(() => {
        fetch('/api/portal/calendar', { cache: 'no-store' })
          .then((r) => r.json())
          .then((data: { events?: Array<{
            id?: string; title?: string; start?: string; end?: string;
            description?: string; location?: string; url?: string; calendarName?: string;
          }>; feeds?: unknown }) => {
            if (data?.events || data?.feeds) {
              import('@/lib/portal/prefetch-cache').then(({ writePortalCache, PORTAL_CACHE_KEYS }) => {
                writePortalCache(PORTAL_CACHE_KEYS.calendar, data);
              });
              if (Array.isArray(data.events) && data.events.length > 0) {
                saveCalendarToLocal(data.events);
              }
              // Save upcoming events (next 7 days) as LifeGraph event nodes so they appear in memory/focus
              if (Array.isArray(data.events) && data.events.length > 0) {
                import('@/lib/portal/life-graph').then(({ getLifeGraph }) => {
                  const now = Date.now();
                  const week = now + 60 * 86_400_000;
                  const existing = getLifeGraph();
                  const existingCalIds = new Set(
                    existing.filter((n) => n.source === 'calendar').map((n) => n.attributes.calendarId as string).filter(Boolean)
                  );
                  data.events!.forEach((ev) => {
                    if (!ev.start || !ev.title) return;
                    const t = new Date(ev.start).getTime();
                    if (t < now - 86_400_000 || t > week) return;
                    const calId = ev.id || `${ev.title}-${ev.start}`;
                    if (existingCalIds.has(calId)) return; // already saved
                    ingestLifeNode({
                      name: ev.title,
                      type: 'event',
                      source: 'calendar',
                      confidence: 1,
                      rawInput: ev.title,
                      tags: [ev.calendarName || '日历'].filter(Boolean),
                      attributes: {
                        start: ev.start,
                        ...(ev.end ? { end: ev.end } : {}),
                        ...(ev.url ? { url: ev.url } : {}),
                        ...(ev.location ? { location: ev.location } : {}),
                        ...(ev.description ? { note: ev.description.slice(0, 300) } : {}),
                        calendarId: calId,
                        calendarName: ev.calendarName || '',
                      },
                      relations: [],
                    });
                  });
                  window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
                });
              }
              window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
            }
          })
          .catch(() => undefined);
      }, 500);
    }

    // Handle Calendar OAuth callback (?calendar=google_oauth_connected)
    if (calendarConnected) {
      // Save connector state unconditionally — doesn't require Supabase auth
      saveConnector('calendar');
      // BUG FIX(批次 5):Gmail 授权回调同时带 calendar 参数,这里曾提前 return,
      // 发起授权的 connector(gmail)标记永远没写 → UI 一直显示「接入」。
      // Google 一次授权覆盖日历+邮件,两个标记一起写,合并入口 google 也写。
      if (status === 'connected' && connector) saveConnector(connector);
      saveConnector('google');
      window.dispatchEvent(new CustomEvent('nesio-connector-connected', { detail: { connector: connector || 'calendar' } }));
      if (canUsePrivateRuntime) triggerCalendarRefresh();
      return;
    }

    if (status === 'connected' && connector) {
      // Save connector state unconditionally — localStorage doesn't need auth
      saveConnector(connector);
      window.dispatchEvent(new CustomEvent('nesio-connector-connected', { detail: { connector } }));

      // API-level sync requires auth
      if (!canUsePrivateRuntime) return;

      // Auto-sync Gmail after OAuth (with full body analysis)
      if (connector === 'gmail') {
        // Clear throttle so OAuth reconnect always triggers a fresh sync
        localStorage.removeItem('nesio-gmail-last-sync');
        setTimeout(() => {
          fetch('/api/portal/gmail?includeBody=true&analyze=true')
            .then((r) => r.json())
            .then((data: { ok?: boolean; nodes?: Array<Record<string, unknown>>; count?: number }) => {
              if (data.ok && data.nodes?.length) {
                import('@/lib/portal/life-graph').then(({ addLifeNode }) => {
                  data.nodes!.forEach((n) => ingestLifeNode({ source: 'email', ...n } as Parameters<typeof addLifeNode>[0]));
                  window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
                });
              }
            })
            .catch(() => undefined);
        }, 1000);
      }

      if (connector === 'calendar') {
        triggerCalendarRefresh();
      }
    } else if (oauthError) {
      console.warn(`[nesio] connector ${connector} oauth error:`, oauthError);
    }
  }, [authReady, canUsePrivateRuntime]);

  useEffect(() => {
    fetch(configUrl())
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PortalConfig | null) => {
        if (data?.tools?.length) setConfig(data);
      })
      .catch(() => undefined);

    const cachedDecModules = readPortalCache<DecModulesPayload>(PORTAL_CACHE_KEYS.decModules);
    if (cachedDecModules?.ok) {
      setDecModules(parseDecMetaFromModules(cachedDecModules));
      setDecShellRoutes(parseDecShellRoutesFromModules(cachedDecModules));
    }

    let mounted = true;
    void fetchDecModules({ force: false, ttl: DEC_METADATA_TTL_MS })
      .then((payload) => {
        if (!mounted || payload.ok === false) return;
        const map = parseDecMetaFromModules(payload);
        const shellRouteMap = parseDecShellRoutesFromModules(payload);
        setDecModules(map);
        setDecShellRoutes(shellRouteMap);
        if (map.size) writePortalCache(PORTAL_CACHE_KEYS.decModules, payload);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        console.error('DEC modules prefetch failed:', readDecDataError(error));
      });

    if (canUsePrivateRuntime) {
      // Calendar: fetch → cache + save upcoming 7-day events to LifeGraph
      fetch('/api/portal/calendar', { cache: 'no-store' })
        .then((r) => r.json())
        .then((data: { ok?: boolean; events?: Array<{
          id?: string; title?: string; start?: string; end?: string;
          description?: string; location?: string; url?: string; calendarName?: string;
        }>; feeds?: unknown }) => {
          if (!data?.events && !data?.feeds) return;
          writePortalCache(PORTAL_CACHE_KEYS.calendar, data);
          if (Array.isArray(data.events) && data.events.length > 0) {
            saveCalendarToLocal(data.events);
          }
          if (!Array.isArray(data.events) || data.events.length === 0) return;
          import('@/lib/portal/life-graph').then(({ getLifeGraph }) => {
            const now = Date.now();
            const week = now + 60 * 86_400_000;
            const existing = getLifeGraph();
            const existingCalIds = new Set(
              existing.filter((n) => n.source === 'calendar')
                .map((n) => n.attributes.calendarId as string).filter(Boolean),
            );
            let added = 0;
            data.events!.forEach((ev) => {
              if (!ev.start || !ev.title) return;
              const t = new Date(ev.start).getTime();
              if (t < now - 86_400_000 || t > week) return;
              const calId = ev.id || `${ev.title}-${ev.start}`;
              if (existingCalIds.has(calId)) return;
              ingestLifeNode({
                name: ev.title,
                type: 'event',
                source: 'calendar',
                confidence: 1,
                rawInput: ev.title,
                tags: [ev.calendarName || '日历'].filter(Boolean),
                attributes: {
                  start: ev.start,
                  ...(ev.end ? { end: ev.end } : {}),
                  ...(ev.url ? { url: ev.url } : {}),
                  ...(ev.location ? { location: ev.location } : {}),
                  ...(ev.description ? { note: ev.description.slice(0, 300) } : {}),
                  calendarId: calId,
                  calendarName: ev.calendarName || '',
                },
                relations: [],
              });
              added++;
            });
            if (added > 0) window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
          });
        })
        .catch(() => undefined);

      // Gmail: auto-sync on app load if connected and not synced recently (6h throttle)
      try {
        const connectors = JSON.parse(localStorage.getItem('nesio-connectors-v1') || '{}') as Record<string, boolean>;
        const lastSync = parseInt(localStorage.getItem('nesio-gmail-last-sync') || '0', 10);
        const SIX_HOURS = 6 * 60 * 60 * 1000;
        if (connectors.gmail && Date.now() - lastSync > SIX_HOURS) {
          fetch('/api/portal/gmail?includeBody=true&analyze=true')
            .then((r) => r.json())
            .then((data: { ok?: boolean; nodes?: Array<Record<string, unknown>> }) => {
              if (data.ok && data.nodes?.length) {
                localStorage.setItem('nesio-gmail-last-sync', String(Date.now()));
                import('@/lib/portal/life-graph').then(({ addLifeNode }) => {
                  data.nodes!.forEach((n) => ingestLifeNode({ source: 'email', ...n } as Parameters<typeof addLifeNode>[0]));
                  window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
                });
              }
            })
            .catch(() => undefined);
        }
      } catch { /* localStorage unavailable */ }
    }

    fetch('/api/portal/flomo?limit=48', { cache: 'no-store' }).catch(() => undefined);

    return () => { mounted = false; };
  }, [canUsePrivateRuntime]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const noteParam = params.get('note');
    if (noteParam === '1' || noteParam === 'open') {
      setNoteOpen(true);
      params.delete('note');
      const qs = params.toString();
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`,
      );
    }
  }, []);

  const openTool = useCallback(
    (tool: PortalTool) => {
      const runtimeTool = resolveShellRuntimeTools([tool], launchSurfaceContext).tools[0];
      if (!shouldShellOpenTool(runtimeTool?.shellRuntime)) return;
      if (isToolKilledByLocalFeatureControl(tool)) return;
      const href = openToolHref(tool, launchSurfaceContext);
      if (!href) return;
      window.location.assign(href);
    },
    [launchSurfaceContext],
  );

  const openAskVoice = useCallback(() => {
    try {
      localStorage.setItem(ASK_GUIDE_KEY, '1');
    } catch { /* ignore unavailable storage */ }
    setAskGuideOpen(false);
    setActiveSurface('today');
    setVoiceIntent('ask');
    setCaptureMode('voice');
  }, []);

  const handleAskFromCenterButton = useCallback(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(ASK_GUIDE_KEY) === '1';
    } catch { /* ignore unavailable storage */ }
    if (!seen) {
      setAskGuideOpen(true);
      return;
    }
    openAskVoice();
  }, [openAskVoice]);

  return (
    <>
      <div className="portal-root portal-root--home">
        <div className="portal-grain" aria-hidden />
        {storageAlert && (
          <div
            role="alert"
            style={{
              position: 'fixed', top: 8, left: 12, right: 12, zIndex: 300,
              background: 'var(--status-risk-soft)', border: '1px solid var(--status-risk)',
              borderRadius: 12, padding: '0.6rem 0.9rem', fontSize: '0.8rem',
              color: 'var(--status-risk, #d33)', display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <span style={{ flex: 1 }}>
              {storageAlert.kind === 'full'
                ? L(dict, `本机空间满了，新的记忆暂时存不进来。先在设置里导出一份备份，再清理一些照片，就能继续保存。`, 'Local storage is full — new memories cannot be saved. Export a backup in Settings, clear some photos, and saving resumes.')
                : L(dict, `本机空间已用 ${storageAlert.percent}%。方便的时候导出一份备份，之后就不用惦记这件事了。`, `Local storage is ${storageAlert.percent}% used. Export a backup when convenient and stop worrying about it.`)}
            </span>
            <button
              type="button"
              onClick={() => setStorageAlert(null)}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1rem', padding: 0 }}
              aria-label={L(dict, '关闭存储警告', 'Dismiss storage warning')}
            >✕</button>
          </div>
        )}
        <div className="nesio-shell">
          {!onboardingActive && activeSurface === 'today' && (
            <TodayFeed canUsePrivateData={canUsePrivateRuntime} onOpenMemory={() => setActiveSurface('memory')} />
          )}
          {!onboardingActive && activeSurface === 'memory' && <MemoryTab canUsePrivateData={canUsePrivateRuntime} />}
          {!onboardingActive && activeSurface === 'tell' && (
            <TodayFeed canUsePrivateData={canUsePrivateRuntime} onOpenMemory={() => setActiveSurface('memory')} />
          )}
        </div>

        <TellNesioSheet
          open={activeSurface === 'tell'}
          onClose={() => setActiveSurface('today')}
          onCapture={(mode, file) => {
            if (mode === 'voice') setVoiceIntent('note');
            if (mode === 'camera') setCameraFile(file ?? null);
            setCaptureMode(mode);
          }}
        />

        {!onboardingActive && (
          <PortalBottomNav
            activeSurface={activeSurface}
            locale={locale}
            onToday={() => setActiveSurface('today')}
            onTell={() => setActiveSurface(activeSurface === 'tell' ? 'today' : 'tell')}
            onAsk={handleAskFromCenterButton}
            onMemory={() => setActiveSurface('memory')}
            onChatOpen={() => setChatOpen(true)}
          />
        )}
      </div>

      {/* Capture sheets — rendered at root level, independent of TellNesioSheet state */}
      <CameraSheet open={captureMode === 'camera'} initialFile={cameraFile} onClose={() => { setCaptureMode(null); setCameraFile(null); }} />
      <VoiceInputSheet
        open={captureMode === 'voice'}
        intent={voiceIntent}
        canUsePrivateData={canUsePrivateRuntime}
        onClose={() => { setCaptureMode(null); setVoiceIntent('note'); }}
      />
      <ShareSheet open={captureMode === 'share'} onClose={() => setCaptureMode(null)} />
      <MoodSheet open={moodOpen} onClose={() => setMoodOpen(false)} />
      <AskGuideSheet open={askGuideOpen} onClose={() => setAskGuideOpen(false)} onStart={openAskVoice} />

      <NesioChatSheet open={chatOpen} onClose={() => setChatOpen(false)} canUsePrivateData={canUsePrivateRuntime} />
      <NotePanelEnhanced open={noteOpen} onOpenChange={setNoteOpen} />
      {memoryReceipt && (
        <div className="nesio-memory-receipt" role="status" aria-live="polite">
          <span className="nesio-memory-receipt-crystal" aria-hidden />
          <span>{L(dict, '收好了，以后可以找回来。', 'Tucked away — you can find it again later.')}</span>
        </div>
      )}
      <PortalOnboarding />
    </>
  );
}
