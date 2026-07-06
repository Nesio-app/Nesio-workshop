'use client';

/**
 * TimelineTab — 足迹(批次 28 起,批次 30 拆 3 子 tab)。洞察里的「足迹」tab。
 * 子 tab:时间线(Google 风当天行程)/ 分析(聚类 + 地点纠正)/ 环游(去过的地方)。
 * 数据全部本机。地点名可手动纠正(Unknown → 对的名字),记住后各处都用对的。
 */

import { useEffect, useMemo, useState } from 'react';
import {
  loadPlaceTrail, PLACE_TRAIL_UPDATED_EVENT,
  timelineDays, buildDayJourney, dayStats,
  clusterPlaces, categoryTimeShare, timeOfDayBuckets,
  displayLabel, setPlaceAlias, isGenericPlace, loadGeocodeEnabled, setGeocodeEnabled,
  placesByCategory, PLACE_CATEGORY_META, setPlaceCategory, worldByCountry,
  type PlaceVisit, type PlaceCategory, type TimeBucket, type JourneyItem, type PlaceCluster,
} from '@/lib/portal/place-trail';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

type Sub = 'timeline' | 'analytics' | 'travel' | 'world';

const CAT: Record<PlaceCategory, [string, string]> = {
  home: ['家', 'Home'], work: ['公司', 'Work'], shopping: ['购物', 'Shopping'],
  food: ['餐饮', 'Food'], fitness: ['运动', 'Sports'], culture: ['文化', 'Culture'],
  entertainment: ['娱乐', 'Entertainment'], health: ['医疗', 'Health'], lodging: ['住宿', 'Lodging'],
  transit: ['交通', 'Transit'], unknown: ['未知', 'Unknown'], place: ['地点', 'Place'],
};
const BUCKET: Record<TimeBucket, [string, string]> = {
  dawn: ['清晨', 'Dawn'], morning: ['上午', 'Morning'], afternoon: ['下午', 'Afternoon'],
  evening: ['傍晚', 'Evening'], night: ['夜间', 'Night'],
};
const DOT_COLOR: Record<PlaceCategory, string> = {
  home: '#588ce3', work: '#7b5ea7', shopping: '#e8888f', food: '#e0954a',
  fitness: '#d6559e', culture: '#8a6fd0', entertainment: '#d98a4a', health: '#c25d7a',
  lodging: '#5a8fc2', transit: '#3aa6a0', place: '#4a7c5f', unknown: '#9aa7b8',
};

