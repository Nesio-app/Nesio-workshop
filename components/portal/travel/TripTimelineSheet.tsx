'use client';

/**
 * 行程时间线 — 竖轴 + 添加节点 + 详情。
 */

import { useEffect, useRef, useState } from 'react';
import {
  getTrip, deleteTrip, addTripNode, generatePackingList, importBookingIntoTrip,
  recomputeBudgetNode, groupNodesByDay, TRAVEL_TRIPS_UPDATED_EVENT,
  type Trip, type TripNode,
} from '@/lib/portal/travel-trips';
import { ensureTravelHubsLoaded, searchTravelHubs, hubLabel, type TravelHub } from '@/lib/portal/travel-hubs';
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
  const [todoTitle, setTodoTitle] = useState('');
  const [paste, setPaste] = useState('');

  function reload() {
    if (!tripId) { setTrip(null); return; }
    setTrip(getTrip(tripId));
  }

  useEffect(() => {
    if (!open || !tripId) return;
    reload();
    // 离线枢纽库预热 —— 出发/到达的下拉候选靠它(无网也能用)
    void ensureTravelHubsLoaded();
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

  /** 上传订票确认文件(.txt/.eml)→ 读成文本填进框。读不了要说出来,不许静默。 */
  async function onPickBooking(file: File | undefined) {
    if (!file) return;
    setErr(null);
    try {
      const text = await file.text();
      if (!text.trim()) { setErr(L(dict, '这个文件是空的。', 'That file is empty.')); return; }
      setPaste(text.slice(0, 20000));
    } catch {
      setErr(L(dict, '这个文件读不了 —— 换个 .txt / .eml,或直接粘贴正文。', "Couldn't read that file — try a .txt/.eml, or paste the text.")); 
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
                      {/* bug3:出发/到达接离线机场库 —— 打两个字就出候选,选中自动填三字码 */}
                      <HubField label={L(dict, '出发', 'From')} value={fFrom} onChange={setFFrom} zh={dict !== 'en'} />
                      <HubField label={L(dict, '到达', 'To')} value={fTo} onChange={setFTo} zh={dict !== 'en'} />
                      {/* bug3:时间要弹选择器,不是让人手打「08:20」;日期弹日历 */}
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
                      {/* bug3:「粘贴确认功能失效,下面按钮为上传和识别」——
                          「上传」= 选一个 .txt/.eml 确认文件读进文本框(没有剪贴板也能用,
                          这正是原来「点了没反应」的场合);「识别」= 拆成节点。 */}
                      <input ref={bookingFileRef} type="file" accept=".txt,.eml,.md,text/plain,message/rfc822"
                        className="nesio-visually-hidden"
                        onChange={(e) => { void onPickBooking(e.target.files?.[0]); e.currentTarget.value = ''; }} />
                      <div className="nesio-travel-plan-form-actions">
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
                if (fresh) setDetailNode(fresh);
              }}
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
function HubField({ label, value, onChange, zh }: {
  label: string; value: string; onChange: (v: string) => void; zh: boolean;
}) {
  const [focus, setFocus] = useState(false);
  const hits: TravelHub[] = focus ? searchTravelHubs(value, 6) : [];
  const exact = hits.length === 1 && hits[0].code.toLowerCase() === value.trim().toLowerCase();
  return (
    <label style={{ position: 'relative' }}>
      <span>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        // 延一拍关:否则 blur 先发生,点候选那一下落空(经典下拉列表坑)
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
    </label>
  );
}
