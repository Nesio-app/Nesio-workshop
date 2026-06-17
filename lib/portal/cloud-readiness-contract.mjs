const CONTRACT_VERSION = 'cloud-readiness-contract-v0';

const PROVIDER_CANDIDATES = Object.freeze([
  {
    provider: 'supabase',
    category: 'managed_postgres_with_auth_optional',
    strengths: ['postgres_compatibility', 'row_level_security', 'storage_and_edge_options'],
    risks: ['auth_coupling_if_enabled_too_early', 'service_role_secret_handling'],
    firstUseAllowedNow: false,
  },
  {
    provider: 'neon',
    category: 'managed_serverless_postgres',
    strengths: ['postgres_portability', 'branching_for_staging', 'clear_sql_migration_path'],
    risks: ['requires_separate_auth_layer', 'network_latency_for_mobile_sync'],
    firstUseAllowedNow: false,
  },
  {
    provider: 'firebase',
    category: 'managed_document_sync_platform',
    strengths: ['mobile_offline_patterns', 'auth_integration', 'realtime_sync'],
    risks: ['document_model_lock_in', 'privacy_label_surface_area'],
    firstUseAllowedNow: false,
  },
  {
    provider: 'turso',
    category: 'managed_edge_sqlite',
    strengths: ['sqlite_affinity', 'edge_replication', 'local_first_fit'],
    risks: ['sync_semantics_need_extra_review', 'ecosystem_smaller_than_postgres'],
    firstUseAllowedNow: false,
  },
  {
    provider: 'self_hosted_postgres',
    category: 'owned_postgres',
    strengths: ['maximum_control', 'portable_sql', 'backup_policy_owned'],
    risks: ['ops_burden', 'security_and_availability_owned_by_team'],
    firstUseAllowedNow: false,
  },
]);

const PROVIDER_SELECTION_CRITERIA = Object.freeze([
  'data_export_portability',
  'delete_semantics_verifiable',
  'offline_first_sync_fit',
  'local_id_to_cloud_id_mapping_supported',
  'privacy_label_impact_understandable',
  'backup_restore_and_point_in_time_recovery',
  'staging_isolation',
  'secret_rotation_and_least_privilege',
]);

const BOUNDARIES = Object.freeze({
  cloudEnabled: false,
  realCloudProviderConnected: false,
  networkRequestsEnabled: false,
  writesCloudData: false,
  readsCloudData: false,
  cloudMigrationEnabled: false,
  cloudSyncEnabled: false,
  providerSdkInstalledByThisContract: false,
  environmentSecretsRequiredNow: false,
  realCloudRequiresCeoGate: true,
});

const INVENTORY_CLOUD_FIELDS = Object.freeze({
  local_id: {
    type: 'string',
    primaryLocalKey: true,
    nullableNow: false,
    sensitivity: 'personal_local',
    source: 'local_inventory_store',
  },
  cloud_id: {
    type: 'string|null',
    primaryCloudKey: true,
    nullableNow: true,
    sensitivity: 'cloud_identifier_future',
    source: 'future_cloud_provider',
  },
  owner_profile_id: {
    type: 'string|null',
    nullableNow: true,
    sensitivity: 'identity_boundary_future',
    source: 'future_identity_boundary',
  },
  demo_scope: {
    type: 'demo|personal',
    nullableNow: false,
    sensitivity: 'demo_boundary',
    source: 'local_data_boundary',
  },
  name: {
    type: 'string',
    nullableNow: false,
    sensitivity: 'personal_content',
    source: 'inventory_local_store',
  },
  quantity: {
    type: 'number',
    nullableNow: false,
    sensitivity: 'personal_content',
    source: 'inventory_local_store',
  },
  category: {
    type: 'string|null',
    nullableNow: true,
    sensitivity: 'personal_content',
    source: 'inventory_local_store',
  },
  updated_at: {
    type: 'iso_datetime',
    nullableNow: false,
    sensitivity: 'operational_metadata',
    source: 'local_clock',
  },
  deleted_at: {
    type: 'iso_datetime|null',
    nullableNow: true,
    sensitivity: 'operational_metadata',
    source: 'future_tombstone_policy',
  },
  schema_version: {
    type: 'string',
    nullableNow: false,
    sensitivity: 'operational_metadata',
    source: 'tool_data_versioning_contract',
  },
});

