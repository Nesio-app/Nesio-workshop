import type { PortalLocale } from './profile';

export declare function labelForSecretaryModel(modelId: string): string;
export declare function buildSecretarySystemPrompt(locale: PortalLocale): string;
export declare function buildSecretaryPersonaPrompt(
  locale: PortalLocale,
  modelId: string,
  message: string,
): string;
