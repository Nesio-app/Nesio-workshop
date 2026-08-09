'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { createPortal } from 'react-dom';
import dynamicImport from 'next/dynamic';
const MemoryNodeDetailLazy = dynamicImport(() => import('./MemoryNodeDetail'), { ssr: false });
import { getLifeGraph, updateLifeNode, type LifeNode } from '@/lib/portal/life-graph';
import { matchNearestPlace, formatLocation, getNamedPlaces } from '@/lib/portal/named-places';
import LocationPicker from './LocationPicker';
import { IconCamera, IconImage, NodeTypeIcon } from './icons';
import { consolidateAmazonOrder } from '@/lib/portal/amazon-order';
import { appendShoppingReceipt, buildUsableReceiptLines, consumeTravelReceiptTripId, clearTravelReceiptTripId, peekTravelReceiptTripId } from '@/lib/portal/travel-trips';
import { addReceiptExpense, defaultFinanceCurrency } from '@/lib/portal/finance-sources';
import Button from './ui/Button';
import { understandImage, tagsFromText, type UnderstandResult } from '@/lib/portal/image-understand';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { localDayKey } from '@/lib/portal/local-day';
import { prepareCapturedPhoto, type CapturedPhoto, type ModeCameraMode } from '@/lib/portal/capture-pipeline';

// ── Similarity check (拍照发现已有) ────────────────────────────────────────

interface SimilarItem { node: LifeNode; score: number }

function findSimilarObjects(name: string, tags: string[]): SimilarItem[] {
  const graph = getLifeGraph();
  const candidates = graph.filter((n) => n.type === 'Thing');
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
  /** 进货模式:非空时,拍到的 object 节点打上该后台子类(如「食材」→ 进「做饭·库存」)。复用整条相机管线。 */
  intakeSubtype?: string;
  /**
   * 模式相机(「一个相机、多种模式」):记一餐/衣帽间带模式调起主相机 ——
   * 取景框/相册/压缩全复用,拍完把照片交回入口(onModeCaptured),不走记忆识别流。
   */
  mode?: ModeCameraMode;
  onModeCaptured?: (photo: CapturedPhoto) => void;
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

// 图片指令随 UI 语言:节点名称不再硬编码「用中文」(那会让英文用户拿到中文节点)。
function fullImagePrompt(en: boolean): string {
  return en
    ? 'Generate Memory nodes only from what is actually visible in the image. Receipts: create a separate object node per purchased item, add price and receiptDate to attributes; if a store name is visible add it to attributes.store; if a payment method is visible (AMEX/Visa/etc) add attributes.paymentMethod; do NOT create a place node for the store, do NOT create a receipt-summary node. Otherwise: prefer concrete items, documents, scenes; do NOT create a "person" node unless a person is clearly present; never use this instruction as a node name.'
    : '请只根据图片里真实可见的内容生成 Memory 节点。如果是小票/收据：为每个购买条目单独生成一个 object 节点，attributes 加 price 和 receiptDate；如果能识别出商家名称，将其加入每个节点的 attributes.store 字段；如果能识别出支付方式（如 AMEX、Visa、微信支付），将其加入 attributes.paymentMethod 字段；不要单独为商店生成 place 节点，不要生成收据汇总节点。其他情况：优先识别具体物品、文件、场景；除非图片里清楚有人，否则不要生成"人物"节点；不要把这段指令当成节点名称。';
}
function cropPrompt(en: boolean): string {
  return en
    ? 'The user has circled a specific region of the image (outside is masked black). Recognize only the main 1-2 items inside the circle and generate Memory nodes. Ignore the background, the black mask, and unrelated objects.'
    : '用户已圈选了图片中的特定区域（圈外已遮黑）。请只识别圈内最主要的1-2个物品，生成对应 Memory 节点。不要识别背景、黑色遮罩区域或其他无关物体。';
}

function orderPrompt(en: boolean): string {
  return en
    ? 'This is an online shopping ORDER / receipt screenshot (e.g. Amazon). Produce EXACTLY ONE object node for the purchased product (use the product title as the node name). Put ONLY into that node\'s attributes: orderNo (the order number string), buyPrice (item subtotal / pre-tax total as a number), tax (tax amount as a number), seller (the "Sold by" merchant), orderedAt (order placed date YYYY-MM-DD), arrivedAt (delivery/arrival date YYYY-MM-DD if shown). Do NOT create separate nodes for totals, tax, order number or store; do NOT create place or person nodes.'
    : '这是一张网购订单/收据截图(如亚马逊)。请只生成 1 个 object 节点代表所购商品(节点名用商品标题)。只把这些放进该节点的 attributes:orderNo(订单号字符串)、buyPrice(税前小计/商品总价,数字)、tax(税费,数字)、seller(Sold by 商家)、orderedAt(下单日期 YYYY-MM-DD)、arrivedAt(到货/送达日期 YYYY-MM-DD,若有)。不要为总计、税费、订单号、店铺单独生成节点;不要生成地点或人物节点。';
}
// 进货模式:食材专用识别 —— 逐个认出食材、用通用名、数量/保质期入 attributes。
function foodPrompt(en: boolean): string {
  return en
    ? 'This is a photo of groceries / food (fridge, dishes, shopping bag, etc.). For EACH visible ingredient/food item, create ONE object node whose name is the food\'s common name (e.g. "tomato", "egg", "milk", "spinach" — NOT quantified names like "a box of eggs"). If the count is visible, put it in attributes.quantity (a number). If a printed expiry / best-before date is legible, put it in attributes.expiry (YYYY-MM-DD). Do NOT create place or person nodes, and do NOT create a summary node.'
    : '这是一张食材/食品照片(冰箱、菜、购物袋等)。请为每一种可见的食材/食品单独生成一个 object 节点,节点名用食材的通用名(如「西红柿」「鸡蛋」「牛奶」「菠菜」,不要写「一盒鸡蛋」这类带量词的长名)。数量能数清就放进 attributes.quantity(数字);包装上印的保质期/到期日能看清就放进 attributes.expiry(YYYY-MM-DD)。不要生成地点或人物节点,不要生成汇总节点。';
}
async function analyzeImage(base64: string, prompt?: string, dict: string = 'zh'): Promise<AnalysisResult> {
  // 2026-07-31:workshop **不分收费免费** —— 这里原来是付费门(免费层不打云视觉,
  // 照片只当「待确认线索」存下来)。产品仓(nesio)保留那道门,workshop 是自己用的实验仓,
  // 该识别的就识别,不为分层牺牲可用性。往 prod 搬时要把门加回去。
  const en = dict.toLowerCase().startsWith('en');
  const res = await fetch('/api/portal/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-baohe-access-mode': 'personal_lab' },
    body: JSON.stringify({
      type: 'image',
      content: prompt ?? fullImagePrompt(en),
      imageBase64: base64,
      mimeType: 'image/jpeg',
      uiLocale: dict,
    }),
  });
  const data = await res.json() as { ok?: boolean; nodes?: AnalyzedNode[]; summary?: string; error?: string };
  if (!data.ok || !data.nodes?.length) throw new AnalyzeImageError(data.error || 'no_result');
  return { nodes: data.nodes, summary: data.summary || L(dict, '识别完成', 'Recognition done') };
}

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
  price?: string;
  deleted: boolean;
}

