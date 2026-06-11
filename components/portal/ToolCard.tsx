'use client';

import type { PortalTool, PortalZone } from '@/lib/portal/types';
import { ensureToolboxTrailingSlash, withBase } from '@/lib/portal/paths';

interface ToolCardProps {
  tool: PortalTool;
  zone: PortalZone;
}

function isExternalUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

export default function ToolCard({ tool, zone }: ToolCardProps) {
  const href = tool.ready ? ensureToolboxTrailingSlash(withBase(tool.url)) : undefined;
  const external = href ? isExternalUrl(href) : false;
  const breathe = zone.tone === 'warm' && tool.id === 'psychoanalysis';
  const iconSrc = tool.iconUrl ? withBase(tool.iconUrl) : null;

  const content = (
    <>
      <div className="portal-card-top">
        <span className="portal-card-icon" aria-hidden>
          {iconSrc ? (
            <img className="portal-card-icon-img" src={iconSrc} alt="" width={28} height={28} />
          ) : (
            tool.icon
          )}
        </span>
        {!tool.ready && <span className="portal-card-badge">筹备中</span>}
      </div>
      <div className="portal-card-body">
        <h3 className="portal-card-name">{tool.name}</h3>
        <p className="portal-card-en">{tool.nameEn}</p>
        <p className="portal-card-desc">{tool.description}</p>
      </div>
      <div className="portal-card-foot">
        <span className="portal-card-hotkey">
          <kbd>{tool.hotkey.toUpperCase()}</kbd>
        </span>
        {tool.ready && (
          <span className="portal-card-enter">{external ? '打开 ↗' : '进入 →'}</span>
        )}
      </div>
    </>
  );

  const className = [
    'portal-card',
    `portal-card--${zone.tone}`,
    tool.featured ? 'portal-card--featured' : '',
    breathe ? 'portal-card--breathe' : '',
    tool.ready ? 'portal-card--ready' : 'portal-card--pending',
  ]
    .filter(Boolean)
    .join(' ');

  if (!href) {
    return (
      <article className={className} aria-disabled="true">
        {content}
      </article>
    );
  }

  return (
    <a
      href={href}
      className={className}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {content}
    </a>
  );
}
