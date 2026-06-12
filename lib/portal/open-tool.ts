import type { PortalTool } from './types';
import { ensureToolboxTrailingSlash, withBase } from './paths';

export function toolOpenUrl(tool: PortalTool): string {
  return ensureToolboxTrailingSlash(withBase(tool.url));
}

/** All tools open via full-page navigation (no iframe embedding). */
export function toolNeedsFullPage(_tool: PortalTool): boolean {
  return true;
}

export function openToolHref(tool: PortalTool): string {
  return toolOpenUrl(tool);
}
