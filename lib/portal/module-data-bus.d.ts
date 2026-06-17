export interface ModuleDataBusBoundaries {
  implementation: 'module-data-bus-v0';
  readsRegistryMetadataOnly: true;
  readsArtifactFilesOnly: false;
  writesRealData: false;
  writesGateRecords: false;
  writesNotion: false;
  sendsNotifications: false;
  authorizesExternalServices: false;
  executesActions: false;
  productionDeploy: false;
}

export interface ModuleDataCatalogItem {
  dataKey: string;
  scope: 'external_domain' | 'shared_context' | 'owned_or_local_contract';
  producers: string[];
  consumers: string[];
  producerCount: number;
  consumerCount: number;
  edgeCount: number;
  health: 'connected' | 'dependency_only' | 'orphaned_producer' | 'missing_producer';
  reserved: boolean;
  ownership: {
    ownerModuleId: string | null;
    sharingKind: 'shared' | 'module_private' | 'external_domain' | 'inferred';
    expectedProducers: string[];
    expectedConsumers: string[];
    policySource: 'explicit' | 'inferred';
  };
}

export interface ModuleDataBusEdge {
  fromModuleId: string;
  toModuleId: string;
  dataKey: string;
  relation: 'producer_to_consumer';
  risk: 'cross_boundary' | 'local_contract';
}

export interface ModuleBusModuleSummary {
  moduleId: string;
  mode: string;
  ownedData: string[];
  consumedData: string[];
  emittedEvents: string[];
  allowedActions: string[];
  approvalRequiredActions: string[];
  dependencyCount: number;
  unconsumedOwnedCount: number;
  dependencyDataKeys: string[];
  unconsumedOwnedDataKeys: string[];
}

export interface ModuleDataBusWarning {
  warningKind: string;
  dataKey?: string;
  moduleId?: string;
  producers?: string[];
  consumers?: string[];
  dataKeys?: string[];
  issue: string;
}

export interface ModuleDataBusCrossBoundarySummary {
  externalToLocalEdgeCount: number;
  localToExternalEdgeCount: number;
  externalToLocalEdges: string[];
  localToExternalEdges: string[];
}

export interface ModuleDataBusSummary {
  moduleCount: number;
  dataKeyCount: number;
  edgeCount: number;
  warningCount: number;
  connectedDataKeyCount: number;
  dependencyOnlyCount: number;
  orphanedDataKeyCount: number;
  moduleMissingDependencyCount: number;
}

export interface ModuleDataInterconnectHotModule {
  moduleId: string;
  moduleMode: string;
  dependencyDataKeys: string[];
  risk: 'boundary' | 'local_contract';
  action: string;
}

export interface ModuleDataInterconnectItem {
  dataKey: string;
  consumers?: string[];
  producers?: string[];
  issue: string;
  action: string;
}

export interface ModuleDataConnectedItem {
  dataKey: string;
  producerCount: number;
  consumerCount: number;
  edgeCount: number;
  route: string;
}

export interface ModuleDataBusInterconnectPlan {
  version: 'v1';
  criticalGapCount: number;
  connectionReadyKeyCount: number;
  missingLocalProducerCount: number;
  orphanedProducerCount: number;
  hotModules: ModuleDataInterconnectHotModule[];
  missingLocalProducers: ModuleDataInterconnectItem[];
  orphanedProducers: ModuleDataInterconnectItem[];
  connectedDataKeys: ModuleDataConnectedItem[];
  priority: 'ready' | 'low' | 'medium' | 'high';
}

export interface ModuleDataBus {
  implementation: 'module-data-bus-v0';
  generatedAt: string;
  summary: ModuleDataBusSummary;
  boundaries: ModuleDataBusBoundaries;
  modules: ModuleBusModuleSummary[];
  dataCatalog: ModuleDataCatalogItem[];
  edges: ModuleDataBusEdge[];
  interconnectPlan: ModuleDataBusInterconnectPlan;
  crossBoundarySummary: ModuleDataBusCrossBoundarySummary;
  warnings: ModuleDataBusWarning[];
  evidence: {
    source: string;
    mode: string;
  };
}

export declare const MODULE_DATA_BUS_BOUNDARIES_V0: ModuleDataBusBoundaries;
export declare const normalizeKeyList: (values: unknown) => string[];
export interface BuildModuleDataBusOptions {
  generatedAt?: string;
  mode?: string;
  experienceReservedData?: string[];
  dataKeyOwnership?:
    | Record<string, {
      ownerModuleId: string | null;
      sharingKind: 'shared' | 'module_private' | 'external_domain' | 'inferred';
      scope: 'external_domain' | 'shared_context' | 'owned_or_local_contract';
      expectedProducers?: readonly string[];
      expectedConsumers?: readonly string[];
    }>
    | Array<{
      dataKey: string;
      ownerModuleId: string | null;
      sharingKind: 'shared' | 'module_private' | 'external_domain' | 'inferred';
      scope: 'external_domain' | 'shared_context' | 'owned_or_local_contract';
      expectedProducers?: readonly string[];
      expectedConsumers?: readonly string[];
    }>;
}
export declare function buildModuleDataBus(
  modules: Record<string, any>[],
  options?: BuildModuleDataBusOptions,
): ModuleDataBus;
