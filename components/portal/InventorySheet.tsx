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
import LocationPicker from './LocationPicker';
import {
  addInventoryItem,
  expiryStatus,
  listInventoryItems,
  removeInventoryItem,
  updateInventoryItem,
  type InventoryItem,
} from '@/lib/portal/inventory';

interface InventorySheetProps {
  open: boolean;
  onClose: () => void;
}

const ALL = '__all__';
const UNPLACED = '__unplaced__';

export default function InventorySheet({ open, onClose }: InventorySheetProps) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [groupFilter, setGroupFilter] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'add' | 'detail'>('list');
  const [detailId, setDetailId] = useState<string | null>(null);

  // 加物品表单
  const [fName, setFName] = useState('');
  const [fLocation, setFLocation] = useState('');
  const [fQty, setFQty] = useState('');
  const [fExpiry, setFExpiry] = useState('');
  const [fNote, setFNote] = useState('');

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
  const detail = detailId ? items.find((i) => i.id === detailId) ?? null : null;

  if (!open) return null;

  const resetForm = () => { setFName(''); setFLocation(''); setFQty(''); setFExpiry(''); setFNote(''); };

  const submitAdd = () => {
    if (!fName.trim()) return;
    addInventoryItem({
      name: fName,
      location: fLocation || undefined,
      quantity: fQty ? parseInt(fQty, 10) : undefined,
      expiry: fExpiry || undefined,
      note: fNote || undefined,
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
      <div className="nesio-freeze-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="nesio-freeze-header">
          <span className="nesio-freeze-title">📦 {L(dict, '收纳', 'Storage')}</span>
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
            </div>

            {visible.length === 0 ? (
              <p className="nesio-freeze-empty" style={{ padding: '1.6rem 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                {query
                  ? L(dict, '没找到。换个词试试?', 'Nothing found. Try another word?')
                  : L(dict, '还没有物品。点下面「记一件」,或用「拍一下」拍张照直接识别。', 'No items yet. Tap "Add one" below, or snap a photo to recognize.')}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '46vh', overflowY: 'auto', paddingBottom: 4 }}>
                {visible.map((i) => {
                  const exp = expiryStatus(i);
                  return (
                    <button
                      key={i.id}
                      type="button"
                      onClick={() => { setDetailId(i.id); setView('detail'); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%',
                        padding: '0.6rem 0.7rem', borderRadius: 12,
                        border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
                        background: 'var(--glass-bg, rgba(255,255,255,0.04))', color: 'var(--text-primary)',
                      }}
                    >
                      <span style={{ fontSize: '1.15rem' }}>{i.hasPhoto ? '🖼️' : '📦'}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {i.name}{i.quantity != null ? ` ×${i.quantity}` : ''}
                        </span>
                        <span style={{ display: 'block', fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>
                          {i.location || L(dict, '未归位 · 点开设置位置', 'Unplaced · tap to set')}
                        </span>
                      </span>
                      {exp && (
                        <span style={{ fontSize: '0.7rem', color: exp === 'expired' ? 'var(--status-stop, #ef4444)' : 'var(--status-warn, #f59e0b)' }}>
                          {exp === 'expired' ? L(dict, '已过期', 'Expired') : L(dict, '临期', 'Soon')}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <button type="button" className="nesio-freeze-primary-btn" style={{ width: '100%', marginTop: '0.7rem' }} onClick={() => { resetForm(); setView('add'); }}>
              ＋ {L(dict, '记一件', 'Add one')}
            </button>
          </>
        )}

        {view === 'add' && (
          <div style={{ maxHeight: '58vh', overflowY: 'auto' }}>
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
            <label style={label}>{L(dict, '备注(可选)', 'Note (optional)')}</label>
            <input className="nesio-ob-input" value={fNote} onChange={(e) => setFNote(e.target.value)} placeholder={L(dict, '例:被压在护手霜下面', 'e.g. under the hand cream')} />
            <button type="button" className="nesio-freeze-primary-btn" style={{ width: '100%', marginTop: '1rem', opacity: fName.trim() ? 1 : 0.5 }} disabled={!fName.trim()} onClick={submitAdd}>
              {L(dict, '存进收纳', 'Save to storage')}
            </button>
          </div>
        )}

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
  const exp = expiryStatus(item);

  const save = () => {
    updateInventoryItem(item.id, {
      location,
      quantity: qty ? parseInt(qty, 10) : null as unknown as number | undefined,
      expiry,
      note,
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
      <label style={label}>{L(dict, '备注', 'Note')}</label>
      <input className="nesio-ob-input" value={note} onChange={(e) => setNote(e.target.value)} />
      <button type="button" className="nesio-freeze-primary-btn" style={{ width: '100%', marginTop: '1rem' }} onClick={save}>
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
