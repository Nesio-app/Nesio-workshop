'use client';

/**
 * InventorySheet — 原生收纳面板(收纳重建 · 片 2)。
 *
 * 取代静态 /storage/ app 的收纳半边(冲动守卫半边早已原生:冷冻仓/购买冷静流)。
 * 数据 = life-graph object 节点(见 lib/portal/inventory.ts);位置词汇 = named-places
 * (与拍一下识别归位共用同一个 LocationPicker,一套真相,不自建第二套位置表)。
 * 浏览分组从物品 location 首段动态聚合;复用 nesio-freeze-* sheet 骨架样式。
 */

import { useEffect, useMemo, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import NesioSheet from './ui/NesioSheet';
import { guardPaidCloudAi } from '@/lib/portal/entitlement';
import { relativePastLabel } from '@/lib/portal/time-labels';
import { IconMapPin, IconClock, IconCamera, IconNote, IconBox } from './icons';
import LocationPicker from './LocationPicker';
import { importInventoryCsv } from '@/lib/portal/inventory-import';
import { useRef } from 'react';
import {
  addInventoryItem,
  amazonSummary,
  buildListingText,
  expiryStatus,
  inventoryStats,
  listInventoryItems,
  parseAmazonFlipCsv,
  removeInventoryItem,
  reviewDueInfo,
  sellPile,
  sortAmazonFlip,
  updateInventoryItem,
  type InventoryItem,
} from '@/lib/portal/inventory';
import { isFoodItem } from '@/lib/cooking/pantry';

interface InventorySheetProps {
  open: boolean;
  onClose: () => void;
}

const ALL = '__all__';
const UNPLACED = '__unplaced__';

// 批次 179:物品分类改下拉预设 + 自定义(用户实锤「下拉框选项,客户可以自定义」)
const CATEGORY_PRESETS: Array<[string, string]> = [
  ['日用品', 'Household'], ['护肤', 'Skincare'], ['电子', 'Electronics'], ['服饰', 'Apparel'],
  ['食品', 'Food'], ['文具', 'Stationery'], ['工具', 'Tools'], ['药品', 'Meds'],
  ['母婴', 'Baby'], ['收藏', 'Collectible'],
];
const CAT_CUSTOM = '__custom__';
// 批次 170:去 emoji —— 位置/分组名里残留的 🏠 等图形字符全清掉(设计:一律线性,无 emoji)
function stripEmoji(s: string): string {
  return s
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export default function InventorySheet({ open, onClose }: InventorySheetProps) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [groupFilter, setGroupFilter] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'add' | 'detail' | 'stats' | 'sell' | 'flip'>('list');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState(''); // 物品②:导入结果可见展示(不静默)
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasteBusy, setPasteBusy] = useState(false); // 物品⑤:粘贴商品信息识别
  const [pasteMsg, setPasteMsg] = useState('');
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
  const refresh = () => setItems(listInventoryItems().filter((i) => !isFoodItem(i)));

  useEffect(() => {
    if (!open) return;
    refresh();
    setView('list');
    setQuery('');
    setGroupFilter(ALL);
  }, [open]);

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
  }, [items, groupFilter, query]);

  const unplacedCount = useMemo(() => items.filter((i) => !i.space).length, [items]);
  const st = useMemo(() => inventoryStats(items), [items]);

  // 批次 170:物品左侧占位符 —— 该物品记忆有图就显示真图(取本机 IndexedDB 图,离线也能看)
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
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
  }, [open, visible]);
  const detail = detailId ? items.find((i) => i.id === detailId) ?? null : null;

  if (!open) return null;

  const resetForm = () => { setFName(''); setFLocation(''); setFQty(''); setFExpiry(''); setFNote(''); setFCategory(''); setCatCustom(false); setFTags(''); setFPrice(''); setPasteMsg(''); };

  // 物品⑤:粘贴商品信息(商品页标题/描述/链接文本)→ AI 识别预填表单;失败可见,不静默
  const pasteRecognize = async () => {
    setPasteMsg('');
    let text = '';
    try { text = (await navigator.clipboard.readText()).trim(); }
    catch { setPasteMsg(L(dict, '读不到剪贴板 —— 请允许粘贴权限,或直接手动填写', 'Clipboard unavailable — allow paste permission or fill in manually')); return; }
    if (!text) { setPasteMsg(L(dict, '剪贴板是空的 —— 先去商品页复制标题或描述', 'Clipboard is empty — copy a product title or description first')); return; }
    if (!guardPaidCloudAi('inventory_extract')) { setPasteBusy(false); return; } // 安全审计 #2:AI 抽取付费云
    setPasteBusy(true);
    try {
      const res = await fetch('/api/portal/inventory-extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      const data = await res.json().catch(() => null) as { items?: Array<{ name?: string; quantity?: number; location?: string; category?: string; tags?: string[]; price?: number; note?: string }> } | null;
      const list = res.ok && Array.isArray(data?.items) ? data!.items! : [];
      if (!list.length || !list[0]?.name) {
        setPasteMsg(L(dict, '没识别出物品 —— 手动填一下吧', "Couldn't recognize an item — fill it in manually"));
        return;
      }
      if (list.length > 1) {
        // 多件直接入库(和问一问同语义),不让第 2 件之后静默丢失
        for (const it of list) { if (it.name) addInventoryItem(it as { name: string }); }
        refresh();
        setView('list');
        setImportMsg(L(dict, `已识别并存入 ${list.length} 件`, `Recognized and saved ${list.length} items`));
        return;
      }
      const first = list[0];
      setFName(first.name || '');
      if (first.location) setFLocation(first.location);
      if (first.quantity != null) setFQty(String(first.quantity));
      if (first.category) setFCategory(first.category);
      if (first.tags?.length) setFTags(first.tags.join(', '));
      if (first.price != null) setFPrice(String(first.price));
      if (first.note) setFNote(first.note);
      setPasteMsg(L(dict, '已识别,确认或补几笔再保存', 'Recognized — review and save'));
    } catch {
      setPasteMsg(L(dict, '识别服务暂时不可用 —— 稍后再试,或手动填写', 'Recognition unavailable — try again later or fill in manually'));
    } finally { setPasteBusy(false); }
  };

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

  const label: React.CSSProperties = { display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.7rem 0 0.3rem' };
  const chip = (active: boolean): React.CSSProperties => ({
    padding: '0.32rem 0.7rem', borderRadius: 999, fontSize: '0.8rem', whiteSpace: 'nowrap',
    border: `1px solid ${active ? 'var(--accent-primary, #5b8cff)' : 'var(--border-subtle, rgba(255,255,255,0.12))'}`,
    background: active ? 'var(--accent-primary-dim, rgba(91,140,255,0.18))' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
  });

  return (
    // 2026-07-28(标注 图11「按钮失效」)根因:洞察页的「打开物品管理」按钮**是响应的** ——
    // 事件派了、sheet 也开了,但它是 bottom 卡(z-901),被洞察这个 fullscreen 面板(z-930)整个盖住,
    // 看着就像按钮没反应。做饭页能从洞察打开正是因为它是 fullscreen。这里抬层到 940/941。
    <NesioSheet
      variant="bottom"
      elevated
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      card={false}
      className="nesio-freeze-sheet"
      ariaLabel={L(dict, '收纳', 'Storage')}
    >
        {/* 批次 170:去「收纳」标题;统计挪中间上方,方块容器徽章 */}
        <div className="nesio-freeze-header nesio-inv-header">
          {view === 'list' && items.length > 0 ? (
            <div className="nesio-inv-stats">
              <span className="nesio-inv-stat">{st.count} {L(dict, '件', 'items')}</span>
              {st.totalValue > 0 && <span className="nesio-inv-stat">≈ ${Math.round(st.totalValue).toLocaleString('en-US')}</span>}
              {unplacedCount > 0 && <span className="nesio-inv-stat">{unplacedCount} {L(dict, '未归位', 'unplaced')}</span>}
            </div>
          ) : <span />}
          <button type="button" className="nesio-freeze-close nesio-inv-close" onClick={view === 'list' ? onClose : () => { setView('list'); setDetailId(null); }}>
            {view === 'list' ? '✕' : '‹'}
          </button>
        </div>

        {view === 'list' && (
          <>
            {/* 批次 173:用户实锤删掉「东西放哪了…」小字行 */}
            <input
              className="nesio-ob-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={L(dict, '搜物品 / 位置…', 'Search items / locations…')}
              style={{ margin: '0.5rem 0' }}
            />
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '0.2rem 0 0.5rem' }}>
              <button type="button" style={chip(groupFilter === ALL)} onClick={() => setGroupFilter(ALL)}>{L(dict, '全部', 'All')} {items.length}</button>
              {groups.map(([name, n]) => (
                <button key={name} type="button" style={chip(groupFilter === name)} onClick={() => setGroupFilter(name)}>
                  {stripEmoji(name) || name} {n}
                </button>
              ))}
              {unplacedCount > 0 && (
                <button type="button" style={chip(groupFilter === UNPLACED)} onClick={() => setGroupFilter(UNPLACED)}>
                  {L(dict, '未归位', 'Unplaced')} {unplacedCount}
                </button>
              )}
              <button type="button" style={chip(false)} onClick={() => setView('stats')}>
                {L(dict, '统计', 'Stats')}
              </button>
              <button type="button" style={chip(false)} onClick={() => setView('sell')}>
                {L(dict, '卖闲置', 'Sell pile')}
              </button>
              {items.some((i) => i.isAmazon) && (
                <button type="button" style={chip(false)} onClick={() => setView('flip')}>
                  {L(dict, '亚马逊转卖', 'Amazon flip')}
                </button>
              )}
            </div>

            {visible.length === 0 ? (
              <p className="nesio-freeze-empty" style={{ padding: '1.6rem 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                {query
                  ? L(dict, '没找到。换个词试试?', 'Nothing found. Try another word?')
                  : L(dict, '还没有物品。点下面「记一件」,或用「拍一下」拍张照直接识别。', 'No items yet. Tap "Add one" below, or snap a photo to recognize.')}
              </p>
            ) : (
              <>
                {/* 批次 133·设计:物品·最近更新在前 */}
                <p style={{ margin: '0.2rem 0 0.5rem', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                  {L(dict, '物品 · 最近更新在前', 'Items · latest first')}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '44vh', overflowY: 'auto', paddingBottom: 4 }}>
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
                          padding: '0.6rem 0.7rem', borderRadius: 14,
                          border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
                          background: 'var(--glass-bg, rgba(255,255,255,0.04))', color: 'var(--text-primary)',
                        }}
                      >
                        {/* 预览图:有图显真图(批次170);无图 → 浅灰底 + 居中收纳图标(批次173) */}
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
                          <span style={{ fontSize: '0.92rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {i.name}{i.quantity != null ? ` ×${i.quantity}` : ''}
                          </span>
                          {/* 一级存放位置 */}
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: i.location ? 'var(--text-secondary)' : 'var(--accent-primary, #c08f6f)' }}>
                            <IconMapPin size={12} />
                            {(i.location && stripEmoji(i.location)) || i.location || L(dict, '未归位 · 点开设位置', 'Unplaced · tap to set')}
                          </span>
                          {/* 最后更新多久前 · 来源 */}
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                            <IconClock size={12} />
                            {L(dict, `${updated}更新`, `updated ${updated}`)} · {src}
                          </span>
                        </span>
                        {exp && (
                          <span style={{ flexShrink: 0, fontSize: '0.7rem', color: exp === 'expired' ? 'var(--status-stop, #ef4444)' : 'var(--status-warn, #f59e0b)' }}>
                            {exp === 'expired' ? L(dict, '已过期', 'Expired') : L(dict, '临期', 'Expiring')}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* 批次 133·设计:常用标签(点开筛该标签)*/}
                {st.topTags.length > 0 && (
                  <>
                    <p style={{ margin: '0.9rem 0 0.4rem', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{L(dict, '常用标签', 'Top tags')}</p>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {st.topTags.slice(0, 6).map((t) => (
                        <button key={t.tag} type="button" style={chip(query === t.tag)} onClick={() => setQuery(query === t.tag ? '' : t.tag)}>
                          {t.tag} <span style={{ color: 'var(--text-tertiary)' }}>{t.count}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: '0.7rem' }}>
              <button type="button" className="nesio-freeze-primary-btn" style={{ flex: 2 }} onClick={() => { resetForm(); setView('add'); }}>
                ＋ {L(dict, '记一件', 'Add one')}
              </button>
              {/* 物品②:CSV 批量导入(仅名称必填;同文件导两次会重复) */}
              <button
                type="button"
                style={{ flex: 1, borderRadius: 12, border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.82rem' }}
                onClick={() => fileRef.current?.click()}
              >
                {L(dict, '导入 CSV', 'Import CSV')}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  try {
                    const text = await f.text();
                    const firstLine = text.split('\n')[0] || '';
                    // 自动识别亚马逊转卖表(Notion「Amazon Free Tracker」导出):列名一命中就走转卖解析,
                    // 否则走通用物品导入。用户不必选类型,直接传文件即可。
                    const isAmazon = /美金价格|自付额|Review Status|PayStatus/.test(firstLine);
                    if (isAmazon) {
                      const parsed = parseAmazonFlipCsv(text);
                      // 去重:同名 + 同到货日已在库就跳过(同文件导两次不叠加)。
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
                }}
              />
            </div>
            {importMsg && <p style={{ margin: '0.45rem 0 0', fontSize: '0.75rem', color: 'var(--text-tertiary)', textAlign: 'center' }}>{importMsg}</p>}
          </>
        )}

        {view === 'add' && (
          // 批次 179:键盘弹起时底部让出 --kb-inset,焦点输入可滚到键盘上方(修物品表单键盘漂移)
          <div style={{ maxHeight: '58vh', overflowY: 'auto', paddingBottom: 'var(--kb-inset, 0px)' }}>
            {/* 物品⑤:从商品页复制标题/描述,一键识别预填 */}
            <button
              type="button"
              disabled={pasteBusy}
              style={{ width: '100%', padding: '0.55rem', borderRadius: 10, border: '1px dashed var(--border-subtle, rgba(255,255,255,0.2))', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.82rem', opacity: pasteBusy ? 0.6 : 1 }}
              onClick={pasteRecognize}
            >
              {pasteBusy ? L(dict, '识别中…', 'Recognizing…') : L(dict, '粘贴商品信息识别(商品标题/描述都行)', 'Paste product info to auto-fill')}
            </button>
            {pasteMsg && <p style={{ margin: '0.4rem 0 0', fontSize: '0.75rem', color: 'var(--text-tertiary)', textAlign: 'center' }}>{pasteMsg}</p>}
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
            <input className="nesio-ob-input" value={fTags} onChange={(e) => setFTags(e.target.value)} placeholder={L(dict, '例:护肤, 粉色, 礼物', 'e.g. skincare, pink, gift')} />
            <label style={label}>{L(dict, '备注(可选)', 'Note (optional)')}</label>
            <input className="nesio-ob-input" value={fNote} onChange={(e) => setFNote(e.target.value)} placeholder={L(dict, '例:被压在护手霜下面', 'e.g. under the hand cream')} />
            <button type="button" className="nesio-freeze-primary-btn" style={{ width: '100%', marginTop: '1rem', opacity: fName.trim() ? 1 : 0.5 }} disabled={!fName.trim()} onClick={submitAdd}>
              {L(dict, '存进收纳', 'Save to storage')}
            </button>
          </div>
        )}

        {/* ── 物品①:库存统计 Dashboard(设计 token 全量;KPI / 归位进度 / 分类 / 标签 / 处理中)── */}
        {view === 'stats' && (() => {
          if (items.length === 0) {
            return <p style={{ padding: 'var(--space-8) 0', textAlign: 'center', color: 'var(--portal-muted)' }}>{L(dict, '还没有物品,统计会随记录自动出现。', 'No items yet — stats appear as you add.')}</p>;
          }
          const st = inventoryStats(items);
          const sp = sellPile(items);
          const amz = amazonSummary(items);
          const totalItems = items.length;
          const unplaced = items.filter((i) => !i.space).length;
          const placed = totalItems - unplaced;
          const placedPct = totalItems ? Math.round((placed / totalItems) * 100) : 0;
          const maxCat = Math.max(1, ...st.byCategory.map((c) => c.count));

          const card: React.CSSProperties = { borderRadius: 'var(--radius-md)', border: '1px solid var(--portal-line)', background: 'var(--portal-accent-soft)', padding: 'var(--space-4)' };
          const kv: React.CSSProperties = { display: 'block', fontSize: 'var(--text-h2)', fontWeight: 'var(--weight-bold)', color: 'var(--portal-ink)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' };
          const kl: React.CSSProperties = { display: 'block', marginTop: '0.25rem', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' };
          const sectionLbl: React.CSSProperties = { margin: 'var(--space-5) 0 var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' };

          return (
            <div style={{ maxHeight: '64vh', overflowY: 'auto', paddingBottom: 'var(--space-4)' }}>
              {/* 概览:物品 / 估值 / 未归位(未归位>0 时用琥珀提示,不用红色制造焦虑) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
                <div style={card}><span style={kv}>{totalItems}</span><span style={kl}>{L(dict, '物品', 'Items')}</span></div>
                <div style={card}><span style={kv}>≈${Math.round(st.totalValue).toLocaleString('en-US')}</span><span style={kl}>{L(dict, '估值', 'Est. value')}</span></div>
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

              {/* 按分类(横向条,主强调色) */}
              {st.byCategory.length > 0 && (
                <>
                  <p style={sectionLbl}>{L(dict, '按分类', 'By category')}</p>
                  {st.byCategory.slice(0, 8).map((c) => (
                    <div key={c.category} style={{ margin: '0 0 var(--space-2)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--portal-ink)', marginBottom: '0.2rem' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.category}</span>
                        <span style={{ color: 'var(--portal-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{c.count}</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--portal-accent-soft)' }}>
                        <div style={{ height: '100%', borderRadius: 'var(--radius-pill)', width: `${Math.round((c.count / maxCat) * 100)}%`, background: 'var(--portal-accent)' }} />
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* 常用标签 */}
              {st.topTags.length > 0 && (
                <>
                  <p style={sectionLbl}>{L(dict, '常用标签', 'Top tags')}</p>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    {st.topTags.map((t) => (
                      <span key={t.tag} style={{ padding: '0.25rem 0.6rem', borderRadius: 'var(--radius-pill)', fontSize: 'var(--text-xs)', background: 'var(--portal-accent-soft)', border: '1px solid var(--portal-line)', color: 'var(--portal-ink)' }}>
                        {t.tag} <span style={{ color: 'var(--portal-muted)' }}>{t.count}</span>
                      </span>
                    ))}
                  </div>
                </>
              )}

              {/* 处理中:卖闲置 + 亚马逊转卖(点卡进对应子视图) */}
              {(sp.items.length > 0 || amz.count > 0) && (
                <>
                  <p style={sectionLbl}>{L(dict, '在处理', 'In progress')}</p>
                  <div style={{ display: 'grid', gridTemplateColumns: amz.count > 0 ? '1fr 1fr' : '1fr', gap: 'var(--space-2)' }}>
                    <button type="button" onClick={() => setView('sell')} style={{ ...card, textAlign: 'left', cursor: 'pointer' }}>
                      <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' }}>{L(dict, '卖闲置堆', 'Sell pile')}</span>
                      <span style={{ display: 'block', marginTop: '0.3rem', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
                        {L(dict, `${sp.items.length} 件 · 约 $${Math.round(sp.totalValue).toLocaleString('en-US')}`, `${sp.items.length} items · ≈$${Math.round(sp.totalValue).toLocaleString('en-US')}`)}
                      </span>
                    </button>
                    {amz.count > 0 && (
                      <button type="button" onClick={() => setView('flip')} style={{ ...card, textAlign: 'left', cursor: 'pointer' }}>
                        <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)' }}>{L(dict, '亚马逊转卖', 'Amazon flip')}</span>
                        <span style={{ display: 'block', marginTop: '0.3rem', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
                          {L(dict, `${amz.count} 件 · 已赚 $${Math.round(amz.realizedProfit).toLocaleString('en-US')}`, `${amz.count} items · $${Math.round(amz.realizedProfit).toLocaleString('en-US')} earned`)}
                        </span>
                        {amz.reviewDue > 0 && (
                          <span style={{ display: 'inline-block', marginTop: '0.4rem', padding: '0.1rem 0.5rem', borderRadius: 'var(--radius-pill)', fontSize: 'var(--text-xs)', background: 'var(--status-gentle-soft)', color: 'var(--status-gentle)' }}>
                            {L(dict, `${amz.reviewDue} 件待留评`, `${amz.reviewDue} to review`)}
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* ── 物品③:卖闲置堆(对标 Build a sell pile:hero 合计 + 列表) ── */}
        {view === 'sell' && (() => {
          const sp = sellPile(items);
          return (
            <div style={{ maxHeight: '58vh', overflowY: 'auto' }}>
              <div style={{ borderRadius: 14, padding: '1rem', textAlign: 'center', background: 'var(--glass-bg, rgba(255,255,255,0.05))', border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))' }}>
                <span style={{ display: 'block', fontSize: '1.6rem', fontWeight: 700 }}>${sp.totalValue.toLocaleString('en-US')}</span>
                <span style={{ display: 'block', fontSize: '0.76rem', color: 'var(--text-tertiary)' }}>
                  {sp.items.length
                    ? L(dict, `这堆闲置约值这么多(${sp.items.length} 件)—— 挂出去就是零花钱`, `Your sell pile (${sp.items.length} items) — list them and it's pocket money`)
                    : L(dict, '还没有标记出售的物品', 'Nothing marked for sale yet')}
                </span>
              </div>
              {sp.items.length === 0 ? (
                <p style={{ padding: '1.2rem 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
                  {L(dict, '在物品详情里点「标记出售」,它就会进到这里,估值自动累计。', 'Tap "Mark for sale" on any item — it lands here and the total grows.')}
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: '0.7rem' }}>
                  {sp.items.map((i) => (
                    <div key={i.id} style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                      <button type="button" onClick={() => { setDetailId(i.id); setView('detail'); }}
                        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '0.6rem 0.7rem', borderRadius: 12, border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))', background: 'var(--glass-bg, rgba(255,255,255,0.04))', color: 'var(--text-primary)' }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name}{i.quantity != null ? ` ×${i.quantity}` : ''}</span>
                          <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{i.location || L(dict, '未归位', 'Unplaced')}</span>
                        </span>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{i.price != null ? `$${(i.price * (i.quantity && i.quantity > 0 ? i.quantity : 1)).toLocaleString('en-US')}` : L(dict, '未估值', 'no est.')}</span>
                      </button>
                      {/* 物品⑥:一键复制转卖文案(纯模板),贴去闲鱼/FB Marketplace */}
                      <button type="button" onClick={() => copyListing(i)}
                        style={{ flexShrink: 0, padding: '0 0.6rem', borderRadius: 12, border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))', background: copiedId === i.id ? 'var(--accent-primary-dim, rgba(91,140,255,0.18))' : 'transparent', color: copiedId === i.id ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: '0.76rem', whiteSpace: 'nowrap' }}>
                        {copiedId === i.id ? `✓ ${L(dict, '已复制', 'Copied')}` : L(dict, '复制文案', 'Copy ad')}
                      </button>
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
            return <span style={{ fontSize: '0.7rem', fontWeight: 600, color, background: bg, padding: '0.15rem 0.5rem', borderRadius: 'var(--radius-pill, 999px)', whiteSpace: 'nowrap' }}>{text}</span>;
          };
          return (
            <div style={{ maxHeight: '58vh', overflowY: 'auto' }}>
              {/* 汇总:总自付 / 返现 / 已售利润 / 在库·已售 / 待评 */}
              {(() => {
                const lbl = (v: string, k: string, color?: string) => (
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 64 }}>
                    <b style={{ fontSize: '1.05rem', color }}>{v}</b>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: '0.68rem' }}>{k}</span>
                  </span>
                );
                return (
                  <div style={{ borderRadius: 14, padding: '0.9rem 1rem', background: 'var(--glass-bg, rgba(255,255,255,0.05))', border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))', display: 'flex', flexWrap: 'wrap', gap: '0.7rem 1.2rem' }}>
                    {lbl(fmt(sum.grossSpent), L(dict, '花销(含税)', 'Spent'))}
                    {lbl(fmt(sum.rebateTotal), L(dict, '返钱', 'Rebate'))}
                    {lbl(fmt(sum.realizedProfit), L(dict, '收益(已售)', 'Profit'), sum.realizedProfit >= 0 ? 'var(--status-go)' : 'var(--status-risk)')}
                    {lbl(`${sum.inStock}/${sum.sold}`, L(dict, '在库/已售', 'stock/sold'))}
                    {sum.reviewDue > 0 && lbl(String(sum.reviewDue), L(dict, '该评论', 'to review'), 'var(--status-gentle)')}
                  </div>
                );
              })()}
              <p style={{ margin: '0.6rem 2px 0.4rem', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                {L(dict, '免评置顶 · 其余按到货日排 · 到货约 10 天提醒留评', 'No-review on top · rest by arrival · review reminder ~10d after arrival')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 4 }}>
                {flip.map((i) => (
                  <button key={i.id} type="button" onClick={() => { setDetailId(i.id); setView('detail'); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '0.6rem 0.7rem', borderRadius: 12, border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))', background: 'var(--glass-bg, rgba(255,255,255,0.04))', color: 'var(--text-primary)' }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name}</span>
                      <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                        {i.arrivedAt ? L(dict, `到货 ${i.arrivedAt}`, `Arrived ${i.arrivedAt}`) : i.orderedAt ? L(dict, `下单 ${i.orderedAt}`, `Ordered ${i.orderedAt}`) : L(dict, '无日期', 'no date')}
                        {i.sold && i.profit != null ? ` · ${L(dict, '盈利', 'profit')} ${fmt(i.profit)}` : ''}
                      </span>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{i.outOfPocket != null ? fmt(i.outOfPocket) : (i.buyPrice != null ? fmt(i.buyPrice) : '—')}</span>
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
  const [saveMsg, setSaveMsg] = useState<'idle' | 'ok' | 'err'>('idle');
  const [location, setLocation] = useState(item.location);
  const [qty, setQty] = useState(item.quantity != null ? String(item.quantity) : '');
  const [expiry, setExpiry] = useState(item.expiry ?? '');
  const [note, setNote] = useState(item.note);
  const [category, setCategory] = useState(item.category); // 物品①
  const [tags, setTags] = useState(item.tags.join(', '));
  const [price, setPrice] = useState(item.price != null ? String(item.price) : '');
  // ── 亚马逊转卖(flip)字段 ──
  const [amzOpen, setAmzOpen] = useState(item.isAmazon);
  const [orderNo, setOrderNo] = useState(item.orderNo);
  const [seller, setSeller] = useState(item.seller);
  const [keywords, setKeywords] = useState(item.keywords);
  const [buyPrice, setBuyPrice] = useState(item.buyPrice != null ? String(item.buyPrice) : '');
  const [tax, setTax] = useState(item.tax != null ? String(item.tax) : '');
  const [orderedAt, setOrderedAt] = useState(item.orderedAt ?? '');
  const [arrivedAt, setArrivedAt] = useState(item.arrivedAt ?? '');
  const [rebate, setRebate] = useState(item.rebate != null ? String(item.rebate) : '');
  const [resalePrice, setResalePrice] = useState(item.resalePrice != null ? String(item.resalePrice) : '');
  const [rebateReceived, setRebateReceived] = useState(item.rebateReceived);
  const [reviewDone, setReviewDone] = useState(item.reviewDone);
  const [reviewExempt, setReviewExempt] = useState(item.reviewExempt);
  const [sold, setSold] = useState(item.sold);
  const exp = expiryStatus(item);

  const nOrNull = (s: string) => (s ? parseFloat(s) : (null as unknown as number | undefined));
  // 自付额 = 买入价 + 税 − 返现;盈利 = 转卖价 − 自付额(实时,与 inventory.ts 派生一致)。
  const bpNum = parseFloat(buyPrice);
  // 自付额 = 买入价 − 返现(税不进成本,与 inventory.ts 一致)。
  const oop = Number.isFinite(bpNum)
    ? Math.round((bpNum - (parseFloat(rebate) || 0)) * 100) / 100
    : null;
  const rspNum = parseFloat(resalePrice);
  const profit = Number.isFinite(rspNum) && oop != null ? Math.round((rspNum - oop) * 100) / 100 : null;
  const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const chip = (on: boolean, toggle: () => void, text: string) => (
    <button type="button" onClick={toggle} style={{
      padding: '0.3rem 0.7rem', borderRadius: 'var(--radius-pill, 999px)', fontSize: '0.78rem',
      border: '1px solid var(--portal-accent-border)', cursor: 'pointer',
      background: on ? 'var(--status-go-soft)' : 'transparent',
      color: on ? 'var(--status-go)' : 'var(--portal-muted)', fontWeight: on ? 600 : 400,
    }}>{on ? '✓ ' : ''}{text}</button>
  );

  const save = () => {
    // 设计红线:保存必须有可见成败态(此前点保存无任何反应 = 用户实测「保存不管用」)。
    let ok = false;
    try {
      ok = updateInventoryItem(item.id, {
        location,
        quantity: qty ? parseInt(qty, 10) : null as unknown as number | undefined,
        expiry,
        note,
        category,
        tags: tags.split(/[,,、]/).map((t) => t.trim()).filter(Boolean),
        price: price ? parseFloat(price) : null as unknown as number | undefined,
        isAmazon: amzOpen,
        orderNo, seller, keywords,
        buyPrice: nOrNull(buyPrice), tax: nOrNull(tax), orderedAt, arrivedAt,
        rebate: nOrNull(rebate), resalePrice: nOrNull(resalePrice),
        rebateReceived, reviewDone, reviewExempt, sold,
      });
    } catch {
      ok = false;
    }
    if (ok) {
      onChanged();
      setSaveMsg('ok');
      // 让「✓ 已保存」闪一下,再回列表(能看到更新后的物品,是最直接的成功反馈)。
      setTimeout(() => onSaved(), 550);
    } else {
      setSaveMsg('err');
    }
  };

  return (
    <div style={{ maxHeight: '58vh', overflowY: 'auto' }}>
      <p style={{ margin: '0.3rem 0', fontSize: '1rem' }}>
        {item.name}
        {exp && (
          <span style={{ marginLeft: 8, fontSize: '0.72rem', color: exp === 'expired' ? 'var(--status-stop, #ef4444)' : 'var(--status-warn, #f59e0b)' }}>
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
          <input className="nesio-ob-input" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={label}>{L(dict, '估值 $', 'Value $')}</label>
          <input className="nesio-ob-input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} />
        </div>
      </div>
      <label style={label}>{L(dict, '标签(逗号分隔)', 'Tags (comma separated)')}</label>
      <input className="nesio-ob-input" value={tags} onChange={(e) => setTags(e.target.value)} />
      <label style={label}>{L(dict, '备注', 'Note')}</label>
      <input className="nesio-ob-input" value={note} onChange={(e) => setNote(e.target.value)} />

      {/* ── 亚马逊转卖(flip)追踪:订单/返现/留评/转卖/利润 —— 对应用户 Notion 表 ── */}
      <button
        type="button"
        onClick={() => setAmzOpen((v) => !v)}
        style={{ width: '100%', marginTop: '1rem', padding: '0.5rem 0.7rem', borderRadius: 10, textAlign: 'left', fontWeight: 600,
          border: '1px solid var(--portal-accent-border)', background: amzOpen ? 'var(--portal-accent-soft)' : 'transparent',
          color: 'var(--portal-accent)', fontSize: '0.85rem' }}
      >
        {amzOpen ? '▾' : '▸'} {L(dict, '亚马逊转卖 · 订单/返现/利润', 'Amazon flip · order / rebate / profit')}
      </button>
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
              <label style={label}>{L(dict, '买入价 $', 'Buy $')}</label>
              <input className="nesio-ob-input" inputMode="decimal" value={buyPrice} onChange={(e) => setBuyPrice(e.target.value.replace(/[^0-9.]/g, ''))} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>{L(dict, '税 $', 'Tax $')}</label>
              <input className="nesio-ob-input" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value.replace(/[^0-9.]/g, ''))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>{L(dict, '返现 $', 'Rebate $')}</label>
              <input className="nesio-ob-input" inputMode="decimal" value={rebate} onChange={(e) => setRebate(e.target.value.replace(/[^0-9.]/g, ''))} />
            </div>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10, fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--portal-muted)' }}>{L(dict, '自付额', 'Out of pocket')}: {oop != null ? money(oop) : '—'}</span>
            <span style={{ fontWeight: 700, color: profit == null ? 'var(--portal-muted)' : profit >= 0 ? 'var(--status-go)' : 'var(--status-risk)' }}>
              {L(dict, '盈利', 'Profit')}: {profit != null ? money(profit) : '—'}
            </span>
          </div>
          <p style={{ margin: '6px 2px 0', fontSize: '0.68rem', color: 'var(--portal-muted)' }}>
            {L(dict, '自付额 = 买入价 − 返现(税不进成本);盈利 = 转卖价 − 自付额。保存后打「亚马逊」标签。', 'Out of pocket = buy − rebate (tax excluded); profit = resale − out of pocket. Saving tags it 亚马逊.')}
          </p>
        </div>
      )}

      <button
        type="button"
        style={{ width: '100%', marginTop: '1rem', padding: '0.55rem', borderRadius: 10, border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))', background: item.forSale ? 'var(--accent-primary-dim, rgba(91,140,255,0.18))' : 'transparent', color: 'var(--text-primary)', fontSize: '0.85rem' }}
        onClick={() => { updateInventoryItem(item.id, { forSale: !item.forSale }); onChanged(); }}
      >
        {item.forSale ? L(dict, '已在卖闲置堆 · 点击取消', 'In sell pile · tap to remove') : L(dict, '标记出售(进卖闲置堆)', 'Mark for sale')}
      </button>
      {/* 物品④:物品本身变容器(收纳箱等);解除只摘 flag,不动已放进去的物品 */}
      <button
        type="button"
        style={{ width: '100%', marginTop: '0.5rem', padding: '0.55rem', borderRadius: 10, border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))', background: item.isContainer ? 'var(--accent-primary-dim, rgba(91,140,255,0.18))' : 'transparent', color: 'var(--text-primary)', fontSize: '0.85rem' }}
        onClick={() => { updateInventoryItem(item.id, { isContainer: !item.isContainer }); onChanged(); }}
      >
        {item.isContainer
          ? L(dict, `已是容器,装了 ${item.containedCount} 件 · 点击解除(不影响里面的物品)`, `It's a bin holding ${item.containedCount} · tap to unmark (contents stay)`)
          : L(dict, '变成容器(其他物品的位置就能写它)', 'Make it a bin (other items can live in it)')}
      </button>
      <button type="button" className="nesio-freeze-primary-btn"
        style={{ width: '100%', marginTop: '0.6rem', background: saveMsg === 'ok' ? 'var(--status-go)' : undefined }}
        onClick={save}>
        {saveMsg === 'ok' ? L(dict, '✓ 已保存', '✓ Saved') : L(dict, '保存', 'Save')}
      </button>
      {saveMsg === 'err' && (
        <p role="alert" style={{ margin: '0.4rem 2px 0', fontSize: '0.78rem', color: 'var(--status-risk)', textAlign: 'center' }}>
          {L(dict, '没存进去 —— 本机空间可能满了。先在设置里导出备份,或删几条旧记忆再试。', "Couldn't save — local storage may be full. Export a backup in Settings or free some space, then retry.")}
        </p>
      )}
      <button
        type="button"
        style={{ width: '100%', marginTop: '0.5rem', padding: '0.55rem', borderRadius: 10, border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))', background: 'transparent', color: 'var(--status-stop, #ef4444)', fontSize: '0.85rem' }}
        onClick={() => { if (window.confirm(L(dict, '删除这件物品?', 'Delete this item?'))) { removeInventoryItem(item.id); onDeleted(); } }}
      >
        {L(dict, '删除物品', 'Delete item')}
      </button>
    </div>
  );
}
