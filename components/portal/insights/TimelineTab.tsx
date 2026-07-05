'use client';

/**
 * TimelineTab — 时间线(批次 28)。洞察里独立一个 tab,放「分析」后面。
 *
 * 仿 Google 地图时间线:顶部路线示意 + 按天导航 + 当天统计(访问/停留/移动)+
 * 当天行程列表(访问段 + 段间推断的移动:步行/驾车 + 直线距离)+ 聚类分析。
 * 数据全部本机(实时定位积累 + Google 时间轴导入)。没有连续 GPS 轨迹,
 * 所以「地图」是路线示意(非真实街道),移动方式按点间速度粗判。
 */

import { useEffect, useMemo, useState } from 'react';
import {
  loadPlaceTrail, PLACE_TRAIL_UPDATED_EVENT,
  timelineDays, buildDayJourney, dayStats,
  clusterPlaces, categoryTimeShare, timeOfDayBuckets,
  type PlaceVisit, type PlaceCategory, type TimeBucket, type JourneyItem,
} from '@/lib/portal/place-trail';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

const CAT: Record<PlaceCategory, [string, string]> = {
  home: ['家', 'Home'], work: ['公司', 'Work'], shopping: ['购物', 'Shopping'],
  food: ['餐饮', 'Food'], fitness: ['健身', 'Fitness'], transit: ['通勤', 'Transit'],
  unknown: ['未知', 'Unknown'], place: ['地点', 'Place'],
};
const BUCKET: Record<TimeBucket, [string, string]> = {
  dawn: ['清晨', 'Dawn'], morning: ['上午', 'Morning'], afternoon: ['下午', 'Afternoon'],
  evening: ['傍晚', 'Evening'], night: ['夜间', 'Night'],
};
const DOT_COLOR: Record<PlaceCategory, string> = {
  home: '#588ce3', work: '#7b5ea7', shopping: '#e8888f', food: '#e0954a',
  fitness: '#d6559e', transit: '#3aa6a0', place: '#4a7c5f', unknown: '#9aa7b8',
};

