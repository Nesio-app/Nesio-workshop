'use client';

/**
 * 说一句 — recording bottom sheet that:
 * 1. Opens with SpeechRecognition streaming transcript
 * 2. Shows real-time text + intent label
 * 3. On send: POSTs to /api/portal/analyze
 * 4. Saves returned nodes to Life Graph
 * 5. Triggers re-run of Reasoning Engine
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getRecentNodes, getLifeGraph, updateLifeNode, isPrivateExternalNode, searchLifeGraphFuzzy, type LifeNode } from '@/lib/portal/life-graph';
import { signalToLifeNode } from '@/lib/life-domain';
import { searchSignalsSemantically, searchSignalsWithCloudFallback } from '@/lib/life-domain/signal-search';
import { markRetrievalFeedback } from '@/lib/life-domain/retrieval-feedback';
import {
  createSignalWithNode,
  extractContext,
  type FrontDomain,
  type SignalContext,
} from '@/lib/life-domain';
import { routeIntent } from '@/lib/portal/intent-router';
import { IconBox, IconCalendar, IconCamera, IconClock, IconMapPin, IconUser } from './icons';
import { L } from '@/lib/portal/i18n';
import { prefetchCaptureLocation } from '@/lib/portal/capture-location';
import { looksLikeTask } from '@/lib/portal/task-heuristics';
import { permissionRationale, shouldExplainPermission, markPermissionExplained } from '@/lib/portal/permission-rationale';
import { loadProfileSettings, portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import NesioSheet from './ui/NesioSheet';

interface VoiceInputSheetProps {
  open: boolean;
  intent?: 'note' | 'ask';
  canUsePrivateData?: boolean;
  onClose: () => void;
}

const QUICK_INTENTS = [
  { zh: '记住…', en: 'Remember…', prefixZh: '记住 ', prefixEn: 'Remember ' },
  { zh: '帮我安排…', en: 'Schedule…', prefixZh: '帮我安排 ', prefixEn: 'Schedule ' },
  { zh: '提醒我…', en: 'Remind me…', prefixZh: '提醒我 ', prefixEn: 'Remind me ' },
  { zh: '我今天…', en: 'Today I…', prefixZh: '我今天 ', prefixEn: 'Today I ' },
];

// 批次189(图3):把带时间的记忆一键加进系统日历。
// iOS 上打开 data:text/calendar 会直接弹苹果原生「New Event」(截图那个);Google 链接则开 Google 日历。
function icsStamp(date: string, time?: string): { value: string; allDay: boolean } {
  const ymd = date.replace(/-/g, '');
  const m = time && /^(\d{1,2}):(\d{2})$/.exec(time);
  if (m) return { value: `${ymd}T${m[1].padStart(2, '0')}${m[2]}00`, allDay: false };
  return { value: ymd, allDay: true };
}
function buildIcsDataUri(title: string, date: string, time?: string): string {
  const { value, allDay } = icsStamp(date, time);
  const esc = (s: string) => s.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const dtstart = allDay ? `DTSTART;VALUE=DATE:${value}` : `DTSTART:${value}`;
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nesio//念念//ZH', 'BEGIN:VEVENT',
    `UID:nesio-${Date.now()}@nesio.app`, `SUMMARY:${esc(title)}`, dtstart, 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}
function buildGoogleCalUrl(title: string, date: string, time?: string): string {
  const ymd = date.replace(/-/g, '');
  const m = time && /^(\d{1,2}):(\d{2})$/.exec(time);
  let dates: string;
  if (m) {
    const start = `${ymd}T${m[1].padStart(2, '0')}${m[2]}00`;
    const end = `${ymd}T${String((Number(m[1]) + 1) % 24).padStart(2, '0')}${m[2]}00`;
    dates = `${start}/${end}`;
  } else {
    dates = `${ymd}/${ymd}`;
  }
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${dates}`;
}

type SendState = 'idle' | 'analyzing' | 'confirm' | 'saved' | 'error';
type AskResult = Pick<LifeNode, 'id' | 'name'> & { source: string; reason?: string };
interface AskAggregation { label: string; value: string | number; }
interface AskApiResponse {
  nodes: AskResult[];
  answer: string;
  aggregations: AskAggregation[];
  webSearchUsed: boolean;
}

/** A captured input held for user confirmation before it becomes a trusted fact (§6.2). */
interface PendingDraft {
  rawText: string;
  cleanText: string;
  inlineTags: string[];
  title: string;
  aiConfidence: number;
  baseContext: SignalContext;   // labels / intent / time / secondaryDomains from extraction
  domain: FrontDomain | null;
  people: string[];
  places: string[];
  objects: string[];
  edited: boolean;
  // 提醒/计划专用字段
  dueDate?: string;
  dueTime?: string;
  recurring?: string;
  priority?: string;
}

