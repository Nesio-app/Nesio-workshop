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
      content: '请只根据图片里真实可见的内容生成 Memory 节点。如果是小票/收据，请为每个购买条目单独生成一个 object 节点（名称用中文，如”草莓冰淇淋”），并在 attributes 里加 price 和 receiptDate；优先识别具体物品、位置、文件、场景；除非图片里清楚有人，否则不要生成”人物”节点；不要把这段指令当成节点名称。',
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

// ── Editable node state ──────────────────────────────────────────────────────

interface EditedNode {
  name: string;
  type: string;
  attributes: Record<string, string | number | boolean | null>;
  tags: string[];
  source: string;
  confidence: number;
  relations: Array<{ targetId: string; relation: string }>;
  rawInput?: string;
  note?: string;
  expiry?: string;
  deleted: boolean;
}

function toEditedNodes(nodes: AnalyzedNode[]): EditedNode[] {
  return nodes.map((n) => ({ ...n, tags: n.tags ?? [], note: '', expiry: '', deleted: false }));
}

// ── Receipt detection ────────────────────────────────────────────────────────

const RECEIPT_KEYWORDS = ['小票', '收据', 'receipt', '发票', '结账', '超市', '便利店', '合计', 'total', 'subtotal', '购物清单'];

function detectReceipt(result: AnalysisResult): boolean {
  const text = [result.summary, ...result.nodes.map((n) => n.name + ' ' + JSON.stringify(n.attributes))].join(' ').toLowerCase();
  const keywordHit = RECEIPT_KEYWORDS.some((k) => text.includes(k));
  const manyObjects = result.nodes.length >= 3 && result.nodes.filter((n) => n.type === 'object').length >= result.nodes.length - 1;
  return keywordHit || manyObjects;
}

// ── Location helper ──────────────────────────────────────────────────────────

async function getCurrentLocation(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 3000, maximumAge: 60_000 },
    );
  });
}

// ── Node type chips ──────────────────────────────────────────────────────────

