import { resolveAiKey } from '@/lib/portal/ai-keys';

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-004';
const DEFAULT_DIMENSIONS = 768;

export type SignalEmbeddingResult = {
  ok: boolean;
  values?: number[];
  model?: string;
  dimension?: number;
  error?: string;
};

function envFlag(name: string): boolean {
  return (process.env[name] || '').trim().toLowerCase() === 'true';
}

export function signalEmbeddingsEnabled(): boolean {
  return envFlag('SIGNAL_EMBEDDINGS_ENABLED') && Boolean(resolveAiKey('gemini'));
}

export function signalVectorSearchEnabled(): boolean {
  return signalEmbeddingsEnabled() && envFlag('SIGNAL_VECTOR_SEARCH_ENABLED');
}

export function signalEmbeddingModel(): string {
  return (process.env.SIGNAL_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL).trim() || DEFAULT_EMBEDDING_MODEL;
}

export function normalizeEmbeddingText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 8000);
}

/**
 * Core embedding call — no feature-flag gate, only needs the API key.
 * Used directly by search re-ranking; cloud signal writes go through
 * embedSignalText which additionally honors SIGNAL_EMBEDDINGS_ENABLED.
 */
export async function embedTextRaw(text: string): Promise<SignalEmbeddingResult> {
  const normalized = normalizeEmbeddingText(text);
  if (!normalized) return { ok: false, error: 'empty_embedding_text' };
  const apiKey = resolveAiKey('gemini');
  if (!apiKey) return { ok: false, error: 'embedding_key_missing' };

  const model = signalEmbeddingModel();
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: `models/${model}`,
          content: { parts: [{ text: normalized }] },
          outputDimensionality: DEFAULT_DIMENSIONS,
        }),
        cache: 'no-store',
      },
    );
    if (!response.ok) return { ok: false, error: `embedding_provider_${response.status}` };
    const data = await response.json() as { embedding?: { values?: unknown } };
    const values = Array.isArray(data.embedding?.values)
      ? data.embedding.values.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry))
      : [];
    if (values.length !== DEFAULT_DIMENSIONS) {
      return { ok: false, error: `embedding_dimension_${values.length}` };
    }
    return { ok: true, values, model, dimension: values.length };
  } catch {
    return { ok: false, error: 'embedding_provider_unreachable' };
  }
}

/** Cloud-signal embedding — feature-flag gated (SIGNAL_EMBEDDINGS_ENABLED). */
export async function embedSignalText(text: string): Promise<SignalEmbeddingResult> {
  if (!signalEmbeddingsEnabled()) {
    return { ok: false, error: 'signal_embeddings_disabled' };
  }
  return embedTextRaw(text);
}
