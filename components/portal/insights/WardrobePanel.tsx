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
  GARMENT_TYPES, type Garment, type GarmentType, type Warmth, type Formality,
} from '@/lib/portal/wardrobe';
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

  const load = () => { try { setItems(listWardrobe()); } catch { setItems([]); } };
  useEffect(() => {
    load();
    window.addEventListener('nesio-life-graph-updated', load);
    return () => window.removeEventListener('nesio-life-graph-updated', load);
  }, []);

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

  const outfit = useMemo(() => {
    const now = new Date();
    const w = readPortalCache<{ temperatureC?: number; tempMinC?: number; tempMaxC?: number; precipProb?: number }>(PORTAL_CACHE_KEYS.weather);
    const cal = readPortalCache<{ events?: CalendarEvent[] }>(PORTAL_CACHE_KEYS.calendar)?.events ?? [];
    const todayCal = cal.filter((e) => isToday(e.start, now));
    return suggestOutfit(items, {
      repTempC: w?.tempMinC ?? w?.temperatureC ?? null,
      tempMinC: w?.tempMinC ?? null,
      tempMaxC: w?.tempMaxC ?? null,
      precipProb: w?.precipProb ?? null,
      formalNeed: inferFormalNeed(todayCal),
    }, now.toISOString());
  }, [items]);

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
    let assetId: string | null = null;
    if (draft.dataUrl) {
      try {
        const { putLocalImage } = await import('@/lib/portal/local-image-store');
        assetId = newAssetId();
        await putLocalImage(assetId, draft.dataUrl);
      } catch { assetId = null; /* 存图失败也让衣服进衣橱,只是没缩略图 */ }
    }
    addGarment({
      name,
      garmentType: draft.garmentType,
      warmth: draft.warmth,
      formality: draft.formality,
      colors: draft.colors ? draft.colors.split(/[,，、]/).map((s) => s.trim()).filter(Boolean) : [],
      assetId,
      mimeType: draft.mimeType,
    });
    setDraft(EMPTY_DRAFT); setAdding(false); setAiError(null);
    load();
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
      {/* ① 今天穿这套 */}
      {items.length >= 2 && outfit.pieces.length > 0 ? (
        <div style={{ ...card, background: 'var(--portal-accent-soft-md)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' }}>👔 {L(dict, '今天穿这套', 'Today’s outfit')}</span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{L(dict, `${outfit.pieces.length} 件`, `${outfit.pieces.length} pieces`)}</span>
          </div>
          <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', lineHeight: 1.6 }}>{dict === 'en' ? outfit.reason[1] : outfit.reason[0]}</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
            {outfit.pieces.map((p) => (
              <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-sm)', background: 'var(--glass-bg-solid, var(--portal-bg))', border: '1px solid var(--portal-line)', fontSize: 'var(--text-xs)', color: 'var(--portal-ink)' }}>
                {thumbs[p.id] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbs[p.id]} alt="" width={20} height={20} style={{ borderRadius: 4, objectFit: 'cover' }} />
                )}
                {p.name}
              </span>
            ))}
          </div>
          {outfit.needUmbrella && (
            <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--status-calm)' }}>☔ {L(dict, '今天可能下雨,记得带伞', 'Rain likely — take an umbrella')}</p>
          )}
        </div>
      ) : (
        <p className="nesio-insights-empty" style={{ marginTop: 0 }}>
          {items.length === 0
            ? L(dict, '衣橱还空着。把衣服拍进来,我就能每天按天气和日程帮你搭一套。', 'Your wardrobe is empty. Add clothes and I’ll suggest a daily outfit by weather and schedule.')
            : L(dict, '再多加几件,就能自动搭出完整一套。', 'Add a few more pieces to get a full outfit.')}
        </p>
      )}

      {/* ② 加衣服 */}
      {!adding ? (
        <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: 'var(--space-4)' }} onClick={() => { setDraft(EMPTY_DRAFT); setAdding(true); setAiError(null); }}>
          {L(dict, '+ 加衣服', '+ Add clothing')}
        </button>
      ) : (
        <div style={{ ...card, marginTop: 'var(--space-4)', background: 'var(--glass-bg-solid, var(--portal-bg))' }}>
          {/* 拍照走相机;上传走相册(无 capture) —— 两个入口共用 onPickFile */}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onPickFile} />
          <input ref={uploadRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickFile} />
          {/* 两个大号取图入口:一眼可见,并排等宽 */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
            <button type="button" onClick={() => cameraRef.current?.click()}
              style={{ flex: 1, padding: '0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-accent-border)', background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', cursor: 'pointer' }}>{L(dict, '📷 拍照', '📷 Camera')}</button>
            <button type="button" onClick={() => uploadRef.current?.click()}
              style={{ flex: 1, padding: '0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-accent-border)', background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', cursor: 'pointer' }}>{L(dict, '🖼 上传照片', '🖼 Upload photo')}</button>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <button type="button" onClick={() => uploadRef.current?.click()}
              aria-label={L(dict, '选择衣服照片', 'Choose clothing photo')}
              style={{ flexShrink: 0, width: 76, height: 76, borderRadius: 'var(--radius-md)', border: '1px dashed var(--portal-accent-border)', background: 'var(--portal-accent-soft)', cursor: 'pointer', overflow: 'hidden', color: 'var(--portal-muted)', fontSize: '1.4rem', padding: 0 }}>
              {draft.dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={draft.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : '👕'}
            </button>
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
            <button type="button" className="nesio-ob-primary-btn" style={{ flex: 1 }} onClick={save}>{L(dict, '存进衣橱', 'Save')}</button>
            <button type="button" onClick={() => { setAdding(false); setAiError(null); }}
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
                    <button type="button" onClick={() => { markWorn(it.id, new Date().toISOString()); load(); }}
                      style={{ flex: 1, padding: '0.2rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-blue-deep)', fontSize: '0.62rem', cursor: 'pointer' }}
                      title={L(dict, '记一次今天穿了', 'Mark worn today')}>{L(dict, '穿了', 'Worn')}</button>
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
