'use client';

/**
 * TimelineTab — 足迹(批次 28 起,批次 30 拆 3 子 tab)。洞察里的「足迹」tab。
 * 子 tab:时间线(Google 风当天行程)/ 分析(聚类 + 地点纠正)/ 环游(去过的地方)。
 * 数据全部本机。地点名可手动纠正(Unknown → 对的名字),记住后各处都用对的。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  loadPlaceTrail, PLACE_TRAIL_UPDATED_EVENT,
  timelineDays, buildDayJourney, dayStats,
  clusterPlaces, categoryTimeShare,
  displayLabel, isGenericPlace,
  placesByCategory, PLACE_CATEGORY_META, worldByCountry, loadPlaceGeo,
  type PlaceVisit, type PlaceCategory, type JourneyItem, type PlaceCluster,
} from '@/lib/portal/place-trail';
import { wallHHMM, dateKeyToLocalDate } from '@/lib/portal/place-time.mjs';
import { monthlyPlaceComparison, footprintHighlights } from '@/lib/portal/place-stats';
import PlaceMap from './PlaceMap';
import { IconHome, IconUtensils, IconCard, IconActivity, IconBriefcase, IconPlane, IconBed, IconHeartPulse, IconBook, IconSun, IconStar, IconMapPin, IconCar, IconWalk, NodeTypeIcon } from '../icons';
import { displayNodeName } from '@/lib/portal/node-display';

// 到访记忆列表:类型 → 图标底色(与记忆详情类型条同一套 chip 语义色)
const VM_TYPE_BG: Record<string, string> = {
  person: 'var(--chip-indigo)', object: 'var(--chip-blue)', place: 'var(--chip-green)',
  event: 'var(--chip-amber)', commitment: 'var(--chip-violet)', health_state: 'var(--chip-pink)', preference: 'var(--chip-mint)',
};
import dynamic from 'next/dynamic';
import { getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';
import { getLocalImage } from '@/lib/portal/local-image-store';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import { createPortal } from 'react-dom';
const MemoryMapSheet = dynamic(() => import('./MemoryMapSheet'), { ssr: false });
const MemoryNodeDetail = dynamic(() => import('../MemoryNodeDetail'), { ssr: false });
const PlacePickerSheet = dynamic(() => import('../PlacePickerSheet'), { ssr: false });
const Globe = dynamic(() => import('./Globe'), { ssr: false });
const PlacesShareSheet = dynamic(() => import('../PlacesShareSheet'), { ssr: false });
import { L } from '@/lib/portal/i18n';
import SegTabs from '../ui/SegTabs';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import NesioSheet from '../ui/NesioSheet';
import { computePlacesShareStats, type PlacesShareStats } from '@/lib/portal/places-share';
import { matchPlacePhotoAsset, placePhotoOverrideId, setPlacePhotoOverride, PLACE_PHOTOS_EVENT, type GeoImageNode, type PlaceDescriptor } from '@/lib/portal/place-photos';
import { countryDisplayName, canonicalCountryKey } from '@/lib/portal/country-normalize';
import TravelPlanPanel from '../travel/TravelPlanPanel';

type Sub = 'timeline' | 'analytics' | 'travel' | 'world' | 'plan';

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

/* (原来的 CAT 标签表随「类别时长占比」一起删掉 —— 分类名统一走 PLACE_CATEGORY_META,一套真相) */
// 地点饼图配色:走设计 token(莫兰迪辅助色),top5 + 其他循环取用,不硬编码色值。
const CAT_PIE_COLORS = [
  'var(--status-gentle)', 'var(--status-go)', 'var(--status-calm)',
  'var(--portal-cool-accent)', 'var(--portal-accent)', 'var(--portal-muted)',
];

// 16 类地点映射到设计系统的 8 个类别色位(--viz-1..8,见 globals.css)。
// 原来是 16 个写死的 hex —— 换皮肤时足迹图上的点一个都不变。
// 映射按「气质就近」合并:住/宿同位、买/逛同位、吃/咖啡同位…… 同屏很少同时出现 16 类,
// 合并后仍然分得开;而且现在整套会跟着皮肤压饱和,不再像贴纸糊在柔和界面上。
const DOT_COLOR: Record<PlaceCategory, string> = {
  home: 'var(--viz-1)', lodging: 'var(--viz-1)',
  work: 'var(--viz-5)', education: 'var(--viz-5)', culture: 'var(--viz-5)',
  grocery: 'var(--viz-3)', park: 'var(--viz-3)',
  shopping: 'var(--viz-6)', health: 'var(--viz-6)', fitness: 'var(--viz-6)',
  food: 'var(--viz-2)', cafe: 'var(--viz-2)', entertainment: 'var(--viz-2)',
  transit: 'var(--viz-7)', place: 'var(--viz-4)', unknown: 'var(--viz-8)',
};

