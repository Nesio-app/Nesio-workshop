import assert from 'node:assert/strict';

import { buildModuleDataBus } from '../lib/portal/module-data-bus.mjs';

const bus = buildModuleDataBus([
  {
    id: 'plan',
    mode: 'local',
    ownedData: ['tasks', 'focus_sessions'],
    consumedData: ['preferences', 'profile'],
    emittedEvents: ['task.created'],
    allowedActions: ['create_task'],
    approvalRequiredActions: [],
  },
  {
    id: 'inventory',
    mode: 'local',
    ownedData: ['items'],
    consumedData: ['tasks'],
    emittedEvents: ['item.updated'],
    allowedActions: ['create_item'],
    approvalRequiredActions: ['use_camera'],
  },
  {
    id: 'health',
    mode: 'external',
    ownedData: ['external_health_logs'],
    consumedData: ['launch_context'],
    emittedEvents: ['module.opened_external'],
    allowedActions: ['open_external_module'],
    approvalRequiredActions: ['leave_shell'],
  },
], {
  generatedAt: '2026-06-16T00:00:00.000Z',
  experienceReservedData: ['profile', 'preferences', 'launch_context'],
  mode: 'test',
});

assert.equal(bus.summary.moduleCount, 3);
assert.equal(bus.summary.dataKeyCount, 7);
assert.equal(bus.summary.warningCount >= 2, true);
assert.equal(bus.interconnectPlan.version, 'v1');
assert.equal(bus.interconnectPlan.criticalGapCount >= 2, true);
assert.equal(bus.interconnectPlan.missingLocalProducerCount >= 0, true);
assert.equal(Array.isArray(bus.interconnectPlan.missingLocalProducers), true);
assert.equal(Array.isArray(bus.interconnectPlan.orphanedProducers), true);
assert.equal(Array.isArray(bus.interconnectPlan.connectedDataKeys), true);
assert.equal(Array.isArray(bus.interconnectPlan.hotModules), true);

const dataByKey = new Map(bus.dataCatalog.map((item) => [item.dataKey, item]));
assert.equal(Boolean(dataByKey.get('tasks')), true);
assert.equal(dataByKey.get('tasks').producers.includes('plan'), true);
assert.equal(dataByKey.get('tasks').consumers.includes('inventory'), true);

const edgeKeys = new Set(bus.edges.map((edge) => `${edge.fromModuleId}->${edge.toModuleId}:${edge.dataKey}`));
assert.equal(edgeKeys.has('plan->inventory:tasks'), true);

const planSummary = bus.modules.find((module) => module.moduleId === 'plan');
assert.equal(planSummary.dependencyCount, 0);

const inventorySummary = bus.modules.find((module) => module.moduleId === 'inventory');
assert.equal(inventorySummary.dependencyCount, 0);
assert.equal(inventorySummary.unconsumedOwnedCount === 1, true);
assert.equal(inventorySummary.unconsumedOwnedDataKeys.includes('items'), true);

const missingProducerWarnings = bus.warnings.filter((warning) => warning.warningKind === 'missing_data_producer');
assert.equal(missingProducerWarnings.some((warning) => warning.dataKey === 'focus_sessions'), false);

const policyBus = buildModuleDataBus([
  {
    id: 'secretary',
    mode: 'local',
    ownedData: ['profile'],
    consumedData: ['approval_gate'],
    emittedEvents: ['chat.message_sent'],
    allowedActions: ['open_chat'],
    approvalRequiredActions: [],
  },
  {
    id: 'plan',
    mode: 'local',
    ownedData: ['tasks'],
    consumedData: ['profile'],
    emittedEvents: ['task.created'],
    allowedActions: ['create_task'],
    approvalRequiredActions: [],
  },
  {
    id: 'inventory',
    mode: 'local',
    ownedData: ['items'],
    consumedData: ['profile'],
    emittedEvents: ['item.created'],
    allowedActions: ['create_item'],
    approvalRequiredActions: [],
  },
], {
  generatedAt: '2026-06-16T00:00:00.000Z',
  experienceReservedData: ['preferences'],
  dataKeyOwnership: {
    profile: {
      ownerModuleId: 'secretary',
      sharingKind: 'shared',
      scope: 'shared_context',
      expectedProducers: ['secretary'],
      expectedConsumers: ['plan', 'inventory'],
    },
    tasks: {
      ownerModuleId: 'plan',
      sharingKind: 'module_private',
      scope: 'owned_or_local_contract',
      expectedProducers: ['plan'],
      expectedConsumers: [],
    },
    items: {
      ownerModuleId: 'inventory',
      sharingKind: 'module_private',
      scope: 'owned_or_local_contract',
      expectedProducers: ['inventory'],
      expectedConsumers: [],
    },
  },
});

const policyProfileItem = policyBus.dataCatalog.find((item) => item.dataKey === 'profile');
assert.equal(policyProfileItem?.ownership.ownerModuleId, 'secretary');
assert.equal(policyProfileItem?.ownership.sharingKind, 'shared');
assert.equal(policyProfileItem?.ownership.expectedProducers.includes('secretary'), true);
const orphanWarning = policyBus.warnings.find((warning) => warning.warningKind === 'producer_without_consumer' && warning.dataKey === 'tasks');
assert.equal(Boolean(orphanWarning), false);

assert.equal(bus.crossBoundarySummary.externalToLocalEdgeCount, 0);

console.log('module-data-bus tests passed');
