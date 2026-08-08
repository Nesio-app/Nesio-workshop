'use client';

/**
 * 行程节点详情:航班 / 酒店 / 购物 / 打包 / 预算 —— 真功能(提醒/地图/小票/缺料)。
 */

import { useState } from 'react';
import {
  pushPackingNeedsToShopping,
  setFlightCheckInReminder, hasFlightCheckInReminder, armTravelReceiptCapture,
  generatePackingList, recomputeBudgetNode, updateNode, setCategoryBudget, removeTripNode,
  type TripNode, type FlightPayload, type HotelPayload,
  type ShoppingPayload, type ShoppingLine, type PackingPayload, type BudgetPayload, type PoiPayload, type TodoPayload,
} from '@/lib/portal/travel-trips';
import { poiTypeLabel } from '@/lib/portal/travel-poi';
import { listInventoryItems } from '@/lib/portal/inventory';
import SnapButton from '../SnapButton';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import {
  IconPlane, IconBed, IconMapPin, IconCard, IconBriefcase, IconCheckCircle,
  IconCamera, IconBox,
} from '../icons';

function Row({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === '') return null;
  return (
    <div className="nesio-trip-kv">
      <span className="nesio-trip-kv-k">{label}</span>
      <span className="nesio-trip-kv-v">{value}</span>
    </div>
  );
}

export function FlightDetail({
  tripId, nodeId, flight, dict, onChanged,
}: {
  tripId: string; nodeId: string; flight: FlightPayload; dict: string; onChanged?: () => void;
}) {
  const [reminded, setReminded] = useState(() => hasFlightCheckInReminder(tripId, nodeId));
  const [msg, setMsg] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(flight);

  function setReminder() {
    const ok = setFlightCheckInReminder(tripId, nodeId);
    if (!ok) {
      setMsg(L(dict, '没记下提醒,再试一次', 'Could not save reminder — try again'));
      return;
    }
    setReminded(true);
    setMsg(L(dict, '已记下值机提醒(起飞前会在本机提示)', 'Check-in reminder saved on this device'));
  }

  function saveFlight() {
    const title = `${draft.fromCode || draft.from} → ${draft.toCode || draft.to}`;
    updateNode(tripId, nodeId, {
      title,
      payload: { kind: 'flight', flight: draft },
    });
    setEdit(false);
    onChanged?.();
  }

  return (
    <div className="nesio-trip-detail">
      <div className="nesio-trip-detail-hero">
        <IconPlane size={28} />
        <div>
          <p className="nesio-trip-detail-route">{flight.fromCode || flight.from} → {flight.toCode || flight.to}</p>
          <p className="nesio-trip-detail-sub">{[flight.airline, flight.flightNo].filter(Boolean).join(' · ')}</p>
        </div>
        {flight.statusText && <span className="nesio-trip-status-pill">{flight.statusText}</span>}
      </div>
      <div className="nesio-trip-card">
        {edit ? (
          <>
            <label className="nesio-trip-kv"><span className="nesio-trip-kv-k">{L(dict, '出发', 'From')}</span>
              <input className="nesio-trip-kv-v" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} aria-label={L(dict, '出发', 'From')} /></label>
            <label className="nesio-trip-kv"><span className="nesio-trip-kv-k">{L(dict, '到达', 'To')}</span>
              <input className="nesio-trip-kv-v" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} aria-label={L(dict, '到达', 'To')} /></label>
            <label className="nesio-trip-kv"><span className="nesio-trip-kv-k">{L(dict, '航班号', 'Flight')}</span>
              <input className="nesio-trip-kv-v" value={draft.flightNo || ''} onChange={(e) => setDraft({ ...draft, flightNo: e.target.value })} aria-label={L(dict, '航班号', 'Flight')} /></label>
            <label className="nesio-trip-kv"><span className="nesio-trip-kv-k">{L(dict, '航司', 'Airline')}</span>
              <input className="nesio-trip-kv-v" value={draft.airline || ''} onChange={(e) => setDraft({ ...draft, airline: e.target.value })} aria-label={L(dict, '航司', 'Airline')} /></label>
            <label className="nesio-trip-kv"><span className="nesio-trip-kv-k">{L(dict, '座位', 'Seat')}</span>
              <input className="nesio-trip-kv-v" value={draft.seat || ''} onChange={(e) => setDraft({ ...draft, seat: e.target.value })} aria-label={L(dict, '座位', 'Seat')} /></label>
            <label className="nesio-trip-kv"><span className="nesio-trip-kv-k">{L(dict, '确认号', 'Confirmation')}</span>
              <input className="nesio-trip-kv-v" value={draft.confirmation || ''} onChange={(e) => setDraft({ ...draft, confirmation: e.target.value })} aria-label={L(dict, '确认号', 'Confirmation')} /></label>
            <div className="nesio-trip-actions">
              <button type="button" className="nesio-trip-action" onClick={() => { setEdit(false); setDraft(flight); }}>{L(dict, '取消', 'Cancel')}</button>
              <button type="button" className="nesio-trip-primary" onClick={saveFlight}>{L(dict, '保存', 'Save')}</button>
            </div>
          </>
        ) : (
          <>
            <Row label={L(dict, '航班号', 'Flight')} value={flight.flightNo} />
            <Row label={L(dict, '航司', 'Airline')} value={flight.airline} />
            <Row label={L(dict, '航站楼', 'Terminal')} value={flight.terminal} />
            <Row label={L(dict, '座位', 'Seat')} value={flight.seat} />
            <Row label={L(dict, '舱位', 'Cabin')} value={flight.cabin} />
            <Row label={L(dict, '确认号', 'Confirmation')} value={flight.confirmation} />
            <Row label={L(dict, '登机口', 'Gate')} value={flight.gate} />
            <button type="button" className="nesio-trip-action" onClick={() => setEdit(true)}>{L(dict, '编辑', 'Edit')}</button>
          </>
        )}
      </div>
      <button type="button" className="nesio-trip-primary" onClick={setReminder} disabled={reminded}>
        {reminded
          ? L(dict, '值机提醒已设', 'Check-in reminder on')
          : L(dict, '设值机提醒', 'Set check-in reminder')}
      </button>
      {msg && <p className="nesio-trip-msg" role="status">{msg}</p>}
    </div>
  );
}

