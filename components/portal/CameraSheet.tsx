'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { addLifeNode, type LifeNode } from '@/lib/portal/life-graph';

interface CameraSheetProps { open: boolean; onClose: () => void; }

interface AnalyzedNode extends Omit<LifeNode, 'id' | 'createdAt'> {}

interface AnalysisResult {
  summary: string;
  nodes: AnalyzedNode[];
}

class AnalyzeImageError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

// Compress image to JPEG under 800KB
async function compressImage(canvas: HTMLCanvasElement): Promise<string> {
  let quality = 0.85;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length > 1_100_000 && quality > 0.3) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  return dataUrl.split(',')[1]; // base64 only
}

async function analyzeImage(base64: string): Promise<AnalysisResult> {
  const res = await fetch('/api/portal/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-baohe-access-mode': 'personal_lab' },
    body: JSON.stringify({
      type: 'image',
      content: '请只根据图片里真实可见的内容生成 Memory 节点。优先识别具体物品、位置、文件、场景；除非图片里清楚有人，否则不要生成“人物”节点；不要把这段指令当成节点名称。',
      imageBase64: base64,
      mimeType: 'image/jpeg',
    }),
  });
  const data = await res.json() as { ok?: boolean; nodes?: AnalyzedNode[]; summary?: string; error?: string };
  if (!data.ok || !data.nodes?.length) throw new AnalyzeImageError(data.error || 'no_result');
  return { nodes: data.nodes, summary: data.summary || '识别完成' };
}

const TYPE_ICON: Record<string, string> = {
  person: '👤', object: '📦', place: '📍', event: '📅',
  commitment: '🤝', health_state: '🩷', preference: '⭐',
};
const TYPE_LABEL: Record<string, string> = {
  person: '人物', object: '物品', place: '地点', event: '事件',
  commitment: '承诺', health_state: '健康', preference: '偏好',
};

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.82) return '比较确定';
  if (confidence >= 0.58) return '可能相关';
  return '建议确认';
}

function buildPendingImageResult(name = '图片线索'): AnalysisResult {
  return {
    summary: '已先保存为待确认图片线索。登录或 Lab 模式后可自动识别标签。',
    nodes: [
      {
        type: 'object',
        name,
        attributes: { status: '待确认', note: '图片已保存，标签等待你确认或登录后自动识别。' },
        relations: [],
        tags: ['图片', '待确认'],
        source: 'photo',
        confidence: 0.45,
      },
    ],
  };
}

function parseInlineTags(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.startsWith('#') && part.length > 1)
      .map((part) => part.slice(1).replace(/[，。,.!?！？:：；;]/g, '').trim())
      .filter(Boolean),
  ));
}