function signalTypeForDomain(domain: FrontDomain | null, hasPlaceOrObject: boolean): string {
  if (domain === 'assets') return hasPlaceOrObject ? 'object.location' : 'object';
  if (domain === 'health') return 'health.state';
  if (domain === 'growth') return 'task';
  if (domain === 'energy') return 'energy.state';
  return 'observation';
}

function parseInlineTags(value: string): string[] {
  const tags = value.match(/#[^\s#，。,.!?！？:：；;]+/g) || [];
  return Array.from(new Set(tags.map((tag) => tag.slice(1).trim()).filter(Boolean)));
}

function stripInlineTags(value: string): string {
  return value.replace(/#[^\s#，。,.!?！？:：；;]+/g, '').replace(/\s+/g, ' ').trim();
}

function mergeTags(...groups: Array<string[] | undefined>): string[] {
  return Array.from(new Set(groups.flatMap((group) => group || []).filter(Boolean)));
}

async function fetchAskResponse(query: string, candidates: LifeNode[]): Promise<AskApiResponse> {
  const empty: AskApiResponse = { nodes: [], answer: '', aggregations: [], webSearchUsed: false };
  if (!candidates.length) return empty;
  const res = await fetch('/api/portal/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-baohe-access-mode': 'personal_lab' },
    body: JSON.stringify({
      type: 'ask',
      uiLocale: loadProfileSettings().locale,
      content: JSON.stringify({
        query,
        totalNodeCount: candidates.length,
        candidates: candidates.slice(0, 60).map((node) => ({
          id: node.id,
          type: node.type,
          name: node.name,
          tags: node.tags,
          source: node.source,
          rawInput: node.rawInput,
          attributes: node.attributes,
          relations: node.relations,
        })),
      }),
    }),
  });
  // 500/402/429/超时 是**故障**,不是「空结果」—— 抛错让调用方走显式失败态,别把基础设施
  // 故障伪装成「没找到线索」(红线)。genuine 空答由下面 200 响应的 !data.ok && !answer 处理。
  if (!res.ok) throw new Error(`ask_failed_${res.status}`);
  const data = await res.json() as {
    ok?: boolean;
    matches?: Array<{ id?: string; name?: string; reason?: string }>;
    answer?: string;
    aggregations?: AskAggregation[];
    webSearchUsed?: boolean;
  };
  if (!data.ok && !data.answer) return empty;
  // Build reason lookup
  const reasonMap = new Map<string, string>();
  data.matches?.forEach((m) => {
    if (m.id) reasonMap.set(m.id, m.reason || '');
    if (m.name) reasonMap.set(m.name, m.reason || '');
  });
  const matchedNodes: AskResult[] = candidates
    .filter((n) => reasonMap.has(n.id) || reasonMap.has(n.name))
    .map((n) => ({ id: n.id, name: n.name, source: n.source || '', reason: reasonMap.get(n.id) || reasonMap.get(n.name) || '' }));
  return {
    nodes: matchedNodes,
    answer: data.answer || '',
    aggregations: data.aggregations || [],
    webSearchUsed: data.webSearchUsed || false,
  };
}

// ---- 日期时间选择器 ----
const MONTH_NAMES = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
const MONTH_NAMES_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEKDAY_LABELS = ['一','二','三','四','五','六','日'];
const WEEKDAY_LABELS_EN = ['Mo','Tu','We','Th','Fr','Sa','Su'];

interface DTPValue {
  date: string;
  time?: string;
  recurring?: string;
  priority?: string;
}

