export const MODULE_PRODUCT_CONTRACT_VERSION_V0 = 'module-product-contract-v0';
export const CORE_OBJECT_MODEL_CONTRACT_VERSION_V0 = 'core-object-model-contract-v0';

export const LAUNCH_COHORT_VALUES_V0 = Object.freeze([
  'first_launch',
  'sandbox',
  'gated',
  'internal_only',
]);

export const RISK_TIER_VALUES_V0 = Object.freeze([
  'low',
  'medium',
  'high_trust',
]);

export const MONETIZATION_STATUS_VALUES_V0 = Object.freeze([
  'free_first_launch',
  'future_paid',
  'report_only',
  'internal_only',
]);

const OBJECT_GROUPS = Object.freeze({
  dailyCore: Object.freeze({
    label: 'Daily Core',
    objects: Object.freeze(['FlowTask', 'RecoveryStep', 'ReadingPosition', 'ShelterSession']),
    modules: Object.freeze(['plan', 'reading', 'sanctuary']),
  }),
  storage: Object.freeze({
    label: 'Storage',
    objects: Object.freeze(['InventoryItem', 'PurchaseMemory', 'LocationAnchor', 'FreezeIntent', 'ExpirySignal']),
    modules: Object.freeze(['inventory']),
  }),
  learning: Object.freeze({
    label: 'Learning',
    objects: Object.freeze(['Source', 'Highlight', 'Concept', 'Question', 'Attempt', 'ReviewCard']),
    modules: Object.freeze(['reading', 'quiz']),
  }),
});

