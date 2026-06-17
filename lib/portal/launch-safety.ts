import type { PortalTool } from './types';

export const FIRST_LAUNCH_GATE_KEY = 'first_launch_high_risk_isolation_v0';

export const FIRST_LAUNCH_GATED_MODULE_IDS = new Set([
  'secretary',
  'quiz',
  'psychoanalysis',
  'sanctuary',
  'health',
  'finance',
  'lifesim',
]);

export const FIRST_LAUNCH_BLOCKED_PATH_PREFIXES = [
  '/secretary',
  '/inner-shelter',
  '/health',
  '/api/secretary',
  '/api/inner-shelter',
  '/api/adhd-flow',
  '/api/fitness',
  '/api/identify',
  '/api/payments',
  '/api/storekit',
  '/api/subscriptions',
];

export function isFirstLaunchGatedModuleId(moduleId?: string): boolean {
  return Boolean(moduleId && FIRST_LAUNCH_GATED_MODULE_IDS.has(moduleId));
}

export function isFirstLaunchBlockedPath(pathname: string): boolean {
  return FIRST_LAUNCH_BLOCKED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function launchUnavailablePayload(kind: string, id?: string) {
  return {
    ok: false,
    status: 'gated',
    code: 'first_launch_gated',
    launchGate: FIRST_LAUNCH_GATE_KEY,
    kind,
    id,
    behaviorEnabled: false,
    needsCeoGate: true,
    reason: 'Disabled for first App Store launch.',
  };
}

export function applyFirstLaunchToolGate<T extends PortalTool>(tool: T): T {
  if (!isFirstLaunchGatedModuleId(tool.id)) return tool;
  return {
    ...tool,
    ready: false,
    featured: false,
    status: 'gated',
    integrationMode: 'contract-only',
  };
}
