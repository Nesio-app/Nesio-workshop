export const DOMAIN_CAPABILITY_TAXONOMY_VERSION_V1 = 'domain-capability-taxonomy-v1';
export const SIGNAL_CONTEXT_SCHEMA_VERSION_V1 = 'signal-context-v1';

export const DOMAIN_CAPABILITY_DOMAINS_V1 = Object.freeze([
  {
    value: 'life',
    label: '生活',
    zhLabel: '生活',
    enLabel: 'Life',
    description: 'Daily context, relationships, places, commitments, and ordinary life continuity.',
  },
  {
    value: 'growth',
    label: '成长',
    zhLabel: '成长',
    enLabel: 'Growth',
    description: 'Tasks, learning, reading, review, planning, and personal capability growth.',
  },
  {
    value: 'assets',
    label: '财物',
    zhLabel: '财物',
    enLabel: 'Assets',
    description: 'Inventory, purchase memory, objects, ownership, finance-adjacent records, and value tracking.',
  },
  {
    value: 'health',
    label: '健康',
    zhLabel: '健康',
    enLabel: 'Health',
    description: 'Body, sleep, movement, symptoms, health records, and high-trust care boundaries.',
  },
  {
    value: 'energy',
    label: '能量',
    zhLabel: '能量',
    enLabel: 'Energy',
    description: 'Mood, recovery, reflection, simulation, inner state, and high-trust emotional boundaries.',
  },
  {
    value: 'platform',
    label: '平台支撑',
    zhLabel: '平台支撑',
    enLabel: 'Platform',
    description: 'Cross-domain assistant, routing, governance, entitlement, and shell infrastructure.',
  },
]);

export const FRONTSTAGE_DOMAIN_VALUES_V1 = Object.freeze([
  'life',
  'growth',
  'assets',
  'health',
  'energy',
]);

export const DOMAIN_CAPABILITY_DEFINITIONS_V1 = Object.freeze([
  { value: 'capture', label: 'Capture', zhLabel: '捕获', aliases: ['capture'] },
  {
    value: 'context_extraction',
    label: 'Context Extraction',
    zhLabel: '上下文提取',
    aliases: ['context_extraction', 'context'],
  },
  { value: 'router', label: 'Router', zhLabel: '路由', aliases: ['router'] },
  {
    value: 'memory_graph',
    label: 'MemoryGraph',
    zhLabel: '记忆图谱',
    aliases: ['memory_graph', 'memorygraph'],
  },
  { value: 'search_retrieval', label: 'Search', zhLabel: '搜索', aliases: ['search_retrieval', 'search'] },
  {
    value: 'schedule_daily_plan',
    label: 'Daily Plan',
    zhLabel: '日程计划',
    aliases: ['schedule_daily_plan', 'daily_plan'],
  },
  { value: 'reminder', label: 'Reminder', zhLabel: '提醒', aliases: ['reminder'] },
  { value: 'place', label: 'Place', zhLabel: '地点', aliases: ['place'] },
  { value: 'ai_assistant', label: 'AI Assistant', zhLabel: 'AI 助手', aliases: ['ai_assistant', 'ai'] },
  { value: 'insight', label: 'Insight', zhLabel: '洞察', aliases: ['insight'] },
  { value: 'export_delete', label: 'Export/Delete', zhLabel: '导出/删除', aliases: ['export_delete'] },
  { value: 'sync', label: 'Sync', zhLabel: '同步', aliases: ['sync'] },
  {
    value: 'entitlement_subscription',
    label: 'Entitlement',
    zhLabel: '权益',
    aliases: ['entitlement_subscription', 'entitlement'],
  },
  {
    value: 'approval_gate',
    label: 'Approval Gate',
    zhLabel: '审批闸门',
    aliases: ['approval_gate'],
  },
]);

export const DOMAIN_CAPABILITY_VALUES_V1 = Object.freeze(
  DOMAIN_CAPABILITY_DEFINITIONS_V1.map((capability) => capability.value),
);

export const SALVAGE_STATUS_VALUES_V1 = Object.freeze([
  'core_domain_engine',
  'capability_material',
  'sandbox_material',
  'gated_material',
  'hidden_material',
  'deprecated_material',
]);

export const VISIBILITY_VALUES_V1 = Object.freeze([
  'frontstage',
  'signed_in',
  'tester_only',
  'gated',
  'hidden',
  'internal',
]);

export const GATE_LEVEL_VALUES_V1 = Object.freeze([
  'none',
  'local_only',
  'signed_in',
  'approval_required',
  'ceo_gate',
  'lab_only',
]);

