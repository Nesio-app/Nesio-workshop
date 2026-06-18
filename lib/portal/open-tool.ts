import type { PortalTool } from './types';
import { isToolKilledByLocalFeatureControl } from './launch-safety';
import {
  openToolHref as openToolHrefRuntime,
  toolNeedsFullPage as toolNeedsFullPageRuntime,
  toolOpenUrl as toolOpenUrlRuntime,
  toolRouteKind as toolRouteKindRuntime,
} from './open-tool.mjs';

interface ShellRuntimeContext {
  viewerRole?: 'public' | 'tester';
  testerAllowlist?: string[];
  testerCohort?: string | null;
}

export function toolOpenUrl(tool: PortalTool): string {
  return toolOpenUrlRuntime(tool);
}

export function toolRouteKind(tool: PortalTool) {
  return toolRouteKindRuntime(tool);
}

/** All tools open via full-page navigation (no iframe embedding). */
export function toolNeedsFullPage(tool: PortalTool): boolean {
  return toolNeedsFullPageRuntime(tool);
}

export function openToolHref(tool: PortalTool, context: ShellRuntimeContext = {}): string {
  if (isToolKilledByLocalFeatureControl(tool)) return '';
  return openToolHrefRuntime(tool, context);
}
