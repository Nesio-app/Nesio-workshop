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
import NesioSheet from './ui/NesioSheet';
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
  // 桥接:两处调用点是「条件挂载、关闭即卸载」。内部持 open 态,关闭时先播
  // 退出动画(Vaul),再延迟通知父卸载 —— 保留调用点契约不变(铁律:只换壳)。
  const [open, setOpen] = useState(true);
  function requestClose() {
    setOpen(false);
    window.setTimeout(onClose, 220); // 覆盖退出动画(标准 ~200ms / reduced-motion ~160ms)
  }

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

  /**
   * 诊断码 → 人话。
   *
   * bug3:原来这里把「Foursquare 额度用尽(429)—— 今天的免费额度到顶了」这类**服务商内部状态**
   * 直接铺在「附近的地方」下面 —— 用户看到的是一个第三方名字加一串错误码,既看不懂也帮不上忙
   * (标注:这堆字删掉)。现在只说和用户有关的那一件事:附近没有可选的地方,可以手动命名。
   * 具体诊断码仍在 d.diag 里,排障时看网络响应即可,不进界面。
   */
  function diagHint(code: string): string | null {
    if (!code) return null;
    if (code === 'ok_0' || code.startsWith('err_') || code === 'off') {
      return L(dict, '附近没有可选的地方 —— 手动命名就行,以后这里也认得它。', 'No nearby places to pick — name it yourself and it will be recognized next time.');
    }
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
    requestClose();
  }

  return (
    <NesioSheet
      variant="bottom"
      open={open}
      onOpenChange={(next) => { if (!next) requestClose(); }}
      ariaLabel={L(dict, '这是哪里?', 'Where was this?')}
    >
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
        {/* 分类收进下拉框(此前一整墙 chip 太占地方) */}
        <select
          className="nesio-fin-select nesio-placepick-select"
          value={kindPick}
          onChange={(e) => setKindPick(e.target.value as PlaceCategory | '')}
          aria-label={L(dict, '选择分类', 'Category')}
        >
          <option value="">{L(dict, '选择分类(可选)', 'Category (optional)')}</option>
          {(Object.entries(PLACE_CATEGORY_META) as Array<[PlaceCategory, { zh: string; en: string }]>).map(([k, meta]) => (
            <option key={k} value={k}>{L(dict, meta.zh, meta.en)}</option>
          ))}
        </select>
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
    </NesioSheet>
  );
}
