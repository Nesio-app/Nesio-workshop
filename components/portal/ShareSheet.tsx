'use client';

/**
 * 上传 — bottom sheet that:
 * 1. Accepts paste or file upload
 * 2. Extracts text from PDF/doc/email
 * 3. POSTs to /api/portal/analyze for structured extraction
 * 4. Shows parsed result (people, dates, places, commitments)
 * 5. Saves to Life Graph on confirm
 */

import { useEffect, useRef, useState } from 'react';
import { addLifeNode } from '@/lib/portal/life-graph';

interface ShareSheetProps { open: boolean; onClose: () => void; }

interface ParsedResult {
  title: string;
  summary: string;
  intent: string;
  people: string[];
  date?: string;
  location?: string;
  nodes: Array<{ type: string; name: string; attributes: Record<string, string>; relations: unknown[]; tags: string[]; confidence: number; rawInput?: string }>;
}

export default function ShareSheet({ open, onClose }: ShareSheetProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) { setParsed(null); setSaved(false); setAnalyzing(false); setTextMode(false); setTextInput(''); setError(''); }
  }, [open]);

  function buildPendingImageParsed(fileName: string): ParsedResult {
    return {
      title: '图片线索待确认',
      summary: '已先整理为一条图片线索。登录或 Lab 模式后，Nesio 会自动识别图中物品、人物和场景。',
      intent: 'MEMORY_CAPTURE',
      people: [],
      nodes: [
        {
          type: 'object',
          name: '图片线索待确认',
          attributes: {
            status: '待确认',
            originalFileName: fileName,
            note: '这张图片已保存为待确认线索。',
          },
          relations: [],
          tags: ['图片', '待确认'],
          confidence: 0.45,
          rawInput: fileName,
        },
      ],
    };
  }

  async function analyze(type: 'text' | 'file' | 'image', content: string, imageBase64?: string, mimeType?: string): Promise<boolean> {
    setAnalyzing(true); setError('');
    try {
      const res = await fetch('/api/portal/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, content, imageBase64, mimeType }),
      });
      const data = await res.json() as { ok?: boolean; nodes?: ParsedResult['nodes']; summary?: string; intent?: string; error?: string };

      if (!data.ok) throw new Error(data.error || 'analysis_failed');

      const nodes = data.nodes || [];
      // Extract people, dates, locations from node attributes
      const people: string[] = [];
      let date: string | undefined;
      let location: string | undefined;

      nodes.forEach((n) => {
        if (n.type === 'person') people.push(n.name);
        if (n.attributes?.date && !date) date = String(n.attributes.date);
        if (n.attributes?.location && !location) location = String(n.attributes.location);
        if (n.attributes?.people) people.push(...String(n.attributes.people).split(',').map((p) => p.trim()).filter(Boolean));
      });

      setParsed({
        title: nodes[0]?.name || content.slice(0, 30),
        summary: data.summary || '提取成功',
        intent: data.intent || 'MEMORY_CAPTURE',
        people: Array.from(new Set(people)),
        date,
        location,
        nodes,
      });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '分析失败，请稍后再试。');
      return false;
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleFile() { fileRef.current?.click(); }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1];
        const ok = await analyze('image', '请根据这张图片里真实可见的内容，整理出可确认的 Memory 线索。', base64, file.type);
        if (!ok) {
          setError('');
          setParsed(buildPendingImageParsed(file.name));
        }
      };
      reader.readAsDataURL(file);
    } else {
      try {
        const text = await file.text();
        await analyze('text', `文件：${file.name}\n\n${text.slice(0, 4000)}`);
      } catch {
        await analyze('text', `文件：${file.name}`);
      }
    }
    e.target.value = '';
  }

  async function handleTextSubmit() {
    const t = textInput.trim();
    if (!t) return;
    await analyze('text', t);
    setTextMode(false);
  }

  function saveToMemory() {
    if (!parsed) return;
    parsed.nodes.forEach((node) => {
      addLifeNode({
        ...node,
        source: node.attributes?.originalFileName ? 'photo' : 'manual',
      } as Parameters<typeof addLifeNode>[0]);
    });
    setSaved(true);
    setTimeout(() => { onClose(); setSaved(false); setParsed(null); }, 1100);
  }

  if (!open) return null;

  return (
    <div className="nesio-share-overlay" role="dialog" aria-modal="true" aria-label="上传">
      <div className="nesio-share-backdrop" onClick={onClose} />
      <div className="nesio-share-card">
        <div className="nesio-sheet-handle" aria-hidden />

        <div className="nesio-share-header">
          <h2 className="nesio-share-title">上传</h2>
          <button type="button" className="nesio-share-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        <p className="nesio-share-desc">
          你分享进来的内容，Nesio 会先整理出可确认的信息，再由你决定是否存入 Memory。
        </p>

        {/* Action buttons */}
        {!parsed && !analyzing && (
          <div className="nesio-share-actions">
            <button type="button" className="nesio-share-action-btn" onClick={handleFile}>
              <span className="nesio-share-action-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
                </svg>
              </span>
              <span>上传文件</span>
            </button>
            <button type="button" className="nesio-share-action-btn" onClick={() => setTextMode(true)}>
              <span className="nesio-share-action-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                  <path d="M4 5h16M4 12h16M4 19h10"/>
                </svg>
              </span>
              <span>粘贴文字/链接</span>
            </button>
          </div>
        )}

        <input ref={fileRef} type="file" accept="image/*,.pdf,.txt,.eml,.docx,.md" style={{ display: 'none' }} onChange={handleFileChange} />

        {/* Text paste mode */}
        {textMode && !parsed && (
          <div>
            <textarea
              className="nesio-ob-input"
              style={{ resize: 'vertical', minHeight: '5rem', borderRadius: '0.85rem', width: '100%', fontFamily: 'inherit' }}
              placeholder="粘贴邮件正文、链接、笔记内容…"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="nesio-ob-primary-btn" style={{ flex: 1 }} onClick={handleTextSubmit} disabled={!textInput.trim()}>
                提取信息
              </button>
              <button type="button" className="nesio-today-btn nesio-today-btn--ghost" style={{ flex: 1 }} onClick={() => { setTextMode(false); setTextInput(''); }}>
                取消
              </button>
            </div>
          </div>
        )}

        {/* Analyzing */}
        {analyzing && (
          <div style={{ textAlign: 'center', padding: '1.5rem 0', color: 'var(--portal-muted)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <span className="nesio-camera-recognizing-dot" style={{ background: 'var(--portal-blue-deep)', display: 'inline-block', width: '0.5rem', height: '0.5rem', borderRadius: '50%' }} />
            Nesio 正在整理可确认的信息…
          </div>
        )}

        {/* Error */}
        {error && <p className="nesio-ob-error">{error}</p>}

        {/* Parsed result */}
        {parsed && (
          <div className="nesio-share-recent">
            <p className="nesio-share-recent-label">刚刚分享进来</p>
            <div className="nesio-share-parsed-card">
              <span className="nesio-share-parsed-icon">
                {{ MEMORY_CAPTURE: '📦', EVENT_LOG: '📅', COMMITMENT: '🤝', HEALTH_LOG: '🩷', REMINDER: '⏰' }[parsed.intent] || '📋'}
              </span>
              <div className="nesio-share-parsed-body">
                <p className="nesio-share-parsed-title">{parsed.title}</p>
                <p className="nesio-share-parsed-source">{parsed.summary}</p>
                <div className="nesio-share-parsed-meta">
                  {parsed.people.map((p) => (
                    <span key={p} className="nesio-share-meta-chip">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                      {p}
                    </span>
                  ))}
                  {parsed.date && (
                    <span className="nesio-share-meta-chip">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                      {parsed.date}
                    </span>
                  )}
                  {parsed.location && (
                    <span className="nesio-share-meta-chip">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      {parsed.location}
                    </span>
                  )}
                  <span className="nesio-share-meta-chip" style={{ background: 'rgba(16,185,129,0.1)', color: '#059669' }}>
                    {parsed.nodes.length} 个节点
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="nesio-share-save-btn" onClick={saveToMemory} style={{ flex: 1 }}>
                {saved ? '✓ 已存入 Memory' : '存入 Memory'}
              </button>
              <button type="button" className="nesio-today-btn nesio-today-btn--ghost" style={{ flex: 1, borderRadius: '999px' }}
                onClick={() => { setParsed(null); setTextMode(false); }}>
                重新上传
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
