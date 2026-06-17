import type { ZoneId } from './types';
import type { ModuleOrigin, ModuleRouteKind } from './module-routes';

export type ModuleMode = 'local' | 'external' | 'embedded';

export interface ModuleCapabilities {
  mode: ModuleMode;
  ownedData: string[];
  consumedData: string[];
  emittedEvents: string[];
  allowedActions: string[];
  approvalRequiredActions: string[];
}

export interface ModuleDataKeyOwnership {
  ownerModuleId: string | null;
  sharingKind: 'shared' | 'module_private' | 'external_domain' | 'inferred';
  scope: 'external_domain' | 'shared_context' | 'owned_or_local_contract';
  expectedProducers: readonly string[];
  expectedConsumers: readonly string[];
  rationale?: string;
}

export interface ModuleDataKeyOwnershipManifest {
  version: 'v1';
  implementation: 'contract-only';
  boundaries: {
    readsRegistryMetadataOnly: true;
    readsArtifactFilesOnly: false;
    writesRealData: false;
    writesNotion: false;
    sendsNotifications: false;
    authorizesExternalServices: false;
    executesActions: false;
    productionDeploy: false;
  };
  keys: Record<string, ModuleDataKeyOwnership>;
}

export interface ModuleRegistryEntry {
  id: string;
  name: string;
  nameEn?: string;
  description: string;
  url: string;
  zone: ZoneId;
  hotkey: string;
  command: string;
  featured?: boolean;
  icon: string;
  iconUrl?: string;
  ready: boolean;
  status?: 'ready' | 'gated' | 'report-only' | 'not_ready';
  integrationMode?: 'local' | 'external' | 'static-report-only' | 'contract-only';
  owner?: string;
  maintainer?: string;
  responsibleAgent?: string;
  evidenceOwner?: string;
  gateOwner?: string;
  origin: ModuleOrigin;
  routeKind: ModuleRouteKind;
  configuredUrl: string;
  normalizedPath: string;
  openHref: string;
  returnHref: string;
  publicIndexPath: string | null;
  capabilities: ModuleCapabilities;
  ownedData: string[];
  consumedData: string[];
  emittedEvents: string[];
  allowedActions: string[];
  approvalRequiredActions: string[];
}

export type BaoheMode = 'personal' | 'demo' | 'market';
export type LaunchSource = 'shell' | 'hotkey' | 'return' | 'external_link' | 'unknown';
export type ModeChangeStatus = 'requested' | 'approved' | 'denied' | 'not_required';
export type GateStatus = 'not_required' | 'requested' | 'approved' | 'denied' | 'waiting_ceo' | 'blocked';
export type NotificationIntentKind = 'reminder' | 'status_feedback' | 'approval_needed';
export type NotificationIntentStatus = 'draft' | 'requested' | 'approved' | 'denied' | 'blocked';
export type ApprovalGateCategory =
  | 'production_deploy'
  | 'real_data_read'
  | 'real_data_write'
  | 'real_data_migration'
  | 'external_authorization'
  | 'notification_send'
  | 'purchase_payment'
  | 'legal_commercial_commitment'
  | 'p0_p1_privacy_trust_risk'
  | 'strategy_change';
export type ApprovalGateStatus =
  | 'not_required'
  | 'declared'
  | 'needs_decision'
  | 'waiting_approval'
  | 'approved'
  | 'denied'
  | 'deferred'
  | 'blocked';
export type ApprovalGateSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ApprovalGateOwner = 'CEO' | 'user' | 'Sina' | 'Qiao' | 'Ming';
export type ApprovalGateDecisionOption =
  | 'approve'
  | 'deny'
  | 'defer'
  | 'request_more_evidence'
  | 'split_safe_slice'
  | 'cancel';
export type ShellModeAvailabilityValue = 'available' | 'hidden' | 'not_ready' | 'gated';
export type ShellEntryStatus =
  | 'ready'
  | 'not_ready'
  | 'external'
  | 'unconnected'
  | 'contract_only'
  | 'gated';
export type ShellEmptyStateKey =
  | 'module_not_connected'
  | 'module_not_ready'
  | 'mode_not_available'
  | 'external_module'
  | 'approval_required'
  | 'evidence_missing';
export type ShellRouteEvidenceKind =
  | 'module_manager'
  | 'experience_services'
  | 'data_aggregation'
  | 'approval_gate'
  | 'qa'
  | 'spec';
export type ArtifactVisibilityKind =
  | 'engineering'
  | 'qa'
  | 'archive'
  | 'spec'
  | 'plan'
  | 'audit'
  | 'inventory'
  | 'report'
  | 'unknown';
export type ArtifactVisibilityStatus =
  | 'present'
  | 'missing'
  | 'ready'
  | 'qa_present'
  | 'archived'
  | 'blocked'
  | 'unknown';

