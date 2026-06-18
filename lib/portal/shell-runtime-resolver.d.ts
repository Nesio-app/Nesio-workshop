import type { PortalTool } from './types';

export interface ShellRuntimeContext {
  viewerRole?: 'public' | 'tester' | 'personal_lab';
  testerAllowlist?: string[];
  testerCohort?: string | null;
  testerCode?: string | null;
}

export interface ShellRuntimeState {
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
  ready: boolean;
  openEnabled: boolean;
  runtimeEnforced: boolean;
  resolver: 'shell-runtime-resolver-v0';
}

export interface PortalToolWithShellRuntime extends PortalTool {
  shellRuntime: ShellRuntimeState;
  launchStatus?: string;
  toolLifecycle?: string;
  prodExposure?: string;
}

export function resolveShellRuntimeState(tool: PortalTool, context?: ShellRuntimeContext): ShellRuntimeState;
export function shouldShellOpenTool(runtimeState?: ShellRuntimeState): boolean;
export function applyShellRuntimeState<T extends PortalTool>(tool: T, context?: ShellRuntimeContext): T & PortalToolWithShellRuntime;
export function resolveShellRuntimeTools<T extends PortalTool>(
  tools?: T[],
  context?: ShellRuntimeContext,
): {
  resolver: 'shell-runtime-resolver-v0';
  context: Required<ShellRuntimeContext>;
  tools: Array<T & PortalToolWithShellRuntime>;
  visibleTools: Array<T & PortalToolWithShellRuntime>;
  openableTools: Array<T & PortalToolWithShellRuntime>;
};
