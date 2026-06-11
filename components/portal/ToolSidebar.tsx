'use client';

import type { PortalTool } from '@/lib/portal/types';
import { withBase } from '@/lib/portal/paths';

interface ToolSidebarProps {
  tools: PortalTool[];
}

function toolHref(tool: PortalTool): string | undefined {
  return tool.ready ? withBase(tool.url) : undefined;
}

function openTool(href: string) {
  if (href.startsWith('http')) {
    window.open(href, '_blank', 'noopener,noreferrer');
  } else {
    window.location.href = href;
  }
}

export default function ToolSidebar({ tools }: ToolSidebarProps) {
  const ready = tools.filter((t) => t.ready);

  return (
    <nav className="portal-rail" aria-label="工具">
      <div className="portal-rail-brand" title="宝盒">
        <img
          className="portal-rail-mark"
          src="/icons/treasurebox.svg"
          alt=""
          width={40}
          height={40}
        />
      </div>
      <ul className="portal-rail-list">
        {ready.map((tool) => {
          const href = toolHref(tool);
          const iconSrc = tool.iconUrl ? withBase(tool.iconUrl) : null;
          return (
            <li key={tool.id}>
              <button
                type="button"
                className="portal-rail-btn"
                title={tool.name}
                aria-label={tool.name}
                onClick={() => href && openTool(href)}
              >
                {iconSrc ? (
                  <img src={iconSrc} alt="" width={26} height={26} />
                ) : (
                  <span className="portal-rail-emoji">{tool.icon}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
