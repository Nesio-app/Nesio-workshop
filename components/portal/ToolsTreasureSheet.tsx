'use client';

import type { PortalTool } from '@/lib/portal/types';
import { formatStatusSummaryLine, type ToolForShellState } from './tool-state';
import ToolGrid from './ToolGrid';
import { t } from '@/lib/portal/i18n';
import type { PortalLocale } from '@/lib/portal/profile';

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
  if (!open) return null;

  const visibleTools = tools.filter((tool) => tool.id !== 'secretary');
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
              {t(locale, 'shellTreasureTitleTemplate', { count: tools.length })}
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
