'use client';

/**
 * InventorySheet — 原生收纳面板(收纳重建 · 片 2)。
 *
 * 取代静态 /storage/ app 的收纳半边(冲动守卫半边早已原生:冷冻仓/购买冷静流)。
 * 数据 = life-graph object 节点(见 lib/portal/inventory.ts);位置词汇 = named-places
 * (与拍一下识别归位共用同一个 LocationPicker,一套真相,不自建第二套位置表)。
 * 浏览分组从物品 location 首段动态聚合;复用 nesio-freeze-* sheet 骨架样式。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import NesioSheet from './ui/NesioSheet';
import Button from '@/components/portal/ui/Button';
import { relativePastLabel } from '@/lib/portal/time-labels';
import { IconMapPin, IconClock, IconCamera, IconNote, IconBox, IconPlus, IconUpload, IconHanger, IconUtensils, IconFile, IconTrendingUp, IconGift, IconCard } from './icons';
import LocationPicker from './LocationPicker';
import { importInventoryCsv } from '@/lib/portal/inventory-import';
import {
  addInventoryItem,
  amazonSummary,
  buildListingText,
  expiryStatus,
  inventoryStats,
  LOC_SEP,
  parseAmazonFlipCsv,
  removeInventoryItem,
  reviewDueInfo,
  sellPile,
  sortAmazonFlip,
  updateInventoryItem,
  type InventoryItem,
} from '@/lib/portal/inventory';
import { listStorageItems, countPantryItems, countWardrobeItems, storageHeadline } from '@/lib/portal/inventory-visibility';
import SpendClaimRow from './finance/SpendClaimRow';
import SegTabs from './ui/SegTabs';

interface InventorySheetProps {
  open: boolean;
  onClose: () => void;
  /**
   * sheet = 记忆页收纳浮层(默认);
   * page = 洞察「物品」全页 —— 同套功能,列表更高,顶上 KPI,无 sheet 壳。
   */
  variant?: 'sheet' | 'page';
}

const ALL = '__all__';
const UNPLACED = '__unplaced__';