const PRODUCT_COPY_BY_MODULE = Object.freeze({
  inventory: Object.freeze({
    launchCohort: 'first_launch',
    primaryUser: '想先用宝盒管理真实物品和购买记忆的首发用户',
    openMoment: '用户想记录、搜索或回忆某个物品在哪里买、为什么买、放在哪里时',
    primaryUseCase: '本地记录物品、位置线索和购买记忆',
    primaryAction: '添加一个物品并写下购买记忆',
    publicPromise: Object.freeze(['本地管理物品', '记录购买记忆', '支持 demo 或空白开始']),
    doNotPromise: Object.freeze(['自动识别所有物品', '云同步', '财务建议', '真实支付或收据导入']),
    riskTier: 'low',
    dataObjects: Object.freeze(['InventoryItem', 'PurchaseMemory', 'LocationAnchor', 'FreezeIntent', 'ExpirySignal']),
    firstRunPath: 'choose_demo_or_blank -> add_inventory_item -> write_purchase_memory -> search_or_view -> export_or_delete',
    readinessBlockers: Object.freeze(['TestFlight 前需要 Ming/Zhao 移动端主路径验收', '公开提交前需要 CEO Gate']),
    monetizationStatus: 'free_first_launch',
    marketingClaim: '用宝盒本地记录物品与购买记忆。',
    appReviewNote: '首发仅包含本地 Inventory / purchase-memory 流程；不启用云同步、支付、外部授权或 AI。',
    privacyLabelImpact: 'local_user_content_optional_camera_photo',
  }),
  plan: Object.freeze({
    launchCohort: 'sandbox',
    primaryUser: '需要低摩擦拆分任务与恢复行动的内部测试用户',
    openMoment: '用户卡住、分心或需要把下一步拆小的时候',
    primaryUseCase: '把待办拆成可执行的本地行动线索',
    primaryAction: '创建 FlowTask 或 RecoveryStep 草稿',
    publicPromise: Object.freeze(['内部 sandbox 的任务流原型']),
    doNotPromise: Object.freeze(['AI 自动执行', '替用户完成外部任务', '生产级任务同步']),
    riskTier: 'medium',
    dataObjects: Object.freeze(['FlowTask', 'RecoveryStep']),
    firstRunPath: 'sandbox_open -> create_flow_task_draft',
    readinessBlockers: Object.freeze(['需要 Luma/Nora 验收首发用户场景', '需要数据对象稳定后再公开']),
    monetizationStatus: 'future_paid',
    marketingClaim: '',
    appReviewNote: 'Not included in first launch public claims.',
    privacyLabelImpact: 'internal_sandbox_only',
  }),
  reading: Object.freeze({
    launchCohort: 'sandbox',
    primaryUser: '想把阅读位置和学习材料纳入宝盒的内部测试用户',
    openMoment: '用户想继续阅读、标记段落或回看学习材料时',
    primaryUseCase: '记录阅读位置和学习对象草稿',
    primaryAction: '打开阅读材料并记录 ReadingPosition',
    publicPromise: Object.freeze(['内部 sandbox 的阅读与学习对象原型']),
    doNotPromise: Object.freeze(['自动总结外部书籍', '承诺版权题库或版权内容可用', '公开学习平台能力']),
    riskTier: 'medium',
    dataObjects: Object.freeze(['ReadingPosition', 'Source', 'Highlight', 'Concept']),
    firstRunPath: 'sandbox_open -> resume_reading_position',
    readinessBlockers: Object.freeze(['版权边界需要 Vera/CEO 在公开前复核']),
    monetizationStatus: 'future_paid',
    marketingClaim: '',
    appReviewNote: 'Not included in first launch public claims.',
    privacyLabelImpact: 'internal_sandbox_only',
  }),
  sanctuary: Object.freeze({
    launchCohort: 'sandbox',
    primaryUser: '需要情绪整理空间的内部测试用户',
    openMoment: '用户想安静下来、记录一段庇护体验时',
    primaryUseCase: '本地记录 ShelterSession 草稿',
    primaryAction: '开始一段本地 ShelterSession',
    publicPromise: Object.freeze(['内部 sandbox 的安静空间原型']),
    doNotPromise: Object.freeze(['治疗', '心理诊断', '替代专业支持', '危机干预']),
    riskTier: 'high_trust',
    dataObjects: Object.freeze(['ShelterSession', 'RecoveryStep']),
    firstRunPath: 'sandbox_open -> start_shelter_session',
    readinessBlockers: Object.freeze(['心理健康措辞需要 Vera 复核', '公开前需要 CEO Gate']),
    monetizationStatus: 'future_paid',
    marketingClaim: '',
    appReviewNote: 'Not included in first launch public claims.',
    privacyLabelImpact: 'mental_wellness_sensitive_internal',
  }),
  fitness: Object.freeze({
    launchCohort: 'sandbox',
    primaryUser: '希望记录训练动作的内部测试用户',
    openMoment: '用户想查看或记录训练计划草稿时',
    primaryUseCase: '本地训练记录与动作列表原型',
    primaryAction: '查看或记录 workout 草稿',
    publicPromise: Object.freeze(['内部 sandbox 的训练记录原型']),
    doNotPromise: Object.freeze(['AI 私教', '医疗训练建议', '康复处方', '保证健身效果']),
    riskTier: 'medium',
    dataObjects: Object.freeze(['Workout', 'Movement', 'Attempt']),
    firstRunPath: 'sandbox_open -> view_workout_draft',
    readinessBlockers: Object.freeze(['健康/训练建议边界需要 Vera 复核']),
    monetizationStatus: 'future_paid',
    marketingClaim: '',
    appReviewNote: 'Not included in first launch public claims.',
    privacyLabelImpact: 'fitness_context_internal',
  }),
  quiz: Object.freeze({
    launchCohort: 'sandbox',
    primaryUser: '需要题库练习原型的内部测试用户',
    openMoment: '用户想做题、复盘错题或测试学习效果时',
    primaryUseCase: '题目、尝试和复习卡片对象原型',
    primaryAction: '完成一个 Question Attempt 草稿',
    publicPromise: Object.freeze(['内部 sandbox 的题库练习原型']),
    doNotPromise: Object.freeze(['官方题库授权', '版权内容可商用', '考试通过承诺']),
    riskTier: 'medium',
    dataObjects: Object.freeze(['Question', 'Attempt', 'ReviewCard']),
    firstRunPath: 'sandbox_open -> answer_question_draft',
    readinessBlockers: Object.freeze(['题库版权和来源边界需要 Vera/CEO 复核']),
    monetizationStatus: 'future_paid',
    marketingClaim: '',
    appReviewNote: 'Not included in first launch public claims.',
    privacyLabelImpact: 'learning_content_internal',
  }),
  secretary: Object.freeze({
    launchCohort: 'gated',
    primaryUser: '需要 AI 辅助整理但尚未进入公开承诺的内部评审用户',
    openMoment: '用户想让宝盒整理上下文或建议下一步时',
    primaryUseCase: 'AI 意图声明与上下文草稿',
    primaryAction: '记录 action_attempt 意图，不自动执行',
    publicPromise: Object.freeze(['内部 gated AI 助手原型']),
    doNotPromise: Object.freeze(['AI 自动执行', '外部服务授权', '替用户发消息或下单', '真实生产代理']),
    riskTier: 'high_trust',
    dataObjects: Object.freeze(['ActionIntent', 'ContextSummary']),
    firstRunPath: 'gated_open -> declare_action_intent',
    readinessBlockers: Object.freeze(['AI runtime 和外部授权都需要 CEO Gate']),
    monetizationStatus: 'internal_only',
    marketingClaim: '',
    appReviewNote: 'Not included in first launch public claims.',
    privacyLabelImpact: 'ai_context_gated_only',
  }),
  psychoanalysis: Object.freeze({
    launchCohort: 'gated',
    primaryUser: '内部评审心理分析原型的测试用户',
    openMoment: '用户想记录自我理解线索时',
    primaryUseCase: '心理分析会话草稿和反思对象',
    primaryAction: '创建一段 review-only session',
    publicPromise: Object.freeze(['内部 gated 心理分析原型']),
    doNotPromise: Object.freeze(['诊断', '治疗', '心理咨询服务', '替代专业人士']),
    riskTier: 'high_trust',
    dataObjects: Object.freeze(['ReflectionSession', 'SensitiveNote']),
    firstRunPath: 'gated_open -> create_reflection_session_draft',
    readinessBlockers: Object.freeze(['心理健康和隐私措辞需要 Vera/CEO 复核']),
    monetizationStatus: 'internal_only',
    marketingClaim: '',
    appReviewNote: 'Not included in first launch public claims.',
    privacyLabelImpact: 'mental_health_sensitive_gated_only',
  }),
  health: Object.freeze({
    launchCohort: 'gated',
    primaryUser: '内部评审健康记录边界的测试用户',
    openMoment: '用户想查看健康线索原型时',
    primaryUseCase: '健康上下文的 report-only 原型',
    primaryAction: '查看健康数据边界声明',
    publicPromise: Object.freeze(['内部 gated 健康边界原型']),
    doNotPromise: Object.freeze(['医疗建议', '诊断', '治疗方案', '接入真实健康数据']),
    riskTier: 'high_trust',
    dataObjects: Object.freeze(['HealthContext', 'RiskSignal']),
    firstRunPath: 'gated_open -> review_health_boundary',
    readinessBlockers: Object.freeze(['真实健康数据、医疗措辞或外部接入需要 CEO/Vera Gate']),
    monetizationStatus: 'internal_only',
    marketingClaim: '',
    appReviewNote: 'Not included in first launch public claims.',
    privacyLabelImpact: 'health_sensitive_gated_only',
  }),
  finance: Object.freeze({
    launchCohort: 'internal_only',
    primaryUser: '内部评审财务边界的架构/合规测试人员',
    openMoment: '仅在评估财务工具边界和风险时打开',
    primaryUseCase: '财务模块静态收口和 gate 映射',
    primaryAction: '查看财务能力边界，不处理真实账户',
    publicPromise: Object.freeze(['内部 registry 财务边界草案']),
    doNotPromise: Object.freeze(['真实金融建议', '真实账户接入', '支付', '账单服务', '投资建议']),
    riskTier: 'high_trust',
    dataObjects: Object.freeze(['FinanceBoundary', 'FinancialActionIntent']),
    firstRunPath: 'internal_registry_only -> review_finance_boundary',
    readinessBlockers: Object.freeze(['真实金融数据、外部授权、支付和上架承诺全部需要 CEO Gate']),
    monetizationStatus: 'internal_only',
    marketingClaim: '',
    appReviewNote: 'Not included in first launch public claims.',
    privacyLabelImpact: 'finance_sensitive_internal_only',
  }),
  lifesim: Object.freeze({
    launchCohort: 'gated',
    primaryUser: '内部评审叙事/人生模拟原型的测试用户',
    openMoment: '用户想把选择和故事线索可视化时',
    primaryUseCase: '人生叙事和选择回放原型',
    primaryAction: '打开模拟草稿，不作真实预测',
    publicPromise: Object.freeze(['内部 gated 叙事模拟原型']),
    doNotPromise: Object.freeze(['预测人生', '预测命运', '心理疗愈承诺', '替用户做重大决定']),
    riskTier: 'high_trust',
    dataObjects: Object.freeze(['NarrativePath', 'ChoiceMoment']),
    firstRunPath: 'gated_open -> view_narrative_draft',
    readinessBlockers: Object.freeze(['高信任叙事措辞和 AI/心理边界需要 CEO/Vera Gate']),
    monetizationStatus: 'future_paid',
    marketingClaim: '',
    appReviewNote: 'Not included in first launch public claims.',
    privacyLabelImpact: 'high_trust_narrative_internal',
  }),
});

