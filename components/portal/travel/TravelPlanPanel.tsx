'use client';

/**
 * 足迹「计划」tab — 即将出发列表 + 新建行程 / 粘贴订票确认导入。
 */

import { useEffect, useRef, useState } from 'react';
import {
  listPlannedTrips, createBlankTrip, importBookingIntoTrip,
  TRAVEL_TRIPS_UPDATED_EVENT, type Trip,
} from '@/lib/portal/travel-trips';
import { ensureTravelPoiLoaded } from '@/lib/portal/travel-poi';
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
  const [mode, setMode] = useState<'idle' | 'create' | 'import'>('idle');
  const [dest, setDest] = useState('');
  const [start, setStart] = useState(todayYmd());
  const [days, setDays] = useState(5);
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);
  const bookingFileRef = useRef<HTMLInputElement>(null);

  function reload() {
    setTrips(listPlannedTrips());
  }

  useEffect(() => {
    reload();
    void ensureTravelPoiLoaded();
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
    setMode('idle');
    setDest('');
    setOpenId(trip.id);
    reload();
  }

  /** 上传订票确认文件 → 读成文本填进框。读不了要说出来。 */
  async function onPickBooking(file: File | undefined) {
    if (!file) return;
    setImportErr(null);
    try {
      const text = await file.text();
      if (!text.trim()) { setImportErr(L(dict, '这个文件是空的。', 'That file is empty.')); return; }
      setImportText(text.slice(0, 20000));
    } catch {
      setImportErr(L(dict, '这个文件读不了 —— 换个 .txt / .eml,或直接粘贴正文。', "Couldn't read that file — try a .txt/.eml, or paste the text."));
    }
  }

  function doImport() {
    setImportErr(null);
    setImportMsg(null);
    const text = importText.trim();
    if (!text) {
      setImportErr(L(dict, '先粘贴订票确认全文(航班号/酒店名)。', 'Paste the booking confirmation first.'));
      return;
    }
    const destination = dest.trim()
      || text.match(/(?:到达|目的地|destination)\s*[:：]?\s*([^\n,，]{2,20})/i)?.[1]?.trim()
      || L(dict, '新行程', 'New trip');
    const end = addDaysYmd(start, Math.max(1, days) - 1);
    const trip = createBlankTrip({
      title: `${destination} · ${days} ${L(dict, '天', 'days')}`,
      destination,
      startDate: start,
      endDate: end,
      days,
    });
    const n = importBookingIntoTrip(trip.id, text);
    if (n <= 0) {
      setImportErr(L(dict, '没识别出航班/酒店 —— 可先建空行程,再在时间线里手动加。', 'No flight/hotel found — create a blank trip and add nodes on the timeline.'));
      setOpenId(trip.id);
      setMode('idle');
      reload();
      return;
    }
    setImportMsg(L(dict, `已拆出 ${n} 个节点`, `Unpacked ${n} nodes`));
    setImportText('');
    setMode('idle');
    setOpenId(trip.id);
    reload();
  }

  return (
    <div className="nesio-travel-plan">
      <div className="nesio-travel-plan-head">
        <h3 className="nesio-travel-plan-title">{L(dict, '即将出发', 'Starting soon')}</h3>
        <span className="nesio-travel-plan-count">{L(dict, `${trips.length} 段`, `${trips.length} trip${trips.length === 1 ? '' : 's'}`)}</span>
      </div>

      {trips.length === 0 && mode === 'idle' && (
        <div className="nesio-travel-plan-empty">
          <IconPlane size={28} />
          <p>{L(dict, '还没有行程 —— 新建一趟,或粘贴订票确认自动拆时间线。', 'No trips yet — create one, or paste a booking confirmation to unpack the timeline.')}</p>
        </div>
      )}

      <ul className="nesio-travel-plan-list">
        {trips.map((t) => (
          <li key={t.id}>
            <button type="button" className="nesio-travel-plan-card" onClick={() => setOpenId(t.id)}>
              <span className="nesio-travel-plan-card-ico"><IconPlane size={18} /></span>
              <span className="nesio-travel-plan-card-main">
                <b>{t.title}</b>
                <small>{t.startDate} → {t.endDate}{t.weatherHint ? ` · ${t.weatherHint}` : ''} · {t.nodes.length} {L(dict, '节点', 'nodes')}</small>
              </span>
              <IconChevronRight size={16} />
            </button>
            {/* bug3:卡片右侧那个 ✕ 删掉 —— 一次误触就没了整趟行程,而且没有确认。
                要删行程去时间线里删(有确认)。 */}
          </li>
        ))}
      </ul>

      {mode === 'idle' && (
        <div className="nesio-travel-plan-cta-row">
          <button type="button" className="nesio-travel-plan-cta" onClick={() => setMode('create')}>
            {L(dict, '+ 新建行程', '+ New itinerary')}
          </button>
          <button type="button" className="nesio-travel-plan-cta nesio-travel-plan-cta--ghost" onClick={() => setMode('import')}>
            {L(dict, '粘贴订票确认', 'Paste booking')}
          </button>
        </div>
      )}

      {mode === 'create' && (
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
            <button type="button" className="nesio-trip-action" onClick={() => setMode('idle')}>{L(dict, '取消', 'Cancel')}</button>
            <button type="button" className="nesio-trip-primary" onClick={create}>{L(dict, '创建', 'Create')}</button>
          </div>
        </div>
      )}

      {mode === 'import' && (
        <div className="nesio-travel-plan-form">
          <label>
            <span>{L(dict, '目的地(可空,会试着从正文猜)', 'Destination (optional)')}</span>
            <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder={L(dict, '东京', 'Tokyo')} />
          </label>
          <label>
            <span>{L(dict, '出发日', 'Start')}</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            <span>{L(dict, '订票确认全文', 'Booking text')}</span>
            <textarea
              rows={6}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={L(dict, '粘贴航空公司/酒店确认邮件… 含航班号如 NH976、PVG→HND、酒店名', 'Paste airline/hotel confirmation… flight no. like NH976, PVG→HND, hotel name')}
            />
          </label>
          {importErr && (
            <p className="nesio-trip-msg" role="alert" style={{ color: 'var(--status-risk)' }}>
              {importErr}
              <button type="button" className="nesio-trip-link" onClick={doImport}>{L(dict, '重试', 'Retry')}</button>
            </p>
          )}
          {importMsg && <p className="nesio-trip-msg" role="status">{importMsg}</p>}
          {/* bug3:「粘贴预定按钮不管用」—— 没有剪贴板权限/内容时,原来这条路是死的。
              补一个「上传」把 .txt/.eml 读进文本框,再点「识别」。 */}
          <input ref={bookingFileRef} type="file" accept=".txt,.eml,.md,text/plain,message/rfc822"
            className="nesio-visually-hidden"
            onChange={(e) => { void onPickBooking(e.target.files?.[0]); e.currentTarget.value = ''; }} />
          <div className="nesio-travel-plan-form-actions">
            <button type="button" className="nesio-trip-action" onClick={() => { setMode('idle'); setImportErr(null); }}>{L(dict, '取消', 'Cancel')}</button>
            <button type="button" className="nesio-trip-action" onClick={() => bookingFileRef.current?.click()}>{L(dict, '上传', 'Upload')}</button>
            <button type="button" className="nesio-trip-primary" onClick={doImport} disabled={!importText.trim()}>{L(dict, '识别', 'Parse')}</button>
          </div>
        </div>
      )}

      <TripTimelineSheet tripId={openId} open={Boolean(openId)} onClose={() => { setOpenId(null); reload(); }} />
    </div>
  );
}
