/**
 * 端上文本嵌入服务(multilingual-e5-small)· 可复用单例。
 *
 * 用来替换 semantic-rerank.ts 里的云端 /api/portal/embed:免费、离线、跨语言、私密。
 * 模型/词表先看 IDB,没有则从同源 /lab/models/ 拉(fetch_web_models.sh 事先下到 public/)。
 * 拉不到 → status='unavailable' 返回 null,调用方回退云端(semanticRerank 已 fail-open)。
 *
 * e5 前缀:查询贴 "query: "、文档贴 "passage: "(embedTexts 的 queryCount 指定前几条是查询)。
 * 模型图内已含掩码均值池化 + L2 归一化,worker 出来即单位向量。全程端上,文本与向量不出设备。
 */
import { getModel, putModel } from './ml-store';
import { type E5TokenizerData } from './e5-tokenizer';

export const TEXT_EMBED_MODEL = 'multilingual-e5-small-ondevice';
const MODEL_URL = '/lab/models/TextEmbedder.fp16.onnx';
const TOKENIZER_URL = '/lab/models/e5-tokenizer.json';
const MODEL_KEY = 'text-embed-model';
const TOK_KEY = 'text-embed-tokenizer';
const QUERY_PREFIX = 'query: ';
const PASSAGE_PREFIX = 'passage: ';

type Status = 'idle' | 'loading' | 'ready' | 'unavailable';
let status: Status = 'idle';
export const textEmbedStatus = (): Status => status;
export const textEmbedReady = (): boolean => status === 'ready';

let worker: Worker | null = null;
let readyPromise: Promise<boolean> | null = null;
const pending = new Map<string, (emb: Float32Array | null) => void>();

/** 确保一个大 blob 在 IDB(model 或 tokenizer);没有就从同源 URL 拉。返回 ArrayBuffer/文本。 */
async function ensureBlob(key: string, url: string, minSize: number): Promise<Blob | null> {
  const cached = await getModel(key);
  if (cached) return cached;
  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (!head.ok) return null;
  } catch {
    return null;
  }
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  if (blob.type.includes('html') || blob.size < minSize) return null; // 防呆:别存 404 页/半截
  await putModel(key, blob);
  return blob;
}

export function ensureTextEmbedReady(): Promise<boolean> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') { status = 'unavailable'; return false; }
    status = 'loading';
    try {
      const [modelBlob, tokBlob] = await Promise.all([
        ensureBlob(MODEL_KEY, MODEL_URL, 1_000_000),   // ~235MB
        ensureBlob(TOK_KEY, TOKENIZER_URL, 1_000_000),  // ~8.8MB
      ]);
      if (!modelBlob || !tokBlob) { status = 'unavailable'; return false; }
      const tokenizer = JSON.parse(await tokBlob.text()) as E5TokenizerData;
      const modelBuf = await modelBlob.arrayBuffer();

      const w = new Worker(new URL('./e5-worker.ts', import.meta.url));
      const ready = new Promise<boolean>((resolve) => {
        w.onmessage = (ev: MessageEvent) => {
          const m = ev.data;
          if (m.type === 'ready') resolve(true);
          else if (m.type === 'embedding') { pending.get(m.id)?.(m.emb); pending.delete(m.id); }
          else if (m.type === 'error') {
            if (m.id) { pending.get(m.id)?.(null); pending.delete(m.id); }
            else resolve(false);
          }
        };
        w.onerror = () => resolve(false);
      });
      w.postMessage({ type: 'init', model: modelBuf, tokenizer }, [modelBuf]);
      const ok = await ready;
      if (!ok) { status = 'unavailable'; w.terminate(); return false; }
      worker = w;
      status = 'ready';
      return true;
    } catch {
      status = 'unavailable';
      return false;
    }
  })();
  return readyPromise;
}

function embedOne(text: string): Promise<Float32Array | null> {
  return new Promise((resolve) => {
    if (!worker) { resolve(null); return; }
    const id = `${Date.now()}-${Math.random()}`;
    pending.set(id, resolve);
    worker.postMessage({ type: 'embedText', id, text });
  });
}

/**
 * 批量嵌入:前 queryCount 条贴 "query: "、其余贴 "passage: "。
 * 未就绪/任一失败 → 返回 null(调用方回退云端)。返回向量数组与输入等长。
 */
export async function embedTexts(texts: string[], queryCount = 0): Promise<Float32Array[] | null> {
  if (!texts.length) return [];
  // 非阻塞:semanticRerank 在答复主链路里跑,不能卡在 235MB 加载上。没就绪就后台起、这次回退
  // 云端;下次(通常几秒后)就走端上。云端本就常年 no_key/rate_limited → 很快自愈到端上。
  if (status !== 'ready') { void ensureTextEmbedReady(); return null; }
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    const prefixed = (i < queryCount ? QUERY_PREFIX : PASSAGE_PREFIX) + texts[i];
    const v = await embedOne(prefixed);
    if (!v) return null; // 中途失败:整批放弃,回退云端(别混用两种来源的向量)
    out.push(v);
  }
  return out;
}
