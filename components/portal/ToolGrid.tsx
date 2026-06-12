'use client';

import type { PortalTool } from '@/lib/portal/types';
import ToolGridIcon from './ToolGridIcon';

interface ToolGridProps {
  tools: PortalTool[];
  excludeIds?: string[];
  onOpenTool: (tool: PortalTool) => void;
}

export default function ToolGrid({ tools, excludeIds = [], onOpenTool }: ToolGridProps) {
  const exclude = new Set(excludeIds);
  const ready = tools.filter((t) => t.ready && !exclude.has(t.id));

  return (
    <section className="portal-tools" aria-label="工具">
      <ul className="portal-tools-grid">
        {ready.map((tool) => (
          <li key={tool.id}>
            <button
              type="button"
              className="portal-tool-card"
              onClick={() => onOpenTool(tool)}
              title={tool.description}
            >
              <span className="portal-tool-icon-wrap">
                <ToolGridIcon toolId={tool.id} fallback={tool.icon} />
              </span>
              <span className="portal-tool-name">{tool.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