export default function CameraSheet({ open, onClose }: CameraSheetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [phase, setPhase] = useState<'idle' | 'live' | 'captured' | 'analyzing' | 'result' | 'saved' | 'no-camera'>('idle');
  const [capturedPreview, setCapturedPreview] = useState<string>('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [permDenied, setPermDenied] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [error, setError] = useState('');
  const [extraTags, setExtraTags] = useState('');

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async (facing: 'environment' | 'user') => {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) { setPhase('no-camera'); return; }
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true'); // iOS requires this
        await video.play().catch(() => {}); // ignore autoplay error
      }
      setPhase('live');
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setPermDenied(true);
      }
      setPhase('no-camera');
    }
  }, [stopCamera]);

  useEffect(() => {
    if (open) {
      setPhase('idle'); setResult(null); setCapturedPreview('');
      setPermDenied(false); setError(''); setExtraTags('');
      startCamera('environment');
    } else {
      stopCamera();
    }
    return stopCamera;
  }, [open, startCamera, stopCamera]);

  async function capturePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      setError('相机未就绪，请稍后再试。');
      return;
    }
    setPhase('captured');

    // Draw frame
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 960;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    // Show preview thumbnail
    const preview = canvas.toDataURL('image/jpeg', 0.5);
    setCapturedPreview(preview);

    // Compress & analyze
    setPhase('analyzing');
    try {
      const base64 = await compressImage(canvas);
      const res = await analyzeImage(base64);
      setResult(res);
      setPhase('result');
    } catch (err: unknown) {
      if (err instanceof AnalyzeImageError && err.code === 'ai_auth_required') {
        setResult(buildPendingImageResult());
        setPhase('result');
        return;
      }
      setError('识别失败。你可以先保存为待确认图片线索。');
      setResult(buildPendingImageResult());
      setPhase('result');
    }
  }

  function handleGallery() { fileRef.current?.click(); }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setPhase('analyzing');
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setCapturedPreview(dataUrl);
      const base64 = dataUrl.split(',')[1];
      try {
        const res = await analyzeImage(base64);
        setResult(res);
        setPhase('result');
      } catch {
        setResult(buildPendingImageResult(file.name.replace(/\.[^.]+$/, '') || '图片线索'));
        setPhase('result');
      }
    };
    if (file.type.startsWith('image/')) {
      reader.readAsDataURL(file);
    } else {
      // Non-image file: text analysis
      const text = await file.text().catch(() => file.name);
      setPhase('analyzing');
      try {
        const res2 = await fetch('/api/portal/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'file', content: text.slice(0, 4000) }),
        });
        const data = await res2.json() as { ok?: boolean; nodes?: AnalyzedNode[]; summary?: string };
        setResult({ nodes: data.nodes || [], summary: data.summary || '提取完成' });
        setPhase('result');
      } catch {
        setPhase('live');
      }
    }
  }

  function saveAll() {
    if (!result) return;
    const userTags = parseInlineTags(extraTags);
    result.nodes.forEach((n) => addLifeNode({
      ...n,
      source: 'photo',
      tags: Array.from(new Set([...(n.tags || []), ...userTags])),
      attributes: {
        ...n.attributes,
        ...(userTags.length ? { userTags: userTags.join(', ') } : {}),
      },
    }));
    setPhase('saved');
    setTimeout(() => { onClose(); setPhase('idle'); setResult(null); setExtraTags(''); }, 900);
  }

  function retake() {
    setResult(null); setCapturedPreview(''); setError(''); setExtraTags('');
    setPhase('live');
  }

  function flipCamera() {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    startCamera(next);
  }

  if (!open) return null;

  return (
    <div className="nesio-camera-sheet" role="dialog" aria-modal="true" aria-label="拍一下">
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <input ref={fileRef} type="file" accept="image/*,.pdf,.txt,.eml" style={{ display: 'none' }} onChange={handleFileChange} />

      {/* Header */}
      <div className="nesio-camera-header">
        <button type="button" className="nesio-camera-close" onClick={onClose} aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="18" height="18">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <h2 className="nesio-camera-title">
          {{ idle: '拍一下', live: '拍一下', captured: '处理中', analyzing: '识别中', result: '识别结果', saved: '已保存', 'no-camera': '上传图片' }[phase]}
        </h2>
        <div style={{ width: 40 }} />
      </div>

      {/* Viewfinder */}
      <div className="nesio-camera-viewfinder">
        {/* Live preview */}
        {(phase === 'live' || phase === 'captured') && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="nesio-camera-video"
            style={{ opacity: phase === 'captured' ? 0.4 : 1 }}
          />
        )}

        {/* Captured photo preview */}
        {(phase === 'analyzing' || phase === 'result' || phase === 'saved') && capturedPreview && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={capturedPreview}
            alt="拍摄的照片"
            className="nesio-camera-video camera-callout-none"
            style={{ objectFit: 'cover' }}
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
          />
        )}

        {/* Opening / no camera fallback */}
        {(phase === 'idle' || phase === 'no-camera') && (
          <div className="nesio-camera-fallback">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="52" height="52" opacity="0.25">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            <p className="nesio-camera-fallback-text">
              {phase === 'idle'
                ? '正在打开相机。你也可以先选一张照片或文件放进 Nesio。'
                : permDenied
                ? '相机权限被拒绝。请在浏览器设置→网站设置→摄像头中允许，然后刷新。'
                : '此设备不支持网页相机访问。'}
            </p>
            <button type="button" className="nesio-camera-gallery-btn" onClick={handleGallery}>
              从相册 / 文件中选择
            </button>
          </div>
        )}

        {/* Corner brackets */}
        {(phase === 'live' || phase === 'captured') && (
          <div className="nesio-camera-corners" aria-hidden>
            <span className="nesio-camera-corner nesio-camera-corner--tl"/>
            <span className="nesio-camera-corner nesio-camera-corner--tr"/>
            <span className="nesio-camera-corner nesio-camera-corner--bl"/>
            <span className="nesio-camera-corner nesio-camera-corner--br"/>
          </div>
        )}

        {/* Status pills */}
        {phase === 'analyzing' && (
          <div className="nesio-camera-recognizing" aria-live="polite">
            <span className="nesio-camera-recognizing-dot"/>
            Nesio 正在识别…
          </div>
        )}

        {error && (
          <div className="nesio-camera-recognizing" style={{ color: '#fca5a5', borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(127,29,29,0.8)' }}>
            {error}
          </div>
        )}
      </div>

      {/* Analysis result */}
      {phase === 'result' && result && (
        <div className="nesio-camera-result-panel">
          <p className="nesio-camera-result-summary">{result.summary}</p>
          <div className="nesio-camera-result-nodes">
            {result.nodes.slice(0, 4).map((node, i) => (
              <div key={i} className="nesio-camera-result-node">
                <span className="nesio-camera-result-node-icon">
                  {TYPE_ICON[node.type] || '📌'}
                </span>
                <div className="nesio-camera-result-node-body">
                  <p className="nesio-camera-result-node-name">{node.name}</p>
                  <p className="nesio-camera-result-node-type">{TYPE_LABEL[node.type] || node.type}</p>
                  {Object.entries(node.attributes).slice(0, 2).map(([k, v]) => (
                    <p key={k} className="nesio-camera-result-node-attr">{k}: {String(v)}</p>
                  ))}
                </div>
                <span className="nesio-camera-result-conf">{confidenceLabel(node.confidence)}</span>
              </div>
            ))}
          </div>
          <label className="nesio-camera-tag-field">
            <span>给这张图片加标签</span>
            <input
              value={extraTags}
              onChange={(e) => setExtraTags(e.target.value)}
              placeholder="例如 #钥匙 #门口 #Linda礼物"
              aria-label="图片标签"
            />
          </label>
          {parseInlineTags(extraTags).length > 0 && (
            <div className="nesio-camera-tag-preview">
              {parseInlineTags(extraTags).map((tag) => <span key={tag}>#{tag}</span>)}
            </div>
          )}
          <div className="nesio-camera-result-actions">
            <button type="button" className="nesio-camera-save-btn" onClick={saveAll}>
              存入 Memory ({result.nodes.length} 条)
            </button>
            <button type="button" className="nesio-camera-retake-btn" onClick={retake}>重拍</button>
          </div>
        </div>
      )}

      {phase === 'saved' && (
        <div className="nesio-camera-result-panel" style={{ textAlign: 'center', padding: '1.25rem' }}>
          <p style={{ color: '#10b981', fontSize: '1.1rem', fontWeight: 700 }}>✓ 已存入 Memory</p>
        </div>
      )}

      {/* Controls */}
      {(phase === 'live' || phase === 'no-camera') && (
        <div className="nesio-camera-controls">
          <button type="button" className="nesio-camera-ctrl-btn" onClick={handleGallery} aria-label="相册">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
              <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
            </svg>
          </button>
          <button
            type="button"
            className="nesio-camera-shutter"
            onClick={capturePhoto}
            disabled={phase !== 'live'}
            style={{ opacity: phase === 'live' ? 1 : 0.3 }}
            aria-label="拍照"
          />
          <button type="button" className="nesio-camera-ctrl-btn" onClick={flipCamera} aria-label="翻转">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
