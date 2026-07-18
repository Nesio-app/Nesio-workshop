'use client';

/**
 * Lab · 文字语义搜索(自测)— multilingual-e5-small ONNX 全端上跑。
 *
 * 验证 B线端上文本嵌入管线:输入几条"记忆"(passage)+ 一句查询(query),端上算向量、
 * cosine 排序。跨语言(英文查询命中中文记忆)是重点。模型/词表从 /lab/models/ 自动载入
 * (跑 scripts/fetch_web_models.sh 先下到 public/)。文本与向量不出设备。
 */
import { useEffect, useState, useCallback } from 'react';

import { ensureTextEmbedReady, embedTexts, textEmbedStatus } from '@/lib/portal/semantic-search/text-embed';

const DEFAULT_DOCS = [
  '昨晚把车钥匙放在厨房台面上了',
  '护照和身份证都收在书房抽屉第二层',
  '上次感冒买的头孢还剩半盒在冰箱门上',
  'bought Linda a scarf for her birthday last year',
  '停在 P3 停车场 B 区 47 号',
].join('\n');

function cosine(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

export default function TextSearchLab() {
  const [status, setStatus] = useState('启动中…');
  const [ready, setReady] = useState(false);
  const [docs, setDocs] = useState(DEFAULT_DOCS);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Array<{ text: string; score: number }>>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      setStatus('载入模型 + 词表(约 235MB,首次稍候)…');
      const ok = await ensureTextEmbedReady();
      setReady(ok);
      setStatus(ok ? `✓ 引擎就绪(${textEmbedStatus()})` : '✗ 模型不可用:先跑 scripts/fetch_web_models.sh');
    })();
  }, []);

  const onSearch = useCallback(async () => {
    const q = query.trim();
    const lines = docs.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!q || !lines.length || !ready) return;
    setBusy(true);
    const t0 = performance.now();
    // 一次算:第 0 条是查询(query:),其余是文档(passage:)
    const vecs = await embedTexts([q, ...lines], 1);
    setBusy(false);
    if (!vecs) { setStatus('✗ 嵌入失败'); return; }
    const qv = vecs[0];
    const scored = lines
      .map((text, i) => ({ text, score: cosine(qv, vecs[i + 1]) }))
      .sort((a, b) => b.score - a.score);
    setHits(scored);
    setStatus(`「${q}」→ ${lines.length} 条排序,${(performance.now() - t0).toFixed(0)}ms`);
  }, [query, docs, ready]);

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 16, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Lab · 文字语义搜索</h1>
      <p style={{ color: 'var(--portal-muted)', fontSize: 13 }}>
        multilingual-e5-small · 全端上推理 · 跨语言 · 文本与向量不出设备 · {status}
      </p>

      <label style={{ fontSize: 13, fontWeight: 600 }}>记忆(每行一条,当作 passage)</label>
      <textarea
        value={docs}
        onChange={(e) => setDocs(e.target.value)}
        rows={6}
        style={{ width: '100%', margin: '6px 0 12px', padding: 8, fontFamily: 'inherit', fontSize: 13 }}
      />

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSearch(); }}
          placeholder='试试 "where are my keys" / "passport" / "生日礼物"(跨语言)'
          style={{ flex: 1, padding: 10, fontSize: 15 }}
        />
        <button type="button" onClick={onSearch} disabled={!ready || busy} style={{ padding: '10px 18px' }}>
          {busy ? '…' : '搜'}
        </button>
      </div>

      <ol style={{ marginTop: 16, paddingLeft: 20 }}>
        {hits.map((h) => (
          <li key={h.text} style={{ margin: '6px 0', fontSize: 14 }}>
            <span style={{ color: 'var(--portal-muted)', fontVariantNumeric: 'tabular-nums' }}>{h.score.toFixed(3)}</span>{' '}
            {h.text}
          </li>
        ))}
      </ol>
    </main>
  );
}