export const GOVERNANCE_RESOLVER_ORDER_V1 = Object.freeze([
  'safety_gate',
  'entitlement_gate',
  'quota_gate',
  'cost_gate',
  'audit_log',
]);

export const SIGNAL_CONTEXT_FIELDS_V1 = Object.freeze([
  'domain',
  'secondaryDomains',
  'labels',
  'people',
  'places',
  'objects',
  'time',
  'role',
  'goal',
  'state',
  'intent',
  'source',
  'sensitivity',
  'permission',
  'confidence',
]);

export const SIGNAL_CONTEXT_WRITEBACK_LOOP_V1 = Object.freeze([
  'label_or_source_hint_received',
  'derive_context_from_label_and_signal',
  'user_confirms_or_edits_context',
  'write_confirmed_context_to_signal',
  'project_to_memory_search_reminder_insight',
]);

export const SIGNAL_LABEL_CONTEXT_LOOP_V1 = Object.freeze({
  labelCreatesContext: true,
  userConfirmationBeforeSignalWrite: true,
  signalIsWriteBoundary: true,
  projectsTo: ['memory', 'search', 'reminder', 'insight'],
});

export const SIGNAL_CONTEXT_SCHEMA_V1 = Object.freeze({
  version: SIGNAL_CONTEXT_SCHEMA_VERSION_V1,
  fields: [...SIGNAL_CONTEXT_FIELDS_V1],
  writebackLoop: [...SIGNAL_CONTEXT_WRITEBACK_LOOP_V1],
  labelContextLoop: SIGNAL_LABEL_CONTEXT_LOOP_V1,
  aiSuggestedAllowed: true,
  userConfirmationRequired: true,
  sensitiveDomainsRequireConfirmation: true,
  writesSignalContext: true,
});

export const SIGNAL_INPUT_CONTRACT_VERSION_V1 = 'signal-input-contract-v1';

export const SIGNAL_INPUT_FLOW_STEPS_V1 = Object.freeze([
  'capture',
  'normalize',
  'create_signal',
  'suggest_context',
  'user_confirm_or_edit',
  'write_context',
  'project',
]);

export const SIGNAL_INPUT_RUNTIME_STATUS_VALUES_V1 = Object.freeze([
  'runtime_partial',
  'contract_only',
]);

const DEFAULT_SIGNAL_PROJECTION_TARGETS_V1 = Object.freeze([
  'memory',
  'search',
  'reminder',
  'insight',
]);

export const SIGNAL_INPUT_SURFACE_DEFINITIONS_V1 = Object.freeze([
  {
    surface: 'voice',
    source: 'voice',
    primaryDomain: 'life',
    secondaryDomains: [],
    requiredCapabilities: ['capture', 'context_extraction'],
    sensitive: false,
    externalSource: false,
    runtimeStatus: 'runtime_partial',
    owner: 'Qiao',
    currentRuntimeCoverage: 'Voice capture and text normalization are partially wired; trusted context must still be confirmed.',
  },
  {
    surface: 'photo',
    source: 'photo',
    primaryDomain: 'life',
    secondaryDomains: ['assets'],
    requiredCapabilities: ['capture', 'context_extraction', 'memory_graph'],
    sensitive: false,
    externalSource: false,
    runtimeStatus: 'runtime_partial',
    owner: 'Qiao',
    currentRuntimeCoverage: 'Photo upload/capture can draft nodes; AI tags and storage binding are still being hardened.',
  },
  {
    surface: 'text',
    source: 'text',
    primaryDomain: 'life',
    secondaryDomains: [],
    requiredCapabilities: ['capture', 'context_extraction'],
    sensitive: false,
    externalSource: false,
    runtimeStatus: 'runtime_partial',
    owner: 'Qiao',
    currentRuntimeCoverage: 'Manual text intake can create local memory/signals and must keep confirmation before projection.',
  },
  {
    surface: 'upload',
    source: 'file',
    primaryDomain: 'life',
    secondaryDomains: ['assets'],
    requiredCapabilities: ['capture', 'context_extraction', 'memory_graph'],
    sensitive: false,
    externalSource: false,
    runtimeStatus: 'runtime_partial',
    owner: 'Qiao',
    currentRuntimeCoverage: 'Upload intake is allowed to draft context only after normalization and user confirmation.',
  },
  {
    surface: 'calendar',
    source: 'calendar',
    primaryDomain: 'life',
    secondaryDomains: ['growth'],
    requiredCapabilities: ['capture', 'schedule_daily_plan', 'reminder'],
    sensitive: false,
    externalSource: true,
    runtimeStatus: 'runtime_partial',
    owner: 'Qiao',
    currentRuntimeCoverage: 'Calendar reads are gated; generated schedule signals need evidence ids before Today/DEC claims.',
  },
  {
    surface: 'gmail',
    source: 'gmail',
    primaryDomain: 'life',
    secondaryDomains: ['growth'],
    requiredCapabilities: ['capture', 'context_extraction', 'memory_graph'],
    sensitive: true,
    externalSource: true,
    runtimeStatus: 'contract_only',
    owner: 'Qiao',
    currentRuntimeCoverage: 'Gmail must remain metadata/status-first until explicit per-item analysis is confirmed.',
  },
  {
    surface: 'weather',
    source: 'weather',
    primaryDomain: 'health',
    secondaryDomains: ['life'],
    requiredCapabilities: ['capture', 'insight'],
    sensitive: false,
    externalSource: true,
    runtimeStatus: 'runtime_partial',
    owner: 'Qiao',
    currentRuntimeCoverage: 'Weather can support low-risk context; health-weather advice requires paired evidence.',
  },
  {
    surface: 'health',
    source: 'health',
    primaryDomain: 'health',
    secondaryDomains: ['energy'],
    requiredCapabilities: ['capture', 'insight', 'reminder'],
    sensitive: true,
    externalSource: false,
    runtimeStatus: 'contract_only',
    owner: 'Qiao',
    currentRuntimeCoverage: 'Health remains high-trust contract-first; no medical advice or raw health sync by default.',
  },
  {
    surface: 'task',
    source: 'task',
    primaryDomain: 'growth',
    secondaryDomains: ['life'],
    requiredCapabilities: ['capture', 'schedule_daily_plan', 'reminder'],
    sensitive: false,
    externalSource: false,
    runtimeStatus: 'runtime_partial',
    owner: 'Qiao',
    currentRuntimeCoverage: 'Task/todo signals can support local planning and must remain evidence-backed.',
  },
]);