// ── 可交互甜甜圈:图例贴在饼里(%),点扇形高亮 + 中心出详情 ──
function polar(cx: number, cy: number, r: number, angDeg: number): [number, number] {
  const a = ((angDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function donutSeg(cx: number, cy: number, rO: number, rI: number, a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = polar(cx, cy, rO, a0);
  const [x1, y1] = polar(cx, cy, rO, a1);
  const [x2, y2] = polar(cx, cy, rI, a1);
  const [x3, y3] = polar(cx, cy, rI, a0);
  return `M${x0} ${y0} A${rO} ${rO} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${rI} ${rI} 0 ${large} 0 ${x3} ${y3} Z`;
}

type PlaceSeg = { key: string; category: PlaceCategory; label: string; pct: number; min: number; count: number; color: string };
function fmtDur(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function PlaceDonut({ segments, selected, onSelect, centerCount, centerLabel, dict }: {
  segments: PlaceSeg[]; selected: string | null; onSelect: (k: string | null) => void;
  centerCount: number; centerLabel: string; dict: string;
}) {
  const totalPct = segments.reduce((s, x) => s + x.pct, 0) || 1;
  const sel = selected ? segments.find((s) => s.key === selected) ?? null : null;
  let acc = 0;
  const arcs = segments.map((s) => {
    const a0 = (acc / totalPct) * 360;
    acc += s.pct;
    const a1 = (acc / totalPct) * 360;
    return { s, a0, a1, mid: (a0 + a1) / 2 };
  });
  // 点任何空白处 → 恢复未选中彩图态
  return (
    <div className="nesio-tl-donut2wrap" onClick={() => onSelect(null)}>
      <div className="nesio-tl-donut2">
        <svg viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label={L(dict, '地点类别占比(点扇形看详情)', 'Place category share (tap a slice)')}>
          {arcs.map(({ s, a0, a1 }) => {
            const dim = selected != null && selected !== s.key;
            const uncat = s.category === 'unknown';
            return (
              <path key={s.key} d={donutSeg(50, 50, 44, 27, a0, Math.max(a0 + 0.5, a1))}
                fill={s.color} opacity={dim ? 0.32 : 1}
                stroke={uncat ? 'var(--portal-line)' : 'var(--sheet-opaque, #fff)'} strokeWidth="0.8"
                style={{ cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); onSelect(selected === s.key ? null : s.key); }} />
            );
          })}
        </svg>
        {/* 图例贴饼里:每片显示图标 + 时长(无分类=问号);HTML 叠层,不吃点击 */}
        {arcs.filter(({ s }) => s.pct >= 7).map(({ s, mid }) => {
          const [lx, ly] = polar(50, 50, 35.5, mid);
          const dim = selected != null && selected !== s.key;
          return (
            <div key={s.key} className="nesio-tl-donut2-slice" style={{ left: `${lx}%`, top: `${ly}%`, opacity: dim ? 0.35 : 1 }}>
              {s.category === 'unknown'
                ? <span className="nesio-tl-donut2-q">?</span>
                : <>{catIconSvg(s.category)}<span className="nesio-tl-donut2-dur">{fmtDur(s.min)}</span></>}
            </div>
          );
        })}
        <div className="nesio-tl-donut2-ctr" aria-live="polite">
          {sel ? (
            <>
              <b>{sel.count}</b>
              <small className="nesio-tl-donut2-ctr-name">{sel.label}</small>
              <small>{L(dict, '个地点', sel.count === 1 ? 'place' : 'places')} · {fmtDur(sel.min)}</small>
            </>
          ) : (
            <>
              <b>{centerCount}</b>
              <small>{centerLabel}</small>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// 地点封面照:自动就近匹配一张带图记忆;点图从本地换。无图 → 渐变占位。
function PlacePhoto({ placeKey, coords, imageNodes, place, timeRanges, onActivate, gradClass, className, dict, children }: {
  placeKey: string; coords: Array<{ lat: number; lon: number }>; imageNodes: GeoImageNode[];
  place?: PlaceDescriptor; timeRanges?: Array<[number, number]>; onActivate?: () => void;
  gradClass: string; className: string; dict: string; children?: ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const coordsKey = coords.map((c) => `${c.lat.toFixed(3)},${c.lon.toFixed(3)}`).join('|');
  const imgKey = imageNodes.map((n) => n.assetId).join('|');
  const placeSig = `${place?.city || ''}|${place?.country || ''}|${timeRanges?.length || 0}`;
  useEffect(() => {
    let alive = true;
    const resolve = () => {
      const id = placePhotoOverrideId(placeKey) || matchPlacePhotoAsset(coords, imageNodes, place, timeRanges);
      if (!id) { if (alive) setUrl(null); return; }
      getLocalImage(id).then((u) => {
        if (!alive) return;
        if (u) { setUrl(u); return; }
        // 本机 IDB 没有(云端图 / 本地已清)→ 用 storagePath 换签名 URL 兜底,否则永远空
        const cloud = imageNodes.find((n) => n.assetId === id)?.storagePath;
        if (!cloud) { setUrl(null); return; }
        createAppApiClient().fetchCloudAssetReadUrl({ storagePath: cloud })
          .then((r) => { if (alive) setUrl(r.ok && r.signedUrl ? r.signedUrl : null); })
          .catch(() => { if (alive) setUrl(null); });
      }).catch(() => { if (alive) setUrl(null); });
    };
    resolve();
    window.addEventListener(PLACE_PHOTOS_EVENT, resolve);
    return () => { alive = false; window.removeEventListener(PLACE_PHOTOS_EVENT, resolve); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey, coordsKey, imgKey, placeSig]);
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (f) { try { await setPlacePhotoOverride(placeKey, f); } catch { /* 存图失败不拦 */ } }
  }
  return (
    <button
      type="button"
      className={`${className}${url ? ' has-photo' : ` ${gradClass}`}`}
      style={url ? { backgroundImage: `url("${url}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      onClick={(e) => { e.stopPropagation(); if (onActivate) onActivate(); else inputRef.current?.click(); }}
      aria-label={onActivate ? L(dict, '查看这里的记忆', 'See memories here') : L(dict, '点图换封面照', 'Tap to change cover photo')}
    >
      {children}
      {/* 换封面照移到角标相机图标(主区点击留给「看记忆」);span 内联点击,不嵌套 button */}
      <span
        className="nesio-tl-photo-edit"
        title={L(dict, '换封面照', 'Change cover')}
        onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg>
      </span>
      <input ref={inputRef} type="file" accept="image/*" className="nesio-visually-hidden" onChange={onFile} onClick={(e) => e.stopPropagation()} />
    </button>
  );
}

export default function TimelineTab() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [trail, setTrail] = useState<PlaceVisit[]>([]);
  const [dayIdx, setDayIdx] = useState(0);
  const [sub, setSub] = useState<Sub>('timeline');
  const [placePeriod, setPlacePeriod] = useState<'day' | 'week' | 'month' | 'year'>('month'); // 地点饼图时段
  const [pieSel, setPieSel] = useState<string | null>(null); // 可交互饼图:选中的类别
  const [worldCountry, setWorldCountry] = useState<string | null>(null); // 世界:点进某国看城市明信片
  const [memMapOpen, setMemMapOpen] = useState(false); // 批次 59:地图上的记忆
  const [visitMems, setVisitMems] = useState<{ title: string; nodes: LifeNode[] } | null>(null); // 批次 61:点「记了 N 条」看具体记忆
  const [visitSel, setVisitSel] = useState<LifeNode | null>(null);
  const [zoomImg, setZoomImg] = useState<{ url: string; name: string } | null>(null); // 批次 63:缩略图放大
  const [globeFull, setGlobeFull] = useState(false); // 批次 63:3D 地球全屏
  // 批次 62:地点纠正选择器(附近候选 + 手动命名,参考 Foursquare Where? 形态)
  const [placePick, setPlacePick] = useState<{ raw: string; lat?: number; lon?: number } | null>(null);
  const [shareStats, setShareStats] = useState<PlacesShareStats | null>(null); // 足迹成就卡分享
  const [locateBusy, setLocateBusy] = useState(false);
  const [locateMsg, setLocateMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const read = () => setTrail(loadPlaceTrail());
    read();
    window.addEventListener(PLACE_TRAIL_UPDATED_EVENT, read);
    // 自愈:历史导入里「未知地点/纯坐标」的到访,打开足迹时反查补名(限量+缓存,
    // 改动经 save 广播 PLACE_TRAIL_UPDATED_EVENT,上面的 read 会自动刷新)。
    void import('@/lib/portal/place-trail')
      .then((m) => m.backfillGenericPlaceLabels(20))
      .catch(() => {});
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
  // bug3:「7 月足迹」改成可左右翻月(0 = 最近有数据的那个月,往右退一个月 +1)
  const [monthBack, setMonthBack] = useState(0);
  const monthly = useMemo(() => monthlyPlaceComparison(trail, monthBack), [trail, monthBack]);
  const highlights = useMemo(() => footprintHighlights(trail), [trail]);

  // bug3:进「地点」页就用系统定位落一个当前点 + 打开持续监听 —— 具体地点靠这个认,
  // 不再等用户去按「标记当前位置」。一次挂载只跑一次,静默(只有失败才出提示)。
  const autoLocatedRef = useRef(false);
  useEffect(() => {
    if (sub !== 'travel' || autoLocatedRef.current) return;
    autoLocatedRef.current = true;
    void markHereNow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub]);
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
      if (placePeriod === 'day') return t.getFullYear() === d0.getFullYear() && t.getMonth() === d0.getMonth() && t.getDate() === d0.getDate();
      if (placePeriod === 'week') return now - t.getTime() <= 7 * 86_400_000;
      if (placePeriod === 'month') return t.getFullYear() === d0.getFullYear() && t.getMonth() === d0.getMonth();
      return t.getFullYear() === d0.getFullYear();
    });
  }, [trail, placePeriod]);
  const placeShare = useMemo(() => {
    const raw = categoryTimeShare(placePeriodTrail).filter((c) => c.pct > 0);
    const catCount = new Map<PlaceCategory, number>();
    for (const c of clusterPlaces(placePeriodTrail, 99999)) catCount.set(c.category, (catCount.get(c.category) || 0) + 1);
    const top = raw.slice(0, 5).map((c, i) => ({
      key: String(c.category), category: c.category,
      label: L(dict, PLACE_CATEGORY_META[c.category].zh, PLACE_CATEGORY_META[c.category].en),
      pct: c.pct, min: c.totalMin, count: catCount.get(c.category) || 0,
      // 无分类(unknown)用白填充 + 中间问号;其余走莫兰迪 token 环。
      color: c.category === 'unknown' ? 'var(--sheet-opaque, #fff)' : CAT_PIE_COLORS[i],
    }));
    const rest = raw.slice(5);
    const restPct = rest.reduce((s, c) => s + c.pct, 0);
    if (restPct > 0) top.push({ key: 'other', category: 'place' as PlaceCategory, label: L(dict, '其他', 'Other'), pct: restPct, min: rest.reduce((s, c) => s + c.totalMin, 0), count: rest.reduce((s, c) => s + (catCount.get(c.category) || 0), 0), color: CAT_PIE_COLORS[5] });
    return top;
  }, [placePeriodTrail, dict]);
  const placeRanking = useMemo(() => clusterPlaces(placePeriodTrail, 6).slice().sort((a, b) => b.visits - a.visits).slice(0, 5), [placePeriodTrail]);
  // 图2:点饼图某类别 → 下面「最常去」只出这个类别的地点明细(全量按次数排,不止前 5)
  const placeRankingAll = useMemo(() => clusterPlaces(placePeriodTrail, 99999).slice().sort((a, b) => b.visits - a.visits), [placePeriodTrail]);
  // 地点封面照:所有带图记忆节点。有坐标的按就近配,没坐标的按 capturedPlace 经 geo 表
  // 映射到 city/country 后按地名配 —— 用户实锤「有对应记忆照片就自动展示一张,别让照片位空着」。
  const imageNodes = useMemo<GeoImageNode[]>(() => {
    const geo = loadPlaceGeo();
    return getLifeGraph()
      .map((n) => ({ n, asset: (n.assets || []).find((a) => a.kind === 'image' || a.mimeType?.startsWith('image/')) }))
      .filter((x) => Boolean(x.asset))
      .map((x) => {
        const a = x.n.attributes || {};
        const label = typeof a.capturedPlace === 'string' ? a.capturedPlace : '';
        const g = label ? geo[label] : undefined;
        // 位置:EXIF 拍摄地(capturedLat/Lon,导入旧照)优先;否则退到拍摄当时的当前定位
        // (lat/lon —— 现拍照片存这里,不是 capturedLat)。此前只读 capturedLat,现拍照片全漏。
        const lat = typeof a.capturedLat === 'number' ? a.capturedLat : (typeof a.lat === 'number' ? a.lat : undefined);
        const lon = typeof a.capturedLon === 'number' ? a.capturedLon : (typeof a.lon === 'number' ? a.lon : undefined);
        return {
          assetId: x.asset!.id,
          lat,
          lon,
          ts: new Date(x.n.createdAt).getTime(),
          city: g?.city || (typeof a.city === 'string' ? a.city : undefined),
          country: g?.country || (typeof a.country === 'string' ? a.country : undefined),
          storagePath: x.asset!.storagePath,
        };
      });
  }, []);
  const placeCoords = useMemo(() => {
    const geo = loadPlaceGeo();
    const byCountry = new Map<string, Array<{ lat: number; lon: number }>>();
    const byCity = new Map<string, Array<{ lat: number; lon: number }>>();
    // 按 ~1km 网格去重并封顶 —— trail 可达上万点,不去重会让下游匹配 O(节点×坐标)
    // 在主线程扫爆(用户实锤点城市卡卡死)。25km 匹配阈值下,1km 网格精度绰绰有余。
    const seenC = new Map<string, Set<string>>();
    const seenCity = new Map<string, Set<string>>();
    const add = (map: Map<string, Array<{ lat: number; lon: number }>>, seenMap: Map<string, Set<string>>, key: string, lat: number, lon: number) => {
      let seen = seenMap.get(key);
      if (!seen) { seen = new Set(); seenMap.set(key, seen); }
      const rk = `${lat.toFixed(2)},${lon.toFixed(2)}`;
      if (seen.has(rk)) return;
      seen.add(rk);
      const a = map.get(key) || [];
      if (a.length < 80) { a.push({ lat, lon }); map.set(key, a); }
    };
    for (const v of trail) {
      if (typeof v.lat !== 'number' || typeof v.lon !== 'number') continue;
      const g = geo[v.label];
      // 国家坐标按归一化键聚 —— 世界卡已按 countryKey 合并「美国/US」,坐标也要合并。
      if (g?.country) add(byCountry, seenC, canonicalCountryKey(g.country), v.lat, v.lon);
      if (g?.city) add(byCity, seenCity, g.city, v.lat, v.lon);
    }
    return { byCountry, byCity };
  }, [trail]);
  // 每个国家/城市的到访时段(±90 分钟缓冲)—— 照片拍摄时间落在这些窗内就算这地的照片,
  // 兜住「现拍但没坐标」的照片(相机没定位权限也能靠时间归位)。
  const placeTimes = useMemo(() => {
    const geo = loadPlaceGeo();
    const BUF = 90 * 60_000;
    const rawCountry = new Map<string, Array<[number, number]>>();
    const rawCity = new Map<string, Array<[number, number]>>();
    for (const v of trail) {
      const g = geo[v.label];
      if (!g?.country && !g?.city) continue;
      const s = new Date(v.ts).getTime();
      if (!Number.isFinite(s)) continue;
      const e = v.end ? new Date(v.end).getTime() : s;
      const range: [number, number] = [s - BUF, (Number.isFinite(e) ? e : s) + BUF];
      if (g?.country) { const k = canonicalCountryKey(g.country); const a = rawCountry.get(k) || []; a.push(range); rawCountry.set(k, a); }
      if (g?.city) { const a = rawCity.get(g.city) || []; a.push(range); rawCity.set(g.city, a); }
    }
    // 合并重叠区间:成千上万个 ±90min 窗合并成几段「停留」,匹配时不再逐条扫爆主线程。
    const merge = (ranges: Array<[number, number]>): Array<[number, number]> => {
      ranges.sort((a, b) => a[0] - b[0]);
      const out: Array<[number, number]> = [];
      for (const r of ranges) {
        const last = out[out.length - 1];
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
        else out.push([r[0], r[1]]);
      }
      return out;
    };
    const byCountry = new Map<string, Array<[number, number]>>();
    const byCity = new Map<string, Array<[number, number]>>();
    for (const [k, a] of rawCountry) byCountry.set(k, merge(a));
    for (const [k, a] of rawCity) byCity.set(k, merge(a));
    return { byCountry, byCity };
  }, [trail]);
  // 城市卡点进去看该城市的记忆:capturedPlace 经 geo 归属该城市,或坐标在该城市到访点 25km 内
  // 只收「真正发生在这里」的 —— 照片/语音/手记;邮件/日历/系统这类是同步进来的,不算地点记忆。
  const ONSITE_SOURCES = new Set(['photo', 'voice', 'manual']);
  const memsAtCity = (city: string): LifeNode[] => {
    const geo = loadPlaceGeo();
    const cityCoords = placeCoords.byCity.get(city) || [];
    const cityTimes = placeTimes.byCity.get(city) || [];
    const seen = new Set<string>();
    const out: LifeNode[] = [];
    // 先按记录时间从新到旧排,再收集 —— 否则 300 封顶(perf 护栏)可能把最新的记忆挡在门外,
    // 违反「取最近 80」承诺(getLifeGraph() 非日期序)。一次排序,封顶后 slice 80 即最新 80。
    const sortedGraph = getLifeGraph().slice().sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime());
    for (const nn of sortedGraph) {
      if (!ONSITE_SOURCES.has(nn.source)) continue;
      const a = nn.attributes || {};
      const label = typeof a.capturedPlace === 'string' ? a.capturedPlace : '';
      let hit = Boolean(label && geo[label]?.city === city);
      // 坐标:capturedLat/Lon(EXIF)优先,否则退 lat/lon(现拍当前定位)—— 与封面照同源修复
      if (!hit) {
        const lat = typeof a.capturedLat === 'number' ? a.capturedLat : (typeof a.lat === 'number' ? a.lat : undefined);
        const lon = typeof a.capturedLon === 'number' ? a.capturedLon : (typeof a.lon === 'number' ? a.lon : undefined);
        if (typeof lat === 'number' && typeof lon === 'number') {
          for (const c of cityCoords) {
            const dLat = (lat - c.lat) * 111_320;
            const dLon = (lon - c.lon) * 111_320 * Math.cos((c.lat * Math.PI) / 180);
            if (Math.hypot(dLat, dLon) < 25_000) { hit = true; break; }
          }
        }
      }
      // 时间归属:记忆记录时间落在该城市到访时段内(无坐标的现拍/笔记也能归位)
      if (!hit && cityTimes.length) {
        const t = new Date(nn.createdAt).getTime();
        if (Number.isFinite(t) && cityTimes.some(([s, e]) => t >= s && t <= e)) hit = true;
      }
      if (hit && !seen.has(nn.id)) { seen.add(nn.id); out.push(nn); if (out.length >= 300) break; }
    }
    // 从新到旧,取最近 80 条
    out.sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime());
    return out.slice(0, 80);
  };
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
      const key = canonicalCountryKey(g.country); // 按归一化国家键聚,变体不分家
      if (!key) continue;
      const t = new Date(v.ts).getTime();
      const a = byC.get(key) || { visits: 0, earliest: Infinity, maxLat: -Infinity, minLat: Infinity };
      a.visits += 1;
      if (Number.isFinite(t)) a.earliest = Math.min(a.earliest, t);
      if (typeof v.lat === 'number') { a.maxLat = Math.max(a.maxLat, v.lat); a.minLat = Math.min(a.minLat, v.lat); }
      byC.set(key, a);
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


  /**
   * 取系统定位 → 反查地名 → 落进足迹。
   *
   * bug3「反向识别具体地点失效 / 利用系统定位系统」:原来这是个手动的「标记当前位置(验证定位)」
   * 按钮 —— 用户得自己想起来按一下,不按就永远只有历史导入的点,具体地点当然认不出来。
   * 现在改成**进「地点」页自动跑一次**(打开定位监听 ensurePlaceTrailWatch 持续供点),
   * 手动按钮删掉。只在失败时才出提示,成功静默(不打扰)。
   */
  async function markHereNow(silent = false) {
    if (locateBusy) return;
    setLocateBusy(true);
    // 手动触发时立刻给可见状态(定位要等 8-15s);自动跑不吵。
    if (!silent) setLocateMsg({ ok: true, text: L(dict, '正在取定位…(最多等 15 秒;室内可能拿不到)', 'Locating… (up to 15s; may fail indoors)') });
    try {
      const { getDevicePosition, recordVisitFromCoords, ensurePlaceTrailWatch } = await import('@/lib/portal/native-geolocation');
      const pos = await getDevicePosition({ timeoutMs: 15_000, maximumAgeMs: 30_000, enableHighAccuracy: true });
      if (!pos) {
        // 失败必须看得见(哪怕是自动跑的)—— 否则「地点认不出来」永远查不到原因。
        setLocateMsg({
          ok: false,
          text: L(dict, '拿不到坐标 — 确认系统已允许定位,到窗边/室外再试', 'No coordinates — allow Location, try near a window/outdoors'),
        });
        return;
      }
      await recordVisitFromCoords(pos.lat, pos.lon);
      void ensurePlaceTrailWatch(); // 打开系统持续定位:之后的到访自动进库,不靠用户按按钮
      setTrail(loadPlaceTrail());
      if (!silent) { setDayIdx(0); setSub('timeline'); }
      let label = `${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}`;
      try {
        const { reverseGeocode } = await import('@/lib/portal/providers/weather');
        const g = await reverseGeocode(pos.lat, pos.lon);
        label = g.label || g.city || label;
      } catch { /* 坐标也够证明 */ }
      if (!silent) {
        setLocateMsg({
          ok: true,
          text: L(dict, `记下了当前位置:${label}`, `Saved current location: ${label}`),
        });
      }
    } catch {
      setLocateMsg({ ok: false, text: L(dict, '定位失败,稍后再试', 'Locate failed — try again') });
    } finally {
      setLocateBusy(false);
    }
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

  // 「分析」并入「地点」;计划(要去)为第 4 个 sub tab(世界后面)。
  const SUBS: Array<[Sub, string, string]> = [
    ['timeline', '时间线', 'Timeline'],
    ['travel', '地点', 'Places'],
    ['world', '世界', 'World'],
    ['plan', '计划', 'Plans'],
  ];

  return (
    <div className="nesio-tl">
      <div className="nesio-fin-subtabs">
        {SUBS.map(([id, zh, en]) => (
          <button key={id} type="button" className={`nesio-fin-subtab${sub === id ? ' is-active' : ''}`} onClick={() => setSub(id)}>{L(dict, zh, en)}</button>
        ))}
      </div>

      {sub === 'plan' && <TravelPlanPanel />}

      {/* ── 时间线:当天行程 ── */}
      {sub === 'timeline' && (
        <>
          {dayMapPoints.length > 0 && <PlaceMap points={dayMapPoints} path={dayPath} height={170} />}
          <div className="nesio-tl-daynav">
            <button type="button" className="nesio-fin-monthnav" disabled={dayIdx >= days.length - 1} onClick={() => setDayIdx((i) => Math.min(days.length - 1, i + 1))} aria-label={L(dict, '前一天', 'Previous day')}>‹</button>
            <span className="nesio-tl-day">{dayLabel(dateKey)}</span>
            <button type="button" className="nesio-fin-monthnav" disabled={dayIdx <= 0} onClick={() => setDayIdx((i) => Math.max(0, i - 1))} aria-label={L(dict, '后一天', 'Next day')}>›</button>
          </div>
          {/* bug3:「标记当前位置(验证定位)」按钮删掉 —— 它是调试期的自证工具,
              定位现在由系统持续供给(见 markHereNow 仍保留给「地点纠正」用)。 */}
          {locateMsg && (
            <p
              style={{
                margin: '0 0 0.75rem',
                padding: '0.55rem 0.75rem',
                borderRadius: '0.75rem',
                fontSize: '0.78rem',
                lineHeight: 1.45,
                background: locateMsg.ok ? 'var(--status-go-soft)' : 'var(--status-risk-soft)',
                color: locateMsg.ok ? 'var(--status-go)' : 'var(--status-risk)',
                border: `1px solid ${locateMsg.ok ? 'var(--status-go)' : 'var(--status-risk)'}`,
              }}
            >
              {locateMsg.text}
            </p>
          )}
          {/* bug3:「地图只画足迹库里的到访…请点标记当前位置」这段说明按标注删掉 */}
          {/* 设计对齐 Google Timeline:驾车 · 步行 · 到访(有分模式数据就分开显示)。
              2026-07-29:图标从原生 emoji(🚗🚶📍)换成站内描边图标 —— emoji 在各平台
              长相不一,和旁边的线性图标也不是一套。 */}
          {(() => {
            const moves = journey.filter((it): it is Extract<typeof it, { kind: 'move' }> => it.kind === 'move');
            const sum = (m: 'drive' | 'walk') => moves.filter((it) => it.mode === m).reduce((a, it) => ({ km: a.km + it.km, min: a.min + it.durationMin }), { km: 0, min: 0 });
            const drive = sum('drive');
            const walk = sum('walk');
            const jstat = (icon: React.ReactNode, km: number, min: number, label: string) => (
              <div className="nesio-tl-jstat">
                <span className="nesio-tl-jstat-ic" aria-hidden>{icon}</span>
                <div className="nesio-tl-jstat-body">
                  <span className="nesio-tl-jstat-v">{km > 0 ? fmtDist(km) : label}</span>
                  {min >= 1 && <span className="nesio-tl-jstat-sub">{fmtDur(min)}</span>}
                </div>
              </div>
            );
            return (
              <div className="nesio-tl-stats nesio-tl-stats--journey">
                {drive.km > 0 && jstat(<IconCar size={15} />, drive.km, drive.min, '')}
                {walk.km > 0 && jstat(<IconWalk size={15} />, walk.km, walk.min, '')}
                {drive.km === 0 && walk.km === 0 && stats.moveKm > 0 && jstat(<IconCar size={15} />, stats.moveKm, 0, '')}
                <div className="nesio-tl-jstat">
                  <span className="nesio-tl-jstat-ic" aria-hidden><IconMapPin size={15} /></span>
                  <div className="nesio-tl-jstat-body">
                    <span className="nesio-tl-jstat-v">{stats.visits}</span>
                    <span className="nesio-tl-jstat-sub">{L(dict, '到访', 'visits')}</span>
                  </div>
                </div>
              </div>
            );
          })()}
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
                  <VisitThumbs nodes={memNodesAtVisit(it.seg)} onOpen={(n) => setVisitSel(n)} />
                </div>
              </div>
            ) : (
              <div key={i} className="nesio-tl-item nesio-tl-item--move">
                <span className="nesio-tl-move-icon" aria-hidden>{it.mode === 'walk' ? <IconWalk size={14} /> : it.mode === 'drive' ? <IconCar size={14} /> : '·'}</span>
                <span className="nesio-tl-move-text">{modeLabel(it.mode)} · {L(dict, `约 ${fmtDist(it.km)}`, `~${fmtDist(it.km)}`)}{it.durationMin >= 1 ? ` · ${fmtDur(it.durationMin)}` : ''}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── 分析:聚类 + 地点纠正 ── */}
      {sub === 'travel' && (
        <>
          {/* ── 月度概览(Google Timeline Insights 形态):数字 + 环比 ── 「分析」并入 */}
          {monthly && (
            <div className="nesio-tl-month">
              {/* bug3:月份左右选择器 —— 原来只能看「最近那个月」,别的月份根本进不去 */}
              <div className="nesio-tl-month-nav">
                <button type="button" className="nesio-tl-month-arrow" aria-label={L(dict, '上一个月', 'Previous month')}
                  onClick={() => setMonthBack((n) => n + 1)}>‹</button>
                <p className="nesio-settings-section-label" style={{ margin: 0 }}>
                  {L(dict, `${Number(monthly.current.monthKey.slice(5, 7))} 月足迹`, `${new Date(monthly.current.monthKey + '-01T00:00:00').toLocaleString('en-US', { month: 'long' })} footprint`)}
                  {monthly.prevHasData && <span className="nesio-tl-month-vs">{L(dict, ' · 对比上月', ' · vs last month')}</span>}
                </p>
                <button type="button" className="nesio-tl-month-arrow" aria-label={L(dict, '下一个月', 'Next month')}
                  disabled={monthBack === 0} onClick={() => setMonthBack((n) => Math.max(0, n - 1))}>›</button>
              </div>
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
              {/* bug3:这段名词解释和下面那行「累计:…」按标注一起删掉 */}
            </div>
          )}


          {/* ── 真实地图概览(批次 59:点一下进入可缩放的「地图上的记忆」)── */}
          {mapPoints.length > 0 && (
            <button type="button" className="nesio-tl-map-open" onClick={() => setMemMapOpen(true)} aria-label={L(dict, '打开地图上的记忆', 'Open memories on the map')}>
              <PlaceMap points={mapPoints} height={200} />
              <span className="nesio-tl-map-open-hint">{L(dict, '点开看地图上的记忆 · 可缩放', 'Tap for memories on the map · zoomable')}</span>
            </button>
          )}

          {/* bug3:「生活节奏 · 外出时间」热力格按标注划掉删除 */}

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

          {/* bug3:「常去地点 · 点名字可纠正」与「类别时长占比」两块按标注删除。
              地点纠正入口仍在下面「最常去」列表里(点地点即可改),没有丢功能。 */}

        </>
      )}

      {/* ── 地点(设计稿③):饼图 + 周/月/年 + 最常去,随时段变 ── */}
      {sub === 'travel' && (
        placeCats.length === 0 ? (
          <p className="nesio-insights-empty">{L(dict, '还没有地点。多授权定位、或导入 Google 时间轴,这里会按类别攒出你去过的地方。', 'No places yet. Grant location or import Google Timeline and your visited places gather here by category.')}</p>
        ) : (
          <>
            {/* 日/周/月/年 —— 四段平分一整行。
                2026-07-29:原 .nesio-tl-seg 是全站分段控件的第 7 套,收敛到 SegTabs。 */}
            <SegTabs
              size="sm"
              items={(['day', 'week', 'month', 'year'] as const).map((p) => ({
                key: p,
                label: L(dict,
                  p === 'day' ? '日' : p === 'week' ? '周' : p === 'month' ? '月' : '年',
                  p === 'day' ? 'Day' : p === 'week' ? 'Week' : p === 'month' ? 'Month' : 'Year'),
              }))}
              active={placePeriod}
              onSelect={(p) => { setPlacePeriod(p); setPieSel(null); }}
              ariaLabel={L(dict, '时段', 'Period')}
            />

            {placeShare.length === 0 ? (
              <p className="nesio-insights-empty" style={{ marginTop: '1rem' }}>{L(dict, '这段时间还没有地点记录 —— 换个时段看看。', 'No places in this period — try another range.')}</p>
            ) : (
              <>
                {/* 可交互甜甜圈:图例贴在饼里,点扇形高亮 + 中心出详情 */}
                <PlaceDonut
                  segments={placeShare}
                  selected={pieSel}
                  onSelect={setPieSel}
                  centerCount={placeDistinct}
                  centerLabel={L(dict,
                    placePeriod === 'day' ? '今天地点' : placePeriod === 'week' ? '本周地点' : placePeriod === 'month' ? '本月地点' : '本年地点',
                    placePeriod === 'day' ? 'today' : placePeriod === 'week' ? 'this week' : placePeriod === 'month' ? 'this month' : 'this year')}
                  dict={dict}
                />

                {/* 最常去排行(选了类别就只出该类别的地点明细,可点饼图空白复位) */}
                {(() => {
                  const selCat = pieSel as PlaceCategory | null;
                  const rankRows = selCat ? placeRankingAll.filter((c) => c.category === selCat) : placeRanking;
                  if (rankRows.length === 0) return null;
                  const catMeta = selCat ? PLACE_CATEGORY_META[selCat] : null;
                  const periodH = L(dict,
                    placePeriod === 'day' ? '今天最常去' : placePeriod === 'week' ? '这周最常去' : placePeriod === 'month' ? '这个月最常去' : '今年最常去',
                    placePeriod === 'day' ? 'Most visited today' : placePeriod === 'week' ? 'Most visited this week' : placePeriod === 'month' ? 'Most visited this month' : 'Most visited this year');
                  return (
                  <>
                    <p className="nesio-tl-rank-h">{catMeta ? `${L(dict, catMeta.zh, catMeta.en)} · ${L(dict, '最常去', 'most visited')}` : periodH}</p>
                    <div className="nesio-tl-rank">
                      {rankRows.map((c) => (
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
                  );
                })()}
              </>
            )}

            {/* bug3:「按类别浏览 · 点地点可纠正分类」整块按标注删掉 ——
                环形图本身就是按类别的入口(点一块就下钻),这里是重复的第二套。
                纠正分类的入口保留在饼图下钻出来的「最常去」列表里。 */}
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
          {/* bug3:「拖动旋转 · 点一下全屏」这行字删掉 —— 地球本来就会转,点了就全屏 */}
        </div>
      )}
      {sub === 'world' && !worldCountry && worldHighlights.length > 0 && (
        <div className="nesio-globe-hl-strip">
          {worldHighlights.map((h, i) => (
            <div key={h.kicker} className={`nesio-globe-hl-card nesio-globe-hl-card--v${i % 4}`}>
              <span className="nesio-globe-hl-kicker">{h.kicker}</span>
              <span className="nesio-globe-hl-main">{h.main}</span>
              {h.sub ? <span className="nesio-globe-hl-sub">{h.sub}</span> : null}
              {/* bug3:经纬度删掉 —— 「N35°48′ W78°50′」对人没有意义,地名和城市已经在上面两行 */}
            </div>
          ))}
        </div>
      )}
      {/* bug3:「完成的行程」整块按标注删掉 —— 行程走完就是足迹本身,
          不需要在世界页再摆一排 chip(「完成 · 进世界」那颗按钮也一起删了)。 */}

      {/* ── 世界(设计稿④):先国家卡,点 › 进城市明信片 ── */}
      {sub === 'world' && world.length === 0 && (
        <p className="nesio-insights-empty">{L(dict, '还没有国家信息。开着「记忆自动定位」正常使用,地名和国家会随打点自动解析,这里就会按国家聚合。', 'No country data yet. Keep auto-locate on — places and countries resolve as you go, and countries gather here.')}</p>
      )}
      {sub === 'world' && world.length > 0 && !worldCountry && (
        <>
          <div className="nesio-tl-world-headrow">
            <p className="nesio-tl-world-head">
              {L(dict, `去过 ${world.length} 国 · ${world.reduce((n, g) => n + g.cities.length, 0)} 城`, `${world.length} countries · ${world.reduce((n, g) => n + g.cities.length, 0)} cities`)}
            </p>
            <button
              type="button"
              className="nesio-tl-world-share"
              onClick={() => setShareStats(computePlacesShareStats(trail, world.map((g) => g.country)))}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
              </svg>
              {L(dict, '分享', 'Share')}
            </button>
          </div>
          {(() => {
            const first = trail.reduce((a, b) => (new Date(b.ts) < new Date(a.ts) ? b : a), trail[0]);
            const y = new Date(first.ts).getFullYear();
            return Number.isFinite(y) ? <p className="nesio-tl-world-sub">{L(dict, `从 ${y} 到现在`, `From ${y} to now`)}</p> : null;
          })()}
          <div className="nesio-tl-ccards">
            {world.map((g) => {
              const tag = worldCountryTags.get(g.countryKey);
              const name = countryDisplayName(g.countryKey, dict, g.country);
              return (
                <div key={g.countryKey} className="nesio-tl-ccard">
                  <PlacePhoto placeKey={`country:${g.countryKey}`} coords={placeCoords.byCountry.get(g.countryKey) || []} imageNodes={imageNodes} place={{ country: g.countryKey }} timeRanges={placeTimes.byCountry.get(g.countryKey)} onActivate={() => setWorldCountry(g.countryKey)} gradClass={`nesio-tl-cc-g${gradIdx(g.countryKey)}`} className="nesio-tl-ccard-img" dict={dict} />
                  <button type="button" className="nesio-tl-ccard-nav" onClick={() => setWorldCountry(g.countryKey)}>
                    <span className="nesio-tl-ccard-body">
                      <span className="nesio-tl-ccard-name">{name}<small>{L(dict, `${g.cities.length} 城`, `${g.cities.length} cities`)}</small></span>
                      {tag && <span className="nesio-tl-ccard-tag">{tag.text}</span>}
                    </span>
                    <span className="nesio-tl-ccard-chev" aria-hidden>›</span>
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
      {sub === 'world' && worldCountry && (() => {
        const g = world.find((x) => x.countryKey === worldCountry);
        const cities = (g?.cities ?? []).slice().sort((a, b) => b.count - a.count);
        return (
          <>
            <div className="nesio-tl-city-head">
              <button type="button" className="nesio-tl-city-back" onClick={() => setWorldCountry(null)} aria-label={L(dict, '返回', 'Back')}>‹</button>
              <div>
                <div className="nesio-tl-city-title">{countryDisplayName(worldCountry, dict, g?.country)}</div>
                <div className="nesio-tl-city-sub">{L(dict, `${cities.length} 城 · ${g?.placeCount ?? 0} 地`, `${cities.length} cities · ${g?.placeCount ?? 0} places`)}</div>
              </div>
            </div>
            {cities.length === 0 ? (
              <p className="nesio-tl-catplace-more">{L(dict, '(还没解析到城市)', '(no city resolved yet)')}</p>
            ) : (
              <div className="nesio-tl-citycards">
                {cities.map((c) => (
                  <div key={c.city} className="nesio-tl-citycard">
                    <PlacePhoto placeKey={`city:${c.city}`} coords={placeCoords.byCity.get(c.city) || []} imageNodes={imageNodes} place={{ city: c.city }} timeRanges={placeTimes.byCity.get(c.city)} onActivate={() => setVisitMems({ title: c.city, nodes: memsAtCity(c.city) })} gradClass={`nesio-tl-cc-g${gradIdx(c.city)}`} className="nesio-tl-citycard-img" dict={dict}>
                      <span className="nesio-tl-citycard-tag">{L(dict, `${c.count} 个地点`, `${c.count} places`)}</span>
                    </PlacePhoto>
                    <button type="button" className="nesio-tl-citycard-name nesio-tl-citycard-name--btn" onClick={() => setVisitMems({ title: c.city, nodes: memsAtCity(c.city) })}>{c.city}</button>
                  </div>
                ))}
              </div>
            )}
          </>
        );
      })()}

      {/* bug3:底部「共 N 个打点」删掉 —— 上面每一块已经各自报数,这一行只是重复 */}

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

      {/* 足迹成就卡分享(原创卡 + 分享到)—— portal 到 body,不被洞察面板裁切 */}
      {shareStats && typeof document !== 'undefined' && createPortal(
        <PlacesShareSheet stats={shareStats} onClose={() => setShareStats(null)} />,
        document.body,
      )}

      {/* 批次 63:3D 地球全屏;批次 69:真全屏(不透明深空,背后不透出)。W2:NesioSheet 接管壳。 */}
      {globeFull && (
        <NesioSheet
          variant="fullscreen"
          open
          onOpenChange={(next) => { if (!next) setGlobeFull(false); }}
          card={false}
          modal={false}
          className="nesio-globe-fsov"
          ariaLabel={L(dict, '世界', 'World')}
        >
          <p className="nesio-globe-stats">
            {L(dict,
              `${world.length} 国 · ${world.reduce((n, g) => n + g.cities.length, 0)} 城 · ${trail.length} 足迹`,
              `${world.length} countries · ${world.reduce((n, g) => n + g.cities.length, 0)} cities · ${trail.length} footprints`)}
          </p>
          <Globe
            countries={world.map((g) => ({ name: g.country, count: g.placeCount }))}
            size={Math.min(typeof window !== 'undefined' ? window.innerWidth - 16 : 360, typeof window !== 'undefined' ? window.innerHeight - 200 : 520, 600)}
          />
          <span className="nesio-globe-stage-hint">{L(dict, '深色一侧是正处于黑夜的地区', "The shaded side is where it's currently night")}</span>
          <button type="button" className="nesio-memmap-close nesio-globe-fsov-close" onClick={() => setGlobeFull(false)}>✕</button>
        </NesioSheet>
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
            <div className="nesio-vm-grabber" aria-hidden />
            <div className="nesio-vm-head">
              <span className="nesio-vm-title">{visitMems.title}</span>
              <span className="nesio-vm-count">{L(dict, `${visitMems.nodes.length} 条记忆`, `${visitMems.nodes.length} ${visitMems.nodes.length === 1 ? 'memory' : 'memories'}`)}</span>
            </div>
            <div className="nesio-memmap-list-scroll">
              {visitMems.nodes.length === 0 ? (
                <p className="nesio-vm-empty">{L(dict, '这里还没有关联到的记忆', 'No memories linked here yet')}</p>
              ) : visitMems.nodes.map((n) => {
                const src = n.source === 'email' ? L(dict, '邮件', 'Email') : n.source === 'calendar' ? L(dict, '日历', 'Calendar') : n.source === 'photo' ? L(dict, '照片', 'Photo') : n.source === 'voice' ? L(dict, '语音', 'Voice') : n.source === 'system' ? L(dict, '系统', 'System') : L(dict, '手记', 'Note');
                const d = new Date(n.createdAt);
                const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
                const when = d >= midnight
                  ? d.toLocaleTimeString(dict === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
                  : d.toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'numeric', day: 'numeric' });
                return (
                  <button key={n.id} type="button" className="nesio-vm-item" onClick={() => setVisitSel(n)}>
                    <span className="nesio-vm-ic" style={{ ['--vm-ic-bg' as string]: VM_TYPE_BG[n.type] || 'var(--chip-fog)' }}>
                      <NodeTypeIcon type={n.type} size={15} />
                    </span>
                    <span className="nesio-vm-body">
                      <span className="nesio-vm-name">{displayNodeName(n.name, dict)}</span>
                      <span className="nesio-vm-meta">{src} · {when}</span>
                    </span>
                    <span className="nesio-vm-chev" aria-hidden>›</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body,
      )}
      {/* 记忆详情提到顶层:时间线缩略图 / 到访记忆列表两条路径都能点开(自带 Vaul portal)。
          elevated:本页在洞察(fullscreen,z-930)里,详情是 bottom 卡(901)—— 不抬层会被整个盖住。 */}
      {visitSel && <MemoryNodeDetail node={visitSel} elevated onClose={() => setVisitSel(null)} />}

    </div>
  );
}

/** 批次 62:到访时段照片小预览 —— 记忆里带图的,先给两张缩略图(点开进详情)。 */
function VisitThumbs({ nodes, onOpen }: { nodes: LifeNode[]; onOpen: (n: LifeNode) => void }) {
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
          ? <button key={asset.id} type="button" className="nesio-tl-thumb" onClick={() => onOpen(n)} aria-label={n.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={urls[asset.id]} alt="" loading="lazy" />
            </button>
          : null
      ))}
    </div>
  );
}
