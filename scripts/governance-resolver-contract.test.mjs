import assert from "node:assert/strict";

import {
  GOVERNANCE_RESOLVER_ORDER_V1,
  resolveGovernedCapabilityRequest,
} from "../lib/platform/governance-resolver.mjs";

const expectedOrder = ["safety_gate", "entitlement_gate", "quota_gate", "cost_gate", "audit_log"];
assert.deepEqual(GOVERNANCE_RESOLVER_ORDER_V1, expectedOrder, "resolver order is a product safety contract");

const safetyBlocked = resolveGovernedCapabilityRequest({
  moduleId: "finance",
  capability: "sync",
  requiresCeoGate: true,
  ceoApproved: false,
  entitlement: { required: true, granted: false },
});
assert.equal(safetyBlocked.allowed, false);
assert.equal(safetyBlocked.blockedAt, "safety_gate");
assert.equal(safetyBlocked.blockedReason, "ceo_gate_required");
assert.equal(
  safetyBlocked.executesAction,
  false,
  "contract resolver should not execute runtime actions",
);

const entitlementBlocked = resolveGovernedCapabilityRequest({
  moduleId: "reading",
  capability: "insight",
  requiresCeoGate: false,
  entitlement: { required: true, granted: false },
});
assert.equal(entitlementBlocked.allowed, false);
assert.equal(entitlementBlocked.blockedAt, "entitlement_gate");
assert.equal(entitlementBlocked.blockedReason, "entitlement_required");

const quotaBlocked = resolveGovernedCapabilityRequest({
  moduleId: "inventory",
  capability: "capture",
  entitlement: { required: false, granted: true },
  quota: { remaining: 0 },
});
assert.equal(quotaBlocked.allowed, false);
assert.equal(quotaBlocked.blockedAt, "quota_gate");
assert.equal(quotaBlocked.blockedReason, "quota_exhausted");

const costBlocked = resolveGovernedCapabilityRequest({
  moduleId: "secretary",
  capability: "ai_assistant",
  entitlement: { required: false, granted: true },
  quota: { remaining: 10 },
  cost: { estimatedUsd: 0.5, limitUsd: 0.1 },
});
assert.equal(costBlocked.allowed, false);
assert.equal(costBlocked.blockedAt, "cost_gate");
assert.equal(costBlocked.blockedReason, "cost_limit_exceeded");

const allowed = resolveGovernedCapabilityRequest({
  moduleId: "inventory",
  capability: "capture",
  requiresCeoGate: false,
  entitlement: { required: false, granted: true },
  quota: { remaining: 3 },
  cost: { estimatedUsd: 0, limitUsd: 0.1 },
});
assert.equal(allowed.allowed, true);
assert.equal(allowed.blockedAt, null);
assert.equal(allowed.blockedReason, null);
assert.equal(allowed.auditRequired, true);
assert.equal(allowed.executesAction, false);
assert.deepEqual(
  allowed.stages.map((stage) => stage.name),
  expectedOrder,
  "every decision should be auditable in the same order",
);

console.log("governance resolver contract passed");