// 批次 179:物品分类改下拉预设 + 自定义(用户实锤「下拉框选项,客户可以自定义」)
const CATEGORY_PRESETS: Array<[string, string]> = [
  ['日用品', 'Household'], ['护肤', 'Skincare'], ['电子', 'Electronics'], ['服饰', 'Apparel'],
  ['食品', 'Food'], ['文具', 'Stationery'], ['工具', 'Tools'], ['药品', 'Meds'],
  ['母婴', 'Baby'], ['收藏', 'Collectible'], ['文件', 'Files'],
];
const CAT_CUSTOM = '__custom__';
// 批次 170:去 emoji —— 位置/分组名里残留的 🏠 等图形字符全清掉(设计:一律线性,无 emoji)
function stripEmoji(s: string): string {
  return s
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * bug2:物品分类由横条列表改成饼图(纯 SVG,无依赖)。类别色走 --viz-1..8(换皮肤跟着变);
 * 前 7 类 + 其余合并「其他」,免得小切片挤成毛刺。图例自带类别名,黑体小标题因此可以撤掉。
 */
const INV_PIE_COLORS = Array.from({ length: 8 }, (_, i) => `var(--viz-${i + 1})`);
function InventoryCategoryPie({ rows, dict }: {
  rows: Array<{ category: string; count: number }>; dict: string;
}) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (!total) return null;
  const top = rows.slice(0, 7);
  const restCount = rows.slice(7).reduce((s, r) => s + r.count, 0);
  const shown = restCount > 0 ? [...top, { category: L(dict, '其他', 'Other'), count: restCount }] : top;
  const R = 52;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const slices = shown.map((r, i) => {
    const pct = (r.count / total) * 100;
    const len = (pct / 100) * C;
    const node = (
      <circle key={r.category} r={R} fill="none" stroke={INV_PIE_COLORS[i % INV_PIE_COLORS.length]}
        strokeWidth="26" strokeLinecap="butt" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} />
    );
    acc += len;
    return { node, pct: Math.round(pct), row: r, color: INV_PIE_COLORS[i % INV_PIE_COLORS.length] };
  });
  return (
    <div style={{ marginTop: 'var(--space-5)' }}>
      {/* 半径 52 + 描边 26 ⇒ 实心饼(内圈归零),不是环 */}
      <svg viewBox="0 0 140 140" width="140" height="140" style={{ display: 'block', margin: '0 auto' }} aria-label={L(dict, '物品分类占比', 'Items by category')}>
        <g transform="translate(70,70) rotate(-90)">{slices.map((s) => s.node)}</g>
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1) var(--space-3)', marginTop: 'var(--space-2)' }}>
        {slices.map((s) => (
          <span key={s.row.category} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', color: 'var(--portal-ink)' }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            {s.row.category}
            <span style={{ color: 'var(--portal-muted)', fontVariantNumeric: 'tabular-nums' }}>{s.row.count} · {s.pct}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function InventorySheet({ open, onClose, variant = 'sheet' }: InventorySheetProps) {
  const isPage = variant === 'page';
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [items, setItems] = useState<InventoryItem[]>([]);
  // 归「做饭 · 库存」的食材件数 —— 只用来在顶上说一句「另有 N 件在那边」,
  // 让「收纳 18 件」和记忆页那个数对得上,而不是让用户猜剩下几件去哪了。
  const [pantryCount, setPantryCount] = useState(0);
  const [wardrobeCount, setWardrobeCount] = useState(0);
  const [groupFilter, setGroupFilter] = useState<string>(ALL);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'add' | 'detail' | 'stats' | 'sell' | 'flip'>('list');
  /** page 变体三栏:总览 / 容器 / 列表(sheet 仍走原 list 流) */
  const [pageTab, setPageTab] = useState<'overview' | 'containers' | 'items'>('overview');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState(''); // 物品②:导入结果可见展示(不静默)
  const fileRef = useRef<HTMLInputElement>(null);
  const smartCamRef = useRef<HTMLInputElement>(null);
  const smartAlbumRef = useRef<HTMLInputElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null); // 物品⑥:复制转卖文案反馈

  // 加物品表单
  const [fName, setFName] = useState('');
  const [fLocation, setFLocation] = useState('');
  const [fQty, setFQty] = useState('');
  const [fExpiry, setFExpiry] = useState('');
  const [fNote, setFNote] = useState('');
  const [fCategory, setFCategory] = useState(''); // 物品①
  const [catCustom, setCatCustom] = useState(false); // 批次 179:分类选了「自定义」→ 显示文本框
  const [fTags, setFTags] = useState('');         // 逗号分隔
  const [fPrice, setFPrice] = useState('');

  // 食材(subtype=食材)归「做饭·库存」那张脸,物品/收纳页排除,免得护照清单里混进菠菜。
  // 判据收在 inventory-visibility(记忆页那个「收纳」球也读它)—— 各写各的正是 22 vs 18 的来源。
  const refresh = () => { setItems(listStorageItems()); setPantryCount(countPantryItems()); setWardrobeCount(countWardrobeItems()); };

  useEffect(() => {
    if (!open && !isPage) return;
    refresh();
    // sheet 每次打开重置;page 内嵌只首次/open 变化时刷新,不强制踢回 list(正在看详情时别被刷走)
    if (!isPage) {
      setView('list');
      setQuery('');
      setGroupFilter(ALL);
      setCategoryFilter(null);
    }
  }, [open, isPage]);

  // 浏览分组:物品 location 首段(场所或自由文本首段)动态聚合
  const groups = useMemo(() => {
    const seen = new Map<string, number>();
    for (const i of items) {
      if (!i.space) continue;
      seen.set(i.space, (seen.get(i.space) || 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const visible = useMemo(() => {
    let list = items;
    if (groupFilter === UNPLACED) list = list.filter((i) => !i.space);
    else if (groupFilter !== ALL) list = list.filter((i) => i.space === groupFilter);
    if (categoryFilter) {
      list = list.filter((i) => (i.category || '').trim() === categoryFilter
        || (categoryFilter === '文件' && /^(文件|Files)$/i.test(i.category || '')));
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((i) =>
        i.name.toLowerCase().includes(q) ||
        i.location.toLowerCase().includes(q) ||
        i.note.toLowerCase().includes(q) ||
        // 标签也进搜索 —— 否则点「亚马逊」标签 chip 筛不出(标签名不在 name/location/note 里)。
        i.tags.some((t) => t.toLowerCase().includes(q)) ||
        i.category.toLowerCase().includes(q) ||
        i.seller.toLowerCase().includes(q) ||
        i.orderNo.toLowerCase().includes(q));
    }
    return list;
  }, [items, groupFilter, categoryFilter, query]);

  const unplacedCount = useMemo(() => items.filter((i) => !i.space).length, [items]);
  const st = useMemo(() => inventoryStats(items), [items]);
  const filesCount = useMemo(
    () => items.filter((i) => /^(文件|Files)$/i.test(i.category || '')).length,
    [items],
  );
  const amazonCount = useMemo(() => items.filter((i) => i.isAmazon).length, [items]);
  const sellCount = useMemo(() => sellPile(items).items.length, [items]);
  /** 容器页:房间 › 容器 › 嵌套(location 里 LOC_SEP 分段) */
  type PlaceNode = { name: string; count: number; space: string; path: string; queryHint: string; children: PlaceNode[] };
  const containerTree = useMemo(() => {
    type Mutable = { name: string; count: number; space: string; path: string; queryHint: string; children: Map<string, Mutable> };
    const roots = new Map<string, Mutable>();
    for (const i of items) {
      if (!i.space) continue;
      const spaceKey = i.space;
      let room = roots.get(spaceKey);
      if (!room) {
        room = {
          name: stripEmoji(i.space) || i.space,
          count: 0,
          space: i.space,
          path: i.space,
          queryHint: '',
          children: new Map(),
        };
        roots.set(spaceKey, room);
      }
      room.count += 1;
      if (!i.container) continue;
      const parts = i.container.split(LOC_SEP).map((s) => s.trim()).filter(Boolean);
      let cur = room;
      const acc: string[] = [];
      for (const part of parts) {
        acc.push(part);
        let child = cur.children.get(part);
        if (!child) {
          child = {
            name: stripEmoji(part) || part,
            count: 0,
            space: i.space,
            path: `${i.space}|${acc.join(LOC_SEP)}`,
            queryHint: part,
            children: new Map(),
          };
          cur.children.set(part, child);
        }
        child.count += 1;
        cur = child;
      }
    }
    const freeze = (n: Mutable): PlaceNode => ({
      name: n.name,
      count: n.count,
      space: n.space,
      path: n.path,
      queryHint: n.queryHint,
      children: [...n.children.values()].map(freeze).sort((a, b) => b.count - a.count),
    });
    return [...roots.values()].map(freeze).sort((a, b) => b.count - a.count);
  }, [items]);
  const [treeOpen, setTreeOpen] = useState<Set<string>>(() => new Set());

  // 批次 170:物品左侧占位符 —— 该物品记忆有图就显示真图(取本机 IndexedDB 图,离线也能看)
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open && !isPage) return;
    let cancelled = false;
    (async () => {
      const { getLocalImage } = await import('@/lib/portal/local-image-store');
      for (const i of visible) {
        if (thumbs[i.id]) continue;
        const asset = (i.node.assets || []).find((a) => a.kind === 'image' || a.mimeType?.startsWith('image/'));
        if (!asset?.id) continue;
        const url = await getLocalImage(asset.id);
        if (url && !cancelled) setThumbs((prev) => ({ ...prev, [i.id]: url }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isPage, visible]);
  const detail = detailId ? items.find((i) => i.id === detailId) ?? null : null;

  if (!open && !isPage) return null;

  const resetForm = () => { setFName(''); setFLocation(''); setFQty(''); setFExpiry(''); setFNote(''); setFCategory(''); setCatCustom(false); setFTags(''); setFPrice(''); };

  // 智能添加:总览 ＋ → 拍照/图库弹出(同今天页),走相机识别成物品。

  // 物品⑥:复制转卖文案(纯模板,不花钱);复制失败降级为可手动复制的弹窗
  const copyListing = async (i: InventoryItem) => {
    const text = buildListingText(i, dict);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(i.id);
      window.setTimeout(() => setCopiedId((cur) => (cur === i.id ? null : cur)), 2000);
    } catch { window.prompt(L(dict, '复制失败,长按手动复制:', 'Copy failed — copy manually:'), text); }
  };

  const submitAdd = () => {
    if (!fName.trim()) return;
    addInventoryItem({
      name: fName,
      location: fLocation || undefined,
      quantity: fQty ? parseInt(fQty, 10) : undefined,
      expiry: fExpiry || undefined,
      note: fNote || undefined,
      category: fCategory || undefined,
      tags: fTags ? fTags.split(/[,,、]/).map((t) => t.trim()).filter(Boolean) : undefined,
      price: fPrice ? parseFloat(fPrice) : undefined,
    });
    resetForm();
    refresh();
    setView('list');
  };

  const label: React.CSSProperties = { display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: 'var(--space-3) 0 var(--space-1)' };

  const onImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      const firstLine = text.split('\n')[0] || '';
      const isAmazon = /美金价格|自付额|Review Status|PayStatus/.test(firstLine);
      if (isAmazon) {
        const parsed = parseAmazonFlipCsv(text);
        const seen = new Set(items.filter((i) => i.isAmazon).map((i) => `${i.name}|${i.arrivedAt || ''}`));
        let imported = 0; let dup = 0;
        for (const it of parsed) {
          const key = `${it.name}|${it.arrivedAt || ''}`;
          if (seen.has(key)) { dup++; continue; }
          seen.add(key);
          addInventoryItem(it);
          imported++;
        }
        refresh();
        setImportMsg(imported > 0
          ? L(dict, `导入 ${imported} 件亚马逊转卖${dup ? ` · 跳过 ${dup} 件重复` : ''}`, `Imported ${imported} Amazon flips${dup ? ` · ${dup} duplicates skipped` : ''}`)
          : L(dict, `没有新增(${dup} 件已在库)`, `Nothing new (${dup} already tracked)`));
        return;
      }
      const r = importInventoryCsv(text);
      refresh();
      const parts = [L(dict, `导入 ${r.imported} 件`, `Imported ${r.imported}`)];
      if (r.skipped) parts.push(L(dict, `跳过 ${r.skipped} 行(缺名称)`, `${r.skipped} skipped (no name)`));
      if (r.errors.length && r.imported === 0) parts.push(r.errors[0]);
      setImportMsg(parts.join(' · '));
    } catch { setImportMsg(L(dict, '导入失败:文件读取出错', 'Import failed: could not read file')); }
  };

  // page 变体:洞察内嵌时不需要 sheet(洞察自己是 fullscreen);sheet 变体仍 elevated 盖住洞察。
  const body = (
    <>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="nesio-visually-hidden" onChange={onImportCsv} />
        {/* 批次 170:去「收纳」标题;统计挪中间上方,方块容器徽章 */}
        <div className="nesio-freeze-header nesio-inv-header">
          {/* 2026-07-29 标注(Bug4 P10):三个统计位改成「物品 / 衣橱 / 食材」三个口径 ——
              原来是「件数 / 估值 / 未归位」+ 一句食材去处,四个 chip 讲的是四件事,
              而用户要的是三类东西各有多少、且各自点得进去。物品数**排除食材与衣服**,
              否则三个数字加起来比总数大,又是一笔对不上的账。 */}
          {/* page 变体用顶栏三 tab,不再挤一排「物品/衣橱/食材」chip */}
          {!isPage && view === 'list' && items.length > 0 ? (
            <div className="nesio-inv-stats">
              <span className="nesio-inv-stat">{st.count} {L(dict, '件物品', 'items')}</span>
              {wardrobeCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="nesio-inv-stat nesio-inv-pantry-link"
                  onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('nesio-open-insights', { detail: { tab: 'wardrobe' } })); }}
                >
                  {L(dict, `${wardrobeCount} 件衣橱`, `${wardrobeCount} in wardrobe`)}
                </Button>
              )}
              {pantryCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="nesio-inv-stat nesio-inv-pantry-link"
                  onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('nesio-open-cooking')); }}
                >
                  {L(dict, `${pantryCount} 件食材`, `${pantryCount} ingredients`)}
                </Button>
              )}
              {filesCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="nesio-inv-stat nesio-inv-pantry-link"
                  onClick={() => { setCategoryFilter('文件'); setQuery(''); setGroupFilter(ALL); }}
                >
                  {L(dict, `${filesCount} 件文件`, `${filesCount} files`)}
                </Button>
              )}
            </div>
          ) : <span />}
          {!isPage || view !== 'list' ? (
            <Button type="button" variant="ghost" size="sm" className="nesio-freeze-close nesio-inv-close" onClick={view === 'list' ? onClose : () => { setView('list'); setDetailId(null); }}>
              {view === 'list' ? '✕' : '‹'}
            </Button>
          ) : <span />}
        </div>

        {/* page · 总览:KPI + 入口(去重文案/统一按钮) */}
        {isPage && view === 'list' && pageTab === 'overview' && (
          <div className="nesio-inv-overview" style={{ overflowY: 'auto', paddingBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 'var(--space-2)' }}>
              <Button type="button" variant="soft" size="sm" pill={false} aria-label={L(dict, '智能添加', 'Smart add')}
                onClick={() => { resetForm(); setView('add'); }}
                layoutStyle={{ width: 36, height: 36 }}
                iconLeft={<IconPlus size={18} />} />
              <Button type="button" variant="secondary" size="sm" pill={false} aria-label={L(dict, '导入 CSV', 'Import CSV')}
                onClick={() => fileRef.current?.click()}
                layoutStyle={{ width: 36, height: 36 }}
                iconLeft={<IconUpload size={18} />} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              <Button type="button" variant="secondary" size="sm" full
                aria-label={L(dict, '物品', 'Items')}
                onClick={() => setPageTab('items')}
                iconLeft={<IconBox size={16} />}>
                {st.count}
              </Button>
              <Button type="button" variant="secondary" size="sm" full
                aria-label={L(dict, '估值', 'Value')}
                onClick={() => setView('stats')}
                iconLeft={<span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>$</span>}>
                {Math.round(st.totalValue).toLocaleString('en-US')}
              </Button>
              <Button type="button" variant="secondary" size="sm" full
                aria-label={L(dict, '未归位', 'Unplaced')}
                onClick={() => { setGroupFilter(UNPLACED); setPageTab('items'); }}
                iconLeft={<IconMapPin size={16} />}>
                <span style={unplacedCount > 0 ? { color: 'var(--status-gentle)' } : undefined}>{unplacedCount}</span>
              </Button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 'var(--space-3)' }}>
              {wardrobeCount > 0 && (
                <Button type="button" variant="secondary" size="sm" full
                  aria-label={L(dict, '衣橱', 'Wardrobe')}
                  onClick={() => { window.dispatchEvent(new CustomEvent('nesio-open-insights', { detail: { tab: 'wardrobe' } })); }}
                  iconLeft={<IconHanger size={16} />}>
                  {wardrobeCount}
                </Button>
              )}
              {pantryCount > 0 && (
                <Button type="button" variant="secondary" size="sm" full
                  aria-label={L(dict, '食材', 'Pantry')}
                  onClick={() => { window.dispatchEvent(new CustomEvent('nesio-open-cooking')); }}
                  iconLeft={<IconUtensils size={16} />}>
                  {pantryCount}
                </Button>
              )}
              {filesCount > 0 && (
                <Button type="button" variant="secondary" size="sm" full
                  aria-label={L(dict, '文件', 'Files')}
                  onClick={() => { setCategoryFilter('文件'); setQuery(''); setGroupFilter(ALL); setPageTab('items'); }}
                  iconLeft={<IconFile size={16} />}>
                  {filesCount}
                </Button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 'var(--space-3)' }}>
              <Button type="button" variant="secondary" size="sm" full
                aria-label={L(dict, '亚马逊', 'Amazon')}
                onClick={() => { setView('flip'); }}
                iconLeft={<IconCard size={16} />}>
                {amazonCount}
              </Button>
              <Button type="button" variant="secondary" size="sm" full
                aria-label={L(dict, '统计', 'Stats')}
                onClick={() => setView('stats')}
                iconLeft={<IconTrendingUp size={16} />}>
                {st.byCategory.length}
              </Button>
              <Button type="button" variant="secondary" size="sm" full
                aria-label={L(dict, '卖闲置', 'Sell pile')}
                onClick={() => setView('sell')}
                iconLeft={<IconGift size={16} />}>
                {sellCount}
              </Button>
            </div>
            {importMsg && <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textAlign: 'center' }}>{importMsg}</p>}
            {st.byCategory.length > 0 && <InventoryCategoryPie rows={st.byCategory} dict={dict} />}
          </div>
        )}

        {/* page · 容器:房间 › 容器 › 嵌套树 */}
        {isPage && view === 'list' && pageTab === 'containers' && (() => {
          const renderNode = (node: PlaceNode, depth: number) => {
            const hasKids = node.children.length > 0;
            const open = treeOpen.has(node.path);
            return (
              <div key={node.path}>
                <div style={{ display: 'flex', alignItems: 'stretch', marginLeft: depth * 12, gap: 4 }}>
                  {hasKids ? (
                    <Button type="button" variant="ghost" size="sm" pill={false} aria-expanded={open} aria-label={open ? L(dict, '收起', 'Collapse') : L(dict, '展开', 'Expand')}
                      onClick={() => setTreeOpen((prev) => {
                        const next = new Set(prev);
                        if (next.has(node.path)) next.delete(node.path);
                        else next.add(node.path);
                        return next;
                      })}
                      layoutStyle={{ width: 28, minWidth: 28 }}>
                      {open ? '▾' : '›'}
                    </Button>
                  ) : <span style={{ width: 28 }} />}
                  <Button type="button" variant={depth === 0 ? 'soft' : 'secondary'} size="sm" full align="between"
                    onClick={() => {
                      setGroupFilter(node.space);
                      setQuery(node.queryHint);
                      setPageTab('items');
                    }}>
                    <span style={{ fontWeight: depth === 0 ? 600 : 500 }}>{node.name}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--portal-muted)' }}>{node.count}</span>
                  </Button>
                </div>
                {hasKids && open && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                    {node.children.map((c) => renderNode(c, depth + 1))}
                  </div>
                )}
              </div>
            );
          };
          return (
            <div style={{ overflowY: 'auto' }}>
              {unplacedCount > 0 && (
                <Button type="button" variant="secondary" size="sm" full align="between" onClick={() => { setGroupFilter(UNPLACED); setPageTab('items'); }}
                  layoutStyle={{ marginBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>{L(dict, '未归位', 'Unplaced')}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{unplacedCount}</span>
                </Button>
              )}
              {containerTree.length === 0 ? (
                <p className="nesio-freeze-empty" style={{ padding: 'var(--space-6) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  {L(dict, '还没有归位到容器的物品。到列表里点开一件设位置即可。', 'Nothing in a container yet — open an item in the list and set a place.')}
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {containerTree.map((n) => renderNode(n, 0))}
                </div>
              )}
            </div>
          );
        })()}

        {view === 'list' && (!isPage || pageTab === 'items') && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 'var(--space-2) 0' }}>
              <input
                className="nesio-ob-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder=""
                style={{ flex: 1, margin: 0 }}
              />
              <Button type="button" variant="soft" size="sm" pill={false} aria-label={L(dict, '记一件', 'Add one')}
                onClick={() => { resetForm(); setView('add'); }}
                layoutStyle={{ flexShrink: 0, width: 36, height: 36 }}
                iconLeft={<IconPlus size={18} />} />
              <Button type="button" variant="secondary" size="sm" pill={false} aria-label={L(dict, '导入 CSV', 'Import CSV')}
                onClick={() => fileRef.current?.click()}
                layoutStyle={{ flexShrink: 0, width: 36, height: 36 }}
                iconLeft={<IconUpload size={18} />} />
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: 'var(--space-1) 0 var(--space-2)' }}>
              <select
                className="nesio-ob-input"
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                aria-label={L(dict, '位置', 'Place')}
                style={{ flex: 1, minWidth: 120, margin: 0 }}
              >
                <option value={ALL}>{L(dict, '全部位置', 'All places')} ({items.length})</option>
                {groups.map(([name, n]) => (
                  <option key={name} value={name}>{stripEmoji(name) || name} ({n})</option>
                ))}
                {unplacedCount > 0 && (
                  <option value={UNPLACED}>{L(dict, '未归位', 'Unplaced')} ({unplacedCount})</option>
                )}
              </select>
              <select
                className="nesio-ob-input"
                value={categoryFilter || ''}
                onChange={(e) => setCategoryFilter(e.target.value || null)}
                aria-label={L(dict, '分类', 'Category')}
                style={{ flex: 1, minWidth: 120, margin: 0 }}
              >
                <option value="">{L(dict, '全部分类', 'All categories')}</option>
                {CATEGORY_PRESETS.map(([zh, en]) => (
                  <option key={zh} value={zh}>{L(dict, zh, en)}</option>
                ))}
                {categoryFilter && !CATEGORY_PRESETS.some(([zh]) => zh === categoryFilter) && (
                  <option value={categoryFilter}>{categoryFilter}</option>
                )}
              </select>
              {!isPage && (
                <select
                  className="nesio-ob-input"
                  value=""
                  aria-label={L(dict, '更多', 'More')}
                  onChange={(e) => {
                    const v = e.target.value;
                    e.target.value = '';
                    if (v === 'stats') setView('stats');
                    else if (v === 'sell') setView('sell');
                    else if (v === 'flip') setView('flip');
                  }}
                  style={{ width: 'auto', margin: 0 }}
                >
                  <option value="">{L(dict, '更多…', 'More…')}</option>
                  <option value="stats">{L(dict, '统计', 'Stats')}</option>
                  <option value="sell">{L(dict, '卖闲置', 'Sell pile')}</option>
                  {items.some((i) => i.isAmazon) && (
                    <option value="flip">{L(dict, '亚马逊转卖', 'Amazon flip')}</option>
                  )}
                </select>
              )}
            </div>

            {visible.length === 0 ? (
              <p className="nesio-freeze-empty" style={{ padding: 'var(--space-6) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                {query
                  ? L(dict, '没找到。换个词试试?', 'Nothing found. Try another word?')
                  : L(dict, '还没有物品。点右上角 ＋ 记一件,或用「拍一下」识别。', 'No items yet. Tap ＋ to add one, or snap a photo to recognize.')}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: isPage ? undefined : '44vh', overflowY: 'auto', flex: isPage ? 1 : undefined, paddingBottom: 4 }}>
                {visible.map((i) => {
                  const exp = expiryStatus(i);
                  const src = i.node.source === 'photo' ? L(dict, '拍照', 'Photo') : i.node.source === 'email' ? L(dict, '邮件', 'Email') : L(dict, '手记', 'Note');
                  const updated = relativePastLabel(i.node.createdAt, Date.now(), dict);
                  return (
                    <button
                      key={i.id}
                      type="button"
                      onClick={() => { setDetailId(i.id); setView('detail'); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', width: '100%',
                        padding: 'var(--space-2) var(--space-3)', borderRadius: 14,
                        border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
                        background: 'var(--glass-bg, rgba(255,255,255,0.04))', color: 'var(--text-primary)',
                      }}
                    >
                      {thumbs[i.id] ? (
                        <img src={thumbs[i.id]} alt={i.name} aria-hidden draggable={false} style={{
                          flexShrink: 0, width: 46, height: 46, borderRadius: 11, objectFit: 'cover',
                        }} />
                      ) : (
                        <span aria-hidden style={{
                          flexShrink: 0, width: 46, height: 46, borderRadius: 11,
                          background: 'var(--portal-line, rgba(0,0,0,0.06))',
                          display: 'grid', placeItems: 'center', color: 'var(--portal-muted)',
                        }}><IconBox size={22} /></span>
                      )}
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontSize: 'var(--text-body)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {i.name}{i.quantity != null ? ` ×${i.quantity}` : ''}
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', color: i.location ? 'var(--text-secondary)' : 'var(--status-gentle)' }}>
                          <IconMapPin size={12} />
                          {(i.location && stripEmoji(i.location)) || i.location || L(dict, '未归位 · 点开设位置', 'Unplaced · tap to set')}
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                          <IconClock size={12} />
                          {L(dict, `${updated}更新`, `updated ${updated}`)} · {src}
                        </span>
                      </span>
                      {exp && (
                        <span style={{ flexShrink: 0, fontSize: 'var(--text-overline)', color: exp === 'expired' ? 'var(--status-risk)' : 'var(--status-gentle)' }}>
                          {exp === 'expired' ? L(dict, '已过期', 'Expired') : L(dict, '临期', 'Expiring')}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {importMsg && <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textAlign: 'center' }}>{importMsg}</p>}
          </>
        )}

        {view === 'add' && (
          // 批次 179:键盘弹起时底部让出 --kb-inset,焦点输入可滚到键盘上方(修物品表单键盘漂移)
          <div style={{ maxHeight: '58vh', overflowY: 'auto', paddingBottom: 'var(--kb-inset, 0px)' }}>
            {/* 智能添加:拍照 / 图库 → 相机识别成物品;手填表单仍在下面。 */}
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              <Button type="button" variant="soft" size="sm" full
                onClick={() => smartCamRef.current?.click()}
                iconLeft={<IconCamera size={14} />}>
                {L(dict, '拍照识别', 'Snap to recognize')}
              </Button>
              <Button type="button" variant="secondary" size="sm" full
                onClick={() => smartAlbumRef.current?.click()}
                iconLeft={<IconUpload size={14} />}>
                {L(dict, '从相册', 'From album')}
              </Button>
            </div>
            <input ref={smartCamRef} type="file" accept="image/*" capture="environment" className="nesio-visually-hidden"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                if (!f) return;
                try { window.dispatchEvent(new CustomEvent('nesio-open-camera', { detail: { file: f } })); } catch { /* ignore */ }
                setView('list');
              }} />
            <input ref={smartAlbumRef} type="file" accept="image/*" className="nesio-visually-hidden"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                if (!f) return;
                try { window.dispatchEvent(new CustomEvent('nesio-open-camera', { detail: { file: f } })); } catch { /* ignore */ }
                setView('list');
              }} />
            <label style={label}>{L(dict, '物品名', 'Item name')}</label>
            <input className="nesio-ob-input" value={fName} onChange={(e) => setFName(e.target.value)} placeholder={L(dict, '例:护照、备用钥匙、维生素 D3', 'e.g. passport, spare keys, vitamin D3')} />
            <label style={label}>{L(dict, '放哪了?(和拍一下识别同一套位置)', 'Where does it live? (same places as Snap)')}</label>
            <LocationPicker value={fLocation} onChange={setFLocation} />
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={label}>{L(dict, '数量(可选)', 'Qty (optional)')}</label>
                <input className="nesio-ob-input" inputMode="numeric" value={fQty} onChange={(e) => setFQty(e.target.value.replace(/[^0-9]/g, ''))} />
              </div>
              <div style={{ flex: 1.4 }}>
                <label style={label}>{L(dict, '效期(可选)', 'Expiry (optional)')}</label>
                <input className="nesio-ob-input" type="date" value={fExpiry} onChange={(e) => setFExpiry(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1.2 }}>
                <label style={label}>{L(dict, '分类(可选)', 'Category (optional)')}</label>
                {(() => {
                  const isPreset = CATEGORY_PRESETS.some(([zh]) => zh === fCategory);
                  const showCustom = catCustom || (!!fCategory && !isPreset);
                  return (
                    <>
                      <select
                        className="nesio-ob-input"
                        value={showCustom ? CAT_CUSTOM : fCategory}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === CAT_CUSTOM) { setCatCustom(true); setFCategory(''); }
                          else { setCatCustom(false); setFCategory(v); }
                        }}
                      >
                        <option value="">{L(dict, '未分类', 'None')}</option>
                        {CATEGORY_PRESETS.map(([zh, en]) => (
                          <option key={zh} value={zh}>{L(dict, zh, en)}</option>
                        ))}
                        <option value={CAT_CUSTOM}>{L(dict, '自定义…', 'Custom…')}</option>
                      </select>
                      {showCustom && (
                        <input
                          className="nesio-ob-input"
                          style={{ marginTop: 6 }}
                          value={fCategory}
                          onChange={(e) => setFCategory(e.target.value)}
                          placeholder={L(dict, '自定义分类', 'Custom category')}
                        />
                      )}
                    </>
                  );
                })()}
              </div>
              <div style={{ flex: 1 }}>
                <label style={label}>{L(dict, '估值 $(可选)', 'Value $ (optional)')}</label>
                <input className="nesio-ob-input" inputMode="decimal" value={fPrice} onChange={(e) => setFPrice(e.target.value.replace(/[^0-9.]/g, ''))} />
              </div>
            </div>
            <label style={label}>{L(dict, '标签(逗号分隔,可选)', 'Tags (comma separated, optional)')}</label>
            <input className="nesio-ob-input" value={fTags} onChange={(e) => setFTags(e.target.value)} placeholder="" />
            <label style={label}>{L(dict, '备注(可选)', 'Note (optional)')}</label>
            <input className="nesio-ob-input" value={fNote} onChange={(e) => setFNote(e.target.value)} placeholder={L(dict, '例:被压在护手霜下面', 'e.g. under the hand cream')} />
            <Button type="button" variant="primary" size="sm" full disabled={!fName.trim()} onClick={submitAdd}
              layoutStyle={{ marginTop: 'var(--space-4)' }}>
              {L(dict, '存进收纳', 'Save to storage')}
            </Button>
          </div>
        )}

        {/* ── 物品①:库存统计 Dashboard(设计 token 全量;KPI / 归位进度 / 分类 / 标签 / 处理中)── */}
        {view === 'stats' && (() => {
          if (items.length === 0) {
            return <p style={{ padding: 'var(--space-8) 0', textAlign: 'center', color: 'var(--portal-muted)' }}>{L(dict, '还没有物品,统计会随记录自动出现。', 'No items yet — stats appear as you add.')}</p>;
          }
          const st = inventoryStats(items);
          const headline = storageHeadline(items);
          const totalItems = headline.rows;
          const unplaced = items.filter((i) => !i.space).length;
          const placed = totalItems - unplaced;
          const placedPct = totalItems ? Math.round((placed / totalItems) * 100) : 0;

          const card: React.CSSProperties = { borderRadius: 'var(--radius-md)', border: '1px solid var(--portal-line)', background: 'var(--portal-accent-soft)', padding: 'var(--space-4)' };
          const kv: React.CSSProperties = { display: 'block', fontSize: 'var(--text-h2)', fontWeight: 'var(--weight-bold)', color: 'var(--portal-ink)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' };
          const kl: React.CSSProperties = { display: 'block', marginTop: 'var(--space-1)', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' };
          const sectionLbl: React.CSSProperties = { margin: 'var(--space-5) 0 var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' };

          return (
            <div style={{ maxHeight: '64vh', overflowY: 'auto', paddingBottom: 'var(--space-4)' }}>
              {/* 概览:物品 / 估值 / 未归位(未归位>0 时用琥珀提示,不用红色制造焦虑) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
                {/* #15:门面上的数 = 你点进去会看到的行数。Σ 数量(一盒 5 支笔算 5)是附加信息,
                    只在两者不同时补一句,不抢主位 —— 两个数共用一个「件」字,就是 22 vs 18 的由来。 */}
                <div style={card}>
                  <span style={kv}>{totalItems}</span>
                  <span style={kl}>{L(dict, '物品', 'Items')}</span>
                  {headline.pieces !== headline.rows && (
                    <span style={kl}>{L(dict, `共 ${headline.pieces} 个`, `${headline.pieces} pieces`)}</span>
                  )}
                </div>
                <div style={card}><span style={kv}>${Math.round(st.totalValue).toLocaleString('en-US')}</span><span style={kl}>{L(dict, '估值', 'Est. value')}</span></div>
                <div style={{ ...card, ...(unplaced > 0 ? { background: 'var(--status-gentle-soft)', borderColor: 'transparent' } : {}) }}>
                  <span style={{ ...kv, ...(unplaced > 0 ? { color: 'var(--status-gentle)' } : {}) }}>{unplaced}</span>
                  <span style={kl}>{L(dict, '未归位', 'Unplaced')}</span>
                </div>
              </div>

              {/* 归位进度条 */}
              <p style={{ ...sectionLbl, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span>{L(dict, '归位进度', 'Placement')}</span>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--status-go)', fontVariantNumeric: 'tabular-nums' }}>{placedPct}%</span>
              </p>
              <div style={{ height: 10, borderRadius: 'var(--radius-pill)', background: 'var(--status-gentle-soft)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${placedPct}%`, background: 'var(--status-go)', borderRadius: 'var(--radius-pill)' }} />
              </div>
              <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
                {L(dict, `已归位 ${placed} · 未归位 ${unplaced} · ${st.spaces} 个空间 · ${st.containers} 个容器`, `${placed} placed · ${unplaced} unplaced · ${st.spaces} spaces · ${st.containers} bins`)}
              </p>

              {/* bug2:分类横条 → 饼图,「按分类」黑体小标题删掉(饼图自带图例) */}
              {st.byCategory.length > 0 && <InventoryCategoryPie rows={st.byCategory} dict={dict} />}

              {/* bug2:「常用标签」「在处理」两节按图注删除 */}
            </div>
          );
        })()}

        {/* ── 物品③:卖闲置堆(对标 Build a sell pile:hero 合计 + 列表) ── */}
        {view === 'sell' && (() => {
          const sp = sellPile(items);
          return (
            <div style={{ maxHeight: '58vh', overflowY: 'auto' }}>
              <div style={{ borderRadius: 14, padding: 'var(--space-4)', textAlign: 'center', background: 'var(--glass-bg, rgba(255,255,255,0.05))', border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))' }}>
                <span style={{ display: 'block', fontSize: 'var(--text-h1)', fontWeight: 700 }}>${sp.totalValue.toLocaleString('en-US')}</span>
                <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  {sp.items.length
                    ? L(dict, `这堆闲置约值这么多(${sp.items.length} 件)—— 挂出去就是零花钱`, `Your sell pile (${sp.items.length} items) — list them and it's pocket money`)
                    : L(dict, '还没有标记出售的物品', 'Nothing marked for sale yet')}
                </span>
              </div>
              {sp.items.length === 0 ? (
                <p style={{ padding: 'var(--space-5) 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
                  {L(dict, '在物品详情里点「标记出售」,它就会进到这里,估值自动累计。', 'Tap "Mark for sale" on any item — it lands here and the total grows.')}
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 'var(--space-3)' }}>
                  {sp.items.map((i) => (
                    <div key={i.id} style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                      <button type="button" onClick={() => { setDetailId(i.id); setView('detail'); }}
                        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))', background: 'var(--glass-bg, rgba(255,255,255,0.04))', color: 'var(--text-primary)' }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name}{i.quantity != null ? ` ×${i.quantity}` : ''}</span>
                          <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{i.location || L(dict, '未归位', 'Unplaced')}</span>
                        </span>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{i.price != null ? `$${(i.price * (i.quantity && i.quantity > 0 ? i.quantity : 1)).toLocaleString('en-US')}` : L(dict, '未估值', 'no est.')}</span>
                      </button>
                      {/* 物品⑥:一键复制转卖文案(纯模板),贴去闲鱼/FB Marketplace */}
                      <Button type="button" variant={copiedId === i.id ? 'soft' : 'secondary'} size="sm" onClick={() => copyListing(i)}
                        layoutStyle={{ flexShrink: 0 }}>
                        {copiedId === i.id ? `✓ ${L(dict, '已复制', 'Copied')}` : L(dict, '复制文案', 'Copy ad')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {view === 'flip' && (() => {
          const flip = sortAmazonFlip(items);
          const sum = amazonSummary(items);
          const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
          const badge = (i: InventoryItem) => {
            const d = reviewDueInfo(i);
            const map: Record<string, [string, string, string]> = {
              exempt: [L(dict, '免评', 'No review'), 'var(--status-calm)', 'var(--status-calm-soft)'],
              done: [L(dict, '已评', 'Reviewed'), 'var(--status-go)', 'var(--status-go-soft)'],
              due: [L(dict, '该评论了', 'Review now'), 'var(--status-gentle)', 'var(--status-gentle-soft)'],
              waiting: [L(dict, `${d.daysLeft} 天后可评`, `Review in ${d.daysLeft}d`), 'var(--portal-muted)', 'transparent'],
              not_arrived: [L(dict, '未到货', 'Not arrived'), 'var(--portal-muted)', 'transparent'],
            };
            const [text, color, bg] = map[d.status];
            return <span style={{ fontSize: 'var(--text-overline)', fontWeight: 600, color, background: bg, padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-pill, 999px)', whiteSpace: 'nowrap' }}>{text}</span>;
          };
          return (
            <div style={{ maxHeight: '58vh', overflowY: 'auto' }}>
              {/* 汇总:总自付 / 返现 / 已售利润 / 在库·已售 / 待评 */}
              {(() => {
                const lbl = (v: string, k: string, color?: string) => (
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 64 }}>
                    <b style={{ fontSize: 'var(--text-h3)', color }}>{v}</b>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-overline)' }}>{k}</span>
                  </span>
                );
                return (
                  <div style={{ borderRadius: 14, padding: 'var(--space-4) var(--space-4)', background: 'var(--glass-bg, rgba(255,255,255,0.05))', border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3) var(--space-5)' }}>
                    {lbl(fmt(sum.grossSpent), L(dict, '花销(含税)', 'Spent'))}
                    {lbl(fmt(sum.rebateTotal), L(dict, '返钱', 'Rebate'))}
                    {lbl(fmt(sum.realizedProfit), L(dict, '收益(已售)', 'Profit'), sum.realizedProfit >= 0 ? 'var(--status-go)' : 'var(--status-risk)')}
                    {lbl(`${sum.inStock}/${sum.sold}`, L(dict, '在库/已售', 'stock/sold'))}
                    {sum.reviewDue > 0 && lbl(String(sum.reviewDue), L(dict, '该评论', 'to review'), 'var(--status-gentle)')}
                  </div>
                );
              })()}
              <p style={{ margin: '0.6rem 2px 0.4rem', fontSize: 'var(--text-overline)', color: 'var(--text-tertiary)' }}>
                {L(dict, '免评置顶 · 其余按到货日排 · 到货约 10 天提醒留评', 'No-review on top · rest by arrival · review reminder ~10d after arrival')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 4 }}>
                {flip.map((i) => (
                  <button key={i.id} type="button" onClick={() => { setDetailId(i.id); setView('detail'); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))', background: 'var(--glass-bg, rgba(255,255,255,0.04))', color: 'var(--text-primary)' }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name}</span>
                      <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {i.arrivedAt ? L(dict, `到货 ${i.arrivedAt}`, `Arrived ${i.arrivedAt}`) : i.orderedAt ? L(dict, `下单 ${i.orderedAt}`, `Ordered ${i.orderedAt}`) : L(dict, '无日期', 'no date')}
                        {i.sold && i.profit != null ? ` · ${L(dict, '盈利', 'profit')} ${fmt(i.profit)}` : ''}
                      </span>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{i.outOfPocket != null ? fmt(i.outOfPocket) : (i.buyPrice != null ? fmt(i.buyPrice) : '—')}</span>
                      {badge(i)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {view === 'detail' && detail && (
          <ItemDetail
            item={detail}
            dict={dict}
            label={label}
            onChanged={refresh}
            onDeleted={() => { refresh(); setView('list'); setDetailId(null); }}
            onSaved={() => { refresh(); setView('list'); setDetailId(null); }}
          />
        )}
    </>
  );

  if (isPage) {
    return (
      <div className="nesio-inv-page nesio-analytics-tab">
        {(view === 'list' || view === 'stats' || view === 'sell' || view === 'flip') && (
          <SegTabs
            size="sm"
            ariaLabel={L(dict, '物品分区', 'Inventory sections')}
            active={pageTab}
            onSelect={(k) => {
              setPageTab(k);
              setView('list');
              setDetailId(null);
            }}
            items={[
              { key: 'overview' as const, label: L(dict, '总览', 'Overview') },
              { key: 'containers' as const, label: L(dict, '容器', 'Bins') },
              { key: 'items' as const, label: L(dict, '列表', 'List') },
            ]}
          />
        )}
        <div style={{ marginTop: 'var(--space-3)' }}>{body}</div>
      </div>
    );
  }

  return (
    <NesioSheet
      variant="bottom"
      elevated
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      card={false}
      className="nesio-freeze-sheet"
      ariaLabel={L(dict, '收纳', 'Storage')}
    >
      {body}
    </NesioSheet>
  );
}

function ItemDetail({ item, dict, label, onChanged, onDeleted, onSaved }: {
  item: InventoryItem;
  dict: ReturnType<typeof portalLocaleToDictionaryLocale>;
  label: React.CSSProperties;
  onChanged: () => void;
  onDeleted: () => void;
  onSaved: () => void;
}) {
  const attachRef = useRef<HTMLInputElement>(null);
  const [saveMsg, setSaveMsg] = useState<'idle' | 'ok' | 'err'>('idle');
  const [attachErr, setAttachErr] = useState('');
  const [attachBusy, setAttachBusy] = useState(false);
  const [location, setLocation] = useState(item.location);
  const [qty, setQty] = useState(item.quantity != null ? String(item.quantity) : '');
  const [expiry, setExpiry] = useState(item.expiry ?? '');
  const [note, setNote] = useState(item.note);
  const [category, setCategory] = useState(item.category);
  const [catCustom, setCatCustom] = useState(() => {
    const isPreset = CATEGORY_PRESETS.some(([zh]) => zh === item.category);
    return !!item.category && !isPreset;
  });
  const [tags, setTags] = useState(item.tags.join(', '));
  const initialPrice = item.buyPrice != null ? String(item.buyPrice) : (item.price != null ? String(item.price) : '');
  const [price, setPrice] = useState(initialPrice);
  const [amzOpen, setAmzOpen] = useState(item.isAmazon);
  const [orderNo, setOrderNo] = useState(item.orderNo);
  const [seller, setSeller] = useState(item.seller);
  const [keywords, setKeywords] = useState(item.keywords);
  const [tax, setTax] = useState(item.tax != null ? String(item.tax) : '');
  const [orderedAt, setOrderedAt] = useState(item.orderedAt ?? '');
  const [arrivedAt, setArrivedAt] = useState(item.arrivedAt ?? '');
  const [rebate, setRebate] = useState(item.rebate != null ? String(item.rebate) : '');
  const [resalePrice, setResalePrice] = useState(item.resalePrice != null ? String(item.resalePrice) : '');
  const [rebateReceived, setRebateReceived] = useState(item.rebateReceived);
  const [reviewDone, setReviewDone] = useState(item.reviewDone);
  const [reviewExempt, setReviewExempt] = useState(item.reviewExempt);
  const [sold, setSold] = useState(item.sold);
  const [assetTick, setAssetTick] = useState(0);
  const exp = expiryStatus(item);

  const nOrNull = (s: string) => (s ? parseFloat(s) : (null as unknown as number | undefined));
  const priceNum = parseFloat(price);
  const oop = Number.isFinite(priceNum)
    ? Math.round((priceNum - (parseFloat(rebate) || 0)) * 100) / 100
    : null;
  const rspNum = parseFloat(resalePrice);
  const profit = Number.isFinite(rspNum) && oop != null ? Math.round((rspNum - oop) * 100) / 100 : null;
  const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const claimPrice = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : 0;
  const claimDate = orderedAt || arrivedAt || new Date().toISOString().slice(0, 10);

  const chip = (on: boolean, toggle: () => void, text: string) => (
    <Button type="button" variant={on ? 'soft' : 'ghost'} size="sm" onClick={toggle}>
      {on ? `✓ ${text}` : text}
    </Button>
  );

  const assets = useMemo(() => {
    void assetTick;
    return item.node.assets || [];
  }, [item.node.assets, assetTick]);

  const save = () => {
    let ok = false;
    const priceVal = nOrNull(price);
    try {
      ok = updateInventoryItem(item.id, {
        location,
        quantity: qty ? parseInt(qty, 10) : null as unknown as number | undefined,
        expiry,
        note,
        category,
        tags: tags.split(/[,,、]/).map((t) => t.trim()).filter(Boolean),
        price: priceVal,
        buyPrice: amzOpen ? priceVal : undefined,
        isAmazon: amzOpen,
        orderNo, seller, keywords,
        tax: nOrNull(tax), orderedAt, arrivedAt,
        rebate: nOrNull(rebate), resalePrice: nOrNull(resalePrice),
        rebateReceived, reviewDone, reviewExempt, sold,
      });
    } catch {
      ok = false;
    }
    if (ok) {
      onChanged();
      setSaveMsg('ok');
      setTimeout(() => onSaved(), 550);
    } else {
      setSaveMsg('err');
    }
  };

  const onAttachFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setAttachErr('');
    setAttachBusy(true);
    try {
      const { compressToDataUrl } = await import('@/lib/portal/local-image-store');
      const { attachPhotoToMemoryNode } = await import('@/lib/portal/capture-pipeline');
      const { putLocalFile, MAX_FILE_BYTES, prettyBytes } = await import('@/lib/portal/local-file-store');
      const { updateLifeNode, getLifeGraph } = await import('@/lib/portal/life-graph');
      let okCount = 0;
      const failed: string[] = [];
      for (const f of Array.from(files).slice(0, 8)) {
        if (f.size > MAX_FILE_BYTES) { failed.push(`${f.name}(${prettyBytes(f.size)})`); continue; }
        if (f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(f.name)) {
          const dataUrl = await compressToDataUrl(f, 1400, 0.82);
          if (!dataUrl) { failed.push(f.name); continue; }
          const r = await attachPhotoToMemoryNode({ nodeId: item.id, dataUrl, kind: 'memory', label: f.name });
          if (r) okCount += 1; else failed.push(f.name);
        } else {
          const id = `localfile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const mimeType = f.type || 'application/octet-stream';
          const stored = await putLocalFile(id, f, { name: f.name, mimeType, size: f.size });
          if (!stored) { failed.push(f.name); continue; }
          const live = getLifeGraph().find((n) => n.id === item.id);
          const merged = [...(live?.assets || []), {
            id, kind: 'file' as const, local: true, mimeType, label: f.name, createdAt: new Date().toISOString(),
          }];
          updateLifeNode(item.id, { assets: merged });
          okCount += 1;
        }
      }
      if (okCount) { setAssetTick((v) => v + 1); onChanged(); }
      if (failed.length) {
        setAttachErr(L(dict, `有 ${failed.length} 个没存上: ${failed.slice(0, 2).join(', ')}`, `${failed.length} couldn’t save: ${failed.slice(0, 2).join(', ')}`));
      }
    } catch {
      setAttachErr(L(dict, '附件没存进去 —— 再试一次', "Couldn't save attachment — try again"));
    } finally {
      setAttachBusy(false);
    }
  };

  return (
    <div style={{ maxHeight: '58vh', overflowY: 'auto' }}>
      <p style={{ margin: 'var(--space-1) 0', fontSize: 'var(--text-body)' }}>
        {item.name}
        {exp && (
          <span style={{ marginLeft: 8, fontSize: 'var(--text-xs)', color: exp === 'expired' ? 'var(--status-risk)' : 'var(--status-gentle)' }}>
            {exp === 'expired' ? L(dict, '已过期', 'Expired') : L(dict, '临期', 'Expiring soon')}
          </span>
        )}
      </p>
      <label style={label}>{L(dict, '放哪了?', 'Where does it live?')}</label>
      <LocationPicker value={location} onChange={setLocation} />
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={label}>{L(dict, '数量', 'Qty')}</label>
          <input className="nesio-ob-input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ''))} />
        </div>
        <div style={{ flex: 1.4 }}>
          <label style={label}>{L(dict, '效期', 'Expiry')}</label>
          <input className="nesio-ob-input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1.2 }}>
          <label style={label}>{L(dict, '分类', 'Category')}</label>
          {(() => {
            const isPreset = CATEGORY_PRESETS.some(([zh]) => zh === category);
            const showCustom = catCustom || (!!category && !isPreset);
            return (
              <>
                <select
                  className="nesio-ob-input"
                  value={showCustom ? CAT_CUSTOM : category}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === CAT_CUSTOM) { setCatCustom(true); setCategory(''); }
                    else { setCatCustom(false); setCategory(v); }
                  }}
                >
                  <option value="">{L(dict, '未分类', 'None')}</option>
                  {CATEGORY_PRESETS.map(([zh, en]) => (
                    <option key={zh} value={zh}>{L(dict, zh, en)}</option>
                  ))}
                  <option value={CAT_CUSTOM}>{L(dict, '自定义…', 'Custom…')}</option>
                </select>
                {showCustom && (
                  <input
                    className="nesio-ob-input"
                    style={{ marginTop: 6 }}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder={L(dict, '自定义分类', 'Custom category')}
                  />
                )}
              </>
            );
          })()}
        </div>
        <div style={{ flex: 1 }}>
          <label style={label}>{L(dict, '价格 $', 'Price $')}</label>
          <input className="nesio-ob-input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} />
        </div>
      </div>
      <label style={label}>{L(dict, '标签(逗号分隔)', 'Tags (comma separated)')}</label>
      <input className="nesio-ob-input" value={tags} onChange={(e) => setTags(e.target.value)} />
      <label style={label}>{L(dict, '备注', 'Note')}</label>
      <input className="nesio-ob-input" value={note} onChange={(e) => setNote(e.target.value)} />

      <label style={label}>{L(dict, '照片 / 文件', 'Photos / files')}</label>
      <input ref={attachRef} type="file" multiple className="nesio-visually-hidden"
        onChange={(e) => { void onAttachFiles(e.target.files); e.currentTarget.value = ''; }} />
      <Button type="button" variant="secondary" size="sm" full disabled={attachBusy}
        onClick={() => attachRef.current?.click()}>
        {attachBusy ? L(dict, '正在存…', 'Saving…') : L(dict, '添加照片或文件', 'Add photo or file')}
      </Button>
      {attachErr && <p role="alert" style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: 'var(--status-risk)' }}>{attachErr}</p>}
      {assets.length > 0 && (
        <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {assets.map((a) => (
            <li key={a.id} style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
              <AssetThumb assetId={a.id} label={a.label || a.id} isImage={a.kind === 'image' || Boolean(a.mimeType?.startsWith('image/'))} dict={dict} />
            </li>
          ))}
        </ul>
      )}

      {claimPrice > 0 && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <SpendClaimRow
            itemNodeId={item.id}
            item={{ id: item.id, name: item.name, price: claimPrice, occurredAt: claimDate, merchant: seller || undefined }}
            dict={dict}
            onChanged={onChanged}
          />
        </div>
      )}

      {/* ── 亚马逊转卖(flip)追踪:订单/返现/留评/转卖/利润 —— 对应用户 Notion 表 ── */}
      <Button
        type="button"
        variant={amzOpen ? 'soft' : 'secondary'}
        size="sm"
        full
        align="start"
        onClick={() => setAmzOpen((v) => !v)}
        layoutStyle={{ marginTop: 'var(--space-4)' }}
      >
        {amzOpen ? '▾' : '▸'} {L(dict, '亚马逊转卖 · 订单/返现/利润', 'Amazon flip · order / rebate / profit')}
      </Button>
      {amzOpen && (
        <div style={{ marginTop: 8 }}>
          <label style={label}>{L(dict, '订单号', 'Order #')}</label>
          <input className="nesio-ob-input" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder="112-…" />
          <label style={label}>{L(dict, '商家', 'Seller')}</label>
          <input className="nesio-ob-input" value={seller} onChange={(e) => setSeller(e.target.value)} placeholder="Makun" />
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>{L(dict, '下单日', 'Ordered')}</label>
              <input className="nesio-ob-input" type="date" value={orderedAt} onChange={(e) => setOrderedAt(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>{L(dict, '到货日', 'Arrived')}</label>
              <input className="nesio-ob-input" type="date" value={arrivedAt} onChange={(e) => setArrivedAt(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>{L(dict, '税 $', 'Tax $')}</label>
              <input className="nesio-ob-input" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value.replace(/[^0-9.]/g, ''))} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>{L(dict, '返现 $', 'Rebate $')}</label>
              <input className="nesio-ob-input" inputMode="decimal" value={rebate} onChange={(e) => setRebate(e.target.value.replace(/[^0-9.]/g, ''))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>{L(dict, '转卖价 $', 'Resale $')}</label>
              <input className="nesio-ob-input" inputMode="decimal" value={resalePrice} onChange={(e) => setResalePrice(e.target.value.replace(/[^0-9.]/g, ''))} />
            </div>
          </div>
          <label style={label}>{L(dict, '关键词', 'Keywords')}</label>
          <input className="nesio-ob-input" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="aluminum carry on luggage" />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {chip(reviewDone, () => setReviewDone((v) => !v), L(dict, '已留评', 'Reviewed'))}
            {chip(reviewExempt, () => setReviewExempt((v) => !v), L(dict, '免评', 'No review'))}
            {chip(rebateReceived, () => setRebateReceived((v) => !v), L(dict, '返现到账', 'Rebate in'))}
            {chip(sold, () => setSold((v) => !v), L(dict, '已售出', 'Sold'))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10, fontSize: 'var(--text-body)' }}>
            <span style={{ color: 'var(--portal-muted)' }}>{L(dict, '自付额', 'Out of pocket')}: {oop != null ? money(oop) : '—'}</span>
            <span style={{ fontWeight: 700, color: profit == null ? 'var(--portal-muted)' : profit >= 0 ? 'var(--status-go)' : 'var(--status-risk)' }}>
              {L(dict, '盈利', 'Profit')}: {profit != null ? money(profit) : '—'}
            </span>
          </div>
          <p style={{ margin: '6px 2px 0', fontSize: 'var(--text-overline)', color: 'var(--portal-muted)' }}>
            {L(dict, '价格在上方;自付额 = 价格 − 返现(税不进成本);盈利 = 转卖价 − 自付额。', 'Price is above; out of pocket = price − rebate (tax excluded); profit = resale − out of pocket.')}
          </p>
        </div>
      )}

      <Button
        type="button"
        variant={item.forSale ? 'soft' : 'secondary'}
        size="sm"
        full
        layoutStyle={{ marginTop: 'var(--space-4)' }}
        onClick={() => { updateInventoryItem(item.id, { forSale: !item.forSale }); onChanged(); }}
      >
        {item.forSale ? L(dict, '已在卖闲置堆 · 点击取消', 'In sell pile · tap to remove') : L(dict, '标记出售(进卖闲置堆)', 'Mark for sale')}
      </Button>
      {/* 物品④:物品本身变容器(收纳箱等);解除只摘 flag,不动已放进去的物品 */}
      <Button
        type="button"
        variant={item.isContainer ? 'soft' : 'secondary'}
        size="sm"
        full
        layoutStyle={{ marginTop: 'var(--space-2)' }}
        onClick={() => { updateInventoryItem(item.id, { isContainer: !item.isContainer }); onChanged(); }}
      >
        {item.isContainer
          ? L(dict, `已是容器,装了 ${item.containedCount} 件 · 点击解除(不影响里面的物品)`, `It's a bin holding ${item.containedCount} · tap to unmark (contents stay)`)
          : L(dict, '变成容器(其他物品的位置就能写它)', 'Make it a bin (other items can live in it)')}
      </Button>
      <Button type="button" variant="primary" size="sm" full
        layoutStyle={{ marginTop: 'var(--space-2)' }}
        onClick={save}>
        {saveMsg === 'ok' ? L(dict, '✓ 已保存', '✓ Saved') : L(dict, '保存', 'Save')}
      </Button>
      {saveMsg === 'err' && (
        <p role="alert" style={{ margin: '0.4rem 2px 0', fontSize: 'var(--text-xs)', color: 'var(--status-risk)', textAlign: 'center' }}>
          {L(dict, '没存进去 —— 本机空间可能满了。先在设置里导出备份,或删几条旧记忆再试。', "Couldn't save — local storage may be full. Export a backup in Settings or free some space, then retry.")}
        </p>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        tone="risk"
        full
        layoutStyle={{ marginTop: 'var(--space-2)' }}
        onClick={() => { if (window.confirm(L(dict, '删除这件物品?', 'Delete this item?'))) { removeInventoryItem(item.id); onDeleted(); } }}
      >
        {L(dict, '删除物品', 'Delete item')}
      </Button>
    </div>
  );
}

/** 物品详情附件缩略图:本机图从 IDB 读;非图文件显示文件名。 */
function AssetThumb({ assetId, label, isImage, dict }: {
  assetId: string; label: string; isImage: boolean; dict: string;
}) {
  const [url, setUrl] = useState<string>('');
  useEffect(() => {
    let live = true;
    let objectUrl = '';
    (async () => {
      if (isImage) {
        const { getLocalImage } = await import('@/lib/portal/local-image-store');
        const u = await getLocalImage(assetId);
        if (live && u) setUrl(u);
        return;
      }
      const { getLocalFile } = await import('@/lib/portal/local-file-store');
      const rec = await getLocalFile(assetId);
      if (!live || !rec?.blob) return;
      objectUrl = URL.createObjectURL(rec.blob);
      setUrl(objectUrl);
    })().catch(() => {});
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, isImage]);

  if (isImage && url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={label} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--portal-line)' }} />
    );
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: 120,
      padding: '6px 8px', borderRadius: 8, border: '1px solid var(--portal-line)',
      background: 'var(--portal-accent-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {label || L(dict, '附件', 'File')}
    </span>
  );
}
