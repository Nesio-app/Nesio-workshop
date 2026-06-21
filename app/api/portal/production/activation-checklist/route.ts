import { NextResponse } from 'next/server';
import { buildProductionRuntimeStatus } from '@/lib/portal/production-runtime';

type RuntimeStatus = ReturnType<typeof buildProductionRuntimeStatus>;
type RuntimeProviderAction = RuntimeStatus['providerActionMatrix'][number];
type RuntimeSetupTask = RuntimeStatus['setupTaskMatrix'][number];

function nextAction(provider: RuntimeProviderAction, setupTask?: RuntimeSetupTask): string {
  if (provider.actionStatus === 'ready') return 'ready_for_user_action';
  if (provider.actionStatus === 'server_ready') return 'ready_server_side';
  if (setupTask?.blockedReason === 'missing_env') return 'set_missing_environment_variables';
  if (setupTask?.blockedReason === 'canonical_domain_mismatch') return 'verify_canonical_domain_or_allowed_runtime_host';
  if (setupTask?.blockedReason === 'provider_disabled') return 'enable_provider_runtime_switch';
  return 'review_provider_configuration';
}

export async function GET(request: Request) {
  const runtime = buildProductionRuntimeStatus(process.env, {
    requestHost: request.headers.get('host'),
  });
  const setupTasksById = new Map(runtime.setupTaskMatrix.map((task) => [task.id, task]));

  const activationChecklist = runtime.providerActionMatrix.map((provider) => {
    const setupTask = setupTasksById.get(provider.id);
    return {
      id: provider.id,
      label: provider.label,
      category: provider.category,
      configured: provider.configured,
      enabled: provider.enabled,
      actionStatus: provider.actionStatus,
      startEndpoint: provider.startEndpoint,
      safeUserAction: provider.safeUserAction,
      serverOnly: provider.serverOnly,
      missingEnv: provider.missingEnv,
      blockedReason: setupTask?.blockedReason ?? null,
      requiresCanonicalDomain: setupTask?.requiresCanonicalDomain ?? false,
      nextAction: nextAction(provider, setupTask),
    };
  });

  const readyActions = activationChecklist.filter((entry) =>
    entry.actionStatus === 'ready' || entry.actionStatus === 'server_ready');
  const blockedActions = activationChecklist.filter((entry) =>
    entry.actionStatus === 'configure_required' || Boolean(entry.blockedReason));

  return NextResponse.json(
    {
      ok: true,
      service: 'portal-production-activation-checklist',
      version: 'production-activation-checklist-v0',
      safePublicStatus: true,
      secretsRedacted: true,
      canonicalDomain: runtime.canonicalDomain,
      requestHost: runtime.requestHost,
      canonicalDomainMatchesRequestHost: runtime.canonicalDomainMatchesRequestHost,
      categorySummary: runtime.summary.categoryReadinessSummary,
      activationChecklist,
      readyActions,
      blockedActions,
      nextSetupActions: blockedActions.map((entry) => ({
        id: entry.id,
        label: entry.label,
        category: entry.category,
        blockedReason: entry.blockedReason,
        missingEnv: entry.missingEnv,
        requiresCanonicalDomain: entry.requiresCanonicalDomain,
        nextAction: entry.nextAction,
      })),
      summary: {
        providerCount: runtime.summary.providerCount,
        readyActionCount: readyActions.length,
        blockedActionCount: blockedActions.length,
        canonicalDomainReady: runtime.summary.canonicalDomainReady,
        productionRuntimeReady: runtime.summary.productionRuntimeReady,
      },
    },
    {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
    },
  );
}
