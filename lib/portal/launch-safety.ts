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

export const LOCAL_FEATURE_CONTROL_VERSION = 'feature-control-contract-v0';

export const LOCAL_KILL_SWITCH_STATE: Record<string, boolean> = {
  'kill.module.secretary': false,
  'kill.module.plan': false,
  'kill.module.quiz': false,
  'kill.module.inventory': false,
  'kill.module.psychoanalysis': false,
  'kill.module.sanctuary': false,
  'kill.module.reading': false,
  'kill.module.fitness': false,
  'kill.module.health': false,
  'kill.module.finance': false,
  'kill.module.lifesim': false,
};

export function killSwitchKeyForModule(moduleId?: string): string {
  return `kill.module.${moduleId || 'unknown'}`;
}

export function isLocalKillSwitchActive(killSwitchKey?: string): boolean {
  return Boolean(killSwitchKey && LOCAL_KILL_SWITCH_STATE[killSwitchKey] === true);
}

export function isToolKilledByLocalFeatureControl(tool: PortalTool): boolean {
  return isLocalKillSwitchActive(killSwitchKeyForModule(tool.id));
}

export function isFirstLaunchGatedModuleId(moduleId?: string): boolean {
  return Boolean(moduleId && FIRST_LAUNCH_GATED_MODULE_IDS.has(moduleId));
}

export function isFirstLaunchBlockedPath(pathname: string): boolean {
  return FIRST_LAUNCH_BLOCKED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isPersonalLabAiEnvEnabled(): boolean {
  return process.env.BAOHE_PERSONAL_LAB_AI_ENABLED === '1' ||
    process.env.BAOHE_PERSONAL_LAB_AI_ENABLED === 'true';
}

function hasPersonalLabAccessMarker(request: {
  headers: Headers;
  nextUrl?: { searchParams?: URLSearchParams };
}): boolean {
  const headerMode = request.headers.get('x-baohe-access-mode') || '';
  const queryMode = request.nextUrl?.searchParams?.get('baohePersonal') ||
    request.nextUrl?.searchParams?.get('baohePersonalLab') ||
    request.nextUrl?.searchParams?.get('baohe_personal_lab') ||
    '';
  return headerMode === 'personal_lab' || queryMode === '1' || queryMode === 'personal_lab';
}

export function isPersonalLabAiRequestAllowed(request: {
  headers: Headers;
  nextUrl?: { searchParams?: URLSearchParams };
}): boolean {
  return isPersonalLabAiEnvEnabled() && hasPersonalLabAccessMarker(request);
}

function readRuntimeEnv(name: string): string {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function hasProductionAiProviderKey(): boolean {
  return Boolean(
    readRuntimeEnv('OPENAI_API_KEY') ||
    readRuntimeEnv('OpenAI_KEY') ||
    readRuntimeEnv('GEMINI_API_KEY') ||
    readRuntimeEnv('GOOGLE_GENERATIVE_AI_API_KEY') ||
    readRuntimeEnv('GOOGLE_AI_API_KEY') ||
    readRuntimeEnv('GOOGLE_API_KEY') ||
    readRuntimeEnv('DOUBAO_KEY') ||
    readRuntimeEnv('DOUBAO_API_KEY') ||
    readRuntimeEnv('ARK_API_KEY') ||
    readRuntimeEnv('VOLCENGINE_API_KEY') ||
    readRuntimeEnv('ANTHROPIC_API_KEY') ||
    readRuntimeEnv('CLAUDE_API_KEY'),
  );
}

export function isProductionActivationAiRuntimeEnabled(): boolean {
  return readRuntimeEnv('BAOHE_AI_PROVIDER_MODE').toLowerCase() === 'production' &&
    hasProductionAiProviderKey();
}

export function isSecretaryAiRequestAllowed(request: {
  headers: Headers;
  nextUrl?: { searchParams?: URLSearchParams };
}): boolean {
  return isPersonalLabAiRequestAllowed(request) || isProductionActivationAiRuntimeEnabled();
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

export function applyFeatureControlToolGate<T extends PortalTool>(tool: T): T {
  if (!isToolKilledByLocalFeatureControl(tool)) return tool;
  return {
    ...tool,
    ready: false,
    featured: false,
    status: 'gated',
    integrationMode: 'contract-only',
  };
}