function DateTimePicker({ value, onChange, onClose }: {
  value: DTPValue;
  onChange: (v: DTPValue) => void;
  onClose: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const todayStr = new Date().toISOString().slice(0, 10);
  const initDate = value.date ? new Date(value.date + 'T00:00:00') : new Date();
  const [viewYear, setViewYear] = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth());

  const todayDate = new Date(todayStr + 'T00:00:00');

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  const firstDow = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: Array<number | null> = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function selectDay(day: number) {
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`;
    onChange({ ...value, date: dateStr });
  }

  return (
    <div className="nesio-dtp-overlay" role="dialog" aria-modal>
      <div className="nesio-dtp-backdrop" onClick={onClose} />
      <div className="nesio-dtp-sheet">
        {/* 月份导航 */}
        <div className="nesio-dtp-month-nav">
          <button type="button" className="nesio-dtp-nav-btn" onClick={prevMonth}>‹</button>
          <span className="nesio-dtp-month-label">{L(dict, `${viewYear}年 ${MONTH_NAMES[viewMonth]}`, `${MONTH_NAMES_EN[viewMonth]} ${viewYear}`)}</span>
          <button type="button" className="nesio-dtp-nav-btn" onClick={nextMonth}>›</button>
        </div>

        {/* 星期标题 */}
        <div className="nesio-dtp-weekdays">
          {(dict === 'en' ? WEEKDAY_LABELS_EN : WEEKDAY_LABELS).map(d => <span key={d}>{d}</span>)}
        </div>

        {/* 日期格子 */}
        <div className="nesio-dtp-days">
          {cells.map((day, i) => {
            if (!day) return <span key={`e${i}`} />;
            const pad = (n: number) => String(n).padStart(2, '0');
            const dateStr = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`;
            const cellDate = new Date(dateStr + 'T00:00:00');
            const isToday = cellDate.getTime() === todayDate.getTime();
            const isSelected = value.date === dateStr;
            return (
              <button
                key={day}
                type="button"
                className={`nesio-dtp-day${isToday ? ' nesio-dtp-day--today' : ''}${isSelected ? ' nesio-dtp-day--selected' : ''}`}
                onClick={() => selectDay(day)}
              >
                {day}
              </button>
            );
          })}
        </div>

        <div className="nesio-dtp-divider" />

        {/* 时间 */}
        <div className="nesio-dtp-row">
          <span className="nesio-dtp-row-label">{L(dict, '时间', 'Time')}</span>
          <input
            type="time"
            className="nesio-dtp-time-input"
            value={value.time ?? ''}
            onChange={(e) => onChange({ ...value, time: e.target.value || undefined })}
          />
        </div>

        {/* 重复 */}
        <div className="nesio-dtp-row nesio-dtp-row--wrap">
          <span className="nesio-dtp-row-label">{L(dict, '重复', 'Repeat')}</span>
          <div className="nesio-dtp-options">
            {[L(dict, '不重复', 'None'), L(dict, '每天', 'Daily'), L(dict, '每周', 'Weekly'), L(dict, '每月', 'Monthly')].map(r => (
              <button
                key={r}
                type="button"
                className={`nesio-dtp-opt${value.recurring === r ? ' nesio-dtp-opt--on' : ''}`}
                onClick={() => onChange({ ...value, recurring: value.recurring === r ? undefined : r })}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* 优先级 */}
        <div className="nesio-dtp-row nesio-dtp-row--wrap">
          <span className="nesio-dtp-row-label">{L(dict, '优先级', 'Priority')}</span>
          <div className="nesio-dtp-options">
            {([['var(--status-risk)', L(dict, '高', 'High')],['var(--status-gentle)', L(dict, '中', 'Med')],['var(--status-go)', L(dict, '低', 'Low')]] as const).map(([dot, key]) => (
              <button
                key={key}
                type="button"
                className={`nesio-dtp-opt${value.priority === key ? ' nesio-dtp-opt--on' : ''}`}
                onClick={() => onChange({ ...value, priority: value.priority === key ? undefined : key })}
              >
                <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: dot, marginRight: 4 }} /> {key}
              </button>
            ))}
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="nesio-dtp-footer">
          <button type="button" className="nesio-dtp-clear"
            onClick={() => { onChange({ date: todayStr }); onClose(); }}>
            {L(dict, '清除', 'Clear')}
          </button>
          <button type="button" className="nesio-dtp-confirm" onClick={onClose}>
            {L(dict, '确定', 'Done')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VoiceInputSheet({ open, intent = 'note', canUsePrivateData = false, onClose }: VoiceInputSheetProps) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [micPrimer, setMicPrimer] = useState(false); // 批次216:首次点麦克风先讲「为什么」再弹系统框
  const [sendState, setSendState] = useState<SendState>('idle');
  const [intentLabel, setIntentLabel] = useState('');
  const [micError, setMicError] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  const [askResults, setAskResults] = useState<AskResult[]>([]);
  const [askAnswer, setAskAnswer] = useState('');
  const [askAggregations, setAskAggregations] = useState<AskAggregation[]>([]);
  const [webSearchUsed, setWebSearchUsed] = useState(false);
  // 付费云答失败(500/402/超时)不再伪装成「没找到线索」:置此标志渲染显式失败态 + 重试(红线)。
  const [askError, setAskError] = useState(false);
  // 批次189:说一句直接存 —— 删确认卡。日期/重复收进折叠「详情」;可贴一张图;存完带时间的给「加入日历」。
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<{ date?: string; time?: string; recurring?: string; priority?: string }>({});
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [savedEvent, setSavedEvent] = useState<{ title: string; date: string; time?: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const isAskMode = intent === 'ask';

  useEffect(() => {
    if (open) prefetchCaptureLocation(); // 批次 56:说一句打开即预热定位
    if (!open) {
      setText(''); setSendState('idle'); setListening(false);
      setIntentLabel(''); setMicError(''); setSavedCount(0);
      setAskResults([]); setAskAnswer(''); setAskAggregations([]); setWebSearchUsed(false);
      setDetail({}); setDetailOpen(false); setImageDataUrl(''); setSavedEvent(null); setShowDatePicker(false);
      recRef.current?.stop();
    } else {
      setTimeout(() => inputRef.current?.focus(), 120);
    }
    // 卸载时(录音中被父组件直接移除,没先置 open=false)也要释放麦克风。
    return () => { recRef.current?.stop(); recRef.current = null; };
  }, [open, isAskMode]);

  // Update intent label as user types/speaks
  useEffect(() => {
    if (text.trim()) setIntentLabel(routeIntent(text).suggestedAction);
    else setIntentLabel('');
  }, [text]);

  function startListening() {
    setMicError('');
    const w = window as unknown as Record<string, unknown>;
    const Ctor = (w['SpeechRecognition'] || w['webkitSpeechRecognition']) as
      (new () => {
        lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
        onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string; isFinal?: boolean }>> }) => void) | null;
        onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
        start: () => void; stop: () => void;
      }) | undefined;

    if (!Ctor) {
      setMicError(L(dict, '此浏览器不支持语音输入，请直接打字。', 'Voice input is not supported in this browser — please type.'));
      setTimeout(() => inputRef.current?.focus(), 100);
      return;
    }

    const rec = new Ctor();
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let final = '';
      let interim = '';
      Array.from(e.results).forEach((r) => {
        const t = r[0].transcript;
        if ((r as { isFinal?: boolean }).isFinal) final += t;
        else interim += t;
      });
      setText(final + interim);
    };
    rec.onend = () => setListening(false);
    rec.onerror = (e) => {
      setListening(false);
      if (e.error === 'not-allowed') setMicError(L(dict, '麦克风权限被拒，请在浏览器设置中允许后重试。', 'Mic permission denied — allow it in browser settings and retry.'));
      else if (e.error === 'no-speech') { /* silently retry */ }
    };

    try { rec.start(); recRef.current = rec; setListening(true); }
    catch { setMicError(L(dict, '无法启动语音识别，请直接打字。', 'Could not start speech recognition — please type.')); }
  }

  function stopListening() { recRef.current?.stop(); setListening(false); }
  // 批次216:第一次点麦克风,先弹前置说明(讲清用途 + 端上/不上传),再触发系统框;
  // 说明过一次(localStorage)后直接开始。拒绝的优雅降级(退打字)已在 startListening 的 onerror 里。
  function handleMicTap() {
    if (shouldExplainPermission('microphone')) { setMicPrimer(true); return; }
    startListening();
  }
  function allowMicAndStart() {
    markPermissionExplained('microphone');
    setMicPrimer(false);
    startListening();
  }

  async function handleSend() {
    const t = text.trim();
    if (!t) return;

    if (isAskMode) {
      stopListening();
      setSendState('analyzing');
      setAskError(false);
      const allCandidates = getRecentNodes(80).filter((node) => canUsePrivateData || !isPrivateExternalNode(node));
      // Signal 事实面语义搜索优先(cutover 后读事实缓存),模糊/近期节点补位。
      // 已登录用户:先经云端 RAG 回溯(pgvector/文本)再本地并轨 —— 本地事实缓存
      // 只是全量图谱的近端切片,深问需要回捞更早/别端只落云的事实(OPEN-WORLD ②)。
      // best-effort:云端不可达时 searchSignalsWithCloudFallback 内部回退纯本地。
      const semanticSignals = canUsePrivateData
        ? await searchSignalsWithCloudFallback(t, 30)
        : searchSignalsSemantically(t, 20);
      const semanticFirst = semanticSignals
        .map(signalToLifeNode)
        .filter((node) => canUsePrivateData || !isPrivateExternalNode(node));
      const fuzzyFirst = searchLifeGraphFuzzy(t, 20);
      const seenIds = new Set<string>();
      const merged: LifeNode[] = [];
      for (const n of [...semanticFirst, ...fuzzyFirst, ...allCandidates]) {
        if (!seenIds.has(n.id)) { seenIds.add(n.id); merged.push(n); }
      }
      const candidates = merged.slice(0, 60);
      let askFailed = false;
      try {
        const result = await fetchAskResponse(t, candidates);
        setAskAnswer(result.answer);
        setAskAggregations(result.aggregations);
        setWebSearchUsed(result.webSearchUsed);
        if (result.nodes.length) {
          setAskResults(result.nodes);
        } else if (!result.answer) {
          // 纯本地模糊搜索兜底
          const fuzzyFallback = searchLifeGraphFuzzy(t, 4);
          setAskResults(fuzzyFallback.map((n) => ({ id: n.id, name: n.name, source: n.source || '' })));
        } else {
          setAskResults([]);
        }
      } catch {
        // 云答故障:保留本地模糊结果作降级兜底,但置 askError 让屏上显式提示 + 可重试,
        // 不再把故障伪装成「没找到线索」的成功态(红线:每个异步动作必须有可见失败态)。
        askFailed = true;
        const fuzzyFallback = searchLifeGraphFuzzy(t, 4);
        setAskResults(fuzzyFallback.map((n) => ({ id: n.id, name: n.name, source: n.source || '' })));
        setAskAnswer('');
      }
      setAskError(askFailed);
      setSendState('saved');
      // 失败时保留输入,重试按钮直接再调 handleSend(读同一 text);成功才清空。
      if (!askFailed) setText('');
      setIntentLabel('');
      return;
    }

    setSendState('analyzing');
    const inlineTags = parseInlineTags(t);
    const cleanText = stripInlineTags(t) || inlineTags.join(' ') || t;

    // Context Extraction (§6.2): structure the input before it becomes a fact.
    // Rule-based v1; AI may refine the title/confidence below.
    const context = extractContext(cleanText);

    let title = cleanText.slice(0, 40);
    // 批次 146:用规则分类的真实置信度(零命中→0.25),不再硬编码 0.7。
    // 低置信落成节点时 isNodeUncertain 会标「待确认」,而不是把猜的当准的。
    let aiConfidence = context.confidence?.ai ?? 0.7;
    // 批次 33 用户定案:**任何档位都不自动打 AI** —— 规则抽取是唯一默认路径,
    // AI 识别永远是确认卡上的显式按钮(点了才花钱、才等待)。
    // (旧的 Pro 自动云识别分支已删除 —— AI 只走确认卡上的「AI 识别」按钮)

    const pending: PendingDraft = {
      rawText: t,
      cleanText,
      inlineTags,
      title,
      aiConfidence,
      baseContext: context,
      domain: context.domain ?? null,
      people: context.people ?? [],
      places: context.places ?? [],
      objects: context.objects ?? [],
      edited: Boolean(detail.date || detail.recurring || detail.priority),
      // 批次189:折叠「详情」里手设的日期/重复/优先级并入草稿(用户亲手设=可信)
      dueDate: detail.date,
      dueTime: detail.time,
      recurring: detail.recurring,
      priority: detail.priority,
    };

    // 批次189(用户实锤:删确认卡):告诉念念 = 规则抽取**直接存**,不再中间拦一张卡、不再有 AI 识别。
    void writeSignalFromDraft(pending, false);
  }

  async function writeSignalFromDraft(d: PendingDraft, userConfirmed: boolean) {
    const hasPlaceOrObject = d.places.length > 0 || d.objects.length > 0;
    const context: SignalContext = {
      ...d.baseContext,
      domain: d.domain ?? undefined,
      people: d.people,
      places: d.places,
      objects: d.objects,
      confidence: { ai: d.aiConfidence, userConfirmed, userEdited: d.edited },
    };
    // Canonical write path: one Signal carrying structured context. createSignal
    // mirrors to cloud for signed-in users (§Signal main-fact transition).
    const extraPayload: Record<string, string> = {};
    if (d.dueDate) extraPayload.dueDate = d.dueDate;
    if (d.dueTime) extraPayload.dueTime = d.dueTime;
    if (d.recurring) extraPayload.recurring = d.recurring;
    if (d.priority) extraPayload.priority = d.priority;

    // 批次 31:像待办的一律 task —— 「洗衣服下午」不再因无 domain 落成 preference
    const taskLike = looksLikeTask(d.rawText) || looksLikeTask(d.title);
    const { nodeId } = createSignalWithNode({
      source: 'voice',
      type: taskLike ? 'task' : signalTypeForDomain(d.domain, hasPlaceOrObject),
      title: d.title,
      payload: { note: d.cleanText, ...extraPayload },
      // 批次 179:用户亲口说 + 亲手经此 sheet 存入 = 用户授权,置信拉满 → 不再标「待确认」。
      // 「待确认」只该留给系统自动抽取(邮件/日历)未经用户过目的条目。与时间线记一笔(手打=可信)一致。
      // 原始 AI 结构置信仍保留在 context.confidence.ai 供溯源。
      confidence: Math.max(d.aiConfidence, 0.9),
      context,
      tags: mergeTags([dict === 'en' ? 'Voice' : '说一句', d.domain ? `domain:${d.domain}` : ''], d.inlineTags),
      raw: d.rawText,
    });

    // 批次189:贴的图片挂到这条记忆(与拍照同一套本地图仓 local-image-store)
    if (imageDataUrl) {
      try {
        const { putLocalImage } = await import('@/lib/portal/local-image-store');
        const localAssetId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        await putLocalImage(localAssetId, imageDataUrl);
        const node = getLifeGraph().find((n) => n.id === nodeId);
        updateLifeNode(nodeId, {
          assets: [...(node?.assets || []), { id: localAssetId, kind: 'image', mimeType: 'image/jpeg', local: true, createdAt: new Date().toISOString() }],
        });
      } catch { /* 图挂失败不挡存文字 */ }
    }

    setSavedCount(1);
    setSendState('saved');
    // 批次189(图3):带时间的 → 停在 saved 态给「加入日历」,不自动关;否则照旧 1.1s 自动关。
    if (d.dueDate) {
      setSavedEvent({ title: d.title, date: d.dueDate, time: d.dueTime });
    } else {
      setTimeout(() => { onClose(); setText(''); setSendState('idle'); }, 1100);
    }
  }

  // 批次189:折叠「详情」里的日期/重复/优先级选择,写进 detail(存入时并进草稿)。
  function setDetailDTP(v: DTPValue) {
    setDetail({ date: v.date || undefined, time: v.time, recurring: v.recurring, priority: v.priority });
  }

  // 批次189:「贴图片」—— 选图后压缩成 dataURL 存 state,存入时挂到记忆节点。
  async function pickImage(file: File | undefined) {
    if (!file) return;
    try {
      const { compressToDataUrl } = await import('@/lib/portal/local-image-store');
      setImageDataUrl(await compressToDataUrl(file));
    } catch { /* 压缩失败忽略,不挡记文字 */ }
  }

  if (!open) return null;

  return (
    <NesioSheet
      variant="bottom"
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      card={false}
      className="nesio-voice-sheet-card"
      ariaLabel={isAskMode ? L(dict, '问念念', 'Ask Nessa') : L(dict, '说一句', 'Say it')}
    >

        <div className="nesio-voice-sheet-header">
          <h2 className="nesio-voice-sheet-title">{isAskMode ? L(dict, '问念念', 'Ask Nessa') : L(dict, '说一句', 'Say it')}</h2>
          {/* 批次 33:右上角 ✕ 撤除(用户指令)—— 退出走背景点击/手柄下拉 */}
        </div>

        {/* 批次189:确认卡 + 编辑卡整块删除 —— 告诉念念直接存,日期/重复移到输入区折叠「详情」。 */}

        {/* 批次216:麦克风权限前置说明 —— 先讲为什么再弹系统框,把「端上/不上传」卖点说出来 */}
        {micPrimer && (
          <div style={{ margin: '0 0 0.6rem', padding: '0.9rem 1rem', borderRadius: 14, background: 'var(--portal-card, #fff)', border: '1px solid var(--portal-line, #d7deea)', textAlign: 'center' }}>
            <div style={{ fontSize: '1.7rem', lineHeight: 1 }} aria-hidden>{permissionRationale('microphone').icon}</div>
            <p style={{ fontWeight: 600, margin: '0.5rem 0 0.25rem' }}>{permissionRationale('microphone').title[dict === 'en' ? 1 : 0]}</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--portal-muted, #8a94a6)', lineHeight: 1.6, margin: 0 }}>{permissionRationale('microphone').body[dict === 'en' ? 1 : 0]}</p>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
              <button type="button" onClick={() => setMicPrimer(false)} style={{ flex: 1, padding: '0.55rem', borderRadius: 10, border: '1px solid var(--portal-line, #d7deea)', background: 'transparent', color: 'var(--portal-muted, #8a94a6)', cursor: 'pointer' }}>{L(dict, '以后再说', 'Not now')}</button>
              <button type="button" className="nesio-ob-primary-btn" onClick={allowMicAndStart} style={{ flex: 1, marginTop: 0 }}>{L(dict, '允许并开始', 'Allow & start')}</button>
            </div>
          </div>
        )}

        {/* Text input fallback */}
        {sendState !== 'confirm' && (
        <div className="nesio-voice-input-row">
          <span className="nesio-voice-input-spark">✦</span>
          <input
            ref={inputRef}
            className="nesio-voice-input"
            placeholder={isAskMode ? L(dict, '打字问念念,或点麦克风说…', 'Type your question, or tap the mic…') : L(dict, '说一句,或直接打字…', 'Say it, or just type…')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          <button
            type="button"
            className={`nesio-voice-mic-btn${listening ? ' nesio-voice-mic-btn--active' : ''}`}
            onClick={listening ? stopListening : handleMicTap}
            aria-label={listening ? L(dict, '停止录音', 'Stop recording') : L(dict, '开始录音', 'Start recording')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
              <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
            </svg>
          </button>
        </div>
        )}


        {/* 批次189:贴图片 + 详情(日期/重复)折叠 —— 只在「说一句」模式,问一问不需要 */}
        {!isAskMode && sendState !== 'confirm' && sendState !== 'saved' && (
          <div className="nesio-voice-extras">
            <input ref={imgInputRef} type="file" accept="image/*" hidden onChange={(e) => { void pickImage(e.target.files?.[0]); e.target.value = ''; }} />
            {imageDataUrl ? (
              <span className="nesio-voice-imgchip">
                <img src={imageDataUrl} alt="" />
                <button type="button" onClick={() => setImageDataUrl('')} aria-label={L(dict, '去掉图片', 'Remove image')}>✕</button>
              </span>
            ) : (
              <button type="button" className="nesio-voice-extra-btn" onClick={() => imgInputRef.current?.click()}>
                <IconCamera size={14} /> {L(dict, '贴图片', 'Photo')}
              </button>
            )}
            <button type="button" className={`nesio-voice-extra-btn${detailOpen || detail.date ? ' is-on' : ''}`} onClick={() => setDetailOpen((o) => !o)}>
              <IconClock size={14} /> {detail.date
                ? `${new Date(detail.date + 'T00:00:00').getMonth() + 1}/${new Date(detail.date + 'T00:00:00').getDate()}${detail.time ? ` ${detail.time}` : ''}`
                : L(dict, '详情', 'Details')}
              <span className="nesio-voice-extra-caret" aria-hidden>{detailOpen ? '▴' : '▾'}</span>
            </button>
          </div>
        )}
        {!isAskMode && detailOpen && sendState !== 'saved' && typeof document !== 'undefined' && createPortal(
          // 日期选择器是 position:fixed 全屏面板;语音 sheet 已是 Vaul(transform),内联会被困住。
          // portal 到 body 逃出 transform(.nesio-dtp-overlay 自带 z-1200 + pointer-events:auto 绕 Vaul body 锁)。
          <DateTimePicker
            value={{ date: detail.date ?? new Date().toISOString().slice(0, 10), time: detail.time, recurring: detail.recurring, priority: detail.priority }}
            onChange={setDetailDTP}
            onClose={() => setDetailOpen(false)}
          />,
          document.body,
        )}

        {/* Intent label — 批次 184:聊天意图变成可点链接,跳「问一问」并带上这句话(不再是死标签) */}
        {!isAskMode && intentLabel && sendState !== 'confirm' && (
          intentLabel === '和念念聊聊' ? (
            <button
              type="button"
              className="nesio-voice-intent-label nesio-voice-intent-link"
              onClick={() => { const t = text.trim(); onClose(); if (t) window.dispatchEvent(new CustomEvent('nesio-ask-text', { detail: { text: t } })); }}
            >
              <span>✦</span> {L(dict, '和念念聊聊', 'Chat with Nessa')} ›
            </button>
          ) : (
            <div className="nesio-voice-intent-label">
              <span>✦</span> {intentLabel}
            </div>
          )
        )}

        {/* Waveform / status */}
        {sendState !== 'confirm' && (
        <div className="nesio-voice-status">
          {listening ? (
            <>
              <div className="nesio-voice-wave" aria-hidden>
                {Array.from({ length: 7 }, (_, i) => (
                  <span key={i} className="nesio-voice-wave-bar" style={{ animationDelay: `${i * 0.09}s` }} />
                ))}
              </div>
              <span className="nesio-voice-status-label">{isAskMode ? L(dict, '正在听这一句…', 'Listening…') : L(dict, '正在记录…', 'Recording…')}</span>
              <button type="button" style={{ fontSize: '0.72rem', color: 'var(--portal-muted)', marginLeft: '0.5rem', padding: '0.2rem 0.5rem' }} onClick={stopListening}>
                {L(dict, '停止', 'Stop')}
              </button>
            </>
          ) : micError ? (
            <span style={{ fontSize: '0.73rem', color: 'var(--status-risk)', textAlign: 'center', lineHeight: 1.4 }}>{micError}</span>
          ) : null}
        </div>
        )}

        {/* Quick intent chips */}
        {!isAskMode && sendState !== 'confirm' && (
          <div className="nesio-voice-quick">
            {QUICK_INTENTS.map((q) => (
              <button key={q.zh} type="button" className="nesio-voice-quick-btn"
                onClick={() => { stopListening(); setText(L(dict, q.prefixZh, q.prefixEn)); setTimeout(() => inputRef.current?.focus(), 50); }}>
                {L(dict, q.zh, q.en)}
              </button>
            ))}
          </div>
        )}

        {/* Ask 结果展示 */}
        {isAskMode && sendState === 'saved' ? (
          <div className="nesio-ask-result">
            {/* 云答故障的显式失败态:warm-coach 语气 + 重试;下方仍展示本地兜底线索。 */}
            {askError && (
              <div
                className="nesio-ask-answer-block"
                style={{
                  border: '1px solid var(--status-gentle-soft)',
                  background: 'var(--status-gentle-soft)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)',
                }}
              >
                <p className="nesio-ask-answer-text" style={{ color: 'var(--portal-ink)', margin: 0 }}>
                  {L(dict, '这次没接上,先给你本地记忆里的线索。', "Couldn't reach the assistant — showing clues from your local memory.")}
                </p>
                <button
                  type="button"
                  className="nesio-ask-retry-btn"
                  onClick={() => { void handleSend(); }}
                  style={{
                    flexShrink: 0, padding: 'var(--space-1) var(--space-3)', borderRadius: 'var(--radius-pill)',
                    border: '1px solid var(--portal-accent-border)', background: 'var(--portal-bg)',
                    color: 'var(--portal-accent)', fontSize: 'var(--text-sm)', cursor: 'pointer',
                  }}
                >
                  {L(dict, '重试', 'Retry')}
                </button>
              </div>
            )}
            {/* AI 综合回答 */}
            {askAnswer ? (
              <div className="nesio-ask-answer-block">
                <span className="nesio-ask-answer-icon">✦</span>
                <p className="nesio-ask-answer-text">{askAnswer}</p>
                {webSearchUsed && <span className="nesio-ask-web-badge">{L(dict, '网络搜索', 'Web search')}</span>}
              </div>
            ) : (!askResults.length && (
              <div className="nesio-ask-answer-block">
                <p className="nesio-ask-answer-text" style={{ color: 'var(--portal-muted)' }}>{L(dict, '还没找到相关线索。', 'No relevant clues found yet.')}</p>
              </div>
            ))}

            {/* 统计聚合 */}
            {askAggregations.length > 0 && (
              <div className="nesio-ask-aggregations">
                {askAggregations.map((a, i) => (
                  <div key={i} className="nesio-ask-agg-item">
                    <span className="nesio-ask-agg-label">{a.label}</span>
                    <span className="nesio-ask-agg-value">{a.value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 引用来源卡片 */}
            {askResults.length > 0 && (
              <div className="nesio-ask-citations">
                <p className="nesio-ask-citations-title">{L(dict, '来源线索', 'Sources')}</p>
                {askResults.slice(0, 5).map((node) => (
                  <div key={node.id} className="nesio-ask-citation-card">
                    <span className="nesio-ask-citation-name">{node.name}</span>
                    {node.reason && <span className="nesio-ask-citation-reason">{node.reason}</span>}
                    {/* 开放世界 ④:检索反馈闭环 —— 「不是这个」落成一等公民 Signal(跨端/可撤),
                        下次检索到同一目标即自动剔除。就地从当前来源里移除。 */}
                    <button
                      type="button"
                      className="nesio-ask-citation-dismiss"
                      aria-label={L(dict, '不是这个', 'Not this')}
                      title={L(dict, '不是这个', 'Not this')}
                      onClick={() => {
                        markRetrievalFeedback(node.id, 'not_this');
                        setAskResults((prev) => prev.filter((n) => n.id !== node.id));
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              className="nesio-ask-again-btn"
              onClick={() => { setSendState('idle'); setAskAnswer(''); setAskResults([]); setAskAggregations([]); setWebSearchUsed(false); }}
            >
              {L(dict, '再问一句', 'Ask another')}
            </button>
          </div>
        ) : sendState === 'saved' ? (
          <div className="nesio-voice-saved-wrap">
            <div className="nesio-voice-saved">✓ {L(dict, `已存入 Memory（${savedCount} 条）`, `Saved to Memory (${savedCount})`)}</div>
            {/* 批次189(图3):带时间的记忆 → 一键加进系统日历(iOS 走 .ics 直接开苹果原生;另给 Google 链接) */}
            {savedEvent && (
              <div className="nesio-voice-cal">
                <a className="nesio-voice-cal-btn nesio-voice-cal-btn--primary" href={buildIcsDataUri(savedEvent.title, savedEvent.date, savedEvent.time)} download={`${savedEvent.title.slice(0, 24) || 'event'}.ics`}>
                  <IconCalendar size={14} /> {L(dict, '加入日历', 'Add to calendar')}
                </a>
                <a className="nesio-voice-cal-btn" href={buildGoogleCalUrl(savedEvent.title, savedEvent.date, savedEvent.time)} target="_blank" rel="noopener noreferrer">
                  {L(dict, 'Google 日历', 'Google')}
                </a>
                <button type="button" className="nesio-voice-cal-done" onClick={() => { onClose(); setText(''); setSendState('idle'); }}>
                  {L(dict, '完成', 'Done')}
                </button>
              </div>
            )}
          </div>
        ) : sendState === 'analyzing' ? (
          <div className="nesio-voice-send-btn" style={{ opacity: 0.6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <span className="nesio-camera-recognizing-dot" style={{ background: '#fff' }} />{isAskMode ? L(dict, '正在搜索记忆…', 'Searching memory…') : L(dict, '念念正在整理…', 'Nessa is sorting…')}
          </div>
        ) : text.trim() && sendState !== 'confirm' ? (
          <button type="button" className="nesio-voice-send-btn" onClick={handleSend}>
            {isAskMode ? L(dict, '问念念', 'Ask') : L(dict, '告诉念念', 'Tell Nessa')}
          </button>
        ) : null}
    </NesioSheet>
  );
}
