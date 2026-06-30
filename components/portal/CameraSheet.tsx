'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { addLifeNode, updateLifeNode, type LifeNode, type LifeNodeAsset } from '@/lib/portal/life-graph';
import { createAppApiClient } from '@/lib/portal/app-api-client';

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

function buildPendingImageResult(): AnalysisResult {
  return {
    summary: '已先保存为待确认图片线索。登录或 Lab 模式后可自动识别标签。',
    nodes: [
      {
        type: 'object',
        name: '待确认图片线索',
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

function dataUrlToFile(dataUrl: string, fileName: string): File | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) return null;
  const [, mimeType, base64] = match;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], fileName, { type: mimeType || 'image/jpeg' });
}

export default function CameraSheet({ open, onClose }: CameraSheetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [phase, setPhase] = useState<'idle' | 'live' | 'captured' | 'analyzing' | 'result' | 'saved' | 'no-camera'>('idle');
  const [capturedPreview, setCapturedPreview] = useState<string>('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [permDenied, setPermDenied] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [error, setError] = useState('');
  const [extraTags, setExtraTags] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);

  const stopCamera = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const waitForVideoElement = useCallback(async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (videoRef.current) return true;
    }
    return Boolean(videoRef.current);
  }, []);

  const attachStreamToVideo = useCallback(async (stream: MediaStream) => {
    await waitForVideoElement();
    const video = videoRef.current;
    if (!video) return false;

    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }

    if (video.readyState < 1) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 350);
        video.onloadedmetadata = () => {
          window.clearTimeout(timer);
          video.onloadedmetadata = null;
          resolve();
        };
      });
    }

    await video.play().catch(() => {});
    return video.srcObject === stream;
  }, [waitForVideoElement]);

  const startCamera = useCallback(async (facing: 'environment' | 'user') => {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) { setPhase('no-camera'); return; }
    setPhase('live');
    await waitForVideoElement();
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
      const attached = await attachStreamToVideo(stream);
      if (!attached && streamRef.current === stream) {
        window.setTimeout(() => {
          if (streamRef.current === stream) {
            void attachStreamToVideo(stream);
          }
        }, 120);
      }
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      stopCamera();
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        setPermDenied(true);
      }
      setPhase('no-camera');
    }
  }, [attachStreamToVideo, stopCamera, waitForVideoElement]);

  useEffect(() => {
    if (phase !== 'live') return;
    const stream = streamRef.current;
    if (!stream) return;
    void attachStreamToVideo(stream);
  }, [attachStreamToVideo, phase]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      return stopCamera;
    }

    setPhase('idle');
    setResult(null);
    setCapturedPreview('');
    setPermDenied(false);
    setError('');
    setExtraTags('');
    setSourceFile(null);

    // Native camera: opened by a user tap (iOS blocks programmatic file-input
    // clicks outside a gesture). No getUserMedia → no persistent camera
    // indicator, no black-screen retry loop, no permission roundabout.
    return () => {
      stopCamera();
    };
  }, [open, stopCamera]);

  function openNativeCamera() { cameraInputRef.current?.click(); }

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
    setSourceFile(dataUrlToFile(preview, `nesio-camera-${Date.now()}.jpg`));

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
    setSourceFile(file);

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
        setResult(buildPendingImageResult());
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

  async function saveAll() {
    if (!result) return;
    const userTags = parseInlineTags(extraTags);
    const savedNodes = result.nodes.map((n) => addLifeNode({
      ...n,
      source: 'photo',
      tags: Array.from(new Set([...(n.tags || []), ...userTags])),
      attributes: {
        ...n.attributes,
        ...(userTags.length ? { userTags: userTags.join(', ') } : {}),
      },
    }));
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
            label: result.summary || savedNodes[0].name,
            analysisSummary: result.summary,
            tags: Array.from(new Set([...(savedNodes[0].tags || []), ...userTags])),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          cloudAssets = [{ ...assetRecord, nodeId: savedNodes[0].id }];
          updateLifeNode(savedNodes[0].id, { assets: [assetRecord] });
        }
      } catch {
        // Cloud asset sync is best-effort; local Memory remains the source of continuity offline.
      }
    }
    try {
      const client = createAppApiClient();
      await client.saveCloudMemorySnapshot({
        nodes: savedNodes,
        assets: cloudAssets,
      });
    } catch {
      // Cloud Memory sync is best-effort; local Memory remains available.
    }
    setPhase('saved');
    setTimeout(() => { onClose(); setPhase('idle'); setResult(null); setExtraTags(''); setSourceFile(null); }, 900);
  }

  function retake() {
    setResult(null); setCapturedPreview(''); setError(''); setExtraTags(''); setSourceFile(null);
    setPhase('idle');
    openNativeCamera();
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
      {/* Native camera — opens the iOS system camera directly (reliable, no
          persistent stream/indicator). Triggered by a user tap. */}
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFileChange} />
      {/* Gallery / file picker — no capture, so it picks from library/files. */}
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

        {/* Capture chooser (native camera) / no-camera fallback */}
        {(phase === 'idle' || phase === 'no-camera') && (
          <div className="nesio-camera-chooser">
            <span className="nesio-camera-chooser-icon" aria-hidden>📷</span>
            <p className="nesio-camera-chooser-text">
              {phase === 'idle'
                ? '拍一张，Nesio 帮你识别并存入 Memory'
                : '此设备不支持相机，请从相册选择'}
            </p>
            <button type="button" className="nesio-camera-shoot-btn" onClick={openNativeCamera}>
              拍照
            </button>
            <button type="button" className="nesio-camera-chooser-alt" onClick={handleGallery}>
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

    </div>
  );
}
