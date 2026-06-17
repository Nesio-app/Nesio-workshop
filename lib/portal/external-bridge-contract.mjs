import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildModuleRegistry } from './module-manager-core.mjs';

const EXTERNAL_PROVIDER_HINTS = {
  quiz: {
    providerId: 'question-bank',
    providerLabel: 'Question Bank',
    connectionType: 'api',
    authModel: 'token-or-cookie',
    expectedSurface: ['progress', 'attempt'],
    notes: '学习类外部模块，当前仅在 report/route 层以链接形式打开。',
  },
  reading: {
    providerId: 'reading-service',
    providerLabel: 'Reading Service',
    connectionType: 'api',
    authModel: 'user-auth-flow',
    expectedSurface: ['notes', 'progress'],
    notes: '阅读类外部模块，当前为外部视图入口。',
  },
  psychoanalysis: {
    providerId: 'psychoanalysis-service',
    providerLabel: 'Psychoanalysis Service',
    connectionType: 'api',
    authModel: 'oauth-optional',
    expectedSurface: ['consultation', 'notes'],
    notes: '敏感场景，需 CEO Gate 后再接 API/SDK。',
  },
  health: {
    providerId: 'health-service',
    providerLabel: 'Health Service',
    connectionType: 'api',
    authModel: 'sdk-or-api',
    expectedSurface: ['experiment-notes', 'health-logs'],
    notes: '高敏感健康语义，必须外部服务签名审查。',
  },
  lifesim: {
    providerId: 'lifesim-service',
    providerLabel: 'LifeSim Service',
    connectionType: 'sdk',
    authModel: 'local-token',
    expectedSurface: ['scenario', 'storyboard'],
    notes: '模拟场景外部模块，当前仅展示入口。',
  },
};

function readPortalConfig(repoRoot) {
  return JSON.parse(
    readFileSync(join(repoRoot, 'public', 'portal-config.json'), 'utf8'),
  );
}

function safeList(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.toLowerCase().trim()))];
}

function normalizeMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'local';
}

function classifyExternalModule(module) {
  const moduleMode = normalizeMode(module.capabilities?.mode || module.mode || module.origin);
  if (moduleMode !== 'external') return null;
  const configuredUrl = typeof module.configuredUrl === 'string' ? module.configuredUrl.trim() : '';
  const fallbackUrl = typeof module.url === 'string' ? module.url.trim() : '';
  const hint = EXTERNAL_PROVIDER_HINTS[module.id] || {
    providerId: `provider:${module.id}`,
    providerLabel: `${module.id} provider`,
    connectionType: 'api',
    authModel: 'unknown',
    expectedSurface: ['unknown'],
    notes: '外部链接模块，需先定义 data/provider 边界。',
  };

  return {
    moduleId: module.id,
    moduleLabel: module.name || module.id,
    moduleUrl: configuredUrl || fallbackUrl || null,
    providerId: hint.providerId,
    providerLabel: hint.providerLabel,
    connectionType: hint.connectionType,
    authModel: hint.authModel,
    ownsData: safeList(module.ownedData),
    consumesData: safeList(module.consumedData),
    expectedSurface: hint.expectedSurface,
    notes: hint.notes,
  };
}

function buildExternalBridgeContract(modules = []) {
  const externalModules = modules
    .map(classifyExternalModule)
    .filter(Boolean);
  const externalOwned = externalModules.flatMap((module) => module.ownsData);
  const externalConsumed = externalModules.flatMap((module) => module.consumesData);

  const uniqueExternalOwned = [...new Set(externalOwned)];
  const uniqueExternalConsumed = [...new Set(externalConsumed)];
  const uniqueProviders = [...new Set(externalModules.map((module) => module.providerId))];

  return {
    implementation: 'external-bridge-v0',
    generatedAt: new Date().toISOString(),
    boundaries: {
      localFirst: true,
      offlineDefault: true,
      writesRealExternalData: false,
      requiresExplicitCeoGate: true,
      requiresRuntimeAuth: true,
      writesNotion: false,
    },
    summary: {
      moduleCount: externalModules.length,
      externalDataKeyOwnedCount: uniqueExternalOwned.length,
      externalDataKeyConsumedCount: uniqueExternalConsumed.length,
      uniqueProviders: uniqueProviders.length,
      status: externalModules.length === 0 ? 'internal_only' : 'bridge_planned',
    },
    modules: externalModules,
    dataCatalog: {
      owned: uniqueExternalOwned.sort(),
      consumed: uniqueExternalConsumed.sort(),
    },
    phases: [
      {
        phase: 1,
        name: 'contract',
        done: true,
        goal: '先把外部 provider 的连接口径（字段、频率、错误码、回退策略）写成 data contract',
      },
      {
        phase: 2,
        name: 'adapter_stub',
        done: false,
        goal: '实现本地 mock/fixture 适配器（不请求真实网络）进行端到端回归',
      },
      {
        phase: 3,
        name: 'gated_connect',
        done: false,
        goal: 'CEO Gate + 用户授权后，逐个 provider 开启真实 adapter',
      },
    ],
    handoffReady: externalModules.map((module) => ({
      artifactKind: 'report',
      moduleId: module.moduleId,
      nextAction: `定义 ${module.providerLabel} 的 adapter contract + mock data`,
      needsCeoGate: true,
    })),
    risk: externalModules.length > 0
      ? ['external auth leak', 'PII flow not yet declared', 'provider outage behavior', 'idempotency mismatch']
      : ['none'],
  };
}

function loadExternalBridgeContract(repoRoot = process.cwd()) {
  const config = readPortalConfig(repoRoot);
  const registry = buildModuleRegistry(config);
  return buildExternalBridgeContract(registry.modules || []);
}

export {
  EXTERNAL_PROVIDER_HINTS,
  buildExternalBridgeContract,
  loadExternalBridgeContract,
};
