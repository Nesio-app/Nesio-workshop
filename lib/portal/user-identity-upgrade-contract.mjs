const CONTRACT_VERSION = 'user-identity-upgrade-contract-v0';

const PROFILE_KINDS = Object.freeze([
  'local_profile',
  'anonymous_profile',
  'apple_sign_in_profile',
]);

const BOUNDARIES = Object.freeze({
  accountSystemEnabled: false,
  realAuthEnabled: false,
  appleSignInEnabled: false,
  oauthEnabled: false,
  cloudIdentityEnabled: false,
  serverUserIdEnabled: false,
  createsUsersTable: false,
  realAccountLinkingEnabled: false,
  cloudSyncEnabled: false,
  writesRealUserData: false,
  realAuthRequiresCeoGate: true,
});

function buildCurrentIdentity(configIdentity = {}) {
  return {
    profileKind: configIdentity.currentProfileKind || 'local_profile',
    localProfileKey: configIdentity.localProfileKey || 'local_profile',
    anonymousProfileSupported: true,
    accountSystemEnabled: false,
    serverUserId: null,
    serverUserIdEnabled: false,
    realAuthEnabled: false,
    authProvider: 'none',
    sourceOfTruth: 'device_local_storage',
  };
}

export function buildUserIdentityUpgradeContract(config = {}) {
  const currentIdentity = buildCurrentIdentity(config.identity);

  return {
    version: CONTRACT_VERSION,
    implementation: 'report-only',
    currentIdentity,
    profileKinds: [...PROFILE_KINDS],
    boundaries: { ...BOUNDARIES },
    futureAppleSignIn: {
      provider: 'apple_sign_in',
      status: 'future_ceo_gated',
      enabledNow: false,
      storesAppleSubjectNow: false,
      createsServerUserNow: false,
      requiredBeforeEnable: [
        'CEO Gate',
        'Vera privacy wording review',
        'Ming auth QA plan',
        'account deletion policy',
      ],
    },
    accountLinking: {
      enabledNow: false,
      strategy: 'local_profile_to_account_link_after_ceo_gate',
      linkableSources: ['local_profile', 'anonymous_profile'],
      futureProviders: ['apple_sign_in'],
      conflictPolicy: 'manual_review_before_link',
      storesProviderTokenNow: false,
    },
    localDataMerge: {
      enabledNow: false,
      planKind: 'contract_only_future_merge',
      defaultPolicy: 'manual_review_before_merge',
      mergeRequiresCeoGate: true,
      sourceProfileKinds: ['local_profile', 'anonymous_profile'],
      targetProfileKind: 'apple_sign_in_profile',
      mergeOrder: [
        'export_local_snapshot',
        'create_account_after_ceo_gate',
        'dry_run_merge_plan',
        'user_review',
        'explicit_confirm',
      ],
      neverAutoMergeSensitiveData: true,
    },
    deleteLocalData: {
      enabledNow: true,
      scope: 'device_local_data_only',
      affectsServerAccount: false,
      affectsCloudData: false,
      userVisibleLabel: 'Delete local data',
    },
    deleteAccount: {
      enabledNow: false,
      scope: 'future_server_account_and_cloud_data',
      requiresAuth: true,
      requiresCeoGateBeforeImplementation: true,
      userVisibleLabel: 'Delete account',
    },
    multiDeviceConflict: {
      enabledNow: false,
      defaultResolution: 'manual_review_required',
      conflictSources: ['same_local_profile_on_multiple_devices', 'local_profile_linked_to_existing_account'],
      serverAuthoritativeNow: false,
    },
    identityBoundaryReport: {
      accountSystemEnabled: false,
      currentUserState: currentIdentity.profileKind,
      hasServerUserId: false,
      hasRealLogin: false,
      futureUpgradePathReadable: true,
    },
    summary: {
      accountSystemEnabled: false,
      currentProfileKind: currentIdentity.profileKind,
      serverUserIdEnabled: false,
      identityUpgradePathReadable: true,
      realAuthRequiresCeoGate: true,
    },
  };
}
