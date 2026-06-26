'use client';

import { useEffect, useState } from 'react';
import { addLifeNode } from '@/lib/portal/life-graph';
import { routeIntent } from '@/lib/portal/intent-router';

interface ShareSheetProps {
  open: boolean;
  onClose: () => void;
}

interface ParsedShare {
  title: string;
  source: string;
  people: string[];
  date?: string;
  location?: string;
  icon: string;
}

const MOCK_RECENT: ParsedShare = {
  title: '牙医预约确认',
  source: '来自邮件 · 城西口腔',
  people: ['张医生'],
  date: '7月3日 10:00',
  location: '城西口腔',
  icon: '📅',
};

export default function ShareSheet({ open, onClose }: ShareSheetProps) {
  const [recent, setRecent] = useState<ParsedShare | null>(null);
  const [saved, setSaved] = useState(false);
  const [textInput, setTextInput] = useState('');

  useEffect(() => {
    if (open) {
      setRecent(null);
      setSaved(false);
      setTextInput('');
      // Simulate: check if there's a recent share
      setTimeout(() => setRecent(MOCK_RECENT), 400);
    }
  }, [open]);

  function handleFileUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.eml,.txt,.png,.jpg,.jpeg';
    input.multiple = true;
    input.onchange = () => {
      if (!input.files?.length) return;
      const file = input.files[0];
      const parsed: ParsedShare = {
        title: file.name.replace(/\.[^.]+$/, ''),
        source: `来自文件 · ${file.name}`,
        people: [],
        icon: file.type.includes('pdf') ? '📄' : '📁',
      };
      setRecent(parsed);
    };
    input.click();
  }

  function handleAppShare() {
    if (navigator.share) {
      navigator.share({ title: 'Nesio', text: '分享到 Nesio' }).catch(() => undefined);
    } else {
      const url = prompt('粘贴链接或文字：');
      if (url) {
        const result = routeIntent(url);
        setRecent({
          title: url.slice(0, 40),
          source: result.suggestedAction,
          people: [],
          icon: '🔗',
        });
      }
    }
  }

  function handleSaveToMemory() {
    if (!recent) return;
    addLifeNode({
      type: 'event',
      name: recent.title,
      attributes: {
        source: recent.source,
        date: recent.date || '',
        location: recent.location || '',
        people: recent.people.join(', '),
      },
      source: 'email',
      confidence: 0.85,
      relations: recent.people.map((p) => ({ targetId: p, relation: 'involves' })),
      tags: ['分享·上传'],
      rawInput: recent.title,
    });
    setSaved(true);
    setTimeout(() => { onClose(); setSaved(false); }, 1200);
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

        <p className="nesio-share-desc">
          从邮件 · 网页 · PDF · 笔记里，Nesio 自动抽取人、时间、承诺与地点。
        </p>

        {/* Action buttons */}
        <div className="nesio-share-actions">
          <button type="button" className="nesio-share-action-btn" onClick={handleAppShare}>
            <span className="nesio-share-action-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" />
              </svg>
            </span>
            <span>从 App 分享</span>
          </button>
          <button type="button" className="nesio-share-action-btn" onClick={handleFileUpload}>
            <span className="nesio-share-action-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                <path d="M12 5v14M5 12l7-7 7 7" /><line x1="5" y1="20" x2="19" y2="20" />
              </svg>
            </span>
            <span>上传文件</span>
          </button>
        </div>

        {/* Recent parse result */}
        {recent && (
          <div className="nesio-share-recent">
            <p className="nesio-share-recent-label">刚刚分享进来</p>
            <div className="nesio-share-parsed-card">
              <span className="nesio-share-parsed-icon">{recent.icon}</span>
              <div className="nesio-share-parsed-body">
                <p className="nesio-share-parsed-title">{recent.title}</p>
                <p className="nesio-share-parsed-source">{recent.source}</p>
                {(recent.people.length > 0 || recent.date || recent.location) && (
                  <div className="nesio-share-parsed-meta">
                    {recent.people.map((p) => (
                      <span key={p} className="nesio-share-meta-chip">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                        {p}
                      </span>
                    ))}
                    {recent.date && (
                      <span className="nesio-share-meta-chip">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        {recent.date}
                      </span>
                    )}
                    {recent.location && (
                      <span className="nesio-share-meta-chip">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        {recent.location}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <button type="button" className="nesio-share-save-btn" onClick={handleSaveToMemory}>
              {saved ? '✓ 已存入 Memory' : '存入 Memory'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
