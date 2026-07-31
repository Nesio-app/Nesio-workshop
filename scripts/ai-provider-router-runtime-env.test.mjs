import assert from 'node:assert/strict';
import { buildAiProviderRouterContract } from '../lib/portal/contracts/ai-provider-router-contract.mjs';

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
assert.equal(geminiContract.runtimeAiReadiness.providers.gemini.startEndpoint, '/api/portal/chat');
// #8:契约必须报告真实回退链(与 ai-complete 同源)。批次 45 补 openai 第三层
// (analyze 早有、chat/completeText 曾缺 —— 「图片识别能用、问一问不行」的根因)。
// 2026-07-31 用户定案:「AI 调用用 Kimi 的 API,然后 google 托底」——
// kimi 进链首、gemini 紧随其后就是那两级;claude/openai 留在后面,配了 key 才走。
assert.deepEqual([...geminiContract.runtimeAiReadiness.routing.completionChain], ['kimi', 'gemini', 'claude', 'openai']);
// 前两位是用户明确定的**主 + 托底**,顺序不许被后来的人调换。
assert.equal(geminiContract.runtimeAiReadiness.routing.completionChain[0], 'kimi', 'Kimi 必须是首选');
assert.equal(geminiContract.runtimeAiReadiness.routing.completionChain[1], 'gemini', 'Google 必须是托底的那一层');
assert.equal(geminiContract.runtimeAiReadiness.routing.geminiModelFallbacks.length >= 2, true);
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