function toolId(tool) {
  return tool.moduleId || tool.id;
}

function displayName(tool) {
  return tool.name || tool.displayName?.zh || toolId(tool);
}

function copyForTool(tool) {
  return PRODUCT_COPY_BY_MODULE[toolId(tool)] || PRODUCT_COPY_BY_MODULE.inventory;
}

export function resolveLaunchCohort(tool) {
  const moduleId = toolId(tool);
  if (moduleId === 'inventory') return 'first_launch';
  if (['plan', 'reading', 'sanctuary', 'fitness', 'quiz'].includes(moduleId)) return 'sandbox';
  if (['secretary', 'psychoanalysis', 'health', 'lifesim'].includes(moduleId)) return 'gated';
  return 'internal_only';
}

export function resolveTrustBoundary(tool) {
  const moduleId = toolId(tool);
  const launchCohort = resolveLaunchCohort(tool);
  const mentalHealthModules = ['psychoanalysis', 'sanctuary', 'lifesim'];
  const healthModules = ['health', 'fitness'];
  const aiModules = ['secretary', 'lifesim'];
  const external = (tool.routeKind || tool.toolManifest?.routeKind) === 'external-link';
  const requiresCEOApproval = ['finance', 'health', 'psychoanalysis', 'secretary', 'lifesim'].includes(moduleId);

  return {
    moduleId,
    canStoreLocalData: moduleId === 'inventory' || launchCohort === 'sandbox',
    canUseCamera: moduleId === 'inventory',
    canUseAI: aiModules.includes(moduleId),
    canMentionHealth: healthModules.includes(moduleId),
    canMentionMentalHealth: mentalHealthModules.includes(moduleId),
    canAccessExternalService: external,
    requiresCEOApproval,
    requiresUserConsent: requiresCEOApproval || moduleId === 'inventory' || mentalHealthModules.includes(moduleId),
    appStoreClaimBoundary: moduleId === 'inventory'
      ? 'Only claim local Inventory / purchase-memory; no cloud, AI, payment, or external auth.'
      : 'Do not mention in first-launch App Store copy.',
  };
}

