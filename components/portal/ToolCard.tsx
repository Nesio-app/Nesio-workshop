'use client';

import type { PortalTool, PortalZone } from '@/lib/portal/types';
import { getToolStatusLabel, type ToolForShellState } from './tool-state';
import { ensureToolboxTrailingSlash, withBase } from '@/lib/portal/paths';
import { t } from '@/lib/portal/i18n';
import type { PortalLocale } from '@/lib/portal/profile';

interface ToolCardProps {
  tool: PortalTool;
  zone: PortalZone;
  locale?: PortalLocale;
}

function isExternalUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

function toolStatusLabel(tool: PortalTool, locale: PortalLocale = 'zh'): string {
  return getToolStatusLabel(tool as ToolForShellState, locale);
}

export default function ToolCard({ tool, zone, locale = 'zh' }: ToolCardProps) {
  const href = tool.ready ? ensureToolboxTrailingSlash(tool.url) : undefined;
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
        <span className="portal-card-badge">{toolStatusLabel(tool, locale)}</span>
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
          <span className="portal-card-enter">{external ? t(locale, 'shellToolOpen') : t(locale, 'shellToolEnter')}</span>
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
    return <article className={className}>{content}</article>;
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
