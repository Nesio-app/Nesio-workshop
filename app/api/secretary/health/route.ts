import { NextRequest, NextResponse } from 'next/server';
import {
  isLaunchIsolationDisabled,
  isProductionActivationAiRuntimeEnabled,
  isLiveRuntimeAiEnabled,
  isSecretaryAiRequestAllowed,
  launchUnavailablePayload,
} from '@/lib/portal/launch-safety';
import { labelForSecretaryModel } from '@/lib/portal/secretary-ai-prompt-catalog.mjs';

function getGoogleKey(): string | undefined {
  const raw =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY;
  return raw?.trim() || undefined;
}

function getDoubaoKey(): string | undefined {
  const raw =
    process.env.DOUBAO_KEY ||
    process.env.DOUBAO_API_KEY ||
    process.env.ARK_API_KEY ||
    process.env.VOLCENGINE_API_KEY;
  return raw?.trim() || undefined;
}

function getOpenAIKey(): string | undefined {
  const raw = process.env.OpenAI_KEY || process.env.OPENAI_API_KEY;
  return raw?.trim() || undefined;
}

function getAnthropicKey(): string | undefined {
  const raw = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  return raw?.trim() || undefined;
}

function buildProviderMatrix(configured: {
  gemini: boolean;
  doubao: boolean;
  chatgpt: boolean;
  claude: boolean;
}) {
  return [
    {
      provider: 'gemini',
      label: labelForSecretaryModel('gemini'),
      nativeConfigured: configured.gemini,
      fallbackProvider: null,
      runtimeAvailable: configured.gemini,
      chatEndpoint: '/api/secretary/chat',
      model: configured.gemini ? (process.env.GEMINI_MODEL || 'gemini-default') : null,
    },
    {
      provider: 'chatgpt',
      label: labelForSecretaryModel('chatgpt'),
      nativeConfigured: configured.chatgpt,
      fallbackProvider: configured.chatgpt ? null : (configured.gemini ? 'gemini' : null),
      runtimeAvailable: configured.chatgpt || configured.gemini,
      chatEndpoint: '/api/secretary/chat',
      model: configured.chatgpt ? (process.env.OPENAI_MODEL || 'gpt-4o-mini') : null,
    },
    {
      provider: 'claude',
      label: labelForSecretaryModel('claude'),
      nativeConfigured: configured.claude,
      fallbackProvider: configured.claude ? null : (configured.gemini ? 'gemini' : null),
      runtimeAvailable: configured.claude || configured.gemini,
      chatEndpoint: '/api/secretary/chat',
      model: configured.claude ? (process.env.CLAUDE_MODEL || process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest') : null,
    },
    {
      provider: 'doubao',
      label: labelForSecretaryModel('doubao'),
      nativeConfigured: configured.doubao,
      fallbackProvider: configured.doubao ? null : (configured.gemini ? 'gemini' : null),
      runtimeAvailable: configured.doubao || configured.gemini,
      chatEndpoint: '/api/secretary/chat',
      model: configured.doubao ? (process.env.DOUBAO_MODEL || process.env.DOUBAO_ENDPOINT || 'doubao-pro-32k') : null,
    },
  ];
}

export async function GET(req: NextRequest) {
  const gemini = Boolean(getGoogleKey());
  const doubao = Boolean(getDoubaoKey());
  const chatgpt = Boolean(getOpenAIKey());
  const claude = Boolean(getAnthropicKey());
  const allowed = isSecretaryAiRequestAllowed(req);
  const configuredProviders = {
    gemini,
    doubao,
    chatgpt,
    claude,
  };
  const providerMatrix = buildProviderMatrix(configuredProviders);
  const defaultProvider = gemini ? 'gemini' : chatgpt ? 'chatgpt' : claude ? 'claude' : doubao ? 'doubao' : null;
  const productionActivation = {
    aiProviderMode: process.env.BAOHE_AI_PROVIDER_MODE || 'disabled',
    launchIsolationDisabled: isLaunchIsolationDisabled(),
    liveRuntimeEnabled: isLiveRuntimeAiEnabled(),
    aiRuntimeEnabled: isProductionActivationAiRuntimeEnabled(),
    configuredProviders,
    defaultProvider,
    chatEndpoint: '/api/secretary/chat',
  };

  if (allowed) {
    return NextResponse.json(
      {
        ok: true,
        service: 'secretary',
        status: 'ready',
        behaviorEnabled: true,
        gemini,
        doubao,
        chatgpt,
        claude,
        model: gemini ? (process.env.GEMINI_MODEL || 'gemini-default') : null,
        doubaoModel: doubao ? (process.env.DOUBAO_MODEL || process.env.DOUBAO_ENDPOINT || 'doubao-pro-32k') : null,
        openaiModel: chatgpt ? (process.env.OPENAI_MODEL || 'gpt-4o-mini') : null,
        claudeModel: claude ? (process.env.CLAUDE_MODEL || process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest') : null,
        defaultProvider,
        chatEndpoint: '/api/secretary/chat',
        providerMatrix,
        productionActivation,
      },
      {
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
      },
    );
  }

  return NextResponse.json(
    {
      ...launchUnavailablePayload('api:secretary:health', 'secretary'),
      service: 'secretary',
      gemini,
      doubao,
      chatgpt,
      claude,
      model: null,
      doubaoModel: null,
      openaiModel: null,
      claudeModel: null,
      defaultProvider,
      chatEndpoint: '/api/secretary/chat',
      providerMatrix,
      productionActivation,
    },
    {
      status: 403,
      headers: { 'Access-Control-Allow-Origin': '*' },
    }
  );
}
