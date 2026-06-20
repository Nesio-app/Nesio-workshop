import assert from 'node:assert/strict';
import { buildAiProviderRouterContract } from '../lib/portal/ai-provider-router-contract.mjs';

const emptyContract = buildAiProviderRouterContract({ env: {} });

assert.equal(emptyContract.implementation, 'runtime-aware-contract');
assert.equal(emptyContract.boundaries.realProviderCallsEnabled, false);
assert.equal(emptyContract.providers.productionProviderEnabled, false);
assert.equal(emptyContract.runtimeAiReadiness.providerCount, 4);
assert.equal(emptyContract.runtimeAiReadiness.configuredProviderCount, 0);
assert.equal(emptyContract.runtimeAiReadiness.enabledProviderCount, 0);
assert.equal(emptyContract.summary.aiProviderConfiguredCount, 0);
assert.equal(emptyContract.summary.aiProviderEnabledCount, 0);

const geminiContract = buildAiProviderRouterContract({
  env: {
    BAOHE_AI_PROVIDER_MODE: 'production',
    GEMINI_API_KEY: 'gemini-key',
  },
});

assert.equal(geminiContract.boundaries.realProviderCallsEnabled, true);
assert.equal(geminiContract.boundaries.authorizesExternalProviders, true);
assert.equal(geminiContract.providers.productionProviderEnabled, true);
assert.deepEqual(geminiContract.providers.configured, ['gemini']);
assert.equal(geminiContract.runtimeAiReadiness.providers.gemini.configured, true);
assert.equal(geminiContract.runtimeAiReadiness.providers.gemini.enabled, true);
assert.equal(geminiContract.runtimeAiReadiness.providers.gemini.startEndpoint, '/api/secretary/chat');
assert.equal(geminiContract.runtimeAiReadiness.providers.gemini.secretsRedacted, true);
assert.equal(geminiContract.runtimeAiReadiness.providers.chatgpt.enabled, false);
assert.equal(geminiContract.summary.aiProviderConfiguredCount, 1);
assert.equal(geminiContract.summary.aiProviderEnabledCount, 1);
assert.equal(geminiContract.summary.defaultAiProvider, 'gemini');

const aliasContract = buildAiProviderRouterContract({
  env: {
    BAOHE_AI_PROVIDER_MODE: 'production',
    GOOGLE_GENERATIVE_AI_API_KEY: 'gemini-alias',
    OpenAI_KEY: 'openai-alias',
    ANTHROPIC_API_KEY: 'anthropic-key',
    DOUBAO_API_KEY: 'doubao-key',
  },
});

assert.deepEqual(
  aliasContract.providers.configured,
  ['gemini', 'chatgpt', 'doubao', 'claude'],
);
assert.equal(aliasContract.summary.aiProviderConfiguredCount, 4);
assert.equal(aliasContract.summary.aiProviderEnabledCount, 4);

console.log('ai provider router runtime env tests passed');