export interface ExperienceServiceReservedKeys {
  consumedData: readonly string[];
  events: readonly string[];
  approvalRequiredActions: readonly string[];
}

export interface SessionModeContract {
  contractName: 'SessionModeContract';
  currentModeValues: readonly string[];
  launchSources: readonly string[];
  modeChangeStatuses: readonly string[];
  consumedDataKeys: readonly string[];
  eventKeys: readonly string[];
  writesRealData: false;
  runtimeEnforcement: false;
}

export interface PreferencesContract {
  contractName: 'PreferencesContract';
  localeValues: readonly string[];
  themeValues: readonly string[];
  avatarStyleValues: readonly string[];
  defaultEntrySurfaces: readonly string[];
  consumedDataKeys: readonly string[];
  eventKeys: readonly string[];
  writesRealData: false;
  storesIdentity: false;
}

export interface InteractionLogContract {
  contractName: 'InteractionLogContract';
  eventTypes: readonly string[];
  redactedPayloadRule: string;
  persistsEvents: false;
  writesRealData: false;
  messageBus: false;
}

export interface NotificationApprovalGateContract {
  contractName: 'NotificationApprovalGateContract';
  gateStatuses: readonly string[];
  notificationIntentKinds: readonly string[];
  notificationStatuses: readonly string[];
  consumedDataKeys: readonly string[];
  approvalRequiredActionKeys: readonly string[];
  writesRealData: false;
  sendsNotifications: false;
  authorizesExternalServices: false;
  executesActions: false;
}

export interface ExperienceServicesContract {
  version: 'v0';
  implementation: 'contract-only';
  boundaries: {
    writesRealData: false;
    persistsEvents: false;
    sendsNotifications: false;
    authorizesExternalServices: false;
    runtimeEnforcement: false;
    executesActions: false;
  };
  reservedKeys: ExperienceServiceReservedKeys;
  sessionMode: SessionModeContract;
  preferences: PreferencesContract;
  interactionLog: InteractionLogContract;
  notificationApprovalGate: NotificationApprovalGateContract;
}

export interface DataAggregationBoundaries {
  readOnlyMetadata: true;
  readsRealData: false;
  writesRealData: false;
  migratesData: false;
  syncsExternalServices: false;
  authorizesExternalServices: false;
  runtimeEnforcement: false;
  persistsEvents: false;
  executesActions: false;
  productionDeploy: false;
}

export interface DataAggregationDictionaries {
  moduleSummary: readonly string[];
  capabilitySummary: readonly string[];
  riskSummary: readonly string[];
  approvalSummary: readonly string[];
  evidenceSummary: readonly string[];
}

export interface DataAggregationRedLineKeys {
  pii: readonly string[];
  health: readonly string[];
  finance: readonly string[];
  compliance: readonly string[];
  oauth: readonly string[];
  notification: readonly string[];
  execution: readonly string[];
}

export interface DataAggregationContract {
  version: 'v0';
  implementation: 'contract-only';
  boundaries: DataAggregationBoundaries;
  dictionaries: DataAggregationDictionaries;
  redLineKeys: DataAggregationRedLineKeys;
}

export interface ApprovalGateBoundaries {
  staticVocabularyOnly: true;
  runtimeEnforcement: false;
  permissionSystem: false;
  realApprovalFlow: false;
  writesGateRecords: false;
  sendsNotifications: false;
  writesNotion: false;
  readsRealData: false;
  writesRealData: false;
  authorizesExternalServices: false;
  executesActions: false;
  productionDeploy: false;
}

export interface ApprovalGateCategoryDefinition {
  category: ApprovalGateCategory;
  severity: ApprovalGateSeverity;
  owner: ApprovalGateOwner;
  label: string;
  examples: readonly string[];
  defaultDecisionOwner: ApprovalGateOwner;
}

export interface ApprovalGateEscalationRule {
  actionKey: string;
  categories: readonly ApprovalGateCategory[];
  status: ApprovalGateStatus;
  recommendedOwner: ApprovalGateOwner;
}

export interface ApprovalGateReportingContract {
  summaryFields: readonly string[];
  warningKinds: readonly string[];
  readsRegistryMetadataOnly: true;
  createsGateRecords: false;
  writesNotion: false;
  sendsNotifications: false;
}

export interface ApprovalGateContract {
  version: 'v0';
  implementation: 'contract-only';
  boundaries: ApprovalGateBoundaries;
  categories: readonly ApprovalGateCategoryDefinition[];
  reservedActionKeys: readonly string[];
  statusVocabulary: readonly ApprovalGateStatus[];
  decisionOptions: readonly ApprovalGateDecisionOption[];
  escalationRules: readonly ApprovalGateEscalationRule[];
  reporting: ApprovalGateReportingContract;
}

