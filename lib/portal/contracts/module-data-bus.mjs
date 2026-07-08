const MODULE_DATA_BUS_BOUNDARIES_V0 = Object.freeze({
  implementation: 'module-data-bus-v0',
  readsRegistryMetadataOnly: true,
  readsArtifactFilesOnly: false,
  writesRealData: false,
  writesGateRecords: false,
  writesNotion: false,
  sendsNotifications: false,
  authorizesExternalServices: false,
  executesActions: false,
  productionDeploy: false,
});

function toLowerTrim(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : fallback;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function normalizeKeyList(values) {
  return uniqueSorted((Array.isArray(values) ? values : [])
    .map((value) => toLowerTrim(value))
    .filter((value) => value.length > 0));
}

function classifyDataKey(key) {
  if (key.startsWith('external_')) return 'external_domain';
  if (['launch_context', 'profile', 'preferences', 'session_mode', 'interaction_log', 'approval_gate', 'notification_gate'].includes(key)) {
    return 'shared_context';
  }
  return 'owned_or_local_contract';
}

function normalizeDataKeyOwnership(dataKeyOwnership) {
  if (!dataKeyOwnership || typeof dataKeyOwnership !== 'object') return new Map();
  if (Array.isArray(dataKeyOwnership)) {
    const list = new Map();
    for (const item of dataKeyOwnership) {
      if (!item || typeof item !== 'object') continue;
      const dataKey = toLowerTrim(item.dataKey);
      if (!dataKey) continue;
      list.set(dataKey, {
        ownerModuleId: typeof item.ownerModuleId === 'string' ? item.ownerModuleId : null,
        sharingKind: item.sharingKind === 'shared' || item.sharingKind === 'module_private' || item.sharingKind === 'external_domain'
          ? item.sharingKind
          : 'inferred',
        scope: ['external_domain', 'shared_context', 'owned_or_local_contract'].includes(item.scope)
          ? item.scope
          : classifyDataKey(dataKey),
        expectedProducers: normalizeKeyList(item.expectedProducers),
        expectedConsumers: normalizeKeyList(item.expectedConsumers),
        source: 'explicit',
      });
    }
    return list;
  }

  const list = new Map();
  for (const [dataKey, item] of Object.entries(dataKeyOwnership)) {
    if (!item || typeof item !== 'object') continue;
    const normalizedKey = toLowerTrim(dataKey);
    if (!normalizedKey) continue;
    list.set(normalizedKey, {
      ownerModuleId: typeof item.ownerModuleId === 'string' ? item.ownerModuleId : null,
      sharingKind: item.sharingKind === 'shared' || item.sharingKind === 'module_private' || item.sharingKind === 'external_domain'
        ? item.sharingKind
        : 'inferred',
      scope: ['external_domain', 'shared_context', 'owned_or_local_contract'].includes(item.scope)
        ? item.scope
        : classifyDataKey(normalizedKey),
      expectedProducers: normalizeKeyList(item.expectedProducers),
      expectedConsumers: normalizeKeyList(item.expectedConsumers),
      source: 'explicit',
    });
  }
  return list;
}

function safeModules(modules) {
  return Array.isArray(modules) ? modules : [];
}

function buildDataCatalog(modules, reservedConsumedKeys, options) {
  const ownership = normalizeDataKeyOwnership(options?.dataKeyOwnership || options?.dataKeyManifest || options?.moduleDataKeyOwnership || {});
  const allDataKeys = new Set();
  const keyToProducers = new Map();
  const keyToConsumers = new Map();

  for (const moduleEntry of modules) {
    const moduleId = toLowerTrim(moduleEntry.id, `module-${modules.indexOf(moduleEntry)}`);
    const ownedData = normalizeKeyList(moduleEntry.ownedData);
    const consumedData = normalizeKeyList(moduleEntry.consumedData);

    for (const key of ownedData) {
      allDataKeys.add(key);
      const producers = keyToProducers.get(key) || new Set();
      producers.add(moduleId);
      keyToProducers.set(key, producers);
    }

    for (const key of consumedData) {
      allDataKeys.add(key);
      const consumers = keyToConsumers.get(key) || new Set();
      consumers.add(moduleId);
      keyToConsumers.set(key, consumers);
    }
  }

  return [...allDataKeys].sort().map((dataKey) => {
    const producers = uniqueSorted(Array.from(keyToProducers.get(dataKey) || []));
    const consumers = uniqueSorted(Array.from(keyToConsumers.get(dataKey) || []));
    const isReserved = reservedConsumedKeys.has(dataKey);
    const declaredOwnership = ownership.get(dataKey) || {
      ownerModuleId: null,
      sharingKind: 'inferred',
      scope: classifyDataKey(dataKey),
      expectedProducers: [],
      expectedConsumers: [],
      source: 'inferred',
    };
    const scope = declaredOwnership.scope;
    const edgeCount = producers.reduce((count, producer) => (
      count + consumers.filter((consumer) => consumer !== producer).length
    ), 0);
    const health = edgeCount === 0
      ? (isReserved
        ? 'dependency_only'
        : declaredOwnership.sharingKind === 'module_private' && producers.length > 0 ? 'orphaned_producer'
          : producers.length > 0 ? 'orphaned_producer'
          : 'missing_producer')
      : 'connected';

    return {
      dataKey,
      scope,
      producers,
      consumers,
      producerCount: producers.length,
      consumerCount: consumers.length,
      edgeCount,
      health,
      reserved: isReserved,
      ownership: {
        ownerModuleId: declaredOwnership.ownerModuleId,
        sharingKind: declaredOwnership.sharingKind,
        expectedProducers: declaredOwnership.expectedProducers,
        expectedConsumers: declaredOwnership.expectedConsumers,
        policySource: declaredOwnership.source,
      },
    };
  });
}

function buildDataEdges(modules, dataCatalog, options) {
  const edges = [];
  const seenEdgeKeys = new Set();
  const dataToModules = new Map();

  for (const item of dataCatalog) {
    dataToModules.set(item.dataKey, {
      producers: new Set(item.producers),
      consumers: new Set(item.consumers),
    });
  }

  for (const moduleEntry of modules) {
    const moduleId = toLowerTrim(moduleEntry.id, `module-${modules.indexOf(moduleEntry)}`);
    const ownedData = normalizeKeyList(moduleEntry.ownedData);
    for (const dataKey of ownedData) {
      const consumers = dataToModules.get(dataKey)?.consumers || new Set();
      for (const consumer of consumers) {
        if (consumer === moduleId) continue;
        const edgeKey = `${moduleId}->${consumer}:${dataKey}`;
        if (seenEdgeKeys.has(edgeKey)) continue;
        seenEdgeKeys.add(edgeKey);
        edges.push({
          fromModuleId: moduleId,
          toModuleId: consumer,
          dataKey,
          relation: 'producer_to_consumer',
          risk: moduleEntry.mode === 'external' && consumer !== moduleId ? 'cross_boundary' : 'local_contract',
        });
      }
    }
  }
  return edges;
}

function buildModuleSummaries(modules, catalogByDataKey) {
  return modules.map((moduleEntry) => {
    const moduleId = toLowerTrim(moduleEntry.id, `module-${modules.indexOf(moduleEntry)}`);
    const ownedData = normalizeKeyList(moduleEntry.ownedData);
    const consumedData = normalizeKeyList(moduleEntry.consumedData);
    const consumedWithoutProducer = consumedData.filter((dataKey) => (
      (catalogByDataKey.get(dataKey)?.producers || []).filter((producer) => producer !== moduleId).length === 0 &&
      !catalogByDataKey.get(dataKey)?.reserved
    ));
    const unconsumedOwnedData = ownedData.filter((dataKey) => (
      (catalogByDataKey.get(dataKey)?.consumers || []).length === 0
    ));
    const dependencyCount = consumedWithoutProducer.length;
    const unconsumedOwnedCount = unconsumedOwnedData.length;

    return {
      moduleId,
      mode: moduleEntry.mode || 'local',
      ownedData,
      consumedData,
      emittedEvents: normalizeKeyList(moduleEntry.emittedEvents),
      allowedActions: normalizeKeyList(moduleEntry.allowedActions),
      approvalRequiredActions: normalizeKeyList(moduleEntry.approvalRequiredActions),
      dependencyCount,
      unconsumedOwnedCount,
      dependencyDataKeys: consumedWithoutProducer,
      unconsumedOwnedDataKeys: unconsumedOwnedData,
    };
  });
}

function buildWarnings(modules, moduleSummaries, dataCatalog) {
  const warnings = [];

  for (const entry of dataCatalog) {
    if (entry.reserved) continue;
    const localWarningEligible = !['module_private', 'external_domain'].includes(entry.ownership.sharingKind);
    if (entry.producerCount === 0 && localWarningEligible) {
      warnings.push({
        warningKind: 'missing_data_producer',
        dataKey: entry.dataKey,
        producers: entry.producers,
        consumers: entry.consumers,
        issue: `No local producer declared for non-reserved data key "${entry.dataKey}".`,
      });
    }
    if (entry.producerCount > 0 && entry.consumerCount === 0 && localWarningEligible) {
      warnings.push({
        warningKind: 'producer_without_consumer',
        dataKey: entry.dataKey,
        producers: entry.producers,
        issue: `Produced key "${entry.dataKey}" has no local consumer.`,
      });
    }
  }

  for (const moduleSummary of moduleSummaries) {
    if (moduleSummary.dependencyCount > 0) {
      warnings.push({
        warningKind: 'module_dependency_missing_local_producer',
        moduleId: moduleSummary.moduleId,
        dataKeys: moduleSummary.dependencyDataKeys,
        issue: `Module "${moduleSummary.moduleId}" consumes keys with no other local producer.`,
      });
    }
  }

  return warnings;
}

function buildInterconnectPlan(dataCatalog, moduleSummaries) {
  const missingLocalProducers = dataCatalog
    .filter((item) => (
      item.producerCount === 0 &&
      !item.reserved &&
      !['module_private', 'external_domain'].includes(item.ownership.sharingKind)
    ))
    .map((item) => ({
      dataKey: item.dataKey,
      consumers: item.consumers,
      issue: `No local producer for dataKey "${item.dataKey}".`,
      action: item.ownership.expectedProducers.length > 0
        ? `补齐 expected producer: ${item.ownership.expectedProducers.join(', ')}`
        : `为 ${item.dataKey} 添加 local producer 或声明固定外部提供方。`,
    }));

  const orphanedProducers = dataCatalog
    .filter((item) => (
      item.producerCount > 0 &&
      item.consumerCount === 0 &&
      !item.reserved &&
      !['module_private', 'external_domain'].includes(item.ownership.sharingKind)
    ))
    .map((item) => ({
      dataKey: item.dataKey,
      producers: item.producers,
      issue: `DataKey "${item.dataKey}" 目前无 local consumer。`,
      action: `确认是否需要 downstream 消费方；或把数据降级为单模块专有。`,
    }));

  const hotModules = moduleSummaries
    .filter((module) => module.dependencyCount > 0)
    .map((module) => ({
      moduleId: module.moduleId,
      moduleMode: module.mode,
      dependencyDataKeys: module.dependencyDataKeys,
      risk: module.mode === 'external' ? 'boundary' : 'local_contract',
      action: '补齐非保留数据来源（建议先用 local context provider）。',
    }));

  const highValueIntersections = dataCatalog
    .filter((item) => item.producerCount > 0 && item.consumerCount > 0)
    .map((item) => ({
      dataKey: item.dataKey,
      producerCount: item.producerCount,
      consumerCount: item.consumerCount,
      edgeCount: item.edgeCount,
      route: `${item.producers.join(',')} => ${item.consumers.join(',')}`,
    }));

  const totalGaps = missingLocalProducers.length + orphanedProducers.length;

  return {
    version: 'v1',
    criticalGapCount: totalGaps,
    connectionReadyKeyCount: highValueIntersections.length,
    missingLocalProducerCount: missingLocalProducers.length,
    orphanedProducerCount: orphanedProducers.length,
    hotModules,
    missingLocalProducers,
    orphanedProducers,
    connectedDataKeys: highValueIntersections,
    priority: totalGaps === 0 ? 'ready' : totalGaps <= 3 ? 'low' : totalGaps <= 8 ? 'medium' : 'high',
  };
}

function summarizeCrossBoundary(dataCatalog, edges) {
  const externalToLocal = edges
    .filter((edge) => edge.risk === 'cross_boundary')
    .map((edge) => `${edge.fromModuleId}->${edge.toModuleId}:${edge.dataKey}`);

  const localToExternal = [];
  // kept for future expansion where reverse risk model is needed.

  return {
    externalToLocalEdgeCount: externalToLocal.length,
    localToExternalEdgeCount: localToExternal.length,
    externalToLocalEdges: uniqueSorted(externalToLocal),
    localToExternalEdges: uniqueSorted(localToExternal),
  };
};

function buildModuleDataBus(modules, options = {}) {
  const safeOptions = typeof options === 'object' && options !== null ? options : {};
  const modulesInput = safeModules(modules);
  const experienceReservedData = normalizeKeyList(safeOptions.experienceReservedData || []);
  const reservedConsumedKeys = new Set(experienceReservedData);
  const catalogList = buildDataCatalog(modulesInput, reservedConsumedKeys, safeOptions);
  const catalogByDataKey = new Map(catalogList.map((item) => [item.dataKey, item]));
  const edges = buildDataEdges(modulesInput, catalogList, safeOptions);
  const moduleSummaries = buildModuleSummaries(modulesInput, catalogByDataKey);
  const warnings = buildWarnings(modulesInput, moduleSummaries, catalogList);
  const crossBoundarySummary = summarizeCrossBoundary(catalogList, edges);
  const interconnectPlan = buildInterconnectPlan(catalogList, moduleSummaries);

  return {
    implementation: MODULE_DATA_BUS_BOUNDARIES_V0.implementation,
    generatedAt: safeOptions.generatedAt || new Date().toISOString(),
    summary: {
      moduleCount: modulesInput.length,
      dataKeyCount: catalogList.length,
      edgeCount: edges.length,
      warningCount: warnings.length,
      connectedDataKeyCount: catalogList.filter((item) => item.edgeCount > 0).length,
      dependencyOnlyCount: catalogList.filter((item) => item.health === 'dependency_only').length,
      orphanedDataKeyCount: catalogList.filter((item) => item.health === 'orphaned_producer').length,
      moduleMissingDependencyCount: moduleSummaries.filter((module) => module.dependencyCount > 0).length,
    },
    boundaries: MODULE_DATA_BUS_BOUNDARIES_V0,
    modules: moduleSummaries,
    dataCatalog: catalogList,
    edges,
    interconnectPlan,
    crossBoundarySummary,
    warnings,
    evidence: {
      source: 'module-manager registry module capabilities',
      mode: safeOptions.mode || 'registry_contract_projection',
    },
  };
}

export {
  MODULE_DATA_BUS_BOUNDARIES_V0,
  buildModuleDataBus,
  normalizeKeyList,
};