function buildSignalInputSurfaceV1(surfaceDefinition) {
  const projectionTargets = [...DEFAULT_SIGNAL_PROJECTION_TARGETS_V1];
  return Object.freeze({
    version: SIGNAL_INPUT_CONTRACT_VERSION_V1,
    ...surfaceDefinition,
    normalizeBeforeSignal: true,
    writesSignal: true,
    signalIsWriteBoundary: true,
    requiresUserConfirmationBeforeTrust: true,
    sensitiveDomainsRequireConfirmation: surfaceDefinition.sensitive === true,
    dualWriteMode: 'memory_lifegraph_plus_signals',
    projectionTargets,
    flowSteps: [...SIGNAL_INPUT_FLOW_STEPS_V1],
    contextSchema: SIGNAL_CONTEXT_SCHEMA_V1,
    contextWritebackLoop: [...SIGNAL_CONTEXT_WRITEBACK_LOOP_V1],
    labelContextLoop: { ...SIGNAL_LABEL_CONTEXT_LOOP_V1 },
    governanceResolverOrder: [...GOVERNANCE_RESOLVER_ORDER_V1],
    realExternalActionEnabled: false,
    changesRuntimeBehavior: false,
    implementation: 'static-contract-report',
  });
}

function buildSignalInputWarningsV1(surfaces) {
  const warnings = [];
  for (const surface of surfaces) {
    if (surface.normalizeBeforeSignal !== true) {
      warnings.push({
        surface: surface.surface,
        warningKind: 'signal_input_missing_normalize',
        reason: 'Signal input must normalize before createSignal.',
        owner: surface.owner || 'Qiao',
      });
    }
    if (surface.writesSignal !== true || surface.signalIsWriteBoundary !== true) {
      warnings.push({
        surface: surface.surface,
        warningKind: 'signal_input_missing_write_boundary',
        reason: 'Signal input must use Signal as the write boundary before projection.',
        owner: surface.owner || 'Qiao',
      });
    }
    if (surface.requiresUserConfirmationBeforeTrust !== true) {
      warnings.push({
        surface: surface.surface,
        warningKind: 'signal_input_missing_user_confirmation',
        reason: 'AI-derived context must be confirmed or edited before becoming trusted context.',
        owner: surface.owner || 'Qiao',
      });
    }
    if (!Array.isArray(surface.projectionTargets) || surface.projectionTargets.length === 0) {
      warnings.push({
        surface: surface.surface,
        warningKind: 'signal_input_missing_projection_targets',
        reason: 'Signal input should declare where confirmed context can project.',
        owner: surface.owner || 'Qiao',
      });
    }
  }
  return warnings;
}

