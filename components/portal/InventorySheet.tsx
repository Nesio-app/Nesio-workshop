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
import { useSheetDrag } from './use-sheet-drag';
import { relativePastLabel } from '@/lib/portal/time-labels';
import { IconMapPin, IconClock, IconCamera, IconNote } from './icons';
import LocationPicker from './LocationPicker';
import { importInventoryCsv } from '@/lib/portal/inventory-import';
import { useRef } from 'react';
import {
  addInventoryItem,
  buildListingText,
  expiryStatus,
  inventoryStats,
  listInventoryItems,
  removeInventoryItem,
  sellPile,
  updateInventoryItem,
  type InventoryItem,
} from '@/lib/portal/inventory';

interface InventorySheetProps {
  open: boolean;
  onClose: () => void;
}

const ALL = '__all__';
const UNPLACED = '__unplaced__';

// 批次 133·预览图占位色(设计:每条物品有预览图;真图缩略未加载时用柔和莫兰迪色块占位,确定性取色)
const PREVIEW_COLORS = ['#d3b0ac', '#d3b79a', '#a9bcd0', '#b6c7ac', '#c8b3c6', '#cdbfa6', '#b0c4c0'];
function previewColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PREVIEW_COLORS[h % PREVIEW_COLORS.length];
}

export default function InventorySheet({ open, onClose }: InventorySheetProps) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [groupFilter, setGroupFilter] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'add' | 'detail' | 'stats' | 'sell'>('list');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState(''); // 物品②:导入结果可见展示(不静默)
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasteBusy, setPasteBusy] = useState(false); // 物品⑤:粘贴商品信息识别
  const [pasteMsg, setPasteMsg] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null); // 物品⑥:复制转卖文案反馈
  const { handleProps, cardStyle, expanded } = useSheetDrag(onClose);

  // 加物品表单
  const [fName, setFName] = useState('');
  const [fLocation, setFLocation] = useState('');
  const [fQty, setFQty] = useState('');
  const [fExpiry, setFExpiry] = useState('');
  const [fNote, setFNote] = useState('');
  const [fCategory, setFCategory] = useState(''); // 物品①
  const [fTags, setFTags] = useState('');         // 逗号分隔
  const [fPrice, setFPrice] = useState('');

  const refresh = () => setItems(listInventoryItems());

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
        i.note.toLowerCase().includes(q));
    }
    return list;
  }, [items, groupFilter, query]);

  const unplacedCount = useMemo(() => items.filter((i) => !i.space).length, [items]);
  const st = useMemo(() => inventoryStats(items), [items]);
  const detail = detailId ? items.find((i) => i.id === detailId) ?? null : null;

  if (!open) return null;

  const resetForm = () => { setFName(''); setFLocation(''); setFQty(''); setFExpiry(''); setFNote(''); setFCategory(''); setFTags(''); setFPrice(''); setPasteMsg(''); };

  // 物品⑤:粘贴商品信息(商品页标题/描述/链接文本)→ AI 识别预填表单;失败可见,不静默
  const pasteRecognize = async () => {
    setPasteMsg('');
    let text = '';
    try { text = (await navigator.clipboard.readText()).trim(); }
    catch { setPasteMsg(L(dict, '读不到剪贴板 —— 请允许粘贴权限,或直接手动填写', 'Clipboard unavailable — allow paste permission or fill in manually')); return; }
    if (!text) { setPasteMsg(L(dict, '剪贴板是空的 —— 先去商品页复制标题或描述', 'Clipboard is empty — copy a product title or description first')); return; }
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
    <div className="nesio-freeze-overlay" onClick={onClose}>
      <div className={`nesio-freeze-sheet${expanded ? ' nesio-sheet--expanded' : ''}`} style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div className="nesio-sheet-grip" {...handleProps} />
        {/* 批次 133·设计:标题 + 统计收成标题旁一行小字(去掉抽象方块统计) */}
        <div className="nesio-freeze-header">
          <span className="nesio-freeze-title">{L(dict, '收纳', 'Storage')}</span>
          {view === 'list' && items.length > 0 && (
            <span style={{ marginLeft: 'auto', marginRight: '0.6rem', fontSize: '0.72rem', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
              {L(dict, `${st.count} 件`, `${st.count}`)}
              {st.totalValue > 0 ? ` · ${L(dict, '估值', '~')} $${Math.round(st.totalValue).toLocaleString('en-US')}` : ''}
              {unplacedCount > 0 ? ` · ${unplacedCount} ${L(dict, '未归位', 'unplaced')}` : ''}
            </span>
          )}
          <button type="button" className="nesio-freeze-close" onClick={view === 'list' ? onClose : () => { setView('list'); setDetailId(null); }}>
            {view === 'list' ? '✕' : '‹'}
          </button>
        </div>

        {view === 'list' && (
          <>
            <p className="nesio-freeze-hint">{L(dict, '东西放哪了,记一笔;要找时问一问也能搜到', 'Note where things live — Ask can find them too')}</p>
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
                  {name} {n}
                </button>
              ))}
              {unplacedCount > 0 && (
                <button type="button" style={chip(groupFilter === UNPLACED)} onClick={() => setGroupFilter(UNPLACED)}>
                  {L(dict, '未归位', 'Unplaced')} {unplacedCount}
                </button>
              )}
              <button type="button" style={chip(false)} onClick={() => setView('stats')}>
                📊 {L(dict, '统计', 'Stats')}
              </button>
              <button type="button" style={chip(false)} onClick={() => setView('sell')}>
                💰 {L(dict, '卖闲置', 'Sell pile')}
              </button>
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
                        {/* 预览图(设计:一眼认出是什么;真图缩略未加载 → 柔和色块占位) */}
                        <span aria-hidden style={{
                          flexShrink: 0, width: 46, height: 46, borderRadius: 11,
                          background: `linear-gradient(135deg, ${previewColor(i.name)}, color-mix(in srgb, ${previewColor(i.name)} 70%, #000))`,
                        }} />
                        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={{ fontSize: '0.92rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {i.name}{i.quantity != null ? ` ×${i.quantity}` : ''}
                          </span>
                          {/* 一级存放位置 */}
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: i.location ? 'var(--text-secondary)' : 'var(--accent-primary, #c08f6f)' }}>
                            <IconMapPin size={12} />
                            {i.location || L(dict, '未归位 · 点开设位置', 'Unplaced · tap to set')}
                          </span>
                          {/* 最后更新多久前 · 来源 */}
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                            <IconClock size={12} />
                            {L(dict, `${updated}更新`, `updated ${updated}`)} · {src}
                          </span>
                        </span>
                        {exp && (
                          <span style={{ flexShrink: 0, fontSize: '0.7rem', color: exp === 'expired' ? 'var(--status-stop, #ef4444)' : 'var(--status-warn, #f59e0b)' }}>
                            {exp === 'expired' ? L(dict, '已过期', 'Expired') : L(dict, '临期', 'Soon')}
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
                📄 {L(dict, '导入 CSV', 'Import CSV')}
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
                    const r = importInventoryCsv(await f.text());
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
          <div style={{ maxHeight: '58vh', overflowY: 'auto' }}>
            {/* 物品⑤:从商品页复制标题/描述,一键识别预填 */}
            <button
              type="button"
              disabled={pasteBusy}
              style={{ width: '100%', padding: '0.55rem', borderRadius: 10, border: '1px dashed var(--border-subtle, rgba(255,255,255,0.2))', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.82rem', opacity: pasteBusy ? 0.6 : 1 }}
              onClick={pasteRecognize}
            >
              📋 {pasteBusy ? L(dict, '识别中…', 'Recognizing…') : L(dict, '粘贴商品信息识别(商品标题/描述都行)', 'Paste product info to auto-fill')}
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
                <input className="nesio-ob-input" value={fCategory} onChange={(e) => setFCategory(e.target.value)} placeholder={L(dict, '例:日用品、护肤、电子', 'e.g. household, skincare')} />
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

        {/* ── 物品①:库存统计(对标 Inventory Stats:KPI / 分类分布 / 标签云) ── */}
        {view === 'stats' && (() => {
          const st = inventoryStats(items);
          const kpi: React.CSSProperties = { flex: 1, minWidth: 120, borderRadius: 12, padding: '0.7rem 0.8rem', background: 'var(--glass-bg, rgba(255,255,255,0.05))', border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))' };
          const kv: React.CSSProperties = { display: 'block', fontSize: '1.3rem', fontWeight: 700 };
          const kl: React.CSSProperties = { display: 'block', fontSize: '0.72rem', color: 'var(--text-tertiary)' };
          const maxCat = Math.max(1, ...st.byCategory.map((c) => c.count));
          return (
            <div style={{ maxHeight: '58vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div style={kpi}><span style={kv}>{st.spaces}</span><span style={kl}>{L(dict, '空间', 'Spaces')}</span></div>
                <div style={kpi}><span style={kv}>{st.containers}</span><span style={kl}>{L(dict, '容器', 'Bins')}</span></div>
                <div style={kpi}><span style={kv}>{st.count}</span><span style={kl}>{L(dict, '物品', 'Items')}</span></div>
                <div style={kpi}><span style={kv}>${st.totalValue.toLocaleString('en-US')}</span><span style={kl}>{L(dict, '估值', 'Est. value')}</span></div>
              </div>
              {st.byCategory.length > 0 && (
                <>
                  <p style={{ margin: '1rem 0 0.4rem', fontSize: '0.82rem', fontWeight: 600 }}>{L(dict, '按分类', 'Items by category')}</p>
                  {st.byCategory.map((c) => (
                    <div key={c.category} style={{ margin: '0.35rem 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                        <span>{c.category}</span><span style={{ color: 'var(--text-tertiary)' }}>{c.count}</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--glass-bg, rgba(255,255,255,0.06))' }}>
                        <div style={{ height: '100%', borderRadius: 3, width: `${Math.round((c.count / maxCat) * 100)}%`, background: 'var(--accent-primary, #5b8cff)' }} />
                      </div>
                    </div>
                  ))}
                </>
              )}
              {st.topTags.length > 0 && (
                <>
                  <p style={{ margin: '1rem 0 0.4rem', fontSize: '0.82rem', fontWeight: 600 }}>{L(dict, '常用标签', 'Top tags')}</p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {st.topTags.map((t) => (
                      <span key={t.tag} style={{ padding: '0.25rem 0.6rem', borderRadius: 999, fontSize: '0.76rem', background: 'var(--glass-bg, rgba(255,255,255,0.06))', border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))' }}>
                        {t.tag} <span style={{ color: 'var(--text-tertiary)' }}>{t.count}</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
              {(() => {
                const sp = sellPile(items);
                if (!sp.items.length) return null;
                return (
                  <p style={{ margin: '1rem 0 0', fontSize: '0.82rem' }}>
                    💰 {L(dict, `卖闲置堆:${sp.items.length} 件,约值 $${sp.totalValue.toLocaleString('en-US')}`, `Sell pile: ${sp.items.length} items ≈ $${sp.totalValue.toLocaleString('en-US')}`)}
                  </p>
                );
              })()}
              {items.length === 0 && (
                <p style={{ padding: '1.4rem 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>{L(dict, '还没有物品,统计会随记录自动出现。', 'No items yet — stats appear as you add.')}</p>
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
                        <span style={{ fontSize: '1.05rem' }}>💰</span>
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

        {view === 'detail' && detail && (
          <ItemDetail
            item={detail}
            dict={dict}
            label={label}
            onChanged={refresh}
            onDeleted={() => { refresh(); setView('list'); setDetailId(null); }}
          />
        )}
      </div>
    </div>
  );
}

function ItemDetail({ item, dict, label, onChanged, onDeleted }: {
  item: InventoryItem;
  dict: ReturnType<typeof portalLocaleToDictionaryLocale>;
  label: React.CSSProperties;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [location, setLocation] = useState(item.location);
  const [qty, setQty] = useState(item.quantity != null ? String(item.quantity) : '');
  const [expiry, setExpiry] = useState(item.expiry ?? '');
  const [note, setNote] = useState(item.note);
  const [category, setCategory] = useState(item.category); // 物品①
  const [tags, setTags] = useState(item.tags.join(', '));
  const [price, setPrice] = useState(item.price != null ? String(item.price) : '');
  const exp = expiryStatus(item);

  const save = () => {
    updateInventoryItem(item.id, {
      location,
      quantity: qty ? parseInt(qty, 10) : null as unknown as number | undefined,
      expiry,
      note,
      category,
      tags: tags.split(/[,,、]/).map((t) => t.trim()).filter(Boolean),
      price: price ? parseFloat(price) : null as unknown as number | undefined,
    });
    onChanged();
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
      <button
        type="button"
        style={{ width: '100%', marginTop: '1rem', padding: '0.55rem', borderRadius: 10, border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))', background: item.forSale ? 'var(--accent-primary-dim, rgba(91,140,255,0.18))' : 'transparent', color: 'var(--text-primary)', fontSize: '0.85rem' }}
        onClick={() => { updateInventoryItem(item.id, { forSale: !item.forSale }); onChanged(); }}
      >
        💰 {item.forSale ? L(dict, '已在卖闲置堆 · 点击取消', 'In sell pile · tap to remove') : L(dict, '标记出售(进卖闲置堆)', 'Mark for sale')}
      </button>
      {/* 物品④:物品本身变容器(收纳箱等);解除只摘 flag,不动已放进去的物品 */}
      <button
        type="button"
        style={{ width: '100%', marginTop: '0.5rem', padding: '0.55rem', borderRadius: 10, border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))', background: item.isContainer ? 'var(--accent-primary-dim, rgba(91,140,255,0.18))' : 'transparent', color: 'var(--text-primary)', fontSize: '0.85rem' }}
        onClick={() => { updateInventoryItem(item.id, { isContainer: !item.isContainer }); onChanged(); }}
      >
        🗃 {item.isContainer
          ? L(dict, `已是容器,装了 ${item.containedCount} 件 · 点击解除(不影响里面的物品)`, `It's a bin holding ${item.containedCount} · tap to unmark (contents stay)`)
          : L(dict, '变成容器(其他物品的位置就能写它)', 'Make it a bin (other items can live in it)')}
      </button>
      <button type="button" className="nesio-freeze-primary-btn" style={{ width: '100%', marginTop: '0.6rem' }} onClick={save}>
        {L(dict, '保存', 'Save')}
      </button>
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