// 批次 64:识别退化的确定性兜底 —— 兜底模型(gpt-4o-mini)时代,能用规则接住的绝不指望模型。
const NON_ITEM_RE = /^(销售税|消费税|税费?|小计|合计|总计|找零|小费|sales?\s*tax|tax|subtotal|total|change( due)?|tips?|balance)$/i;
const EXPIRY_KEY_RE = /(有效期|保质期|赏味|best\s*by|sell\s*by|use\s*by|exp(?:iry|ires|\.)?|到期)/i;
/** 生产日期/上市日期 —— 不能当有效期(Bug:牛奶未来效期却显示过期,常把生产日期误读)。 */
const PRODUCTION_KEY_RE = /(生产日期|生产日|制造日期|packed\s*on|mfg|manufactured|销售日期)/i;
const DATE_RE = /(\d{4})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})|(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;

function parseDateParts(y: number, mo: number, d: number): string {
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 文本里紧挨"有效期类关键词"的日期 → YYYY-MM-DD;没有则 ''。 */
function extractExpiryFromText(text: string): string {
  if (!text || PRODUCTION_KEY_RE.test(text)) return '';
  const keyIdx = text.search(EXPIRY_KEY_RE);
  if (keyIdx < 0) return '';
  const window = text.slice(keyIdx, keyIdx + 48);
  const m = DATE_RE.exec(window);
  if (!m) return '';
  let y: number; let mo: number; let d: number;
  if (m[1]) { y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]); }
  else {
    mo = Number(m[4]); d = Number(m[5]); y = Number(m[6]); if (y < 100) y += 2000;
    // 美式 MM/DD:第一位 >12 则 swap
    if (mo > 12 && d <= 12) { const t = mo; mo = d; d = t; }
  }
  return parseDateParts(y, mo, d);
}

function toEditedNodes(nodes: AnalyzedNode[], summary = ''): EditedNode[] {
  const kept = nodes.filter((n) => !NON_ITEM_RE.test((n.name || '').trim()));
  const usable = kept.length ? kept : nodes; // 全被滤光就保底不丢
  const summaryExpiry = usable.length <= 2 ? extractExpiryFromText(summary) : ''; // 小票(多条)不拿收据日期冒充有效期
  return usable.map((n) => {
    const a = n.attributes || {};
    const attrExpiry = [a.expiry, a.expiryDate, a.bestBy, a.sellBy]
      .find((v): v is string => typeof v === 'string' && Boolean(v)) || '';
    const price = typeof a.price === 'string' || typeof a.price === 'number' ? String(a.price) : '';
    return {
      ...n,
      tags: n.tags ?? [],
      note: '',
      expiry: extractExpiryFromText(attrExpiry ? `有效期 ${attrExpiry}` : '') || attrExpiry || summaryExpiry || '',
      price,
      deleted: false,
    };
  });
}

// ── Receipt detection ────────────────────────────────────────────────────────

const RECEIPT_KEYWORDS = ['小票', '收据', 'receipt', '发票', '结账', '超市', '便利店', '合计', 'total', 'subtotal', '购物清单'];

function detectReceipt(result: AnalysisResult): boolean {
  const text = [result.summary, ...result.nodes.map((n) => n.name + ' ' + JSON.stringify(n.attributes))].join(' ').toLowerCase();
  const keywordHit = RECEIPT_KEYWORDS.some((k) => text.includes(k));
  // 批次 180:光「多物品」不算小票(一张鼠标+垫子+桌面的普通照片曾误判)。
  // 真小票的条目都带价格 —— 多物品必须**多数带 price**才当小票。
  const manyPriced = result.nodes.length >= 3
    && result.nodes.filter((n) => n.type === 'Thing' && n.attributes?.price != null && n.attributes?.price !== '').length >= result.nodes.length - 1;
  return keywordHit || manyPriced;
}

// ── Location helper ──────────────────────────────────────────────────────────

async function getCurrentLocation(): Promise<{ lat: number; lon: number } | null> {
  // 壳:原生 Geolocation;PWA:web geo + 硬超时。定位失败不挡保存。
  const { getDevicePosition } = await import('@/lib/portal/native-geolocation');
  const pos = await getDevicePosition({ timeoutMs: 5_000, maximumAgeMs: 60_000, enableHighAccuracy: false });
  return pos ? { lat: pos.lat, lon: pos.lon } : null;
}

// ── Node type chips ──────────────────────────────────────────────────────────

// 批次 174:'place' 退役 —— 不再让相机把东西归类成「位置」(无真实数据源;真实地点走足迹/物品 location)
const ALL_TYPES = ['Thing', 'person', 'event', 'task', 'Mind'] as const;

