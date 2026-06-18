import type { PortalTool } from './types';

export interface LaunchSurfaceContext {
  viewerRole: 'public' | 'tester' | 'personal_lab';
  testerAllowlist: string[];
  testerCohort?: string | null;
  testerCode?: string | null;
}

export interface LaunchSurfaceState {
  moduleId: string;
  launchStatus: string;
  toolLifecycle: string;
  prodExposure: string;
  visible: boolean;
  visibleForPublic: boolean;
  visibleForTester: boolean;
  visibleForPersonalLab: boolean;
  reason: string;
  shellAction: string;
  approvalGateState: string;
  paywallState: string;
  blockedByApprovalGate: boolean;
  blockedByPaywallGate: boolean;
  approvalGateOverridesPaywallGate: boolean;
  paywallBehavior: string;
  realPurchaseEnabled: boolean;
  storeKitEnabled: boolean;
  realRuntimeEnabled: boolean;
  personalLabMode: boolean;
  betaBadgeRequired: boolean;
  appStoreMentionAllowed: boolean;
  screenshotSafe: boolean;
}

export const LAUNCH_SURFACE_VERSION_V0: 'launch-surface-v0';

export function resolveTesterCohort(cohortCode?: string | null): {
  code: string | null;
  source: 'local_cohort_code' | 'none';
  moduleIds: string[];
};

export function resolveLaunchSurfaceState(
  tool: PortalTool & Record<string, unknown>,
  context?: Partial<LaunchSurfaceContext>,
): LaunchSurfaceState;

export function filterToolsForLaunchSurface<T extends PortalTool>(
  tools: T[],
  context?: Partial<LaunchSurfaceContext>,
): T[];

export function buildLaunchReadinessSummary(
  tools: Array<PortalTool & Record<string, unknown>>,
  context?: Partial<LaunchSurfaceContext>,
): Record<string, unknown>;

export function readLaunchSurfaceContextFromBrowser(): LaunchSurfaceContext;
