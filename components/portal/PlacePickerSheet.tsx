'use client';

/**
 * PlacePickerSheet — 地点纠正选择器(批次 62/63,参考 Foursquare "Where?" 形态)。
 *
 * 手动命名 + 分类 chips + 「附近的地方」候选(服务端 geocode nearby:
 * Foursquare 最近 8 个 POI 带距离/分类,OSM reverse 兜底)。
 * 足迹页与记忆页共用同一套地址库:确认走 renamePlaceLabel 全链归一
 * (足迹本体/城市国家/分类/记忆节点位置戳一起改)。portal 到 body,
 * 不被带 transform 的 sheet 困住。
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { displayLabel, renamePlaceLabel, setPlaceCategory, setPlaceGeo, PLACE_CATEGORY_META, type PlaceCategory } from '@/lib/portal/place-trail';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

interface Candidate { name: string; distanceM?: number; kind?: string; city?: string; country?: string }

export default function PlacePickerSheet({ raw, lat, lon, onClose, onRenamed }: {
  raw: string;
  lat?: number;
  lon?: number;
  onClose: () => void;
  /** 改名落库后回调(新名字)—— 调用方刷新自己的展示 */
  onRenamed?: (name: string) => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [text, setText] = useState(displayLabel(raw) === raw ? '' : displayLabel(raw));
  const [kindPick, setKindPick] = useState<PlaceCategory | ''>('');
  const [cands, setCands] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  // 批次 101:Foursquare 调用状态可见 —— 「配了 key 看不出变化」时,一眼看出是
  // key 没生效(off)、被拒(err_401 旧版 key / err_429 超额)、还是正常但附近无 POI。
  const [diag, setDiag] = useState<string>('');

  useEffect(() => {
    if (typeof lat !== 'number' || typeof lon !== 'number') return;
    let cancelled = false;
    setLoading(true);
    fetch('/api/portal/geocode', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lon, nearby: true }),
    })
      .then((r) => r.json() as Promise<{ ok?: boolean; candidates?: Candidate[]; diag?: string }>)
      .then((d) => { if (!cancelled) { if (d.ok && d.candidates) setCands(d.candidates); setDiag(d.diag || ''); } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lat, lon]);

  // 诊断码 → 人话(只在非正常时提示,正常有 POI 时不打扰)
  function diagHint(code: string): string | null {
    if (!code || code.startsWith('ok_') && code !== 'ok_0') return null;
    if (code === 'off') return L(dict, 'Foursquare 未生效(在用免费地图源)—— 检查 Vercel 是否配了 FOURSQUARE_SERVICE_TOKEN 并重新部署。', 'Foursquare not active (using free source). Check the FOURSQUARE_SERVICE_TOKEN env on Vercel and redeploy.');
    if (code === 'err_401' || code === 'err_403') return L(dict, `Foursquare key 被拒(${code.slice(4)})—— 多半是旧版 v3 key,新 API 要「Service Key」。`, `Foursquare key rejected (${code.slice(4)}) — likely a legacy v3 key; the new API needs a Service Key.`);
    if (code === 'err_429') return L(dict, 'Foursquare 额度用尽(429)—— 今天的免费额度到顶了。', 'Foursquare quota exhausted (429) — free tier maxed for now.');
    if (code.startsWith('err_')) return L(dict, `Foursquare 请求出错(${code.slice(4)})—— 已回落免费源。`, `Foursquare request error (${code.slice(4)}) — fell back to free source.`);
    if (code === 'ok_0') return L(dict, 'Foursquare 正常,但这个坐标附近没有它收录的 POI(住宅区常见)。', 'Foursquare OK, but no POIs it indexes near this point (common in residential areas).');
    return null;
  }

  function commit(name: string, kind?: string, city?: string, country?: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    renamePlaceLabel(raw, trimmed);
    const k = (kind || kindPick) as PlaceCategory | '';
    if (k) setPlaceCategory(trimmed, k as PlaceCategory);
    setPlaceGeo(trimmed, { name: trimmed, resolved: true, ...(k ? { kind: k as PlaceCategory } : {}), ...(city ? { city } : {}), ...(country ? { country } : {}) });
    onRenamed?.(trimmed);
    onClose();
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="nesio-visitmem-overlay" role="dialog" aria-modal="true" aria-label={L(dict, '这是哪里?', 'Where was this?')}>
      <button type="button" className="nesio-visitmem-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-visitmem-sheet">
        <p className="nesio-memmap-list-title">{L(dict, '这是哪里?', 'Where was this?')} · {displayLabel(raw)}</p>
        <form className="nesio-placepick-row" onSubmit={(e) => { e.preventDefault(); commit(text); }}>
          <input
            className="nesio-tl-rename-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={L(dict, '手动命名,比如「家」「公司」', 'Name it — Home, Office…')}
          />
          <button type="submit" className="nesio-fin-review-accept" disabled={!text.trim()}>{L(dict, '保存', 'Save')}</button>
        </form>
        {/* 批次 63:手动命名也能挑分类(候选自带分类,手填的自己选) */}
        <div className="nesio-placepick-cats">
          {(Object.entries(PLACE_CATEGORY_META) as Array<[PlaceCategory, { zh: string; en: string }]>).map(([k, meta]) => (
            <button key={k} type="button"
              className={`nesio-placepick-cat${kindPick === k ? ' is-on' : ''}`}
              onClick={() => setKindPick((v) => (v === k ? '' : k))}>
              {L(dict, meta.zh, meta.en)}
            </button>
          ))}
        </div>
        <p className="nesio-memmap-list-title" style={{ marginTop: '0.7rem' }}>{L(dict, '附近的地方', 'Places nearby')}{loading ? ' …' : ''}</p>
        {!loading && diagHint(diag) && (
          <p className="nesio-settings-option-hint" style={{ color: diag.startsWith('err_') || diag === 'off' ? 'var(--status-gentle)' : 'var(--portal-muted)', margin: '0 0 0.3rem' }}>
            {diagHint(diag)}
          </p>
        )}
        <div className="nesio-memmap-list-scroll">
          {!loading && cands.length === 0 && (
            <p className="nesio-settings-option-hint">{L(dict, '附近没有候选(住宅区常见)—— 直接手动命名即可。', 'No nearby candidates (common in residential areas) — just name it above.')}</p>
          )}
          {cands.map((c, i) => (
            <button key={i} type="button" className="nesio-memmap-item nesio-memmap-item--btn" onClick={() => commit(c.name, c.kind, c.city, c.country)}>
              <span className="nesio-memmap-item-name">{c.name}</span>
              <span className="nesio-memmap-item-time">
                {typeof c.distanceM === 'number' ? `${c.distanceM}m` : ''}
                {c.kind && PLACE_CATEGORY_META[c.kind as PlaceCategory] ? ` · ${L(dict, PLACE_CATEGORY_META[c.kind as PlaceCategory].zh, PLACE_CATEGORY_META[c.kind as PlaceCategory].en)}` : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
