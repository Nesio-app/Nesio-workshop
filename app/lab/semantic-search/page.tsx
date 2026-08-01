'use client';

/**
 * Lab · 语义相册搜索(自测用)— MobileCLIP2-S0 ONNX 全端上跑。
 *
 * - 模型两条路:① 跑 scripts/fetch_web_models.sh 把 fp16 双塔从 nesio-ml Release 拉到
 *   public/lab/models/,开机自动载入 IndexedDB;② 或手动把 ImageEncoder.fp16.onnx /
 *   TextEncoder.fp16.onnx 拖进来。两者都只入本机 IDB,首次之后离线可用。
 * - 照片与向量全留本机(红线);tokenizer 移植正确性由黄金用例开机自检。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { ClipBpe, type GoldenCase, type TokenizerData } from '@/lib/portal/semantic-search/clip-bpe';
import {
  clearIndex, getAllIndex, getModel, listBaoheImages, putIndexEntry, putModel,
  type IndexEntry,
} from '@/lib/portal/semantic-search/ml-store';

type Hit = IndexEntry & { score: number };

/**
 * 开机若 IDB 无模型,试从同源 public/lab/models/ 自动载入(fetch_web_models.sh 已拉则命中)。
 * 私库 Release 浏览器不能直连,故走同源静态文件这一步。没放模型时静默返回 false(回退拖入);
 * 放了但载入出错则显式报错(设计红线:异步动作必须有可见失败态),让用户改用拖入。
 */
async function tryLoadBundledModels(say: (s: string) => void): Promise<boolean> {
  const urls: Record<'image' | 'text', string> = {
    image: '/lab/models/ImageEncoder.fp16.onnx',
    text: '/lab/models/TextEncoder.fp16.onnx',
  };
  // HEAD 探测:没放模型(404)就静默回退,别把 404 页面当模型
  try {
    const head = await Promise.all([
      fetch(urls.image, { method: 'HEAD' }),
      fetch(urls.text, { method: 'HEAD' }),
    ]);
    if (!head[0].ok || !head[1].ok) return false;
  } catch {
    return false;
  }
  try {
    say('· 发现本机模型包,正在载入 IndexedDB(约 150MB,首次稍候)…');
    for (const key of ['image', 'text'] as const) {
      const res = await fetch(urls[key]);
      if (!res.ok) throw new Error(`${urls[key]} HTTP ${res.status}`);
      const blob = await res.blob();
      // 防呆:onnx 权重应为二进制且够大,别把 HTML 兜底页/半截文件存进去
      if (blob.type.includes('html') || blob.size < 1_000_000) {
        throw new Error(`${urls[key]} 不像模型(${blob.type || '未知类型'}, ${blob.size}B)`);
      }
      await putModel(key, blob);
    }
    const [img, txt] = await Promise.all([getModel('image'), getModel('text')]);
    if (img && txt) { say('✓ 模型已载入本机(IndexedDB),之后离线可用'); return true; }
    throw new Error('写入 IndexedDB 后读回为空');
  } catch (e) {
    say(`✗ 自动载入模型失败:${e instanceof Error ? e.message : String(e)} —— 可改用下面的拖入`);
    return false;
  }
}

