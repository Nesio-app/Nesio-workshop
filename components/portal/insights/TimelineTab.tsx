'use client';

/**
 * TimelineTab — 足迹(批次 28 起,批次 30 拆 3 子 tab)。洞察里的「足迹」tab。
 * 子 tab:时间线(Google 风当天行程)/ 分析(聚类 + 地点纠正)/ 环游(去过的地方)。
 * 数据全部本机。地点名可手动纠正(Unknown → 对的名字),记住后各处都用对的。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  loadPlaceTrail, PLACE_TRAIL_UPDATED_EVENT,
  timelineDays, buildDayJourney, dayStats,
  clusterPlaces, categoryTimeShare,
  displayLabel, setPlaceAlias, isGenericPlace,
  placesByCategory, PLACE_CATEGORY_META, setPlaceCategory, worldByCountry, loadPlaceGeo,
  type PlaceVisit, type PlaceCategory, type JourneyItem, type PlaceCluster,
} from '@/lib/portal/place-trail';
import { wallHHMM, dateKeyToLocalDate } from '@/lib/portal/place-time.mjs';
import { monthlyPlaceComparison, weekRhythm, footprintHighlights } from '@/lib/portal/place-stats';
import PlaceMap from './PlaceMap';
import { IconHome, IconUtensils, IconCard, IconActivity, IconBriefcase, IconPlane, IconBed, IconHeartPulse, IconBook, IconSun, IconStar, IconMapPin } from '../icons';
import dynamic from 'next/dynamic';
import { getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';
import { getLocalImage } from '@/lib/portal/local-image-store';
import { createPortal } from 'react-dom';
const MemoryMapSheet = dynamic(() => import('./MemoryMapSheet'), { ssr: false });
const MemoryNodeDetail = dynamic(() => import('../MemoryNodeDetail'), { ssr: false });
const PlacePickerSheet = dynamic(() => import('../PlacePickerSheet'), { ssr: false });
const Globe = dynamic(() => import('./Globe'), { ssr: false });
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

type Sub = 'timeline' | 'analytics' | 'travel' | 'world';

/** 批次 77(用户点名图标问题):类别 emoji 彩圈 → 设计系统线性图标 */
function catIconSvg(cat: PlaceCategory): ReactNode {
  const size = 15;
  switch (cat) {
    case 'home': return <IconHome size={size} />;
    case 'food': return <IconUtensils size={size} />;
    case 'shopping': return <IconCard size={size} />;
    case 'fitness': return <IconActivity size={size} />;
    case 'work': return <IconBriefcase size={size} />;
    case 'transit': return <IconPlane size={size} />;
    case 'lodging': return <IconBed size={size} />;
    case 'health': return <IconHeartPulse size={size} />;
    case 'culture': case 'education': return <IconBook size={size} />;
    case 'park': return <IconSun size={size} />;
    case 'entertainment': return <IconStar size={size} />;
    default: return <IconMapPin size={size} />;
  }
}

const CAT: Record<PlaceCategory, [string, string]> = {
  home: ['家', 'Home'], work: ['公司', 'Work'], grocery: ['超市', 'Grocery'], shopping: ['购物', 'Shopping'],
  food: ['餐饮', 'Food'], cafe: ['咖啡', 'Café'], fitness: ['运动', 'Sports'], park: ['公园', 'Park'],
  culture: ['文化', 'Culture'], education: ['学校', 'School'],
  entertainment: ['娱乐', 'Entertainment'], health: ['医疗', 'Health'], lodging: ['住宿', 'Lodging'],
  transit: ['交通', 'Transit'], unknown: ['未知', 'Unknown'], place: ['其他地点', 'Other places'],
};
// 地点饼图配色:走设计 token(莫兰迪辅助色),top5 + 其他循环取用,不硬编码色值。
const CAT_PIE_COLORS = [
  'var(--status-gentle)', 'var(--status-go)', 'var(--status-calm)',
  'var(--portal-cool-accent)', 'var(--portal-accent)', 'var(--portal-muted)',
];

const DOT_COLOR: Record<PlaceCategory, string> = {
  home: '#588ce3', work: '#7b5ea7', grocery: '#4f9e57', shopping: '#e8888f', food: '#e0954a',
  cafe: '#a5713f', fitness: '#d6559e', park: '#3e9e7e', culture: '#8a6fd0', education: '#5a7bd0',
  entertainment: '#d98a4a', health: '#c25d7a',
  lodging: '#5a8fc2', transit: '#3aa6a0', place: '#4a7c5f', unknown: '#9aa7b8',
};