export default function TimelineTab() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [trail, setTrail] = useState<PlaceVisit[]>([]);
  const [dayIdx, setDayIdx] = useState(0);

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
  const clusters = useMemo(() => clusterPlaces(trail, 8), [trail]);
  const catShare = useMemo(() => categoryTimeShare(trail), [trail]);
  const buckets = useMemo(() => timeOfDayBuckets(trail), [trail]);

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
  const fmtDist = (km: number) => {
    const mi = km * 0.621371;
    return mi < 0.19 ? `${Math.round(mi * 5280)} ft` : `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
  };
  const dayLabel = (key: string) => {
    const t = new Date(); const tk = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    const y = new Date(t); y.setDate(t.getDate() - 1); const yk = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    if (key === tk) return L(dict, '今天', 'Today');
    if (key === yk) return L(dict, '昨天', 'Yesterday');
    return new Date(key).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric', weekday: 'short' });
  };
  const modeLabel = (m: 'walk' | 'drive' | 'move') => m === 'walk' ? L(dict, '步行', 'Walking') : m === 'drive' ? L(dict, '驾车', 'Driving') : L(dict, '移动', 'Move');

  // 当天有坐标的点 → 路线示意(归一化到 viewBox,非真实街道)
  const pts = journey.filter((it): it is Extract<JourneyItem, { kind: 'visit' }> => it.kind === 'visit')
    .map((it) => it.seg).filter((s) => s.lat != null && s.lon != null);
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

  return (
    <div className="nesio-tl">
      {/* 路线示意 */}
      {sketch && (
        <div className="nesio-tl-map">
          <svg viewBox={`0 0 ${sketch.W} ${sketch.H}`} width="100%" height="130" preserveAspectRatio="xMidYMid slice" aria-hidden>
            <path d={sketch.d} fill="none" stroke="var(--portal-accent)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
            {sketch.dots.map((dt, i) => <circle key={i} cx={dt.x} cy={dt.y} r="5" fill={DOT_COLOR[dt.cat]} stroke="var(--sheet-opaque)" strokeWidth="2" />)}
          </svg>
          <span className="nesio-tl-map-note">{L(dict, '路线示意 · 非真实街道', 'Route sketch · not real streets')}</span>
        </div>
      )}

      {/* 按天导航 */}
      <div className="nesio-tl-daynav">
        <button type="button" className="nesio-fin-monthnav" disabled={dayIdx >= days.length - 1} onClick={() => setDayIdx((i) => Math.min(days.length - 1, i + 1))} aria-label={L(dict, '前一天', 'Previous day')}>‹</button>
        <span className="nesio-tl-day">{dayLabel(dateKey)}</span>
        <button type="button" className="nesio-fin-monthnav" disabled={dayIdx <= 0} onClick={() => setDayIdx((i) => Math.max(0, i - 1))} aria-label={L(dict, '后一天', 'Next day')}>›</button>
      </div>

      {/* 当天统计 */}
      <div className="nesio-tl-stats">
        <div className="nesio-tl-stat"><span className="nesio-tl-stat-v">{stats.visits}</span><span className="nesio-tl-stat-l">{L(dict, '个到访', 'visits')}</span></div>
        <div className="nesio-tl-stat"><span className="nesio-tl-stat-v">{fmtDur(stats.dwellMin)}</span><span className="nesio-tl-stat-l">{L(dict, '停留', 'dwell')}</span></div>
        {stats.moveKm > 0 && <div className="nesio-tl-stat"><span className="nesio-tl-stat-v">{fmtDist(stats.moveKm)}</span><span className="nesio-tl-stat-l">{L(dict, '移动', 'moved')}</span></div>}
      </div>

      {/* 当天行程 */}
      <div className="nesio-tl-journey">
        {journey.map((it, i) => it.kind === 'visit' ? (
          <div key={i} className="nesio-tl-item nesio-tl-item--visit">
            <span className={`nesio-pt-dot nesio-pt-dot--${it.seg.category}`} aria-hidden />
            <div className="nesio-tl-item-body">
              <div className="nesio-tl-item-top">
                <span className="nesio-tl-item-name">{it.seg.label}</span>
                <span className="nesio-tl-item-dur">{fmtDur(it.seg.durationMin)}</span>
              </div>
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

      {/* 聚类分析 */}
      <p className="nesio-insights-section-label" style={{ marginTop: '1.4rem' }}>{L(dict, '常去地点', 'Frequent places')}</p>
      <div className="nesio-tl-clusters">
        {clusters.map((c) => (
          <div key={c.label} className="nesio-tl-cluster">
            <span className={`nesio-pt-dot nesio-pt-dot--${c.category}`} aria-hidden style={{ position: 'static', boxShadow: 'none' }} />
            <span className="nesio-tl-cluster-name">{c.label}</span>
            <span className="nesio-tl-cluster-meta">{fmtDur(c.totalMin)} · {L(dict, `${c.visits} 次`, `${c.visits}×`)}</span>
          </div>
        ))}
      </div>

      <p className="nesio-insights-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '类别时长占比', 'Time by category')}</p>
      <div className="nesio-tl-cats">
        {catShare.filter((c) => c.pct > 0).map((c) => (
          <div key={c.category} className="nesio-tl-cat">
            <div className="nesio-tl-cat-top"><span>{L(dict, CAT[c.category][0], CAT[c.category][1])}</span><span>{c.pct}%</span></div>
            <div className="nesio-fin-bar"><div className={`nesio-fin-bar-fill nesio-tl-catbar--${c.category}`} style={{ width: `${Math.max(3, c.pct)}%` }} /></div>
          </div>
        ))}
      </div>

      <p className="nesio-insights-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '时段分布', 'By time of day')}</p>
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

      <p className="nesio-place-trail-count">{L(dict, `共 ${trail.length} 个打点`, `${trail.length} points total`)}</p>
    </div>
  );
}
