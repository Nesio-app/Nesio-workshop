'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import DashboardHome from './DashboardHome';
import NotePanelEnhanced from './NotePanelEnhanced';
import PortalQuickChat from './PortalQuickChat';
import { DEFAULT_PORTAL_CONFIG } from '@/lib/portal/defaults';
import { openToolHref } from '@/lib/portal/open-tool';
import {
  applyFeatureControlToolGate,
  applyFirstLaunchToolGate,
  isToolKilledByLocalFeatureControl,
} from '@/lib/portal/launch-safety';
import {
  readLaunchSurfaceContextFromBrowser,
} from '@/lib/portal/launch-surface.mjs';
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
import type { PortalConfig, PortalDecMetadata, PortalTool } from '@/lib/portal/types';
import { type ToolForShellState } from './tool-state';

const DEC_METADATA_TTL_MS = 30_000;

function normalizeLaunchSurfaceContext(raw: {
  viewerRole?: unknown;
  testerAllowlist?: unknown;
  testerCohort?: unknown;
}) {
  return {
    viewerRole: raw.viewerRole === 'personal_lab'
      ? 'personal_lab' as const
      : raw.viewerRole === 'tester' ? 'tester' as const : 'public' as const,
    testerAllowlist: Array.isArray(raw.testerAllowlist)
      ? raw.testerAllowlist.filter((item): item is string => typeof item === 'string')
      : [],
    testerCohort: typeof raw.testerCohort === 'string' ? raw.testerCohort : null,
  };
}

function readTreasureOpen(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    return sessionStorage.getItem(TREASURE_TOOLBOX_KEY) === '1';
  } catch {
    return false;
  }
}

function setTreasurePersisted(open: boolean) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (open) sessionStorage.setItem(TREASURE_TOOLBOX_KEY, '1');
    else sessionStorage.removeItem(TREASURE_TOOLBOX_KEY);
  } catch {
    /* ignore */
  }
}

function parseDecMetaFromModules(payload: DecModulesPayload): Map<string, PortalDecMetadata> {
  const moduleMeta = new Map<string, PortalDecMetadata>();
  if (!payload.ok || !('modules' in payload) || !Array.isArray(payload.modules)) return moduleMeta;

  for (const entry of payload.modules) {
    if (!entry || typeof entry !== 'object') continue;
    const moduleId = typeof (entry as { moduleId?: unknown }).moduleId === 'string'
      ? (entry as { moduleId?: string }).moduleId
      : '';
    const mode = typeof (entry as { mode?: unknown }).mode === 'string'
      ? (entry as { mode?: string }).mode
      : '';
    if (!moduleId || !mode) continue;

    const normalized = entry as {
      dependencyCount?: unknown;
      ownedData?: unknown;
      emittedEvents?: unknown;
      approvalRequiredActions?: unknown;
      dependencyDataKeys?: unknown;
    };

    moduleMeta.set(moduleId, {
      moduleId,
      mode,
      dependencyCount: typeof normalized.dependencyCount === 'number' ? normalized.dependencyCount : undefined,
      ownedDataCount: Array.isArray(normalized.ownedData) ? normalized.ownedData.length : undefined,
      emittedEventsCount: Array.isArray(normalized.emittedEvents) ? normalized.emittedEvents.length : undefined,
      approvalActionCount:
        typeof normalized.approvalRequiredActions === 'object' && Array.isArray(normalized.approvalRequiredActions)
          ? normalized.approvalRequiredActions.length
          : undefined,
      dependencyDataKeys: Array.isArray(normalized.dependencyDataKeys)
        ? normalized.dependencyDataKeys
        : undefined,
    });
  }
  return moduleMeta;
}

function parseDecShellRoutesFromModules(
  payload: DecModulesPayload,
): Map<string, Pick<ToolForShellState, 'entryStatus' | 'modeAvailability' | 'emptyStateKey' | 'approvalGateKeys'>> {
  const routes = new Map<string, Pick<ToolForShellState, 'entryStatus' | 'modeAvailability' | 'emptyStateKey' | 'approvalGateKeys'>>();
  if (!payload.ok || !payload.shellRoutes || !Array.isArray(payload.shellRoutes.routes)) return routes;

  for (const route of payload.shellRoutes.routes) {
    if (!route || typeof route !== 'object') continue;
    const moduleId = typeof (route as { moduleId?: unknown }).moduleId === 'string'
      ? (route as { moduleId?: string }).moduleId
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
      if (!meta) return tool;
      return {
        ...tool,
        decMeta: meta,
      };
    }),
  };
}

