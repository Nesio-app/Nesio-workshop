'use client';

import Image from 'next/image';
import type { PortalTool } from '@/lib/portal/types';
import { ensureToolboxTrailingSlash } from '@/lib/portal/paths';
import type { PortalLocale } from '@/lib/portal/profile';
import { t } from '@/lib/portal/i18n';
import { getNesioToolIcon, nesioBrandAssets } from '@/lib/portal/nesio-design-system-assets.mjs';

interface ToolSidebarProps {
  tools: PortalTool[];
  locale?: PortalLocale;
}

function toolHref(tool: PortalTool): string | undefined {
  return tool.ready ? ensureToolboxTrailingSlash(tool.url) : undefined;
}

function openTool(href: string) {
  if (href.startsWith('http')) {
    window.open(href, '_blank', 'noopener,noreferrer');
  } else {
    window.location.href = href;
  }
}

export default function ToolSidebar({ tools, locale = 'zh' }: ToolSidebarProps) {
  const ready = tools.filter((t) => t.ready);

  return (
    <nav className="portal-rail" aria-label={t(locale, 'shellToolLabel')}>
      <div className="portal-rail-brand" title={t(locale, 'shellBrand')}>
        <Image
          className="portal-rail-mark"
          src={nesioBrandAssets.crystal}
          alt=""
          width={40}
          height={40}
        />
      </div>
      <ul className="portal-rail-list">
        {ready.map((tool) => {
          const href = toolHref(tool);
          const iconSrc = getNesioToolIcon(tool.id, tool.iconUrl);
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
                  <Image src={iconSrc} alt="" width={26} height={26} />
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
