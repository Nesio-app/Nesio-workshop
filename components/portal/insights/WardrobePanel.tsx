'use client';

/**
 * WardrobePanel — 洞察「衣橱」tab。三块:
 *   ① 今天穿这套:读天气+今日日程,用 suggestOutfit 规则版(免费/端上)给一套预览。
 *   ② 加衣服:拍照/选图存本机 + 快选类型/保暖/正式度。Pro 可「AI 识别」自动填属性(analyze
 *      clothing 模式);免费手填(拍照仍可存,永不报错)。
 *   ③ 我的衣橱:按类型分组浏览,缩略图 + 属性,支持「今天穿了」(记穿着,鼓励穿遍)/删除。
 *   ④ 搭配(2026-07-28,标注 图15):存下来的搭配 —— 列表 / 按月日历两种看法,
 *      点星 = 喜欢,点不喜欢 = 淘汰(记录留着但不再推这一组)。搭配以前是现算的,关掉就没了。
 * 只读/写 life-graph(衣服=object garment 节点),随 nesio-life-graph-updated 刷新。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  listWardrobe, addGarment, removeGarment, markWorn, suggestOutfit, inferFormalNeed,
  GARMENT_TYPES, updateGarment, type Garment, type GarmentType, type Warmth, type Formality, type OutfitPrefs,
} from '@/lib/portal/wardrobe';
import { loadWardrobePrefs, recordOutfitFeedback, buildStylistDislikes } from '@/lib/portal/wardrobe-prefs';
import {
  loadOutfits, saveOutfit, patchOutfit, removeOutfit, groupByMonth, outfitsOn, retiredKeys, outfitKey,
  WARDROBE_OUTFITS_UPDATED, type SavedOutfit,
} from '@/lib/portal/wardrobe-outfits';
import { readPortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';
import { canUsePaidCloudAi, guardPaidCloudAi } from '@/lib/portal/entitlement';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import type { CalendarEvent } from '@/lib/portal/types';
import SegTabs from '../ui/SegTabs';
import { IconStar, IconThumbUp, IconThumbDown, IconCamera, IconAlertTriangle, IconRain, IconRefresh, IconMirror, IconHanger, GarmentIcon } from '../icons';

const TYPE_LABEL: Record<GarmentType, [string, string]> = {
  top: ['上装', 'Top'], bottom: ['下装', 'Bottoms'], outer: ['外套', 'Outerwear'],
  dress: ['连衣裙', 'Dress'], shoes: ['鞋', 'Shoes'], accessory: ['配饰', 'Accessory'],
};
const WARMTH_LABEL: Record<Warmth, [string, string]> = { 1: ['薄', 'Light'], 2: ['适中', 'Medium'], 3: ['保暖', 'Warm'] };
const FORMAL_LABEL: Record<Formality, [string, string]> = { casual: ['休闲', 'Casual'], smart: ['通勤', 'Smart'], formal: ['正式', 'Formal'] };

// 样式小工具:2026-07-28 从组件里提到模块级 —— 新增的 SavedOutfits(图15)也要用同一套。
const card: React.CSSProperties = { borderRadius: 'var(--radius-md)', border: '1px solid var(--portal-line)', background: 'var(--portal-accent-soft)', padding: 'var(--space-4)' };
const sectionLbl: React.CSSProperties = { margin: 'var(--space-5) 0 var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' };
const chip = (active: boolean): React.CSSProperties => ({
  padding: '0.3rem 0.7rem', borderRadius: 'var(--radius-pill)', fontSize: 'var(--text-xs)', cursor: 'pointer',
  border: `1px solid ${active ? 'transparent' : 'var(--portal-line)'}`,
  background: active ? 'var(--portal-accent)' : 'transparent',
  color: active ? 'var(--portal-on-accent, #fff)' : 'var(--portal-ink)',
});

/** 缩到 ≤1280px 的 jpeg dataURL,别把整张原图塞进 IndexedDB。 */
function compressImage(file: File): Promise<{ dataUrl: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read_failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode_failed'));
      img.onload = () => {
        const max = 1280;
        let { width, height } = img;
        if (width > max || height > max) {
          const r = Math.min(max / width, max / height);
          width = Math.round(width * r); height = Math.round(height * r);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve({ dataUrl: String(reader.result), mimeType: file.type || 'image/jpeg' }); return; }
        ctx.drawImage(img, 0, 0, width, height);
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.82), mimeType: 'image/jpeg' });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function newAssetId(): string {
  try { return `wardrobe-${crypto.randomUUID()}`; } catch { return `wardrobe-${Date.now()}-${Math.round(Math.random() * 1e9)}`; }
}

// analyze(clothing) 返回节点 → 衣物属性 patch(供单件识别 + 批量共用);无有效字段返回 null。
function attrsFromAnalyze(n: { name?: unknown; attributes?: Record<string, unknown> } | undefined): Partial<{ name: string; garmentType: GarmentType; warmth: Warmth; formality: Formality; colors: string[] }> | null {
  if (!n) return null;
  const a = n.attributes || {};
  const patch: Partial<{ name: string; garmentType: GarmentType; warmth: Warmth; formality: Formality; colors: string[] }> = {};
  if (typeof n.name === 'string' && n.name.trim()) patch.name = n.name.trim();
  if ((GARMENT_TYPES as string[]).includes(String(a.garmentType))) patch.garmentType = a.garmentType as GarmentType;
  const w = Number(a.warmth);
  if (w === 1 || w === 2 || w === 3) patch.warmth = w as Warmth;
  if (['casual', 'smart', 'formal'].includes(String(a.formality))) patch.formality = a.formality as Formality;
  if (typeof a.colors === 'string' && a.colors.trim()) patch.colors = a.colors.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
  return Object.keys(patch).length ? patch : null;
}

const isToday = (iso?: string, now = new Date()): boolean => {
  if (!iso) return false;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
};

interface Draft {
  name: string;
  garmentType: GarmentType;
  warmth: Warmth;
  formality: Formality;
  colors: string;
  dataUrl: string | null;
  mimeType: string;
}
const EMPTY_DRAFT: Draft = { name: '', garmentType: 'top', warmth: 2, formality: 'casual', colors: '', dataUrl: null, mimeType: 'image/jpeg' };

// C｜试穿:全身照存本机(固定 id,一张),localStorage 记有没有
const BODY_ASSET_ID = 'nesio-wardrobe-body';
const BODY_FLAG = 'nesio-wardrobe-body-v1';
function dataUrlToPart(dataUrl: string): { base64: string; mime: string } | null {
  const m = /^data:(image\/[a-z+]+);base64,(.*)$/i.exec(dataUrl);
  return m ? { mime: m[1], base64: m[2] } : null;
}