export default function SemanticSearchLab() {
  const [log, setLog] = useState<string[]>([]);
  const [modelsReady, setModelsReady] = useState(false);
  const [workerReady, setWorkerReady] = useState(false);
  const [tokOk, setTokOk] = useState<boolean | null>(null);
  const [indexCount, setIndexCount] = useState(0);
  const [busy, setBusy] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const tokenizerRef = useRef<TokenizerData | null>(null);
  const pending = useRef(new Map<string, (emb: Float32Array) => void>());

  const say = useCallback((s: string) => setLog((l) => [...l.slice(-80), s]), []);

  // 开机:tokenizer 自检 + 检查模型是否已在 IDB
  useEffect(() => {
    (async () => {
      try {
        const [tok, golden] = await Promise.all([
          fetch('/lab/tokenizer.json').then((r) => r.json() as Promise<TokenizerData>),
          fetch('/lab/tokenizer-golden.json').then((r) => r.json() as Promise<GoldenCase[]>),
        ]);
        tokenizerRef.current = tok;
        const bad = new ClipBpe(tok).selfTest(golden);
        setTokOk(bad.length === 0);
        say(bad.length === 0 ? `✓ tokenizer 自检通过(${golden.length} 条黄金用例)` : `✗ tokenizer 对拍失败:${bad.join('; ')}`);
      } catch (e) {
        setTokOk(false);
        say(`✗ tokenizer 加载失败:${e}`);
      }
      const [img, txt] = await Promise.all([getModel('image'), getModel('text')]);
      if (img && txt) { setModelsReady(true); say('✓ 模型已在本机(IndexedDB)'); }
      else if (await tryLoadBundledModels(say)) { setModelsReady(true); }
      else say('· 还没有模型:跑 scripts/fetch_web_models.sh 拉取,或把 ImageEncoder*.onnx / TextEncoder*.onnx 拖进下面的选择框');
      setIndexCount((await getAllIndex()).length);
    })();
  }, [say]);

  // 模型就绪 → 起 worker
  useEffect(() => {
    if (!modelsReady || !tokOk || workerRef.current) return;
    (async () => {
      const [img, txt] = await Promise.all([getModel('image'), getModel('text')]);
      if (!img || !txt || !tokenizerRef.current) return;
      const w = new Worker(new URL('../../../lib/portal/semantic-search/clip-worker.ts', import.meta.url));
      w.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === 'ready') { setWorkerReady(true); say(`✓ 推理引擎就绪(${m.backend})`); }
        else if (m.type === 'embedding') { pending.current.get(m.id)?.(m.emb); pending.current.delete(m.id); }
        else if (m.type === 'error') { say(`✗ ${m.message}`); pending.current.delete(m.id); }
      };
      const [imgBuf, txtBuf] = await Promise.all([img.arrayBuffer(), txt.arrayBuffer()]);
      w.postMessage({ type: 'init', imageModel: imgBuf, textModel: txtBuf, tokenizer: tokenizerRef.current, inputSize: 256 },
        [imgBuf, txtBuf]);
      workerRef.current = w;
    })();
  }, [modelsReady, tokOk, say]);

  const embed = useCallback((msg: Record<string, unknown>, transfer: Transferable[] = []) => {
    return new Promise<Float32Array>((resolve) => {
      const id = `${Date.now()}-${Math.random()}`;
      pending.current.set(id, resolve);
      workerRef.current!.postMessage({ ...msg, id }, transfer);
    });
  }, []);

  async function onModelFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      const n = f.name.toLowerCase();
      if (n.includes('image')) { await putModel('image', f); say(`✓ 收到图像塔:${f.name}(${(f.size / 1e6).toFixed(0)}MB)`); }
      else if (n.includes('text')) { await putModel('text', f); say(`✓ 收到文本塔:${f.name}(${(f.size / 1e6).toFixed(0)}MB)`); }
      else say(`? 认不出 ${f.name}(文件名要含 Image/Text)`);
    }
    const [img, txt] = await Promise.all([getModel('image'), getModel('text')]);
    if (img && txt) setModelsReady(true);
  }

  async function indexImages(items: { id: string; label: string; blob: Blob; thumb: string; source: 'baohe' | 'file' }[]) {
    let done = 0;
    for (const it of items) {
      try {
        const bitmap = await createImageBitmap(it.blob);
        const emb = await embed({ type: 'embedImage', bitmap }, [bitmap]);
        await putIndexEntry({ id: it.id, label: it.label, thumb: it.thumb, emb, source: it.source });
        done += 1;
        setBusy(`索引中 ${done}/${items.length}`);
      } catch (e) {
        say(`✗ ${it.label}:${e}`);
      }
    }
    setIndexCount((await getAllIndex()).length);
    setBusy('');
    say(`✓ 本轮索引 ${done} 张`);
  }

  async function onIndexBaohe() {
    setBusy('读取宝盒照片…');
    const imgs = await listBaoheImages();
    if (!imgs.length) { say('· 宝盒照片库是空的(nesio-images)'); setBusy(''); return; }
    const existing = new Set((await getAllIndex()).map((e) => e.id));
    const todo = imgs.filter((x) => !existing.has(x.id));
    say(`宝盒共 ${imgs.length} 张,新增待索引 ${todo.length} 张`);
    await indexImages(await Promise.all(todo.map(async (x) => ({
      id: x.id, label: x.id, source: 'baohe' as const, thumb: x.dataUrl,
      blob: await fetch(x.dataUrl).then((r) => r.blob()),
    }))));
  }

  async function onIndexFiles(files: FileList | null) {
    if (!files?.length) return;
    const items = await Promise.all(Array.from(files).map(async (f) => {
      const bitmap = await createImageBitmap(f);
      const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bitmap.width * scale);
      c.height = Math.round(bitmap.height * scale);
      c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
      bitmap.close();
      return { id: `${f.name}#${f.size}`, label: f.name, blob: f as Blob, thumb: c.toDataURL('image/jpeg', 0.7), source: 'file' as const };
    }));
    await indexImages(items);
  }

  async function onSearch() {
    if (!query.trim() || !workerReady) return;
    const t0 = performance.now();
    const q = await embed({ type: 'embedText', text: query });
    const all = await getAllIndex();
    const scored = all.map((e) => {
      let s = 0;
      for (let i = 0; i < q.length; i++) s += q[i] * e.emb[i];
      return { ...e, score: s };
    }).sort((a, b) => b.score - a.score).slice(0, 12);
    setHits(scored);
    say(`「${query}」→ ${all.length} 张里取 top-${scored.length},${(performance.now() - t0).toFixed(0)}ms`);
  }

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 16, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Lab · 语义相册搜索</h1>
      <p style={{ color: 'var(--portal-muted)', fontSize: 13 }}>
        MobileCLIP2-S0 · 全端上推理 · 照片与向量不出设备 ·
        {tokOk === null ? ' tokenizer 自检中…' : tokOk ? ' tokenizer ✓' : ' tokenizer ✗'}
        {workerReady ? ' · 引擎 ✓' : modelsReady ? ' · 引擎启动中…' : ''}
      </p>

      {!modelsReady && (
        <section style={{ border: '2px dashed var(--portal-line)', borderRadius: 12, padding: 16, margin: '12px 0' }}>
          <b>第一步:导入模型(一次即可)</b>
          <p style={{ fontSize: 13, color: 'var(--portal-muted)' }}>
            推荐:跑 <code>scripts/fetch_web_models.sh</code> 从 nesio-ml Release 拉到 <code>public/lab/models/</code>,刷新即自动载入。
            或手动选择 <code>ImageEncoder.fp16.onnx</code> 和 <code>TextEncoder.fp16.onnx</code>(共约 150MB,存入本机后离线可用)。
          </p>
          <input type="file" accept=".onnx" multiple onChange={(e) => onModelFiles(e.target.files)} />
        </section>
      )}

      {workerReady && (
        <>
          <section style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={onIndexBaohe} disabled={!!busy} style={btn}>索引宝盒照片</button>
            <label style={btn}>
              选本地图片…
              <input type="file" accept="image/*" multiple className="nesio-visually-hidden" onChange={(e) => onIndexFiles(e.target.files)} />
            </label>
            <button onClick={async () => { await clearIndex(); setIndexCount(0); setHits([]); say('已清空索引'); }} style={btn}>清空索引</button>
            <span style={{ fontSize: 13, color: 'var(--portal-muted)' }}>{busy || `已索引 ${indexCount} 张`}</span>
          </section>

          <section style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSearch()}
              placeholder='试试 "black charger cable" / "passport"(英文效果好)'
              style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--portal-line)', borderRadius: 8 }}
            />
            <button onClick={onSearch} disabled={!indexCount} style={{ ...btn, background: 'var(--portal-ink)', color: 'var(--portal-bg)' }}>搜</button>
          </section>

          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {hits.map((h) => (
              <figure key={h.id} style={{ margin: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={h.thumb} alt={h.label} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10 }} />
                <figcaption style={{ fontSize: 11, color: 'var(--portal-muted)' }}>{h.score.toFixed(3)} · {h.label.slice(0, 24)}</figcaption>
              </figure>
            ))}
          </section>
        </>
      )}

      <details style={{ marginTop: 16 }}>
        <summary style={{ fontSize: 13, color: 'var(--portal-muted)', cursor: 'pointer' }}>日志</summary>
        <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: 'var(--portal-muted)' }}>{log.join('\n')}</pre>
      </details>
    </main>
  );
}

const btn: React.CSSProperties = {
  padding: '8px 14px', border: '1px solid var(--portal-line)', borderRadius: 8, background: '#fafafa',
  fontSize: 14, cursor: 'pointer',
};
