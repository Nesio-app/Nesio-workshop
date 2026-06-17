export type LocalDataRecordState = 'needs_ceo' | 'blocked' | 'QA' | 'active' | 'archived';

export type LocalDataArtifactKind =
  | 'engineering'
  | 'qa'
  | 'archive'
  | 'spec'
  | 'plan'
  | 'audit'
  | 'inventory'
  | 'report'
  | 'unknown';

export type LocalDataGateCategory =
  | 'real_db'
  | 'notion_mirror'
  | 'external_service'
  | 'notification'
  | 'real_data_migration'
  | 'real_user_data'
  | 'production_deploy'
  | 'commercial_claim'
  | 'other';

export type LocalDataBoundary = {
  implementation: 'local-report-projected-records-v0';
  localStaticOnly: true;
  readsArtifactFilesOnly: true;
  derivesFromArtifactStatus: true;
  createsDbRows: false;
  createsGateRecords: false;
  syncsHandoffs: false;
  writesRealData: false;
  readsRealData: false;
  writesNotion: false;
  sendsNotifications: false;
  authorizesExternalServices: false;
  executesActions: false;
  productionDeploy: false;
};

export type GateStatus = 'waiting_ceo' | 'queued' | 'open';
export type HandoffStatus = 'waiting_ceo' | 'queued' | 'open';
export type QaStatus = 'needs_ceo_decision' | 'blocked' | 'pending_qa' | 'active';

export interface ArtifactStatusSourceRecord {
  artifactId?: string;
  title?: string;
  artifactPath?: string;
  kind?: string;
  artifactKind?: string;
  owner?: string;
  state?: string;
  handoffFrom?: string;
  handoffTo?: string | string[] | null;
  nextOwner?: string | null;
  nextStep?: string | null;
  resumeAction?: string | null;
  blocker?: string | null;
  needsCeoGate?: boolean;
  primaryActionKind?: string;
  visibilityPriority?: number;
  modifiedAt?: string;
  sourceVerified?: boolean;
  handoffParsed?: boolean;
  sourceThreadId?: string;
  reason?: string;
  resolutionHint?: string;
};

export interface LocalDataArtifactRecord {
  id: string;
  artifactPath: string;
  title: string;
  artifactKind: LocalDataArtifactKind;
  owner: string;
  state: LocalDataRecordState;
  nextOwner: string | null;
  nextStep: string;
  resumeAction: string | null;
  blocker: string | null;
  needsCeoGate: boolean;
  primaryActionKind: string;
  visibilityPriority: number;
  sourceVerified: boolean;
  handoffParsed: boolean;
  qaStatus: QaStatus;
  handoffFrom: string;
  handoffTo: string[];
  artifactState: LocalDataRecordState;
  archiveEligible: boolean;
  updatedAt: string;
}

export interface LocalDataHandoffRecord {
  id: string;
  source: 'artifact_status_visibility_v02';
  artifactPath: string;
  artifactTitle: string;
  status: HandoffStatus;
  from: string;
  to: string[];
  nextOwner: string | null;
  reason: string;
  resumeAction: string | null;
  blocker: string | null;
  needsCeoGate: boolean;
  sourceVerified: boolean;
  parsedAt: string;
  dedupeKey: string;
  sourceThreadId: string | null;
}

export interface LocalDataGateRecord {
  id: string;
  source: 'artifact_status_visibility_v02';
  artifactPath: string;
  artifactTitle: string;
  category: LocalDataGateCategory;
  status: GateStatus;
  owner: 'CEO';
  reason: string;
  blocker: string | null;
  needsCeoGate: true;
  sourceVerified: boolean;
  qaStatus: QaStatus;
  dedupeKey: string;
  evidenceRef: string;
}

export interface LocalDataRecordsSummary {
  artifactRecordCount: number;
  handoffRecordCount: number;
  gateRecordCount: number;
  needsCeoGateCount: number;
  byArtifactState: Record<LocalDataRecordState, number>;
  warningCount: number;
}

export interface LocalDataBoundaryWarning {
  warningKind: string;
  count: number;
  issue: string;
}

export interface LocalDataDashboardMetrics {
  byArtifactKind: Record<string, number>;
  byOwner: Record<string, number>;
  byGateCategory: Record<string, number>;
  byHandoffStatus: Record<string, number>;
  archivedCount: number;
}

export interface LocalDataDashboardQueues {
  needsCeoArtifacts: Array<{
    artifactPath: string;
    title: string;
    owner: string;
    state: LocalDataRecordState;
    blocker: string | null;
    nextOwner: string | null;
    archiveEligible: boolean;
  }>;
  handoffQueue: Array<{
    id: string;
    artifactPath: string;
    artifactTitle: string;
    from: string;
    to: string[];
    status: HandoffStatus;
    reason: string;
  }>;
  gateQueue: Array<{
    id: string;
    artifactPath: string;
    artifactTitle: string;
    category: LocalDataGateCategory;
    reason: string;
    evidenceRef: string;
  }>;
}

export interface LocalDataDashboardPack {
  implementation: 'local-report-projected-records-v0';
  generatedAt: string;
  summary: LocalDataRecordsSummary;
  boundaries: LocalDataBoundary;
  metrics: LocalDataDashboardMetrics;
  queues: LocalDataDashboardQueues;
  warnings: LocalDataBoundaryWarning[];
}

export interface LocalDataRecordsV0 {
  implementation: 'local-report-projected-records-v0';
  boundaries: LocalDataBoundary;
  generatedAt: string;
  artifactRecords: LocalDataArtifactRecord[];
  handoffRecords: LocalDataHandoffRecord[];
  gateRecords: LocalDataGateRecord[];
  summary: LocalDataRecordsSummary;
  warnings: LocalDataBoundaryWarning[];
}

export interface BuildLocalDataRecordsOptions {
  generatedAt?: string;
}

export declare const LOCAL_DATA_RECORD_BOUNDARIES_V0: LocalDataBoundary;
export declare const LOCAL_DATA_RECORD_STATE_PRIORITY: readonly LocalDataRecordState[];
export declare const LOCAL_DATA_DASHBOARD_LIMIT_DEFAULT = 25;
export declare function normalizeHandoffTo(value: unknown): string[];
export declare function inferGateCategory(record: Pick<ArtifactStatusSourceRecord, 'blocker' | 'reason' | 'resumeAction' | 'resolutionHint' | 'title' | 'artifactPath'>): LocalDataGateCategory;
export declare function buildLocalDataRecordsV0(
  records: ArtifactStatusSourceRecord[],
  options?: BuildLocalDataRecordsOptions,
): LocalDataRecordsV0;
export declare function buildLocalDataRecordsDashboardPack(
  localDataRecords: LocalDataRecordsV0,
  options?: { topN?: number },
): LocalDataDashboardPack;