export function resolveShellDisplayState(productEntry) {
  const launchCohort = productEntry.launchCohort || resolveLaunchCohort(productEntry);
  const trustBoundary = productEntry.trustBoundary || resolveTrustBoundary(productEntry);
  const routeKind = productEntry.routeKind || productEntry.toolManifest?.routeKind;

  if (launchCohort === 'first_launch') {
    return {
      displayGroup: 'Practical Tools',
      stateKind: 'enterable',
      stateLabel: '可进入',
      userVisible: true,
      actionAllowed: true,
      appStoreVisible: true,
    };
  }
  if (trustBoundary.requiresCEOApproval || launchCohort === 'gated') {
    return {
      displayGroup: 'Gated Trust Modules',
      stateKind: 'needs_confirmation',
      stateLabel: '需要确认',
      userVisible: false,
      actionAllowed: false,
      appStoreVisible: false,
    };
  }
  if (routeKind === 'external-link') {
    return {
      displayGroup: 'Building / Report Only',
      stateKind: 'leaves_shell',
      stateLabel: '会离开宝盒',
      userVisible: false,
      actionAllowed: false,
      appStoreVisible: false,
    };
  }
  if (launchCohort === 'sandbox') {
    return {
      displayGroup: ['plan', 'reading', 'sanctuary'].includes(productEntry.moduleId) ? 'Today Core' : 'Building / Report Only',
      stateKind: 'building',
      stateLabel: '建设中',
      userVisible: false,
      actionAllowed: false,
      appStoreVisible: false,
    };
  }
  return {
    displayGroup: 'Building / Report Only',
    stateKind: 'local_only',
    stateLabel: '仅本地',
    userVisible: false,
    actionAllowed: false,
    appStoreVisible: false,
  };
}

