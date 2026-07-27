'use client';

/**
 * 行程时间线 — 设计稿屏 2:竖轴 · 左时间 · 中节点 · 右内容。
 */

import { useEffect, useState } from 'react';
import {
  getTrip, completeTrip, TRAVEL_TRIPS_UPDATED_EVENT, groupNodesByDay,
  type Trip, type TripNode,
} from '@/lib/portal/travel-trips';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import NesioSheet from '../ui/NesioSheet';
import { IconChevronRight, IconCard } from '../icons';
import { NodeKindIcon, TripNodeDetailBody, nodeDetailTitle } from './TripNodeDetailSheets';

export default function TripTimelineSheet({
  tripId, open, onClose,
}: {
  tripId: string | null; open: boolean; onClose: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [trip, setTrip] = useState<Trip | null>(null);
  const [detailNode, setDetailNode] = useState<TripNode | null>(null);

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
    if (!open) setDetailNode(null);
  }, [open]);

  if (!tripId) return null;

  const groups = trip ? groupNodesByDay(trip.nodes.filter((n) => n.kind !== 'budget')) : [];
  const budgetNode = trip?.nodes.find((n) => n.kind === 'budget') ?? null;

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
              ‹ {L(dict, '足迹', 'Footprints')}
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
                  {L(dict, '完成 · 进足迹', 'Done · to footprints')}
                </button>
              )}
            </div>
          </header>

          {!trip && <p className="nesio-trip-empty">{L(dict, '找不到这趟行程', 'Trip not found')}</p>}

          {trip && (
            <div className="nesio-trip-timeline">
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
