import { resolveLaunchSurfaceState } from './launch-surface.mjs';

function normalizeContext(context = {}) {
  return {
    viewerRole: context.viewerRole === 'personal_lab'
      ? 'personal_lab'
      : context.viewerRole === 'tester' ? 'tester' : 'public',
    testerAllowlist: Array.isArray(context.testerAllowlist) ? context.testerAllowlist : [],
    testerCohort: typeof context.testerCohort === 'string' ? context.testerCohort : null,
    testerCode: typeof context.testerCode === 'string' ? context.testerCode : null,
  };
}

export function resolveShellRuntimeState(tool, context = {}) {
  const ctx = normalizeContext(context);
  const launchState = resolveLaunchSurfaceState(tool, ctx);
  const openEnabled = launchState.visible &&
    (launchState.shellAction === 'open' || launchState.shellAction === 'open_lab_preview') &&
    (tool.ready !== false || ctx.viewerRole === 'personal_lab');

  return {
    ...launchState,
    ready: openEnabled,
    openEnabled,
    runtimeEnforced: true,
    resolver: 'shell-runtime-resolver-v0',
  };
}

export function shouldShellOpenTool(runtimeState) {
  return runtimeState?.openEnabled === true &&
    (runtimeState?.shellAction === 'open' || runtimeState?.shellAction === 'open_lab_preview');
}

export function applyShellRuntimeState(tool, context = {}) {
  const shellRuntime = resolveShellRuntimeState(tool, context);
  return {
    ...tool,
    ready: shellRuntime.openEnabled,
    shellRuntime,
    launchStatus: shellRuntime.launchStatus,
    toolLifecycle: shellRuntime.toolLifecycle,
    prodExposure: shellRuntime.prodExposure,
    status: shellRuntime.blockedByApprovalGate
      ? 'gated'
      : shellRuntime.openEnabled ? 'ready' : 'not_ready',
  };
}

export function resolveShellRuntimeTools(tools = [], context = {}) {
  const resolvedTools = tools.map((tool) => applyShellRuntimeState(tool, context));
  return {
    resolver: 'shell-runtime-resolver-v0',
    context: normalizeContext(context),
    tools: resolvedTools,
    visibleTools: resolvedTools.filter((tool) => tool.shellRuntime?.visible === true),
    openableTools: resolvedTools.filter((tool) => tool.shellRuntime?.openEnabled === true),
  };
}