export function resolveEntitlementApprovalState(productEntry) {
  const requiresApproval = productEntry.trustBoundary?.requiresCEOApproval === true
    || productEntry.launchCohort === 'gated'
    || productEntry.launchCohort === 'internal_only'
    || (productEntry.approvalRequiredActions || []).length > 0;

  return {
    approvalGatePriority: requiresApproval ? 'before_paywall' : 'after_visibility',
    approvalGateRequired: requiresApproval,
    paywallGateRequired: productEntry.monetizationStatus === 'future_paid',
    approvalGateIsPaywallGate: false,
    shellDecisionOrder: [
      'moduleExists',
      'launchCohort',
      'trustBoundary',
      'approvalGate',
      'entitlement',
      'visible/action',
    ],
  };
}

function appStoreFieldsForProduct(product, trustBoundary) {
  const publicVisible = product.launchCohort === 'first_launch';
  return {
    publicVisible,
    appStoreMentionAllowed: publicVisible && !trustBoundary.requiresCEOApproval,
    marketingClaim: publicVisible ? product.marketingClaim : '',
    appReviewNote: product.appReviewNote,
    privacyLabelImpact: product.privacyLabelImpact,
  };
}

function productEntryForTool(tool) {
  const moduleId = toolId(tool);
  const product = copyForTool(tool);
  const launchCohort = resolveLaunchCohort(tool);
  const trustBoundary = resolveTrustBoundary(tool);
  const baseEntry = {
    moduleId,
    label: displayName(tool),
    routeKind: tool.routeKind || tool.toolManifest?.routeKind || null,
    launchStatus: tool.launchStatus || tool.toolManifest?.launchStatus || null,
    toolLifecycle: tool.toolLifecycle || tool.toolManifest?.toolLifecycle || null,
    launchCohort,
    primaryUser: product.primaryUser,
    openMoment: product.openMoment,
    primaryUseCase: product.primaryUseCase,
    primaryAction: product.primaryAction,
    publicPromise: [...product.publicPromise],
    doNotPromise: [...product.doNotPromise],
    riskTier: product.riskTier,
    trustBoundary,
    dataObjects: [...product.dataObjects],
    firstRunPath: product.firstRunPath,
    readinessBlockers: [...product.readinessBlockers],
    monetizationStatus: product.monetizationStatus,
    appStore: appStoreFieldsForProduct({ ...product, launchCohort }, trustBoundary),
    approvalRequiredActions: [...(tool.approvalRequiredActions || [])],
  };

  const shellDisplay = resolveShellDisplayState(baseEntry);
  const entitlementApprovalState = resolveEntitlementApprovalState(baseEntry);

  return {
    ...baseEntry,
    shellDisplay,
    entitlementApprovalState,
  };
}

export function buildCoreObjectModelContractV0() {
  return {
    version: CORE_OBJECT_MODEL_CONTRACT_VERSION_V0,
    implementation: 'static-object-model-contract-only',
    groups: Object.fromEntries(Object.entries(OBJECT_GROUPS).map(([key, group]) => [key, {
      label: group.label,
      objects: [...group.objects],
      modules: [...group.modules],
    }])),
    boundaries: {
      contractOnly: true,
      cloudDatabaseEnabled: false,
      externalServiceEnabled: false,
      migratesRealData: false,
      readsRealUserData: false,
      writesRealUserData: false,
    },
  };
}

