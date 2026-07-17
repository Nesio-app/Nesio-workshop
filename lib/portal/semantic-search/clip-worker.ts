/**
 * CLIP 推理 Worker — onnxruntime-web,WebGPU 优先、WASM 兜底。
 *
 * 协议(postMessage):
 *   init       { type, imageModel: ArrayBuffer, textModel: ArrayBuffer, tokenizer: TokenizerData, inputSize }
 *              → { type: 'ready', backend } | { type: 'error', message }
 *   embedImage { type, id, bitmap: ImageBitmap } → { type: 'embedding', id, emb: Float32Array }
 *   embedText  { type, id, text: string }        → { type: 'embedding', id, emb: Float32Array }
 */
import * as ort from 'onnxruntime-web';

import { ClipBpe, type TokenizerData } from './clip-bpe';

// wasm 运行时自托管在 /ort/(scripts/copy-ort-wasm.mjs 拷入):
// 本仓 CSP connect-src 'self',走 CDN 会被静默拦(Plaid 当年同款坑)
ort.env.wasm.wasmPaths = '/ort/';
// 无跨源隔离(dev/普通部署没设 COOP/COEP)→ 没有 SharedArrayBuffer →
// 多线程 wasm 会在推理时卡死。强制单线程走非线程代理路径,稳过。
ort.env.wasm.numThreads = 1;

let imgSession: ort.InferenceSession | null = null;
let txtSession: ort.InferenceSession | null = null;
let bpe: ClipBpe | null = null;
let inputSize = 256;

// backend 选择:URL 带 ?webgpu 时才试 WebGPU(某些浏览器会创建成功却在推理时挂,
// 真机验证过再默认开);否则 WASM——最稳、到处能跑
const WANT_WEBGPU = typeof location !== 'undefined' && location.search.includes('webgpu');

async function createSession(buf: ArrayBuffer): Promise<[ort.InferenceSession, string]> {
  if (WANT_WEBGPU) {
    try {
      const s = await ort.InferenceSession.create(buf, { executionProviders: ['webgpu'] });
      return [s, 'webgpu'];
    } catch { /* 落回 wasm */ }
  }
  const s = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
  return [s, 'wasm'];
}

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/** 中央方形裁剪 + 缩到 inputSize,0-1 CHW(对齐 Python 侧 Resize+CenterCrop)。 */
function imageToTensor(bitmap: ImageBitmap): ort.Tensor {
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const canvas = new OffscreenCanvas(inputSize, inputSize);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, inputSize, inputSize);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, inputSize, inputSize);
  const n = inputSize * inputSize;
  const f = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    f[i] = data[i * 4] / 255;
    f[n + i] = data[i * 4 + 1] / 255;
    f[2 * n + i] = data[i * 4 + 2] / 255;
  }
  return new ort.Tensor('float32', f, [1, 3, inputSize, inputSize]);
}

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      const [s1, b1] = await createSession(msg.imageModel);
      const [s2] = await createSession(msg.textModel);
      imgSession = s1;
      txtSession = s2;
      bpe = new ClipBpe(msg.tokenizer as TokenizerData);
      inputSize = msg.inputSize ?? 256;
      self.postMessage({ type: 'ready', backend: b1 });
      return;
    }
    if (msg.type === 'embedImage') {
      const out = await imgSession!.run({ image: imageToTensor(msg.bitmap) });
      const emb = normalize(out.embedding.data as Float32Array);
      self.postMessage({ type: 'embedding', id: msg.id, emb }, { transfer: [emb.buffer] });
      return;
    }
    if (msg.type === 'embedText') {
      const ids = bpe!.tokenize(msg.text);
      const out = await txtSession!.run({ input_ids: new ort.Tensor('int64', ids, [1, ids.length]) });
      const emb = normalize(out.embedding.data as Float32Array);
      self.postMessage({ type: 'embedding', id: msg.id, emb }, { transfer: [emb.buffer] });
      return;
    }
  } catch (e) {
    self.postMessage({ type: 'error', id: msg?.id, message: String(e) });
  }
};
