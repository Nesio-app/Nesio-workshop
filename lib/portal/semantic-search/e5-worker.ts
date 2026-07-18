/**
 * e5 文本嵌入 Worker — onnxruntime-web(WASM,WebGPU 可选)。
 *
 * 协议(postMessage):
 *   init      { type, model: ArrayBuffer, tokenizer: E5TokenizerData } → { type:'ready', backend } | { type:'error', message }
 *   embedText { type, id, text: string } → { type:'embedding', id, emb: Float32Array }  (384 维,L2 归一化)
 *
 * 前缀(query:/passage:)由调用方在 text 里贴好;模型图内已含掩码均值池化 + L2 归一化。
 */
import * as ort from 'onnxruntime-web';

import { E5Tokenizer, type E5TokenizerData } from './e5-tokenizer';

// 同 clip-worker:wasm 自托管 /ort/(CSP connect-src 'self');无跨源隔离 → 单线程稳过。
ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = 1;

let session: ort.InferenceSession | null = null;
let tok: E5Tokenizer | null = null;

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

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      const [s, backend] = await createSession(msg.model);
      session = s;
      tok = new E5Tokenizer(msg.tokenizer as E5TokenizerData);
      self.postMessage({ type: 'ready', backend });
      return;
    }
    if (msg.type === 'embedText') {
      const ids = tok!.encode(msg.text);
      const n = ids.length;
      const inputIds = BigInt64Array.from(ids, (v) => BigInt(v));
      const mask = new BigInt64Array(n).fill(BigInt(1));
      const out = await session!.run({
        input_ids: new ort.Tensor('int64', inputIds, [1, n]),
        attention_mask: new ort.Tensor('int64', mask, [1, n]),
      });
      const emb = normalize(out.embedding.data as Float32Array);
      self.postMessage({ type: 'embedding', id: msg.id, emb }, { transfer: [emb.buffer] });
      return;
    }
  } catch (e) {
    self.postMessage({ type: 'error', id: msg?.id, message: String(e) });
  }
};
