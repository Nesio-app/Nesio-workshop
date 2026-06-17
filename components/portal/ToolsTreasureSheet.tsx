'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PortalTool } from '@/lib/portal/types';
import { formatStatusSummaryLine, type ToolForShellState } from './tool-state';
import ToolGrid from './ToolGrid';
import { t } from '@/lib/portal/i18n';
import type { PortalLocale } from '@/lib/portal/profile';
import {
  filterToolsForLaunchSurface,
  readLaunchSurfaceContextFromBrowser,
} from '@/lib/portal/launch-surface.mjs';

interface LaunchSurfaceContext {
  viewerRole: 'public' | 'tester';
  testerAllowlist: string[];
  testerCohort?: string | null;
}

function normalizeLaunchContext(raw: {
  viewerRole?: string;
  testerAllowlist?: unknown;
  testerCohort?: unknown;
}): LaunchSurfaceContext {
  return {
    viewerRole: raw.viewerRole === 'tester' ? 'tester' : 'public',
    testerAllowlist: Array.isArray(raw.testerAllowlist)
      ? raw.testerAllowlist.filter((item): item is string => typeof item === 'string')
      : [],
    testerCohort: typeof raw.testerCohort === 'string' ? raw.testerCohort : null,
  };
}

interface ToolsTreasurePopupProps {
  tools: PortalTool[];
  open: boolean;
  locale?: PortalLocale;
  onClose: () => void;
  onOpenTool: (tool: PortalTool) => void;
}

/** Floating toolbox overlay — not in document layout flow. */
export default function ToolsTreasurePopup({
  tools,
  open,
  locale = 'zh',
  onClose,
  onOpenTool,
}: ToolsTreasurePopupProps) {
  const [launchContext, setLaunchContext] = useState<LaunchSurfaceContext>({
    viewerRole: 'public',
    testerAllowlist: [],
  });

  useEffect(() => {
    setLaunchContext(normalizeLaunchContext(readLaunchSurfaceContextFromBrowser()));
  }, []);

  const visibleTools = useMemo(
    () => filterToolsForLaunchSurface(tools, launchContext).filter((tool: PortalTool) => tool.id !== 'secretary'),
    [tools, launchContext],
  );

  if (!open) return null;

  const toolsWithShellState = visibleTools as ToolForShellState[];

  const statusSummaryLine = formatStatusSummaryLine(toolsWithShellState, locale);

  const handleOpen = (tool: PortalTool) => {
    onOpenTool(tool);
  };

  return (
    <>
      <button
        type="button"
        className="portal-treasure-scrim"
        aria-label={t(locale, 'shellCloseTreasure')}
        onClick={onClose}
      />
      <section
        className="portal-treasure-popup"
        role="dialog"
        aria-label={t(locale, 'shellTreasurePopupAriaLabel')}
      >
        <header className="portal-treasure-popup-head">
          <div>
            <h2 className="portal-treasure-popup-title">
              {t(locale, 'shellTreasureTitleTemplate', { count: visibleTools.length })}
            </h2>
            <p className="portal-treasure-popup-meta">{statusSummaryLine}</p>
          </div>
          <button
            type="button"
            className="portal-treasure-popup-close"
            onClick={onClose}
            aria-label={t(locale, 'shellClose')}
          >
            ×
          </button>
        </header>
        <ToolGrid
          tools={visibleTools}
          excludeIds={['secretary']}
          showStatus
          locale={locale}
          onOpenTool={handleOpen}
        />
      </section>
    </>
  );
}
