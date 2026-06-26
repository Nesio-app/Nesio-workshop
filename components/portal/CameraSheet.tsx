'use client';

/**
 * 拍一下 — full-screen camera that:
 * 1. Opens real camera via getUserMedia
 * 2. Captures a photo (canvas screenshot of video frame)
 * 3. Sends base64 image to /api/portal/analyze
 * 4. Shows AI recognition result
 * 5. Saves to Life Graph on confirm
 */

import { useEffect, useRef, useState } from 'react';
import { addLifeNode, type LifeNode } from '@/lib/portal/life-graph';

interface CameraSheetProps { open: boolean; onClose: () => void; }

interface AnalysisResult {
  summary: string;
  intent: string;
  nodes: Array<Omit<LifeNode, 'id' | 'createdAt'>>;
}

export default function CameraSheet({ open, onClose }: CameraSheetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<'idle' | 'live' | 'capturing' | 'analyzing' | 'done' | 'no-camera'>('idle');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [permDenied, setPermDenied] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  useEffect(() => {
    if (open) {
      setStatus('idle'); setResult(null); setSaved(false); setPermDenied(false);
      startCamera('environment');
    } else {
      stopCamera();
    }
    return stopCamera;
  }, [open]);

  async function startCamera(facing: 'environment' | 'user') {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) { setStatus('no-camera'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus('live');
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      setPermDenied(name === 'NotAllowedError' || name === 'PermissionDeniedError');
      setStatus('no-camera');
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function flipCamera() {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    startCamera(next);
  }

  async function captureAndAnalyze() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    setStatus('capturing');

    // Draw current frame to canvas
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    // Get base64 (strip data: prefix for API)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const base64 = dataUrl.split(',')[1];

    setStatus('analyzing');
    await runAnalysis('image', '', base64, 'image/jpeg');
  }

  async function handleGallery() {
    const input = fileRef.current;
    if (!input) return;
    input.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus('analyzing');

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1];
        await runAnalysis('image', file.name, base64, file.type);
      };
      reader.readAsDataURL(file);
    } else {
      // Non-image file — read as text if possible
      try {
        const text = await file.text();
        await runAnalysis('file', text.slice(0, 3000));
      } catch {
        await runAnalysis('file', `文件名：${file.name}`);
      }
    }
    // Reset file input so same file can be re-selected
    e.target.value = '';
  }

  async function runAnalysis(type: 'image' | 'file', content: string, imageBase64?: string, mimeType?: string) {
    try {
      const res = await fetch('/api/portal/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, content, imageBase64, mimeType }),
      });
      const data = await res.json() as { ok?: boolean; nodes?: AnalysisResult['nodes']; summary?: string; intent?: string };
      if (data.ok && data.nodes?.length) {
        setResult({ nodes: data.nodes, summary: data.summary || '', intent: data.intent || 'MEMORY_CAPTURE' });
        setStatus('done');
      } else {
        // Fallback: treat as unknown object
        setResult({
          nodes: [{ type: 'object', name: content.slice(0, 25) || '未知物品', attributes: {}, relations: [], tags: ['拍一下'], source: 'photo', confidence: 0.65 }],
          summary: '已识别，请确认',
          intent: 'MEMORY_CAPTURE',
        });
        setStatus('done');
      }
    } catch {
      setResult({
        nodes: [{ type: 'object', name: '未知物品', attributes: {}, relations: [], tags: ['拍一下'], source: 'photo', confidence: 0.5 }],
        summary: '识别失败，已保存原始记录',
        intent: 'MEMORY_CAPTURE',
      });
      setStatus('done');
    }
  }

  function saveAll() {
    if (!result) return;
    result.nodes.forEach((node) => addLifeNode({ ...node, source: 'photo' }));
    setSaved(true);
    setTimeout(() => { onClose(); setSaved(false); setResult(null); }, 1000);
  }

  if (!open) return null;

  // Top result node for display
  const topNode = result?.nodes[0];

  return (
    <div className="nesio-camera-sheet" role="dialog" aria-modal="true" aria-label="拍一下">
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <input ref={fileRef} type="file" accept="image/*,application/pdf,.txt,.docx" style={{ display: 'none' }} onChange={handleFileChange} />

      {/* Header */}
      <div className="nesio-camera-header">
        <button type="button" className="nesio-camera-close" onClick={onClose} aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="18" height="18">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <h2 className="nesio-camera-title">拍一下</h2>
        <div style={{ width: 40 }} />
      </div>

      {/* Viewfinder */}
      <div className="nesio-camera-viewfinder">
        {(status === 'live' || status === 'capturing' || status === 'done') && (
          <video ref={videoRef} autoPlay playsInline muted className="nesio-camera-video" />
        )}

        {status === 'no-camera' && (
          <div className="nesio-camera-fallback">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="52" height="52" opacity="0.25">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            <p style={{ color: '#8fa3c0', fontSize: '0.85rem', textAlign: 'center', padding: '0 2rem', marginTop: '1rem' }}>
              {permDenied ? '相机权限被拒绝，请在浏览器设置中开启，或从相册选择图片。' : '此浏览器不支持相机，请从相册选择。'}
            </p>
            <button type="button" className="nesio-camera-gallery-btn" style={{ marginTop: '1.25rem' }} onClick={handleGallery}>
              从相册或文件选择
            </button>
          </div>
        )}

        {/* Corners */}
        <div className="nesio-camera-corners" aria-hidden>
          <span className="nesio-camera-corner nesio-camera-corner--tl"/><span className="nesio-camera-corner nesio-camera-corner--tr"/>
          <span className="nesio-camera-corner nesio-camera-corner--bl"/><span className="nesio-camera-corner nesio-camera-corner--br"/>
        </div>

        {/* Status pills */}
        {status === 'capturing' && (
          <div className="nesio-camera-recognizing"><span className="nesio-camera-recognizing-dot"/>拍照中…</div>
        )}
        {status === 'analyzing' && (
          <div className="nesio-camera-recognizing"><span className="nesio-camera-recognizing-dot"/>Nesio 正在识别…</div>
        )}
      </div>

      {/* Result card */}
      {topNode && (
        <div className={`nesio-camera-result${saved ? ' nesio-camera-result--saved' : ''}`}>
          <div className="nesio-camera-result-row">
            <span className="nesio-camera-result-icon">
              {{ person: '👤', object: '📦', place: '📍', event: '📅', commitment: '🤝', health_state: '🩷', preference: '⭐' }[topNode.type] || '📌'}
            </span>
            <div style={{ flex: 1 }}>
              <p className="nesio-camera-result-name">{saved ? '✓ 已存入 Memory' : topNode.name}</p>
              <p className="nesio-camera-result-hint">
                {saved ? `${result!.nodes.length} 条记录已保存` : result?.summary}
              </p>
              {!saved && topNode.attributes && Object.entries(topNode.attributes).slice(0, 2).map(([k, v]) => (
                <p key={k} style={{ fontSize: '0.7rem', color: '#8fa3c0', marginTop: '0.1rem' }}>{k}: {String(v)}</p>
              ))}
            </div>
          </div>
          {!saved && (
            <button type="button" className="nesio-camera-save-btn" onClick={saveAll}>存入 Memory</button>
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
        <button
          type="button" className="nesio-camera-shutter"
          onClick={captureAndAnalyze}
          disabled={status !== 'live'}
          style={{ opacity: status === 'live' ? 1 : 0.35 }}
          aria-label="拍照"
        />
        <button type="button" className="nesio-camera-ctrl-btn" onClick={flipCamera} aria-label="翻转摄像头">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