const ALL_TYPES = ['object', 'person', 'place', 'event', 'commitment', 'health_state', 'preference'] as const;

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
  const selectCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [phase, setPhase] = useState<'idle' | 'live' | 'captured' | 'analyzing' | 'result' | 'saved' | 'no-camera'>('idle');
  const [capturedPreview, setCapturedPreview] = useState<string>('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [editedNodes, setEditedNodes] = useState<EditedNode[]>([]);
  const [isReceipt, setIsReceipt] = useState(false);
  const [permDenied, setPermDenied] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [error, setError] = useState('');
  const [extraTags, setExtraTags] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  // Bounding-box selection state
  const [selecting, setSelecting] = useState(false);
  const selStartRef = useRef<{ x: number; y: number } | null>(null);

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
      setEditedNodes(toEditedNodes(res.nodes));
      setIsReceipt(detectReceipt(res));
      setPhase('result');
    } catch (err: unknown) {
      if (err instanceof AnalyzeImageError && err.code === 'ai_auth_required') {
        const pending = buildPendingImageResult();
        setResult(pending);
        setEditedNodes(toEditedNodes(pending.nodes));
        setIsReceipt(false);
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
        setEditedNodes(toEditedNodes(res.nodes));
        setIsReceipt(detectReceipt(res));
        setPhase('result');
      } catch {
        const pending = buildPendingImageResult();
        setResult(pending);
        setEditedNodes(toEditedNodes(pending.nodes));
        setIsReceipt(false);
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
        const fileResult = { nodes: data.nodes || [], summary: data.summary || '提取完成' };
        setResult(fileResult);
        setEditedNodes(toEditedNodes(fileResult.nodes));
        setIsReceipt(detectReceipt(fileResult));
        setPhase('result');
      } catch {
        setPhase('live');
      }
    }
  }

  async function saveAll() {
    const nodesToSave = editedNodes.filter((n) => !n.deleted);
    if (!nodesToSave.length) return;
    const userTags = parseInlineTags(extraTags);

    // Best-effort location — attach if permission already granted
    const loc = await getCurrentLocation();
    const locAttrs = loc ? { lat: loc.lat, lon: loc.lon } : {};

    const savedNodes = nodesToSave.map((n) => addLifeNode({
      name: n.name.trim() || '未命名条目',
      type: n.type as LifeNode['type'],
      source: 'photo',
      tags: Array.from(new Set([...(n.tags || []), ...userTags])),
      confidence: n.confidence,
      relations: n.relations,
      rawInput: n.rawInput,
      attributes: {
        ...n.attributes,
        ...(loc ? { lat: loc.lat as number, lon: loc.lon as number } : {}),
        ...(n.note?.trim() ? { note: n.note.trim() as string } : {}),
        ...(n.expiry?.trim() ? { expiry: n.expiry.trim() as string } : {}),
        ...(userTags.length ? { userTags: userTags.join(', ') as string } : {}),
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
            label: result?.summary || savedNodes[0].name,
            analysisSummary: result?.summary,
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
    setResult(null); setEditedNodes([]); setIsReceipt(false);
    setCapturedPreview(''); setError(''); setExtraTags(''); setSourceFile(null);
    setPhase('idle');
    openNativeCamera();
  }

  // ── Bounding-box selection ──────────────────────────────────────────────

  function openSelection() {
    const canvas = selectCanvasRef.current;
    if (!canvas) return;
    // Size the drawing canvas to match the displayed image
    const parent = canvas.parentElement;
    if (parent) {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    }
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    selStartRef.current = null;
    setSelecting(true);
  }

  function handleSelTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const t = e.touches[0];
    selStartRef.current = { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }

  function handleSelTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const start = selStartRef.current;
    if (!start) return;
    const canvas = selectCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = e.touches[0];
    const cx = t.clientX - rect.left;
    const cy = t.clientY - rect.top;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const x = Math.min(start.x, cx);
    const y = Math.min(start.y, cy);
    const w = Math.abs(cx - start.x);
    const h = Math.abs(cy - start.y);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = 'rgba(59,130,246,0.08)';
    ctx.fillRect(x, y, w, h);
  }

  async function handleSelTouchEnd(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const start = selStartRef.current;
    if (!start || !capturedPreview) { setSelecting(false); return; }
    const canvas = selectCanvasRef.current;
    if (!canvas) { setSelecting(false); return; }
    const rect = canvas.getBoundingClientRect();
    // Get final finger position (changedTouches for touchend)
    const t = e.changedTouches[0];
    const cx = t.clientX - rect.left;
    const cy = t.clientY - rect.top;
    const selX = Math.min(start.x, cx);
    const selY = Math.min(start.y, cy);
    const selW = Math.abs(cx - start.x);
    const selH = Math.abs(cy - start.y);
    if (selW < 20 || selH < 20) { setSelecting(false); return; }

    // Crop the region from the original image
    const img = new window.Image();
    img.onload = async () => {
      const scaleX = img.naturalWidth / canvas.width;
      const scaleY = img.naturalHeight / canvas.height;
      const cropCanvas = document.createElement('canvas');
      const cw = Math.max(1, Math.round(selW * scaleX));
      const ch = Math.max(1, Math.round(selH * scaleY));
      cropCanvas.width = cw;
      cropCanvas.height = ch;
      const ctx2 = cropCanvas.getContext('2d');
      if (!ctx2) { setSelecting(false); return; }
      ctx2.drawImage(img, selX * scaleX, selY * scaleY, cw, ch, 0, 0, cw, ch);
      const base64 = cropCanvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      setSelecting(false);
      setPhase('analyzing');
      try {
        const res = await analyzeImage(base64);
        setEditedNodes((prev) => [...prev, ...toEditedNodes(res.nodes)]);
        setPhase('result');
      } catch {
        setPhase('result');
      }
    };
    img.src = capturedPreview;
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
            <div className="nesio-camera-chooser-actions">
              {phase === 'idle' && (
                <button type="button" className="nesio-camera-shoot-btn" onClick={openNativeCamera}>
                  拍照
                </button>
              )}
              <button type="button" className="nesio-camera-pick-btn" onClick={handleGallery}>
                <span className="nesio-camera-pick-btn-icon" aria-hidden>🖼️</span>
                相册
              </button>
            </div>
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

      {/* Analysis result — editable */}
      {phase === 'result' && result && (
        <div className="nesio-camera-result-panel">
          {isReceipt && (
            <div className="nesio-camera-receipt-banner">
              🧾 检测到小票，已列出条目，可编辑名称或添加有效期
            </div>
          )}
          <p className="nesio-camera-result-summary">{result.summary}</p>

          <div className="nesio-camera-result-nodes">
            {editedNodes.map((node, i) => node.deleted ? null : (
              <div key={i} className="nesio-camera-result-node nesio-camera-result-node--editable">
                {/* Type chips */}
                <div className="nesio-camera-node-type-row">
                  {ALL_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`nesio-camera-type-chip${node.type === t ? ' nesio-camera-type-chip--active' : ''}`}
                      onClick={() => setEditedNodes((prev) => prev.map((n, j) => j === i ? { ...n, type: t } : n))}
                    >
                      {TYPE_ICON[t]}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="nesio-camera-node-delete"
                    aria-label="删除此条"
                    onClick={() => setEditedNodes((prev) => prev.map((n, j) => j === i ? { ...n, deleted: true } : n))}
                  >✕</button>
                </div>

                {/* Editable name */}
                <input
                  className="nesio-camera-node-name-input"
                  value={node.name}
                  onChange={(e) => setEditedNodes((prev) => prev.map((n, j) => j === i ? { ...n, name: e.target.value } : n))}
                  placeholder="名称"
                />

                {/* Note */}
                <input
                  className="nesio-camera-node-note-input"
                  value={node.note || ''}
                  onChange={(e) => setEditedNodes((prev) => prev.map((n, j) => j === i ? { ...n, note: e.target.value } : n))}
                  placeholder="补充一句描述…（可选）"
                />

                {/* Expiry — shown for objects or receipt items */}
                {(node.type === 'object' || isReceipt) && (
                  <div className="nesio-camera-node-expiry-row">
                    <span className="nesio-camera-node-expiry-label">有效期</span>
                    <input
                      type="date"
                      className="nesio-camera-node-expiry-input"
                      value={node.expiry || ''}
                      onChange={(e) => setEditedNodes((prev) => prev.map((n, j) => j === i ? { ...n, expiry: e.target.value } : n))}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Add extra item */}
          <button
            type="button"
            className="nesio-camera-add-item-btn"
            onClick={() => setEditedNodes((prev) => [...prev, {
              name: '', type: 'object', attributes: {}, tags: [], source: 'photo',
              confidence: 1, relations: [], deleted: false,
            }])}
          >
            + 添加条目
          </button>

          <label className="nesio-camera-tag-field">
            <span>标签</span>
            <input
              value={extraTags}
              onChange={(e) => setExtraTags(e.target.value)}
              placeholder="#钥匙 #门口 #Linda礼物"
              aria-label="图片标签"
            />
          </label>

          <div className="nesio-camera-result-actions">
            <button
              type="button"
              className="nesio-camera-save-btn"
              onClick={saveAll}
              disabled={editedNodes.filter((n) => !n.deleted).length === 0}
            >
              存入 Memory ({editedNodes.filter((n) => !n.deleted).length} 条)
            </button>
            <button type="button" className="nesio-camera-retake-btn" onClick={retake}>重拍</button>
          </div>

          {/* Bounding-box selection — only when there's a captured image */}
          {capturedPreview && (
            <button type="button" className="nesio-camera-select-btn" onClick={openSelection}>
              🖊 再圈一个区域
            </button>
          )}
        </div>
      )}

      {/* Selection overlay — finger-draw to crop & analyze a region */}
      {selecting && capturedPreview && (
        <div className="nesio-select-overlay">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={capturedPreview} alt="" className="nesio-select-image" draggable={false} />
          <canvas
            ref={selectCanvasRef}
            className="nesio-select-canvas"
            onTouchStart={handleSelTouchStart}
            onTouchMove={handleSelTouchMove}
            onTouchEnd={handleSelTouchEnd}
          />
          <div className="nesio-select-hint">用手指画框，圈住要识别的区域</div>
          <button type="button" className="nesio-select-cancel" onClick={() => setSelecting(false)}>取消</button>
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
