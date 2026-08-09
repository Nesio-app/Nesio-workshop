'use client';

/**
 * 足迹「计划」tab — 即将出发列表 + 新建行程 / 粘贴订票确认导入。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listPlannedTrips, createBlankTrip, importBookingIntoTrip, groupTripsByTime,
  TRAVEL_TRIPS_UPDATED_EVENT, extractTextFromBookingFile, type Trip,
} from '@/lib/portal/travel-trips';
import { ensureTravelPoiLoaded } from '@/lib/portal/travel-poi';
import { suggestTripsFromEmails, acceptTripSuggestion, dismissTripSuggestion, type TripSuggestion } from '@/lib/portal/trip-suggest';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { IconPlane, IconChevronRight } from '../icons';
import { InfoTip } from '../InfoTip';
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

/**
 * TripSuggestCards —— 「这封邮件像一次行程,要建吗?」
 *
 * **建议,不自动建**。自动建行程等于系统替你判断「你要去这趟」,而这个判断
 * 错起来是不可见的:你不会知道它错了,只会发现列表里多了个不认识的东西。
 * 详见 lib/portal/trip-suggest.ts 文件头。
 *
 * 每张卡都有「不再提醒」—— 没有出口的提示就是骚扰。
 */
function TripSuggestCards({ dict, onCreated }: { dict: string; onCreated: () => void }) {
  const [list, setList] = useState<TripSuggestion[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    try { setList(suggestTripsFromEmails()); } catch { setList([]); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  if (!list.length) return null;

  return (
    <div className="nesio-trip-suggests">
      {list.map((s) => (
        <div key={s.emailNodeId} className="nesio-trip-suggest">
          <p className="nesio-trip-suggest-text">
            {L(dict, `这封邮件像一次 ${s.title} 的行程,要建吗？`, `This email looks like a ${s.title} trip — create it?`)}
          </p>
          <div className="nesio-trip-suggest-acts">
            <button type="button" className="nesio-fin-flowopt is-active" onClick={() => {
              const r = acceptTripSuggestion(s);
              if (!r.ok) {
                // 两种失败要分开说:行程压根没建 vs 建好了但没连上那封邮件。
                // 后者不回滚 —— 行程本身是你要的东西。
                setErr(r.reason === 'create_failed'
                  ? L(dict, '没能建起来,再试一次。', "Couldn't create it — try again.")
                  : L(dict, '行程建好了,但没连上那封邮件 —— 稍后可以在行程里手动关联。',
                       "Trip created, but it isn't linked to the email — you can link it manually later."));
              } else setErr(null);
              refresh();
              onCreated();
            }}>{L(dict, '建', 'Create')}</button>
            <button type="button" className="nesio-fin-flowopt" onClick={() => {
              // 写失败要说 —— 悄悄没存下的话它下次又冒出来,你会以为按钮坏了。
              if (!dismissTripSuggestion(s.emailNodeId)) {
                setErr(L(dict, '这次没记住「不再提醒」,可能存储满了。', "Couldn't remember that — storage may be full."));
              }
              refresh();
            }}>{L(dict, '不用', 'No thanks')}</button>
          </div>
        </div>
      ))}
      {err && <p className="nesio-claim-err" role="alert">{err}</p>}
    </div>
  );
}

export default function TravelPlanPanel() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [trips, setTrips] = useState<Trip[]>([]);
  const grouped = useMemo(() => groupTripsByTime(trips), [trips]);
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
    const extracted = await extractTextFromBookingFile(file);
    if (!extracted.ok) {
      const msg: Record<typeof extracted.reason, [string, string]> = {
        empty: ['这个文件是空的。', 'That file is empty.'],
        binary: ['这个文件读不了 —— 换个 .txt / .eml,或直接粘贴正文。', "Couldn't read that file — try a .txt/.eml, or paste the text."],
        pdf_scanned: ['这份 PDF 是扫描件 —— 请复制正文粘贴。', 'This PDF is a scan — paste the text instead.'],
        pdf_failed: ['PDF 打不开 —— 请复制正文粘贴。', 'Couldn’t open the PDF — paste the text instead.'],
        image: ['图片暂不能直接识别 —— 请粘贴确认单文字。', 'Images can’t be parsed yet — paste the confirmation text.'],
        read_failed: ['这个文件读不了 —— 换个 .txt / .eml,或直接粘贴正文。', "Couldn't read that file — try a .txt/.eml, or paste the text."],
      };
      const [zh, en] = msg[extracted.reason];
      setImportErr(L(dict, zh, en));
      return;
    }
    setImportText(extracted.text);
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
        <h3 className="nesio-travel-plan-title">{L(dict, '行程', 'Trips')}</h3>
        <span className="nesio-travel-plan-count">{L(dict, `${trips.length} 段`, `${trips.length} trip${trips.length === 1 ? '' : 's'}`)}</span>
      </div>

      <TripSuggestCards dict={dict} onCreated={reload} />

      {trips.length === 0 && mode === 'idle' && (
        <div className="nesio-travel-plan-empty">
          <IconPlane size={28} />
          <p>{L(dict, '还没有行程', 'No trips yet')}</p>
        </div>
      )}

      {/* 按**日期**分三组(2026-07-30 真机实锤:一趟 7/28 已经出发的行程被列在
          「即将出发」下面)。根因是拿**状态**当日期用 —— 状态是人标的,不一定跟得上日历;
          日期是硬事实。第三组「已经过去了」把「其实结束了只是没人标完成」说出来,
          而不是继续假装它要出发。 */}
      {([
        ['upcoming', L(dict, '即将出发', 'Starting soon')],
        ['ongoing', L(dict, '正在路上', 'On the road')],
        ['overdue', L(dict, '已经过去了 —— 要标成完成吗', 'Already over — mark as done?')],
      ] as const).map(([key, title]) => {
        const list = grouped[key];
        if (!list.length) return null;
        return (
          <div key={key}>
            <p className="nesio-travel-plan-group">{title}</p>
            <ul className="nesio-travel-plan-list">
              {list.map((t) => (
                <li key={t.id}>
                  <button type="button" className="nesio-travel-plan-card" onClick={() => setOpenId(t.id)}>
                    <span className="nesio-travel-plan-card-ico"><IconPlane size={22} /></span>
                    <span className="nesio-travel-plan-card-main">
                      <b>{t.title || t.destination}</b>
                      <small>
                        {(() => {
                          const start = new Date(`${t.startDate}T12:00:00`);
                          const end = new Date(`${t.endDate}T12:00:00`);
                          const fmt = (d: Date) => d.toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { weekday: 'short', month: 'short', day: 'numeric' });
                          const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
                          const today = new Date(); today.setHours(12, 0, 0, 0);
                          const until = Math.ceil((start.getTime() - today.getTime()) / 86400000);
                          const countdown = until > 0
                            ? L(dict, `还有 ${until} 天出发`, `Starts in ${until} day${until === 1 ? '' : 's'}`)
                            : until === 0
                              ? L(dict, '今天出发', 'Starts today')
                              : L(dict, '行程中 / 已过', 'Ongoing / past');
                          return `${fmt(start)} – ${fmt(end)} (${days} ${L(dict, '天', 'days')}) · ${countdown}`;
                        })()}
                        {t.weatherHint ? ` · ${t.weatherHint}` : ''}
                      </small>
                    </span>
                    <IconChevronRight size={16} />
                  </button>
                  {/* bug3:卡片右侧那个 ✕ 删掉 —— 一次误触就没了整趟行程,而且没有确认。
                      要删行程去时间线里删(有确认)。 */}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

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
            <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="" aria-label={L(dict, '目的地', 'Destination')} />
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
            <span>{L(dict, '目的地', 'Destination')}</span>
            <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="" aria-label={L(dict, '目的地', 'Destination')} />
          </label>
          <label>
            <span>{L(dict, '出发日', 'Start')}</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {L(dict, '订票确认', 'Booking text')}
              <InfoTip text={L(dict, '粘贴航空公司或酒店确认邮件;可含航班号、航线、酒店名。目的地可空,会试着从正文猜。', 'Paste airline/hotel confirmation; flight no., route, hotel name ok. Destination optional — we try to guess from the text.')} />
            </span>
            <textarea
              rows={6}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder=""
              aria-label={L(dict, '订票确认', 'Booking text')}
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
          <input ref={bookingFileRef} type="file" accept=".txt,.eml,.md,.html,.pdf,text/plain,message/rfc822,application/pdf,image/jpeg,image/png,image/webp,image/gif,image/heic"
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
