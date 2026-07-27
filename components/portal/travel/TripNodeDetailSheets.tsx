'use client';

/**
 * 行程节点详情:航班 / 酒店 / 购物 / 打包 / 预算 —— 对齐设计稿屏 3–6。
 */

import { useState } from 'react';
import {
  refreshPackingAgainstInventory, pushPackingNeedsToShopping,
  type TripNode, type FlightPayload, type HotelPayload,
  type ShoppingPayload, type PackingPayload, type BudgetPayload,
} from '@/lib/portal/travel-trips';
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

export function FlightDetail({ flight, dict }: { flight: FlightPayload; dict: string }) {
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
      <div className="nesio-trip-banner nesio-trip-banner--calm">
        {L(dict, '值机提醒已设 · 航班变动会主动提醒(延误/登机口)。', 'Check-in set · Changes (delay/gate) will nudge you.')}
      </div>
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

  return (
    <div className="nesio-trip-detail">
      <div className="nesio-trip-mapfake" aria-hidden>
        <IconMapPin size={32} />
      </div>
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

export function ShoppingDetail({ shopping, dict }: { shopping: ShoppingPayload; dict: string }) {
  return (
    <div className="nesio-trip-detail">
      <p className="nesio-trip-detail-lede">
        {L(dict, '买了什么', 'What I bought')}
        {shopping.date || shopping.total != null
          ? ` · ${[shopping.date, shopping.total != null ? `${shopping.currency || '¥'}${shopping.total}` : ''].filter(Boolean).join(' · ')}`
          : ''}
      </p>
      <div className="nesio-trip-card nesio-trip-card--list">
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
      <div className="nesio-trip-banner nesio-trip-banner--go">
        {L(dict, '买到的会进物品库,并计入这次行程预算(购物类)。', 'Purchases land in inventory and this trip’s shopping budget.')}
      </div>
      <button
        type="button"
        className="nesio-trip-primary"
        onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-camera'))}
      >
        <IconCamera size={16} /> {L(dict, '拍小票 · 再记一笔', 'Snap receipt · add another')}
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
  const needs = packing.items.filter((i) => i.status === 'need');

  function refresh() {
    refreshPackingAgainstInventory(tripId, nodeId);
    onChanged();
  }

  function pushNeeds() {
    const n = pushPackingNeedsToShopping(tripId, nodeId);
    setMsg(n > 0
      ? L(dict, `已把「需买」${n} 样存进购物清单`, `Saved ${n} “to buy” items to shopping list`)
      : L(dict, '没有需买的', 'Nothing to buy'));
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
      </div>
      <button type="button" className="nesio-trip-primary" onClick={pushNeeds} disabled={!needs.length}>
        {L(dict, `把「需买」${needs.length} 样存进购物清单`, `Save ${needs.length} “to buy” to shopping list`)}
      </button>
      {msg && <p className="nesio-trip-msg" role="status">{msg}</p>}
      <p className="nesio-trip-footnote">
        {L(dict, '时长 × 天气 × 活动生成清单(类 PackPoint);对照物品库像做菜缺料。', 'Duration × weather × activity (PackPoint-like); need−have like cooking pantry gaps.')}
      </p>
    </div>
  );
}

export function BudgetDetail({ budget, dict }: { budget: BudgetPayload; dict: string }) {
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
          {L(dict, `本币 ${currency} · 当地币记、自动换算 · 已用 ${pct}% · ${remain >= 0 ? `还剩 ${currency}${remain.toLocaleString()}` : `超 ${currency}${Math.abs(remain).toLocaleString()}`}`,
            `Home ${currency} · local entry, auto FX · ${pct}% used · ${remain >= 0 ? `${currency}${remain.toLocaleString()} left` : `${currency}${Math.abs(remain).toLocaleString()} over`}`)}
        </p>
      </div>

      <div className="nesio-trip-section-head">
        <span>{L(dict, '按类别 · 实际 vs 预算', 'By category · actual vs budget')}</span>
        <button type="button" className="nesio-trip-link" onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-camera'))}>
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

      <p className="nesio-trip-footnote">
        {L(dict, 'Trip = 容器,花费挂这次行程(复用小票 OCR + 派生账本);再汇总进财务。', 'Trip is the container; spend hangs on it (receipt OCR + ledger), then rolls into Finance.')}
      </p>
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
  if (p.kind === 'flight') return <FlightDetail flight={p.flight} dict={dict} />;
  if (p.kind === 'hotel') return <HotelDetail hotel={p.hotel} dict={dict} />;
  if (p.kind === 'shopping') return <ShoppingDetail shopping={p.shopping} dict={dict} />;
  if (p.kind === 'packing') {
    return <PackingDetail tripId={tripId} nodeId={node.id} packing={p.packing} dict={dict} onChanged={onChanged} />;
  }
  if (p.kind === 'budget') return <BudgetDetail budget={p.budget} dict={dict} />;
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
    default: return node.title;
  }
}

/** 供时间线行图标用 */
export function NodeKindIcon({ kind, size = 16 }: { kind: TripNode['kind']; size?: number }) {
  switch (kind) {
    case 'flight': return <IconPlane size={size} />;
    case 'hotel': return <IconBed size={size} />;
    case 'shopping': return <IconCard size={size} />;
    case 'packing': return <IconBriefcase size={size} />;
    case 'budget': return <IconCard size={size} />;
    case 'transit': return <IconClockish size={size} />;
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
