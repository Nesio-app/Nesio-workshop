import { GOVERNANCE_RESOLVER_ORDER_V1 } from '../portal/domain-capability-taxonomy-v1.mjs';

export { GOVERNANCE_RESOLVER_ORDER_V1 };

export const GOVERNANCE_RESOLVER_VERSION_V1 = 'governance-resolver-v1';

function passed(stage, reason = 'passed') {
  return { name: stage, stage, status: 'pass', reason };
}

function blocked(stage, reason, stages) {
  return {
    version: GOVERNANCE_RESOLVER_VERSION_V1,
    order: [...GOVERNANCE_RESOLVER_ORDER_V1],
    allowed: false,
    blockedAt: stage,
    blockedReason: reason,
    stages: [...stages, { name: stage, stage, status: 'blocked', reason }],
    auditRequired: true,
    executesAction: false,
  };
}

export function resolveGovernedCapabilityRequest(request = {}) {
  const stages = [];

  if (request.safety?.blocked === true) {
    return blocked('safety_gate', request.safety.reason || 'safety_blocked', stages);
  }

  if (request.requiresCeoGate === true && request.ceoApproved !== true) {
    return blocked('safety_gate', 'ceo_gate_required', stages);
  }
  stages.push(passed('safety_gate'));

  if (request.entitlement?.required === true && request.entitlement.granted !== true) {
    return blocked('entitlement_gate', request.entitlement.reason || 'entitlement_required', stages);
  }
  stages.push(passed('entitlement_gate'));

  if (request.quota && Number.isFinite(request.quota.remaining) && request.quota.remaining <= 0) {
    return blocked('quota_gate', request.quota.reason || 'quota_exhausted', stages);
  }
  stages.push(passed('quota_gate'));

  if (request.cost?.approved === false) {
    return blocked('cost_gate', request.cost.reason || 'cost_not_approved', stages);
  }

  if (
    request.cost &&
    Number.isFinite(request.cost.estimatedUsd) &&
    Number.isFinite(request.cost.limitUsd) &&
    request.cost.estimatedUsd > request.cost.limitUsd
  ) {
    return blocked('cost_gate', 'cost_limit_exceeded', stages);
  }
  stages.push(passed('cost_gate'));
  stages.push(passed('audit_log', 'audit_required'));

  return {
    version: GOVERNANCE_RESOLVER_VERSION_V1,
    order: [...GOVERNANCE_RESOLVER_ORDER_V1],
    allowed: true,
    blockedAt: null,
    blockedReason: null,
    stages,
    auditRequired: true,
    executesAction: false,
  };
}
