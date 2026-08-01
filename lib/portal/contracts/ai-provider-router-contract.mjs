import { AI_COMPLETION_CHAIN, GEMINI_MODEL_FALLBACKS } from '../ai-provider-chain.mjs';

const AI_PROVIDER_ROUTER_BOUNDARIES_V0 = Object.freeze({
  mode: 'internal-sandbox-only',
  appStoreLaunchEnabled: false,
  shellAiEnabled: false,
  inventoryAiEnabled: false,
  realProviderCallsEnabled: false,
  storesPrompts: false,
  storesCompletions: false,
  readsRealUserData: false,
  writesRealUserData: false,
  authorizesExternalProviders: false,
});

const SUPPORTED_AI_PROVIDERS = Object.freeze(['gemini', 'chatgpt', 'doubao', 'claude']);
// 智友(secretary)模块已解绑,其 chat 路由已删除;真实完成入口是
// lib/portal/ai-complete.ts(chat/analyze/draft-reply 共用),此处仅作报告占位。
const COMPLETION_ENDPOINT = '/api/portal/chat';

const AI_MODULE_POLICY_V0 = Object.freeze([
  Object.freeze({ moduleId: 'shell', aiAllowed: false, reason: 'Launch shell should stay deterministic.' }),
  Object.freeze({ moduleId: 'inventory', aiAllowed: false, reason: 'Inventory launch uses local purchase memory only.' }),
  Object.freeze({ moduleId: 'health', aiAllowed: false, reason: 'Health claims and sensitive data require CEO/legal gate.' }),
  Object.freeze({ moduleId: 'psychoanalysis', aiAllowed: false, reason: 'Mental/reflection AI requires CEO/legal gate.' }),
  Object.freeze({ moduleId: 'reading', aiAllowed: true, environment: 'internal-sandbox', reason: 'Allowed only for internal experiments.' }),
]);

