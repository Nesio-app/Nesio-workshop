export const CLOUD_SNAPSHOT_CONTRACT_VERSION = 'cloud-snapshot-v1' as const;

export type CloudSnapshotOperationKey =
  | 'manual_backup'
  | 'manual_restore'
  | 'manual_delete_cloud_snapshot'
  | 'export_local_data'
  | 'export_cloud_data';

export type CloudSnapshotOperation = {
  key: CloudSnapshotOperationKey;
  label: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'DELETE';
  requiresSignedInUser: boolean;
  explicitUserActionRequired: boolean;
  writesCloud: boolean;
  deletesCloud: boolean;
  readsLocalData: boolean;
  readsCloudData: boolean;
  automaticSync: false;
  auditRequired: boolean;
};

export function buildCloudSnapshotContract() {
  const operations: CloudSnapshotOperation[] = [
    {
      key: 'manual_backup',
      label: 'Manual cloud backup',
      endpoint: '/api/cloud/memory',
      method: 'POST',
      requiresSignedInUser: true,
      explicitUserActionRequired: true,
      writesCloud: true,
      deletesCloud: false,
      readsLocalData: true,
      readsCloudData: false,
      automaticSync: false,
      auditRequired: true,
    },
    {
      key: 'manual_restore',
      label: 'Manual cloud restore',
      endpoint: '/api/cloud/memory',
      method: 'GET',
      requiresSignedInUser: true,
      explicitUserActionRequired: true,
      writesCloud: false,
      deletesCloud: false,
      readsLocalData: false,
      readsCloudData: true,
      automaticSync: false,
      auditRequired: true,
    },
    {
      key: 'manual_delete_cloud_snapshot',
      label: 'Manual cloud snapshot delete',
      endpoint: '/api/cloud/memory',
      method: 'DELETE',
      requiresSignedInUser: true,
      explicitUserActionRequired: true,
      writesCloud: true,
      deletesCloud: true,
      readsLocalData: false,
      readsCloudData: false,
      automaticSync: false,
      auditRequired: true,
    },
    {
      key: 'export_local_data',
      label: 'Export local data',
      endpoint: '/api/user-data/export',
      method: 'GET',
      requiresSignedInUser: false,
      explicitUserActionRequired: true,
      writesCloud: false,
      deletesCloud: false,
      readsLocalData: true,
      readsCloudData: false,
      automaticSync: false,
      auditRequired: false,
    },
    {
      key: 'export_cloud_data',
      label: 'Export cloud data',
      endpoint: '/api/cloud/memory?export=1',
      method: 'GET',
      requiresSignedInUser: true,
      explicitUserActionRequired: true,
      writesCloud: false,
      deletesCloud: false,
      readsLocalData: false,
      readsCloudData: true,
      automaticSync: false,
      auditRequired: true,
    },
  ];

  return {
    version: CLOUD_SNAPSHOT_CONTRACT_VERSION,
    semantics: {
      localData: 'device-local working copy and offline-first app state',
      cloudSnapshot: 'signed-in user controlled backup/restore copy in Supabase',
      automaticSyncEnabled: false,
      conflictResolution: 'not_started',
      snapshotIsNotSourceOfTruth: true,
      requiresExplicitUserAction: true,
    },
    operations,
    boundaries: {
      noBackgroundSync: true,
      noCrossUserAccess: true,
      noExternalNotification: true,
      noRealDataMigration: true,
      destructiveCloudDeleteRequiresConfirmation: true,
      productionDeletionOrMigrationRequiresCeoGate: true,
    },
    coverage: {
      manualBackup: operations.some((operation) => operation.key === 'manual_backup'),
      manualRestore: operations.some((operation) => operation.key === 'manual_restore'),
      manualDeleteCloudSnapshot: operations.some((operation) => operation.key === 'manual_delete_cloud_snapshot'),
      exportLocalData: operations.some((operation) => operation.key === 'export_local_data'),
      exportCloudData: operations.some((operation) => operation.key === 'export_cloud_data'),
    },
  };
}
