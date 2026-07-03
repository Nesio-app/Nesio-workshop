'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { addLifeNode, getLifeGraph, updateLifeNode, type LifeNode, type LifeNodeAsset } from '@/lib/portal/life-graph';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import { matchNearestPlace, formatLocation, getNamedPlaces } from '@/lib/portal/named-places';
import LocationPicker from './LocationPicker';

// ── Similarity check (拍照发现已有) ────────────────────────────────────────

interface SimilarItem { node: LifeNode; score: number }

function findSimilarObjects(name: string, tags: string[]): SimilarItem[] {
  const graph = getLifeGraph();
  const candidates = graph.filter((n) => n.type === 'object');
  const nameLower = name.toLowerCase().replace(/\s+/g, '');
  const results: SimilarItem[] = [];

  for (const n of candidates) {
    const nName = n.name.toLowerCase().replace(/\s+/g, '');
    let score = 0;
    // Exact or near-exact name match
    if (nName === nameLower) { score = 1.0; }
    else if (nName.includes(nameLower) || nameLower.includes(nName)) { score = 0.8; }
    else {
      // Character overlap for Chinese
      const overlapChars = Array.from(nameLower).filter((c) => nName.includes(c)).length;
      const overlapRatio = overlapChars / Math.max(nameLower.length, nName.length, 1);
      if (overlapRatio >= 0.5) score = overlapRatio * 0.6;
    }
    // Tag overlap bonus
    if (score > 0 && tags.length > 0) {
      const tagOverlap = (n.tags ?? []).filter((t) => tags.includes(t)).length;
      if (tagOverlap > 0) score = Math.min(1, score + 0.1 * tagOverlap);
    }
    if (score >= 0.5) results.push({ node: n, score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 3);
}

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

const FULL_IMAGE_PROMPT = '请只根据图片里真实可见的内容生成 Memory 节点。如果是小票/收据：为每个购买条目单独生成一个 object 节点（名称用中文，如”草莓冰淇淋”、”蜂蜜柚子茶”），attributes 加 price 和 receiptDate；如果能识别出商家名称，将其加入每个节点的 attributes.store 字段；如果能识别出支付方式（如 AMEX、Visa、微信支付），将其加入 attributes.paymentMethod 字段；不要单独为商店生成 place 节点，不要生成收据汇总节点。其他情况：优先识别具体物品、文件、场景；除非图片里清楚有人，否则不要生成”人物”节点；不要把这段指令当成节点名称。';
const CROP_PROMPT = '用户已圈选了图片中的特定区域（圈外已遮黑）。请只识别圈内最主要的1-2个物品，生成对应 Memory 节点。不要识别背景、黑色遮罩区域或其他无关物体。';

async function analyzeImage(base64: string, prompt?: string): Promise<AnalysisResult> {
  const res = await fetch('/api/portal/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-baohe-access-mode': 'personal_lab' },
    body: JSON.stringify({
      type: 'image',
      content: prompt ?? FULL_IMAGE_PROMPT,
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

  // 'preview' = photo taken but not yet analyzed (user chooses full/crop)
  const [phase, setPhase] = useState<'idle' | 'live' | 'captured' | 'analyzing' | 'result' | 'saved' | 'no-camera'>('idle');
  const [capturedPreview, setCapturedPreview] = useState<string>('');
  const [capturedBase64, setCapturedBase64] = useState<string>(''); // raw base64 for full-image analysis
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [editedNodes, setEditedNodes] = useState<EditedNode[]>([]);
  const [isReceipt, setIsReceipt] = useState(false);
  const [permDenied, setPermDenied] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [error, setError] = useState('');
  const [extraTags, setExtraTags] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  // Freehand selection state
  const [selecting, setSelecting] = useState(false);
  const selStartRef = useRef<{ x: number; y: number } | null>(null);
  const selPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  // Auto-detected place from GPS (used to pre-fill location on object nodes)
  const [detectedPlaceId, setDetectedPlaceId] = useState<string>('');
  // Per-node location overrides (index → formatted location string)
  const [nodeLocations, setNodeLocations] = useState<Record<number, string>>({});
  // Similarity check result (per node index)
  const [similarItems, setSimilarItems] = useState<Record<number, SimilarItem[]>>({});
  const [dismissedSimilar, setDismissedSimilar] = useState<Set<number>>(new Set());

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
    setCapturedBase64('');
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

    // Compress and store, then go straight to selection/drawing
    const base64 = await compressImage(canvas);
    setCapturedBase64(base64);
    setSelecting(true);
  }

  // Try to match current GPS to a named place and pre-fill location fields
  async function tryMatchGpsAndPrefill(nodes: EditedNode[]) {
    const loc = await getCurrentLocation();
    if (!loc) return;
    const place = matchNearestPlace(loc.lat, loc.lon);
    if (!place) return;
    setDetectedPlaceId(place.id);
    const defaults: Record<number, string> = {};
    nodes.forEach((n, i) => {
      if (n.type === 'object') defaults[i] = `${place.emoji} ${place.name}`;
    });
    if (Object.keys(defaults).length > 0) setNodeLocations(defaults);
  }

  // Analyze the full captured image (called from selection overlay or result phase)
  async function analyzeFullImage() {
    if (!capturedBase64) return;
    setSelecting(false);
    setPhase('analyzing');
    setError('');
    try {
      const res = await analyzeImage(capturedBase64);
      const nodes = toEditedNodes(res.nodes);
      setResult(res);
      setEditedNodes(nodes);
      setIsReceipt(detectReceipt(res));
      setPhase('result');
      tryMatchGpsAndPrefill(nodes);
      // Check for similar existing objects
      const similars: Record<number, SimilarItem[]> = {};
      nodes.forEach((n, i) => {
        if (n.type === 'object') {
          const found = findSimilarObjects(n.name, n.tags ?? []);
          if (found.length > 0) similars[i] = found;
        }
      });
      if (Object.keys(similars).length > 0) setSimilarItems(similars);
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

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setCapturedPreview(dataUrl);
      setCapturedBase64(dataUrl.split(',')[1]);
      setPhase('captured');
      setSelecting(true);
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

    const savedNodes = nodesToSave.map((n, i) => {
      const origIdx = editedNodes.indexOf(n);
      const locationVal = nodeLocations[origIdx] ?? '';
      return addLifeNode({
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
          ...(locationVal ? { location: locationVal as string } : {}),
          ...(n.note?.trim() ? { note: n.note.trim() as string } : {}),
          ...(n.expiry?.trim() ? { expiry: n.expiry.trim() as string } : {}),
          ...(userTags.length ? { userTags: userTags.join(', ') as string } : {}),
        },
      });
    });
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
    setTimeout(() => { onClose(); setPhase('idle'); setResult(null); setExtraTags(''); setSourceFile(null); setNodeLocations({}); setDetectedPlaceId(''); }, 900);
  }

  function retake() {
    setSelecting(false);
    setResult(null); setEditedNodes([]); setIsReceipt(false);
    setCapturedPreview(''); setCapturedBase64(''); setError(''); setExtraTags(''); setSourceFile(null);
    setNodeLocations({}); setDetectedPlaceId('');
    setSimilarItems({}); setDismissedSimilar(new Set());
    setPhase('idle');
    openNativeCamera();
  }

  // ── Bounding-box selection ──────────────────────────────────────────────

  // Init canvas dimensions after the overlay mounts (selecting=true causes the
  // canvas to appear in DOM; we size it here via useEffect so the ref is valid)
  useEffect(() => {
    if (!selecting) return;
    const canvas = selectCanvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (parent) {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    }
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    selStartRef.current = null;
  }, [selecting]);

  function openSelection() {
    setSelecting(true); // overlay mounts → useEffect sizes canvas
  }

  function handleSelTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const t = e.touches[0];
    const pt = { x: t.clientX - rect.left, y: t.clientY - rect.top };
    selStartRef.current = pt;
    selPointsRef.current = [pt];
    const canvas = selectCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
  }

  function handleSelTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (!selStartRef.current) return;
    const canvas = selectCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = e.touches[0];
    const pt = { x: t.clientX - rect.left, y: t.clientY - rect.top };
    selPointsRef.current.push(pt);
    // Redraw entire freehand path each move for smoothness
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const pts = selPointsRef.current;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.fillStyle = 'rgba(59,130,246,0.12)';
    ctx.fill();
  }

  async function handleSelTouchEnd(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const pts = selPointsRef.current;
    if (pts.length < 3 || !capturedPreview) { setSelecting(false); return; }
    const canvas = selectCanvasRef.current;
    if (!canvas) { setSelecting(false); return; }

    // Bounding box of all freehand points
    const minX = Math.min(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxX = Math.max(...pts.map((p) => p.x));
    const maxY = Math.max(...pts.map((p) => p.y));
    const selW = maxX - minX;
    const selH = maxY - minY;
    if (selW < 20 || selH < 20) { setSelecting(false); return; }

    // Map canvas coords → image pixels, accounting for object-fit:contain letterboxing
    const img = new window.Image();
    img.onload = async () => {
      const canvasAspect = canvas.width / canvas.height;
      const imgAspect = img.naturalWidth / img.naturalHeight;
      let renderedW: number, renderedH: number, offsetX: number, offsetY: number;
      if (imgAspect > canvasAspect) {
        renderedW = canvas.width;
        renderedH = canvas.width / imgAspect;
        offsetX = 0;
        offsetY = (canvas.height - renderedH) / 2;
      } else {
        renderedH = canvas.height;
        renderedW = canvas.height * imgAspect;
        offsetX = (canvas.width - renderedW) / 2;
        offsetY = 0;
      }
      const imgX = Math.max(0, (minX - offsetX) / renderedW * img.naturalWidth);
      const imgY = Math.max(0, (minY - offsetY) / renderedH * img.naturalHeight);
      const imgW = Math.min(img.naturalWidth - imgX, selW / renderedW * img.naturalWidth);
      const imgH = Math.min(img.naturalHeight - imgY, selH / renderedH * img.naturalHeight);
      if (imgW < 10 || imgH < 10) { setSelecting(false); return; }

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = Math.round(imgW);
      cropCanvas.height = Math.round(imgH);
      const ctx2 = cropCanvas.getContext('2d');
      if (!ctx2) { setSelecting(false); return; }
      // Mask: fill black, clip to drawn shape, draw only the circled region
      ctx2.fillStyle = '#000';
      ctx2.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
      ctx2.beginPath();
      pts.forEach((p, i) => {
        const cx = (p.x - offsetX) / renderedW * img.naturalWidth - imgX;
        const cy = (p.y - offsetY) / renderedH * img.naturalHeight - imgY;
        if (i === 0) ctx2.moveTo(cx, cy); else ctx2.lineTo(cx, cy);
      });
      ctx2.closePath();
      ctx2.clip();
      ctx2.drawImage(img, imgX, imgY, imgW, imgH, 0, 0, imgW, imgH);
      const base64 = cropCanvas.toDataURL('image/jpeg', 0.88).split(',')[1];
      setSelecting(false);
      setPhase('analyzing');
      try {
        const res = await analyzeImage(base64, CROP_PROMPT);
        const newNodes = toEditedNodes(res.nodes);
        setResult((prev) => prev ? { ...prev, nodes: [...prev.nodes, ...res.nodes] } : res);
        setEditedNodes((prev) => {
          const updated = [...prev, ...newNodes];
          tryMatchGpsAndPrefill(updated);
          return updated;
        });
        setIsReceipt((prev) => prev || detectReceipt(res));
        setPhase('result');
      } catch {
        if (!result) {
          const pending = buildPendingImageResult();
          setResult(pending);
          setEditedNodes(toEditedNodes(pending.nodes));
        }
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
          {{ idle: '拍一下', live: '拍一下', captured: '处理中', analyzing: '识别中', result: '识别结果', saved: '已保存', 'no-camera': '上传图片' }[phase as 'idle' | 'live' | 'captured' | 'analyzing' | 'result' | 'saved' | 'no-camera']}
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

          {/* Bounding-box selection button — top of result, next to summary */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <p className="nesio-camera-result-summary" style={{ margin: 0, flex: 1 }}>{result.summary}</p>
            {capturedPreview && (
              <button type="button" className="nesio-camera-select-btn" onClick={openSelection}>
                🖊 圈选
              </button>
            )}
          </div>

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

                {/* Similarity alert */}
                {similarItems[i] && !dismissedSimilar.has(i) && (
                  <div className="nesio-camera-similar-alert">
                    <span className="nesio-camera-similar-icon">🤔</span>
                    <div className="nesio-camera-similar-body">
                      <p className="nesio-camera-similar-title">等等，你好像已经有了</p>
                      {similarItems[i].slice(0, 2).map((s) => (
                        <p key={s.node.id} className="nesio-camera-similar-item">
                          📦 {s.node.name}
                          {s.node.attributes?.location ? <span className="nesio-camera-similar-loc"> · {String(s.node.attributes.location)}</span> : null}
                        </p>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="nesio-camera-similar-dismiss"
                      onClick={() => setDismissedSimilar((prev) => new Set(Array.from(prev).concat(i)))}
                      aria-label="忽略"
                    >✕</button>
                  </div>
                )}

                {/* Location — shown for objects, hierarchical picker */}
                {node.type === 'object' && (
                  <div className="nesio-camera-node-loc-row">
                    <span className="nesio-camera-node-expiry-label">存放位置</span>
                    <LocationPicker
                      value={nodeLocations[i] ?? ''}
                      onChange={(v) => setNodeLocations((prev) => ({ ...prev, [i]: v }))}
                      className="nesio-camera-loc-picker"
                    />
                  </div>
                )}

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
          <div className="nesio-select-hint">用手指随意圈住要识别的区域</div>
          <div className="nesio-select-overlay-actions">
            <button type="button" className="nesio-select-action-btn" onClick={analyzeFullImage}>🔍 全图</button>
            <button type="button" className="nesio-select-action-btn" onClick={retake}>↩ 重拍</button>
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
