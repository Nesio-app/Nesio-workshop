export const STAGE5_TOOL_INVOCATION_VERSION = 'stage5-tool-invocation-v0';

const EXECUTION_ENABLED_ENVS = Object.freeze([
  'NESIO_STAGE5_EXECUTION_ENABLED',
  'BAOHE_STAGE5_EXECUTION_ENABLED',
]);

const CEO_APPROVED_ENVS = Object.freeze([
  'NESIO_STAGE5_CEO_APPROVED',
  'BAOHE_STAGE5_CEO_APPROVED',
]);

const STAGE5_ACTIONS = Object.freeze([
  Object.freeze({
    actionKey: 'calendar.event.create',
    label: 'Create Google Calendar event',
    provider: 'google_calendar',
    sideEffectKind: 'external_write',
    executionSurface: 'app/api/portal/tool-invocation',
    requiredEnv: Object.freeze(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']),
    requiredRuntimeContext: Object.freeze(['hasInvocationSecret', 'hasGoogleCalendarAccessToken']),
    rollbackActionKey: 'calendar.event.delete',
    auditRequired: true,
    timeoutMs: 10000,
    stage5Approved: true,
  }),
  Object.freeze({
    actionKey: 'notification.webhook.send',
    label: 'Send configured notification webhook',
    provider: 'notification_webhook',
    sideEffectKind: 'external_notification',
    executionSurface: 'app/api/portal/tool-invocation',
    requiredEnv: Object.freeze([]),
    alternateEnvAny: Object.freeze(['NESIO_NOTIFICATION_WEBHOOK_URL', 'FLOMO_WEBHOOK_URL']),
    requiredRuntimeContext: Object.freeze(['hasInvocationSecret']),
    rollbackActionKey: null,
    auditRequired: true,
    timeoutMs: 8000,
    stage5Approved: true,
  }),
  Object.freeze({
    actionKey: 'ai.provider.chat',
    label: 'Secretary AI provider chat',
    provider: 'secretary_provider_router',
    sideEffectKind: 'provider_call',
    executionSurface: 'app/api/secretary/chat',
    requiredEnv: Object.freeze(['BAOHE_AI_PROVIDER_MODE']),
    alternateEnvAny: Object.freeze([
      'GEMINI_API_KEY',
      'GOOGLE_GENERATIVE_AI_API_KEY',
      'OPENAI_API_KEY',
      'OpenAI_KEY',
      'ANTHROPIC_API_KEY',
      'CLAUDE_API_KEY',
      'DOUBAO_KEY',
    ]),
    requiredRuntimeContext: Object.freeze([]),
    rollbackActionKey: null,
    auditRequired: true,
    timeoutMs: 30000,
    stage5Approved: true,
    delegated: true,
  }),
  Object.freeze({
    actionKey: 'ai.tts.generate',
    label: 'Generate speech with OpenAI TTS',
    provider: 'openai_tts',
    sideEffectKind: 'provider_call',
    executionSurface: 'app/api/portal/tts',
    requiredEnv: Object.freeze([]),
    alternateEnvAny: Object.freeze(['OPENAI_API_KEY', 'OpenAI_KEY']),
    requiredRuntimeContext: Object.freeze([]),
    rollbackActionKey: null,
    auditRequired: true,
    timeoutMs: 20000,
    stage5Approved: true,
    delegated: true,
  }),
]);

function readEnv(name, env) {
  const value = env?.[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function envFlag(names, env) {
  return names.some((name) => readEnv(name, env).toLowerCase() === 'true');
}

function hasAnyEnv(names = [], env) {
  return names.some((name) => Boolean(readEnv(name, env)));
}

export function listStage5ToolActions() {
  return STAGE5_ACTIONS.map((action) => ({
    ...action,
    requiredEnv: [...action.requiredEnv],
    alternateEnvAny: [...(action.alternateEnvAny || [])],
    requiredRuntimeContext: [...action.requiredRuntimeContext],
  }));
}

function findAction(actionKey) {
  return STAGE5_ACTIONS.find((action) => action.actionKey === actionKey) || null;
}

function missingEnvForAction(action, env) {
  const missingRequired = action.requiredEnv.filter((name) => !readEnv(name, env));
  const alternateSatisfied = action.alternateEnvAny?.length
    ? hasAnyEnv(action.alternateEnvAny, env)
    : true;
  return {
    missingRequired,
    missingAlternateAny: alternateSatisfied ? [] : [...action.alternateEnvAny],
  };
}

function missingRuntimeContextForAction(action, runtimeContext) {
  return action.requiredRuntimeContext.filter((key) => runtimeContext?.[key] !== true);
}

export function evaluateStage5ToolInvocationPolicy({
  actionKey,
  executionMode = 'dry_run',
  env = process.env,
  runtimeContext = {},
} = {}) {
  const action = findAction(actionKey);
  const mode = executionMode === 'execute' ? 'execute' : 'dry_run';
  const ceoApproved = envFlag(CEO_APPROVED_ENVS, env);
  const executionEnabled = envFlag(EXECUTION_ENABLED_ENVS, env);

  if (!action) {
    return {
      allowed: false,
      mode,
      actionKey,
      blockedReason: 'unknown_action',
      ceoApproved,
      executionEnabled,
    };
  }

  const { missingRequired, missingAlternateAny } = missingEnvForAction(action, env);
  const missingRuntimeContext = missingRuntimeContextForAction(action, runtimeContext);
  const configured = missingRequired.length === 0 && missingAlternateAny.length === 0;

  if (mode === 'dry_run') {
    return {
      allowed: true,
      mode,
      actionKey: action.actionKey,
      provider: action.provider,
      sideEffectKind: action.sideEffectKind,
      configured,
      missingEnv: [...missingRequired, ...missingAlternateAny],
      missingRuntimeContext,
      ceoApproved,
      executionEnabled,
      wouldExecuteWithRuntimeEnabled: configured,
      rollbackActionKey: action.rollbackActionKey,
      delegated: Boolean(action.delegated),
    };
  }

  if (!ceoApproved || !executionEnabled) {
    return {
      allowed: false,
      mode,
      actionKey: action.actionKey,
      provider: action.provider,
      sideEffectKind: action.sideEffectKind,
      blockedReason: !ceoApproved ? 'stage5_ceo_approval_missing' : 'stage5_execution_disabled',
      configured,
      missingEnv: [...missingRequired, ...missingAlternateAny],
      missingRuntimeContext,
      ceoApproved,
      executionEnabled,
      rollbackActionKey: action.rollbackActionKey,
      delegated: Boolean(action.delegated),
    };
  }

  if (!configured) {
    return {
      allowed: false,
      mode,
      actionKey: action.actionKey,
      provider: action.provider,
      sideEffectKind: action.sideEffectKind,
      blockedReason: 'missing_provider_env',
      configured,
      missingEnv: [...missingRequired, ...missingAlternateAny],
      missingRuntimeContext,
      ceoApproved,
      executionEnabled,
      rollbackActionKey: action.rollbackActionKey,
      delegated: Boolean(action.delegated),
    };
  }

  if (missingRuntimeContext.length > 0) {
    const runtimeBlockedReason = missingRuntimeContext.includes('hasInvocationSecret')
      ? 'missing_stage5_invocation_secret'
      : missingRuntimeContext.includes('hasGoogleCalendarAccessToken')
        ? 'missing_google_calendar_access_token'
        : 'missing_runtime_context';
    return {
      allowed: false,
      mode,
      actionKey: action.actionKey,
      provider: action.provider,
      sideEffectKind: action.sideEffectKind,
      blockedReason: runtimeBlockedReason,
      configured,
      missingEnv: [],
      missingRuntimeContext,
      ceoApproved,
      executionEnabled,
      rollbackActionKey: action.rollbackActionKey,
      delegated: Boolean(action.delegated),
    };
  }

  return {
    allowed: true,
    mode,
    actionKey: action.actionKey,
    provider: action.provider,
    sideEffectKind: action.sideEffectKind,
    configured,
    missingEnv: [],
    missingRuntimeContext: [],
    ceoApproved,
    executionEnabled,
    rollbackActionKey: action.rollbackActionKey,
    delegated: Boolean(action.delegated),
  };
}

export function buildStage5ToolInvocationReport({ env = process.env } = {}) {
  const ceoApproved = envFlag(CEO_APPROVED_ENVS, env);
  const executionEnabled = envFlag(EXECUTION_ENABLED_ENVS, env);
  const actions = STAGE5_ACTIONS.map((action) => {
    const { missingRequired, missingAlternateAny } = missingEnvForAction(action, env);
    const missingEnv = [...missingRequired, ...missingAlternateAny];
    const configured = missingEnv.length === 0;
    return {
      actionKey: action.actionKey,
      label: action.label,
      provider: action.provider,
      sideEffectKind: action.sideEffectKind,
      executionSurface: action.executionSurface,
      configured,
      executable: ceoApproved && executionEnabled && configured && !action.delegated,
      delegated: Boolean(action.delegated),
      stage5Approved: action.stage5Approved,
      auditRequired: action.auditRequired,
      timeoutMs: action.timeoutMs,
      rollbackActionKey: action.rollbackActionKey,
      requiredEnv: [...action.requiredEnv],
      alternateEnvAny: [...(action.alternateEnvAny || [])],
      missingEnv,
    };
  });
  return {
    version: STAGE5_TOOL_INVOCATION_VERSION,
    implementation: 'audited-stage5-tool-invocation',
    summary: {
      version: STAGE5_TOOL_INVOCATION_VERSION,
      ceoApproved,
      executionEnabled,
      actionCount: actions.length,
      configuredActionCount: actions.filter((action) => action.configured).length,
      executableActionCount: actions.filter((action) => action.executable).length,
      delegatedActionCount: actions.filter((action) => action.delegated).length,
      realExternalActionCount: actions.filter((action) =>
        ['external_write', 'external_notification', 'provider_call'].includes(action.sideEffectKind),
      ).length,
      blockedActionCount: actions.filter((action) => !action.executable && !action.delegated).length,
    },
    boundaries: {
      agentDirectToolExecutionAllowed: false,
      rawMemoryInjectionAllowed: false,
      unauditedProviderCallsAllowed: false,
      auditEnvelopeRequired: true,
      idempotencyKeyRecommended: true,
      rollbackPlanRequiredForWrites: true,
      defaultExecutionMode: 'dry_run',
    },
    actions,
  };
}

export function createStage5AuditId(prefix = 'stage5') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function buildStage5InvocationEnvelope({
  actionKey,
  executionMode,
  status,
  auditId = createStage5AuditId(),
  policyDecision,
  result = null,
  error = null,
  idempotencyKey = null,
} = {}) {
  return {
    ok: status === 'executed' || status === 'dry_run',
    version: STAGE5_TOOL_INVOCATION_VERSION,
    auditId,
    actionKey,
    executionMode: executionMode === 'execute' ? 'execute' : 'dry_run',
    status,
    idempotencyKey,
    policyDecision,
    result,
    error,
    rollback: policyDecision?.rollbackActionKey
      ? {
          actionKey: policyDecision.rollbackActionKey,
          automatic: false,
          note: 'Rollback is declared but never executed automatically.',
        }
      : null,
    sideEffects: status === 'executed'
      ? [{ provider: policyDecision?.provider, kind: policyDecision?.sideEffectKind }]
      : [],
    generatedAt: new Date().toISOString(),
  };
}
