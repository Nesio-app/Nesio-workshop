'use client';

/**
 * 行程时间线 — 竖轴 + 添加节点 + 详情。
 */

import { useEffect, useState } from 'react';
import {
  getTrip, completeTrip, addTripNode, generatePackingList, importBookingIntoTrip,
  recomputeBudgetNode, groupNodesByDay, TRAVEL_TRIPS_UPDATED_EVENT,
  type Trip, type TripNode,
} from '@/lib/portal/travel-trips';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import NesioSheet from '../ui/NesioSheet';
import { IconChevronRight, IconCard } from '../icons';
import { NodeKindIcon, TripNodeDetailBody, nodeDetailTitle } from './TripNodeDetailSheets';
import TripPoiPicker from './TripPoiPicker';

type AddKind = 'flight' | 'hotel' | 'todo' | 'import' | 'poi' | null;

export default function TripTimelineSheet({
  tripId, open, onClose,
}: {
  tripId: string | null; open: boolean; onClose: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [trip, setTrip] = useState<Trip | null>(null);
  const [detailNode, setDetailNode] = useState<TripNode | null>(null);
  const [adding, setAdding] = useState<AddKind>(null);
  const [err, setErr] = useState<string | null>(null);

  // add forms
  const [fNo, setFNo] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fTime, setFTime] = useState('');
  const [hName, setHName] = useState('');
  const [hAddr, setHAddr] = useState('');
  const [hPrice, setHPrice] = useState('');
  const [todoTitle, setTodoTitle] = useState('');
  const [paste, setPaste] = useState('');

  function reload() {
    if (!tripId) { setTrip(null); return; }
    setTrip(getTrip(tripId));
  }

  useEffect(() => {
    if (!open || !tripId) return;
    reload();
    const onUp = () => reload();
    window.addEventListener(TRAVEL_TRIPS_UPDATED_EVENT, onUp);
    return () => window.removeEventListener(TRAVEL_TRIPS_UPDATED_EVENT, onUp);
  }, [open, tripId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) { setDetailNode(null); setAdding(null); setErr(null); }
  }, [open]);

  if (!tripId) return null;

  const groups = trip ? groupNodesByDay(trip.nodes.filter((n) => n.kind !== 'budget')) : [];
  const budgetNode = trip?.nodes.find((n) => n.kind === 'budget') ?? null;

  function addFlight() {
    if (!trip) return;
    const flightNo = fNo.trim().toUpperCase();
    if (!flightNo) { setErr(L(dict, '填航班号', 'Flight number needed')); return; }
    addTripNode(trip.id, {
      kind: 'flight', state: 'booked',
      timeLabel: fTime.trim() || '',
      dayKey: 'd1', dayLabel: L(dict, '行程日', 'Trip day'),
      title: (fFrom && fTo) ? `${fFrom.trim()} → ${fTo.trim()}` : `航班 ${flightNo}`,
      subtitle: flightNo,
      payload: {
        kind: 'flight',
        flight: {
          from: fFrom.trim(), to: fTo.trim(),
          fromCode: fFrom.trim().length === 3 ? fFrom.trim().toUpperCase() : undefined,
          toCode: fTo.trim().length === 3 ? fTo.trim().toUpperCase() : undefined,
          flightNo, statusText: L(dict, '已订', 'Booked'),
        },
      },
    });
    recomputeBudgetNode(trip.id);
    setAdding(null); setFNo(''); setFFrom(''); setFTo(''); setFTime(''); setErr(null);
    reload();
  }

  function addHotel() {
    if (!trip) return;
    const name = hName.trim();
    if (!name) { setErr(L(dict, '填酒店名', 'Hotel name needed')); return; }
    const price = Number(hPrice) || undefined;
    addTripNode(trip.id, {
      kind: 'hotel', state: 'booked',
      timeLabel: '',
      dayKey: 'd1', dayLabel: L(dict, '行程日', 'Trip day'),
      title: `入住 · ${name}`,
      subtitle: price != null ? `¥${price}` : undefined,
      payload: {
        kind: 'hotel',
        hotel: { name, address: hAddr.trim() || undefined, pricePerNight: price, nights: 1, currency: '¥' },
      },
    });
    recomputeBudgetNode(trip.id);
    setAdding(null); setHName(''); setHAddr(''); setHPrice(''); setErr(null);
    reload();
  }

  function addTodo() {
    if (!trip) return;
    const title = todoTitle.trim();
    if (!title) { setErr(L(dict, '填待办', 'To-do title needed')); return; }
    addTripNode(trip.id, {
      kind: 'todo', state: 'todo',
      timeLabel: '',
      dayKey: '_pre', dayLabel: L(dict, '出发前', 'Before departure'),
      title,
      payload: { kind: 'todo', todo: { title } },
    });
    setAdding(null); setTodoTitle(''); setErr(null);
    reload();
  }

  function addImport() {
    if (!trip) return;
    const n = importBookingIntoTrip(trip.id, paste);
    if (n <= 0) { setErr(L(dict, '没识别出航班/酒店', 'No flight/hotel found')); return; }
    setAdding(null); setPaste(''); setErr(null);
    reload();
  }

  function onPack() {
    if (!trip) return;
    generatePackingList(trip.id);
    reload();
  }

  return (
    <>
      <NesioSheet
        variant="bottom"
        open={open}
        onOpenChange={(v) => { if (!v) onClose(); }}
        card={false}
        className="nesio-settings-sheet-card nesio-trip-sheet-card"
        ariaLabel={trip?.title || L(dict, '行程', 'Trip')}
      >
        <div className="nesio-trip-sheet">
          <header className="nesio-trip-sheet-head">
            <button type="button" className="nesio-trip-back" onClick={onClose}>
              ‹ {L(dict, '计划', 'Plans')}
            </button>
            <h2 className="nesio-trip-sheet-title">{trip?.title || '…'}</h2>
            <div className="nesio-trip-sheet-tools">
              {budgetNode && (
                <button type="button" className="nesio-trip-iconbtn" aria-label={L(dict, '行程预算', 'Budget')} onClick={() => setDetailNode(budgetNode)}>
                  <IconCard size={18} />
                </button>
              )}
              {trip && trip.status !== 'completed' && (
                <button
                  type="button"
                  className="nesio-trip-textbtn"
                  onClick={() => { completeTrip(trip.id); onClose(); }}
                >
                  {L(dict, '完成 · 进世界', 'Done · to World')}
                </button>
              )}
            </div>
          </header>

          {!trip && <p className="nesio-trip-empty">{L(dict, '找不到这趟行程', 'Trip not found')}</p>}

          {trip && (
            <>
              <div className="nesio-trip-addbar">
                <button type="button" className="nesio-trip-action" onClick={() => { setAdding('flight'); setErr(null); }}>{L(dict, '+ 航班', '+ Flight')}</button>
                <button type="button" className="nesio-trip-action" onClick={() => { setAdding('hotel'); setErr(null); }}>{L(dict, '+ 酒店', '+ Hotel')}</button>
                <button type="button" className="nesio-trip-action" onClick={() => { setAdding('todo'); setErr(null); }}>{L(dict, '+ 待办', '+ To-do')}</button>
                <button type="button" className="nesio-trip-action" onClick={() => { setAdding('poi'); setErr(null); }}>{L(dict, '+ 离线景点', '+ Offline sights')}</button>
                <button type="button" className="nesio-trip-action" onClick={onPack}>{L(dict, '生成打包', 'Packing list')}</button>
                <button type="button" className="nesio-trip-action" onClick={() => { setAdding('import'); setErr(null); }}>{L(dict, '粘贴确认', 'Paste booking')}</button>
              </div>

              {adding === 'poi' && (
                <TripPoiPicker
                  tripId={trip.id}
                  destination={trip.destination}
                  onAdded={() => { reload(); }}
                  onClose={() => setAdding(null)}
                />
              )}

              {adding && adding !== 'poi' && (
                <div className="nesio-travel-plan-form">
                  {adding === 'flight' && (
                    <>
                      <label><span>{L(dict, '航班号', 'Flight')}</span><input value={fNo} onChange={(e) => setFNo(e.target.value)} placeholder="NH976" /></label>
                      <label><span>{L(dict, '出发', 'From')}</span><input value={fFrom} onChange={(e) => setFFrom(e.target.value)} placeholder="PVG" /></label>
                      <label><span>{L(dict, '到达', 'To')}</span><input value={fTo} onChange={(e) => setFTo(e.target.value)} placeholder="HND" /></label>
                      <label><span>{L(dict, '时间', 'Time')}</span><input value={fTime} onChange={(e) => setFTime(e.target.value)} placeholder="08:20" /></label>
                      <div className="nesio-travel-plan-form-actions">
                        <button type="button" className="nesio-trip-action" onClick={() => setAdding(null)}>{L(dict, '取消', 'Cancel')}</button>
                        <button type="button" className="nesio-trip-primary" onClick={addFlight}>{L(dict, '加入', 'Add')}</button>
                      </div>
                    </>
                  )}
                  {adding === 'hotel' && (
                    <>
                      <label><span>{L(dict, '酒店', 'Hotel')}</span><input value={hName} onChange={(e) => setHName(e.target.value)} /></label>
                      <label><span>{L(dict, '地址', 'Address')}</span><input value={hAddr} onChange={(e) => setHAddr(e.target.value)} /></label>
                      <label><span>{L(dict, '每晚价格', 'Price / night')}</span><input type="number" value={hPrice} onChange={(e) => setHPrice(e.target.value)} /></label>
                      <div className="nesio-travel-plan-form-actions">
                        <button type="button" className="nesio-trip-action" onClick={() => setAdding(null)}>{L(dict, '取消', 'Cancel')}</button>
                        <button type="button" className="nesio-trip-primary" onClick={addHotel}>{L(dict, '加入', 'Add')}</button>
                      </div>
                    </>
                  )}
                  {adding === 'todo' && (
                    <>
                      <label><span>{L(dict, '待办', 'To-do')}</span><input value={todoTitle} onChange={(e) => setTodoTitle(e.target.value)} /></label>
                      <div className="nesio-travel-plan-form-actions">
                        <button type="button" className="nesio-trip-action" onClick={() => setAdding(null)}>{L(dict, '取消', 'Cancel')}</button>
                        <button type="button" className="nesio-trip-primary" onClick={addTodo}>{L(dict, '加入', 'Add')}</button>
                      </div>
                    </>
                  )}
                  {adding === 'import' && (
                    <>
                      <label>
                        <span>{L(dict, '订票确认', 'Booking text')}</span>
                        <textarea rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} />
                      </label>
                      <div className="nesio-travel-plan-form-actions">
                        <button type="button" className="nesio-trip-action" onClick={() => setAdding(null)}>{L(dict, '取消', 'Cancel')}</button>
                        <button type="button" className="nesio-trip-primary" onClick={addImport}>{L(dict, '识别加入', 'Parse & add')}</button>
                      </div>
                    </>
                  )}
                  {err && <p className="nesio-trip-msg" role="alert" style={{ color: 'var(--status-risk)' }}>{err}</p>}
                </div>
              )}

              <div className="nesio-trip-timeline">
                {groups.length === 0 && !adding && (
                  <p className="nesio-trip-empty">{L(dict, '还没有节点 —— 加航班/酒店/离线景点,或生成打包清单。', 'No nodes yet — add a flight/hotel/offline sight, or generate a packing list.')}</p>
                )}
                {groups.map((g) => (
                  <section key={g.dayKey} className="nesio-trip-day">
                    <h3 className="nesio-trip-day-label">{g.dayLabel}</h3>
                    <ul className="nesio-trip-axis">
                      {g.nodes.map((n) => (
                        <li key={n.id}>
                          <button type="button" className="nesio-trip-node" onClick={() => setDetailNode(n)}>
                            <span className="nesio-trip-node-time">{n.timeLabel || '·'}</span>
                            <span className={`nesio-trip-node-dot${n.state === 'todo' ? ' is-todo' : ' is-booked'}`} aria-hidden>
                              <NodeKindIcon kind={n.kind} size={14} />
                            </span>
                            <span className="nesio-trip-node-body">
                              <b>{n.title}</b>
                              {n.subtitle && <small>{n.subtitle}</small>}
                            </span>
                            <IconChevronRight size={16} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          )}
        </div>
      </NesioSheet>

      <NesioSheet
        variant="bottom"
        open={Boolean(detailNode)}
        onOpenChange={(v) => { if (!v) setDetailNode(null); }}
        card={false}
        className="nesio-settings-sheet-card nesio-trip-sheet-card"
        ariaLabel={detailNode ? nodeDetailTitle(detailNode, dict) : ''}
      >
        {detailNode && trip && (
          <div className="nesio-trip-sheet">
            <header className="nesio-trip-sheet-head">
              <button type="button" className="nesio-trip-back" onClick={() => setDetailNode(null)}>
                ‹ {L(dict, '时间线', 'Timeline')}
              </button>
              <h2 className="nesio-trip-sheet-title">{nodeDetailTitle(detailNode, dict)}</h2>
              <span className="nesio-trip-sheet-spacer" />
            </header>
            <TripNodeDetailBody
              tripId={trip.id}
              node={getTrip(trip.id)?.nodes.find((n) => n.id === detailNode.id) || detailNode}
              onChanged={() => {
                reload();
                const fresh = getTrip(trip.id)?.nodes.find((n) => n.id === detailNode.id);
                if (fresh) setDetailNode(fresh);
              }}
            />
          </div>
        )}
      </NesioSheet>
    </>
  );
}
