'use client';

import { useEffect, useRef, useState } from 'react';
import { addLifeNode } from '@/lib/portal/life-graph';

interface CameraSheetProps { open: boolean; onClose: () => void; }

interface RecognizedItem { name: string; suggestion: string; icon: string; }

const MOCK_ITEMS: RecognizedItem[] = [
  { name: '蓝色收纳盒', suggestion: '建议存到「储物间」', icon: '📦' },
  { name: '药瓶', suggestion: '建议标记为「健康物品」', icon: '💊' },
  { name: '文件夹', suggestion: '建议存到「重要文件」', icon: '📄' },
  { name: '书本', suggestion: '建议存到「阅读记录」', icon: '📚' },
  { name: '充电器', suggestion: '建议标记位置', icon: '🔌' },
];

export default function CameraSheet({ open, onClose }: CameraSheetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<'idle' | 'live' | 'recognizing' | 'done' | 'error' | 'no-camera'>('idle');
  const [recognized, setRecognized] = useState<RecognizedItem | null>(null);
  const [saved, setSaved] = useState(false);
  const [permDenied, setPermDenied] = useState(false);

  useEffect(() => {
    if (open) { setStatus('idle'); setRecognized(null); setSaved(false); setPermDenied(false); startCamera(); }
    else { stopCamera(); }
    return () => stopCamera();
  }, [open]);

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { setStatus('no-camera'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); }
      setStatus('live');
      // Auto-scan after 2s
      setTimeout(() => { if (streamRef.current) triggerScan(); }, 2200);
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') { setPermDenied(true); setStatus('no-camera'); }
      else { setStatus('no-camera'); }
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function triggerScan() {
    setStatus('recognizing');
    setTimeout(() => {
      const item = MOCK_ITEMS[Math.floor(Math.random() * MOCK_ITEMS.length)];
      setRecognized(item);
      setStatus('done');
    }, 1400);
  }

  function handleGallery() { fileRef.current?.click(); }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return;
    setStatus('recognizing');
    setTimeout(() => {
      const item = MOCK_ITEMS[Math.floor(Math.random() * MOCK_ITEMS.length)];
      setRecognized(item);
      setStatus('done');
    }, 1200);
  }

  function saveToMemory() {
    if (!recognized) return;
    addLifeNode({ type: 'object', name: recognized.name, attributes: { category: recognized.suggestion }, source: 'photo', confidence: 0.85, relations: [], tags: ['拍一下'] });
    setSaved(true);
    setTimeout(() => { onClose(); setSaved(false); setRecognized(null); }, 1100);
  }

  if (!open) return null;

  return (
    <div className="nesio-camera-sheet" role="dialog" aria-modal="true" aria-label="拍一下">
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />

      <div className="nesio-camera-header">
        <button type="button" className="nesio-camera-close" onClick={onClose} aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <h2 className="nesio-camera-title">拍一下</h2>
        <div style={{ width: 40 }} />
      </div>

      <div className="nesio-camera-viewfinder">
        {(status === 'live' || status === 'recognizing' || status === 'done') && (
          <video ref={videoRef} autoPlay playsInline muted className="nesio-camera-video" />
        )}

        {status === 'no-camera' && (
          <div className="nesio-camera-fallback">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="52" height="52" opacity="0.3">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>
            </svg>
            <p style={{ color: '#8fa3c0', fontSize: '0.85rem', marginTop: '1rem', textAlign: 'center', padding: '0 1rem' }}>
              {permDenied ? '相机权限被拒绝，请在浏览器设置中开启' : '此设备不支持相机访问'}
            </p>
            <button type="button" className="nesio-camera-gallery-btn" style={{ marginTop: '1.25rem' }} onClick={handleGallery}>
              从相册选择图片
            </button>
          </div>
        )}

        {/* Corner brackets */}
        <div className="nesio-camera-corners" aria-hidden>
          <span className="nesio-camera-corner nesio-camera-corner--tl" />
          <span className="nesio-camera-corner nesio-camera-corner--tr" />
          <span className="nesio-camera-corner nesio-camera-corner--bl" />
          <span className="nesio-camera-corner nesio-camera-corner--br" />
        </div>

        {status === 'recognizing' && (
          <div className="nesio-camera-recognizing" aria-live="polite">
            <span className="nesio-camera-recognizing-dot" />Nesio 正在识别…
          </div>
        )}
      </div>

      {/* Result */}
      {recognized && (
        <div className={`nesio-camera-result${saved ? ' nesio-camera-result--saved' : ''}`}>
          <div className="nesio-camera-result-row">
            <span className="nesio-camera-result-icon">{recognized.icon}</span>
            <div style={{ flex: 1 }}>
              <p className="nesio-camera-result-name">{saved ? '✓ 已存入 Memory' : recognized.name}</p>
              <p className="nesio-camera-result-hint">{recognized.suggestion}</p>
            </div>
          </div>
          {!saved && (
            <button type="button" className="nesio-camera-save-btn" onClick={saveToMemory}>存入 Memory</button>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="nesio-camera-controls">
        <button type="button" className="nesio-camera-ctrl-btn" onClick={handleGallery} aria-label="相册">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
          </svg>
        </button>
        <button type="button" className="nesio-camera-shutter" onClick={triggerScan} aria-label="拍照"
          disabled={status !== 'live'} style={{ opacity: status === 'live' ? 1 : 0.4 }} />
        <button type="button" className="nesio-camera-ctrl-btn" aria-label="切换摄像头"
          onClick={async () => { stopCamera(); await startCamera(); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
