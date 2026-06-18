'use client';

import type { PortalTool } from '@/lib/portal/types';
import { getToolStatusLabel, type ToolForShellState } from './tool-state';
import ToolGridIcon from './ToolGridIcon';
import type { PortalLocale } from '@/lib/portal/profile';
import { t } from '@/lib/portal/i18n';

interface ToolGridProps {
  tools: PortalTool[];
  excludeIds?: string[];
  includeNotReady?: boolean;
  showStatus?: boolean;
  locale?: PortalLocale;
  onOpenTool: (tool: PortalTool) => void;
}

function toolStatusLabel(tool: PortalTool, locale: PortalLocale = 'zh'): string {
  return getToolStatusLabel(tool as ToolForShellState, locale);
}

export default function ToolGrid({
  tools,
  excludeIds = [],
  includeNotReady = false,
  showStatus = false,
  locale = 'zh',
  onOpenTool,
}: ToolGridProps) {
  const exclude = new Set(excludeIds);
  const ready = tools.filter((t) => (includeNotReady || t.ready) && !exclude.has(t.id));

  return (
    <section className="portal-tools" aria-label={t(locale, 'shellToolLabel')}>
      <ul className="portal-tools-grid">
        {ready.map((tool) => (
          <li key={tool.id}>
            <button
              type="button"
              className="portal-tool-card"
              onClick={() => onOpenTool(tool)}
              title={tool.description}
              aria-label={`${tool.name}，${toolStatusLabel(tool, locale)}`}
            >
              <span className="portal-tool-icon-wrap">
                <ToolGridIcon toolId={tool.id} fallback={tool.icon} />
              </span>
              <span className="portal-tool-name">{tool.name}</span>
              {showStatus ? (
                <span className="portal-tool-status">{toolStatusLabel(tool, locale)}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