export interface ShellRouteBoundaries {
  staticRouteRegistryOnly: true;
  changesUI: false;
  createsPages: false;
  implementsRouter: false;
  runtimeEnforcement: false;
  readsRealData: false;
  writesRealData: false;
  writesNotion: false;
  sendsNotifications: false;
  authorizesExternalServices: false;
  executesActions: false;
  productionDeploy: false;
}

export interface ShellModeAvailability {
  personal: ShellModeAvailabilityValue;
  demo: ShellModeAvailabilityValue;
  market: ShellModeAvailabilityValue;
}

export interface ShellRouteEvidenceLink {
  kind: ShellRouteEvidenceKind;
  artifact: string;
}

export interface ShellRouteEntry {
  routeKey: string;
  moduleId: string;
  label: {
    zh: string;
    en?: string;
  };
  modeAvailability: ShellModeAvailability;
  entryStatus: ShellEntryStatus;
  emptyStateKey: ShellEmptyStateKey | null;
  requiredCapabilities: readonly string[];
  approvalGateKeys: readonly string[];
  evidenceLinks: readonly ShellRouteEvidenceLink[];
}

export interface ShellRouteDictionaries {
  routeEntryFields: readonly string[];
  modeAvailabilityValues: readonly ShellModeAvailabilityValue[];
  entryStatusValues: readonly ShellEntryStatus[];
  emptyStateKeys: readonly ShellEmptyStateKey[];
  evidenceKinds: readonly ShellRouteEvidenceKind[];
}

export interface ShellRouteReportingContract {
  summaryFields: readonly string[];
  warningKinds: readonly string[];
  readsRegistryMetadataOnly: true;
  changesUI: false;
  createsPages: false;
  implementsRouter: false;
  writesNotion: false;
  readsRealData: false;
}

export interface ShellRouteContract {
  version: 'v0';
  implementation: 'contract-only';
  boundaries: ShellRouteBoundaries;
  routes: readonly ShellRouteEntry[];
  dictionaries: ShellRouteDictionaries;
  reporting: ShellRouteReportingContract;
}

export interface ArtifactVisibilityBoundaries {
  staticArtifactRegistryOnly: true;
  readsArtifactFilesOnly: true;
  changesUI: false;
  createsRoutes: false;
  runtimeEnforcement: false;
  readsRealData: false;
  writesRealData: false;
  writesNotion: false;
  sendsNotifications: false;
  authorizesExternalServices: false;
  executesActions: false;
  productionDeploy: false;
}

export interface ArtifactRootContract {
  key: string;
  label: string;
  path: string;
  required: boolean;
}

export interface ArtifactVisibilityReportingContract {
  summaryFields: readonly string[];
  readsArtifactFilesOnly: true;
  changesUI: false;
  createsRoutes: false;
  writesNotion: false;
  readsRealData: false;
}

export interface ArtifactVisibilityContract {
  version: 'v1';
  implementation: 'contract-only';
  boundaries: ArtifactVisibilityBoundaries;
  artifactRoots: readonly ArtifactRootContract[];
  artifactKinds: readonly ArtifactVisibilityKind[];
  statusVocabulary: readonly ArtifactVisibilityStatus[];
  reporting: ArtifactVisibilityReportingContract;
}

export type ArtifactStatusVisibilityState = 'needs_ceo' | 'blocked' | 'QA' | 'active' | 'archived';
export type ArtifactStatusPrimaryActionKind = 'open_artifact' | 'view_detail' | 'decide' | 'retry' | 'none';

export interface ArtifactStatusVisibilityBoundaries {
  localArtifactStatusOnly: true;
  readsArtifactFilesOnly: true;
  derivesStatusFromStaticArtifacts: true;
  createsTaskRecords: false;
  createsGateRecords: false;
  syncsHandoffs: false;
  runtimeEnforcement: false;
  readsRealData: false;
  writesRealData: false;
  writesNotion: false;
  sendsNotifications: false;
  authorizesExternalServices: false;
  executesActions: false;
  productionDeploy: false;
}

export interface ArtifactStatusVisibilityReportingContract {
  visibleRecordLimit: number;
  readsArtifactFilesOnly: true;
  writesNotion: false;
  readsRealData: false;
  sendsNotifications: false;
  syncsHandoffs: false;
  createsTaskRecords: false;
}

export interface ArtifactStatusVisibilityContract {
  version: 'v0.2';
  implementation: 'static-report-local-artifact-only';
  boundaries: ArtifactStatusVisibilityBoundaries;
  stateVocabulary: readonly ArtifactStatusVisibilityState[];
  statePriority: readonly ArtifactStatusVisibilityState[];
  requiredFields: readonly string[];
  primaryActionKinds: readonly ArtifactStatusPrimaryActionKind[];
  reporting: ArtifactStatusVisibilityReportingContract;
}