export default function TimelineTab() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [trail, setTrail] = useState<PlaceVisit[]>([]);
  const [dayIdx, setDayIdx] = useState(0);
  const [sub, setSub] = useState<Sub>('timeline');
  const [editRaw, setEditRaw] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [geoOn, setGeoOn] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoMsg, setGeoMsg] = useState('');
  const [expandedCat, setExpandedCat] = useState<string | null>(null); // 批次 39:地点分类展开
  const [catPickFor, setCatPickFor] = useState<string | null>(null); // 批次 40:给地点手动选类别

  useEffect(() => { setGeoOn(loadGeocodeEnabled()); }, []);

  useEffect(() => {
    const read = () => setTrail(loadPlaceTrail());
    read();
    window.addEventListener(PLACE_TRAIL_UPDATED_EVENT, read);
    return () => window.removeEventListener(PLACE_TRAIL_UPDATED_EVENT, read);
  }, []);

  const days = useMemo(() => timelineDays(trail), [trail]);
  const dateKey = days[dayIdx];
  const journey = useMemo(() => (dateKey ? buildDayJourney(trail, dateKey) : []), [trail, dateKey]);
  const stats = useMemo(() => dayStats(journey), [journey]);
  const clusters = useMemo(() => clusterPlaces(trail, 10), [trail]);
  const catShare = useMemo(() => categoryTimeShare(trail), [trail]);
  const buckets = useMemo(() => timeOfDayBuckets(trail), [trail]);
  const placeCats = useMemo(() => placesByCategory(trail), [trail]); // 批次 39:Google 时间线风分类
  const world = useMemo(() => worldByCountry(trail), [trail]); // 批次 40:World tab 国家聚合
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null);

  if (trail.length === 0) {
    return <p className="nesio-insights-empty">{L(dict, '还没有足迹。授权位置后自动积累;也可在数据接入导入 Google 时间轴。', 'No trail yet. It builds automatically once location is granted; you can also import Google Timeline under Data sources.')}</p>;
  }

  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString(dict === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' });
  const fmtDur = (min: number) => {
    if (min < 1) return L(dict, '短暂', 'brief');
    const h = Math.floor(min / 60), m = min % 60;
    if (h && m) return L(dict, `${h}小时${m}分`, `${h}h ${m}m`);
    if (h) return L(dict, `${h}小时`, `${h}h`);
    return L(dict, `${m}分钟`, `${m}m`);
  };
  // 距离按 locale 切公制/英制 —— 中文语境用 km/m,不再一律 mi/ft(时间/日期都本地化了,唯独距离没有)。
  const fmtDist = (km: number) => {
    if (dict === 'en') { const mi = km * 0.621371; return mi < 0.19 ? `${Math.round(mi * 5280)} ft` : `${mi.toFixed(mi < 10 ? 1 : 0)} mi`; }
    return km < 1 ? `${Math.round(km * 1000)} 米` : `${km.toFixed(km < 10 ? 1 : 0)} km`;
  };
  const dayLabel = (key: string) => {
    const t = new Date(); const tk = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    const y = new Date(t); y.setDate(t.getDate() - 1); const yk = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    if (key === tk) return L(dict, '今天', 'Today');
    if (key === yk) return L(dict, '昨天', 'Yesterday');
    return new Date(key).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric', weekday: 'short' });
  };
  const modeLabel = (m: 'walk' | 'drive' | 'move') => m === 'walk' ? L(dict, '步行', 'Walking') : m === 'drive' ? L(dict, '驾车', 'Driving') : L(dict, '移动', 'Move');

  function saveRename() {
    if (editRaw !== null) setPlaceAlias(editRaw, editVal);
    setEditRaw(null); setEditVal('');
  }

  // 显示名:改过名→用改的;没改的无名占位→「未命名地点」;其余→原名
  function pretty(c: PlaceCluster): string {
    const d = displayLabel(c.label);
    if (d !== c.label) return d;
    if (c.generic) return L(dict, '未命名地点', 'Unnamed place');
    return d;
  }
  function toggleGeo() { const next = !geoOn; setGeoOn(next); setGeocodeEnabled(next); setGeoMsg(''); }
  async function findRealNames() {
    // 批次 40:处理所有「有坐标但还没解析过」的地点(不再只限 generic-word),
    // 同时存城市/国家(供 World tab)。已解析过(有 geo)的跳过,避免重复限速。
    const { loadPlaceGeo, setPlaceGeo } = await import('@/lib/portal/place-trail');
    const geoDone = loadPlaceGeo();
    const withCoords = clusterPlaces(trail, 99999).filter((c) => c.lat != null && c.lon != null);
    const targets = withCoords.filter((c) => !geoDone[c.label]?.country);
    if (!withCoords.length) { setGeoMsg(L(dict, '这些地点没有坐标,无法反查(需要带经纬度的足迹/Google 时间轴)', 'These places have no coordinates to resolve (need lat/lon from live trail / Google Timeline)')); return; }
    if (!targets.length) { setGeoMsg(L(dict, '都解析过了 ✓', 'All resolved ✓')); return; }
    setGeoBusy(true);
    let done = 0;
    let ok = 0;
    let failed = 0; // 请求彻底失败(网络/服务)的次数,用于区分"解析成功但没国家"和"根本没请求成功"
    for (const c of targets) {
      setGeoMsg(L(dict, `正在解析… ${done}/${targets.length}(约 ${Math.ceil((targets.length - done) * 1.1)} 秒)`, `Resolving… ${done}/${targets.length}`));
      try {
        const res = await fetch('/api/portal/geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: c.lat, lon: c.lon }) });
        const data = await res.json() as { ok?: boolean; name?: string; city?: string; country?: string };
        if (data.ok && (data.name || data.city || data.country)) {
          setPlaceGeo(c.label, { name: data.name, city: data.city, country: data.country });
          if (data.name && c.generic && displayLabel(c.label) === c.label) setPlaceAlias(c.label, data.name);
          if (data.country) ok += 1;
        } else if (data.ok === false) {
          failed += 1;
        }
      } catch { failed += 1; }
      done += 1;
      await new Promise((r) => setTimeout(r, 1100)); // Nominatim 限速 ~1/s
    }
    setGeoBusy(false);
    // 可见失败纪律:全失败时明确说是服务/网络异常,而不是含糊的"完成 · 0 个"。
    if (failed === targets.length) {
      setGeoMsg(L(dict, '解析服务暂时不可用(网络或限流),请稍后重试', 'Geocoding service unavailable (network or rate limit) — please retry later'));
    } else {
      setGeoMsg(L(dict, `完成 · 解析 ${targets.length} 个,拿到国家的 ${ok} 个${failed ? `,${failed} 个失败` : ''}`, `Done · ${targets.length} places, ${ok} with country${failed ? `, ${failed} failed` : ''}`));
    }
  }

  const pts = journey.filter((it): it is Extract<JourneyItem, { kind: 'visit' }> => it.kind === 'visit').map((it) => it.seg).filter((s) => s.lat != null && s.lon != null);
  const sketch = (() => {
    if (pts.length < 2) return null;
    const lats = pts.map((p) => p.lat!), lons = pts.map((p) => p.lon!);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const W = 300, H = 130, pad = 16;
    const sx = (lon: number) => maxLon === minLon ? W / 2 : pad + ((lon - minLon) / (maxLon - minLon)) * (W - 2 * pad);
    const sy = (lat: number) => maxLat === minLat ? H / 2 : pad + ((maxLat - lat) / (maxLat - minLat)) * (H - 2 * pad);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.lon!).toFixed(1)},${sy(p.lat!).toFixed(1)}`).join(' ');
    return { W, H, d, dots: pts.map((p) => ({ x: sx(p.lon!), y: sy(p.lat!), cat: p.category })) };
  })();

  const SUBS: Array<[Sub, string, string]> = [['timeline', '时间线', 'Timeline'], ['analytics', '分析', 'Analytics'], ['travel', '地点', 'Places'], ['world', '世界', 'World']];

  return (
    <div className="nesio-tl">
      <div className="nesio-fin-subtabs">
        {SUBS.map(([id, zh, en]) => (
          <button key={id} type="button" className={`nesio-fin-subtab${sub === id ? ' is-active' : ''}`} onClick={() => setSub(id)}>{L(dict, zh, en)}</button>
        ))}
      </div>

      {/* ── 时间线:当天行程 ── */}
      {sub === 'timeline' && (
        <>
          {sketch && (
            <div className="nesio-tl-map">
              <svg viewBox={`0 0 ${sketch.W} ${sketch.H}`} width="100%" height="130" preserveAspectRatio="xMidYMid slice" aria-hidden>
                <path d={sketch.d} fill="none" stroke="var(--portal-accent)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
                {sketch.dots.map((dt, i) => <circle key={i} cx={dt.x} cy={dt.y} r="5" fill={DOT_COLOR[dt.cat]} stroke="var(--sheet-opaque)" strokeWidth="2" />)}
              </svg>
              <span className="nesio-tl-map-note">{L(dict, '路线示意 · 非真实街道', 'Route sketch · not real streets')}</span>
            </div>
          )}
          <div className="nesio-tl-daynav">
            <button type="button" className="nesio-fin-monthnav" disabled={dayIdx >= days.length - 1} onClick={() => setDayIdx((i) => Math.min(days.length - 1, i + 1))} aria-label={L(dict, '前一天', 'Previous day')}>‹</button>
            <span className="nesio-tl-day">{dayLabel(dateKey)}</span>
            <button type="button" className="nesio-fin-monthnav" disabled={dayIdx <= 0} onClick={() => setDayIdx((i) => Math.max(0, i - 1))} aria-label={L(dict, '后一天', 'Next day')}>›</button>
          </div>
          <div className="nesio-tl-stats">
            <div className="nesio-tl-stat"><span className="nesio-tl-stat-v">{stats.visits}</span><span className="nesio-tl-stat-l">{L(dict, '个到访', 'visits')}</span></div>
            <div className="nesio-tl-stat"><span className="nesio-tl-stat-v">{fmtDur(stats.dwellMin)}</span><span className="nesio-tl-stat-l">{L(dict, '停留', 'dwell')}</span></div>
            {stats.moveKm > 0 && <div className="nesio-tl-stat"><span className="nesio-tl-stat-v">{fmtDist(stats.moveKm)}</span><span className="nesio-tl-stat-l">{L(dict, '移动', 'moved')}</span></div>}
          </div>
          <div className="nesio-tl-journey">
            {journey.map((it, i) => it.kind === 'visit' ? (
              <div key={i} className="nesio-tl-item nesio-tl-item--visit">
                <span className={`nesio-pt-dot nesio-pt-dot--${it.seg.category}`} aria-hidden />
                <div className="nesio-tl-item-body">
                  <div className="nesio-tl-item-top"><span className="nesio-tl-item-name">{displayLabel(it.seg.label)}</span><span className="nesio-tl-item-dur">{fmtDur(it.seg.durationMin)}</span></div>
                  <span className="nesio-tl-item-time">{hhmm(it.seg.start)}{it.seg.durationMin >= 1 ? ` – ${hhmm(it.seg.end)}` : ''}</span>
                </div>
              </div>
            ) : (
              <div key={i} className="nesio-tl-item nesio-tl-item--move">
                <span className="nesio-tl-move-icon" aria-hidden>{it.mode === 'walk' ? '🚶' : it.mode === 'drive' ? '🚗' : '·'}</span>
                <span className="nesio-tl-move-text">{modeLabel(it.mode)} · {L(dict, `约 ${fmtDist(it.km)}`, `~${fmtDist(it.km)}`)}{it.durationMin >= 1 ? ` · ${fmtDur(it.durationMin)}` : ''}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── 分析:聚类 + 地点纠正 ── */}
      {sub === 'analytics' && (
        <>
          <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>{L(dict, '常去地点 · 点名字可纠正', 'Frequent places · tap name to fix')}</p>
          {/* 批次 33:无名占位地点找真名(反向地理编码,默认关,坐标会发外部地图) */}
          <div className="nesio-tl-geo">
            <label className="nesio-tl-geo-row">
              <input type="checkbox" checked={geoOn} onChange={toggleGeo} />
              <span>{L(dict, '用外部地图给「未命名地点」找真名(坐标会发给 OpenStreetMap)', 'Resolve unnamed places via external map (coords sent to OpenStreetMap)')}</span>
            </label>
            {geoOn && <button type="button" className="nesio-fin-review-accept" disabled={geoBusy} onClick={findRealNames}>{geoBusy ? '…' : L(dict, '找真名', 'Resolve names')}</button>}
            {geoMsg && <span className="nesio-tl-geo-msg">{geoMsg}</span>}
          </div>
          <div className="nesio-tl-clusters">
            {clusters.map((c) => (
              <div key={c.label} className="nesio-tl-cluster">
                <span className={`nesio-pt-dot nesio-pt-dot--${c.category}`} aria-hidden style={{ position: 'static', boxShadow: 'none' }} />
                {editRaw === c.label ? (
                  <input className="nesio-tl-rename-input" value={editVal} autoFocus onChange={(e) => setEditVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') { setEditRaw(null); } }} onBlur={saveRename} placeholder={pretty(c)} />
                ) : (
                  <button type="button" className="nesio-tl-cluster-name nesio-tl-cluster-name--btn" onClick={() => { setEditRaw(c.label); setEditVal(displayLabel(c.label) === c.label ? '' : displayLabel(c.label)); }}>
                    {pretty(c)}
                    {c.generic && displayLabel(c.label) === c.label && c.lat != null && <span className="nesio-tl-alias-orig"> · {c.lat.toFixed(2)},{c.lon!.toFixed(2)}</span>}
                  </button>
                )}
                <span className="nesio-tl-cluster-meta">{fmtDur(c.totalMin)} · {L(dict, `${c.visits} 次`, `${c.visits}×`)}</span>
              </div>
            ))}
          </div>

          <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '类别时长占比', 'Time by category')}</p>
          <div className="nesio-tl-cats">
            {catShare.filter((c) => c.pct > 0).map((c) => (
              <div key={c.category} className="nesio-tl-cat">
                <div className="nesio-tl-cat-top"><span>{L(dict, CAT[c.category][0], CAT[c.category][1])}</span><span>{c.pct}%</span></div>
                <div className="nesio-fin-bar"><div className={`nesio-fin-bar-fill nesio-tl-catbar--${c.category}`} style={{ width: `${Math.max(3, c.pct)}%` }} /></div>
              </div>
            ))}
          </div>

          <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '时段分布', 'By time of day')}</p>
          <div className="nesio-tl-buckets">
            {buckets.map((b) => {
              const max = Math.max(...buckets.map((x) => x.min), 1);
              return (
                <div key={b.bucket} className="nesio-tl-bucket">
                  <div className="nesio-tl-bucket-bar-wrap"><div className="nesio-tl-bucket-bar" style={{ height: `${Math.round((b.min / max) * 100)}%` }} /></div>
                  <span className="nesio-tl-bucket-label">{L(dict, BUCKET[b.bucket][0], BUCKET[b.bucket][1])}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── 地点:Google Timeline 风分类(批次 39)── */}
      {sub === 'travel' && (
        placeCats.length === 0 ? (
          <p className="nesio-insights-empty">{L(dict, '还没有地点。多授权定位、或导入 Google 时间轴,这里会按类别攒出你去过的地方。', 'No places yet. Grant location or import Google Timeline and your visited places gather here by category.')}</p>
        ) : (
          <>
            <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>{L(dict, `去过 ${placeCats.reduce((s, g) => s + g.count, 0)} 个地方 · ${placeCats.length} 类`, `${placeCats.reduce((s, g) => s + g.count, 0)} places · ${placeCats.length} categories`)}</p>
            <div className="nesio-tl-catgrid">
              {placeCats.map((g) => {
                const meta = PLACE_CATEGORY_META[g.category];
                const open = expandedCat === g.category;
                return (
                  <div key={g.category} className={`nesio-tl-catcard${open ? ' is-open' : ''}`}>
                    <button type="button" className="nesio-tl-catcard-head" onClick={() => setExpandedCat(open ? null : g.category)}>
                      <span className="nesio-tl-catcard-sym" style={{ background: DOT_COLOR[g.category] }} aria-hidden>{meta.sym}</span>
                      <span className="nesio-tl-catcard-name">{L(dict, meta.zh, meta.en)}</span>
                      <span className="nesio-tl-catcard-count">{L(dict, `${g.count} 个地点`, `${g.count} places`)}</span>
                      <span className="nesio-tl-catcard-chev">{open ? '▾' : '›'}</span>
                    </button>
                    {open && (
                      <div className="nesio-tl-catcard-list">
                        {g.places.slice(0, 30).map((c) => (
                          <div key={c.label}>
                            <button type="button" className="nesio-tl-catplace" onClick={() => setCatPickFor(catPickFor === c.label ? null : c.label)}>
                              <span className="nesio-tl-catplace-name">{displayLabel(c.label)}</span>
                              <span className="nesio-tl-catplace-meta">{L(dict, `${c.visits} 次 · 改类别`, `${c.visits}× · set`)}</span>
                            </button>
                            {catPickFor === c.label && (
                              <div className="nesio-tl-catpick">
                                {(['shopping', 'food', 'fitness', 'culture', 'entertainment', 'health', 'lodging', 'transit', 'work', 'home', 'place'] as PlaceCategory[]).map((cat) => (
                                  <button key={cat} type="button" className="nesio-tl-catpick-chip" onClick={() => { setPlaceCategory(c.label, cat); setCatPickFor(null); }}>
                                    {PLACE_CATEGORY_META[cat].sym} {L(dict, PLACE_CATEGORY_META[cat].zh, PLACE_CATEGORY_META[cat].en)}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                        {g.places.length > 30 && <p className="nesio-tl-catplace-more">{L(dict, `还有 ${g.places.length - 30} 个…`, `+${g.places.length - 30} more…`)}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )
      )}

      {/* ── 世界:按国家聚合(批次 40)── */}
      {sub === 'world' && (
        world.length === 0 ? (
          <p className="nesio-insights-empty">{L(dict, '还没有国家信息。到「分析」打开 geocode 并点「找真名」,把坐标解析成城市/国家后,这里会按国家聚合(点国家看城市)。', 'No country data yet. In Analytics, enable geocode and Resolve names — once coords become city/country, countries gather here (tap for cities).')}</p>
        ) : (
          <>
            <p className="nesio-settings-option-hint" style={{ marginTop: 0 }}>{L(dict, `去过 ${world.length} 个国家/地区`, `${world.length} countries/regions visited`)}</p>
            <div className="nesio-tl-catgrid">
              {world.map((g) => {
                const open = expandedCountry === g.country;
                return (
                  <div key={g.country} className={`nesio-tl-catcard${open ? ' is-open' : ''}`}>
                    <button type="button" className="nesio-tl-catcard-head" onClick={() => setExpandedCountry(open ? null : g.country)}>
                      <span className="nesio-tl-catcard-sym" style={{ background: '#3d9f6e' }} aria-hidden>🌍</span>
                      <span className="nesio-tl-catcard-name">{g.country}</span>
                      <span className="nesio-tl-catcard-count">{L(dict, `${g.cities.length} 城 · ${g.placeCount} 地`, `${g.cities.length} cities · ${g.placeCount} places`)}</span>
                      <span className="nesio-tl-catcard-chev">{open ? '▾' : '›'}</span>
                    </button>
                    {open && (
                      <div className="nesio-tl-catcard-list">
                        {g.cities.length === 0 && <p className="nesio-tl-catplace-more">{L(dict, '(没解析到城市)', '(no city resolved)')}</p>}
                        {g.cities.map((c) => (
                          <div key={c.city} className="nesio-tl-catplace" style={{ cursor: 'default' }}>
                            <span className="nesio-tl-catplace-name">{c.city}</span>
                            <span className="nesio-tl-catplace-meta">{L(dict, `${c.count} 个地点`, `${c.count} places`)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )
      )}

      <p className="nesio-place-trail-count">{L(dict, `共 ${trail.length} 个打点`, `${trail.length} points total`)}</p>
    </div>
  );
}