function buildPendingImageResult(dict: string = 'zh', reason: 'auth' | 'free_tier' = 'auth', pantry = false): AnalysisResult {
  // 进货模式:名字留空(让用户直接打食材名,而不是「照片 · 时间」),文案也换成起名引导。
  return {
    summary: pantry
      ? L(dict, '拍好了 —— 给它起个名字,比如「西红柿」「鸡蛋」;数量、保质期可选。', 'Snapped — name it (e.g. tomato, eggs); quantity & expiry optional.')
      : reason === 'free_tier'
        ? L(dict, '照片已记下,可以自己加名字和标签。升级 Pro 可用 AI 自动识别图中物品和场景。', 'Photo saved — add a name and tags yourself. Upgrade to Pro for AI recognition of objects and scenes.')
        : L(dict, '照片已存好 —— 改个名字、加点标签更好找。', 'Photo saved — rename or tag it to find it later.'),
    nodes: [
      {
        type: 'Thing',
        name: pantry ? '' : L(dict, `照片 · ${new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, `Photo · ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`),
        attributes: {},
        relations: [],
        tags: pantry ? [] : [L(dict, '图片', 'image')],
        source: 'photo',
        confidence: 0.9,
      },
    ],
  };
}

/**
 * 端上认出的字 → 一条小票节点。**不打云。**
 *
 * 和云路径的差别得说清楚,别让人以为这是等价替换:
 *   · 云会把小票**拆成每个条目一个节点**(「牛奶 $4.99」「面包 $3.20」…);
 *   · 端上只认字,`extractReceiptFields` 抽的是**这张票的总额/日期/商家** ——
 *     一条节点,不是一堆。条目拆分需要理解版式,那确实是云更擅长的事。
 *
 * 所以这里不假装拆得开:给一条准确的总额记录,再在结果页留一句
 * 「想按条目拆开?让 AI 再看一遍」的出口(analyzeFullImage({ forceCloud: true }))。
 * 对最常用的那个场景 —— 把这笔花销记进账 —— 总额+日期+商家本来就是全部所需,
 * 而且是**从图上的字直接读出来的**,不是模型猜的。
 */
function buildLocalReceiptResult(seen: UnderstandResult, dict: string = 'zh'): AnalysisResult {
  const f = seen.fields!;
  const store = (f.merchant || '').trim();
  const name = store || L(dict, '小票', 'Receipt');
  // 金额是「靠合计关键词找到的」还是「取最大值猜的」——后者要让用户核对,不能装作一样准。
  const summary = f.amountFrom === 'keyword'
    ? L(dict, `在这台设备上认出来的 —— ${store ? store + ' · ' : ''}${f.amount}${f.date ? ' · ' + f.date : ''}。图没有发出去。`,
        `Read on this device — ${store ? store + ' · ' : ''}${f.amount}${f.date ? ' · ' + f.date : ''}. The photo never left.`)
    : L(dict, `认出来了,但没找到「合计」那一行,金额取的是票面最大的数 —— 麻烦核对一下。图没有发出去。`,
        `Read it, but no "total" line was found — this is the largest number on the receipt. Worth a check. The photo never left.`);
  return {
    summary,
    nodes: [{
      type: 'Thing',
      name,
      attributes: {
        price: f.amount,
        ...(f.date ? { receiptDate: f.date } : {}),
        ...(store ? { store } : {}),
        // 认出来的原文留一份 —— 「只存图」的老毛病就是图上写的字一个都搜不到。
        ocrSource: 'on-device',
      },
      relations: [],
      tags: [L(dict, '小票', 'receipt'), ...tagsFromText(seen.text, 5)],
      source: 'photo',
      confidence: f.amountFrom === 'keyword' ? 0.95 : 0.7,
      rawInput: seen.text.slice(0, 2000),
    }],
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

export default function CameraSheet({ open, onClose, initialFile, intakeSubtype, mode, onModeCaptured }: CameraSheetProps) {
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
  /**
   * 端上认出来的字。两个用处,缺一个都算白认:
   *   ① 存进节点 rawInput —— 「图存下来了、上面写的字一个都搜不到」是这轮要修的老毛病;
   *   ② 结果页显示「这是在这台设备上读的」,让人知道图有没有出过门。
   */
  const [ocrText, setOcrText] = useState('');
  /** 这次结果是端上读出来的、**没打云**。结果页据此给「让 AI 再看一遍」的出口。 */
  const [localOnly, setLocalOnly] = useState(false);
  const [permDenied, setPermDenied] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false); // 批次 35:存入按钮即时反馈,避免「点了没反应」
  const [extraTags, setExtraTags] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  // 批次 63:相册照片的 EXIF 拍摄地/拍摄时间(压缩会剥 EXIF,必须在原始字节上读)
  const [exifCap, setExifCap] = useState<{ lat: number | null; lon: number | null; takenAt: string | null } | null>(null);
  // 批次 84:对标大厂相机 —— 本地记忆搜索(不必存)/ 已有节点详情 / 照片内 QR
  const [viewNode, setViewNode] = useState<LifeNode | null>(null);
  const [memSearch, setMemSearch] = useState<LifeNode[] | null>(null);
  const [qrCodes, setQrCodes] = useState<string[]>([]);
  const [visualMatchIds, setVisualMatchIds] = useState<Set<string>>(new Set());
  // Freehand selection state
  const [selecting, setSelecting] = useState(false);
  const selStartRef = useRef<{ x: number; y: number } | null>(null);
  const selPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  // Auto-detected place from GPS (used to pre-fill location on object nodes)
  const [detectedPlaceId, setDetectedPlaceId] = useState<string>('');
  // Per-node location overrides (index → formatted location string)
  const [nodeLocations, setNodeLocations] = useState<Record<number, string>>({});
  // 批次192(存放位置闭环):同步存每条选中的稳定 placeId/room/subRoom,存入时写节点(改名自动传导)。
  const [nodePlaceMeta, setNodePlaceMeta] = useState<Record<number, { placeId?: string; room?: string; subRoom?: string }>>({});
  // Similarity check result (per node index)
  const [similarItems, setSimilarItems] = useState<Record<number, SimilarItem[]>>({});

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

    // iOS PWA(standalone)已知 bug:getUserMedia 流是活的(状态栏出相机指示,
    // 用户误以为"开启了录屏")但 video 元素黑屏不上画。看门狗:先按理想约束试,
    // videoWidth 迟迟为 0 → 换最简约束重试一次;仍黑 → 停流落到拍照/相册面板,
    // 绝不留"黑屏 + 红点"给用户。
    const attempt = async (constraints: MediaStreamConstraints): Promise<boolean> => {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      await attachStreamToVideo(stream);
      const video = videoRef.current;
      for (let i = 0; i < 10; i += 1) {
        if (streamRef.current !== stream) return true; // 已被下一次调用接管
        if (video && video.videoWidth > 0) return true;
        await new Promise((r) => setTimeout(r, 120));
        if (video) void attachStreamToVideo(stream);
      }
      return Boolean(video && video.videoWidth > 0);
    };

    try {
      const painting = await attempt({
        video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      if (painting) return;
      stopCamera();
      const retryPainting = await attempt({ video: { facingMode: facing }, audio: false });
      if (retryPainting) return;
      stopCamera();
      setPhase('no-camera'); // 黑屏兜底:给能用的按钮,别给死取景框
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

  // 批次 91(对标苹果相机「对着 QR 就读」):live 取景每 ~700ms 采一帧 zxing
  // 连扫二维码 —— 命中即显芯片,不用拍照。惰性加载 reader,组件级复用。
  useEffect(() => {
    if (phase !== 'live') return;
    let alive = true;
    let reader: { decodeFromCanvas: (c: HTMLCanvasElement) => { getText?: () => string } } | null = null;
    const scanCanvas = document.createElement('canvas');
    const loop = async () => {
      if (!alive) return;
      const video = videoRef.current;
      if (video && video.videoWidth > 0) {
        try {
          if (!reader) {
            const { BrowserQRCodeReader } = await import('@zxing/browser');
            reader = new BrowserQRCodeReader() as unknown as typeof reader;
          }
          const maxDim = 900;
          const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
          scanCanvas.width = Math.round(video.videoWidth * scale);
          scanCanvas.height = Math.round(video.videoHeight * scale);
          const ctx = scanCanvas.getContext('2d');
          if (ctx && reader) {
            ctx.drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height);
            const result = reader.decodeFromCanvas(scanCanvas); // 无码抛异常
            const text = result?.getText?.();
            if (text && alive) setQrCodes([text]);
          }
        } catch { /* 这一帧无码:静默,下一帧再试 */ }
      }
      if (alive) setTimeout(loop, 700);
    };
    const t = setTimeout(loop, 800);
    return () => { alive = false; clearTimeout(t); };
  }, [phase]);

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

    // QA(用户定):打开即启动应用内取景框(getUserMedia live)—— 我们自己的 UI,
    // 才能像原生相机一样在**左下角放相册入口**(web 调起的系统取景框不可定制)。
    // getUserMedia 失败/无权限 → startCamera 自动落到 no-camera 选择页(拍照/相册按钮)。
    // 批次 93:无文件打开时直接进选择页(拍照/相册)—— 不再先启动 iOS PWA
    // 实锤黑屏的应用内取景框(那会先黑屏 1-2s 再落到「上传图片」兜底页)。
    // live 取景基建保留,待原生壳(Capacitor)上架后才是真能用的实时相机场景。
    if (initialFile) void processFile(initialFile);
    else setPhase('idle');
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

    // 模式相机(记一餐/衣帽间):拍到帧就交回入口,不进记忆识别流。
    if (mode && onModeCaptured) {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      const file = dataUrlToFile(dataUrl, `nesio-camera-${Date.now()}.jpg`);
      if (!file) { setError(L(dict, '这一帧没拍成,再试一次。', 'That frame did not capture — try again.')); setPhase('live'); return; }
      stopCamera();
      onModeCaptured({ file, dataUrl });
      return;
    }

    // Show preview thumbnail
    const preview = canvas.toDataURL('image/jpeg', 0.5);
    setCapturedPreview(preview);
    setSourceFile(dataUrlToFile(preview, `nesio-camera-${Date.now()}.jpg`));

    // Compress and store, then go straight to selection/drawing
    const base64 = await compressImage(canvas);
    setCapturedBase64(base64);
    setSelecting(true);
    // 批次 87(对标苹果相机「即时」):直拍也立刻检测 QR,不等 AI
    canvas.toBlob((b) => { if (b) void detectQr(b); }, 'image/jpeg', 0.9);
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
      if (n.type === 'Thing') defaults[i] = `${place.emoji} ${place.name}`;
    });
    if (Object.keys(defaults).length > 0) setNodeLocations(defaults);
  }

  // QA:不用 AI 直接存 —— 照片 + 自己填名字/标签。免费默认路径,零成本零等待。
  function saveWithoutAi() {
    setSelecting(false);
    const manual: AnalysisResult = {
      summary: L(dict, '照片已就绪,填个名字(标签可选)就能存。', 'Photo ready — give it a name (tags optional) and save.'),
      nodes: [{
        type: 'Thing', name: L(dict, `照片 · ${new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, `Photo · ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`), attributes: {},
        relations: [], tags: [], source: 'photo', confidence: 1,
      }],
    };
    setResult(manual);
    setEditedNodes(toEditedNodes(manual.nodes));
    setIsReceipt(false);
    setPhase('result');
  }

  // 批次 84:识别结果 → 搜本地记忆库;批次 87:先按图像指纹召回(以图搜图 v1),
  // 视觉相似排前带徽标,文字匹配随后补足。
  function searchLocalMemory() {
    const q = [
      ...editedNodes.filter((n) => !n.deleted).map((n) => n.name),
      result?.summary || '',
    ].join(' ').trim().slice(0, 80);
    void (async () => {
      try {
        const visual: LifeNode[] = [];
        if (capturedPreview) {
          const { computeDHash, searchByHash, backfillImageHashes, indexedNodeIds } = await import('@/lib/portal/image-hash');
          // 批次 89:首次搜索前给存量本地图片回填指纹(老照片也能被图像召回)
          const g0 = getLifeGraph();
          const have = indexedNodeIds();
          const pending = g0.filter((n) => !have.has(n.id) && (n.assets || []).some((a) => a.local && a.kind === 'image'));
          if (pending.length) {
            const { getLocalImage } = await import('@/lib/portal/local-image-store');
            const entries: Array<{ nodeId: string; dataUrl: string }> = [];
            for (const n of pending.slice(0, 400)) {
              const asset = (n.assets || []).find((a) => a.local && a.kind === 'image');
              if (!asset) continue;
              const dataUrl = await getLocalImage(asset.id);
              if (dataUrl) entries.push({ nodeId: n.id, dataUrl });
            }
            await backfillImageHashes(entries);
          }
          const h = await computeDHash(capturedPreview);
          if (h) {
            const g = getLifeGraph();
            for (const [nodeId] of searchByHash(h)) {
              const n0 = g.find((x) => x.id === nodeId);
              if (n0) visual.push(n0);
            }
          }
        }
        setVisualMatchIds(new Set(visual.map((n0) => n0.id)));
        let textual: LifeNode[] = [];
        if (q) {
          const { smartSearch } = await import('@/lib/portal/smart-search');
          textual = smartSearch(q).nodes;
        }
        const seen = new Set(visual.map((n0) => n0.id));
        setMemSearch([...visual, ...textual.filter((n0) => !seen.has(n0.id))].slice(0, 8));
      } catch {
        setMemSearch([]);
      }
    })();
  }

  // 批次 89(修批次84的硬错误):BarcodeDetector 在 iOS/WebKit 上**不存在**
  // (Chrome 独有 API,Safari 从未实现)—— 之前 if(!BD)return 静默退出,
  // QR 在 iPhone 上永远不触发。改用 @zxing/browser 的 canvas 解码(纯 JS,
  // 跨平台,iOS 可用);惰性加载,只在拍/选图时拉一次。
  async function detectQr(source: Blob) {
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const bmp = await createImageBitmap(source);
      const canvas = document.createElement('canvas');
      const maxDim = 1200; // QR 需要足够分辨率,又不能太大拖慢解码
      const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { bmp.close?.(); return; }
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close?.();
      const reader = new BrowserQRCodeReader();
      const result = reader.decodeFromCanvas(canvas); // 无码时抛 NotFoundException
      const text = result?.getText?.();
      if (text) setQrCodes([text]);
    } catch { /* 无二维码 / 解码失败:静默,不打扰 */ }
  }

  // Analyze the full captured image (called from selection overlay or result phase)
  async function analyzeFullImage(opts?: { forceCloud?: boolean }) {
    if (!capturedBase64) return;
    setSelecting(false);
    setPhase('analyzing');
    setError('');
    setLocalOnly(false);
    try {
      const en = dict.toLowerCase().startsWith('en');

      // ── 端上先认字 ────────────────────────────────────────────────────────
      //
      // 顺序以前是反的:先把图发去云,等云读完再用关键词判「哦这是张小票」
      // (下面的 `detectReceipt(res)`)。可那些关键词本来就印在图上 ——
      // 端上认一遍就知道,根本不用先发出去。
      //
      // 认出来是小票/订单、而且金额真抽到了 → **就不打云了**:那些信息就是图上的字,
      // 让大模型再读一遍是把确定性的事交给会猜的东西,还慢、还把票据发出门。
      //
      // `forceCloud` 是结果页那个「让 AI 再看一遍」按钮 —— 端上只给一条总额记录,
      // 想按条目拆开还得云来。**是用户点的**,不是我们替他决定把票发出去。
      const seen = opts?.forceCloud ? null : await understandImage(capturedBase64);
      if (seen) {
        setOcrText(seen.text);
        // 进货模式要的是**逐个食材**,端上只认字给不出这个 —— 那条路照旧走云。
        if (!intakeSubtype && !seen.needsCloud && seen.fields) {
          const local = buildLocalReceiptResult(seen, dict);
          setResult(local);
          setEditedNodes(toEditedNodes(local.nodes, local.summary));
          setIsReceipt(true);
          setLocalOnly(true);
          setPhase('result');
          return;
        }
      }

      const res = await analyzeImage(capturedBase64, intakeSubtype ? foodPrompt(en) : undefined, dict);
      const nodes = toEditedNodes(res.nodes, res.summary);
      setResult(res);
      setEditedNodes(nodes);
      setIsReceipt(intakeSubtype ? false : detectReceipt(res));
      setPhase('result');
      tryMatchGpsAndPrefill(nodes);
      // Check for similar existing objects
      const similars: Record<number, SimilarItem[]> = {};
      nodes.forEach((n, i) => {
        if (n.type === 'Thing') {
          const found = findSimilarObjects(n.name, n.tags ?? []);
          if (found.length > 0) similars[i] = found;
        }
      });
      if (Object.keys(similars).length > 0) setSimilarItems(similars);
    } catch (err: unknown) {
      if (err instanceof AnalyzeImageError && (err.code === 'ai_auth_required' || err.code === 'free_tier_local')) {
        // 未登录 / 免费层:照片照样保存(待确认线索),不打云;进货模式名字留空让用户直接打食材名
        const pending = buildPendingImageResult(dict, err.code === 'free_tier_local' ? 'free_tier' : 'auth', !!intakeSubtype);
        setResult(pending);
        setEditedNodes(toEditedNodes(pending.nodes, pending.summary));
        setIsReceipt(false);
        setPhase('result');
        return;
      }
      setError(L(dict, '识别失败。你可以先保存为待确认图片线索。', 'Recognition failed. You can save it as an unconfirmed image clue for now.'));
      setResult(buildPendingImageResult(dict, 'auth', !!intakeSubtype));
      setPhase('result');
    }
  }

  // 「订单」模式:亚马逊订单截图 → 合并成一条物品(订单号/买入价/税/商家/日期入 attributes,
  // 打「亚马逊」标签)。合并逻辑在 lib/portal/amazon-order.ts(有单测),这里只做相机侧编排。
  async function analyzeOrder() {
    if (!capturedBase64) return;
    setSelecting(false);
    setPhase('analyzing');
    setError('');
    try {
      const en = dict.toLowerCase().startsWith('en');
      const res = await analyzeImage(capturedBase64, orderPrompt(en), dict);
      const c = consolidateAmazonOrder(res.nodes, res.summary);
      const node: EditedNode = {
        name: c.name, type: 'Thing', attributes: c.attributes, tags: c.tags,
        source: 'photo', confidence: 0.9, relations: [], note: '', expiry: '', price: '', deleted: false,
      };
      const parts: string[] = [c.name];
      if (c.attributes.orderNo) parts.push(`#${c.attributes.orderNo}`);
      if (c.attributes.buyPrice != null) parts.push(`$${c.attributes.buyPrice}`);
      if (c.attributes.tax != null) parts.push(L(dict, `税 $${c.attributes.tax}`, `tax $${c.attributes.tax}`));
      if (c.attributes.seller) parts.push(String(c.attributes.seller));
      setResult({ ...res, summary: L(dict, `订单识别成一条:${parts.join(' · ')}。保存后到「物品管理」补返现/转卖价`, `Order → one item: ${parts.join(' · ')}. Add rebate/resale in Storage after saving.`) });
      setEditedNodes([node]);
      setIsReceipt(false);
      setPhase('result');
    } catch (err: unknown) {
      if (err instanceof AnalyzeImageError && (err.code === 'ai_auth_required' || err.code === 'free_tier_local')) {
        const pending = buildPendingImageResult(dict, err.code === 'free_tier_local' ? 'free_tier' : 'auth');
        setResult(pending);
        setEditedNodes(toEditedNodes(pending.nodes, pending.summary));
        setPhase('result');
        return;
      }
      setError(L(dict, '订单识别失败。可先存为图片线索,或换「AI 识别」。', 'Order recognition failed. Save as an image clue, or try "Scan".'));
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
    // 模式相机(记一餐/衣帽间):压缩完直接交回入口,不走 EXIF/QR/记忆识别。
    if (mode && onModeCaptured) {
      if (!file.type.startsWith('image/')) {
        setError(L(dict, '这个模式只收照片。', 'This mode only takes photos.'));
        return;
      }
      const photo = await prepareCapturedPhoto(file);
      if (!photo) { setError(L(dict, '这张图读不了,换一张试试。', 'Could not read that image — try another.')); return; }
      onModeCaptured(photo);
      return;
    }
    setSourceFile(file);
    setExifCap(null);
    setQrCodes([]); setMemSearch(null);
    if (file.type.startsWith('image/')) {
      void detectQr(file);
      void import('@/lib/portal/exif-gps')
        .then(({ readExifCapture }) => readExifCapture(file))
        .then((cap) => { if (cap.lat != null || cap.takenAt) setExifCap(cap); })
        .catch(() => {});
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setCapturedPreview(dataUrl);
      setCapturedBase64(dataUrl.split(',')[1]);
      setPhase('captured');
      setSelecting(true);
    };
    if (file.type.startsWith('image/')) {
      // 批次 82(用户实锤「全图识别必败,圈选才行」):原片 base64 动辄 5-10MB,
      // 超过 API 路由请求体上限 → 全图分析 413/超时。识别载荷统一降采样
      // (1400px/0.82,与存储同参);EXIF 已在上面从原始字节读过,不受影响。
      void import('@/lib/portal/local-image-store')
        .then(({ compressToDataUrl }) => compressToDataUrl(file))
        .then((dataUrl) => {
          if (!dataUrl) throw new Error('compress_failed');
          setCapturedPreview(dataUrl);
          setCapturedBase64(dataUrl.split(',')[1]);
          setPhase('captured');
          setSelecting(true);
        })
        .catch(() => reader.readAsDataURL(file)); // 压缩失败退回原图(至少小图还能走)
      return;
    }
    {
      // Non-image file: text analysis
      const text = await file.text().catch(() => file.name);
      setPhase('analyzing');
      // workshop 不分收费免费(2026-07-31)。这段原来是**付费门后的免费兜底**
      // (免费用户走确定性存档)。门拆了之后它不该变成死代码 —— 它是真兜底:
      // 云那条走不通(离线/出错)时,文件名作标题 + 全文进 article,照样可读可搜。
      // 所以改成一个函数,由下面 catch 调它。往 prod 搬时在这之前把付费门加回来。
      const archiveLocally = () => {
        const full = text.trim();
        const fileAttrs: Record<string, string> = full.length >= 200 ? { article: full } : { note: full };
        const fileResult = {
          nodes: [{
            type: 'Mind' as const, name: (file.name || full.slice(0, 40)).slice(0, 60),
            attributes: fileAttrs,
            relations: [], tags: [L(dict, '文件', 'file')], confidence: 0.8, rawInput: full.slice(0, 200),
            source: 'manual' as const,
          }],
          summary: L(dict, '文件已存档,可搜索可阅读(这次没能提取要点)。', 'File archived — searchable and readable (couldn’t extract key points this time).'),
        };
        setResult(fileResult);
        setEditedNodes(toEditedNodes(fileResult.nodes, fileResult.summary));
        setIsReceipt(false);
        setPhase('result');
      };
      try {
        const res2 = await fetch('/api/portal/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'file', content: text.slice(0, 4000), uiLocale: dict }),
        });
        const data = await res2.json() as { ok?: boolean; nodes?: AnalyzedNode[]; summary?: string };
        const fileResult = { nodes: data.nodes || [], summary: data.summary || L(dict, '提取完成', 'Extraction done') };
        setResult(fileResult);
        setEditedNodes(toEditedNodes(fileResult.nodes));
        setIsReceipt(detectReceipt(fileResult));
        setPhase('result');
      } catch {
        // 云那条走不通(离线/出错):**别把文件丢了**。原来这里只是 setPhase('live'),
        // 用户传了个文件、转了一圈、回到取景框,什么都没发生 —— 那和「按钮点了没反应」一样。
        archiveLocally();
      }
    }
  }

  async function saveAll() {
    const nodesToSave = editedNodes.filter((n) => !n.deleted);
    if (!nodesToSave.length || saving) return;
    setSaving(true); // 立刻反馈:按钮变「保存中…」+ 禁用,避免用户以为没点上
    setError('');
    try {
      await doSave(nodesToSave);
      const armedTripId = peekTravelReceiptTripId();
      if (armedTripId) {
        const lines = buildUsableReceiptLines(
          nodesToSave.filter((n) => n.type === 'Thing'),
          L(dict, '未命名', 'Untitled'),
        );
        if (!lines.length) {
          setSaving(false);
          setError(L(dict,
            '没认出可用的小票条目 —— 用「AI 识别」或手动加条目后再存；行程入口还开着，可重试。',
            'No usable receipt lines — try Scan or add items manually; the trip link is still armed, you can retry.'));
          return;
        }
        const trip = appendShoppingReceipt(armedTripId, lines, {
          title: L(dict, '购物 · 小票', 'Shopping · receipt'),
          date: localDayKey(),
          currency: defaultFinanceCurrency(),
        });
        if (!trip) {
          clearTravelReceiptTripId();
          setSaving(false);
          setError(L(dict, '小票没能记入行程 —— 行程可能已删除，请回到预算页重试。',
            'Could not add receipt to trip — it may have been removed; reopen from Budget and try again.'));
          return;
        }
        consumeTravelReceiptTripId();
      } else {
        // 非行程:多数条目带价 → 当作小票记入财务聚合口
        const lines = nodesToSave
          .filter((n) => n.type === 'Thing')
          .map((n) => ({
            name: n.name.trim() || L(dict, '未命名', 'Untitled'),
            price: n.price?.trim() ? Number(String(n.price).replace(/[^\d.]/g, '')) || undefined : undefined,
            note: n.attributes?.store ? String(n.attributes.store) : undefined,
          }));
        const priced = lines.filter((l) => (l.price || 0) > 0).length;
        if (priced >= 1 && priced >= Math.max(1, lines.length - 1)) {
          const merchant = lines.find((l) => l.note)?.note;
          const fingerprint = lines.map((l) => `${l.name}:${l.price || 0}`).join('|').slice(0, 80);
          addReceiptExpense({
            lines,
            date: localDayKey(),
            currency: defaultFinanceCurrency(),
            source: 'receipt',
            merchant,
            includeInFinance: true,
            sourceRef: `camera:${localDayKey()}:${fingerprint}`,
          });
        }
      }
      setPhase('saved');
      setTimeout(() => { onClose(); setPhase('idle'); setResult(null); setExtraTags(''); setSourceFile(null); setNodeLocations({}); setNodePlaceMeta({}); setDetectedPlaceId(''); setSaving(false); }, 1200);
    } catch (err: unknown) {
      setSaving(false);
      const code = err instanceof Error ? err.message : '';
      if (code === 'photo_idb_failed') {
        setError(L(dict, '照片没存进本机 —— 请点「存入记忆」重试。', 'Photo could not be saved locally — tap Save to Memory again.'));
      } else if (code === 'photo_missing') {
        setError(L(dict, '找不到照片数据 —— 请重拍或从相册重选。', 'Photo data missing — retake or pick from Photos.'));
      } else {
        setError(L(dict, '存入失败，请重试', 'Save failed — please try again'));
      }
    }
  }

  async function doSave(nodesToSave: EditedNode[]) {
    const userTags = parseInlineTags(extraTags);

    // Best-effort location — attach if permission already granted(硬超时,不挡保存)
    const loc = await getCurrentLocation();
    // 地图「带位置的记忆」读 capturedLat/Lon;live GPS 也写入同一对字段。
    const captureCoords: Record<string, number> = {};
    if (exifCap?.lat != null && exifCap.lon != null) {
      captureCoords.capturedLat = exifCap.lat as number;
      captureCoords.capturedLon = exifCap.lon as number;
      captureCoords.lat = exifCap.lat as number;
      captureCoords.lon = exifCap.lon as number;
    } else if (loc) {
      captureCoords.capturedLat = loc.lat;
      captureCoords.capturedLon = loc.lon;
      captureCoords.lat = loc.lat;
      captureCoords.lon = loc.lon;
    }

    const savedNodes = nodesToSave.map((n, i) => {
      const origIdx = editedNodes.indexOf(n);
      const locationVal = nodeLocations[origIdx] ?? '';
      const pm = nodePlaceMeta[origIdx];
      return ingestLifeNode({
        name: n.name.trim() || L(dict, '未命名条目', 'Untitled item'),
        type: n.type as LifeNode['type'],
        source: 'photo',
        tags: Array.from(new Set([...(n.tags || []), ...userTags])),
        confidence: n.confidence,
        relations: n.relations,
        // 端上认出来的字兜底进 rawInput —— 全文检索扫的就是这里。
        // 「图存下来了、上面写的字一个都搜不到」是这轮要修的病:哪怕这张图最后走了云、
        // 云只给了个名字,图上印的单号/日期/店名也该能被搜出来。
        rawInput: n.rawInput || (ocrText ? ocrText.slice(0, 2000) : undefined),
        attributes: {
          ...n.attributes,
          ...captureCoords,
          ...(exifCap?.takenAt ? { takenAt: exifCap.takenAt } : {}),
          ...(locationVal ? { location: locationVal as string } : {}),
          // 批次192:存稳定 placeId/room/subRoom —— 命名地点改名后,物品位置自动跟着变。
          ...(pm?.placeId ? { placeId: pm.placeId } : {}),
          ...(pm?.room ? { placeRoom: pm.room } : {}),
          ...(pm?.subRoom ? { placeSubRoom: pm.subRoom } : {}),
          ...(n.note?.trim() ? { note: n.note.trim() as string } : {}),
          ...(n.expiry?.trim() ? { expiry: n.expiry.trim() as string } : {}),
          ...(n.price?.trim() ? { price: n.price.trim() as string } : {}),
          // 进货模式:object 节点打后台子类(食材)→ 进「做饭·库存」而非物品页。属性,不渲染成标签。
          ...(intakeSubtype && n.type === 'Thing' ? { subtype: intakeSubtype } : {}),
          ...(userTags.length ? { userTags: userTags.join(', ') as string } : {}),
        },
      });
    });
    // 批次 66(用户定案):有 EXIF 拍摄时间的照片,记忆落到**拍摄那天**的时间线
    // (旧照导入的意义就在这里;存储日期只是资料搬运日,不是生活发生日)。
    if (exifCap?.takenAt) {
      const takenAt = exifCap.takenAt;
      for (const sn of savedNodes) updateLifeNode(sn.id, { createdAt: takenAt });
    }

    // 批次 23 + A3:照片压缩存本机 IndexedDB 并挂 node.assets —— 失败必须抛出让 UI 可见。
    // 与 capture-pipeline 同构(本机 + Storage + memory_assets),换端才能看见图。
    if (savedNodes.length > 0) {
      const dataUrl = sourceFile
        ? await (await import('@/lib/portal/local-image-store')).compressToDataUrl(sourceFile)
        : (capturedBase64 ? `data:image/jpeg;base64,${capturedBase64}` : '');
      if (!dataUrl) throw new Error('photo_missing');
      const { attachPhotoToMemoryNode } = await import('@/lib/portal/capture-pipeline');
      const persisted = await attachPhotoToMemoryNode({
        nodeId: savedNodes[0].id,
        dataUrl,
        kind: 'memory',
        label: result?.summary || savedNodes[0].name,
      });
      if (!persisted) throw new Error('photo_idb_failed');
      // 批次 87(用户批准「以图搜图」):存图顺手算 dHash 指纹入索引
      void import('@/lib/portal/image-hash')
        .then(async ({ computeDHash, saveImageHash }) => {
          const h = await computeDHash(dataUrl);
          if (h) saveImageHash(savedNodes[0].id, h);
        })
        .catch(() => {});
    }

    // 批次 63:照片带 EXIF 坐标 → 按**拍摄时间**记进足迹(扩充时间线),
    // 地名反查到后回填节点 capturedPlace(与足迹同库)。
    if (exifCap?.lat != null && exifCap.lon != null && savedNodes.length > 0) {
      const { lat: exLat, lon: exLon, takenAt } = exifCap;
      const nodeId = savedNodes[0].id;
      void Promise.all([import('@/lib/portal/place-trail'), import('@/lib/portal/capture-location')])
        .then(async ([trail, cap]) => {
          const geo = await cap.reverseGeocodeRobust(exLat as number, exLon as number).catch(() => ({ label: '' }));
          const label = geo.label || `${(exLat as number).toFixed(3)},${(exLon as number).toFixed(3)}`;
          trail.recordVisitAt(label, takenAt || new Date().toISOString());
          if (geo.label) {
            const live = getLifeGraph().find((x) => x.id === nodeId);
            if (live && !live.attributes.capturedPlace) {
              updateLifeNode(nodeId, { attributes: { ...live.attributes, capturedPlace: geo.label } });
            }
          }
        })
        .catch(() => {});
    }

    // 云同步已由 attachPhotoToMemoryNode 处理(purpose=memory + memory_assets)。
  }

  function retake() {
    setSelecting(false);
    setResult(null); setEditedNodes([]); setIsReceipt(false);
    setOcrText(''); setLocalOnly(false);
    setCapturedPreview(''); setCapturedBase64(''); setError(''); setExtraTags(''); setSourceFile(null);
    setNodeLocations({}); setNodePlaceMeta({}); setDetectedPlaceId('');
    setSimilarItems({});
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
    // eslint-disable-next-line no-restricted-syntax -- canvas fillStyle 无法解析 var(),读 --portal-blue-deep 兜底(此前硬编码废弃蓝 #3b82f6)
    const fillBlue = getComputedStyle(document.documentElement).getPropertyValue('--portal-blue-deep').trim() || '#588ce3';
    ctx.fillStyle = fillBlue;
    ctx.globalAlpha = 0.12;
    ctx.fill();
    ctx.globalAlpha = 1;
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
        const res = await analyzeImage(base64, cropPrompt(dict.toLowerCase().startsWith('en')), dict);
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

  // 批次 87(对标苹果相机「即时」):QR 芯片在拍完/选图阶段就显示,不等 AI
  const qrChips = qrCodes.length > 0 ? (
    <div className="nesio-camera-qr-row">
      {qrCodes.slice(0, 2).map((q, qi) => (
        <div key={qi} className="nesio-camera-qr-chip">
          <span className="nesio-camera-qr-text">{q.length > 42 ? `${q.slice(0, 42)}…` : q}</span>
          {/^https?:\/\//i.test(q) && (
            <a href={q} target="_blank" rel="noopener noreferrer">{L(dict, '打开', 'Open')}</a>
          )}
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(q); }}>{L(dict, '复制', 'Copy')}</button>
        </div>
      ))}
    </div>
  ) : null;

  const viewNodePortal = viewNode && typeof document !== 'undefined'
    ? createPortal(<MemoryNodeDetailLazy node={viewNode} onClose={() => setViewNode(null)} />, document.body)
    : null;

  if (!open) return null;

  // --result = 浅色壳(跟主题/皮肤走)。取景时用深色是对的(全屏画面要压暗),
  // 但**看结果和存完之后不是取景**,那两屏得回到站内配色。
  // 原来只有 phase==='result' 挂这个类,'saved' 漏了 —— 存完那一屏顶栏和底栏
  // 当场退回深蓝黑,和整个浅色 app 割裂(用户圈出来的就是这两条)。
  const lightShell = phase === 'result' || phase === 'saved';

  return (
    <div className={`nesio-camera-sheet${lightShell ? ' nesio-camera-sheet--result' : ''}`} role="dialog" aria-modal="true" aria-label={L(dict, '拍一下', 'Snap')}>
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      {/* Native camera — opens the iOS system camera directly (reliable, no
          persistent stream/indicator). Triggered by a user tap. */}
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="nesio-visually-hidden" onChange={handleFileChange} />
      {/* Gallery / file picker — no capture, so it picks from library/files. 模式相机只收图。 */}
      <input ref={fileRef} type="file" accept={mode ? 'image/*' : 'image/*,.pdf,.txt,.eml'} className="nesio-visually-hidden" onChange={handleFileChange} />

      {/* Header */}
      <div className="nesio-camera-header">
        <button type="button" className="nesio-camera-close" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="18" height="18">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <h2 className="nesio-camera-title">
          {mode
            ? L(dict, mode === 'meal' ? '记一餐' : '拍衣物', mode === 'meal' ? 'Log a meal' : 'Wardrobe photo')
            : L(dict, { idle: '拍一下', live: '拍一下', captured: '处理中', analyzing: '识别中', result: '识别结果', saved: '已保存', 'no-camera': '上传图片' }[phase as 'idle' | 'live' | 'captured' | 'analyzing' | 'result' | 'saved' | 'no-camera'], { idle: 'Snap', live: 'Snap', captured: 'Processing', analyzing: 'Recognizing', result: 'Results', saved: 'Saved', 'no-camera': 'Upload image' }[phase as 'idle' | 'live' | 'captured' | 'analyzing' | 'result' | 'saved' | 'no-camera'])}
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
              {phase !== 'idle'
                ? L(dict, '取景框没起来 —— 用系统相机照样拍,或从相册选择。', "The viewfinder didn't start — use the system camera or pick from Photos.")
                : mode === 'meal'
                  ? L(dict, '拍下这一餐,Nesio 帮你认出吃了什么', 'Snap this meal — Nesio recognizes what you ate')
                  : mode === 'wardrobe'
                    ? L(dict, '拍下衣物,加进你的衣帽间', 'Snap a garment to add it to your wardrobe')
                    : L(dict, '拍一张，Nesio 帮你识别并存入 Memory', 'Take a photo — Nesio recognizes it and saves it to Memory')}
            </p>
            <div className="nesio-camera-chooser-actions">
              {/* 批次 33:no-camera 也给「拍照」(原生 capture input 永远可用,iOS 系统相机直开) */}
              <button type="button" className="nesio-camera-shoot-btn" onClick={openNativeCamera}>
                {L(dict, '拍照', 'Take photo')}
              </button>
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

        {/* 批次 91:live 取景里对着二维码就读到 —— 芯片浮在取景框上方 */}
        {phase === 'live' && qrChips && (
          <div style={{ position: 'absolute', top: 'calc(4rem + env(safe-area-inset-top, 0px))', left: '1rem', right: '1rem', zIndex: 4 }}>
            {qrChips}
          </div>
        )}

        {/* Live 取景控制:中央快门 + 左下角相册(和原生相机同位,QA 指定) */}
        {phase === 'live' && (
          <div style={{ position: 'absolute', bottom: 'calc(1.1rem + env(safe-area-inset-bottom, 0px))', left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <button
              type="button"
              onClick={handleGallery}
              aria-label={L(dict, '从相册选', 'Photo library')}
              style={{ pointerEvents: 'auto', position: 'absolute', left: '1.1rem', width: 46, height: 46, borderRadius: 10, border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.1)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <IconImage size={20} />
            </button>
            <button
              type="button"
              onClick={capturePhoto}
              aria-label={L(dict, '拍照', 'Shutter')}
              style={{ pointerEvents: 'auto', width: 66, height: 66, borderRadius: '50%', border: '4px solid rgba(255,255,255,0.92)', background: 'rgba(255,255,255,0.25)', cursor: 'pointer' }}
            />
          </div>
        )}

        {/* Status pills */}
        {phase === 'analyzing' && (
          <div className="nesio-camera-recognizing" aria-live="polite">
            <span className="nesio-camera-recognizing-dot"/>
            {L(dict, 'Nesio 正在识别…', 'Recognizing…')}
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

          {qrChips}

          {/* 说明文字**自己一行**。原来它和右边四个 chip 挤在同一个 flex 行里、还带 flex:1,
              于是中文被压成一个五六字宽的竖条(「照片已/就绪,/填个名/字(标/签可/选)就/能存。」),
              和旁边的按钮糊在一起。字号/行高走 token,不再自己写死 0.78rem。 */}
          <p className="nesio-camera-result-summary">{result.summary}</p>

          {/* 端上读的:告诉用户图**没出过门**,再给一条「想拆细」的出口。
              这两句必须挨着 —— 只说「没发出去」像在解释为什么内容少,
              只给按钮又等于默认把票据发出去是常态。 */}
          {localOnly && (
            <p className="nesio-camera-local-note">
              {L(dict, '这是在这台设备上读出来的,图没有发出去。想按条目拆开的话——',
                    'Read on this device; the photo never left. Want it split into line items?')}
            </p>
          )}

          {/* 识别动作行:AI 识别 / 圈选 / 订单 / 搜记忆 */}
          <div className="nesio-camera-result-actions">
            {capturedPreview && (
              <button
                type="button"
                className="nesio-camera-select-btn"
                onClick={() => analyzeFullImage(localOnly ? { forceCloud: true } : undefined)}
              >
                {localOnly ? L(dict, '让 AI 再看一遍', 'Ask AI to look again') : L(dict, 'AI 识别', 'Scan')}
              </button>
            )}
            {capturedPreview && (
              <button type="button" className="nesio-camera-select-btn" onClick={openSelection}>
                {L(dict, '圈选', 'Circle')}
              </button>
            )}
            {capturedPreview && (
              <button type="button" className="nesio-camera-select-btn" onClick={analyzeOrder}>
                {L(dict, '订单', 'Order')}
              </button>
            )}
            {/* 批次 84(对标 Lens「点搜索」):识别结果直接搜本地记忆库 ——
                纯查询,发现已有就不用存。 */}
            <button type="button" className="nesio-camera-select-btn" onClick={searchLocalMemory}>
              {L(dict, '搜记忆', 'Search')}
            </button>
          </div>

          {/* 批次 181:合并两处相似提示 —— 自动逐条查重(similarItems)+ 手动「搜记忆」(memSearch)
              去重合成一个「相似记忆」段(此前分散成顶部列表 + 逐条「你好像已经有了」两处重复)。 */}
          {(() => {
            const seen = new Set<string>();
            const similarNodes: LifeNode[] = [];
            for (const arr of Object.values(similarItems)) for (const s of arr) { if (!seen.has(s.node.id)) { seen.add(s.node.id); similarNodes.push(s.node); } }
            for (const n0 of memSearch || []) { if (!seen.has(n0.id)) { seen.add(n0.id); similarNodes.push(n0); } }
            const capped = similarNodes.slice(0, 8);
            if (capped.length === 0) {
              // 手动搜过但空 → 报「是新东西」;没搜过(memSearch===null)就不占位
              return memSearch !== null
                ? <p className="nesio-camera-similar-empty">{L(dict, '记忆库里没有相似的 —— 是新东西', 'Nothing similar in Memory — looks new')}</p>
                : null;
            }
            return (
              <div className="nesio-camera-similar-merged">
                <p className="nesio-camera-similar-title">{L(dict, '相似记忆 · 你可能已经有了,点开回看', 'Similar in Memory — you may already have these, tap to open')}</p>
                {capped.map((n0) => (
                  <button key={n0.id} type="button" className="nesio-camera-similar-item nesio-camera-similar-item--btn" onClick={() => setViewNode(n0)}>
                    <NodeTypeIcon type={n0.type} size={13} /> {n0.name}
                    {n0.attributes?.location ? <span className="nesio-camera-similar-loc"> · {String(n0.attributes.location)}</span> : null}
                    {visualMatchIds.has(n0.id) && <span className="nesio-camera-visual-badge">{L(dict, '图像相似', 'visual')}</span>}
                    <span style={{ marginLeft: 'auto', opacity: 0.6 }}>›</span>
                  </button>
                ))}
              </div>
            );
          })()}

          <div className="nesio-camera-result-nodes">
            {editedNodes.map((node, i) => node.deleted ? null : (
              <div key={i} className="nesio-camera-result-node nesio-camera-result-node--editable">
                {/* 批次 185(用户实锤):删除 ✕ 挪到名称输入框后面同一行,输入框缩短 */}
                <div className="nesio-camera-node-name-row">
                  <input
                    className="nesio-camera-node-name-input"
                    value={node.name}
                    onChange={(e) => setEditedNodes((prev) => prev.map((n, j) => j === i ? { ...n, name: e.target.value } : n))}
                    placeholder={L(dict, '名称', 'Name')}
                  />
                  <button
                    type="button"
                    className="nesio-camera-node-delete"
                    aria-label={L(dict, '删除此条', 'Delete this item')}
                    onClick={() => setEditedNodes((prev) => prev.map((n, j) => j === i ? { ...n, deleted: true } : n))}
                  >✕</button>
                </div>

                {/* Note */}
                <input
                  className="nesio-camera-node-note-input"
                  value={node.note || ''}
                  onChange={(e) => setEditedNodes((prev) => prev.map((n, j) => j === i ? { ...n, note: e.target.value } : n))}
                  placeholder={L(dict, '补充一句描述…（可选）', 'Add a line of description… (optional)')}
                />

                {/* Similarity alert */}
                {/* 批次 181:逐条「你好像已经有了」已并入顶部统一「相似记忆」段,这里不再重复 */}

                {/* Location — shown for objects, hierarchical picker */}
                {node.type === 'Thing' && (
                  <div className="nesio-camera-node-loc-row">
                    <span className="nesio-camera-node-expiry-label">{L(dict, '存放位置', 'Stored at')}</span>
                    <LocationPicker
                      value={nodeLocations[i] ?? ''}
                      onChange={(v, meta) => {
                        setNodeLocations((prev) => ({ ...prev, [i]: v }));
                        setNodePlaceMeta((prev) => ({ ...prev, [i]: meta || {} }));
                      }}
                      className="nesio-camera-loc-picker"
                    />
                  </div>
                )}

                {/* 批次 64:价格 —— 小票条目/物品可见可改 */}
                {(node.type === 'Thing' || isReceipt) && (
                  <div className="nesio-camera-node-expiry-row">
                    <span className="nesio-camera-node-expiry-label">{L(dict, '价格', 'Price')}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="nesio-camera-node-expiry-input"
                      placeholder={L(dict, '如 24.99', 'e.g. 24.99')}
                      value={node.price || ''}
                      onChange={(e) => setEditedNodes((prev) => prev.map((n, j) => j === i ? { ...n, price: e.target.value } : n))}
                    />
                  </div>
                )}

                {/* Expiry — shown for objects or receipt items */}
                {(node.type === 'Thing' || isReceipt) && (
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
              name: '', type: 'Thing', attributes: {}, tags: [], source: 'photo',
              confidence: 1, relations: [], deleted: false,
            }])}
          >
            {L(dict, '+ 添加条目', '+ Add item')}
          </button>

          <label className="nesio-camera-tag-field">
            <span>{L(dict, '标签', 'Tags')}</span>
            {/* QA:iOS 把这个框当可自动填充字段,QuickType 糊一层白底(截图白块)。
                全关 —— 标签不是联系人。 */}
            <input
              value={extraTags}
              onChange={(e) => setExtraTags(e.target.value)}
              /* 标签框不放示例文案 —— 一串 #钥匙 #门口 #Linda礼物 灰字看着像已经填好了,
                 而这一栏本来就是可选的。留空,上面那行「标签」标题已经说清是什么。 */
              placeholder=""
              aria-label={L(dict, '图片标签', 'Image tags')}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              name="nesio-photo-tags"
            />
          </label>

          <div className="nesio-camera-result-actions">
            {/* 主 / 次一对,同一档尺寸 —— 走 Button 原语后两者的高度、圆角、字号
                由同一处决定,不会再各写各的(以前 0.5rem/0.78rem 配 0.55rem/0.8rem,挨着看是歪的)。 */}
            <Button
              variant="primary"
              onClick={saveAll}
              disabled={saving || editedNodes.filter((n) => !n.deleted).length === 0}
            >
              {saving
                ? L(dict, '保存中…', 'Saving…')
                : L(dict, `存入记忆 (${editedNodes.filter((n) => !n.deleted).length} 条)`, `Save to Memory (${editedNodes.filter((n) => !n.deleted).length})`)}
            </Button>
            <Button variant="secondary" onClick={retake}>{L(dict, '重拍', 'Retake')}</Button>
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
          <div className="nesio-select-hint">{L(dict, '圈住区域让 AI 识别;或直接存,自己填名字', 'Circle an area for AI, or save directly and name it yourself')}</div>
          {/* 批次 87:QR 拍完立刻可用 —— 不用等任何识别 */}
          {qrChips && <div className="nesio-select-qr-slot">{qrChips}</div>}
          <div className="nesio-select-overlay-actions">
            {/* QA:AI 不再是唯一出路 —— 「直接存」零 AI 零等待;AI 识别是明示按钮 */}
            <button type="button" className="nesio-select-action-btn" onClick={saveWithoutAi}>{L(dict, '直接存', 'Save as-is')}</button>
            <button type="button" className="nesio-select-action-btn" onClick={() => analyzeFullImage()}>{L(dict, 'AI 识别全图', 'Scan full image')}</button>
            <button type="button" className="nesio-select-action-btn" onClick={retake}>{L(dict, '↩ 重拍', '↩ Retake')}</button>
          </div>
        </div>
      )}

      {phase === 'saved' && (
        <div className="nesio-camera-result-panel" style={{ textAlign: 'center', padding: 'var(--space-6) var(--space-5)' }}>
          <p style={{ color: 'var(--status-go)', fontSize: 'var(--text-display)', margin: 0, lineHeight: 1 }}>✓</p>
          <p style={{ color: 'var(--portal-ink)', fontSize: 'var(--text-h3)', fontWeight: 'var(--weight-semibold)' as unknown as number, marginTop: 'var(--space-2)' }}>{L(dict, '已存入记忆', 'Saved to Memory')}</p>
          <p style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)' }}>{L(dict, '在「记忆」里查看', 'View it in Memory')}</p>
        </div>
      )}

      {viewNodePortal}
    </div>
  );
}
