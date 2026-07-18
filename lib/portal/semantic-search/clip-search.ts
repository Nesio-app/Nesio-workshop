/**
 * CLIP 照片语义搜索 · 可复用服务(从 Lab 页抽出,供产品「问念念/找东西」调用)。
 *
 * 单例:一个 worker + 一次模型/分词器加载,全应用共用。全程端上,照片与向量不出设备。
 * 模型来源:先看 IndexedDB(models),没有则从同源 /lab/models/*.fp16.onnx 自动拉进 IDB
 * (由 scripts/fetch_web_models.sh 事先下到 public/lab/models/)。拉不到则整体降级(返回空),
 * 调用方据 clipReady() 决定是否展示照片结果——不阻塞、不报错刷屏。
 *
 * 对外:
 *   ensureClipReady()          懒启动,返回是否可用(缓存 promise,重复调用不重复启动)
 *   searchPhotos(query, topK)  文本查询 → 端上向量 → 与已索引照片 cosine 排序 → top-K
 *   indexPhoto(entry)          给一张照片算向量入库(后台索引用)
 *   isPhotoIndexed(id)         该照片是否已索引(增量索引跳过用)
 *   clipStatus()               当前状态(供 UI 提示)
 */
import { type TokenizerData } from './clip-bpe';
import { getModel, putModel, getAllIndex, putIndexEntry, type IndexEntry } from './ml-store';

export interface PhotoHit extends IndexEntry {
  score: number;
}

type Status = 'idle' | 'loading' | 'ready' | 'unavailable';
let status: Status = 'idle';
export const clipStatus = (): Status => status;
export const clipReady = (): boolean => status === 'ready';

let worker: Worker | null = null;
let readyPromise: Promise<boolean> | null = null;
const pending = new Map<string, (emb: Float32Array | null) => void>();

const MODEL_URLS = {
  image: '/lab/models/ImageEncoder.fp16.onnx',
  text: '/lab/models/TextEncoder.fp16.onnx',
} as const;
const TOKENIZER_URL = '/lab/tokenizer.json';

/** 确保两塔模型在本机 IDB:没有就从同源 /lab/models/ 拉。返回是否齐备。 */
async function ensureModels(): Promise<boolean> {
  const [img0, txt0] = await Promise.all([getModel('image'), getModel('text')]);
  if (img0 && txt0) return true;
  // HEAD 探测:没放模型包(404)就直接算不可用,别把 404 页当模型
  try {
    const head = await Promise.all([
      fetch(MODEL_URLS.image, { method: 'HEAD' }),
      fetch(MODEL_URLS.text, { method: 'HEAD' }),
    ]);
    if (!head[0].ok || !head[1].ok) return false;
  } catch {
    return false;
  }
  for (const key of ['image', 'text'] as const) {
    if (await getModel(key)) continue;
    const res = await fetch(MODEL_URLS[key]);
    if (!res.ok) return false;
    const blob = await res.blob();
    if (blob.type.includes('html') || blob.size < 1_000_000) return false; // 防呆:别存 404 页/半截文件
    await putModel(key, blob);
  }
  const [img, txt] = await Promise.all([getModel('image'), getModel('text')]);
  return !!(img && txt);
}

async function loadTokenizer(): Promise<TokenizerData | null> {
  try {
    const res = await fetch(TOKENIZER_URL);
    if (!res.ok) return null;
    return (await res.json()) as TokenizerData;
  } catch {
    return null;
  }
}

/**
 * 懒启动:加载模型+分词器、起 worker、等 ready。任一步不成 → status='unavailable'、返回 false。
 * 缓存 promise:并发/重复调用只启动一次。
 */
export function ensureClipReady(): Promise<boolean> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
      status = 'unavailable';
      return false;
    }
    status = 'loading';
    try {
      const [hasModels, tokenizer] = await Promise.all([ensureModels(), loadTokenizer()]);
      if (!hasModels || !tokenizer) { status = 'unavailable'; return false; }
      // 分词器自检失败也继续(自检只是保险);真正拦截点是 worker init
      const [img, txt] = await Promise.all([getModel('image'), getModel('text')]);
      if (!img || !txt) { status = 'unavailable'; return false; }

      const w = new Worker(new URL('./clip-worker.ts', import.meta.url));
      const ready = new Promise<boolean>((resolve) => {
        w.onmessage = (ev: MessageEvent) => {
          const m = ev.data;
          if (m.type === 'ready') resolve(true);
          else if (m.type === 'embedding') { pending.get(m.id)?.(m.emb); pending.delete(m.id); }
          else if (m.type === 'error') {
            if (m.id) { pending.get(m.id)?.(null); pending.delete(m.id); }
            else resolve(false); // init 阶段的错
          }
        };
        w.onerror = () => resolve(false);
      });
      const [imgBuf, txtBuf] = await Promise.all([img.arrayBuffer(), txt.arrayBuffer()]);
      w.postMessage(
        { type: 'init', imageModel: imgBuf, textModel: txtBuf, tokenizer, inputSize: 256 },
        [imgBuf, txtBuf],
      );
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

function embed(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<Float32Array | null> {
  return new Promise((resolve) => {
    if (!worker) { resolve(null); return; }
    const id = `${Date.now()}-${Math.random()}`;
    pending.set(id, resolve);
    worker.postMessage({ ...msg, id }, transfer);
  });
}

/** 文本查询 → 端上向量 → 与已索引照片 cosine 排序 → top-K。未就绪/失败返回空数组。 */
export async function searchPhotos(query: string, topK = 12): Promise<PhotoHit[]> {
  if (!query.trim()) return [];
  if (!(await ensureClipReady())) return [];
  const q = await embed({ type: 'embedText', text: query });
  if (!q) return [];
  const all = await getAllIndex();
  return all
    .map((e) => {
      let s = 0;
      for (let i = 0; i < q.length && i < e.emb.length; i++) s += q[i] * e.emb[i];
      return { ...e, score: s };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** 给一张照片算向量入库(后台增量索引用)。返回是否成功。 */
export async function indexPhoto(entry: {
  id: string;
  label: string;
  thumb: string;
  bitmap: ImageBitmap;
  source: IndexEntry['source'];
}): Promise<boolean> {
  if (!(await ensureClipReady())) return false;
  const emb = await embed({ type: 'embedImage', bitmap: entry.bitmap }, [entry.bitmap]);
  if (!emb) return false;
  await putIndexEntry({ id: entry.id, label: entry.label, thumb: entry.thumb, emb, source: entry.source });
  return true;
}

/** 该照片是否已索引(增量索引跳过用)。 */
export async function isPhotoIndexed(id: string): Promise<boolean> {
  return (await getAllIndex()).some((e) => e.id === id);
}