export function buildSignalInputContractV1() {
  const surfaces = SIGNAL_INPUT_SURFACE_DEFINITIONS_V1.map(buildSignalInputSurfaceV1);
  const warnings = buildSignalInputWarningsV1(surfaces);
  return Object.freeze({
    version: SIGNAL_INPUT_CONTRACT_VERSION_V1,
    implementation: 'static-contract-report',
    boundaries: {
      reportOnly: true,
      readsRuntimeData: false,
      writesRealData: false,
      migratesRealData: false,
      enablesExternalAuthorization: false,
      enablesAiRuntime: false,
      changesRuntimeBehavior: false,
      signalAsWriteBoundary: true,
      requiresUserConfirmationBeforeTrustedContext: true,
    },
    flowSteps: [...SIGNAL_INPUT_FLOW_STEPS_V1],
    projectionTargets: [...DEFAULT_SIGNAL_PROJECTION_TARGETS_V1],
    surfaces,
    surfaceIndex: Object.freeze(Object.fromEntries(surfaces.map((surface) => [surface.surface, surface]))),
    summary: {
      surfaceCount: surfaces.length,
      sensitiveSurfaceCount: surfaces.filter((surface) => surface.sensitive).length,
      externalSurfaceCount: surfaces.filter((surface) => surface.externalSource).length,
      writesSignalSurfaceCount: surfaces.filter((surface) => surface.writesSignal).length,
      requiresConfirmationSurfaceCount: surfaces.filter((surface) => surface.requiresUserConfirmationBeforeTrust).length,
      runtimePartialSurfaceCount: surfaces.filter((surface) => surface.runtimeStatus === 'runtime_partial').length,
      contractOnlySurfaceCount: surfaces.filter((surface) => surface.runtimeStatus === 'contract_only').length,
      warningCount: warnings.length,
    },
    warnings,
  });
}

const DOMAIN_LABEL_BY_VALUE = Object.freeze(
  Object.fromEntries(DOMAIN_CAPABILITY_DOMAINS_V1.map((domain) => [domain.value, domain.label])),
);
const DOMAIN_ZH_LABEL_BY_VALUE = Object.freeze(
  Object.fromEntries(DOMAIN_CAPABILITY_DOMAINS_V1.map((domain) => [domain.value, domain.zhLabel || domain.label])),
);
const DOMAIN_EN_LABEL_BY_VALUE = Object.freeze(
  Object.fromEntries(DOMAIN_CAPABILITY_DOMAINS_V1.map((domain) => [domain.value, domain.enLabel || domain.label])),
);
const CAPABILITY_BY_VALUE = Object.freeze(
  Object.fromEntries(DOMAIN_CAPABILITY_DEFINITIONS_V1.map((capability) => [capability.value, capability])),
);

