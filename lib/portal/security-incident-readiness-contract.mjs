const HIGH_RISK_MODULE_IDS = Object.freeze(['finance', 'health', 'psychoanalysis', 'secretary']);
const SEVERITY_VOCABULARY = Object.freeze(['sev0', 'sev1', 'sev2', 'sev3']);

function incidentOwnerForTool(tool) {
  return tool.gateOwner || tool.responsibleAgent || tool.owner || 'CEO';
}

function incidentEntryForTool(tool, featureControlEntry) {
  const highRisk = HIGH_RISK_MODULE_IDS.includes(tool.id);
  const killSwitchKey = featureControlEntry?.killSwitchKey || `kill.module.${tool.id}`;

  return {
    moduleId: tool.id,
    affectedModule: tool.id,
    label: tool.name,
    incidentOwner: incidentOwnerForTool(tool),
    defaultSeverity: highRisk ? 'sev1' : 'sev2',
    highRisk,
    disableTool: {
      killSwitchKey,
      planOnly: true,
      runtimeActionEnabled: false,
    },
    revokeTokenPlan: {
      requiredIfExternalAuthExists: true,
      planOnly: true,
      revokesRealTokens: false,
      requiresCeoGate: true,
    },
    dataExportResponse: {
      planOnly: true,
      exportsRealData: false,
      requiresCeoGateForRealExport: true,
    },
    dataDeleteResponse: {
      planOnly: true,
      deletesRealData: false,
      requiresCeoGateForRealDelete: true,
    },
    userNoticeTrigger: {
      triggerOnSeverity: ['sev0', 'sev1'],
      sendsNotification: false,
      requiresCeoVeraGate: true,
    },
    rollbackBuild: {
      planOnly: true,
      rollsBackProduction: false,
      requiresCeoGate: true,
    },
    ceoLegalGate: {
      required: highRisk || (tool.approvalRequiredActions || []).length > 0,
      owners: ['CEO', 'Vera'],
    },
    postIncidentArtifact: {
      required: true,
      artifactKind: 'post_incident_report',
      writesArtifactOnly: true,
    },
    realActionsEnabled: false,
  };
}

export function buildSecurityIncidentReadinessContract(tools, featureControlModules = []) {
  const featureControlByModule = new Map(featureControlModules.map((entry) => [entry.moduleId, entry]));
  const modules = tools.map((tool) => incidentEntryForTool(tool, featureControlByModule.get(tool.id)));
  const warnings = modules
    .filter((entry) => entry.realActionsEnabled)
    .map((entry) => ({
      moduleId: entry.moduleId,
      warningKind: 'incident_real_action_enabled',
      issue: 'Incident readiness contract must not execute real emergency actions.',
      reason: 'Real data delete, token revoke, user notice, refund, and rollback require CEO/Vera gates.',
      owner: 'Qiao',
      evidenceFields: ['securityIncidentReadiness.modules.realActionsEnabled'],
    }));

  return {
    version: 'security-incident-readiness-contract-v0',
    implementation: 'emergency-plan-contract-only',
    severityVocabulary: [...SEVERITY_VOCABULARY],
    incidentTypes: [
      'wrong_sync',
      'data_leak',
      'wrong_charge',
      'high_risk_feature_incident',
      'external_auth_leak',
    ],
    boundaries: {
      sendsNotifications: false,
      deletesRealData: false,
      revokesRealTokens: false,
      processesRefunds: false,
      rollsBackProduction: false,
      makesLegalStatement: false,
      userNoticeRequiresCeoVeraGate: true,
      realTokenRevokeRequiresCeoGate: true,
      realDataDeleteRequiresCeoGate: true,
      refundRequiresCeoGate: true,
    },
    summary: {
      moduleCount: modules.length,
      highRiskModuleCount: modules.filter((entry) => entry.highRisk).length,
      planOnlyModuleCount: modules.filter((entry) => !entry.realActionsEnabled).length,
      realActionEnabledCount: modules.filter((entry) => entry.realActionsEnabled).length,
      ceoLegalGateModuleCount: modules.filter((entry) => entry.ceoLegalGate.required).length,
      warningCount: warnings.length,
    },
    modules,
    warnings,
  };
}
