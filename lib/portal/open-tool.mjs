import { classifyModuleRouteKind } from './module-routes.mjs';
import {
  resolveShellRuntimeState,
  shouldShellOpenTool,
} from './shell-runtime-resolver.mjs';

const FIRST_LAUNCH_GATED_MODULE_IDS = new Set([
  'secretary',
  'quiz',
  'psychoanalysis',
  'sanctuary',
  'health',
  'finance',
  'lifesim',
]);

function isFirstLaunchGatedModuleId(moduleId) {
  return Boolean(moduleId && FIRST_LAUNCH_GATED_MODULE_IDS.has(moduleId));
}

function isToolKilledByLocalFeatureControl(tool) {
  return tool?.featureControl?.killed === true;
}

export function toolOpenUrl(tool) {
  return tool.openHref || tool.url || '';
}

export function toolRouteKind(tool) {
  return classifyModuleRouteKind(tool.url);
}

/** All tools open via full-page navigation (no iframe embedding). */
export function toolNeedsFullPage(_tool) {
  return true;
}

export function openToolHref(tool, context = {}) {
  if (isToolKilledByLocalFeatureControl(tool)) return '';
  if (isFirstLaunchGatedModuleId(tool.id)) return '';
  const runtimeState = resolveShellRuntimeState(tool, context);
  if (!shouldShellOpenTool(runtimeState)) return '';
  return toolOpenUrl(tool);
}