const MODULE_DOMAIN_CAPABILITY_OVERRIDES = Object.freeze({
  inventory: {
    primaryDomain: 'assets',
    secondaryDomains: ['life'],
    providedCapabilities: [
      'capture',
      'context_extraction',
      'memory_graph',
      'search_retrieval',
      'place',
      'export_delete',
    ],
    requiredCapabilities: ['capture', 'memory_graph', 'search_retrieval'],
    salvageStatus: 'core_domain_engine',
    visibility: 'frontstage',
    gateLevel: 'local_only',
  },
  plan: {
    primaryDomain: 'growth',
    secondaryDomains: ['life'],
    providedCapabilities: ['capture', 'schedule_daily_plan', 'reminder', 'router'],
    requiredCapabilities: ['schedule_daily_plan', 'reminder'],
    salvageStatus: 'core_domain_engine',
    visibility: 'frontstage',
    gateLevel: 'local_only',
  },
  reading: {
    primaryDomain: 'growth',
    secondaryDomains: ['life'],
    providedCapabilities: ['capture', 'memory_graph', 'search_retrieval', 'insight'],
    requiredCapabilities: ['capture', 'search_retrieval'],
    salvageStatus: 'sandbox_material',
    visibility: 'tester_only',
    gateLevel: 'signed_in',
  },
  quiz: {
    primaryDomain: 'growth',
    secondaryDomains: ['life'],
    providedCapabilities: ['capture', 'insight', 'search_retrieval'],
    requiredCapabilities: ['capture'],
    salvageStatus: 'sandbox_material',
    visibility: 'tester_only',
    gateLevel: 'signed_in',
  },
  fitness: {
    primaryDomain: 'health',
    secondaryDomains: ['growth'],
    providedCapabilities: ['capture', 'insight', 'reminder'],
    requiredCapabilities: ['capture'],
    salvageStatus: 'sandbox_material',
    visibility: 'tester_only',
    gateLevel: 'approval_required',
  },
  health: {
    primaryDomain: 'health',
    secondaryDomains: ['life'],
    providedCapabilities: ['capture', 'insight', 'reminder', 'sync'],
    requiredCapabilities: ['capture'],
    salvageStatus: 'gated_material',
    visibility: 'gated',
    gateLevel: 'ceo_gate',
  },
  sanctuary: {
    primaryDomain: 'energy',
    secondaryDomains: ['life'],
    providedCapabilities: ['capture', 'insight', 'reminder'],
    requiredCapabilities: ['capture'],
    salvageStatus: 'sandbox_material',
    visibility: 'tester_only',
    gateLevel: 'approval_required',
  },
  psychoanalysis: {
    primaryDomain: 'energy',
    secondaryDomains: ['life'],
    providedCapabilities: ['ai_assistant', 'insight', 'context_extraction'],
    requiredCapabilities: ['ai_assistant'],
    salvageStatus: 'gated_material',
    visibility: 'gated',
    gateLevel: 'ceo_gate',
  },
  lifesim: {
    primaryDomain: 'energy',
    secondaryDomains: ['growth'],
    providedCapabilities: ['insight', 'router', 'ai_assistant'],
    requiredCapabilities: ['insight'],
    salvageStatus: 'sandbox_material',
    visibility: 'tester_only',
    gateLevel: 'lab_only',
  },
  finance: {
    primaryDomain: 'assets',
    secondaryDomains: ['life'],
    providedCapabilities: ['capture', 'insight', 'approval_gate', 'sync'],
    requiredCapabilities: ['approval_gate'],
    salvageStatus: 'hidden_material',
    visibility: 'hidden',
    gateLevel: 'ceo_gate',
  },
  secretary: {
    primaryDomain: 'platform',
    secondaryDomains: ['life'],
    providedCapabilities: ['ai_assistant', 'context_extraction', 'router', 'search_retrieval'],
    requiredCapabilities: ['ai_assistant', 'context_extraction'],
    salvageStatus: 'capability_material',
    visibility: 'gated',
    gateLevel: 'ceo_gate',
  },
});

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function defaultDomainCapability(moduleId, tool = {}) {
  const isHidden = tool.launchStatus === 'hidden';
  return {
    primaryDomain: 'life',
    secondaryDomains: [],
    providedCapabilities: ['capture'],
    requiredCapabilities: ['capture'],
    salvageStatus: isHidden ? 'hidden_material' : 'sandbox_material',
    visibility: isHidden ? 'hidden' : 'tester_only',
    gateLevel: isHidden ? 'approval_required' : 'signed_in',
  };
}

export function buildDomainCapabilityTaxonomyV1(moduleId, tool = {}, capability = {}) {
  const override = MODULE_DOMAIN_CAPABILITY_OVERRIDES[moduleId] || defaultDomainCapability(moduleId, tool);
  const providedCapabilities = uniqueValues([
    ...(override.providedCapabilities || []),
    ...(tool.providedCapabilities || []),
  ]);
  const requiredCapabilities = uniqueValues([
    ...(override.requiredCapabilities || []),
    ...(tool.requiredCapabilities || []),
  ]);

  return {
    domainCapabilityVersion: DOMAIN_CAPABILITY_TAXONOMY_VERSION_V1,
    primaryDomain: override.primaryDomain,
    primaryDomainLabel: DOMAIN_LABEL_BY_VALUE[override.primaryDomain] || override.primaryDomain,
    primaryDomainZhLabel: DOMAIN_ZH_LABEL_BY_VALUE[override.primaryDomain] || override.primaryDomain,
    primaryDomainEnglishLabel: DOMAIN_EN_LABEL_BY_VALUE[override.primaryDomain] || override.primaryDomain,
    secondaryDomains: uniqueValues([...(override.secondaryDomains || []), ...(tool.secondaryDomains || [])]),
    providedCapabilities,
    providedCapabilityDefinitions: providedCapabilities.map((capability) => (
      CAPABILITY_BY_VALUE[capability] || { value: capability, label: capability, zhLabel: capability, aliases: [capability] }
    )),
    requiredCapabilities,
    contextSchema: SIGNAL_CONTEXT_SCHEMA_V1,
    salvageStatus: override.salvageStatus,
    visibility: override.visibility,
    gateLevel: override.gateLevel,
    governanceResolverOrder: [...GOVERNANCE_RESOLVER_ORDER_V1],
    capabilitySource: capability.mode || 'registry',
  };
}