export function validateModuleProductContractV0(contract) {
  const requiredFields = [
    'moduleId',
    'launchCohort',
    'primaryUser',
    'openMoment',
    'primaryUseCase',
    'primaryAction',
    'publicPromise',
    'doNotPromise',
    'riskTier',
    'trustBoundary',
    'dataObjects',
    'firstRunPath',
    'readinessBlockers',
    'monetizationStatus',
    'appStore',
  ];
  const warnings = [];

  for (const entry of contract.modules || []) {
    for (const field of requiredFields) {
      const value = entry[field];
      if (Array.isArray(value) ? value.length === 0 : value === undefined || value === null || value === '') {
        warnings.push({
          moduleId: entry.moduleId || 'unknown',
          warningKind: 'module_product_missing_field',
          issue: 'Module Product Contract entry is missing a required field.',
          reason: `Missing ${field}`,
          owner: 'Qiao',
          evidenceFields: [`moduleProductContract.modules.${field}`],
        });
      }
    }

    if (entry.trustBoundary?.requiresCEOApproval && entry.appStore?.appStoreMentionAllowed) {
      warnings.push({
        moduleId: entry.moduleId,
        warningKind: 'high_trust_app_store_claim_enabled',
        issue: 'High-trust module cannot be App Store mentionable in first launch.',
        reason: 'CEO-gated modules must remain out of first-launch public copy.',
        owner: 'Qiao',
        evidenceFields: ['moduleProductContract.modules.trustBoundary.requiresCEOApproval', 'moduleProductContract.modules.appStore.appStoreMentionAllowed'],
      });
    }
  }

  return {
    ok: warnings.length === 0,
    warningCount: warnings.length,
    warnings,
  };
}

export function buildModuleProductContractV0(tools) {
  const modules = tools.map(productEntryForTool);
  const validation = validateModuleProductContractV0({ modules });
  const coreObjectModels = buildCoreObjectModelContractV0();
  const moduleTrustBoundaryModules = modules.map((entry) => ({
    moduleId: entry.moduleId,
    riskTier: entry.riskTier,
    ...entry.trustBoundary,
  }));
  const shellProductGroups = [
    'Today Core',
    'Practical Tools',
    'Gated Trust Modules',
    'Building / Report Only',
  ].map((group) => ({
    group,
    moduleIds: modules.filter((entry) => entry.shellDisplay.displayGroup === group).map((entry) => entry.moduleId),
  }));

  return {
    version: MODULE_PRODUCT_CONTRACT_VERSION_V0,
    implementation: 'static-product-contract-only',
    boundaries: {
      changesUI: false,
      readsRealData: false,
      writesRealData: false,
      cloudDatabaseEnabled: false,
      storeKitEnabled: false,
      aiRuntimeEnabled: false,
      externalServiceEnabled: false,
      appStoreSubmissionEnabled: false,
    },
    vocabularies: {
      launchCohort: [...LAUNCH_COHORT_VALUES_V0],
      riskTier: [...RISK_TIER_VALUES_V0],
      monetizationStatus: [...MONETIZATION_STATUS_VALUES_V0],
      productStateLabels: ['可进入', '建设中', '需要确认', '仅本地', '会离开宝盒', '高信任模块'],
    },
    shellProductGroups,
    moduleTrustBoundary: {
      version: 'module-trust-boundary-v0',
      modules: moduleTrustBoundaryModules,
      summary: {
        moduleCount: moduleTrustBoundaryModules.length,
        highTrustModuleCount: moduleTrustBoundaryModules.filter((entry) => entry.riskTier === 'high_trust').length,
        ceoApprovalRequiredCount: moduleTrustBoundaryModules.filter((entry) => entry.requiresCEOApproval).length,
        userConsentRequiredCount: moduleTrustBoundaryModules.filter((entry) => entry.requiresUserConsent).length,
      },
    },
    coreObjectModels,
    summary: {
      moduleCount: modules.length,
      firstLaunchModuleCount: modules.filter((entry) => entry.launchCohort === 'first_launch').length,
      sandboxModuleCount: modules.filter((entry) => entry.launchCohort === 'sandbox').length,
      gatedModuleCount: modules.filter((entry) => entry.launchCohort === 'gated').length,
      internalOnlyModuleCount: modules.filter((entry) => entry.launchCohort === 'internal_only').length,
      publicVisibleCount: modules.filter((entry) => entry.appStore.publicVisible).length,
      appStoreMentionAllowedCount: modules.filter((entry) => entry.appStore.appStoreMentionAllowed).length,
      warningCount: validation.warningCount,
    },
    modules,
    warnings: validation.warnings,
  };
}
