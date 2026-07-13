'use client';

/**
 * 分享 — bottom sheet that:
 * 1. Accepts paste or file upload
 * 2. Extracts text from PDF/doc/email
 * 3. POSTs to /api/portal/analyze for structured extraction
 * 4. Shows parsed result (people, dates, places, commitments)
 * 5. Saves to Life Graph on confirm
 */

import { useEffect, useRef, useState } from 'react';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { updateLifeNode, type LifeNodeAsset } from '@/lib/portal/life-graph';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { canUsePaidCloudAi, isPro } from '@/lib/portal/entitlement';
import { usePortalLocale } from './use-portal-locale';
import { NodeTypeIcon } from './icons';

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
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [error, setError] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open) { setParsed(null); setSaved(false); setAnalyzing(false); setTextMode(false); setTextInput(''); setError(''); setSourceFile(null); }
  }, [open]);

  function buildPendingImageParsed(): ParsedResult {
    // 批次 12:名称/摘要按保存时界面语言生成;tags/status 是数据层标记,维持中文
    return {
      title: L(dict, '照片已存好', 'Photo saved'),
      summary: L(dict, '已先整理为一条图片线索。登录或 Lab 模式后，Nesio 会自动识别图中物品、人物和场景。', 'Saved as an image clue for now. Sign in or use Lab mode and Nesio will recognize objects, people and scenes.'),
      intent: 'MEMORY_CAPTURE',
      people: [],
      nodes: [
        {
          type: 'object',
          name: L(dict, `照片 · ${new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, `Photo · ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`),
          attributes: {
            note: L(dict, '改个名字、加点标签更好找;想认内容点「AI 整理」。', 'Rename or tag it to find it later; tap "AI organize" to recognize content.'),
          },
          relations: [],
          tags: ['图片'],
          confidence: 0.45,
          rawInput: L(dict, '照片', 'Photo'),
        },
      ],
    };
  }

  // 批次 24:分享进来的是纯链接时,先抓正文(微信公众号/通用文章),
  // 生成可读的文章节点(存全文,供 ADHD 阅读器)——不再把 URL 丢给 AI 说「解析不了」。
  async function analyzeUrl(url: string): Promise<boolean> {
    setAnalyzing(true); setError('');
    try {
      const res = await fetch('/api/portal/parse-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json() as { ok?: boolean; title?: string; article?: string; description?: string; image?: string };
      const title = (data.ok && data.title) || url;
      const article = (data.ok && data.article) || '';
      const summary = article ? article.slice(0, 80) + '…' : (data.description || url);
      setParsed({
        title,
        summary,
        intent: 'MEMORY_CAPTURE',
        people: [],
        nodes: [{
          // 批次 143:抓来的文章 = note 类(不再进 preference)
          type: 'note',
          name: title.slice(0, 60),
          attributes: {
            url,
            sourceApp: 'web',
            ...(article ? { article } : {}),
            ...(data.image ? { image: data.image } : {}),
          },
          relations: [],
          tags: ['文章', ...(/mp\.weixin\.qq\.com/.test(url) ? ['公众号'] : [])],
          confidence: 0.9,
          rawInput: article ? article.slice(0, 200) : title,
        }],
      });
      return true;
    } catch {
      setError(L(dict, '抓取文章失败，可以直接粘贴正文。', 'Could not fetch the article — you can paste the text instead.'));
      return false;
    } finally {
      setAnalyzing(false);
    }
  }

  // 「AI 整理」按钮的重放载荷:默认确定性存档后,点按钮以 force=true 重跑云理解
  const [aiPayload, setAiPayload] = useState<{ type: 'text' | 'file' | 'image'; content: string; imageBase64?: string; mimeType?: string } | null>(null);

  async function analyze(type: 'text' | 'file' | 'image', content: string, imageBase64?: string, mimeType?: string, force = false): Promise<boolean> {
    // 纯链接 → 走文章抓取(确定性抓正文,不打 AI,免费层照走)
    if (type === 'text') {
      const urlMatch = content.trim().match(/^https?:\/\/\S+$/);
      if (urlMatch) return analyzeUrl(urlMatch[0]);
    }
    // 批次 33 用户定案:**任何档位都不自动打 AI** —— 确定性存档是唯一默认路径,
    // 「AI 整理」按钮显式触发(force=true)才打云。
    if (!force) {
      setAiPayload({ type, content, imageBase64, mimeType });
      if (type === 'image') { setParsed(buildPendingImageParsed()); return true; }
      const full = content.trim();
      setParsed({
        title: full.slice(0, 40) || L(dict, '分享内容', 'Shared content'),
        summary: L(dict, '已存档,可搜索可阅读。想提炼要点点「AI 整理」。', 'Archived — searchable and readable. Tap "AI organize" to distill key points.'),
        intent: 'MEMORY_CAPTURE',
        people: [],
        nodes: [{
          type: 'preference', name: full.slice(0, 40) || L(dict, '分享内容', 'Shared content'),
          attributes: full.length >= 200 ? { article: full } : { note: full },
          relations: [], tags: ['文章'], confidence: 0.8, rawInput: full.slice(0, 200),
        }],
      });
      return true;
    }
    setAnalyzing(true); setError('');
    try {
      const res = await fetch('/api/portal/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-baohe-access-mode': 'personal_lab' },
        body: JSON.stringify({ type, content, imageBase64, mimeType, uiLocale: dict }),
      });
      const data = await res.json() as { ok?: boolean; nodes?: ParsedResult['nodes']; summary?: string; intent?: string; error?: string };

      if (!data.ok) throw new Error(data.error || 'analysis_failed');

      const nodes = data.nodes || [];
      if (type === 'image' && nodes.length === 0) throw new Error('ai_image_empty');

      // 批次 28:粘贴的是长正文(文章/笔记)时,保留全文到 article + 打「文章」标签,
      // 这样存进记忆后能用瀑布流阅读器读(不需要单独书架)。
      if (type === 'text') {
        const full = content.trim();
        if (full.length >= 200) {
          if (nodes.length === 0) {
            nodes.push({ type: 'preference', name: full.slice(0, 40), attributes: { article: full }, relations: [], tags: ['文章'], confidence: 0.8, rawInput: full.slice(0, 200) });
          } else {
            nodes[0] = { ...nodes[0], attributes: { ...nodes[0].attributes, article: full }, tags: Array.from(new Set([...(nodes[0].tags || []), '文章'])) };
          }
        }
      }
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
        title: nodes[0]?.name || (type === 'image' ? '照片' : content.slice(0, 30)),
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
    setSourceFile(file);

    if (file.type.startsWith('image/')) {
      // 批次 66(用户定案):分享/上传的图片不再走这里的直存流程 ——
      // 转交「拍一下」同一识别界面(EXIF 拍摄时间地点 + AI 识别 + 确认卡 + 足迹)。
      window.dispatchEvent(new CustomEvent('nesio-recognize-image', { detail: { file } }));
      onClose();
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

  async function saveToMemory() {
    if (!parsed) return;
    const savedNodes = parsed.nodes.map((node) => (
      ingestLifeNode({
        ...node,
        source: sourceFile?.type.startsWith('image/') ? 'photo' : 'manual',
      } as Parameters<typeof ingestLifeNode>[0])
    ));
    let cloudAssets: Array<LifeNodeAsset & { nodeId?: string }> = [];
    if (sourceFile && savedNodes.length > 0) {
      try {
        const client = createAppApiClient();
        const upload = await client.uploadCloudAsset({ file: sourceFile, purpose: 'memory' });
        if (upload.ok && upload.storagePath) {
          const assetRecord: LifeNodeAsset = {
            id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            kind: sourceFile.type.startsWith('image/') ? 'image' : 'file',
            storagePath: upload.storagePath,
            mimeType: upload.mimeType,
            label: parsed.title,
            analysisSummary: parsed.summary,
            tags: savedNodes[0].tags || [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          cloudAssets = [{ ...assetRecord, nodeId: savedNodes[0].id }];
          updateLifeNode(savedNodes[0].id, { assets: [assetRecord] });
        }
      } catch {
        // Cloud asset sync is best-effort; local Memory remains usable without sign-in or network.
      }
    }
    try {
      const client = createAppApiClient();
      await client.saveCloudMemorySnapshot({
        nodes: savedNodes,
        assets: cloudAssets,
      });
    } catch {
      // Cloud Memory sync is best-effort; local Memory remains usable without sign-in or network.
    }
    setSaved(true);
    setTimeout(() => { onClose(); setSaved(false); setParsed(null); setSourceFile(null); }, 1100);
  }

  if (!open) return null;

  return (
    <div className="nesio-share-overlay" role="dialog" aria-modal="true" aria-label={L(dict, '分享', 'Share')}>
      <div className="nesio-share-backdrop" onClick={onClose} />
      <div className="nesio-share-card">
        <div className="nesio-sheet-handle" aria-hidden />

        <div className="nesio-share-header">
          <h2 className="nesio-share-title">{L(dict, '分享', 'Share')}</h2>
          {/* 批次 33:右上角 ✕ 撤除(用户指令)—— 退出走背景点击 */}
        </div>

        <p className="nesio-share-desc">
          {L(dict, '你分享进来的内容，Nesio 会先整理出可确认的信息，再由你决定是否存入 Memory。', 'Whatever you share in, Nesio first organizes into confirmable info — you decide what enters Memory.')}
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
              <span>{L(dict, '上传文件', 'Upload file')}</span>
            </button>
            <button type="button" className="nesio-share-action-btn" onClick={() => setTextMode(true)}>
              <span className="nesio-share-action-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                  <path d="M4 5h16M4 12h16M4 19h10"/>
                </svg>
              </span>
              <span>{L(dict, '粘贴文字/链接', 'Paste text/link')}</span>
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
              placeholder={L(dict, '粘贴邮件正文、链接、笔记内容…', 'Paste email text, links, notes…')}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="nesio-ob-primary-btn" style={{ flex: 1 }} onClick={handleTextSubmit} disabled={!textInput.trim()}>
                {L(dict, '提取信息', 'Extract')}
              </button>
              <button type="button" className="nesio-today-btn nesio-today-btn--ghost" style={{ flex: 1 }} onClick={() => { setTextMode(false); setTextInput(''); }}>
                {L(dict, '取消', 'Cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Analyzing */}
        {analyzing && (
          <div style={{ textAlign: 'center', padding: '1.5rem 0', color: 'var(--portal-muted)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <span className="nesio-camera-recognizing-dot" style={{ background: 'var(--portal-blue-deep)', display: 'inline-block', width: '0.5rem', height: '0.5rem', borderRadius: '50%' }} />
            {L(dict, 'Nesio 正在整理可确认的信息…', 'Nesio is organizing confirmable info…')}
          </div>
        )}

        {/* Error */}
        {error && <p className="nesio-ob-error">{error}</p>}

        {/* Parsed result */}
        {parsed && (
          <div className="nesio-share-recent">
            <p className="nesio-share-recent-label">{L(dict, '刚刚分享进来', 'Just shared in')}</p>
            <div className="nesio-share-parsed-card">
              <span className="nesio-share-parsed-icon">
                <NodeTypeIcon type={{ MEMORY_CAPTURE: 'object', EVENT_LOG: 'event', COMMITMENT: 'commitment', HEALTH_LOG: 'health_state', REMINDER: 'commitment' }[parsed.intent] || 'event'} size={18} />
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
                  <span className="nesio-share-meta-chip" style={{ background: 'var(--status-go-soft)', color: 'var(--status-go)' }}>
                    {parsed.nodes.length} {L(dict, '个节点', 'nodes')}
                  </span>
                </div>
              </div>
            </div>

            {/* AI 显式按钮:默认确定性存档零等待;想让 AI 整理要点就点这个 */}
            {aiPayload && !saved && (
              <button
                type="button"
                onClick={() => {
                  if (!canUsePaidCloudAi()) {
                    window.dispatchEvent(new CustomEvent('nesio-pro-gate', { detail: { feature: 'share_ai' } }));
                    return;
                  }
                  const p = aiPayload;
                  setAiPayload(null);
                  void analyze(p.type, p.content, p.imageBase64, p.mimeType, true);
                }}
                style={{ width: '100%', marginBottom: '0.5rem', background: 'none', border: '1px solid var(--portal-line, rgba(127,127,127,0.25))', borderRadius: 999, padding: '0.5rem', fontSize: '0.82rem', color: 'var(--portal-accent, #588ce3)', cursor: 'pointer' }}
              >
                {analyzing ? L(dict, 'AI 整理中…', 'AI organizing…') : L(dict, 'AI 整理(识别要点和分类)', 'AI organize (extract key points)')}
              </button>
            )}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="nesio-share-save-btn" onClick={saveToMemory} style={{ flex: 1 }}>
                {saved ? L(dict, '✓ 已存入 Memory', '✓ Saved to Memory') : L(dict, '存入 Memory', 'Save to Memory')}
              </button>
              <button type="button" className="nesio-today-btn nesio-today-btn--ghost" style={{ flex: 1, borderRadius: '999px' }}
                onClick={() => { setParsed(null); setTextMode(false); setAiPayload(null); }}>
                {L(dict, '重新分享', 'Share again')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