function buildTablePlacement() {
  return [
    {
      table: 'inventory_items',
      currentPlacement: 'local_only',
      futureCloudEligible: true,
      cloudReadiness: 'draft_schema_ready',
      reason: 'First-launch personal data can be exported locally now and may sync later after identity and cloud CEO Gate.',
    },
    {
      table: 'cloud_id_mappings',
      currentPlacement: 'not_created',
      futureCloudEligible: true,
      cloudReadiness: 'future_mapping_contract_only',
      reason: 'Needed later to map local_id to cloud_id without replacing local-first IDs.',
    },
    {
      table: 'local_profile',
      currentPlacement: 'local_only',
      futureCloudEligible: false,
      cloudReadiness: 'identity_gate_required',
      reason: 'Current profile is not a real account and must not become a cloud user row without auth approval.',
    },
    {
      table: 'demo_seed',
      currentPlacement: 'local_only',
      futureCloudEligible: false,
      cloudReadiness: 'keep_local_or_static_asset',
      reason: 'Demo data must not pollute personal or cloud data.',
    },
    {
      table: 'handoff_records',
      currentPlacement: 'internal_report_only',
      futureCloudEligible: false,
      cloudReadiness: 'internal_ops_only',
      reason: 'Handoff/Gate/Artifact records are internal operations evidence, not user privacy data.',
    },
    {
      table: 'audit_events',
      currentPlacement: 'local_dev_or_report_only',
      futureCloudEligible: false,
      cloudReadiness: 'ceo_and_privacy_review_required',
      reason: 'Cloud audit retention affects privacy promises and requires a separate policy.',
    },
  ];
}

export function buildCloudReadinessContract({
  userIdentityUpgrade,
  offlineSyncConflict,
} = {}) {
  const tablePlacement = buildTablePlacement();
  const futureCloudEligibleTableCount = tablePlacement
    .filter((entry) => entry.futureCloudEligible).length;

  return {
    version: CONTRACT_VERSION,
    implementation: 'report-only',
    boundaries: { ...BOUNDARIES },
    providerCandidates: PROVIDER_CANDIDATES.map((candidate) => ({ ...candidate })),
    providerSelectionCriteria: [...PROVIDER_SELECTION_CRITERIA],
    idMapping: {
      localIdField: 'local_id',
      cloudIdField: 'cloud_id',
      mappingTableDraft: 'cloud_id_mappings',
      mappingEnabledNow: false,
      cloudIdNullableNow: true,
      serverUserIdRequiredNow: false,
      localIdRemainsStableAfterCloudUpgrade: true,
      conflictIfMultipleCloudIdsForOneLocalId: true,
    },
    inventoryCloudSchemaDraft: {
      tableName: 'inventory_items',
      recordName: 'CloudInventoryItemDraft@v0',
      status: 'draft_only',
      enabledNow: false,
      fields: { ...INVENTORY_CLOUD_FIELDS },
      indexes: [
        { name: 'idx_inventory_owner_updated', fields: ['owner_profile_id', 'updated_at'] },
        { name: 'idx_inventory_local_id', fields: ['local_id'] },
        { name: 'idx_inventory_cloud_id', fields: ['cloud_id'] },
        { name: 'idx_inventory_demo_scope', fields: ['demo_scope'] },
      ],
      constraints: [
        'local_id_required_for_all_records',
        'cloud_id_nullable_until_real_cloud_sync',
        'demo_scope_must_not_cross_personal_scope',
      ],
    },
    exportDeleteSemantics: {
      exportCloudData: {
        enabledNow: false,
        futureBehavior: 'include_cloud_snapshot_after_explicit_user_request',
        requiresAuth: true,
        includesLocalExportNow: false,
      },
      deleteCloudData: {
        enabledNow: false,
        futureBehavior: 'delete_or_tombstone_cloud_records_after_account_auth',
        requiresRealAuth: true,
        requiresCeoGateBeforeImplementation: true,
      },
      deleteLocalDataDifferentFromDeleteAccount: true,
      currentDeleteLocalDataScope: 'device_local_data_only',
    },
    syncConflictPolicy: {
      enabledNow: false,
      states: offlineSyncConflict?.conflictStates || ['none', 'pending', 'conflict', 'resolved', 'failed'],
      defaultInventoryPolicy: 'manual_merge_required',
      lowRiskMetadataPolicy: 'last_write_wins_allowed_later',
      personalDataAutoMergeAllowedNow: false,
      realConflictMergeRequiresCeoGate: true,
    },
    userIdentityBoundary: {
      accountSystemEnabled: userIdentityUpgrade?.summary?.accountSystemEnabled === true,
      currentProfileKind: userIdentityUpgrade?.summary?.currentProfileKind || 'local_profile',
      serverUserIdEnabled: userIdentityUpgrade?.summary?.serverUserIdEnabled === true,
      cloudIdentityEnabled: false,
      futureAccountLinkingRequiredBeforeCloudPersonalSync: true,
    },
    tablePlacement,
    summary: {
      cloudReadinessVersion: CONTRACT_VERSION,
      cloudEnabled: false,
      realCloudProviderConnected: false,
      cloudProviderCandidateCount: PROVIDER_CANDIDATES.length,
      inventoryCloudSchemaDraftReady: true,
      futureCloudEligibleTableCount,
    },
    warnings: [],
  };
}