export default function WardrobePanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [items, setItems] = useState<Garment[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [aiBusy, setAiBusy] = useState(false);
  const [beautyBusy, setBeautyBusy] = useState(false);   // 图16:白底美化中
  const [origPhoto, setOrigPhoto] = useState<string | null>(null); // 美化前的原图,可一键换回
  const [aiError, setAiError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null); // 拍照(capture=environment)
  const uploadRef = useRef<HTMLInputElement>(null); // 上传本地图片(相册,无 capture)
  // A｜Pro 云造型师:AI 从现有单品挑一套 + 理由 + 贴士。免费/失败回落规则版 outfit。
  const [stylist, setStylist] = useState<{ pieceIds: string[]; reason: string; tips: string[] } | null>(null);
  const [stylistBusy, setStylistBusy] = useState(false);
  const [stylistError, setStylistError] = useState(false);
  const [restyleNonce, setRestyleNonce] = useState(0);
  // B｜反馈学习:本地偏好(喜欢的颜色 / 拒绝的组合),回喂规则版 + 云造型师
  const [prefs, setPrefs] = useState<OutfitPrefs>({ colorLikes: {}, dislikedItemIds: [], dislikedPairs: [] });
  const [fbFlash, setFbFlash] = useState<string | null>(null);
  // 图15:存下来的搭配
  const [tab, setTab] = useState<'today' | 'saved'>('today');
  const [outfits, setOutfits] = useState<SavedOutfit[]>([]);
  const [savedView, setSavedView] = useState<'list' | 'calendar'>('list');
  const [outfitErr, setOutfitErr] = useState('');
  // C｜上身试穿
  const [tryonOpen, setTryonOpen] = useState(false);
  const [tryonBusy, setTryonBusy] = useState(false);
  const [tryonError, setTryonError] = useState<string | null>(null);
  const [tryonResult, setTryonResult] = useState<string | null>(null);
  const [bodyThumb, setBodyThumb] = useState<string | null>(null);
  const bodyFileRef = useRef<HTMLInputElement>(null);
  // 批量上传 + 点按编辑
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const bulkRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const isPro = canUsePaidCloudAi();

  const load = () => { try { setItems(listWardrobe()); } catch { setItems([]); } };
  useEffect(() => {
    load();
    try { setPrefs(loadWardrobePrefs()); } catch { /* 无存储 */ }
    window.addEventListener('nesio-life-graph-updated', load);
    return () => window.removeEventListener('nesio-life-graph-updated', load);
  }, []);

  // 全身照(试穿用):有就读缩略图
  useEffect(() => {
    (async () => {
      try {
        if (localStorage.getItem(BODY_FLAG) !== '1') return;
        const { getLocalImage } = await import('@/lib/portal/local-image-store');
        const url = await getLocalImage(BODY_ASSET_ID);
        if (url) setBodyThumb(url);
      } catch { /* ignore */ }
    })();
  }, []);

  const onPickBody = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setTryonError(null);
    try {
      const { dataUrl } = await compressImage(file);
      const { putLocalImage } = await import('@/lib/portal/local-image-store');
      const ok = await putLocalImage(BODY_ASSET_ID, dataUrl);
      if (!ok) { setTryonError(L(dict, '全身照存不下了(存储空间满),清点空间再试。', 'Could not save the photo (storage full).')); return; }
      try { localStorage.setItem(BODY_FLAG, '1'); } catch { /* ignore */ }
      setBodyThumb(dataUrl);
    } catch { setTryonError(L(dict, '这张图读不了,换一张试试。', 'Could not read that image — try another.')); }
  };

  // 试穿:全身照 + 这套单品照 → 云端合成上身效果
  const runTryon = async (pieces: Garment[]) => {
    if (!isPro) { guardPaidCloudAi('wardrobe-tryon'); return; }
    if (!bodyThumb) { setTryonError(L(dict, '先上传一张全身照。', 'Add a full-body photo first.')); return; }
    const person = dataUrlToPart(bodyThumb);
    if (!person) { setTryonError(L(dict, '全身照读不了,重新上传一张。', 'Body photo unreadable — re-upload.')); return; }
    setTryonBusy(true); setTryonError(null); setTryonResult(null);
    try {
      const { getLocalImage } = await import('@/lib/portal/local-image-store');
      const garments: Array<{ base64: string; mime: string }> = [];
      for (const p of pieces) {
        if (!p.assetId) continue;
        const url = await getLocalImage(p.assetId);
        const part = url ? dataUrlToPart(url) : null;
        if (part) garments.push(part);
      }
      if (garments.length === 0) { setTryonError(L(dict, '这套里的单品还没有照片 —— 先给它们拍照/上传,才能试穿。', 'Outfit pieces have no photos yet — add photos to try on.')); setTryonBusy(false); return; }
      const res = await fetch('/api/portal/wardrobe-tryon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-baohe-access-mode': 'personal_lab' },
        body: JSON.stringify({ person, garments }),
      });
      const data = await res.json() as { ok?: boolean; dataUrl?: string; message?: string };
      if (data?.ok && data.dataUrl) setTryonResult(data.dataUrl);
      else setTryonError(data?.message || L(dict, '试穿没成功,过会儿再试。', 'Try-on failed — try again later.'));
    } catch {
      setTryonError(L(dict, '试穿没成功,过会儿再试。', 'Try-on failed — try again later.'));
    } finally {
      setTryonBusy(false);
    }
  };

  useEffect(() => {
    const load2 = () => setOutfits(loadOutfits());
    load2();
    window.addEventListener(WARDROBE_OUTFITS_UPDATED, load2);
    return () => window.removeEventListener(WARDROBE_OUTFITS_UPDATED, load2);
  }, []);

  /** 存/改搭配的统一出口:写不进本机存储要说出来,不假装成功。 */
  const commitOutfit = (ok: boolean, msg?: string) => {
    if (!ok) { setOutfitErr(L(dict, '没存上 —— 本机存储写不进(隐私模式或空间满了)。', 'Could not save — local storage is unavailable.')); return; }
    setOutfitErr('');
    setOutfits(loadOutfits());
    if (msg) { setFbFlash(msg); setTimeout(() => setFbFlash(null), 2000); }
  };

  // 记一条反馈(👍/👎/穿了)→ 更新本地偏好 + 触发重排(dislike 会避开这套)
  const giveFeedback = (kind: 'like' | 'dislike' | 'worn', pieces: Garment[]) => {
    if (pieces.length === 0) return;
    const next = recordOutfitFeedback(kind, pieces.map((p) => ({ id: p.id, colors: p.colors, garmentType: p.garmentType })));
    setPrefs(next);
    setFbFlash(kind === 'dislike' ? L(dict, '记下了,以后避开这套', 'Noted — I’ll avoid this') : L(dict, '记下了,以后多推这类', 'Noted — more like this'));
    setTimeout(() => setFbFlash(null), 2200);
    if (kind === 'dislike') setRestyleNonce((n) => n + 1); // 换一套,避开刚拒绝的
  };

  // 缩略图:按需从本机图库读(和收纳页同法)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { getLocalImage } = await import('@/lib/portal/local-image-store');
      for (const it of items) {
        if (!it.assetId || thumbs[it.id]) continue;
        const url = await getLocalImage(it.assetId);
        if (url && !cancelled) setThumbs((prev) => ({ ...prev, [it.id]: url }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // 今日天气/场合 context —— 规则版和云造型师共用
  const weatherCtx = useMemo(() => {
    const now = new Date();
    const w = readPortalCache<{ temperatureC?: number; tempMinC?: number; tempMaxC?: number; precipProb?: number }>(PORTAL_CACHE_KEYS.weather);
    const cal = readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar)?.events ?? [];
    const todayCal = cal.filter((e) => isToday(e.start, now));
    return {
      repTempC: w?.tempMinC ?? w?.temperatureC ?? null,
      tempMinC: w?.tempMinC ?? null,
      tempMaxC: w?.tempMaxC ?? null,
      precipProb: w?.precipProb ?? null,
      formalNeed: inferFormalNeed(todayCal),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // 规则版(免费/兜底)——始终算,离线可用;带上用户偏好。
  // 日戳用本地时间平移的 ISO(直接 toISOString 是 UTC,美东晚上会把穿搭记到「明天」—— QA 日期错位)。
  const localIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString();
  // 👎 后规则版也要可见地换一套(QA:免费档点「换一套」结果不变):
  // 把刚否决过的单品从池里拿掉再排;衣服太少避无可避时如实用全池(不假装换了)。
  const outfitPool = useMemo(() => {
    const avoid = new Set(prefs.dislikedItemIds.slice(-6));
    const filtered = items.filter((i) => !avoid.has(i.id));
    return filtered.length >= 2 ? filtered : items;
  }, [items, prefs]);
  const outfit = useMemo(() => suggestOutfit(outfitPool, weatherCtx, localIso(), prefs), [outfitPool, weatherCtx, prefs, restyleNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pro 云造型师:随衣橱/场合变化 or「重新造型」重算。失败置 stylistError,展示时回落规则版。
  useEffect(() => {
    if (!isPro || items.length < 2) { setStylist(null); setStylistError(false); return; }
    let cancelled = false;
    setStylistBusy(true); setStylistError(false);
    (async () => {
      try {
        const res = await fetch('/api/portal/wardrobe-stylist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-baohe-access-mode': 'personal_lab' },
          body: JSON.stringify({
            items: items.map((it) => ({ id: it.id, name: it.name, type: it.garmentType, warmth: it.warmth, formality: it.formality, colors: it.colors })),
            tempMinC: weatherCtx.tempMinC, tempMaxC: weatherCtx.tempMaxC, precipProb: weatherCtx.precipProb,
            occasion: weatherCtx.formalNeed, locale: dict,
            dislikes: buildStylistDislikes(prefs, new Map(items.map((it) => [it.id, { name: it.name }]))),
          }),
        });
        const data = await res.json() as { ok?: boolean; pieceIds?: string[]; reason?: string; tips?: string[] };
        if (cancelled) return;
        if (data?.ok && Array.isArray(data.pieceIds) && data.pieceIds.length) {
          setStylist({ pieceIds: data.pieceIds, reason: data.reason || '', tips: Array.isArray(data.tips) ? data.tips : [] });
        } else { setStylist(null); setStylistError(true); }
      } catch { if (!cancelled) { setStylist(null); setStylistError(true); } }
      finally { if (!cancelled) setStylistBusy(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, weatherCtx, isPro, restyleNonce, dict]);

  // 云造型师给的 pieceIds → 实际单品(丢失的忽略)
  const aiPieces = useMemo(() => {
    if (!stylist) return null;
    const byId = new Map(items.map((it) => [it.id, it]));
    const list = stylist.pieceIds.map((id) => byId.get(id)).filter(Boolean) as Garment[];
    return list.length ? list : null;
  }, [stylist, items]);

  // 当前这套(AI 优先,否则规则版)—— 试穿/反馈都用它
  const currentPieces = aiPieces ?? outfit.pieces;

  // 图14「上面增加 filter」:类型 / 厚薄 / 正式度 三轴,再加一个「还没穿过」——
  // 衣橱一多,想找「那件薄的通勤上装」只能一路往下翻。
  const [fType, setFType] = useState<GarmentType | 'all'>('all');
  const [fWarmth, setFWarmth] = useState<Warmth | 'all'>('all');
  const [fFormal, setFFormal] = useState<Formality | 'all'>('all');
  const [fUnworn, setFUnworn] = useState(false);
  const filterOn = fType !== 'all' || fWarmth !== 'all' || fFormal !== 'all' || fUnworn;

  const visible = useMemo(() => items.filter((it) => {
    if (fType !== 'all' && it.garmentType !== fType) return false;
    if (fWarmth !== 'all' && it.warmth !== fWarmth) return false;
    if (fFormal !== 'all' && it.formality !== fFormal) return false;
    if (fUnworn && it.lastWornAt) return false;
    return true;
  }), [items, fType, fWarmth, fFormal, fUnworn]);

  const grouped = useMemo(() => {
    const map = new Map<GarmentType, Garment[]>();
    for (const t of GARMENT_TYPES) map.set(t, []);
    for (const it of visible) map.get(it.garmentType)?.push(it);
    return GARMENT_TYPES.map((t) => ({ type: t, list: map.get(t) || [] })).filter((g) => g.list.length > 0);
  }, [visible]);

  // 图14「点一下进入详情页」:格子里那排小按钮(穿了 / ✎ / ✕)挤在 96px 宽里点不准,
  // 收进详情 —— 点格子进详情,大图 + 属性 + 三个动作都在里面。
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = useMemo(() => items.find((it) => it.id === detailId) || null, [items, detailId]);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAiError(null);
    try {
      const { dataUrl, mimeType } = await compressImage(file);
      setDraft((d) => ({ ...d, dataUrl, mimeType }));
    } catch {
      setAiError(L(dict, '这张图读不了,换一张试试。', 'Could not read that image — try another.'));
    }
  };

  // Pro:AI 识别照片 → 预填属性。免费走升级引导。永不盲信 —— 用户可改后再存。
  const recognize = async () => {
    if (!draft.dataUrl) return;
    if (!canUsePaidCloudAi()) { guardPaidCloudAi('wardrobe-ai'); return; }
    setAiBusy(true); setAiError(null);
    try {
      const base64 = draft.dataUrl.split(',')[1] || '';
      const res = await fetch('/api/portal/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-baohe-access-mode': 'personal_lab' },
        body: JSON.stringify({ type: 'image', mode: 'clothing', content: L(dict, '识别这件衣服', 'Identify this clothing item'), imageBase64: base64, mimeType: draft.mimeType, uiLocale: dict }),
      });
      const data = await res.json() as { ok?: boolean; nodes?: Array<{ name?: string; attributes?: Record<string, unknown> }>; error?: string };
      if (!data.ok || !data.nodes?.length) throw new Error(data.error || 'no_result');
      const n = data.nodes[0];
      const a = n.attributes || {};
      // 识别结果说这不是衣服(毯子/抱枕…)→ 如实提示,不硬塞进衣橱分类
      if (String(a.garmentType) === 'not_clothing') {
        setAiError(L(dict, `识别结果:${n.name || '这张照片'} 不像是能穿的衣物 —— 若确实要收进衣橱,手动选个分类保存。`, `This looks like ${n.name || 'a non-wearable item'}, not clothing — pick a category manually if you still want it in the wardrobe.`));
        return;
      }
      setDraft((d) => ({
        ...d,
        name: typeof n.name === 'string' && n.name.trim() ? n.name.trim() : d.name,
        garmentType: (GARMENT_TYPES as string[]).includes(String(a.garmentType)) ? (a.garmentType as GarmentType) : d.garmentType,
        warmth: (Number(a.warmth) === 1 || Number(a.warmth) === 3) ? (Number(a.warmth) as Warmth) : (Number(a.warmth) === 2 ? 2 : d.warmth),
        formality: (['casual', 'smart', 'formal'] as string[]).includes(String(a.formality)) ? (a.formality as Formality) : d.formality,
        colors: typeof a.colors === 'string' && a.colors.trim() ? a.colors.trim() : d.colors,
      }));
    } catch {
      setAiError(L(dict, 'AI 识别没成功,可以手动选下面的属性,照样能存。', 'AI recognition failed — pick the attributes below manually; it still saves.'));
    } finally {
      setAiBusy(false);
    }
  };

  /**
   * 图16「AI 识别可以直接美化衣服,变为白色背景干净图」。
   * 复用 /api/portal/avatarify(加了 style='garment' 参数)—— 鉴权/付费门/限流/双模型兜底
   * 那一整套不用再写一遍。原图先留着:美化失败或用户不满意可以一键换回去。
   */
  const beautify = async () => {
    if (!draft.dataUrl) return;
    if (!canUsePaidCloudAi()) { guardPaidCloudAi('wardrobe-ai'); return; }
    setBeautyBusy(true); setAiError(null);
    try {
      const base64 = draft.dataUrl.split(',')[1] || '';
      const res = await fetch('/api/portal/avatarify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ style: 'garment', imageBase64: base64, mimeType: draft.mimeType }),
      });
      const data = await res.json() as { ok?: boolean; dataUrl?: string; message?: string };
      if (!data.ok || !data.dataUrl) throw new Error(data.message || 'no_image');
      setOrigPhoto(draft.dataUrl);
      setDraft((d) => ({ ...d, dataUrl: data.dataUrl!, mimeType: 'image/png' }));
    } catch (err) {
      // 红线:失败必须看得见,并且给退路 —— 原图还在,照样能存。
      setAiError(err instanceof Error && err.message !== 'no_image'
        ? L(dict, `美化没成功:${err.message}`, `Clean-up failed: ${err.message}`)
        : L(dict, '美化没成功 —— 原图照样能存进衣橱。', 'Clean-up failed — the original photo still saves fine.'));
    } finally {
      setBeautyBusy(false);
    }
  };

  const save = async () => {
    const name = draft.name.trim() || L(dict, TYPE_LABEL[draft.garmentType][0], TYPE_LABEL[draft.garmentType][1]);
    const colors = draft.colors ? draft.colors.split(/[,，、]/).map((s) => s.trim()).filter(Boolean) : [];
    // 编辑模式:只改属性(照片不动)
    if (editingId) {
      updateGarment(editingId, { name, garmentType: draft.garmentType, warmth: draft.warmth, formality: draft.formality, colors });
      setEditingId(null); setDraft(EMPTY_DRAFT); setAdding(false); setAiError(null); setOrigPhoto(null);
      load();
      return;
    }
    let assetId: string | null = null;
    if (draft.dataUrl) {
      try {
        const { putLocalImage } = await import('@/lib/portal/local-image-store');
        assetId = newAssetId();
        await putLocalImage(assetId, draft.dataUrl);
      } catch { assetId = null; /* 存图失败也让衣服进衣橱,只是没缩略图 */ }
    }
    addGarment({ name, garmentType: draft.garmentType, warmth: draft.warmth, formality: draft.formality, colors, assetId, mimeType: draft.mimeType });
    setDraft(EMPTY_DRAFT); setAdding(false); setAiError(null); setOrigPhoto(null);
    load();
  };

  // 批量上传多张:每张存本机 + 建一件(Pro 顺手 AI 识别填属性,失败/免费保留默认可后补)
  const onPickBulk = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setBulkBusy(true);
    setBulkMsg(L(dict, `处理中 0/${files.length}`, `Processing 0/${files.length}`));
    const { putLocalImage } = await import('@/lib/portal/local-image-store');
    const pro = canUsePaidCloudAi();
    let aiStopped = false; // 撞到限流就停 AI、继续存图
    let added = 0;
    for (let i = 0; i < files.length; i++) {
      try {
        const { dataUrl, mimeType } = await compressImage(files[i]);
        const assetId = newAssetId();
        await putLocalImage(assetId, dataUrl);
        const node = addGarment({ name: '', garmentType: 'top', warmth: 2, formality: 'casual', assetId, mimeType });
        if (pro && !aiStopped) {
          try {
            const base64 = dataUrl.split(',')[1] || '';
            const res = await fetch('/api/portal/analyze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-baohe-access-mode': 'personal_lab' },
              body: JSON.stringify({ type: 'image', mode: 'clothing', content: L(dict, '识别这件衣服', 'Identify this clothing item'), imageBase64: base64, mimeType, uiLocale: dict }),
            });
            const data = await res.json() as { ok?: boolean; nodes?: Array<{ name?: string; attributes?: Record<string, unknown> }>; error?: string };
            if (res.status === 429 || data.error === 'rate_limited') aiStopped = true; // 剩下的先存,不再识别
            else { const patch = attrsFromAnalyze(data.nodes?.[0]); if (patch) updateGarment(node.id, patch); }
          } catch { /* 保留默认,不阻塞批量 */ }
        }
        added += 1;
      } catch { /* 跳过读不了的图 */ }
      setBulkMsg(L(dict, `处理中 ${i + 1}/${files.length}`, `Processing ${i + 1}/${files.length}`));
    }
    load();
    setBulkBusy(false);
    const tail = pro ? (aiStopped ? L(dict, '（部分已 AI 识别,其余可点每件补）', ' (some AI-tagged; tap to finish)') : L(dict, '（已 AI 识别）', ' (AI-tagged)')) : L(dict, '（点每件可补属性）', ' — tap each to edit');
    setBulkMsg(L(dict, `加了 ${added} 件${tail}`, `Added ${added}${tail}`));
    setTimeout(() => setBulkMsg(null), 4500);
  };

  // 点某件 → 用编辑表单预填(改属性)
  const startEdit = (g: Garment) => {
    setEditingId(g.id);
    setDraft({ name: g.name, garmentType: g.garmentType, warmth: g.warmth, formality: g.formality, colors: g.colors.join(','), dataUrl: null, mimeType: 'image/jpeg' });
    setAdding(true); setAiError(null);
  };

  /* ── 样式(全 token) ── */
  const todayIso = new Date().toISOString().slice(0, 10);
  const retired = retiredKeys(outfits);

  return (
    <div className="nesio-analytics-tab">
      {/* 图15:多一个「搭配」tab —— 存下来的搭配从这里翻。
          2026-07-29:原本是裸 chip 按钮(连容器都没有),是全站五套 tab 里最不像 tab 的一套 →
          统一到 SegTabs。chip() 保留给下面的**筛选**用 —— 那才是 chip 的本职。 */}
      <SegTabs
        items={[
          { key: 'today' as const, label: L(dict, '今天', 'Today') },
          { key: 'saved' as const, label: L(dict, '搭配', 'Outfits'), badge: outfits.length },
        ]}
        active={tab}
        onSelect={setTab}
        ariaLabel={L(dict, '衣橱视图', 'Wardrobe view')}
      />

      {outfitErr && (
        <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--status-risk)', background: 'var(--status-risk-soft)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-2) var(--space-3)' }} role="alert">{outfitErr}</p>
      )}

      {tab === 'saved' ? (
        <SavedOutfits
          outfits={outfits} garments={items} thumbs={thumbs} view={savedView} dict={dict}
          onView={setSavedView}
          onStar={(o) => {
            const on = !o.starred;
            commitOutfit(patchOutfit(o.id, { starred: on, retired: false }));
            // 点星 = 喜欢,喂进既有偏好(颜色好感 +1),别让「搭配」tab 变成一座孤岛
            if (on) giveFeedback('like', o.pieceIds.map((id) => items.find((g) => g.id === id)).filter(Boolean) as Garment[]);
          }}
          onRetire={(o) => {
            const next = !o.retired;
            commitOutfit(patchOutfit(o.id, { retired: next, starred: false }),
              next ? L(dict, '淘汰了 —— 以后不再推这一组', 'Retired — I won’t suggest it again') : undefined);
            if (next) {
              // 「以后不再推这一组」不能只是句话。喂给既有的偏好层(recordOutfitFeedback
              // 的 dislike 会把这对上下装写进 dislikedPairs),规则版打 -10 分、
              // 云造型师 prompt 里也会明写「别再这么搭」—— 两条推荐路径都真的避开。
              // 原先只有命中时弹一句提醒,等于承诺了没做到的事。
              giveFeedback('dislike', o.pieceIds.map((id) => items.find((g) => g.id === id)).filter(Boolean) as Garment[]);
              setRestyleNonce((n) => n + 1);
            }
          }}
          onRemove={(o) => { if (confirm(L(dict, '删掉这条搭配记录?', 'Delete this outfit record?'))) commitOutfit(removeOutfit(o.id)); }}
        />
      ) : (
      <>
      {/* ① 今天穿这套(有 AI 造型用 AI 的,否则规则版) */}
      {(() => {
        const pieces = aiPieces ?? outfit.pieces;
        if (items.length < 2 || pieces.length === 0) return null;
        // 图15:被淘汰过的一组不再推 —— 命中就直说,给一个「换一套」的出口(不静默换,免得看着像随机)
        const isRetired = retired.has(outfitKey(pieces.map((p) => p.id)));
        const reasonText = aiPieces ? stylist!.reason : (dict === 'en' ? outfit.reason[1] : outfit.reason[0]);
        return (
        <div style={{ ...card, background: 'var(--portal-accent-soft-md)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-2)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--text-body)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' }}>
              <IconHanger size={17} />{L(dict, '今天穿这套', 'Today’s outfit')}
              {aiPieces && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--portal-blue-deep)' }}><IconStar size={12} />{L(dict, 'AI 造型', 'AI styled')}</span>}
            </span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{L(dict, `${pieces.length} 件`, `${pieces.length} pieces`)}</span>
          </div>
          {/* 2026-07-28 UI 精修(标注 图12「不懂装懂」):搭配理由那段整删 ——
              「虽然是短裤,但搭配厚实的毛衣和保暖外套,可以达到保暖效果…」这种话既不像人说的,
              也帮不上忙。要看的是这套长什么样、点不点头,不是听它论证自己。 */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
            {/* 图13「图片不需要文字」:有照片就只放照片(名字进 title/aria-label,读屏和长按都还在);
                没照片的才退回文字 chip,否则一格空白没法认。 */}
            {pieces.map((p) => (thumbs[p.id] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.id} src={thumbs[p.id]} alt={p.name} title={p.name} width={56} height={56}
                style={{ width: 56, height: 56, borderRadius: 'var(--radius-sm)', objectFit: 'cover', border: '1px solid var(--portal-line)' }} />
            ) : (
              <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-sm)', background: 'var(--glass-bg-solid, var(--portal-bg))', border: '1px solid var(--portal-line)', fontSize: 'var(--text-xs)', color: 'var(--portal-ink)' }}>
                {p.name}
              </span>
            )))}
          </div>
          {/* 图12:AI 造型贴士同批删掉(同一类「解释自己」的话)。 */}
          {isRetired && (
            <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
              {L(dict, '这套你淘汰过 —— ', 'You retired this one — ')}
              <button type="button" onClick={() => setRestyleNonce((n) => n + 1)} style={linkish('var(--portal-accent)')}>{L(dict, '换一套', 'restyle')}</button>
            </p>
          )}
          {outfit.needUmbrella && (
            <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--status-calm)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}><IconRain size={13} />{L(dict, '今天可能下雨,记得带伞', 'Rain likely — take an umbrella')}</p>
          )}
          {/* 规则版的季节冲突提示(AI 造型时不显示,AI 自己会避开) */}
          {!aiPieces && outfit.mismatch && (
            <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--status-gentle)', background: 'var(--status-gentle-soft)', padding: '0.4rem 0.6rem', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}><IconAlertTriangle size={13} />{dict === 'en' ? outfit.mismatch[1] : outfit.mismatch[0]}</p>
          )}
          {/* B｜反馈:喜欢/不喜欢 → 越用越懂你(免费+Pro 都有) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            {fbFlash ? (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-go)' }}>✓ {fbFlash}</span>
            ) : (
              <>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{L(dict, '这套怎么样?', 'Like this?')}</span>
                <button type="button" aria-label={L(dict, '喜欢', 'Like')} onClick={() => giveFeedback('like', pieces)}
                  style={{ display: 'inline-flex', padding: '0.3rem 0.55rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-muted)', cursor: 'pointer' }}><IconThumbUp size={15} /></button>
                <button type="button" aria-label={L(dict, '不喜欢', 'Dislike')} onClick={() => giveFeedback('dislike', pieces)}
                  style={{ display: 'inline-flex', padding: '0.3rem 0.55rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-muted)', cursor: 'pointer' }}><IconThumbDown size={15} /></button>
                {/* 图15:这套穿了 → 存进「搭配」,以后能翻能按月看 */}
                <button type="button" onClick={() => {
                  for (const p of pieces) markWorn(p.id, new Date().toISOString());
                  giveFeedback('worn', pieces);
                  commitOutfit(saveOutfit(pieces.map((p) => p.id), todayIso), L(dict, '存进「搭配」了', 'Saved to Outfits'));
                  load();
                }}
                  style={{ marginLeft: 'auto', padding: '0.25rem 0.6rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-accent-border)', background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)', cursor: 'pointer', fontSize: 'var(--text-xs)' }}>
                  {L(dict, '这套穿了', 'Wore this')}
                </button>
                <button type="button" onClick={() => { setTryonOpen(true); setTryonResult(null); setTryonError(null); }}
                  style={{ padding: '0.25rem 0.6rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-muted)', cursor: 'pointer', fontSize: 'var(--text-xs)' }}>
                  {L(dict, '试穿', 'Try on')}
                </button>
              </>
            )}
          </div>
          {/* Pro:云造型状态 + 重新造型 */}
          {isPro && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
                {stylistBusy ? L(dict, '造型中…', 'Styling…') : stylistError ? L(dict, 'AI 造型暂不可用,先按规则搭配', 'AI styling unavailable — showing rule-based') : ''}
              </span>
              <button type="button" onClick={() => setRestyleNonce((n) => n + 1)} disabled={stylistBusy}
                style={{ flexShrink: 0, padding: '0.3rem 0.7rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-accent-border)', background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)', fontSize: 'var(--text-xs)', cursor: stylistBusy ? 'default' : 'pointer', opacity: stylistBusy ? 0.6 : 1 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}><IconRefresh size={12} />{L(dict, '换一套', 'Restyle')}</span>
              </button>
            </div>
          )}
        </div>
        );
      })() || (
        <p className="nesio-insights-empty" style={{ marginTop: 0 }}>
          {items.length === 0
            ? L(dict, '衣橱还空着。把衣服拍进来,我就能每天按天气和日程帮你搭一套。', 'Your wardrobe is empty. Add clothes and I’ll suggest a daily outfit by weather and schedule.')
            : L(dict, '再多加几件,就能自动搭出完整一套。', 'Add a few more pieces to get a full outfit.')}
        </p>
      )}

      {/* C｜上身试穿(展开在搭配卡下方) */}
      {tryonOpen && (
        <div style={{ ...card, marginTop: 'var(--space-3)', background: 'var(--glass-bg-solid, var(--portal-bg))' }}>
          <input ref={bodyFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickBody} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}><IconMirror size={15} />{L(dict, '上身试穿', 'Virtual try-on')}</span>
            <button type="button" onClick={() => setTryonOpen(false)} aria-label={L(dict, '收起', 'Close')}
              style={{ background: 'none', border: 'none', color: 'var(--portal-muted)', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
          </div>

          {tryonResult ? (
            <div style={{ marginTop: 'var(--space-3)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tryonResult} alt={L(dict, '试穿效果', 'Try-on result')} style={{ width: '100%', borderRadius: 'var(--radius-md)', border: '1px solid var(--portal-line)' }} />
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <a href={tryonResult} download="nesio-tryon.png" style={{ flex: 1, textAlign: 'center', padding: '0.5rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-line)', color: 'var(--portal-ink)', fontSize: 'var(--text-sm)', textDecoration: 'none' }}>{L(dict, '保存图片', 'Save image')}</a>
                <button type="button" onClick={() => runTryon(currentPieces)} disabled={tryonBusy}
                  style={{ flex: 1, padding: '0.5rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-accent-border)', background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)', fontSize: 'var(--text-sm)', cursor: tryonBusy ? 'default' : 'pointer', opacity: tryonBusy ? 0.6 : 1 }}>{L(dict, '再试一次', 'Try again')}</button>
              </div>
            </div>
          ) : (
            <>
              {/* 全身照 */}
              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', marginTop: 'var(--space-3)' }}>
                <button type="button" onClick={() => bodyFileRef.current?.click()}
                  style={{ flexShrink: 0, width: 64, height: 84, borderRadius: 'var(--radius-md)', border: '1px dashed var(--portal-accent-border)', background: 'var(--portal-accent-soft)', cursor: 'pointer', overflow: 'hidden', color: 'var(--portal-muted)', fontSize: 'var(--text-xs)', padding: 0 }}>
                  {bodyThumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={bodyThumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem' }}><IconCamera size={18} />{L(dict, '全身照', 'Full body')}</span>}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', lineHeight: 1.6 }}>
                    {bodyThumb
                      ? L(dict, '用这张全身照把这套穿上看看。可随时换一张。', 'Use this full-body photo to see the outfit on you. Swap anytime.')
                      : L(dict, '上传一张全身照(正面、光线好),就能看这套穿在你身上的样子。', 'Add a full-body photo (front, good light) to see the outfit on you.')}
                  </p>
                  {bodyThumb && (
                    <button type="button" onClick={() => bodyFileRef.current?.click()}
                      style={{ marginTop: '0.4rem', padding: '0.25rem 0.6rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-muted)', fontSize: 'var(--text-xs)', cursor: 'pointer' }}>{L(dict, '换全身照', 'Change photo')}</button>
                  )}
                </div>
              </div>

              {tryonError && (
                <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--status-gentle)', background: 'var(--status-gentle-soft)', padding: '0.4rem 0.6rem', borderRadius: 'var(--radius-sm)' }}>{tryonError}</p>
              )}

              <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: 'var(--space-3)', opacity: tryonBusy ? 0.6 : 1 }}
                disabled={tryonBusy} onClick={() => runTryon(currentPieces)}>
                {tryonBusy ? L(dict, '生成中…(约十几秒)', 'Generating… (~15s)') : !isPro ? L(dict, '试穿这套(Pro)', 'Try on (Pro)') : L(dict, '试穿这套', 'Try on')}
              </button>
              <p style={{ margin: 'var(--space-2) 0 0', fontSize: '0.62rem', color: 'var(--portal-muted)', lineHeight: 1.5 }}>
                {L(dict, '全身照只存在你手机本地,仅在点「试穿」时用于生成,服务端不留存。', 'Your photo stays on your device — sent only when you tap Try on, never stored on the server.')}
              </p>
            </>
          )}
        </div>
      )}

      {/* ② 加衣服 / 批量上传 */}
      <input ref={bulkRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onPickBulk} />
      {!adding ? (
        <>
          {/* 图13「一个按钮,点一下可以上传可以拍照」:原来「+ 加一件」和「批量上传」并排,
              两个入口做同一件事(把衣服弄进衣橱)。合成一个 —— 选相册可以多选(等于原批量上传),
              也可以直接拍。系统选择器自己会给「拍照 / 照片图库」两个选项。 */}
          <div style={{ marginTop: 'var(--space-4)' }}>
            <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', opacity: bulkBusy ? 0.6 : 1 }} disabled={bulkBusy}
              onClick={() => bulkRef.current?.click()}>
              {bulkBusy ? L(dict, '处理中…', 'Working…') : L(dict, '+ 加衣服 · 拍照或选图(可多选)', '+ Add clothes · shoot or pick (multi)')}
            </button>
          </div>
          {bulkMsg && (
            <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-xs)', color: bulkBusy ? 'var(--portal-muted)' : 'var(--status-go)', textAlign: 'center' }}>{bulkBusy ? '' : '✓ '}{bulkMsg}</p>
          )}
        </>
      ) : (
        <div style={{ ...card, marginTop: 'var(--space-4)', background: 'var(--glass-bg-solid, var(--portal-bg))' }}>
          {editingId && <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' }}>{L(dict, '编辑衣物 · 改属性(照片不动)', 'Edit · attributes only')}</p>}
          {/* 拍照走相机;上传走相册(无 capture) —— 两个入口共用 onPickFile */}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onPickFile} />
          <input ref={uploadRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickFile} />
          {/* 两个大号取图入口:一眼可见,并排等宽(编辑时隐藏 —— 只改属性) */}
          {!editingId && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
            <button type="button" onClick={() => cameraRef.current?.click()}
              style={{ flex: 1, padding: '0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-accent-border)', background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', cursor: 'pointer' }}>{L(dict, '拍照', 'Camera')}</button>
            <button type="button" onClick={() => uploadRef.current?.click()}
              style={{ flex: 1, padding: '0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-accent-border)', background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', cursor: 'pointer' }}>{L(dict, '上传照片', 'Upload photo')}</button>
          </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            {!editingId && (
            <button type="button" onClick={() => uploadRef.current?.click()}
              aria-label={L(dict, '选择衣服照片', 'Choose clothing photo')}
              style={{ flexShrink: 0, width: 76, height: 76, borderRadius: 'var(--radius-md)', border: '1px dashed var(--portal-accent-border)', background: 'var(--portal-accent-soft)', cursor: 'pointer', overflow: 'hidden', color: 'var(--portal-muted)', fontSize: '1.4rem', padding: 0 }}>
              {draft.dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={draft.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : <GarmentIcon type={draft.garmentType} size={26} />}
            </button>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder={L(dict, '名字(可留空)', 'Name (optional)')}
                style={{ width: '100%', padding: '0.5rem 0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-ink)', fontSize: 'var(--text-sm)' }} />
              {draft.dataUrl && (
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                  <button type="button" onClick={recognize} disabled={aiBusy || beautyBusy}
                    style={{ padding: '0.35rem 0.7rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-accent-border)', background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)', fontSize: 'var(--text-xs)', cursor: aiBusy ? 'default' : 'pointer', opacity: aiBusy ? 0.6 : 1 }}>
                    {aiBusy ? L(dict, '识别中…', 'Recognizing…') : L(dict, 'AI 识别属性(Pro)', 'AI attributes (Pro)')}
                  </button>
                  {/* 图16:把这张照片洗成白底干净的单品图 */}
                  <button type="button" onClick={beautify} disabled={aiBusy || beautyBusy}
                    style={{ padding: '0.35rem 0.7rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-accent-border)', background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)', fontSize: 'var(--text-xs)', cursor: beautyBusy ? 'default' : 'pointer', opacity: beautyBusy ? 0.6 : 1 }}>
                    {beautyBusy ? L(dict, '美化中…(约十几秒)', 'Cleaning up… (~15s)') : L(dict, '洗成白底图(Pro)', 'White background (Pro)')}
                  </button>
                  {origPhoto && (
                    <button type="button" onClick={() => { setDraft((d) => ({ ...d, dataUrl: origPhoto })); setOrigPhoto(null); }}
                      style={{ padding: '0.35rem 0.7rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-muted)', fontSize: 'var(--text-xs)', cursor: 'pointer' }}>
                      {L(dict, '还是用原图', 'Use original')}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {aiError && (
            <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--status-gentle)', background: 'var(--status-gentle-soft)', padding: '0.4rem 0.6rem', borderRadius: 'var(--radius-sm)' }}>{aiError}</p>
          )}

          <p style={{ ...sectionLbl, marginTop: 'var(--space-4)' }}>{L(dict, '类型', 'Type')}</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {GARMENT_TYPES.map((t) => (
              <button key={t} type="button" style={chip(draft.garmentType === t)} onClick={() => setDraft((d) => ({ ...d, garmentType: t }))}>{L(dict, TYPE_LABEL[t][0], TYPE_LABEL[t][1])}</button>
            ))}
          </div>

          <p style={sectionLbl}>{L(dict, '厚薄', 'Warmth')}</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {([1, 2, 3] as Warmth[]).map((w) => (
              <button key={w} type="button" style={chip(draft.warmth === w)} onClick={() => setDraft((d) => ({ ...d, warmth: w }))}>{L(dict, WARMTH_LABEL[w][0], WARMTH_LABEL[w][1])}</button>
            ))}
          </div>

          <p style={sectionLbl}>{L(dict, '正式度', 'Formality')}</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {(['casual', 'smart', 'formal'] as Formality[]).map((f) => (
              <button key={f} type="button" style={chip(draft.formality === f)} onClick={() => setDraft((d) => ({ ...d, formality: f }))}>{L(dict, FORMAL_LABEL[f][0], FORMAL_LABEL[f][1])}</button>
            ))}
          </div>

          <input value={draft.colors} onChange={(e) => setDraft((d) => ({ ...d, colors: e.target.value }))}
            placeholder={L(dict, '颜色(逗号分隔,可留空)', 'Colors (comma-separated, optional)')}
            style={{ width: '100%', marginTop: 'var(--space-4)', padding: '0.5rem 0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-ink)', fontSize: 'var(--text-sm)' }} />

          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
            <button type="button" className="nesio-ob-primary-btn" style={{ flex: 1 }} onClick={save}>{editingId ? L(dict, '保存修改', 'Save changes') : L(dict, '存进衣橱', 'Save')}</button>
            <button type="button" onClick={() => { setAdding(false); setEditingId(null); setAiError(null); setOrigPhoto(null); }}
              style={{ padding: '0 var(--space-4)', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-muted)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>{L(dict, '取消', 'Cancel')}</button>
          </div>
        </div>
      )}

      {/* ③ 我的衣橱(按类型分组) */}
      {items.length > 0 && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <button type="button" style={chip(fType === 'all')} onClick={() => setFType('all')}>{L(dict, '全部类型', 'All types')}</button>
            {GARMENT_TYPES.map((t) => (
              <button key={t} type="button" style={chip(fType === t)} onClick={() => setFType(fType === t ? 'all' : t)}>{L(dict, TYPE_LABEL[t][0], TYPE_LABEL[t][1])}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
            {([1, 2, 3] as Warmth[]).map((w) => (
              <button key={w} type="button" style={chip(fWarmth === w)} onClick={() => setFWarmth(fWarmth === w ? 'all' : w)}>{L(dict, WARMTH_LABEL[w][0], WARMTH_LABEL[w][1])}</button>
            ))}
            {(['casual', 'smart', 'formal'] as Formality[]).map((f) => (
              <button key={f} type="button" style={chip(fFormal === f)} onClick={() => setFFormal(fFormal === f ? 'all' : f)}>{L(dict, FORMAL_LABEL[f][0], FORMAL_LABEL[f][1])}</button>
            ))}
            <button type="button" style={chip(fUnworn)} onClick={() => setFUnworn((v) => !v)}>{L(dict, '还没穿过', 'Never worn')}</button>
          </div>
          {filterOn && (
            <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
              {L(dict, `${visible.length} / ${items.length} 件`, `${visible.length} of ${items.length}`)}
            </p>
          )}
        </div>
      )}

      {/* 图14:单品详情 —— 大图 + 属性 + 穿了/编辑/移除 */}
      {detail && (
        <div style={{ ...card, marginTop: 'var(--space-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' }}>{detail.name}</span>
            <button type="button" onClick={() => setDetailId(null)}
              style={{ background: 'none', border: 'none', color: 'var(--portal-muted)', fontSize: 'var(--text-xs)', cursor: 'pointer', padding: 0 }}>{L(dict, '收起', 'Close')}</button>
          </div>
          {thumbs[detail.id] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbs[detail.id]} alt={detail.name}
              style={{ width: '100%', marginTop: 'var(--space-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--portal-line)' }} />
          )}
          <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>
            {L(dict, TYPE_LABEL[detail.garmentType][0], TYPE_LABEL[detail.garmentType][1])} · {L(dict, WARMTH_LABEL[detail.warmth][0], WARMTH_LABEL[detail.warmth][1])} · {L(dict, FORMAL_LABEL[detail.formality][0], FORMAL_LABEL[detail.formality][1])}
            {detail.lastWornAt ? ` · ${L(dict, `上次穿 ${detail.lastWornAt.slice(5, 10)}`, `worn ${detail.lastWornAt.slice(5, 10)}`)}` : ` · ${L(dict, '还没穿过', 'never worn')}`}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
            <button type="button" className="nesio-ob-primary-btn" style={{ flex: 1 }}
              onClick={() => { markWorn(detail.id, new Date().toISOString()); giveFeedback('worn', [detail]); load(); }}>{L(dict, '今天穿了', 'Worn today')}</button>
            <button type="button" onClick={() => { startEdit(detail); setDetailId(null); }}
              style={{ padding: '0 var(--space-4)', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-ink)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>{L(dict, '编辑', 'Edit')}</button>
            <button type="button" onClick={() => { if (confirm(L(dict, `从衣橱移除「${detail.name}」?`, `Remove “${detail.name}” from wardrobe?`))) { removeGarment(detail.id); setDetailId(null); load(); } }}
              style={{ padding: '0 var(--space-4)', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--status-risk)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>{L(dict, '移除', 'Remove')}</button>
          </div>
        </div>
      )}

      {grouped.map((g) => (
        <div key={g.type}>
          <p style={sectionLbl}>{L(dict, TYPE_LABEL[g.type][0], TYPE_LABEL[g.type][1])} <span style={{ color: 'var(--portal-muted)', fontWeight: 'var(--weight-regular)' }}>{g.list.length}</span></p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 'var(--space-2)' }}>
            {g.list.map((it) => (
              <button key={it.id} type="button" onClick={() => setDetailId(it.id)}
                aria-label={it.name}
                style={{ padding: 0, textAlign: 'left', cursor: 'pointer', borderRadius: 'var(--radius-md)', border: '1px solid var(--portal-line)', background: 'var(--glass-bg-solid, var(--portal-bg))', overflow: 'hidden' }}>
                <div style={{ aspectRatio: '1', background: 'var(--portal-accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--portal-muted)', fontSize: '1.4rem' }}>
                  {thumbs[it.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbs[it.id]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : <GarmentIcon type={it.garmentType} size={26} />}
                </div>
                <div style={{ padding: '0.4rem 0.5rem' }}>
                  <p style={{ margin: 0, fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--portal-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</p>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '0.62rem', color: 'var(--portal-muted)' }}>
                    {L(dict, WARMTH_LABEL[it.warmth][0], WARMTH_LABEL[it.warmth][1])} · {L(dict, FORMAL_LABEL[it.formality][0], FORMAL_LABEL[it.formality][1])}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
      </>
      )}
    </div>
  );
}

/**
 * SavedOutfits — 存下来的搭配(2026-07-28,标注 图15)。
 * 两种看法:列表(新→旧)/ 按月日历(哪天穿了什么,一眼看出哪几天没记)。
 * 点星 = 喜欢;点不喜欢 = 淘汰(记录留着,但搭配不再推这一组)。
 */
function SavedOutfits({ outfits, garments, thumbs, view, dict, onView, onStar, onRetire, onRemove }: {
  outfits: SavedOutfit[]; garments: Garment[]; thumbs: Record<string, string>;
  view: 'list' | 'calendar'; dict: string;
  onView: (v: 'list' | 'calendar') => void;
  onStar: (o: SavedOutfit) => void; onRetire: (o: SavedOutfit) => void; onRemove: (o: SavedOutfit) => void;
}) {
  const byId = useMemo(() => new Map(garments.map((g) => [g.id, g])), [garments]);
  const months = useMemo(() => groupByMonth(outfits), [outfits]);
  // 日历里点某一天 → 下面只列那天穿的;再点一次取消,回到整月。
  const [pickedDay, setPickedDay] = useState<string | null>(null);

  if (outfits.length === 0) {
    return (
      <p className="nesio-insights-empty" style={{ marginTop: 0 }}>
        {L(dict, '还没存过搭配 —— 在「今天」里点「这套穿了」,它就会留在这儿,以后能按月翻。', 'No outfits saved yet — tap “Wore this” on the Today tab and they’ll collect here.')}
      </p>
    );
  }

  const Row = ({ o }: { o: SavedOutfit }) => {
    const pieces = o.pieceIds.map((id) => byId.get(id)).filter(Boolean) as Garment[];
    return (
      <div style={{ ...card, opacity: o.retired ? 0.55 : 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' }}>
            {dict === 'en'
              ? o.date.slice(5).replace('-', '/')
              : `${Number(o.date.slice(5, 7))}月${Number(o.date.slice(8, 10))}日`}
          </span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
            {o.retired ? L(dict, '已淘汰', 'Retired') : o.starred ? L(dict, '喜欢', 'Loved') : L(dict, `${pieces.length} 件`, `${pieces.length} pieces`)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
          {pieces.map((p) => (thumbs[p.id] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p.id} src={thumbs[p.id]} alt={p.name} title={p.name} width={52} height={52}
              style={{ width: 52, height: 52, borderRadius: 'var(--radius-sm)', objectFit: 'cover', border: '1px solid var(--portal-line)' }} />
          ) : (
            <span key={p.id} style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-ink)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-sm)', padding: '0.25rem 0.5rem' }}>{p.name}</span>
          )))}
          {pieces.length === 0 && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{L(dict, '这套里的衣服已经不在衣橱里了', 'These pieces are no longer in your wardrobe')}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
          <button type="button" onClick={() => onStar(o)} style={linkish(o.starred ? 'var(--status-gentle)' : 'var(--portal-muted)')}>
            <span style={{ color: o.starred ? 'var(--status-gentle)' : 'var(--portal-muted)', marginRight: 'var(--space-1)', display: 'inline-flex', verticalAlign: '-2px' }}>
              <IconStar size={13} />
            </span>
            {o.starred ? L(dict, '喜欢', 'Loved') : L(dict, '喜欢', 'Love it')}
          </button>
          <button type="button" onClick={() => onRetire(o)} style={linkish(o.retired ? 'var(--portal-accent)' : 'var(--portal-muted)')}>
            {o.retired ? L(dict, '取消淘汰', 'Un-retire') : L(dict, '不喜欢 · 淘汰', 'Retire')}
          </button>
          <button type="button" onClick={() => onRemove(o)} style={{ ...linkish('var(--portal-muted)'), marginLeft: 'auto' }}>{L(dict, '删记录', 'Delete')}</button>
        </div>
      </div>
    );
  };

  return (
    <>
      <SegTabs
        size="sm"
        items={[
          { key: 'list' as const, label: L(dict, '列表', 'List') },
          { key: 'calendar' as const, label: L(dict, '日历', 'Calendar') },
        ]}
        active={view}
        onSelect={(k) => { onView(k); if (k === 'calendar') setPickedDay(null); }}
        ariaLabel={L(dict, '搭配看法', 'Outfit view')}
      />

      {view === 'list' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {outfits.map((o) => <Row key={o.id} o={o} />)}
        </div>
      ) : (
        months.map((m) => {
          // 「N 天」要数**不同的日期**,不是数条数 —— 同一天存了两套会显示成 2 天。
          // (和健身页那个「本周 N 次 / 七天点」是同一类口径混淆,这里数天。)
          const days = new Set(m.items.map((o) => o.date)).size;
          return (
            <div key={m.month} style={{ marginBottom: 'var(--space-5)' }}>
              <p style={sectionLbl}>{dict === 'en' ? m.month : `${m.month.slice(0, 4)} 年 ${Number(m.month.slice(5))} 月`}
                <span style={{ color: 'var(--portal-muted)', fontWeight: 'var(--weight-regular)' }}> {L(dict, `${days} 天`, `${days} days`)}</span>
              </p>
              <MonthGrid month={m.month} items={m.items} thumbs={thumbs} dict={dict} selected={pickedDay} onPick={setPickedDay} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
                {(pickedDay && pickedDay.slice(0, 7) === m.month ? outfitsOn(m.items, pickedDay) : m.items).map((o) => <Row key={o.id} o={o} />)}
              </div>
            </div>
          );
        })
      )}
    </>
  );
}


/**
 * 一个月的日历格子:有搭配的那天亮一个点,点它只看那天的。
 * 图15 要的是「按日历展示」—— 第一版只做了按月分组的列表(状态名还叫 calendar),
 * 为日历写的 outfitsOn 一直没人用。这里把它补成真的日历。
 * 周一起头,和健身页的七天点同一个约定。
 */
function MonthGrid({ month, items, thumbs, dict, selected, onPick }: {
  month: string; items: SavedOutfit[]; thumbs: Record<string, string>; dict: string;
  selected: string | null; onPick: (d: string | null) => void;
}) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7;              // 周一=0
  const days = new Date(y, m, 0).getDate();
  const has = new Set(items.map((o) => o.date));
  // 每天取一张预览图:那天最先存的那套里,第一件有图的单品。
  // 日历的价值就在「一眼看见那天穿的什么样」,所以格子里放图不放字。
  const preview = new Map<string, string>();
  for (const o of items) {
    if (preview.has(o.date)) continue;
    const url = o.pieceIds.map((id) => thumbs[id]).find(Boolean);
    if (url) preview.set(o.date, url);
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const week = dict === 'en' ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['一', '二', '三', '四', '五', '六', '日'];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--space-1)', marginBottom: 'var(--space-1)' }}>
        {week.map((w, i) => (
          <span key={i} style={{ textAlign: 'center', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{w}</span>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--space-1)' }}>
        {Array.from({ length: lead }, (_, i) => <span key={`lead${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const date = `${y}-${pad(m)}-${pad(i + 1)}`;
          const on = has.has(date);
          const sel = selected === date;
          const img = preview.get(date);
          return (
            <button
              key={date}
              type="button"
              disabled={!on}
              onClick={() => onPick(sel ? null : date)}
              aria-pressed={sel}
              aria-label={L(dict, `${m} 月 ${i + 1} 日${on ? ' · 有搭配' : ''}`, `${month}-${pad(i + 1)}${on ? ' · has outfit' : ''}`)}
              style={{
                position: 'relative', overflow: 'hidden',
                aspectRatio: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: '2px', border: sel ? '2px solid var(--portal-accent)' : '1px solid transparent',
                borderRadius: 'var(--radius-sm)',
                background: sel ? 'var(--portal-accent-soft-md)' : on ? 'var(--portal-accent-soft)' : 'transparent',
                color: on ? 'var(--portal-ink)' : 'var(--portal-muted)',
                fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)',
                cursor: on ? 'pointer' : 'default', opacity: on ? 1 : 0.45, padding: 0,
              }}
            >
              {img ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img} alt="" aria-hidden
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius-sm)' }} />
                  {/* 日期压在图上:缩到角上、加一层底,保证任何照片上都读得清 */}
                  <span style={{
                    position: 'absolute', left: 2, top: 2, lineHeight: 1,
                    fontSize: '0.6rem', padding: '1px 3px', borderRadius: '4px',
                    background: 'var(--sheet-opaque)', color: 'var(--portal-ink)', opacity: 0.9,
                  }}>{i + 1}</span>
                </>
              ) : (
                <>
                  {i + 1}
                  {/* 那天有搭配但单品没照片 —— 退回一个点,别让格子看着像空的 */}
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: on ? 'var(--portal-accent)' : 'transparent' }} />
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const linkish = (color: string): React.CSSProperties => ({
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', color,
});