export default function TimelineTab() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [trail, setTrail] = useState<PlaceVisit[]>([]);
  const [dayIdx, setDayIdx] = useState(0);
  const [sub, setSub] = useState<Sub>('timeline');
  const [placePeriod, setPlacePeriod] = useState<'week' | 'month' | 'year'>('month'); // 地点饼图时段
  const [worldCountry, setWorldCountry] = useState<string | null>(null); // 世界:点进某国看城市明信片
  const [editRaw, setEditRaw] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [expandedCat, setExpandedCat] = useState<string | null>(null); // 批次 39:地点分类展开
  const [catPickFor, setCatPickFor] = useState<string | null>(null); // 批次 40:给地点手动选类别
  const [memMapOpen, setMemMapOpen] = useState(false); // 批次 59:地图上的记忆
  const [visitMems, setVisitMems] = useState<{ title: string; nodes: LifeNode[] } | null>(null); // 批次 61:点「记了 N 条」看具体记忆
  const [visitSel, setVisitSel] = useState<LifeNode | null>(null);
  const [zoomImg, setZoomImg] = useState<{ url: string; name: string } | null>(null); // 批次 63:缩略图放大
  const [globeFull, setGlobeFull] = useState(false); // 批次 63:3D 地球全屏
  // 批次 62:地点纠正选择器(附近候选 + 手动命名,参考 Foursquare Where? 形态)
  const [placePick, setPlacePick] = useState<{ raw: string; lat?: number; lon?: number } | null>(null);

  useEffect(() => {
    const read = () => setTrail(loadPlaceTrail());
    read();
    window.addEventListener(PLACE_TRAIL_UPDATED_EVENT, read);
    return () => window.removeEventListener(PLACE_TRAIL_UPDATED_EVENT, read);
  }, []);

  const days = useMemo(() => timelineDays(trail), [trail]);
  const dateKey = days[dayIdx];
  const journey = useMemo(() => (dateKey ? buildDayJourney(trail, dateKey) : []), [trail, dateKey]);
  // 批次 59:该到访地点/时段记了多少条记忆(capturedLat/Lon <250m 且时间落在停留窗 ±30min)
  const geoMems = useMemo(() => getLifeGraph()
    .map((n) => ({ n, lat: n.attributes?.capturedLat, lon: n.attributes?.capturedLon, t: new Date(n.createdAt).getTime() }))
    .filter((g): g is { n: typeof g.n; lat: number; lon: number; t: number } => typeof g.lat === 'number' && typeof g.lon === 'number'), [trail]);
  const memNodesAtVisit = (seg: { lat?: number; lon?: number; start: string; end: string }): LifeNode[] => {
    if (typeof seg.lat !== 'number' || typeof seg.lon !== 'number') return [];
    const t0 = new Date(seg.start).getTime() - 30 * 60_000;
    const t1 = new Date(seg.end).getTime() + 30 * 60_000;
    return geoMems.filter((g) => {
      if (g.t < t0 || g.t > t1) return false;
      const dLat = (g.lat - (seg.lat as number)) * 111_320;
      const dLon = (g.lon - (seg.lon as number)) * 111_320 * Math.cos(((seg.lat as number) * Math.PI) / 180);
      return Math.hypot(dLat, dLon) < 250;
    }).map((g) => g.n);
  };
  const stats = useMemo(() => dayStats(journey), [journey]);
  const clusters = useMemo(() => clusterPlaces(trail, 10), [trail]);
  const catShare = useMemo(() => categoryTimeShare(trail), [trail]);
  const monthly = useMemo(() => monthlyPlaceComparison(trail), [trail]);
  const rhythm = useMemo(() => weekRhythm(trail), [trail]);
  const highlights = useMemo(() => footprintHighlights(trail), [trail]);
  const mapPoints = useMemo(() => clusterPlaces(trail, 14)
    .filter((c) => c.lat != null && c.lon != null)
    .map((c) => ({ lat: c.lat!, lon: c.lon!, label: displayLabel(c.label), weightMin: c.totalMin, color: DOT_COLOR[c.category] })), [trail]);
  const placeCats = useMemo(() => placesByCategory(trail), [trail]); // 批次 39:Google 时间线风分类
  const world = useMemo(() => worldByCountry(trail), [trail]); // 批次 40:World tab 国家聚合

  // ── 地点 tab(设计稿③):饼图 + 周/月/年 + 最常去,全随时段变 ──
  const placePeriodTrail = useMemo(() => {
    const now = Date.now();
    const d0 = new Date(now);
    return trail.filter((v) => {
      const t = new Date(v.ts);
      if (Number.isNaN(t.getTime())) return false;
      if (placePeriod === 'week') return now - t.getTime() <= 7 * 86_400_000;
      if (placePeriod === 'month') return t.getFullYear() === d0.getFullYear() && t.getMonth() === d0.getMonth();
      return t.getFullYear() === d0.getFullYear();
    });
  }, [trail, placePeriod]);
  const placeShare = useMemo(() => {
    const raw = categoryTimeShare(placePeriodTrail).filter((c) => c.pct > 0);
    const top = raw.slice(0, 5).map((c, i) => ({ label: L(dict, CAT[c.category][0], CAT[c.category][1]), pct: c.pct, color: CAT_PIE_COLORS[i] }));
    const restPct = raw.slice(5).reduce((s, c) => s + c.pct, 0);
    if (restPct > 0) top.push({ label: L(dict, '其他', 'Other'), pct: restPct, color: CAT_PIE_COLORS[5] });
    return top;
  }, [placePeriodTrail, dict]);
  const placeRanking = useMemo(() => clusterPlaces(placePeriodTrail, 6).slice().sort((a, b) => b.visits - a.visits).slice(0, 5), [placePeriodTrail]);
  const placeDistinct = useMemo(() => clusterPlaces(placePeriodTrail, 99999).length, [placePeriodTrail]);
  // 批次 67:世界 tab 亮点卡(参考「一生足迹」:最北/最南/最常去/最早,带度分坐标)
  const worldHighlights = useMemo(() => {
    const geo = loadPlaceGeo();
    const out: Array<{ kicker: string; main: string; sub?: string; coord?: string }> = [];
    const fmtCoord = (lat: number, lon: number) => {
      const seg = (v: number, pos: string, neg: string) => {
        const a = Math.abs(v); const deg = Math.floor(a); const min = Math.round((a - deg) * 60);
        return `${v >= 0 ? pos : neg}${deg}°${String(min).padStart(2, '0')}′`;
      };
      return `${seg(lat, 'N', 'S')} ${seg(lon, 'E', 'W')}`;
    };
    const placeOf = (label: string) => {
      const g = geo[label];
      const disp = displayLabel(label);
      const base = disp.split(',')[0].trim() || disp; // 「名, 城, 国」变体只留名,后缀让位副行
      const suffix = disp.slice(base.length).replace(/^\s*,\s*/, '').trim();
      return { name: base, sub: [g?.city, g?.country].filter(Boolean).join(' · ') || suffix };
    };
    const pts = trail.filter((v): v is PlaceVisit & { lat: number; lon: number } => typeof v.lat === 'number' && typeof v.lon === 'number');
    if (pts.length) {
      const north = pts.reduce((a, b) => (b.lat > a.lat ? b : a));
      const south = pts.reduce((a, b) => (b.lat < a.lat ? b : a));
      const pn = placeOf(north.label);
      out.push({ kicker: L(dict, '去过最北的地方', 'Northernmost footprint'), main: pn.name, sub: pn.sub, coord: fmtCoord(north.lat, north.lon) });
      if (south.label !== north.label) {
        const ps = placeOf(south.label);
        out.push({ kicker: L(dict, '去过最南的地方', 'Southernmost footprint'), main: ps.name, sub: ps.sub, coord: fmtCoord(south.lat, south.lon) });
      }
    }
    const clusters = clusterPlaces(trail, 99999).filter((c) => c.category !== 'home' && !c.generic);
    if (clusters.length) {
      const top = clusters.reduce((a, b) => (b.visits > a.visits ? b : a));
      if (top.visits >= 2) {
        const pt = placeOf(top.label);
        out.push({ kicker: L(dict, '去过最多次的地方', 'Most visited'), main: pt.name, sub: [pt.sub, L(dict, `${top.visits} 次`, `${top.visits} visits`)].filter(Boolean).join(' · ') });
      }
    }
    if (trail.length) {
      const earliest = trail.reduce((a, b) => (new Date(b.ts) < new Date(a.ts) ? b : a));
      const pe = placeOf(earliest.label);
      const d0 = new Date(earliest.ts);
      out.push({ kicker: L(dict, '最早的足迹', 'First footprint'), main: pe.name, sub: [pe.sub, L(dict, `${d0.getFullYear()}年${d0.getMonth() + 1}月${d0.getDate()}日`, d0.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }))].filter(Boolean).join(' · ') });
    }
    return out;
  }, [trail, dict]);
  // 世界 tab(设计稿④):每国一枚真数据 tag(最常去 / 最早 / 最北 / 最南)。
  const worldCountryTags = useMemo(() => {
    const geo = loadPlaceGeo();
    type Agg = { visits: number; earliest: number; maxLat: number; minLat: number };
    const byC = new Map<string, Agg>();
    for (const v of trail) {
      const g = geo[v.label];
      if (!g?.country) continue;
      const t = new Date(v.ts).getTime();
      const a = byC.get(g.country) || { visits: 0, earliest: Infinity, maxLat: -Infinity, minLat: Infinity };
      a.visits += 1;
      if (Number.isFinite(t)) a.earliest = Math.min(a.earliest, t);
      if (typeof v.lat === 'number') { a.maxLat = Math.max(a.maxLat, v.lat); a.minLat = Math.min(a.minLat, v.lat); }
      byC.set(g.country, a);
    }
    const entries = [...byC.entries()];
    if (!entries.length) return new Map<string, { text: string }>();
    const pick = (fn: (a: Agg) => number, dir: 1 | -1) =>
      entries.reduce((best, e) => (dir === 1 ? fn(e[1]) > fn(best[1]) : fn(e[1]) < fn(best[1])) ? e : best)[0];
    const mostVisited = pick((a) => a.visits, 1);
    const earliest = pick((a) => a.earliest, -1);
    const north = pick((a) => a.maxLat, 1);
    const south = pick((a) => a.minLat, -1);
    const tags = new Map<string, { text: string }>();
    // 优先级:最常去 > 最早 > 最北 > 最南(每国至多一枚)
    tags.set(mostVisited, { text: L(dict, '最常去', 'Most visited') });
    if (!tags.has(earliest)) tags.set(earliest, { text: L(dict, `最早 · ${new Date(byC.get(earliest)!.earliest).getFullYear()}`, `First · ${new Date(byC.get(earliest)!.earliest).getFullYear()}`) });
    if (!tags.has(north) && Number.isFinite(byC.get(north)!.maxLat)) tags.set(north, { text: L(dict, `最北 · ${Math.round(byC.get(north)!.maxLat)}°N`, `North · ${Math.round(byC.get(north)!.maxLat)}°N`) });
    if (!tags.has(south) && Number.isFinite(byC.get(south)!.minLat)) tags.set(south, { text: L(dict, `最南 · ${Math.round(Math.abs(byC.get(south)!.minLat))}°${byC.get(south)!.minLat >= 0 ? 'N' : 'S'}`, `South · ${Math.round(Math.abs(byC.get(south)!.minLat))}°${byC.get(south)!.minLat >= 0 ? 'N' : 'S'}`) });
    return tags;
  }, [trail, dict]);
  // 稳定挑一条渐变(0–4)给国家/城市卡,按名字散列 —— 色值全走 CSS token 类。
  const gradIdx = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 5; };

  if (trail.length === 0) {
    return <p className="nesio-insights-empty">{L(dict, '还没有足迹。授权位置后自动积累;也可在数据接入导入 Google 时间轴。', 'No trail yet. It builds automatically once location is granted; you can also import Google Timeline under Data sources.')}</p>;
  }

  // 按事发地钟点显示(带原时区偏移的导入段不再被设备时区改写成半夜)
  const hhmm = (iso: string) => wallHHMM(iso);
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
    return dateKeyToLocalDate(key).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric', weekday: 'short' });
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
  // 当日路线上真地图:到访点 + 顺序折线(替代旧的"非真实街道"示意 SVG)
  const dayPts = journey.filter((it): it is Extract<JourneyItem, { kind: 'visit' }> => it.kind === 'visit').map((it) => it.seg).filter((s) => s.lat != null && s.lon != null);
  const dayMapPoints = dayPts.map((s) => ({ lat: s.lat!, lon: s.lon!, label: displayLabel(s.label), weightMin: Math.max(10, s.durationMin), color: DOT_COLOR[s.category] }));
  const dayPath = dayPts.map((s) => ({ lat: s.lat!, lon: s.lon! }));

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
          {dayMapPoints.length > 0 && <PlaceMap points={dayMapPoints} path={dayPath} height={170} />}
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
                  <div className="nesio-tl-item-top">
                    <button type="button" className="nesio-tl-item-name nesio-tl-item-name--btn" onClick={() => setPlacePick({ raw: it.seg.label, lat: it.seg.lat, lon: it.seg.lon })}>{displayLabel(it.seg.label)}</button>
                    <span className="nesio-tl-item-dur">{fmtDur(it.seg.durationMin)}</span>
                  </div>
                  <span className="nesio-tl-item-time">
                    {hhmm(it.seg.start)}{it.seg.durationMin >= 1 ? ` – ${hhmm(it.seg.end)}` : ''}
                    {(() => {
                      const nodes = memNodesAtVisit(it.seg);
                      if (!nodes.length) return null;
                      return (
                        <button type="button" className="nesio-tl-item-mem nesio-tl-item-mem--btn"
                          onClick={() => setVisitMems({ title: displayLabel(it.seg.label), nodes })}>
                          {' · '}{L(dict, `记了 ${nodes.length} 条`, `${nodes.length} memories`)}
                        </button>
                      );
                    })()}
                  </span>
                  <VisitThumbs nodes={memNodesAtVisit(it.seg)} onZoom={(url, name) => setZoomImg({ url, name })} />
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
          {/* ── 月度概览(Google Timeline Insights 形态):数字 + 环比 ── */}
          {monthly && (
            <div className="nesio-tl-month">
              <p className="nesio-settings-section-label" style={{ marginTop: 0 }}>
                {L(dict, `${Number(monthly.current.monthKey.slice(5, 7))} 月足迹`, `${monthly.current.monthKey} footprint`)}
                {monthly.prevHasData && <span className="nesio-tl-month-vs">{L(dict, ' · 对比上月', ' · vs last month')}</span>}
              </p>
              <div className="nesio-tl-month-grid">
                {([
                  [monthly.current.places, monthly.prev.places, L(dict, '个地点', 'places')],
                  [monthly.current.visits, monthly.prev.visits, L(dict, '次到访', 'visits')],
                  [Math.round(monthly.current.moveKm), Math.round(monthly.prev.moveKm), L(dict, 'km 移动', 'km moved')],
                  [monthly.current.newPlaces, monthly.prev.newPlaces, L(dict, '个新地点', 'new places')],
                ] as Array<[number, number, string]>).map(([cur, prv, label], i) => (
                  <div key={i} className="nesio-tl-stat">
                    <span className="nesio-tl-stat-v">
                      {cur}
                      {monthly.prevHasData && cur !== prv && (
                        <span className={`nesio-tl-delta ${cur > prv ? 'is-up' : 'is-down'}`}>{cur > prv ? '▲' : '▼'}{Math.abs(cur - prv)}</span>
                      )}
                    </span>
                    <span className="nesio-tl-stat-l">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {highlights && (
            <p className="nesio-settings-option-hint" style={{ marginTop: '0.4rem' }}>
              {L(dict,
                `累计:${highlights.totalPlaces} 个地点 · ${highlights.activeDays} 天 · ${highlights.totalKm} km · 最长连续外出 ${highlights.maxStreak} 天${highlights.countries ? ` · ${highlights.countries} 国 ${highlights.cities} 城` : ''}`,
                `All-time: ${highlights.totalPlaces} places · ${highlights.activeDays} days · ${highlights.totalKm} km · ${highlights.maxStreak}-day streak${highlights.countries ? ` · ${highlights.countries} countries` : ''}`)}
            </p>
          )}

          {/* ── 真实地图概览(批次 59:点一下进入可缩放的「地图上的记忆」)── */}
          {mapPoints.length > 0 && (
            <button type="button" className="nesio-tl-map-open" onClick={() => setMemMapOpen(true)} aria-label={L(dict, '打开地图上的记忆', 'Open memories in maps')}>
              <PlaceMap points={mapPoints} height={200} />
              <span className="nesio-tl-map-open-hint">{L(dict, '点开看地图上的记忆 · 可缩放', 'Tap for memories in maps · zoomable')}</span>
            </button>
          )}

          {/* ── 生活节奏:星期 × 时段外出热力 ── */}
          {rhythm.max > 1 && (
            <>
              <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '生活节奏 · 外出时间', 'Weekly rhythm · time out')}</p>
              <div className="nesio-tl-rhythm">
                <div className="nesio-tl-rhythm-col nesio-tl-rhythm-col--labels">
                  <span />
                  {(['清晨', '上午', '下午', '傍晚', '夜'] as const).map((zh, i) => (
                    <span key={i} className="nesio-tl-rhythm-rowlabel">{L(dict, zh, ['Dawn', 'AM', 'PM', 'Eve', 'Night'][i])}</span>
                  ))}
                </div>
                {rhythm.grid.map((col, wd) => (
                  <div key={wd} className="nesio-tl-rhythm-col">
                    <span className="nesio-tl-rhythm-collabel">{L(dict, ['一', '二', '三', '四', '五', '六', '日'][wd], ['M', 'T', 'W', 'T', 'F', 'S', 'S'][wd])}</span>
                    {col.map((min, b) => (
                      <span key={b} className="nesio-tl-rhythm-cell" style={{ opacity: min ? 0.25 + (min / rhythm.max) * 0.75 : 1, background: min ? 'var(--portal-accent)' : 'var(--portal-hairline)' }}
                        title={`${Math.round(min / 60)}h`} />
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}

          {highlights && (highlights.longestStay || highlights.busiestDay || highlights.farthestDay) && (
            <>
              <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '纪录', 'Records')}</p>
              <div className="nesio-tl-records">
                {highlights.longestStay && (
                  <div className="nesio-tl-record"><span className="nesio-tl-record-name">{L(dict, '最长停留', 'Longest stay')}</span><span className="nesio-tl-record-val">{displayLabel(highlights.longestStay.label)} · {fmtDur(highlights.longestStay.min)}</span><span className="nesio-tl-record-date">{dayLabel(highlights.longestStay.dateKey)}</span></div>
                )}
                {highlights.busiestDay && (
                  <div className="nesio-tl-record"><span className="nesio-tl-record-name">{L(dict, '最忙一天', 'Busiest day')}</span><span className="nesio-tl-record-val">{L(dict, `${highlights.busiestDay.visits} 个到访`, `${highlights.busiestDay.visits} visits`)}</span><span className="nesio-tl-record-date">{dayLabel(highlights.busiestDay.dateKey)}</span></div>
                )}
                {highlights.farthestDay && (
                  <div className="nesio-tl-record"><span className="nesio-tl-record-name">{L(dict, '最远一天', 'Farthest day')}</span><span className="nesio-tl-record-val">{fmtDist(highlights.farthestDay.km)}</span><span className="nesio-tl-record-date">{dayLabel(highlights.farthestDay.dateKey)}</span></div>
                )}
              </div>
            </>
          )}

          {highlights && highlights.monthly.length > 1 && (
            <>
              <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '每月去过的地点', 'Places per month')}</p>
              <div className="nesio-tl-months">
                {highlights.monthly.map((m) => {
                  const max = Math.max(...highlights.monthly.map((x) => x.places), 1);
                  return (
                    <div key={m.monthKey} className="nesio-tl-bucket">
                      <div className="nesio-tl-bucket-bar-wrap"><div className="nesio-tl-bucket-bar" style={{ height: `${Math.round((m.places / max) * 100)}%` }} title={`${m.places}`} /></div>
                      <span className="nesio-tl-bucket-label">{Number(m.monthKey.slice(5, 7))}{L(dict, '月', '')}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <p className="nesio-settings-section-label" style={{ marginTop: '1.25rem' }}>{L(dict, '常去地点 · 点名字可纠正', 'Frequent places · tap name to fix')}</p>
          {/* 批次 61:「找真名」手动卡撤除 —— 反查已两级自动化(天气链→服务端 geocode),
              坐标名条目会在下一次定位时自动改名认亲,不再需要手动按钮 */}
          <div className="nesio-tl-clusters">
            {clusters.map((c) => (
              <div key={c.label} className="nesio-tl-cluster">
                <span className={`nesio-pt-dot nesio-pt-dot--${c.category}`} aria-hidden style={{ position: 'static', boxShadow: 'none' }} />
                {editRaw === c.label ? (
                  <input className="nesio-tl-rename-input" value={editVal} autoFocus onChange={(e) => setEditVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') { setEditRaw(null); } }} onBlur={saveRename} placeholder={pretty(c)} />
                ) : (
                  <button type="button" className="nesio-tl-cluster-name nesio-tl-cluster-name--btn" onClick={() => setPlacePick({ raw: c.label, lat: c.lat ?? undefined, lon: c.lon ?? undefined })}>
                    {pretty(c)}
                    {c.generic && displayLabel(c.label) === c.label && c.lat != null && <span className="nesio-tl-alias-orig"> · {c.lat.toFixed(2)},{c.lon!.toFixed(2)}</span>}
                  </button>
                )}
                <span className="nesio-tl-cluster-meta">{fmtDur(c.totalMin)} · {L(dict, `${c.visits} 次`, `${c.visits}×`)}{c.visits > 1 ? L(dict, ` · 均 ${fmtDur(Math.round(c.totalMin / c.visits))}`, ` · avg ${fmtDur(Math.round(c.totalMin / c.visits))}`) : ''}</span>
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

        </>
      )}

      {/* ── 地点(设计稿③):饼图 + 周/月/年 + 最常去,随时段变 ── */}
      {sub === 'travel' && (
        placeCats.length === 0 ? (
          <p className="nesio-insights-empty">{L(dict, '还没有地点。多授权定位、或导入 Google 时间轴,这里会按类别攒出你去过的地方。', 'No places yet. Grant location or import Google Timeline and your visited places gather here by category.')}</p>
        ) : (
          <>
            {/* 周/月/年 segmented */}
            <div className="nesio-tl-seg" role="tablist" aria-label={L(dict, '时段', 'Period')}>
              {(['week', 'month', 'year'] as const).map((p) => (
                <button key={p} type="button" role="tab" aria-selected={placePeriod === p}
                  className={`nesio-tl-seg-opt${placePeriod === p ? ' is-on' : ''}`}
                  onClick={() => setPlacePeriod(p)}>
                  {L(dict, p === 'week' ? '周' : p === 'month' ? '月' : '年', p === 'week' ? 'Week' : p === 'month' ? 'Month' : 'Year')}
                </button>
              ))}
            </div>

            {placeShare.length === 0 ? (
              <p className="nesio-insights-empty" style={{ marginTop: '1rem' }}>{L(dict, '这段时间还没有地点记录 —— 换个时段看看。', 'No places in this period — try another range.')}</p>
            ) : (
              <>
                {/* 饼图 + 图例 */}
                <div className="nesio-tl-donutwrap">
                  <div className="nesio-tl-donut" style={{ background: `conic-gradient(${(() => {
                    const total = placeShare.reduce((s, x) => s + x.pct, 0) || 1;
                    let acc = 0;
                    return placeShare.map((x) => { const from = (acc / total) * 100; acc += x.pct; return `${x.color} ${from.toFixed(1)}% ${((acc / total) * 100).toFixed(1)}%`; }).join(', ');
                  })()})` }}>
                    <div className="nesio-tl-donut-ctr">
                      <b>{placeDistinct}</b>
                      <small>{L(dict, placePeriod === 'week' ? '本周地点' : placePeriod === 'month' ? '本月地点' : '本年地点', placePeriod === 'week' ? 'this week' : placePeriod === 'month' ? 'this month' : 'this year')}</small>
                    </div>
                  </div>
                  <div className="nesio-tl-legend">
                    {placeShare.map((x) => (
                      <div key={x.label} className="nesio-tl-legend-row">
                        <span className="nesio-tl-legend-dot" style={{ background: x.color }} />
                        <span className="nesio-tl-legend-name">{x.label}</span>
                        <span className="nesio-tl-legend-pct">{x.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 最常去排行 */}
                {placeRanking.length > 0 && (
                  <>
                    <p className="nesio-tl-rank-h">{L(dict, placePeriod === 'week' ? '这周最常去' : placePeriod === 'month' ? '这个月最常去' : '今年最常去', placePeriod === 'week' ? 'Most visited this week' : placePeriod === 'month' ? 'Most visited this month' : 'Most visited this year')}</p>
                    <div className="nesio-tl-rank">
                      {placeRanking.map((c) => (
                        <div key={c.label} className="nesio-tl-rank-row">
                          <span className={`nesio-pt-dot nesio-pt-dot--${c.category}`} aria-hidden style={{ position: 'static', boxShadow: 'none' }} />
                          <span className="nesio-tl-rank-name">{displayLabel(c.label)}</span>
                          <span className="nesio-tl-rank-val">
                            {L(dict, `${c.visits} 次`, `${c.visits}×`)}{c.totalMin >= 120 ? ` · ${Math.round(c.totalMin / 60)}h` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            {/* 按类别浏览(保留纠正分类工具,作饼图下钻)*/}
            <p className="nesio-settings-section-label" style={{ marginTop: '1.4rem' }}>{L(dict, '按类别浏览 · 点地点可纠正分类', 'Browse by category · tap to reclassify')}</p>
            <div className="nesio-tl-catgrid">
              {placeCats.map((g) => {
                const meta = PLACE_CATEGORY_META[g.category];
                const open = expandedCat === g.category;
                return (
                  <div key={g.category} className={`nesio-tl-catcard${open ? ' is-open' : ''}`}>
                    <button type="button" className="nesio-tl-catcard-head" onClick={() => setExpandedCat(open ? null : g.category)}>
                      <span className="nesio-tl-catcard-sym" aria-hidden>{catIconSvg(g.category)}</span>
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
                              <span className="nesio-tl-catplace-meta">{L(dict, `${c.visits} 次 · ${dateKeyToLocalDate(c.lastTs.slice(0, 10)).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`, `${c.visits}× · ${dateKeyToLocalDate(c.lastTs.slice(0, 10)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`)}</span>
                            </button>
                            {catPickFor === c.label && (
                              <div className="nesio-tl-catpick">
                                {(['grocery', 'shopping', 'food', 'cafe', 'fitness', 'park', 'culture', 'education', 'entertainment', 'health', 'lodging', 'transit', 'work', 'home', 'place'] as PlaceCategory[]).map((cat) => (
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

      {/* ── 世界:按国家聚合(批次 40)+ 世界地图 ── */}
      {/* 批次 63:世界板块 = 3D 地球(拖拽旋转,到访国高亮;点一下全屏) */}
      {sub === 'world' && !worldCountry && (
        <div className="nesio-globe-stage">
          <p className="nesio-globe-stats">
            {L(dict,
              `${world.length} 国 · ${world.reduce((n, g) => n + g.cities.length, 0)} 城 · ${trail.length} 足迹`,
              `${world.length} countries · ${world.reduce((n, g) => n + g.cities.length, 0)} cities · ${trail.length} footprints`)}
          </p>
          <Globe
            countries={world.map((g) => ({ name: g.country, count: g.placeCount }))}
            size={300}
            onTap={() => setGlobeFull(true)}
          />
          <span className="nesio-globe-stage-hint">{L(dict, '拖动旋转 · 点一下全屏', 'Drag to spin · tap for fullscreen')}</span>
        </div>
      )}
      {sub === 'world' && !worldCountry && worldHighlights.length > 0 && (
        <div className="nesio-globe-hl-strip">
          {worldHighlights.map((h, i) => (
            <div key={h.kicker} className={`nesio-globe-hl-card nesio-globe-hl-card--v${i % 4}`}>
              <span className="nesio-globe-hl-kicker">{h.kicker}</span>
              <span className="nesio-globe-hl-main">{h.main}</span>
              {h.sub ? <span className="nesio-globe-hl-sub">{h.sub}</span> : null}
              {h.coord ? <span className="nesio-globe-hl-coord">{h.coord}</span> : null}
            </div>
          ))}
        </div>
      )}
      {/* ── 世界(设计稿④):先国家卡,点 › 进城市明信片 ── */}
      {sub === 'world' && world.length === 0 && (
        <p className="nesio-insights-empty">{L(dict, '还没有国家信息。开着「记忆自动定位」正常使用,地名和国家会随打点自动解析,这里就会按国家聚合。', 'No country data yet. Keep auto-locate on — places and countries resolve as you go, and countries gather here.')}</p>
      )}
      {sub === 'world' && world.length > 0 && !worldCountry && (
        <>
          <p className="nesio-tl-world-head">
            {L(dict, `去过 ${world.length} 国 · ${world.reduce((n, g) => n + g.cities.length, 0)} 城`, `${world.length} countries · ${world.reduce((n, g) => n + g.cities.length, 0)} cities`)}
          </p>
          {(() => {
            const first = trail.reduce((a, b) => (new Date(b.ts) < new Date(a.ts) ? b : a), trail[0]);
            const y = new Date(first.ts).getFullYear();
            return Number.isFinite(y) ? <p className="nesio-tl-world-sub">{L(dict, `从 ${y} 到现在`, `From ${y} to now`)}</p> : null;
          })()}
          <div className="nesio-tl-ccards">
            {world.map((g) => {
              const tag = worldCountryTags.get(g.country);
              return (
                <button key={g.country} type="button" className="nesio-tl-ccard" onClick={() => setWorldCountry(g.country)}>
                  <span className={`nesio-tl-ccard-img nesio-tl-cc-g${gradIdx(g.country)}`} aria-hidden />
                  <span className="nesio-tl-ccard-body">
                    <span className="nesio-tl-ccard-name">{g.country}<small>{L(dict, `${g.cities.length} 城`, `${g.cities.length} cities`)}</small></span>
                    {tag && <span className="nesio-tl-ccard-tag">{tag.text}</span>}
                  </span>
                  <span className="nesio-tl-ccard-chev" aria-hidden>›</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      {sub === 'world' && worldCountry && (() => {
        const g = world.find((x) => x.country === worldCountry);
        const cities = (g?.cities ?? []).slice().sort((a, b) => b.count - a.count);
        return (
          <>
            <div className="nesio-tl-city-head">
              <button type="button" className="nesio-tl-city-back" onClick={() => setWorldCountry(null)} aria-label={L(dict, '返回', 'Back')}>‹</button>
              <div>
                <div className="nesio-tl-city-title">{worldCountry}</div>
                <div className="nesio-tl-city-sub">{L(dict, `${cities.length} 城 · ${g?.placeCount ?? 0} 地`, `${cities.length} cities · ${g?.placeCount ?? 0} places`)}</div>
              </div>
            </div>
            {cities.length === 0 ? (
              <p className="nesio-tl-catplace-more">{L(dict, '(还没解析到城市)', '(no city resolved yet)')}</p>
            ) : (
              <div className="nesio-tl-citycards">
                {cities.map((c) => (
                  <div key={c.city} className="nesio-tl-citycard">
                    <span className={`nesio-tl-citycard-img nesio-tl-cc-g${gradIdx(c.city)}`} aria-hidden>
                      <span className="nesio-tl-citycard-tag">{L(dict, `${c.count} 个地点`, `${c.count} places`)}</span>
                    </span>
                    <span className="nesio-tl-citycard-name">{c.city}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        );
      })()}

      <p className="nesio-place-trail-count">{L(dict, `共 ${trail.length} 个打点`, `${trail.length} points total`)}</p>

      {/* 批次 59:地图上的记忆(全屏可缩放) */}
      <MemoryMapSheet open={memMapOpen} onClose={() => setMemMapOpen(false)} />

      {/* 批次 62/63:地点纠正选择器(共享组件,记忆页同用) */}
      {placePick && (
        <PlacePickerSheet
          raw={placePick.raw}
          lat={placePick.lat}
          lon={placePick.lon}
          onClose={() => setPlacePick(null)}
        />
      )}

      {/* 批次 63:3D 地球全屏;批次 69:真全屏(不透明深空,背后不透出) */}
      {globeFull && typeof document !== 'undefined' && createPortal(
        <div className="nesio-globe-fsov" role="dialog" aria-modal="true" aria-label={L(dict, '世界', 'World')}>
          <p className="nesio-globe-stats">
            {L(dict,
              `${world.length} 国 · ${world.reduce((n, g) => n + g.cities.length, 0)} 城 · ${trail.length} 足迹`,
              `${world.length} countries · ${world.reduce((n, g) => n + g.cities.length, 0)} cities · ${trail.length} footprints`)}
          </p>
          <Globe
            countries={world.map((g) => ({ name: g.country, count: g.placeCount }))}
            size={Math.min(typeof window !== 'undefined' ? window.innerWidth - 16 : 360, typeof window !== 'undefined' ? window.innerHeight - 200 : 520, 600)}
          />
          <span className="nesio-globe-stage-hint">{L(dict, '深色一侧是正处于黑夜的地区', 'The shaded side is currently in night')}</span>
          <button type="button" className="nesio-memmap-close nesio-globe-fsov-close" onClick={() => setGlobeFull(false)}>✕</button>
        </div>,
        document.body,
      )}

      {/* 批次 63:缩略图放大查看 */}
      {zoomImg && typeof document !== 'undefined' && createPortal(
        <div className="nesio-imgzoom-overlay" role="dialog" aria-modal="true" aria-label={zoomImg.name}>
          <button type="button" className="nesio-imgzoom-backdrop" onClick={() => setZoomImg(null)} aria-label={L(dict, '关闭', 'Close')} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="nesio-imgzoom-img" src={zoomImg.url} alt={zoomImg.name} onClick={() => setZoomImg(null)} />
        </div>,
        document.body,
      )}

      {/* 批次 61:该到访时段的具体记忆(点条目直接看详情,不去记忆库) */}
      {visitMems && typeof document !== 'undefined' && createPortal(
        <div className="nesio-visitmem-overlay" role="dialog" aria-modal="true">
          <button type="button" className="nesio-visitmem-backdrop" onClick={() => setVisitMems(null)} aria-label={L(dict, '关闭', 'Close')} />
          <div className="nesio-visitmem-sheet">
            <p className="nesio-memmap-list-title">{visitMems.title} · {L(dict, `${visitMems.nodes.length} 条记忆`, `${visitMems.nodes.length} memories`)}</p>
            <div className="nesio-memmap-list-scroll">
              {visitMems.nodes.map((n) => (
                <button key={n.id} type="button" className="nesio-memmap-item nesio-memmap-item--btn" onClick={() => setVisitSel(n)}>
                  <span className="nesio-memmap-item-name">{n.name}</span>
                  <span className="nesio-memmap-item-time">{new Date(n.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                </button>
              ))}
            </div>
          </div>
          {visitSel && <MemoryNodeDetail node={visitSel} onClose={() => setVisitSel(null)} />}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** 批次 62:到访时段照片小预览 —— 记忆里带图的,先给两张缩略图(点开进详情)。 */
function VisitThumbs({ nodes, onZoom }: { nodes: LifeNode[]; onZoom: (url: string, name: string) => void }) {
  const withImg = nodes
    .map((n) => ({ n, asset: (n.assets || []).find((a) => a.kind === 'image') }))
    .filter((x): x is { n: LifeNode; asset: NonNullable<LifeNode['assets']>[number] } => Boolean(x.asset))
    .slice(0, 2);
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    withImg.forEach(({ asset }) => {
      if (urls[asset.id]) return;
      void getLocalImage(asset.id).then((u) => {
        if (!cancelled && u) setUrls((prev) => ({ ...prev, [asset.id]: u }));
      }).catch(() => {});
    });
    return () => { cancelled = true; };
  }, [withImg.map((x) => x.asset.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!withImg.length) return null;
  return (
    <div className="nesio-tl-thumbs">
      {withImg.map(({ n, asset }) => (
        urls[asset.id]
          ? <button key={asset.id} type="button" className="nesio-tl-thumb" onClick={() => onZoom(urls[asset.id], n.name)} aria-label={n.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={urls[asset.id]} alt="" loading="lazy" />
            </button>
          : null
      ))}
    </div>
  );
}
