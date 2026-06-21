import { buildModuleRegistry as buildModuleRegistryCore } from './module-manager-core.mjs';
import { getModuleReturnHref } from './module-routes.mjs';
import { buildLocalDataRecordsDashboardPack, buildLocalDataRecordsV0, LOCAL_DATA_RECORD_BOUNDARIES_V0 } from './local-data-records.mjs';
import { buildModuleDataBus, MODULE_DATA_BUS_BOUNDARIES_V0 } from './module-data-bus.mjs';
import type { PortalConfig, PortalTool, PortalZone, ZoneId } from './types';
import type { ModuleRegistry, ModuleRegistryEntry } from './module-manager-core';

export type {
  ApprovalGateBoundaries,
  ApprovalGateCategory,
  ApprovalGateCategoryDefinition,
  ApprovalGateContract,
  ApprovalGateDecisionOption,
  ApprovalGateEscalationRule,
  ApprovalGateOwner,
  ApprovalGateReportingContract,
  ApprovalGateSeverity,
  ApprovalGateStatus,
  ArtifactStatusPrimaryActionKind,
  ArtifactStatusVisibilityBoundaries,
  ArtifactStatusVisibilityContract,
  ArtifactStatusVisibilityReportingContract,
  ArtifactStatusVisibilityState,
  ArtifactRootContract,
  ArtifactVisibilityBoundaries,
  ArtifactVisibilityContract,
  ArtifactVisibilityKind,
  ArtifactVisibilityReportingContract,
  ArtifactVisibilityStatus,
  BaoheMode,
  DataAggregationBoundaries,
  DataAggregationContract,
  DataAggregationDictionaries,
  DataAggregationRedLineKeys,
  ExperienceServicesContract,
  ExperienceServiceReservedKeys,
  GateStatus,
  InteractionLogContract,
  LaunchSource,
  ModeChangeStatus,
  MobileAppIntegrationBoundaries,
  MobileAppIntegrationContract,
  MobileAppIntegrationReportingContract,
  MobileAppIntegrationStrategy,
  MobileAppIntegrationTargetShell,
  ModuleCapabilities,
  ModuleMode,
  ModuleRegistry,
  ModuleRegistryEntry,
  NotificationApprovalGateContract,
  NotificationIntentKind,
  NotificationIntentStatus,
  PreferencesContract,
  SessionModeContract,
  ShellEmptyStateKey,
  ShellDiscoveryEntryAffordance,
  ShellDiscoveryEntryBoundaries,
  ShellDiscoveryEntryContract,
  ShellDiscoveryEntryReportingContract,
  ShellEntryStatus,
  ShellModeAvailability,
  ShellModeAvailabilityValue,
  ShellRouteBoundaries,
  ShellRouteContract,
  ShellRouteDictionaries,
  ShellRouteEntry,
  ShellRouteEvidenceKind,
  ShellRouteEvidenceLink,
  ShellRouteReportingContract,
  ToolDataNamespaceV0,
  ToolDeprecationPolicyRecordV0,
  ToolDeprecationPolicyV0,
  ToolEntitlementPolicyV0,
  ToolLaunchStatusV0,
  ToolLifecycleV0,
  ToolManifestRegistryV0,
  ToolManifestV0,
  ToolProdExposureV0,
} from './module-manager-core';
export type {
  BuildLocalDataRecordsOptions,
  ArtifactStatusSourceRecord,
  LocalDataArtifactRecord,
  LocalDataBoundary,
  LocalDataBoundaryWarning,
  LocalDataGateCategory,
  LocalDataGateRecord,
  LocalDataHandoffRecord,
  LocalDataDashboardPack,
  LocalDataRecordsSummary,
  LocalDataRecordsV0,
} from './local-data-records';
export type {
  ModuleDataBus,
  ModuleDataBusBoundaries as ModuleDataBusBoundaries,
  ModuleDataBusSummary as ModuleDataBusSummary,
  ModuleDataCatalogItem,
  ModuleDataBusEdge,
  ModuleBusModuleSummary,
  ModuleDataBusWarning,
  ModuleDataBusCrossBoundarySummary,
} from './module-data-bus';

export type PortalModule = PortalTool & ModuleRegistryEntry;

export interface PortalModuleZone extends PortalZone {
  id: ZoneId;
  modules: PortalModule[];
}

export interface PortalModuleRegistry {
  shellName: string;
  shellHref: string;
  moduleCount: number;
  readyModuleCount: number;
  localModuleCount: number;
  externalModuleCount: number;
  zones: PortalModuleZone[];
  modules: PortalModule[];
  core: ModuleRegistry;
}

export function buildModuleRegistry(config: PortalConfig): ModuleRegistry {
  return buildModuleRegistryCore(config, {
    basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  }) as ModuleRegistry;
}

export function buildPortalModule(tool: PortalTool): PortalModule {
  return buildPortalModuleRegistry({
    meta: { title: 'Nesio', subtitle: '', energyQuotes: [] },
    zones: {
      kinetic: { title: '', subtitle: '', tone: 'cool' },
      reflective: { title: '', subtitle: '', tone: 'warm' },
      manifest: { title: '', subtitle: '', tone: 'neutral' },
    },
    tools: [tool],
  }).modules[0];
}

export function buildPortalModuleRegistry(config: PortalConfig): PortalModuleRegistry {
  const core = buildModuleRegistry(config);
  const moduleById = new Map(core.modules.map((module) => [module.id, module]));
  const modules = config.tools.map((tool) => ({
    ...tool,
    ...moduleById.get(tool.id),
  })) as PortalModule[];

  const zones: PortalModuleZone[] = (Object.entries(config.zones) as [ZoneId, PortalZone][]).map(
    ([id, zone]) => ({
      ...zone,
      id,
      modules: modules.filter((module) => module.zone === id),
    }),
  );

  return {
    shellName: core.shell.name,
    shellHref: core.shell.returnHref,
    moduleCount: modules.length,
    readyModuleCount: modules.filter((module) => module.ready).length,
    localModuleCount: modules.filter((module) => module.origin === 'local').length,
    externalModuleCount: modules.filter((module) => module.origin === 'external').length,
    zones,
    modules,
    core,
  };
}

export {
  buildLocalDataRecordsDashboardPack,
  buildLocalDataRecordsV0,
  LOCAL_DATA_RECORD_BOUNDARIES_V0,
  MODULE_DATA_BUS_BOUNDARIES_V0,
  buildModuleDataBus,
  getModuleReturnHref,
};
