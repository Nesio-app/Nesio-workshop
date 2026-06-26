'use client';

import { useEffect, useState } from 'react';
import { addLifeNode } from '@/lib/portal/life-graph';
import { routeIntent } from '@/lib/portal/intent-router';

interface ShareSheetProps { open: boolean; onClose: () => void; }

interface ParsedShare {
  title: string;
  source: string;
  people: string[];
  date?: string;
  location?: string;
  icon: string;
  raw?: string;
}

function extractFromText(text: string): Partial<ParsedShare> {
  const people: string[] = [];
  const personMatch = text.match(/(?:医生|老师|经理|主任|张|李|王|赵|刘|陈|杨)[\w一-鿿]{0,3}/g);
  if (personMatch) people.push(...personMatch.slice(0, 3));

  const dateMatch = text.match(/(\d{1,2})[月/]\s*(\d{1,2})[日号]?(?:\s*(\d{1,2}:\d{2}))?/);
  const date = dateMatch
    ? `${dateMatch[1]}月${dateMatch[2]}日${dateMatch[3] ? ' ' + dateMatch[3] : ''}`
    : undefined;

  const locationMatch = text.match(/(?:在|地址:|地点:|位于)\s*([一-鿿\w\s]{2,15})/);
  const location = locationMatch?.[1]?.trim();

  return { people, date, location };
}

export default function ShareSheet({ open, onClose }: ShareSheetProps) {
  const [parsed, setParsed] = useState<ParsedShare | null>(null);
  const [saved, setSaved] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [showTextInput, setShowTextInput] = useState(false);

  useEffect(() => {
    if (!open) { setParsed(null); setSaved(false); setTextInput(''); setShowTextInput(false); }
  }, [open]);

  function handleFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.eml,.txt,.png,.jpg,.jpeg,.docx';
    input.multiple = false;
    input.onchange = () => {
      if (!input.files?.length) return;
      const file = input.files[0];
      const isPdf = file.name.endsWith('.pdf');
      setParsed({
        title: file.name.replace(/\.[^.]+$/, ''),
        source: `来自文件 · ${file.name}`,
        people: [],
        icon: isPdf ? '📄' : file.type.startsWith('image') ? '🖼' : '📁',
        raw: file.name,
      });
    };
    input.click();
  }

  async function handleAppShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Nesio', text: '分享内容到 Nesio' });
      } catch { /* user cancelled */ }
    } else {
      setShowTextInput(true);
    }
  }

  function handleTextSubmit() {
    const t = textInput.trim();
    if (!t) return;
    const { people, date, location } = extractFromText(t);
    const intent = routeIntent(t);
    setParsed({
      title: t.slice(0, 30),
      source: `来自输入 · ${intent.suggestedAction}`,
      people: people || [],
      date,
      location,
      icon: '✍️',
      raw: t,
    });
    setShowTextInput(false);
  }

  function saveToMemory() {
    if (!parsed) return;
    addLifeNode({
      type: 'event',
      name: parsed.title,
      attributes: {
        source: parsed.source,
        date: parsed.date || '',
        location: parsed.location || '',
        people: parsed.people.join(', '),
      },
      source: 'email',
      confidence: 0.82,
      relations: parsed.people.map((p) => ({ targetId: p, relation: 'involves' })),
      tags: ['分享·上传'],
      rawInput: parsed.raw || parsed.title,
    });
    setSaved(true);
    setTimeout(() => { onClose(); setSaved(false); }, 1100);
  }

  if (!open) return null;

  return (
    <div className="nesio-share-overlay" role="dialog" aria-modal="true" aria-label="分享或上传">
      <div className="nesio-share-backdrop" onClick={onClose} />
      <div className="nesio-share-card">
        <div className="nesio-sheet-handle" aria-hidden />
        <div className="nesio-share-header">
          <h2 className="nesio-share-title">分享或上传</h2>
          <button type="button" className="nesio-share-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <p className="nesio-share-desc">从邮件 · 网页 · PDF · 笔记里，Nesio 自动抽取人、时间、承诺与地点。</p>

        {/* Action buttons */}
        <div className="nesio-share-actions">
          <button type="button" className="nesio-share-action-btn" onClick={handleAppShare}>
            <span className="nesio-share-action-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
              </svg>
            </span>
            <span>从 App 分享</span>
          </button>
          <button type="button" className="nesio-share-action-btn" onClick={handleFile}>
            <span className="nesio-share-action-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
            </span>
            <span>上传文件</span>
          </button>
        </div>

        {/* Text input mode */}
        {showTextInput && (
          <div style={{ marginBottom: '0.75rem' }}>
            <textarea
              className="nesio-ob-input"
              style={{ resize: 'vertical', minHeight: '4rem', borderRadius: '0.85rem' }}
              placeholder="粘贴邮件内容、链接或任何文字…"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              autoFocus
            />
            <button type="button" className="nesio-ob-primary-btn" onClick={handleTextSubmit} disabled={!textInput.trim()}>
              提取信息
            </button>
          </div>
        )}

        {!showTextInput && !parsed && (
          <button type="button" onClick={() => setShowTextInput(true)}
            style={{ fontSize: '0.78rem', color: 'var(--portal-blue-deep)', display: 'block', textAlign: 'center', padding: '0.5rem', marginBottom: '0.5rem' }}>
            ✦ 或者粘贴文字 / 链接
          </button>
        )}

        {/* Parsed result */}
        {parsed && (
          <div className="nesio-share-recent">
            <p className="nesio-share-recent-label">识别结果</p>
            <div className="nesio-share-parsed-card">
              <span className="nesio-share-parsed-icon">{parsed.icon}</span>
              <div className="nesio-share-parsed-body">
                <p className="nesio-share-parsed-title">{parsed.title}</p>
                <p className="nesio-share-parsed-source">{parsed.source}</p>
                {(parsed.people.length > 0 || parsed.date || parsed.location) && (
                  <div className="nesio-share-parsed-meta">
                    {parsed.people.map((p) => (
                      <span key={p} className="nesio-share-meta-chip">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                        {p}
                      </span>
                    ))}
                    {parsed.date && (
                      <span className="nesio-share-meta-chip">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        {parsed.date}
                      </span>
                    )}
                    {parsed.location && (
                      <span className="nesio-share-meta-chip">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        {parsed.location}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <button type="button" className="nesio-share-save-btn" onClick={saveToMemory}>
              {saved ? '✓ 已存入 Memory' : '存入 Memory'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
