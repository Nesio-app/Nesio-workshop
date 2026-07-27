'use client';

/**
 * 行程节点详情:航班 / 酒店 / 购物 / 打包 / 预算 —— 真功能(提醒/地图/小票/缺料)。
 */

import { useState } from 'react';
import {
  refreshPackingAgainstInventory, pushPackingNeedsToShopping,
  setFlightCheckInReminder, hasFlightCheckInReminder, armTravelReceiptCapture,
  generatePackingList, recomputeBudgetNode, updateNode,
  type TripNode, type FlightPayload, type HotelPayload,
  type ShoppingPayload, type PackingPayload, type BudgetPayload, type PoiPayload,
} from '@/lib/portal/travel-trips';
import { poiTypeLabel } from '@/lib/portal/travel-poi';
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
  tripId, nodeId, flight, dict,
}: {
  tripId: string; nodeId: string; flight: FlightPayload; dict: string;
}) {
  const [reminded, setReminded] = useState(() => hasFlightCheckInReminder(tripId, nodeId));
  const [msg, setMsg] = useState<string | null>(null);

  function setReminder() {
    const ok = setFlightCheckInReminder(tripId, nodeId);
    if (!ok) {
      setMsg(L(dict, '没记下提醒,再试一次', 'Could not save reminder — try again'));
      return;
    }
    setReminded(true);
    setMsg(L(dict, '已记下值机提醒(起飞前会在本机提示)', 'Check-in reminder saved on this device'));
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
        <Row label={L(dict, '航班号', 'Flight')} value={flight.flightNo} />
        <Row label={L(dict, '航司', 'Airline')} value={flight.airline} />
        <Row label={L(dict, '航站楼', 'Terminal')} value={flight.terminal} />
        <Row label={L(dict, '座位', 'Seat')} value={flight.seat} />
        <Row label={L(dict, '舱位', 'Cabin')} value={flight.cabin} />
        <Row label={L(dict, '确认号', 'Confirmation')} value={flight.confirmation} />
        <Row label={L(dict, '登机口', 'Gate')} value={flight.gate} />
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

export function HotelDetail({ hotel, dict }: { hotel: HotelPayload; dict: string }) {
  const total = (hotel.pricePerNight || 0) * (hotel.nights || 1);
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

  return (
    <div className="nesio-trip-detail">
      {osmEmbed ? (
        <iframe className="nesio-trip-map" title={hotel.name} src={osmEmbed} loading="lazy" />
      ) : (
        <a className="nesio-trip-mapfake" href={searchMaps || mapsUrl || '#'} target="_blank" rel="noreferrer">
          <IconMapPin size={32} />
          <span>{L(dict, '在地图里看位置', 'Open in maps')}</span>
        </a>
      )}
      <div className="nesio-trip-card">
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
  tripId, shopping, dict,
}: {
  tripId: string; shopping: ShoppingPayload; dict: string;
}) {
  return (
    <div className="nesio-trip-detail">
      <p className="nesio-trip-detail-lede">
        {L(dict, '买了什么', 'What I bought')}
        {shopping.date || shopping.total != null
          ? ` · ${[shopping.date, shopping.total != null ? `${shopping.currency || '¥'}${shopping.total}` : ''].filter(Boolean).join(' · ')}`
          : ''}
      </p>
      <div className="nesio-trip-card nesio-trip-card--list">
        {shopping.lines.length === 0 && (
          <p className="nesio-trip-footnote" style={{ padding: '0.8rem' }}>{L(dict, '还没有条目 —— 拍小票识别后会加进来。', 'No lines yet — snap a receipt to add them.')}</p>
        )}
        {shopping.lines.map((line, i) => (
          <div key={i} className="nesio-trip-shop-row">
            <span className="nesio-trip-shop-ico"><IconBox size={16} /></span>
            <div className="nesio-trip-shop-main">
              <b>{line.name}</b>
              {line.note && <small>{line.note}</small>}
            </div>
            <span className="nesio-trip-shop-price">{line.price != null ? `${shopping.currency || '¥'}${line.price}` : ''}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="nesio-trip-primary"
        onClick={() => {
          armTravelReceiptCapture(tripId);
          window.dispatchEvent(new CustomEvent('nesio-open-camera'));
        }}
      >
        <IconCamera size={16} /> {L(dict, '拍小票 · 记入本行程', 'Snap receipt · add to trip')}
      </button>
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
  const needs = packing.items.filter((i) => i.status === 'need');

  function refresh() {
    refreshPackingAgainstInventory(tripId, nodeId);
    onChanged();
  }

  function pushNeeds() {
    setErr(null);
    try {
      const n = pushPackingNeedsToShopping(tripId, nodeId);
      setMsg(n > 0
        ? L(dict, `已把「需买」${n} 样存进购物清单`, `Saved ${n} “to buy” items to shopping list`)
        : L(dict, '没有需买的', 'Nothing to buy'));
    } catch {
      setErr(L(dict, '没存进购物清单,再试一次', 'Could not save to shopping list — try again'));
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
      <p className="nesio-trip-detail-lede">{L(dict, '要带 · need − have', 'To bring · need − have')}</p>
      <div className="nesio-trip-card nesio-trip-card--list">
        {packing.items.map((it, i) => (
          <div key={i} className="nesio-trip-pack-row">
            <div className="nesio-trip-shop-main">
              <b>{it.name}{it.reason ? `(${it.reason})` : ''}</b>
              {it.status === 'need' && <small>{L(dict, '物品里没有', 'Not in inventory')}</small>}
            </div>
            <span className={`nesio-trip-tag${it.status === 'have' ? ' is-have' : ' is-need'}`}>
              {it.status === 'have' ? L(dict, '已有', 'Have') : L(dict, '需买', 'To buy')}
            </span>
          </div>
        ))}
      </div>
      <div className="nesio-trip-actions">
        <button type="button" className="nesio-trip-action" onClick={refresh}>
          <IconCheckCircle size={16} /> {L(dict, '对照物品库', 'Match inventory')}
        </button>
        <button type="button" className="nesio-trip-action" onClick={regen}>
          {L(dict, '重新生成', 'Regenerate')}
        </button>
      </div>
      <button type="button" className="nesio-trip-primary" onClick={pushNeeds} disabled={!needs.length}>
        {L(dict, `把「需买」${needs.length} 样存进购物清单`, `Save ${needs.length} “to buy” to shopping list`)}
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
        <button
          type="button"
          className="nesio-trip-link"
          onClick={() => {
            armTravelReceiptCapture(tripId);
            window.dispatchEvent(new CustomEvent('nesio-open-camera'));
          }}
        >
          {L(dict, '拍小票入账', 'Scan receipt')}
        </button>
      </div>

      {budget.categories.map((c) => {
        const over = c.actual > c.budget;
        const delta = Math.abs(c.actual - c.budget);
        const fill = c.budget > 0 ? Math.min(100, (c.actual / c.budget) * 100) : 0;
        return (
          <div key={c.id} className="nesio-trip-card nesio-trip-cat">
            <div className="nesio-trip-cat-top">
              <span className="nesio-trip-cat-ico">{c.id === 'flight' ? <IconPlane size={16} /> : c.id === 'stay' ? <IconBed size={16} /> : <IconCard size={16} />}</span>
              <b>{c.label}</b>
              <span>{currency}{c.actual.toLocaleString()} / {c.budget.toLocaleString()}</span>
            </div>
            <div className={`nesio-trip-budget-bar${over ? ' is-over' : ''}`} aria-hidden>
              <div className="nesio-trip-budget-bar-fill" style={{ width: `${fill}%` }} />
            </div>
            <div className={`nesio-trip-cat-note${over ? ' is-over' : ''}`}>
              {over
                ? L(dict, `超 ${currency}${delta.toLocaleString()}`, `Over ${currency}${delta.toLocaleString()}`)
                : L(dict, `剩 ${currency}${delta.toLocaleString()}`, `${currency}${delta.toLocaleString()} left`)}
            </div>
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
  if (p.kind === 'flight') return <FlightDetail tripId={tripId} nodeId={node.id} flight={p.flight} dict={dict} />;
  if (p.kind === 'hotel') return <HotelDetail hotel={p.hotel} dict={dict} />;
  if (p.kind === 'shopping') return <ShoppingDetail tripId={tripId} shopping={p.shopping} dict={dict} />;
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
  return (
    <div className="nesio-trip-detail">
      <div className="nesio-trip-card">
        <Row label={L(dict, '待办', 'To-do')} value={p.todo.title} />
        <Row label={L(dict, '说明', 'Notes')} value={p.todo.detail} />
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
