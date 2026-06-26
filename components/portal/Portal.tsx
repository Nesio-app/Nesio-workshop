'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import TodayFeed from './TodayFeed';
import MemoryTab from './MemoryTab';
import TellNesioSheet, { type CaptureMode } from './TellNesioSheet';
import CameraSheet from './CameraSheet';
import VoiceInputSheet from './VoiceInputSheet';
import ShareSheet from './ShareSheet';
import PortalBottomNav from './PortalBottomNav';
import PortalAiFriendsPreview from './PortalAiFriendsPreview';
import NotePanelEnhanced from './NotePanelEnhanced';
import PortalOnboarding from './PortalOnboarding';
import ToolsTreasurePopup from './ToolsTreasureSheet';
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
import { loadProfileSettings, PROFILE_UPDATED_EVENT, type PortalLocale } from '@/lib/portal/profile';
import type { PortalConfig, PortalDecMetadata, PortalTool } from '@/lib/portal/types';
import { type ToolForShellState } from './tool-state';

const DEC_METADATA_TTL_MS = 30_000;

type ActiveSurface = 'today' | 'tell' | 'memory';

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
  const [captureMode, setCaptureMode] = useState<CaptureMode | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [locale, setLocale] = useState<PortalLocale>('zh');
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

  useEffect(() => {
    setLaunchSurfaceContext(normalizeLaunchSurfaceContext(readLaunchSurfaceContextFromBrowser()));
    setLocale(loadProfileSettings().locale);
  }, []);

  useEffect(() => {
    const syncLocale = () => setLocale(loadProfileSettings().locale);
    window.addEventListener(PROFILE_UPDATED_EVENT, syncLocale);
    window.addEventListener('storage', syncLocale);
    return () => {
      window.removeEventListener(PROFILE_UPDATED_EVENT, syncLocale);
      window.removeEventListener('storage', syncLocale);
    };
  }, []);

  // Allow TodayFeed empty state / other surfaces to open Tell Nesio or capture directly
  useEffect(() => {
    const handler = () => setActiveSurface((s) => s === 'tell' ? 'today' : 'tell');
    const voiceHandler = () => setCaptureMode('voice');
    window.addEventListener('nesio-open-tell', handler);
    window.addEventListener('nesio-open-voice', voiceHandler);
    return () => {
      window.removeEventListener('nesio-open-tell', handler);
      window.removeEventListener('nesio-open-voice', voiceHandler);
    };
  }, []);

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

    fetch('/api/portal/calendar', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data && (data.events || data.feeds)) writePortalCache(PORTAL_CACHE_KEYS.calendar, data);
      })
      .catch(() => undefined);

    fetch('/api/portal/flomo?limit=48', { cache: 'no-store' }).catch(() => undefined);

    return () => { mounted = false; };
  }, []);

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

  return (
    <>
      <div className="portal-root portal-root--home">
        <div className="portal-grain" aria-hidden />
        <div className="nesio-shell">
          {activeSurface === 'today' && (
            <TodayFeed onOpenMemory={() => setActiveSurface('memory')} />
          )}
          {activeSurface === 'memory' && <MemoryTab />}
          {/* Keep legacy surfaces accessible via tools */}
          {activeSurface === 'tell' && (
            <TodayFeed onOpenMemory={() => setActiveSurface('memory')} />
          )}
        </div>

        <TellNesioSheet
          open={activeSurface === 'tell'}
          onClose={() => setActiveSurface('today')}
          onCapture={(mode) => setCaptureMode(mode)}
        />

        <PortalBottomNav
          activeSurface={activeSurface}
          locale={locale}
          onToday={() => setActiveSurface('today')}
          onTell={() => setActiveSurface(activeSurface === 'tell' ? 'today' : 'tell')}
          onMemory={() => setActiveSurface('memory')}
        />
      </div>

      {/* Capture sheets — rendered at root level, independent of TellNesioSheet state */}
      <CameraSheet open={captureMode === 'camera'} onClose={() => setCaptureMode(null)} />
      <VoiceInputSheet open={captureMode === 'voice'} onClose={() => setCaptureMode(null)} />
      <ShareSheet open={captureMode === 'share'} onClose={() => setCaptureMode(null)} />

      <NotePanelEnhanced open={noteOpen} onOpenChange={setNoteOpen} />
      <PortalOnboarding />
    </>
  );
}
