'use client';

/**
 * WardrobePanel — 洞察「衣橱」tab。三块:
 *   ① 今天穿这套:读天气+今日日程,用 suggestOutfit 规则版(免费/端上)给一套预览。
 *   ② 加衣服:拍照/选图存本机 + 快选类型/保暖/正式度。Pro 可「AI 识别」自动填属性(analyze
 *      clothing 模式);免费手填(拍照仍可存,永不报错)。
 *   ③ 我的衣橱:按类型分组浏览,缩略图 + 属性,支持「今天穿了」(记穿着,鼓励穿遍)/删除。
 * 只读/写 life-graph(衣服=object garment 节点),随 nesio-life-graph-updated 刷新。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  listWardrobe, addGarment, removeGarment, markWorn, suggestOutfit, inferFormalNeed,
  GARMENT_TYPES, updateGarment, type Garment, type GarmentType, type Warmth, type Formality, type OutfitPrefs,
} from '@/lib/portal/wardrobe';
import { loadWardrobePrefs, recordOutfitFeedback, buildStylistDislikes } from '@/lib/portal/wardrobe-prefs';
import { readPortalCache, PORTAL_CACHE_KEYS } from '@/lib/portal/prefetch-cache';
import { canUsePaidCloudAi, guardPaidCloudAi } from '@/lib/portal/entitlement';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import type { CalendarEvent } from '@/lib/portal/types';

const TYPE_LABEL: Record<GarmentType, [string, string]> = {
  top: ['上装', 'Top'], bottom: ['下装', 'Bottoms'], outer: ['外套', 'Outerwear'],
  dress: ['连衣裙', 'Dress'], shoes: ['鞋', 'Shoes'], accessory: ['配饰', 'Accessory'],
};
const WARMTH_LABEL: Record<Warmth, [string, string]> = { 1: ['薄', 'Light'], 2: ['适中', 'Medium'], 3: ['保暖', 'Warm'] };
const FORMAL_LABEL: Record<Formality, [string, string]> = { casual: ['休闲', 'Casual'], smart: ['通勤', 'Smart'], formal: ['正式', 'Formal'] };

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

  // 规则版(免费/兜底)——始终算,离线可用;带上用户偏好
  const outfit = useMemo(() => suggestOutfit(items, weatherCtx, new Date().toISOString(), prefs), [items, weatherCtx, prefs]);

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

  const grouped = useMemo(() => {
    const map = new Map<GarmentType, Garment[]>();
    for (const t of GARMENT_TYPES) map.set(t, []);
    for (const it of items) map.get(it.garmentType)?.push(it);
    return GARMENT_TYPES.map((t) => ({ type: t, list: map.get(t) || [] })).filter((g) => g.list.length > 0);
  }, [items]);

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

  const save = async () => {
    const name = draft.name.trim() || L(dict, TYPE_LABEL[draft.garmentType][0], TYPE_LABEL[draft.garmentType][1]);
    const colors = draft.colors ? draft.colors.split(/[,，、]/).map((s) => s.trim()).filter(Boolean) : [];
    // 编辑模式:只改属性(照片不动)
    if (editingId) {
      updateGarment(editingId, { name, garmentType: draft.garmentType, warmth: draft.warmth, formality: draft.formality, colors });
      setEditingId(null); setDraft(EMPTY_DRAFT); setAdding(false); setAiError(null);
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
    setDraft(EMPTY_DRAFT); setAdding(false); setAiError(null);
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
  const card: React.CSSProperties = { borderRadius: 'var(--radius-md)', border: '1px solid var(--portal-line)', background: 'var(--portal-accent-soft)', padding: 'var(--space-4)' };
  const sectionLbl: React.CSSProperties = { margin: 'var(--space-5) 0 var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' };
  const chip = (active: boolean): React.CSSProperties => ({
    padding: '0.3rem 0.7rem', borderRadius: 'var(--radius-pill)', fontSize: 'var(--text-xs)', cursor: 'pointer',
    border: `1px solid ${active ? 'transparent' : 'var(--portal-line)'}`,
    background: active ? 'var(--portal-accent)' : 'transparent',
    color: active ? 'var(--portal-on-accent, #fff)' : 'var(--portal-ink)',
  });

  return (
    <div className="nesio-analytics-tab">
      {/* ① 今天穿这套(有 AI 造型用 AI 的,否则规则版) */}
      {(() => {
        const pieces = aiPieces ?? outfit.pieces;
        if (items.length < 2 || pieces.length === 0) return null;
        const reasonText = aiPieces ? stylist!.reason : (dict === 'en' ? outfit.reason[1] : outfit.reason[0]);
        return (
        <div style={{ ...card, background: 'var(--portal-accent-soft-md)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' }}>
              👔 {L(dict, '今天穿这套', 'Today’s outfit')}
              {aiPieces && <span style={{ marginLeft: '0.4rem', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--portal-blue-deep)' }}>✨ {L(dict, 'AI 造型', 'AI styled')}</span>}
            </span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{L(dict, `${pieces.length} 件`, `${pieces.length} pieces`)}</span>
          </div>
          {reasonText && <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', lineHeight: 1.6 }}>{reasonText}</p>}
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
            {pieces.map((p) => (
              <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-sm)', background: 'var(--glass-bg-solid, var(--portal-bg))', border: '1px solid var(--portal-line)', fontSize: 'var(--text-xs)', color: 'var(--portal-ink)' }}>
                {thumbs[p.id] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbs[p.id]} alt="" width={20} height={20} style={{ borderRadius: 4, objectFit: 'cover' }} />
                )}
                {p.name}
              </span>
            ))}
          </div>
          {/* AI 造型贴士 */}
          {aiPieces && stylist!.tips.length > 0 && (
            <ul style={{ margin: 'var(--space-2) 0 0', paddingLeft: '1.1rem', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', lineHeight: 1.7 }}>
              {stylist!.tips.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          )}
          {outfit.needUmbrella && (
            <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--status-calm)' }}>☔ {L(dict, '今天可能下雨,记得带伞', 'Rain likely — take an umbrella')}</p>
          )}
          {/* 规则版的季节冲突提示(AI 造型时不显示,AI 自己会避开) */}
          {!aiPieces && outfit.mismatch && (
            <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--status-gentle)', background: 'var(--status-gentle-soft)', padding: '0.4rem 0.6rem', borderRadius: 'var(--radius-sm)' }}>⚠ {dict === 'en' ? outfit.mismatch[1] : outfit.mismatch[0]}</p>
          )}
          {/* B｜反馈:喜欢/不喜欢 → 越用越懂你(免费+Pro 都有) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            {fbFlash ? (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-go)' }}>✓ {fbFlash}</span>
            ) : (
              <>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{L(dict, '这套怎么样?', 'Like this?')}</span>
                <button type="button" aria-label={L(dict, '喜欢', 'Like')} onClick={() => giveFeedback('like', pieces)}
                  style={{ padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-line)', background: 'transparent', cursor: 'pointer', fontSize: 'var(--text-sm)' }}>👍</button>
                <button type="button" aria-label={L(dict, '不喜欢', 'Dislike')} onClick={() => giveFeedback('dislike', pieces)}
                  style={{ padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-line)', background: 'transparent', cursor: 'pointer', fontSize: 'var(--text-sm)' }}>👎</button>
                <button type="button" onClick={() => { setTryonOpen(true); setTryonResult(null); setTryonError(null); }}
                  style={{ marginLeft: 'auto', padding: '0.25rem 0.6rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-accent-border)', background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)', cursor: 'pointer', fontSize: 'var(--text-xs)' }}>
                  {L(dict, '🪞 试穿这套', '🪞 Try on')}
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
                {L(dict, '✨ 换一套', '✨ Restyle')}
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
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' }}>🪞 {L(dict, '上身试穿', 'Virtual try-on')}</span>
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
                  ) : L(dict, '📷 全身照', '📷 Full body')}
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
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
            <button type="button" className="nesio-ob-primary-btn" style={{ flex: 1, opacity: bulkBusy ? 0.6 : 1 }} disabled={bulkBusy} onClick={() => { setEditingId(null); setDraft(EMPTY_DRAFT); setAdding(true); setAiError(null); }}>
              {L(dict, '+ 加一件', '+ Add one')}
            </button>
            <button type="button" onClick={() => bulkRef.current?.click()} disabled={bulkBusy}
              style={{ flex: 1, padding: '0.7rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-accent-border)', background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', cursor: bulkBusy ? 'default' : 'pointer', opacity: bulkBusy ? 0.6 : 1 }}>
              {bulkBusy ? L(dict, '处理中…', 'Working…') : L(dict, '📸 批量上传', '📸 Bulk upload')}
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
              style={{ flex: 1, padding: '0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-accent-border)', background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', cursor: 'pointer' }}>{L(dict, '📷 拍照', '📷 Camera')}</button>
            <button type="button" onClick={() => uploadRef.current?.click()}
              style={{ flex: 1, padding: '0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-accent-border)', background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', cursor: 'pointer' }}>{L(dict, '🖼 上传照片', '🖼 Upload photo')}</button>
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
              ) : '👕'}
            </button>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder={L(dict, '名字(可留空)', 'Name (optional)')}
                style={{ width: '100%', padding: '0.5rem 0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-ink)', fontSize: 'var(--text-sm)' }} />
              {draft.dataUrl && (
                <button type="button" onClick={recognize} disabled={aiBusy}
                  style={{ marginTop: '0.4rem', padding: '0.35rem 0.7rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-accent-border)', background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)', fontSize: 'var(--text-xs)', cursor: aiBusy ? 'default' : 'pointer', opacity: aiBusy ? 0.6 : 1 }}>
                  {aiBusy ? L(dict, '识别中…', 'Recognizing…') : L(dict, '✨ AI 识别(Pro)', '✨ AI recognize (Pro)')}
                </button>
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
            <button type="button" onClick={() => { setAdding(false); setEditingId(null); setAiError(null); }}
              style={{ padding: '0 var(--space-4)', borderRadius: 'var(--radius-pill)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-muted)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>{L(dict, '取消', 'Cancel')}</button>
          </div>
        </div>
      )}

      {/* ③ 我的衣橱(按类型分组) */}
      {grouped.map((g) => (
        <div key={g.type}>
          <p style={sectionLbl}>{L(dict, TYPE_LABEL[g.type][0], TYPE_LABEL[g.type][1])} <span style={{ color: 'var(--portal-muted)', fontWeight: 'var(--weight-regular)' }}>{g.list.length}</span></p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 'var(--space-2)' }}>
            {g.list.map((it) => (
              <div key={it.id} style={{ borderRadius: 'var(--radius-md)', border: '1px solid var(--portal-line)', background: 'var(--glass-bg-solid, var(--portal-bg))', overflow: 'hidden' }}>
                <div style={{ aspectRatio: '1', background: 'var(--portal-accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--portal-muted)', fontSize: '1.4rem' }}>
                  {thumbs[it.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbs[it.id]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : '👕'}
                </div>
                <div style={{ padding: '0.4rem 0.5rem' }}>
                  <p style={{ margin: 0, fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--portal-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</p>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '0.62rem', color: 'var(--portal-muted)' }}>
                    {L(dict, WARMTH_LABEL[it.warmth][0], WARMTH_LABEL[it.warmth][1])} · {L(dict, FORMAL_LABEL[it.formality][0], FORMAL_LABEL[it.formality][1])}
                  </p>
                  <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.3rem' }}>
                    <button type="button" onClick={() => { markWorn(it.id, new Date().toISOString()); giveFeedback('worn', [it]); load(); }}
                      style={{ flex: 1, padding: '0.2rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-blue-deep)', fontSize: '0.62rem', cursor: 'pointer' }}
                      title={L(dict, '记一次今天穿了', 'Mark worn today')}>{L(dict, '穿了', 'Worn')}</button>
                    <button type="button" onClick={() => startEdit(it)} aria-label={L(dict, '编辑', 'Edit')}
                      style={{ padding: '0.2rem 0.4rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-muted)', fontSize: '0.62rem', cursor: 'pointer' }}>✎</button>
                    <button type="button" onClick={() => { if (confirm(L(dict, `从衣橱移除「${it.name}」?`, `Remove “${it.name}” from wardrobe?`))) { removeGarment(it.id); load(); } }}
                      aria-label={L(dict, '移除', 'Remove')}
                      style={{ padding: '0.2rem 0.4rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-muted)', fontSize: '0.62rem', cursor: 'pointer' }}>✕</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
