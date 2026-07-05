'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { getLifeGraph, updateLifeNode, type LifeNode, type LifeNodeAsset } from '@/lib/portal/life-graph';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import { matchNearestPlace, formatLocation, getNamedPlaces } from '@/lib/portal/named-places';
import LocationPicker from './LocationPicker';
import { IconBox, IconCamera, IconImage } from './icons';
import { PurchaseCoolingPanel } from './PurchaseCoolingPanel';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

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

interface CameraSheetProps {
  open: boolean;
  onClose: () => void;
  /** 扇形按钮同手势拍到的照片 — 有它就跳过选择页直接进识别流。 */
  initialFile?: File | null;
}

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

async function analyzeImage(base64: string, prompt?: string, dict: string = 'zh'): Promise<AnalysisResult> {
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
  return { nodes: data.nodes, summary: data.summary || L(dict, '识别完成', 'Recognition done') };
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

function buildPendingImageResult(dict: string = 'zh'): AnalysisResult {
  return {
    summary: L(dict, '已先保存为待确认图片线索。登录或 Lab 模式后可自动识别标签。', 'Saved as an unconfirmed image clue for now. Sign in or enable Lab mode for auto-tagging.'),
    nodes: [
      {
        type: 'object',
        name: L(dict, '待确认图片线索', 'Unconfirmed image clue'),
        attributes: { status: L(dict, '待确认', 'Unconfirmed'), note: L(dict, '图片已保存，标签等待你确认或登录后自动识别。', 'Image saved; tags await your confirmation or auto-recognition after sign-in.') },
        relations: [],
        tags: [L(dict, '图片', 'image'), L(dict, '待确认', 'unconfirmed')],
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

export default function CameraSheet({ open, onClose, initialFile }: CameraSheetProps) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
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
  const [saving, setSaving] = useState(false); // 批次 35:存入按钮即时反馈,避免「点了没反应」
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
    // 扇形按钮已在同一手势里拍好照片 → 直接进识别流,不显示选择页。
    if (initialFile) void processFile(initialFile);
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stopCamera, initialFile]);

  function openNativeCamera() { cameraInputRef.current?.click(); }

  async function capturePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      setError(L(dict, '相机未就绪，请稍后再试。', 'Camera not ready — try again shortly.'));
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
      const res = await analyzeImage(capturedBase64, undefined, dict);
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
        const pending = buildPendingImageResult(dict);
        setResult(pending);
        setEditedNodes(toEditedNodes(pending.nodes));
        setIsReceipt(false);
        setPhase('result');
        return;
      }
      setError(L(dict, '识别失败。你可以先保存为待确认图片线索。', 'Recognition failed. You can save it as an unconfirmed image clue for now.'));
      setResult(buildPendingImageResult(dict));
      setPhase('result');
    }
  }

  function handleGallery() { fileRef.current?.click(); }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await processFile(file);
  }

  async function processFile(file: File) {
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
        const fileResult = { nodes: data.nodes || [], summary: data.summary || L(dict, '提取完成', 'Extraction done') };
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
    if (!nodesToSave.length || saving) return;
    setSaving(true); // 立刻反馈:按钮变「保存中…」+ 禁用,避免用户以为没点上
    try {
      await doSave(nodesToSave);
      setPhase('saved');
      setTimeout(() => { onClose(); setPhase('idle'); setResult(null); setExtraTags(''); setSourceFile(null); setNodeLocations({}); setDetectedPlaceId(''); setSaving(false); }, 1200);
    } catch {
      setSaving(false);
      setError(L(dict, '存入失败，请重试', 'Save failed — please try again'));
    }
  }

  async function doSave(nodesToSave: EditedNode[]) {
    const userTags = parseInlineTags(extraTags);

    // Best-effort location — attach if permission already granted
    const loc = await getCurrentLocation();
    const locAttrs = loc ? { lat: loc.lat, lon: loc.lon } : {};

    const savedNodes = nodesToSave.map((n, i) => {
      const origIdx = editedNodes.indexOf(n);
      const locationVal = nodeLocations[origIdx] ?? '';
      return ingestLifeNode({
        name: n.name.trim() || L(dict, '未命名条目', 'Untitled item'),
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
    // 批次 23:先把照片压缩存本机 IndexedDB,挂一条本地 asset——
    // 未登录/离线也能在节点详情看图、问一问也能拿到图。云端上传照旧(并行)。
    if (savedNodes.length > 0) {
      try {
        const { compressToDataUrl, putLocalImage } = await import('@/lib/portal/local-image-store');
        const dataUrl = sourceFile
          ? await compressToDataUrl(sourceFile)
          : (capturedBase64 ? `data:image/jpeg;base64,${capturedBase64}` : '');
        if (dataUrl) {
          const localAssetId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          await putLocalImage(localAssetId, dataUrl);
          const existing = savedNodes[0].assets || [];
          updateLifeNode(savedNodes[0].id, {
            assets: [...existing, { id: localAssetId, kind: 'image', mimeType: 'image/jpeg', local: true, createdAt: new Date().toISOString() }],
          });
        }
      } catch { /* 图片存本机是增强,失败不影响文字记忆 */ }
    }

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
    // eslint-disable-next-line no-restricted-syntax -- canvas strokeStyle 无法解析 var(),真实色值兜底镜像 --portal-blue-deep
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--portal-blue-deep').trim() || '#588ce3';
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
        const res = await analyzeImage(base64, CROP_PROMPT, dict);
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
          const pending = buildPendingImageResult(dict);
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
    <div className="nesio-camera-sheet" role="dialog" aria-modal="true" aria-label={L(dict, '拍一下', 'Snap')}>
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      {/* Native camera — opens the iOS system camera directly (reliable, no
          persistent stream/indicator). Triggered by a user tap. */}
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFileChange} />
      {/* Gallery / file picker — no capture, so it picks from library/files. */}
      <input ref={fileRef} type="file" accept="image/*,.pdf,.txt,.eml" style={{ display: 'none' }} onChange={handleFileChange} />

      {/* Header */}
      <div className="nesio-camera-header">
        <button type="button" className="nesio-camera-close" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="18" height="18">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <h2 className="nesio-camera-title">
          {L(dict, { idle: '拍一下', live: '拍一下', captured: '处理中', analyzing: '识别中', result: '识别结果', saved: '已保存', 'no-camera': '上传图片' }[phase as 'idle' | 'live' | 'captured' | 'analyzing' | 'result' | 'saved' | 'no-camera'], { idle: 'Snap', live: 'Snap', captured: 'Processing', analyzing: 'Recognizing', result: 'Results', saved: 'Saved', 'no-camera': 'Upload image' }[phase as 'idle' | 'live' | 'captured' | 'analyzing' | 'result' | 'saved' | 'no-camera'])}
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
            alt={L(dict, '拍摄的照片', 'Captured photo')}
            className="nesio-camera-video camera-callout-none"
            style={{ objectFit: 'cover' }}
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
          />
        )}

        {/* Capture chooser (native camera) / no-camera fallback */}
        {(phase === 'idle' || phase === 'no-camera') && (
          <div className="nesio-camera-chooser">
            <span className="nesio-camera-chooser-icon" aria-hidden><IconCamera size={30} /></span>
            <p className="nesio-camera-chooser-text">
              {phase === 'idle'
                ? L(dict, '拍一张，Nesio 帮你识别并存入 Memory', 'Take a photo — Nesio recognizes it into Memory')
                : L(dict, '此设备不支持相机，请从相册选择', 'No camera on this device — pick from Photos')}
            </p>
            <div className="nesio-camera-chooser-actions">
              {phase === 'idle' && (
                <button type="button" className="nesio-camera-shoot-btn" onClick={openNativeCamera}>
                  {L(dict, '拍照', 'Take photo')}
                </button>
              )}
              <button type="button" className="nesio-camera-pick-btn" onClick={handleGallery}>
                <span className="nesio-camera-pick-btn-icon" aria-hidden><IconImage size={15} /></span>
                {L(dict, '相册', 'Photos')}
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
            {L(dict, 'Nesio 正在识别…', 'Nesio is recognizing…')}
          </div>
        )}

        {error && (
          <div className="nesio-camera-recognizing" style={{ color: 'var(--status-risk-soft)', borderColor: 'var(--status-risk)', background: 'rgba(30,15,15,0.85)' }}>
            {error}
          </div>
        )}
      </div>

      {/* Analysis result — editable */}
      {phase === 'result' && result && (
        <div className="nesio-camera-result-panel">
          {isReceipt && (
            <div className="nesio-camera-receipt-banner">
              {L(dict, '检测到小票，已列出条目，可编辑名称或添加有效期', 'Receipt detected — items listed; edit names or add expiry')}
            </div>
          )}

          {/* 购买冷静(批次 7):拍到想买的东西 → 已有类似 + 时薪换算 + 冻结 */}
          {!isReceipt && editedNodes.some((n) => !n.deleted && n.type === 'object') && (() => {
            const firstObjIdx = editedNodes.findIndex((n) => !n.deleted && n.type === 'object');
            const firstObj = editedNodes[firstObjIdx];
            const sims = similarItems[firstObjIdx] || [];
            return (
              <PurchaseCoolingPanel
                productName={firstObj.name || L(dict, '这件东西', 'this item')}
                similarCount={sims.length}
                similarExample={sims[0]?.node.name}
              />
            );
          })()}

          {/* Bounding-box selection button — top of result, next to summary */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <p className="nesio-camera-result-summary" style={{ margin: 0, flex: 1 }}>{result.summary}</p>
            {capturedPreview && (
              <button type="button" className="nesio-camera-select-btn" onClick={openSelection}>
                {L(dict, '圈选', 'Circle')}
              </button>
            )}
          </div>

          <div className="nesio-camera-result-nodes">
            {editedNodes.map((node, i) => node.deleted ? null : (
              <div key={i} className="nesio-camera-result-node nesio-camera-result-node--editable">
                {/* 批次 16:类型选择行删除——AI 按照片内容识别(小票/物品/文档…),
                    不再让人手挑 emoji 图标;只留删除按钮 */}
                <div className="nesio-camera-node-type-row" style={{ justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="nesio-camera-node-delete"
                    aria-label={L(dict, '删除此条', 'Delete this item')}
                    onClick={() => setEditedNodes((prev) => prev.map((n, j) => j === i ? { ...n, deleted: true } : n))}
                  >✕</button>
                </div>

                {/* Editable name */}
                <input
                  className="nesio-camera-node-name-input"
                  value={node.name}
                  onChange={(e) => setEditedNodes((prev) => prev.map((n, j) => j === i ? { ...n, name: e.target.value } : n))}
                  placeholder={L(dict, '名称', 'Name')}
                />

                {/* Note */}
                <input
                  className="nesio-camera-node-note-input"
                  value={node.note || ''}
                  onChange={(e) => setEditedNodes((prev) => prev.map((n, j) => j === i ? { ...n, note: e.target.value } : n))}
                  placeholder={L(dict, '补充一句描述…（可选）', 'Add a line of description… (optional)')}
                />

                {/* Similarity alert */}
                {similarItems[i] && !dismissedSimilar.has(i) && (
                  <div className="nesio-camera-similar-alert">
                    <span className="nesio-camera-similar-icon"><IconBox size={14} /></span>
                    <div className="nesio-camera-similar-body">
                      <p className="nesio-camera-similar-title">{L(dict, '等等，你好像已经有了', 'Wait — you might already have this')}</p>
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
                      aria-label={L(dict, '忽略', 'Dismiss')}
                    >✕</button>
                  </div>
                )}

                {/* Location — shown for objects, hierarchical picker */}
                {node.type === 'object' && (
                  <div className="nesio-camera-node-loc-row">
                    <span className="nesio-camera-node-expiry-label">{L(dict, '存放位置', 'Stored at')}</span>
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
                    <span className="nesio-camera-node-expiry-label">{L(dict, '有效期', 'Expires')}</span>
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
            {L(dict, '+ 添加条目', '+ Add item')}
          </button>

          <label className="nesio-camera-tag-field">
            <span>{L(dict, '标签', 'Tags')}</span>
            <input
              value={extraTags}
              onChange={(e) => setExtraTags(e.target.value)}
              placeholder={L(dict, '#钥匙 #门口 #Linda礼物', '#keys #entry #LindaGift')}
              aria-label={L(dict, '图片标签', 'Image tags')}
            />
          </label>

          <div className="nesio-camera-result-actions">
            <button
              type="button"
              className="nesio-camera-save-btn"
              onClick={saveAll}
              disabled={saving || editedNodes.filter((n) => !n.deleted).length === 0}
            >
              {saving
                ? L(dict, '保存中…', 'Saving…')
                : L(dict, `存入 Memory (${editedNodes.filter((n) => !n.deleted).length} 条)`, `Save to Memory (${editedNodes.filter((n) => !n.deleted).length})`)}
            </button>
            <button type="button" className="nesio-camera-retake-btn" onClick={retake}>{L(dict, '重拍', 'Retake')}</button>
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
          <div className="nesio-select-hint">{L(dict, '用手指随意圈住要识别的区域', 'Circle the area to recognize with your finger')}</div>
          <div className="nesio-select-overlay-actions">
            <button type="button" className="nesio-select-action-btn" onClick={analyzeFullImage}>{L(dict, '🔍 全图', '🔍 Full image')}</button>
            <button type="button" className="nesio-select-action-btn" onClick={retake}>{L(dict, '↩ 重拍', '↩ Retake')}</button>
          </div>
        </div>
      )}

      {phase === 'saved' && (
        <div className="nesio-camera-result-panel" style={{ textAlign: 'center', padding: '1.5rem 1.25rem' }}>
          <p style={{ color: 'var(--status-go)', fontSize: '2rem', margin: 0, lineHeight: 1 }}>✓</p>
          <p style={{ color: 'var(--status-go)', fontSize: '1.1rem', fontWeight: 700, marginTop: '0.5rem' }}>{L(dict, '已存入 Memory', 'Saved to Memory')}</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>{L(dict, '在「记忆」里查看', 'View it in Memory')}</p>
        </div>
      )}

    </div>
  );
}