export interface ShellDiscoveryEntryBoundaries {
  shellDiscoveryOnly: true;
  minimumTouchTargetPx: 44;
  usesStaticRegistryMetadata: true;
  changesRouteBehavior: false;
  createsRoutes: false;
  runtimeEnforcement: false;
  readsRealData: false;
  writesRealData: false;
  writesNotion: false;
  sendsNotifications: false;
  authorizesExternalServices: false;
  executesActions: false;
  productionDeploy: false;
}

export interface ShellDiscoveryEntryAffordance {
  firstScreenHint: string;
  dialogTitlePattern: string;
  triggerSelector: string;
  closeSelector: string;
  toolEntrySelector: string;
}

export interface ShellDiscoveryEntryReportingContract {
  summaryFields: readonly string[];
  readsRegistryMetadataOnly: true;
  readsArtifactFilesOnly: true;
  changesRoutes: false;
  writesNotion: false;
  readsRealData: false;
}

export interface ShellDiscoveryEntryContract {
  version: 'v0';
  implementation: 'static-registry-and-shell-ui';
  boundaries: ShellDiscoveryEntryBoundaries;
  entryAffordance: ShellDiscoveryEntryAffordance;
  reporting: ShellDiscoveryEntryReportingContract;
}

export type MobileAppIntegrationStrategy =
  | 'embedded_static'
  | 'external_webview_gated'
  | 'native_bridge_deferred'
  | 'not_ready';

export interface MobileAppIntegrationTargetShell {
  appId: string;
  appName: string;
  capacitorProjectPath: string;
  webDir: string;
}

export interface MobileAppIntegrationBoundaries {
  staticRegistryOnly: true;
  changesNativeProject: false;
  runsCapacitorSync: false;
  opensXcode: false;
  appStoreSubmission: false;
  runtimeNativeBridge: false;
  readsRealData: false;
  writesRealData: false;
  writesNotion: false;
  sendsNotifications: false;
  authorizesExternalServices: false;
  executesActions: false;
  productionDeploy: false;
}

export interface MobileAppIntegrationReportingContract {
  summaryFields: readonly string[];
  readsRegistryMetadataOnly: true;
  changesNativeProject: false;
  runsCapacitorSync: false;
  writesNotion: false;
  readsRealData: false;
}

export interface MobileAppIntegrationContract {
  version: 'v0';
  implementation: 'static-contract-report-only';
  targetShell: MobileAppIntegrationTargetShell;
  boundaries: MobileAppIntegrationBoundaries;
  strategies: readonly MobileAppIntegrationStrategy[];
  reporting: MobileAppIntegrationReportingContract;
}

export interface ModuleRegistry {
  shell: {
    name: string;
    returnHref: string;
  };
  dataKeyOwnership: ModuleDataKeyOwnershipManifest;
  experienceServices: ExperienceServicesContract;
  dataAggregation: DataAggregationContract;
  approvalGate: ApprovalGateContract;
  shellRouteContract: ShellRouteContract;
  artifactVisibility: ArtifactVisibilityContract;
  artifactStatusVisibility: ArtifactStatusVisibilityContract;
  shellDiscoveryEntrySlice: ShellDiscoveryEntryContract;
  mobileAppIntegration: MobileAppIntegrationContract;
  modules: ModuleRegistryEntry[];
}

export const EXPERIENCE_SERVICE_RESERVED_KEYS_V0: ExperienceServiceReservedKeys;
export const EXPERIENCE_SERVICES_V0: ExperienceServicesContract;
export const DATA_AGGREGATION_RED_LINE_KEYS_V0: DataAggregationRedLineKeys;
export const DATA_AGGREGATION_V0: DataAggregationContract;
export const MODULE_DATA_KEY_OWNERSHIP_V1: ModuleDataKeyOwnershipManifest;
export const APPROVAL_GATE_V0: ApprovalGateContract;
export const SHELL_ROUTE_CONTRACT_V0: ShellRouteContract;
export const ARTIFACT_VISIBILITY_REGISTRY_V1: ArtifactVisibilityContract;
export const ARTIFACT_STATUS_VISIBILITY_V02: ArtifactStatusVisibilityContract;
export const SHELL_DISCOVERY_ENTRY_SLICE_V0: ShellDiscoveryEntryContract;
export const MOBILE_APP_INTEGRATION_V0: MobileAppIntegrationContract;
export function getModuleCapabilityContract(
  moduleId: string,
  routeOrigin?: ModuleOrigin,
): ModuleCapabilities;
export function buildModuleRegistry(
  config: { meta?: { title?: string }; tools: Array<Record<string, unknown>> },
  options?: { basePath?: string; returnHref?: string },
): ModuleRegistry;
