'use client';

/**
 * 行程时间线 — 竖轴 + 添加节点 + 详情。
 */

import { useEffect, useRef, useState } from 'react';
import {
  getTrip, deleteTrip, addTripNode, generatePackingList, importBookingIntoTrip,
  recomputeBudgetNode, groupNodesByDay, formatTripNodeTime, TRAVEL_TRIPS_UPDATED_EVENT,
  type Trip, type TripNode,
} from '@/lib/portal/travel-trips';
import { ensureTravelHubsLoaded, searchTravelHubs, hubLabel, type TravelHub } from '@/lib/portal/travel-hubs';
import { ensureTravelHotelsLoaded, searchTravelHotels, hotelLabel, type TravelHotel } from '@/lib/portal/travel-hotels';
import { ensureTravelRoutesLoaded, suggestRouteDestinations, suggestRouteOrigins, findRoute } from '@/lib/portal/travel-routes';
import { ensureTravelPoiLoaded } from '@/lib/portal/travel-poi';
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
  const [fDate, setFDate] = useState('');
  const bookingFileRef = useRef<HTMLInputElement>(null);
  const [hName, setHName] = useState('');
  const [hAddr, setHAddr] = useState('');
  const [hPrice, setHPrice] = useState('');
  const [hLat, setHLat] = useState<number | undefined>(undefined);
  const [hLon, setHLon] = useState<number | undefined>(undefined);
  const [todoTitle, setTodoTitle] = useState('');
  const [paste, setPaste] = useState('');
  const [routesErr, setRoutesErr] = useState<string | null>(null);

  function reload() {
    if (!tripId) { setTrip(null); return; }
    setTrip(getTrip(tripId));
  }

  useEffect(() => {
    if (!open || !tripId) return;
    reload();
    // 离线包预热:机场/酒店/航线/景点 —— 无网也能搜候选
    void ensureTravelHubsLoaded();
    void ensureTravelHotelsLoaded();
    void ensureTravelRoutesLoaded().then((r) => {
      if (r.error) setRoutesErr(L(dict, '离线航线库没加载上,再试一次。', 'Offline route pack failed to load — try again.'));
      else setRoutesErr(null);
    });
    void ensureTravelPoiLoaded();
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
      timeLabel: [fDate.trim(), fTime.trim()].filter(Boolean).join(' '),
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
    setAdding(null); setFNo(''); setFFrom(''); setFTo(''); setFTime(''); setFDate(''); setErr(null);
    reload();
  }

  function addHotel() {
    if (!trip) return;
    const name = hName.trim();
    if (!name) { setErr(L(dict, '填酒店名', 'Hotel name needed')); return; }
    const priceRaw = Number(hPrice);
    const price = Number.isFinite(priceRaw) && priceRaw > 0 && priceRaw <= 1_000_000 ? priceRaw : undefined;
    addTripNode(trip.id, {
      kind: 'hotel', state: 'booked',
      timeLabel: '',
      dayKey: 'd1', dayLabel: L(dict, '行程日', 'Trip day'),
      title: `入住 · ${name}`,
      subtitle: price != null ? `$${price}` : undefined,
      payload: {
        kind: 'hotel',
        hotel: {
          name,
          address: hAddr.trim() || undefined,
          pricePerNight: price,
          nights: 1,
          currency: '$',
          ...(hLat != null && hLon != null ? { lat: hLat, lon: hLon } : {}),
        },
      },
    });
    recomputeBudgetNode(trip.id);
    setAdding(null); setHName(''); setHAddr(''); setHPrice(''); setHLat(undefined); setHLon(undefined); setErr(null);
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

  /** 上传订票确认 → 读文本 → 自动识别(不只填框)。PDF 二进制不能当文本读。 */
  async function onPickBooking(file: File | undefined) {
    if (!file || !trip) return;
    setErr(null);
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    if (isPdf) {
      setErr(L(dict, 'PDF 还不支持直接识别 —— 请复制正文粘贴,或上传 .txt / .eml / .html。', 'PDF isn’t supported yet — paste the text, or upload .txt/.eml/.html.'));
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) { setErr(L(dict, '这个文件是空的。', 'That file is empty.')); return; }
      // 拒绝明显二进制垃圾(NUL 等)
      if (/[\u0000]/.test(text.slice(0, 200)) || (text.match(/[^\x09\x0a\x0d\x20-\x7E\u0080-\uFFFF]/g) || []).length > text.length * 0.3) {
        setErr(L(dict, '这个文件不像可读文本 —— 换 .txt / .eml / .html,或直接粘贴。', 'That file doesn’t look like text — try .txt/.eml/.html, or paste.'));
        return;
      }
      const n = importBookingIntoTrip(trip.id, text.slice(0, 20000));
      if (n <= 0) {
        setPaste(text.slice(0, 20000));
        setErr(L(dict, '没自动识别出航班/酒店 —— 正文已填入,可改后再点「识别」。', 'No flight/hotel parsed — text pasted; edit and tap Parse.'));
        return;
      }
      setAdding(null); setPaste(''); setErr(null);
      reload();
    } catch {
      setErr(L(dict, '这个文件读不了 —— 换 .txt / .eml / .html,或直接粘贴正文。', "Couldn't read that file — try .txt/.eml/.html, or paste the text."));
    }
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
              {/* bug3:「完成 · 进世界」按标注删掉;预算就留在右上角。
                  行程走完后会随日期自然沉进「世界」,不需要一个手动的仪式按钮。
                  删除入口从计划列表的裸 ✕ 挪到这里 —— 带确认,不会一次误触没了整趟。 */}
              {trip && (
                <button type="button" className="nesio-trip-textbtn" style={{ color: 'var(--status-risk)' }}
                  onClick={() => {
                    if (!confirm(L(dict, `删掉「${trip.title}」这趟行程?`, `Delete the trip “${trip.title}”?`))) return;
                    deleteTrip(trip.id);
                    onClose();
                  }}>
                  {L(dict, '删行程', 'Delete')}
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
              </div>
              <div className="nesio-trip-addbar nesio-trip-addbar--secondary">
                <button type="button" className="nesio-trip-action nesio-trip-action--ghost" onClick={() => { setAdding('import'); setErr(null); }}>
                  {L(dict, '粘贴订票确认', 'Paste booking confirmation')}
                </button>
              </div>

              {adding && adding !== 'poi' && (
                <div className={`nesio-travel-plan-form${adding === 'import' ? ' nesio-travel-plan-form--import' : ''}`}>
                  {adding === 'flight' && (
                    <>
                      <p className="nesio-trip-footnote">{L(dict, '机场码来自离线枢纽库;常见航线也会提示出发/到达候选。', 'Airport codes from the offline hub pack; common routes suggest origins and destinations.')}</p>
                      {routesErr && (
                        <p className="nesio-trip-msg" role="alert" style={{ color: 'var(--status-risk)' }}>
                          {routesErr}
                          <button type="button" className="nesio-trip-link" onClick={() => {
                            void ensureTravelRoutesLoaded().then((r) => {
                              if (r.error) setRoutesErr(L(dict, '离线航线库没加载上,再试一次。', 'Offline route pack failed to load — try again.'));
                              else setRoutesErr(null);
                            });
                          }}>{L(dict, '重试', 'Retry')}</button>
                        </p>
                      )}
                      <label><span>{L(dict, '航班号', 'Flight')}</span><input value={fNo} onChange={(e) => setFNo(e.target.value)} placeholder="NH976" /></label>
                      <HubField label={L(dict, '出发', 'From')} value={fFrom} onChange={setFFrom} zh={dict !== 'en'}
                        routeHints={suggestRouteOrigins(fTo, 8).map((r) => r.from)} />
                      <HubField label={L(dict, '到达', 'To')} value={fTo} onChange={setFTo} zh={dict !== 'en'}
                        routeHints={suggestRouteDestinations(fFrom, 8).map((r) => r.to)} />
                      {(() => {
                        const rt = findRoute(fFrom, fTo);
                        if (!rt?.airlines?.length) return null;
                        return (
                          <p className="nesio-trip-footnote">
                            {L(dict, `常见航司: ${rt.airlines.join(' · ')}`, `Often flown by: ${rt.airlines.join(' · ')}`)}
                          </p>
                        );
                      })()}
                      <label><span>{L(dict, '日期', 'Date')}</span><input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} /></label>
                      <label><span>{L(dict, '时间', 'Time')}</span><input type="time" value={fTime} onChange={(e) => setFTime(e.target.value)} /></label>
                      <div className="nesio-travel-plan-form-actions">
                        <button type="button" className="nesio-trip-action" onClick={() => setAdding(null)}>{L(dict, '取消', 'Cancel')}</button>
                        <button type="button" className="nesio-trip-primary" onClick={addFlight}>{L(dict, '加入', 'Add')}</button>
                      </div>
                    </>
                  )}
                  {adding === 'hotel' && (
                    <>
                      <p className="nesio-trip-footnote">{L(dict, '可搜离线酒店库(城市/店名),选中会带上坐标。', 'Search the offline hotel pack; picking one fills coordinates.')}</p>
                      <HotelField
                        label={L(dict, '酒店', 'Hotel')}
                        value={hName}
                        zh={dict !== 'en'}
                        onChange={(v) => { setHName(v); setHLat(undefined); setHLon(undefined); }}
                        onPick={(h) => {
                          setHName(dict !== 'en' && h.nameZh ? h.nameZh : h.name);
                          setHAddr([h.cityZh || h.city, h.country].filter(Boolean).join(', '));
                          setHLat(h.lat); setHLon(h.lon);
                        }}
                      />
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
                      <p className="nesio-trip-footnote">{L(dict, '粘贴航空公司/酒店确认邮件正文;暂不支持 PDF 二进制。', 'Paste airline/hotel confirmation text; PDF binary isn’t supported yet.')}</p>
                      <label>
                        <span>{L(dict, '订票确认', 'Booking text')}</span>
                        <textarea rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} />
                      </label>
                      <input ref={bookingFileRef} type="file" accept=".txt,.eml,.md,.html,text/plain,message/rfc822,text/html"
                        className="nesio-visually-hidden"
                        onChange={(e) => { void onPickBooking(e.target.files?.[0]); e.currentTarget.value = ''; }} />
                      <div className="nesio-travel-plan-form-actions">
                        <button type="button" className="nesio-trip-action" onClick={() => setAdding(null)}>{L(dict, '取消', 'Cancel')}</button>
                        <button type="button" className="nesio-trip-action" onClick={() => bookingFileRef.current?.click()}>{L(dict, '上传', 'Upload')}</button>
                        <button type="button" className="nesio-trip-primary" onClick={addImport} disabled={!paste.trim()}>{L(dict, '识别', 'Parse')}</button>
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
                            <span className="nesio-trip-node-time">{formatTripNodeTime(n, dict)}</span>
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

      {/* blurOverlay:bug3「打包清单…背景要虚化」—— 节点详情统一虚化背景 */}
      <NesioSheet
        variant="bottom"
        blurOverlay
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
                // 删掉节点后关掉详情,别还挂着幽灵 id
                setDetailNode(fresh || null);
              }}
            />
          </div>
        )}
      </NesioSheet>

      {/* 离线景点用独立 sheet,避免被粘贴确认大表单挡住 */}
      <NesioSheet
        variant="bottom"
        blurOverlay
        open={adding === 'poi' && Boolean(trip)}
        onOpenChange={(v) => { if (!v) setAdding(null); }}
        card={false}
        className="nesio-settings-sheet-card nesio-trip-sheet-card"
        ariaLabel={L(dict, '离线景点', 'Offline sights')}
      >
        {trip && adding === 'poi' && (
          <div className="nesio-trip-sheet">
            <TripPoiPicker
              tripId={trip.id}
              destination={trip.destination}
              onAdded={() => { reload(); }}
              onClose={() => setAdding(null)}
            />
          </div>
        )}
      </NesioSheet>
    </>
  );
}

