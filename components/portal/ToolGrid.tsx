'use client';

import type { PortalTool } from '@/lib/portal/types';
import { withBase } from '@/lib/portal/paths';

interface ToolGridProps {
  tools: PortalTool[];
  onOpenTool: (tool: PortalTool) => void;
}

export default function ToolGrid({ tools, onOpenTool }: ToolGridProps) {
  const ready = tools.filter((t) => t.ready);

  return (
    <section className="portal-tools" aria-label="工具">
      <ul className="portal-tools-grid">
        {ready.map((tool) => {
          const iconSrc = tool.iconUrl ? withBase(tool.iconUrl) : null;
          return (
            <li key={tool.id}>
              <button
                type="button"
                className="portal-tool-card"
                data-zone={tool.zone}
                onClick={() => onOpenTool(tool)}
                title={tool.description}
              >
                <span className="portal-tool-icon-wrap">
                  {iconSrc ? (
                    <img src={iconSrc} alt="" width={40} height={40} />
                  ) : (
                    <span className="portal-tool-emoji">{tool.icon}</span>
                  )}
                </span>
                <span className="portal-tool-name">{tool.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
