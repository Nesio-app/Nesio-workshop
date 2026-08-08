'use client';

/**
 * 离线景点选择器 — 从随包 POI 库挑景点加入行程。
 */

import { useEffect, useState } from 'react';
import {
  ensureTravelPoiLoaded, suggestPoisForDestination, poiTypeLabel, matchCityKey,
  type TravelPoi,
} from '@/lib/portal/travel-poi';
import { addPoisToTrip } from '@/lib/portal/travel-trips';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { IconMapPin, IconCheckCircle } from '../icons';

export default function TripPoiPicker({
  tripId, destination, onAdded, onClose,
}: {
  tripId: string;
  destination: string;
  onAdded: () => void;
  onClose: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const zh = dict !== 'en';
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'all' | 'attraction' | 'museum' | 'unesco'>('all');
  const [list, setList] = useState<TravelPoi[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void ensureTravelPoiLoaded().then((r) => {
      if (cancelled) return;
      if (r.error) {
        setErr(L(dict, '离线景点库没加载上,再试一次。', 'Offline POI pack failed to load — try again.'));
        setReady(false);
        return;
      }
      setReady(true);
      setErr(null);
    });
    return () => { cancelled = true; };
  }, [dict]);

  useEffect(() => {
    if (!ready) return;
    setList(suggestPoisForDestination(destination, { limit: 40, type, query }));
  }, [ready, destination, type, query]);

  function toggle(name: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function confirm() {
    const pois = list.filter((p) => picked.has(p.name));
    if (!pois.length) {
      setErr(L(dict, '先点选几个景点', 'Pick at least one place'));
      return;
    }
    const n = addPoisToTrip(tripId, pois);
    setMsg(L(dict, `已加入 ${n} 个景点`, `Added ${n} places`));
    setPicked(new Set());
    onAdded();
  }

  const city = matchCityKey(destination);

  return (
    <div className="nesio-travel-plan-form nesio-trip-poi-picker">
      <div className="nesio-trip-poi-head">
        <b>{L(dict, '离线景点库', 'Offline sights')}</b>
        <button type="button" className="nesio-trip-link" onClick={onClose}>{L(dict, '关闭', 'Close')}</button>
      </div>
      <p className="nesio-trip-footnote">
        {city
          ? L(dict, `「${destination || city}」附近 · 离线`, `Near “${destination || city}” · offline`)
          : L(dict, '离线景点库', 'Offline sights')}
      </p>
      <label>
        <span>{L(dict, '搜索', 'Search')}</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder=""
          aria-label={L(dict, '搜索', 'Search')}
        />
      </label>
      <div className="nesio-trip-poi-types">
        {([
          ['all', '全部', 'All'],
          ['attraction', '景点', 'Sights'],
          ['museum', '博物馆', 'Museums'],
          ['unesco', '世界遗产', 'UNESCO'],
        ] as const).map(([id, z, e]) => (
          <button
            key={id}
            type="button"
            className={`nesio-trip-action${type === id ? ' is-on' : ''}`}
            onClick={() => setType(id)}
          >
            {L(dict, z, e)}
          </button>
        ))}
      </div>

      {!ready && !err && <p className="nesio-trip-footnote">{L(dict, '正在读离线库…', 'Loading offline pack…')}</p>}
      {err && (
        <p className="nesio-trip-msg" role="alert" style={{ color: 'var(--status-risk)' }}>
          {err}
          <button type="button" className="nesio-trip-link" onClick={() => {
            setErr(null);
            void ensureTravelPoiLoaded().then((r) => {
              if (r.error) setErr(L(dict, '离线景点库没加载上,再试一次。', 'Offline POI pack failed to load — try again.'));
              else setReady(true);
            });
          }}>{L(dict, '重试', 'Retry')}</button>
        </p>
      )}

      <ul className="nesio-trip-poi-list">
        {list.map((p) => {
          const on = picked.has(p.name);
          return (
            <li key={`${p.name}-${p.lat}`}>
              <button type="button" className={`nesio-trip-poi-row${on ? ' is-on' : ''}`} onClick={() => toggle(p.name)}>
                <span className="nesio-trip-poi-ico"><IconMapPin size={16} /></span>
                <span className="nesio-trip-poi-main">
                  <b>{p.name}</b>
                  <small>{poiTypeLabel(p.type, zh)}{p.country ? ` · ${p.country}` : ''}</small>
                </span>
                {on && <IconCheckCircle size={16} />}
              </button>
            </li>
          );
        })}
      </ul>
      {ready && list.length === 0 && (
        <p className="nesio-trip-empty">{L(dict, '这附近没匹配到 —— 换个关键词试试。', 'No matches nearby — try another keyword.')}</p>
      )}

      <div className="nesio-travel-plan-form-actions">
        <button type="button" className="nesio-trip-action" onClick={onClose}>{L(dict, '取消', 'Cancel')}</button>
        <button type="button" className="nesio-trip-primary" onClick={confirm} disabled={!picked.size}>
          {L(dict, `加入行程(${picked.size})`, `Add to trip (${picked.size})`)}
        </button>
      </div>
      {msg && <p className="nesio-trip-msg" role="status">{msg}</p>}
    </div>
  );
}