export default function Portal() {
  const [config, setConfig] = useState<PortalConfig>(DEFAULT_PORTAL_CONFIG);
  const [decModules, setDecModules] = useState<Map<string, PortalDecMetadata>>(new Map());
  const [decShellRoutes, setDecShellRoutes] = useState<ReturnType<typeof parseDecShellRoutesFromModules>>(
    new Map(),
  );
  const [noteOpen, setNoteOpen] = useState(false);
  const [treasureOpen, setTreasureOpen] = useState(false);
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

    return {
      ...configWithDecMetadata,
      tools,
    };
  }, [configWithDecMetadata, decShellRoutes]);

  const shellManifest = useMemo(() => buildPortalShellManifest(configWithShellState), [configWithShellState]);
  const shellRuntime = useMemo(
    () => resolveShellRuntimeTools(shellManifest.tools, launchSurfaceContext),
    [shellManifest.tools, launchSurfaceContext],
  );

  useEffect(() => {
    setTreasureOpen(readTreasureOpen());
    setLaunchSurfaceContext(normalizeLaunchSurfaceContext(readLaunchSurfaceContextFromBrowser()));
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

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const noteParam = params.get('note');
    if (noteParam === '1' || noteParam === 'open') {
      setNoteOpen(true);
      params.delete('note');
      const qs = params.toString();
      const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', next);
    }
  }, []);

  const openTool = useCallback((tool: PortalTool) => {
    const runtimeTool = resolveShellRuntimeTools([tool], launchSurfaceContext).tools[0];
    if (!shouldShellOpenTool(runtimeTool?.shellRuntime)) return;
    if (isToolKilledByLocalFeatureControl(tool)) return;
    if (treasureOpen) setTreasurePersisted(true);
    const href = openToolHref(tool, launchSurfaceContext);
    if (!href) return;
    window.location.assign(href);
  }, [launchSurfaceContext, treasureOpen]);

  const handleTreasureOpenChange = (open: boolean) => {
    setTreasureOpen(open);
    setTreasurePersisted(open);
  };

  const handleNoteOpenChange = (open: boolean) => {
    setNoteOpen(open);
    if (open) {
      setTreasureOpen(false);
      setTreasurePersisted(false);
    }
  };

  useEffect(() => {
    const rippleSel =
      '.portal-tool-card,.portal-search-btn--note,.portal-quote-treasure,' +
      '.portal-secretary-fab,.portal-avatar-link,.flomo-tool,.flomo-send';
    const onPointerDown = (event: PointerEvent) => {
      const host = (event.target as HTMLElement | null)?.closest(rippleSel);
      if (!host || host.classList.contains('portal-secretary-fab')) return;
      host.classList.add('om-ripple-host');
      const ripple = document.createElement('span');
      ripple.className = 'om-ripple';
      const rect = host.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.4;
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${event.clientX - rect.left}px`;
      ripple.style.top = `${event.clientY - rect.top}px`;
      host.appendChild(ripple);
      window.setTimeout(() => ripple.remove(), 600);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setNoteOpen(true);
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const tool = shellRuntime.openableTools.find((item) => item.hotkey === key);
      if (tool) {
        event.preventDefault();
        openTool(tool);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shellRuntime.openableTools, openTool]);

  return (
    <>
      <div className="portal-root portal-root--home">
        <div className="portal-grain" aria-hidden />

        <div className="portal-shell portal-shell--single">
          <div className="portal-main">
              <DashboardHome
              config={configWithDecMetadata}
              shellTools={shellRuntime.visibleTools}
              toolboxTools={shellManifest.tools}
              noteOpen={noteOpen}
              treasureOpen={treasureOpen}
              onTreasureOpenChange={handleTreasureOpenChange}
              onOpenNote={() => handleNoteOpenChange(true)}
              onOpenTool={openTool}
            />
          </div>
        </div>
      </div>

      {!noteOpen ? (
        <div className="portal-chrome">
          <PortalQuickChat />
        </div>
      ) : null}

      <NotePanelEnhanced open={noteOpen} onOpenChange={handleNoteOpenChange} />
    </>
  );
}