/**
 * HubField — 机场/车站输入框 + 离线候选下拉(bug3:「无下拉框选项」「需要离线机场等交通枢纽数据包」)。
 * 打两个字就出候选;选中把三字码填回去(节点标题用的就是码)。库没加载好时退化成普通输入框,
 * 手填照样能用 —— 不许因为数据包没到就变成死输入。
 */
function HubField({ label, value, onChange, zh, routeHints }: {
  label: string; value: string; onChange: (v: string) => void; zh: boolean;
  /** 离线航线包给出的三字码候选(出发或到达) */
  routeHints?: string[];
}) {
  const [focus, setFocus] = useState(false);
  const hits: TravelHub[] = focus ? searchTravelHubs(value, 6) : [];
  const exact = hits.length === 1 && hits[0].code.toLowerCase() === value.trim().toLowerCase();
  const v = value.trim().toUpperCase();
  const hintCodes = focus && routeHints?.length
    ? [...new Set(routeHints.filter((c) => c && c.length === 3 && (!v || c.toUpperCase().startsWith(v))))].slice(0, 8)
    : [];
  return (
    <label style={{ position: 'relative' }}>
      <span>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => window.setTimeout(() => setFocus(false), 150)}
        placeholder={zh ? '机场码 / 城市,如 PVG 或 上海' : 'Airport code or city, e.g. PVG'}
        autoComplete="off"
      />
      {hits.length > 0 && !exact && (
        <ul className="nesio-hub-menu" role="listbox">
          {hits.map((h) => (
            <li key={h.code}>
              <button type="button" className="nesio-hub-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(h.code); setFocus(false); }}>
                <b>{hubLabel(h, zh)}</b>
                <small>{h.name}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {hits.length === 0 && hintCodes.length > 0 && (
        <ul className="nesio-hub-menu" role="listbox">
          {hintCodes.map((code) => (
            <li key={code}>
              <button type="button" className="nesio-hub-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(code); setFocus(false); }}>
                <b>{code}</b>
                <small>{zh ? '离线航线候选' : 'Offline route'}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}

function HotelField({ label, value, onChange, onPick, zh }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onPick: (h: TravelHotel) => void;
  zh: boolean;
}) {
  const [focus, setFocus] = useState(false);
  const hits = focus ? searchTravelHotels(value, 8) : [];
  return (
    <label style={{ position: 'relative' }}>
      <span>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => window.setTimeout(() => setFocus(false), 150)}
        placeholder={zh ? '店名 / 城市,如 东京 或 Hyatt' : 'Hotel or city, e.g. Tokyo or Hyatt'}
        autoComplete="off"
      />
      {hits.length > 0 && (
        <ul className="nesio-hub-menu" role="listbox">
          {hits.map((h) => (
            <li key={`${h.name}-${h.lat}`}>
              <button type="button" className="nesio-hub-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onPick(h); setFocus(false); }}>
                <b>{hotelLabel(h, zh)}</b>
                <small>{h.chain || h.country}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
