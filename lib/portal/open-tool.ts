import type { PortalTool } from './types';
import { withBase } from './paths';

export function toolOpenUrl(tool: PortalTool): string {
  return withBase(tool.url);
}

export function isExternalToolUrl(href: string): boolean {
  return href.startsWith('http://') || href.startsWith('https://');
}