export function HotelDetail({
  tripId, nodeId, hotel, dict, onChanged,
}: {
  tripId: string; nodeId: string; hotel: HotelPayload; dict: string; onChanged?: () => void;
}) {
  const total = (hotel.pricePerNight || 0) * (hotel.nights || 1);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(hotel);

  function saveHotel() {
    updateNode(tripId, nodeId, {
      title: `入住 · ${draft.name.trim()}`,
      subtitle: draft.pricePerNight != null ? `${draft.currency || '¥'}${draft.pricePerNight}` : undefined,
      payload: { kind: 'hotel', hotel: draft },
    });
    setEdit(false);
    onChanged?.();
  }

  const mapsUrl = hotel.lat != null && hotel.lon != null
    ? `https://maps.apple.com/?ll=${hotel.lat},${hotel.lon}&q=${encodeURIComponent(hotel.name)}`
    : hotel.address
      ? `https://maps.apple.com/?q=${encodeURIComponent(hotel.address)}`
      : null;
  const telUrl = hotel.phone ? `tel:${hotel.phone.replace(/\s/g, '')}` : null;
  const osmEmbed = hotel.lat != null && hotel.lon != null
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${hotel.lon - 0.01}%2C${hotel.lat - 0.008}%2C${hotel.lon + 0.01}%2C${hotel.lat + 0.008}&layer=mapnik&marker=${hotel.lat}%2C${hotel.lon}`
    : null;
  const searchMaps = hotel.address || hotel.name
    ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(hotel.address || hotel.name)}`
    : null;
  // bug3「地图没有显示」根因:没坐标时只给一块可点的假地图 —— 而订票导入拆出来的酒店
  // 十有八九没有 lat/lon。改成用地址/名字当查询直接嵌一张 OSM 图(mlat/mlon 缺失时
  // OSM 的 embed 需要 bbox,所以这里退一步用 search 页嵌入),点进去还是系统地图。
  const query = (hotel.address || hotel.name || '').trim();

  return (
    <div className="nesio-trip-detail">
      {osmEmbed ? (
        <iframe className="nesio-trip-map" title={hotel.name} src={osmEmbed} loading="lazy" />
      ) : (
        <a className="nesio-trip-mapfake" href={mapsUrl || searchMaps || '#'} target="_blank" rel="noreferrer">
          <IconMapPin size={32} />
          <span>{L(dict, '在地图里看位置', 'Open in maps')}</span>
          {/* 地址太粗(只有「北京」这种)时说清楚为什么没有小地图 —— 别让它像坏了 */}
          {query.length > 0 && query.length <= 4 && (
            <small>{L(dict, '地址只到城市 —— 补上街道就能显示小地图', 'Address is city-level — add the street to show a mini map')}</small>
          )}
        </a>
      )}
      <div className="nesio-trip-card">
        {edit ? (
          <>
            <label className="nesio-trip-kv"><span className="nesio-trip-kv-k">{L(dict, '酒店', 'Hotel')}</span>
              <input className="nesio-trip-kv-v" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label={L(dict, '酒店', 'Hotel')} /></label>
            <label className="nesio-trip-kv"><span className="nesio-trip-kv-k">{L(dict, '地址', 'Address')}</span>
              <input className="nesio-trip-kv-v" value={draft.address || ''} onChange={(e) => setDraft({ ...draft, address: e.target.value })} aria-label={L(dict, '地址', 'Address')} /></label>
            <label className="nesio-trip-kv"><span className="nesio-trip-kv-k">{L(dict, '每晚', 'Per night')}</span>
              <input className="nesio-trip-kv-v" inputMode="decimal" value={draft.pricePerNight ?? ''} onChange={(e) => setDraft({ ...draft, pricePerNight: Number(e.target.value) || undefined })} aria-label={L(dict, '每晚', 'Per night')} /></label>
            <label className="nesio-trip-kv"><span className="nesio-trip-kv-k">{L(dict, '晚数', 'Nights')}</span>
              <input className="nesio-trip-kv-v" inputMode="numeric" value={draft.nights ?? 1} onChange={(e) => setDraft({ ...draft, nights: Number(e.target.value) || 1 })} aria-label={L(dict, '晚数', 'Nights')} /></label>
            <label className="nesio-trip-kv"><span className="nesio-trip-kv-k">{L(dict, '入住', 'Check-in')}</span>
              <input className="nesio-trip-kv-v" value={draft.checkIn || ''} onChange={(e) => setDraft({ ...draft, checkIn: e.target.value })} aria-label={L(dict, '入住', 'Check-in')} /></label>
            <label className="nesio-trip-kv"><span className="nesio-trip-kv-k">{L(dict, '退房', 'Check-out')}</span>
              <input className="nesio-trip-kv-v" value={draft.checkOut || ''} onChange={(e) => setDraft({ ...draft, checkOut: e.target.value })} aria-label={L(dict, '退房', 'Check-out')} /></label>
            <label className="nesio-trip-kv"><span className="nesio-trip-kv-k">{L(dict, '确认号', 'Confirmation')}</span>
              <input className="nesio-trip-kv-v" value={draft.confirmation || ''} onChange={(e) => setDraft({ ...draft, confirmation: e.target.value })} aria-label={L(dict, '确认号', 'Confirmation')} /></label>
            <div className="nesio-trip-actions">
              <button type="button" className="nesio-trip-action" onClick={() => { setEdit(false); setDraft(hotel); }}>{L(dict, '取消', 'Cancel')}</button>
              <button type="button" className="nesio-trip-primary" onClick={saveHotel}>{L(dict, '保存', 'Save')}</button>
            </div>
          </>
        ) : (
          <>
            <Row label={L(dict, '酒店', 'Hotel')} value={hotel.name} />
            <Row label={L(dict, '地址', 'Address')} value={hotel.address} />
            <Row
              label={L(dict, '价格', 'Price')}
              value={hotel.pricePerNight != null
                ? `${hotel.currency || '¥'}${hotel.pricePerNight}/${L(dict, '晚', 'night')}${hotel.nights ? ` · ${hotel.nights} ${L(dict, '晚', 'nights')} = ${hotel.currency || '¥'}${total}` : ''}`
                : null}
            />
            <Row label={L(dict, '入住', 'Check-in')} value={hotel.checkIn} />
            <Row label={L(dict, '退房', 'Check-out')} value={hotel.checkOut} />
            <Row label={L(dict, '确认号', 'Confirmation')} value={hotel.confirmation} />
            <button type="button" className="nesio-trip-action" onClick={() => setEdit(true)}>{L(dict, '编辑', 'Edit')}</button>
          </>
        )}
      </div>
      <div className="nesio-trip-actions">
        {mapsUrl && (
          <a className="nesio-trip-action" href={mapsUrl} target="_blank" rel="noreferrer">
            <IconMapPin size={16} /> {L(dict, '导航', 'Navigate')}
          </a>
        )}
        {telUrl && (
          <a className="nesio-trip-action" href={telUrl}>
            <IconCard size={16} /> {L(dict, '打电话', 'Call')}
          </a>
        )}
      </div>
    </div>
  );
}

