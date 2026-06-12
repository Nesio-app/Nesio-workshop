'use client';

import { useState } from 'react';
import type { PortalTool } from '@/lib/portal/types';
import { withBase } from '@/lib/portal/paths';

interface ToolGridProps {
  tools: PortalTool[];
  excludeIds?: string[];
  onOpenTool: (tool: PortalTool) => void;
}

function ToolIcon({ tool }: { tool: PortalTool }) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = tool.iconUrl ? withBase(tool.iconUrl) : '';

  if (!src || imgFailed) {
    return (
      <span className="portal-tool-emoji portal-icon-blue" aria-hidden>
        {tool.icon}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      width={30}
      height={30}
      onError={() => setImgFailed(true)}
    />
  );
}

export default function ToolGrid({ tools, excludeIds = [], onOpenTool }: ToolGridProps) {
  const exclude = new Set(excludeIds);
  const ready = tools.filter((t) => t.ready && !exclude.has(t.id));

  return (
    <section className="portal-tools" aria-label="工具">
      <ul className="portal-tools-grid">
        {ready.map((tool) => {
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
                  <ToolIcon tool={tool} />
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
