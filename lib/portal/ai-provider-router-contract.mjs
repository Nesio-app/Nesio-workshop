const AI_PROVIDER_ROUTER_BOUNDARIES_V0 = Object.freeze({
  implementation: 'ai-provider-router-contract-v0',
  mode: 'internal-sandbox-only',
  appStoreLaunchEnabled: false,
  shellAiEnabled: false,
  inventoryAiEnabled: false,
  realProviderCallsEnabled: false,
  storesPrompts: false,
  storesCompletions: false,
  readsRealUserData: false,
  writesRealUserData: false,
  authorizesExternalProviders: false,
});

const AI_MODULE_POLICY_V0 = Object.freeze([
  Object.freeze({ moduleId: 'shell', aiAllowed: false, reason: 'Launch shell should stay deterministic.' }),
  Object.freeze({ moduleId: 'inventory', aiAllowed: false, reason: 'Inventory launch uses local purchase memory only.' }),
  Object.freeze({ moduleId: 'health', aiAllowed: false, reason: 'Health claims and sensitive data require CEO/legal gate.' }),
  Object.freeze({ moduleId: 'psychoanalysis', aiAllowed: false, reason: 'Mental/reflection AI requires CEO/legal gate.' }),
  Object.freeze({ moduleId: 'secretary', aiAllowed: true, environment: 'internal-sandbox', reason: 'Existing assistant path; not App Store launch default.' }),
  Object.freeze({ moduleId: 'reading', aiAllowed: true, environment: 'internal-sandbox', reason: 'Allowed only for internal experiments.' }),
]);

function buildAiProviderRouterContract() {
  return {
    version: 'ai-provider-router-contract-v0',
    generatedAt: new Date().toISOString(),
    boundaries: { ...AI_PROVIDER_ROUTER_BOUNDARIES_V0 },
    providers: {
      configured: [],
      secretNames: ['OPENAI_API_KEY', 'GEMINI_API_KEY'],
      productionProviderEnabled: false,
    },
    modulePolicy: AI_MODULE_POLICY_V0.map((entry) => ({ ...entry })),
    launchPolicy: {
      shell: 'disabled',
      inventory: 'disabled',
      appStoreFirstRelease: 'disabled',
      internalSandbox: 'contract-only',
      requiresCeoGateForEnablement: true,
    },
  };
}

export {
  AI_MODULE_POLICY_V0,
  AI_PROVIDER_ROUTER_BOUNDARIES_V0,
  buildAiProviderRouterContract,
};