export function ShoppingDetail({
  tripId, nodeId, shopping, dict, onChanged,
}: {
  tripId: string; nodeId: string; shopping: ShoppingPayload; dict: string; onChanged?: () => void;
}) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(shopping);

  function saveShopping() {
    const total = draft.lines.reduce((s, l) => s + (l.price || 0), 0);
    updateNode(tripId, nodeId, {
      title: draft.title || L(dict, '购物', 'Shopping'),
      subtitle: total > 0 ? `${draft.currency || '¥'}${total}` : `${draft.lines.length} 样`,
      payload: {
        kind: 'shopping',
        shopping: { ...draft, total: total || undefined },
      },
    });
    recomputeBudgetNode(tripId);
    setEdit(false);
    onChanged?.();
  }

  function updateLine(i: number, patch: Partial<ShoppingLine>) {
    setDraft((d) => ({ ...d, lines: d.lines.map((ln, j) => (j === i ? { ...ln, ...patch } : ln)) }));
  }

  function addLine() {
    setDraft((d) => ({ ...d, lines: [...d.lines, { name: L(dict, '新条目', 'New item') }] }));
  }

  function removeLine(i: number) {
    setDraft((d) => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }));
  }

  const view = edit ? draft : shopping;
  const total = view.lines.reduce((s, l) => s + (l.price || 0), 0);

  return (
    <div className="nesio-trip-detail">
      <p className="nesio-trip-detail-lede">
        {L(dict, '买了什么', 'What I bought')}
        {view.date || total > 0
          ? ` · ${[view.date, total > 0 ? `${view.currency || '¥'}${total}` : ''].filter(Boolean).join(' · ')}`
          : ''}
      </p>
      {edit && (
        <label className="nesio-trip-kv" style={{ marginBottom: 'var(--space-2)' }}>
          <span className="nesio-trip-kv-k">{L(dict, '日期', 'Date')}</span>
          <input className="nesio-trip-kv-v" type="date" value={draft.date || ''} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
        </label>
      )}
      <div className="nesio-trip-card nesio-trip-card--list">
        {view.lines.length === 0 && (
          <p className="nesio-trip-footnote" style={{ padding: 'var(--space-3)' }}>{L(dict, '还没有条目 —— 拍小票识别后会加进来。', 'No lines yet — snap a receipt to add them.')}</p>
        )}
        {view.lines.map((line, i) => (
          <div key={i} className="nesio-trip-shop-row">
            <span className="nesio-trip-shop-ico"><IconBox size={16} /></span>
            <div className="nesio-trip-shop-main">
              {edit ? (
                <>
                  <input className="nesio-trip-kv-v" value={line.name} onChange={(e) => updateLine(i, { name: e.target.value })} aria-label={L(dict, '品名', 'Item')} />
                  <input className="nesio-trip-kv-v" value={line.note || ''} placeholder={L(dict, '备注', 'Note')} onChange={(e) => updateLine(i, { note: e.target.value })} aria-label={L(dict, '备注', 'Note')} />
                </>
              ) : (
                <>
                  <b>{line.name}</b>
                  {line.note && <small>{line.note}</small>}
                </>
              )}
            </div>
            {edit ? (
              <input className="nesio-trip-kv-v" style={{ width: 72 }} inputMode="decimal" value={line.price ?? ''} onChange={(e) => updateLine(i, { price: Number(e.target.value) || undefined })} aria-label={L(dict, '价格', 'Price')} />
            ) : (
              <span className="nesio-trip-shop-price">{line.price != null ? `${shopping.currency || '¥'}${line.price}` : ''}</span>
            )}
            {edit && (
              <button type="button" className="nesio-trip-action" aria-label={L(dict, '删除', 'Remove')} onClick={() => removeLine(i)}>×</button>
            )}
          </div>
        ))}
      </div>
      {edit ? (
        <div className="nesio-trip-actions">
          <button type="button" className="nesio-trip-action" onClick={addLine}>{L(dict, '加一行', 'Add line')}</button>
          <button type="button" className="nesio-trip-action" onClick={() => { setEdit(false); setDraft(shopping); }}>{L(dict, '取消', 'Cancel')}</button>
          <button type="button" className="nesio-trip-primary" onClick={saveShopping}>{L(dict, '保存', 'Save')}</button>
        </div>
      ) : (
        <>
          <button type="button" className="nesio-trip-action" onClick={() => setEdit(true)}>{L(dict, '编辑', 'Edit')}</button>
          <SnapButton className="nesio-trip-primary" beforeOpen={() => armTravelReceiptCapture(tripId)}
            ariaLabel={L(dict, '拍小票 · 记入本行程', 'Snap receipt · add to trip')}>
            <IconCamera size={16} /> {L(dict, '拍小票 · 记入本行程', 'Snap receipt · add to trip')}
          </SnapButton>
        </>
      )}
    </div>
  );
}

