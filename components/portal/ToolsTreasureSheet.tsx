'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { PortalTool } from '@/lib/portal/types';
import type { PortalLocale } from '@/lib/portal/profile';
import {
  readLaunchSurfaceContextFromBrowser,
} from '@/lib/portal/launch-surface.mjs';
import { resolveShellRuntimeTools } from '@/lib/portal/shell-runtime-resolver.mjs';
import { t } from '@/lib/portal/i18n';
import { formatStatusSummaryLine, type ToolForShellState } from './tool-state';
import ToolGrid from './ToolGrid';

interface LaunchSurfaceContext {
  viewerRole: 'public' | 'tester' | 'personal_lab';
  testerAllowlist: string[];
  testerCohort?: string | null;
}

function normalizeLaunchContext(raw: {
  viewerRole?: string;
  testerAllowlist?: unknown;
  testerCohort?: unknown;
}): LaunchSurfaceContext {
  return {
    viewerRole: raw.viewerRole === 'personal_lab'
      ? 'personal_lab'
      : raw.viewerRole === 'tester' ? 'tester' : 'public',
    testerAllowlist: Array.isArray(raw.testerAllowlist)
      ? raw.testerAllowlist.filter((item): item is string => typeof item === 'string')
      : [],
    testerCohort: typeof raw.testerCohort === 'string' ? raw.testerCohort : null,
  };
}

interface ToolsTreasurePopupProps {
  tools: PortalTool[];
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  locale?: PortalLocale;
  onClose: () => void;
  onOpenTool: (tool: PortalTool) => void;
}

/** Floating toolbox overlay — launch visibility is resolved before rendering. */
export default function ToolsTreasurePopup({
  tools,
  open,
  anchorRef,
  locale = 'zh',
  onClose,
  onOpenTool,
}: ToolsTreasurePopupProps) {
  const popupRef = useRef<HTMLElement>(null);
  const [placed, setPlaced] = useState(false);
  const [launchContext, setLaunchContext] = useState<LaunchSurfaceContext>({
    viewerRole: 'public',
    testerAllowlist: [],
  });

  useEffect(() => {
    setLaunchContext(normalizeLaunchContext(readLaunchSurfaceContextFromBrowser()));
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPlaced(false);
      return;
    }

    function placePopup() {
      const anchor = anchorRef.current;
      const popup = popupRef.current;
      if (!anchor || !popup) return;
      const r = anchor.getBoundingClientRect();
      const gap = 8;
      const margin = 12;
      const maxH = Math.min(window.innerHeight * 0.52, 320);
      let top = r.bottom + gap;
      let origin: 'top right' | 'bottom right' = 'top right';
      if (top + maxH > window.innerHeight - margin) {
        top = Math.max(margin, r.top - maxH - gap);
        origin = 'bottom right';
      }
      popup.style.setProperty('--treasure-top', `${top}px`);
      popup.style.setProperty('--treasure-right', `${Math.max(margin, window.innerWidth - r.right)}px`);
      popup.style.transformOrigin = origin;
      setPlaced(true);
    }

    placePopup();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(placePopup) : null;
    if (anchorRef.current) ro?.observe(anchorRef.current);
    window.addEventListener('resize', placePopup);
    window.addEventListener('scroll', placePopup, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', placePopup);
      window.removeEventListener('scroll', placePopup, true);
    };
  }, [open, anchorRef]);

  const visibleTools = useMemo(
    () => {
      return resolveShellRuntimeTools(
        tools.filter((tool) => tool.id !== 'secretary'),
        launchContext,
      ).visibleTools;
    },
    [tools, launchContext],
  );

  if (!open) return null;

  const toolsWithShellState = visibleTools as ToolForShellState[];
  const statusSummaryLine = formatStatusSummaryLine(toolsWithShellState, locale);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <button
        type="button"
        className="portal-treasure-scrim"
        aria-label={t(locale, 'shellCloseTreasure')}
        onClick={onClose}
      />
      <section
        ref={popupRef}
        className={'portal-treasure-popup' + (placed ? ' portal-treasure-popup--ready' : '')}
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
            x
          </button>
        </header>
        <ToolGrid
          tools={visibleTools}
          includeNotReady
          showStatus
          locale={locale}
          onOpenTool={onOpenTool}
        />
      </section>
    </>,
    document.body,
  );
}
