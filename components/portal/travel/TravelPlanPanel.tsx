'use client';

/**
 * 足迹「计划(要去)」— 即将出发列表 + 新建行程 / 转发订票确认。
 */

import { useEffect, useState } from 'react';
import {
  listPlannedTrips, createBlankTrip, ensureDemoTokyoTrip, deleteTrip,
  TRAVEL_TRIPS_UPDATED_EVENT, type Trip,
} from '@/lib/portal/travel-trips';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { IconPlane, IconChevronRight } from '../icons';
import TripTimelineSheet from './TripTimelineSheet';

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TravelPlanPanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [trips, setTrips] = useState<Trip[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dest, setDest] = useState('');
  const [start, setStart] = useState(todayYmd());
  const [days, setDays] = useState(5);

  function reload() {
    ensureDemoTokyoTrip();
    setTrips(listPlannedTrips());
  }

  useEffect(() => {
    reload();
    const onUp = () => setTrips(listPlannedTrips());
    window.addEventListener(TRAVEL_TRIPS_UPDATED_EVENT, onUp);
    return () => window.removeEventListener(TRAVEL_TRIPS_UPDATED_EVENT, onUp);
  }, []);

  function create() {
    const destination = dest.trim() || L(dict, '新行程', 'New trip');
    const end = addDaysYmd(start, Math.max(1, days) - 1);
    const trip = createBlankTrip({
      title: `${destination} · ${days} ${L(dict, '天', 'days')}`,
      destination,
      startDate: start,
      endDate: end,
      days,
    });
    setCreating(false);
    setDest('');
    setOpenId(trip.id);
    reload();
  }

  return (
    <div className="nesio-travel-plan">
      <div className="nesio-travel-plan-head">
        <h3 className="nesio-travel-plan-title">{L(dict, '即将出发', 'Starting soon')}</h3>
        <span className="nesio-travel-plan-count">{L(dict, `${trips.length} 段`, `${trips.length} trip${trips.length === 1 ? '' : 's'}`)}</span>
      </div>

      {trips.length === 0 && (
        <div className="nesio-travel-plan-empty">
          <IconPlane size={28} />
          <p>{L(dict, '还没有行程 —— 新建一趟,或转发订票确认让我帮你排时间线。', 'No trips yet — start one, or forward a booking confirmation.')}</p>
        </div>
      )}

      <ul className="nesio-travel-plan-list">
        {trips.map((t) => (
          <li key={t.id}>
            <button type="button" className="nesio-travel-plan-card" onClick={() => setOpenId(t.id)}>
              <span className="nesio-travel-plan-card-ico"><IconPlane size={18} /></span>
              <span className="nesio-travel-plan-card-main">
                <b>{t.title}</b>
                <small>{t.startDate} → {t.endDate}{t.weatherHint ? ` · ${t.weatherHint}` : ''}</small>
              </span>
              <IconChevronRight size={16} />
            </button>
            <button
              type="button"
              className="nesio-travel-plan-del"
              aria-label={L(dict, '删除行程', 'Delete trip')}
              onClick={() => { deleteTrip(t.id); reload(); }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {!creating ? (
        <button type="button" className="nesio-travel-plan-cta" onClick={() => setCreating(true)}>
          {L(dict, '+ 新建行程 · 或转发订票确认', '+ New itinerary · or forward booking confirmation')}
        </button>
      ) : (
        <div className="nesio-travel-plan-form">
          <label>
            <span>{L(dict, '目的地', 'Destination')}</span>
            <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder={L(dict, '东京', 'Tokyo')} />
          </label>
          <label>
            <span>{L(dict, '出发日', 'Start')}</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            <span>{L(dict, '天数', 'Days')}</span>
            <input type="number" min={1} max={60} value={days} onChange={(e) => setDays(Number(e.target.value) || 1)} />
          </label>
          <div className="nesio-travel-plan-form-actions">
            <button type="button" className="nesio-trip-action" onClick={() => setCreating(false)}>{L(dict, '取消', 'Cancel')}</button>
            <button type="button" className="nesio-trip-primary" onClick={create}>{L(dict, '创建', 'Create')}</button>
          </div>
          <p className="nesio-trip-footnote">
            {L(dict, '转发订票确认到邮箱或拍照上传后,云端会帮你拆成时间线节点(航班/酒店)。', 'Forward a booking email or snap it — the cloud can unpack flight/hotel nodes onto the timeline.')}
          </p>
        </div>
      )}

      <TripTimelineSheet tripId={openId} open={Boolean(openId)} onClose={() => { setOpenId(null); reload(); }} />
    </div>
  );
}