function envValue(env = {}, key) {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function isAiProductionEnabled(env = {}) {
  return envValue(env, 'BAOHE_AI_PROVIDER_MODE').toLowerCase() === 'production';
}

function buildRuntimeAiProviderFromEnv(providerId, env = {}) {
  const configByProvider = {
    // 2026-07-31:Kimi(Moonshot)进链首,Google 托底。别名与 lib/portal/ai-keys.ts
    // 的 AI_KEY_ALIASES.kimi 保持一致(改一处两处都要改 —— 这份注释在别的 provider 上也写着)。
    kimi: {
      id: 'kimi',
      label: 'Kimi',
      requiredEnv: ['BAOHE_AI_PROVIDER_MODE'],
      alternateGroups: [['KIMI_API_KEY', 'MOONSHOT_API_KEY']],
      safeUserAction: 'send_secretary_message_to_kimi',
    },
    gemini: {
      id: 'gemini',
      label: 'Gemini',
      requiredEnv: ['BAOHE_AI_PROVIDER_MODE'],
      alternateGroups: [['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_AI_API_KEY', 'GOOGLE_API_KEY']],
      safeUserAction: 'send_secretary_message_to_gemini',
    },
    chatgpt: {
      id: 'chatgpt',
      label: 'ChatGPT',
      requiredEnv: ['BAOHE_AI_PROVIDER_MODE'],
      alternateGroups: [['OPENAI_API_KEY', 'OpenAI_KEY']],
      safeUserAction: 'send_secretary_message_to_chatgpt',
    },
    doubao: {
      id: 'doubao',
      label: 'Doubao',
      requiredEnv: ['BAOHE_AI_PROVIDER_MODE'],
      alternateGroups: [['DOUBAO_KEY', 'DOUBAO_API_KEY', 'ARK_API_KEY', 'VOLCENGINE_API_KEY']],
      safeUserAction: 'send_secretary_message_to_doubao',
    },
    claude: {
      id: 'claude',
      label: 'Claude',
      requiredEnv: ['BAOHE_AI_PROVIDER_MODE'],
      alternateGroups: [['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']],
      safeUserAction: 'send_secretary_message_to_claude',
    },
  };
  const config = configByProvider[providerId];
  const missingRequired = config.requiredEnv.filter((key) => !envValue(env, key));
  const missingAlternates = config.alternateGroups
    .filter((keys) => !keys.some((key) => envValue(env, key)))
    .map((keys) => keys.join('|'));
  const missingEnv = [...missingRequired, ...missingAlternates];
  const configured = missingEnv.length === 0;
  const enabled = configured && isAiProductionEnabled(env);
  return {
    id: config.id,
    category: 'ai',
    label: config.label,
    configured,
    enabled,
    actionStatus: enabled ? 'ready' : 'configure_required',
    startEndpoint: COMPLETION_ENDPOINT,
    safeUserAction: config.safeUserAction,
    serverOnly: false,
    missingEnv,
  };
}

function normalizeRuntimeAiProvider(providerId, runtimeProvider = {}) {
  return {
    id: runtimeProvider.id || providerId,
    configured: Boolean(runtimeProvider.configured),
    enabled: Boolean(runtimeProvider.enabled),
    actionStatus: runtimeProvider.actionStatus || (runtimeProvider.enabled ? 'ready' : 'configure_required'),
    startEndpoint: runtimeProvider.startEndpoint || COMPLETION_ENDPOINT,
    safeUserAction: runtimeProvider.safeUserAction || `send_secretary_message_to_${providerId}`,
    serverOnly: Boolean(runtimeProvider.serverOnly),
    missingEnvCount: Array.isArray(runtimeProvider.missingEnv) ? runtimeProvider.missingEnv.length : 0,
    secretsRedacted: true,
  };
}

function buildRuntimeAiReadiness(runtime = {}) {
  const matrixById = new Map(
    (runtime.providerActionMatrix || [])
      .filter((provider) => provider?.category === 'ai' && provider?.id)
      .map((provider) => [provider.id, provider]),
  );
  const providers = Object.fromEntries(
    SUPPORTED_AI_PROVIDERS.map((providerId) => [
      providerId,
      normalizeRuntimeAiProvider(providerId, matrixById.get(providerId) || runtime.ai?.providers?.[providerId]),
    ]),
  );
  const providerValues = Object.values(providers);
  return {
    providerCount: providerValues.length,
    configuredProviderCount: providerValues.filter((provider) => provider.configured).length,
    enabledProviderCount: providerValues.filter((provider) => provider.enabled).length,
    defaultProvider: providerValues.find((provider) => provider.enabled)?.id || null,
    providers,
    // 架构审查 #8:契约与真运行时同读一条链(ai-provider-chain.mjs),不再漂移
    routing: Object.freeze({
      implementation: 'lib/portal/ai-complete.ts',
      completionChain: AI_COMPLETION_CHAIN,
      geminiModelFallbacks: GEMINI_MODEL_FALLBACKS,
    }),
  };
}

function buildAiProviderRouterContract({ productionRuntime, env } = {}) {
  const runtime = productionRuntime || {
    providerActionMatrix: SUPPORTED_AI_PROVIDERS.map((providerId) => buildRuntimeAiProviderFromEnv(providerId, env)),
  };
  const runtimeAiReadiness = buildRuntimeAiReadiness(runtime);
  const enabledProviderIds = SUPPORTED_AI_PROVIDERS
    .filter((providerId) => runtimeAiReadiness.providers[providerId]?.enabled);
  const aiRuntimeEnabled = runtimeAiReadiness.enabledProviderCount > 0;

  return {
    version: 'ai-provider-router-contract-v0',
    implementation: 'runtime-aware-contract',
    generatedAt: new Date().toISOString(),
    boundaries: {
      ...AI_PROVIDER_ROUTER_BOUNDARIES_V0,
      mode: aiRuntimeEnabled ? 'production-runtime' : AI_PROVIDER_ROUTER_BOUNDARIES_V0.mode,
      realProviderCallsEnabled: aiRuntimeEnabled,
      authorizesExternalProviders: aiRuntimeEnabled,
    },
    providers: {
      configured: enabledProviderIds,
      secretNames: [
        'OPENAI_API_KEY',
        'OpenAI_KEY',
        'GEMINI_API_KEY',
        'GOOGLE_GENERATIVE_AI_API_KEY',
        'GOOGLE_AI_API_KEY',
        'GOOGLE_API_KEY',
        'DOUBAO_KEY',
        'DOUBAO_API_KEY',
        'ANTHROPIC_API_KEY',
        'CLAUDE_API_KEY',
      ],
      productionProviderEnabled: aiRuntimeEnabled,
    },
    runtimeAiReadiness,
    modulePolicy: AI_MODULE_POLICY_V0.map((entry) => ({ ...entry })),
    launchPolicy: {
      shell: 'disabled',
      inventory: 'disabled',
      appStoreFirstRelease: 'disabled',
      internalSandbox: 'contract-only',
      requiresCeoGateForEnablement: true,
    },
    summary: {
      aiProviderRouterVersion: 'ai-provider-router-contract-v0',
      aiProviderConfiguredCount: runtimeAiReadiness.configuredProviderCount,
      aiProviderEnabledCount: runtimeAiReadiness.enabledProviderCount,
      aiRealProviderCallsEnabled: aiRuntimeEnabled,
      defaultAiProvider: runtimeAiReadiness.defaultProvider,
    },
  };
}

export {
  AI_MODULE_POLICY_V0,
  AI_PROVIDER_ROUTER_BOUNDARIES_V0,
  buildAiProviderRouterContract,
};
