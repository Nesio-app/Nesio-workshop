import type { PortalTool } from './types';
import { ensureToolboxTrailingSlash, withBase } from './paths';

export function toolOpenUrl(tool: PortalTool): string {
  return ensureToolboxTrailingSlash(withBase(tool.url));
}

/** External apps and 智友 break inside iframes (X-Frame-Options / nested UI). */
export function toolNeedsFullPage(tool: PortalTool): boolean {
  const href = toolOpenUrl(tool);
  if (tool.id === 'secretary') return true;
  if (href.startsWith('http://') || href.startsWith('https://')) return true;
  return false;
}

export function openToolHref(tool: PortalTool): string {
  return toolOpenUrl(tool);
}