export function PackingDetail({
  tripId, nodeId, packing, dict, onChanged,
}: {
  tripId: string; nodeId: string; packing: PackingPayload; dict: string; onChanged: () => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openNeed, setOpenNeed] = useState<string | null>(null);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [newItem, setNewItem] = useState('');
  const needs = packing.items.filter((i) => i.status === 'need');

  function persistItems(items: typeof packing.items) {
    const needN = items.filter((i) => i.status === 'need').length;
    updateNode(tripId, nodeId, {
      subtitle: needN > 0 ? `${items.length} 样 · ${needN} 样需买` : `${items.length} 样 · 齐了`,
      state: needN > 0 ? 'todo' : 'booked',
      payload: { kind: 'packing', packing: { ...packing, items } },
    });
    onChanged();
  }

  /** 物品库里名字相近的候选(纯本地字符串包含,零云)。 */
  function candidates(name: string): Array<{ id: string; name: string; location: string }> {
    const q = name.trim().toLowerCase();
    if (!q) return [];
    const keys = q.split(/[\s/、,,]+/).filter((k) => k.length >= 2);
    return listInventoryItems()
      .filter((i) => {
        const n = i.name.trim().toLowerCase();
        return n.includes(q) || q.includes(n) || keys.some((k) => n.includes(k));
      })
      .slice(0, 8)
      .map((i) => ({ id: i.id, name: i.name, location: i.location || '' }));
  }

  /** 「就是这个」:把这一项标成已有 + 记下位置(以后自动对照就能对上这个名字)。 */
  function markHave(needName: string, invName: string, place: string) {
    const items = packing.items.map((it) => (it.name === needName
      ? { ...it, status: 'have' as const, name: invName, ...(place ? { place } : {}) }
      : it));
    persistItems(items);
    setOpenNeed(null);
  }

  function saveEditItem() {
    if (editIdx == null || !editName.trim()) return;
    const items = packing.items.map((it, i) => (i === editIdx ? { ...it, name: editName.trim() } : it));
    persistItems(items);
    setEditIdx(null);
    setEditName('');
  }

  function removeItem(idx: number) {
    persistItems(packing.items.filter((_, i) => i !== idx));
  }

  function addItem() {
    const name = newItem.trim();
    if (!name) return;
    persistItems([...packing.items, { name, status: 'need' as const }]);
    setNewItem('');
  }

  function pushNeeds() {
    setErr(null);
    try {
      const n = pushPackingNeedsToShopping(tripId, nodeId);
      setMsg(n > 0
        ? L(dict, `记下了 ${n} 样要买的`, `Saved ${n} items to buy`)
        : L(dict, '没有需买的', 'Nothing to buy'));
    } catch {
      setErr(L(dict, '没存进去,再试一次', 'Could not save — try again'));
    }
  }

  function regen() {
    generatePackingList(tripId);
    onChanged();
  }

  return (
    <div className="nesio-trip-detail">
      {packing.summary && (
        <div className="nesio-trip-banner nesio-trip-banner--gentle">{packing.summary}</div>
      )}
      {/* bug3:「要带 · need − have」这行删掉(清单本身就是要带的);每一项按物品库显示
          「需买」或者「在哪」,不再需要「对照物品库」按钮 —— 生成时已自动对照。 */}
      <div className="nesio-trip-card nesio-trip-card--list">
        {packing.items.map((it, i) => (
          <div key={i} className="nesio-trip-pack-row">
            <div className="nesio-trip-shop-main">
              {editIdx === i ? (
                <input
                  className="nesio-trip-kv-v"
                  value={editName}
                  autoFocus
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEditItem(); if (e.key === 'Escape') setEditIdx(null); }}
                  aria-label={L(dict, '物品名', 'Item name')}
                />
              ) : (
                <button type="button" className="nesio-trip-link" style={{ textAlign: 'left', padding: 0 }} onClick={() => { setEditIdx(i); setEditName(it.name); }}>
                  <b>{it.name}{it.reason ? `(${it.reason})` : ''}</b>
                </button>
              )}
              {it.status === 'have' && it.place && <small>{it.place}</small>}
            </div>
            {editIdx === i ? (
              <button type="button" className="nesio-trip-tag is-have" onClick={saveEditItem}>{L(dict, '保存', 'Save')}</button>
            ) : it.status === 'need' ? (
              /* bug3:「需买」可点 —— 点开在最下面给候选清单(同名物品/相近物品) */
              <button type="button" className="nesio-trip-tag is-need" aria-expanded={openNeed === it.name}
                onClick={() => setOpenNeed(openNeed === it.name ? null : it.name)}>
                {L(dict, '需买', 'To buy')}
              </button>
            ) : (
              <span className="nesio-trip-tag is-have">{it.place ? it.place : L(dict, '已有', 'Have')}</span>
            )}
            {editIdx !== i && (
              <button type="button" className="nesio-trip-link" aria-label={L(dict, '删除', 'Remove')} onClick={() => removeItem(i)}>✕</button>
            )}
          </div>
        ))}
      </div>
      <div className="nesio-trip-actions" style={{ marginTop: 'var(--space-2)' }}>
        <input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder=""
          aria-label={L(dict, '新物品', 'New item')}
          className="nesio-trip-kv-v"
          style={{ flex: 1 }}
          onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
        />
        <button type="button" className="nesio-trip-action" onClick={addItem}>{L(dict, '添加', 'Add')}</button>
      </div>

      {/* 点「需买」→ 候选清单落在最下面(物品库里名字相近的,可能就是它) */}
      {openNeed && (
        <div className="nesio-trip-card nesio-trip-card--list">
          <p className="nesio-trip-detail-lede" style={{ margin: 0, padding: 'var(--space-2)' }}>
            {L(dict, `「${openNeed}」的候选`, `Candidates for “${openNeed}”`)}
          </p>
          {candidates(openNeed).length === 0 ? (
            <p className="nesio-trip-footnote" style={{ padding: 'var(--space-3)' }}>
              {L(dict, '物品库里找不到相近的 —— 存入记忆后,以后拍到就能对上。', 'Nothing similar in your inventory — save it and future photos will match.')}
            </p>
          ) : candidates(openNeed).map((c) => (
            <div key={c.id} className="nesio-trip-shop-row">
              <span className="nesio-trip-shop-ico"><IconBox size={16} /></span>
              <div className="nesio-trip-shop-main">
                <b>{c.name}</b>
                {c.location && <small>{c.location}</small>}
              </div>
              <button type="button" className="nesio-trip-tag is-have" onClick={() => markHave(openNeed, c.name, c.location)}>
                {L(dict, '就是这个', "That's it")}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="nesio-trip-actions">
        <button type="button" className="nesio-trip-action" onClick={regen}>
          {L(dict, '重新生成', 'Regenerate')}
        </button>
      </div>
      {/* bug3:按钮改「存入记忆」—— 把候选清单里的「需买」记下来(仍进购物清单,那就是记忆里的一条) */}
      <button type="button" className="nesio-trip-primary" onClick={pushNeeds} disabled={!needs.length}>
        {L(dict, '存入记忆', 'Save to memory')}
      </button>
      {msg && <p className="nesio-trip-msg" role="status">{msg}</p>}
      {err && (
        <p className="nesio-trip-msg" role="alert" style={{ color: 'var(--status-risk)' }}>
          {err}
          <button type="button" className="nesio-trip-link" onClick={pushNeeds}>{L(dict, '重试', 'Retry')}</button>
        </p>
      )}
    </div>
  );
}

export function BudgetDetail({
  tripId, budget, dict, onChanged,
}: {
  tripId: string; budget: BudgetPayload; dict: string; onChanged: () => void;
}) {
  const currency = budget.currency || '¥';
  // bug3:「无法点无法编辑」—— 点一行进编辑,改这一类的预算(存 Trip.budgetByCategory,重算不抹)
  const [editCat, setEditCat] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const pct = budget.budgetTotal > 0 ? Math.min(100, Math.round((budget.actualTotal / budget.budgetTotal) * 100)) : 0;
  const remain = budget.budgetTotal - budget.actualTotal;

  return (
    <div className="nesio-trip-detail">
      <div className="nesio-trip-card">
        <div className="nesio-trip-budget-head">
          <span>{L(dict, '实际花费 / 预算', 'Actual / Budget')}</span>
          <b>{currency}{budget.actualTotal.toLocaleString()} / {budget.budgetTotal.toLocaleString()}</b>
        </div>
        <div className="nesio-trip-budget-bar" aria-hidden>
          <div className="nesio-trip-budget-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="nesio-trip-budget-meta">
          {L(dict, `已用 ${pct}% · ${remain >= 0 ? `还剩 ${currency}${remain.toLocaleString()}` : `超 ${currency}${Math.abs(remain).toLocaleString()}`}`,
            `${pct}% used · ${remain >= 0 ? `${currency}${remain.toLocaleString()} left` : `${currency}${Math.abs(remain).toLocaleString()} over`}`)}
        </p>
      </div>

      <div className="nesio-trip-section-head">
        <span>{L(dict, '按类别 · 实际 vs 预算', 'By category · actual vs budget')}</span>
        {/* bug3:「拍照没有直接进入拍一张的智能相机 / 拍照按钮启动口不对」——
            SnapButton 自己在用户手势里调起系统相机,拿到图再交给识别页,不再停在选择页。 */}
        <SnapButton
          className="nesio-trip-link"
          label={L(dict, '拍小票入账', 'Scan receipt')}
          beforeOpen={() => armTravelReceiptCapture(tripId)}
        />
      </div>

      {budget.categories.map((c) => {
        const over = c.actual > c.budget;
        const delta = Math.abs(c.actual - c.budget);
        const fill = c.budget > 0 ? Math.min(100, (c.actual / c.budget) * 100) : 0;
        const editing = editCat === c.id;
        return (
          <div key={c.id} className="nesio-trip-card nesio-trip-cat">
            <button type="button" className="nesio-trip-cat-top" style={{ width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit' }}
              aria-expanded={editing}
              onClick={() => { setEditCat(editing ? null : c.id); setDraft(String(c.budget)); }}>
              <span className="nesio-trip-cat-ico">{c.id === 'flight' ? <IconPlane size={16} /> : c.id === 'stay' ? <IconBed size={16} /> : <IconCard size={16} />}</span>
              <b>{c.label}</b>
              <span>{currency}{c.actual.toLocaleString()} / {c.budget.toLocaleString()}</span>
            </button>
            <div className={`nesio-trip-budget-bar${over ? ' is-over' : ''}`} aria-hidden>
              <div className="nesio-trip-budget-bar-fill" style={{ width: `${fill}%` }} />
            </div>
            {editing ? (
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginTop: 'var(--space-2)' }}>
                <input type="number" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)}
                  aria-label={L(dict, `${c.label}预算`, `${c.label} budget`)}
                  style={{ flex: 1, minWidth: 0, padding: 'var(--space-2) var(--space-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-ink)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)' }} />
                <button type="button" className="nesio-trip-primary" style={{ flex: '0 0 auto' }}
                  onClick={() => { setCategoryBudget(tripId, c.id, Number(draft) || 0); setEditCat(null); onChanged(); }}>
                  {L(dict, '存', 'Save')}
                </button>
                <button type="button" className="nesio-trip-action" style={{ flex: '0 0 auto' }} onClick={() => setEditCat(null)}>
                  {L(dict, '取消', 'Cancel')}
                </button>
              </div>
            ) : (
              <div className={`nesio-trip-cat-note${over ? ' is-over' : ''}`}>
                {over
                  ? L(dict, `超 ${currency}${delta.toLocaleString()}`, `Over ${currency}${delta.toLocaleString()}`)
                  : L(dict, `剩 ${currency}${delta.toLocaleString()}`, `${currency}${delta.toLocaleString()} left`)}
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        className="nesio-trip-action"
        onClick={() => { recomputeBudgetNode(tripId); onChanged(); }}
      >
        {L(dict, '按节点重算预算', 'Recompute from nodes')}
      </button>
    </div>
  );
}

export function PoiDetail({
  tripId, nodeId, poi, visited, dict, onChanged,
}: {
  tripId: string; nodeId: string; poi: PoiPayload; visited: boolean; dict: string; onChanged: () => void;
}) {
  const zh = dict !== 'en';
  const mapsUrl = `https://maps.apple.com/?ll=${poi.lat},${poi.lon}&q=${encodeURIComponent(poi.name)}`;
  const osmEmbed = `https://www.openstreetmap.org/export/embed.html?bbox=${poi.lon - 0.012}%2C${poi.lat - 0.01}%2C${poi.lon + 0.012}%2C${poi.lat + 0.01}&layer=mapnik&marker=${poi.lat}%2C${poi.lon}`;
  const wikiUrl = poi.wikidata
    ? `https://www.wikidata.org/wiki/${encodeURIComponent(poi.wikidata)}`
    : null;

  function markVisited() {
    updateNode(tripId, nodeId, {
      state: 'booked',
      subtitle: L(dict, '已去过', 'Visited'),
    });
    onChanged();
  }

  return (
    <div className="nesio-trip-detail">
      <iframe className="nesio-trip-map" title={poi.name} src={osmEmbed} loading="lazy" />
      <div className="nesio-trip-detail-hero">
        <IconMapPin size={28} />
        <div>
          <p className="nesio-trip-detail-route">{poi.name}</p>
          <p className="nesio-trip-detail-sub">
            {[poiTypeLabel(poi.type, zh), poi.country].filter(Boolean).join(' · ')}
          </p>
        </div>
        {visited && <span className="nesio-trip-status-pill">{L(dict, '已去过', 'Visited')}</span>}
      </div>
      <div className="nesio-trip-card">
        <Row label={L(dict, '类型', 'Type')} value={poiTypeLabel(poi.type, zh)} />
        <Row label={L(dict, '国家', 'Country')} value={poi.country} />
        <Row label="Lat / Lon" value={`${poi.lat.toFixed(5)}, ${poi.lon.toFixed(5)}`} />
        <Row label="Wikidata" value={poi.wikidata} />
      </div>
      <p className="nesio-trip-footnote">
        {L(dict, '坐标来自随包离线库,无网也能加入行程;打开地图/百科需要网络。', 'Coords come from the offline pack; maps/wiki need network.')}
      </p>
      <div className="nesio-trip-actions">
        <a className="nesio-trip-action" href={mapsUrl} target="_blank" rel="noreferrer">
          <IconMapPin size={16} /> {L(dict, '导航', 'Navigate')}
        </a>
        {wikiUrl && (
          <a className="nesio-trip-action" href={wikiUrl} target="_blank" rel="noreferrer">
            {L(dict, 'Wikidata', 'Wikidata')}
          </a>
        )}
      </div>
      {!visited && (
        <button type="button" className="nesio-trip-primary" onClick={markVisited}>
          <IconCheckCircle size={16} /> {L(dict, '标记已去过', 'Mark visited')}
        </button>
      )}
    </div>
  );
}

export function TripNodeDetailBody({
  tripId, node, onChanged,
}: {
  tripId: string; node: TripNode; onChanged: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const p = node.payload;
  if (p.kind === 'flight') return <FlightDetail tripId={tripId} nodeId={node.id} flight={p.flight} dict={dict} onChanged={onChanged} />;
  if (p.kind === 'hotel') return <HotelDetail tripId={tripId} nodeId={node.id} hotel={p.hotel} dict={dict} onChanged={onChanged} />;
  if (p.kind === 'shopping') return <ShoppingDetail tripId={tripId} nodeId={node.id} shopping={p.shopping} dict={dict} onChanged={onChanged} />;
  if (p.kind === 'packing') {
    return <PackingDetail tripId={tripId} nodeId={node.id} packing={p.packing} dict={dict} onChanged={onChanged} />;
  }
  if (p.kind === 'budget') return <BudgetDetail tripId={tripId} budget={p.budget} dict={dict} onChanged={onChanged} />;
  if (p.kind === 'poi') {
    return (
      <PoiDetail
        tripId={tripId}
        nodeId={node.id}
        poi={p.poi}
        visited={node.state === 'booked'}
        dict={dict}
        onChanged={onChanged}
      />
    );
  }
  if (p.kind === 'transit') {
    return (
      <div className="nesio-trip-detail">
        <div className="nesio-trip-card">
          <Row label={L(dict, '中转', 'Layover')} value={p.transit.label} />
          <Row label={L(dict, '时长', 'Duration')} value={p.transit.durationMin != null ? `${p.transit.durationMin} ${L(dict, '分钟', 'min')}` : null} />
        </div>
      </div>
    );
  }
  return <TodoDetail tripId={tripId} nodeId={node.id} todo={p.todo} dict={dict} onChanged={onChanged} />;
}

/**
 * 待办详情(bug3:「输入后需要可以点开再次编辑或者删除」)。
 * 原来点开只是把标题原样念一遍 —— 加错一个字就只能干看着。
 */
function TodoDetail({ tripId, nodeId, todo, dict, onChanged }: {
  tripId: string; nodeId: string; todo: TodoPayload; dict: string; onChanged: () => void;
}) {
  const [title, setTitle] = useState(todo.title);
  const [detail, setDetail] = useState(todo.detail || '');
  const [saved, setSaved] = useState(false);
  const dirty = title.trim() !== todo.title || detail.trim() !== (todo.detail || '');

  return (
    <div className="nesio-trip-detail">
      <div className="nesio-trip-card" style={{ padding: 'var(--space-3)', display: 'grid', gap: 'var(--space-2)' }}>
        <label style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <span className="nesio-trip-kv-k">{L(dict, '待办', 'To-do')}</span>
          <input className="nesio-rel-rec-input" value={title} maxLength={80} onChange={(e) => { setTitle(e.target.value); setSaved(false); }} />
        </label>
        <label style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <span className="nesio-trip-kv-k">{L(dict, '说明', 'Notes')}</span>
          <input className="nesio-rel-rec-input" value={detail} maxLength={160} onChange={(e) => { setDetail(e.target.value); setSaved(false); }} />
        </label>
      </div>
      {saved && <p className="nesio-trip-msg" role="status">{L(dict, '改好了', 'Saved')}</p>}
      <button type="button" className="nesio-trip-primary" disabled={!dirty || !title.trim()}
        onClick={() => {
          const t = title.trim();
          updateNode(tripId, nodeId, {
            title: t,
            payload: { kind: 'todo', todo: { title: t, ...(detail.trim() ? { detail: detail.trim() } : {}) } },
          });
          setSaved(true);
          onChanged();
        }}>
        {L(dict, '保存修改', 'Save changes')}
      </button>
      <div className="nesio-trip-actions">
        <button type="button" className="nesio-trip-action" style={{ color: 'var(--status-risk)' }}
          onClick={() => {
            if (!confirm(L(dict, `删掉「${todo.title}」?`, `Delete “${todo.title}”?`))) return;
            removeTripNode(tripId, nodeId);
            onChanged();
          }}>
          {L(dict, '删掉这条', 'Delete')}
        </button>
      </div>
    </div>
  );
}

export function nodeDetailTitle(node: TripNode, dict: string): string {
  switch (node.kind) {
    case 'flight': return L(dict, '航班详情', 'Flight');
    case 'hotel': return L(dict, '酒店详情', 'Hotel');
    case 'shopping': return L(dict, '购物详情', 'Shopping');
    case 'packing': return L(dict, '打包清单', 'Packing list');
    case 'budget': return L(dict, '行程预算', 'Trip budget');
    case 'transit': return L(dict, '中转', 'Layover');
    case 'poi': return L(dict, '景点详情', 'Sight');
    default: return node.title;
  }
}

export function NodeKindIcon({ kind, size = 16 }: { kind: TripNode['kind']; size?: number }) {
  switch (kind) {
    case 'flight': return <IconPlane size={size} />;
    case 'hotel': return <IconBed size={size} />;
    case 'shopping': return <IconCard size={size} />;
    case 'packing': return <IconBriefcase size={size} />;
    case 'budget': return <IconCard size={size} />;
    case 'transit': return <IconClockish size={size} />;
    case 'poi': return <IconMapPin size={size} />;
    default: return <IconCheckCircle size={size} />;
  }
}

function IconClockish({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  );
}
