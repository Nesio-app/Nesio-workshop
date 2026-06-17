import type { PortalTool } from './types';
import { getModuleOpenHref } from './module-manifest';
import { classifyModuleRouteKind } from './module-routes.mjs';
import { isFirstLaunchGatedModuleId, isToolKilledByLocalFeatureControl } from './launch-safety';

export function toolOpenUrl(tool: PortalTool): string {
  return getModuleOpenHref(tool);
}

export function toolRouteKind(tool: PortalTool) {
  return classifyModuleRouteKind(tool.url);
}

/** All tools open via full-page navigation (no iframe embedding). */
export function toolNeedsFullPage(_tool: PortalTool): boolean {
  return true;
}

export function openToolHref(tool: PortalTool): string {
  if (isToolKilledByLocalFeatureControl(tool)) return '';
  if (isFirstLaunchGatedModuleId(tool.id)) return '';
  return toolOpenUrl(tool);
}
