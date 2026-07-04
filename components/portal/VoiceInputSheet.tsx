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
import { getRecentNodes, isPrivateExternalNode, searchLifeGraphFuzzy, type LifeNode } from '@/lib/portal/life-graph';
import { signalToLifeNode } from '@/lib/life-domain';
import { searchSignalsSemantically } from '@/lib/life-domain/signal-search';
import {
  createSignal,
  extractContext,
  hasContext,
  ALL_DOMAINS,
  DOMAINS,
  type FrontDomain,
  type SignalContext,
} from '@/lib/life-domain';
import { routeIntent } from '@/lib/portal/intent-router';
import { DomainIcon, IconBox, IconClock, IconMapPin, IconUser } from './icons';

interface VoiceInputSheetProps {
  open: boolean;
  intent?: 'note' | 'ask';
  canUsePrivateData?: boolean;
  onClose: () => void;
}

const QUICK_INTENTS = [
  { label: '记住…', prefix: '记住 ' },
  { label: '帮我安排…', prefix: '帮我安排 ' },
  { label: '提醒我…', prefix: '提醒我 ' },
  { label: '我今天…', prefix: '我今天 ' },
];

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
  if (!res.ok) return empty;
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
const WEEKDAY_LABELS = ['一','二','三','四','五','六','日'];

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
          <span className="nesio-dtp-month-label">{viewYear}年 {MONTH_NAMES[viewMonth]}</span>
          <button type="button" className="nesio-dtp-nav-btn" onClick={nextMonth}>›</button>
        </div>

        {/* 星期标题 */}
        <div className="nesio-dtp-weekdays">
          {WEEKDAY_LABELS.map(d => <span key={d}>{d}</span>)}
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
          <span className="nesio-dtp-row-label">时间</span>
          <input
            type="time"
            className="nesio-dtp-time-input"
            value={value.time ?? ''}
            onChange={(e) => onChange({ ...value, time: e.target.value || undefined })}
          />
        </div>

        {/* 重复 */}
        <div className="nesio-dtp-row nesio-dtp-row--wrap">
          <span className="nesio-dtp-row-label">重复</span>
          <div className="nesio-dtp-options">
            {['不重复', '每天', '每周', '每月'].map(r => (
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
          <span className="nesio-dtp-row-label">优先级</span>
          <div className="nesio-dtp-options">
            {([['var(--status-risk)','高'],['var(--status-gentle)','中'],['var(--status-go)','低']] as const).map(([dot, key]) => (
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
            清除
          </button>
          <button type="button" className="nesio-dtp-confirm" onClick={onClose}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VoiceInputSheet({ open, intent = 'note', canUsePrivateData = false, onClose }: VoiceInputSheetProps) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [sendState, setSendState] = useState<SendState>('idle');
  const [intentLabel, setIntentLabel] = useState('');
  const [micError, setMicError] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  const [askResults, setAskResults] = useState<AskResult[]>([]);
  const [askAnswer, setAskAnswer] = useState('');
  const [askAggregations, setAskAggregations] = useState<AskAggregation[]>([]);
  const [webSearchUsed, setWebSearchUsed] = useState(false);
  const [draft, setDraft] = useState<PendingDraft | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const isAskMode = intent === 'ask';

  useEffect(() => {
    if (!open) {
      setText(''); setSendState('idle'); setListening(false);
      setIntentLabel(''); setMicError(''); setSavedCount(0);
      setAskResults([]); setAskAnswer(''); setAskAggregations([]); setWebSearchUsed(false);
      setDraft(null);
      recRef.current?.stop();
    } else {
      setTimeout(() => inputRef.current?.focus(), 120);
    }
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
      setMicError('此浏览器不支持语音输入，请直接打字。');
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
      if (e.error === 'not-allowed') setMicError('麦克风权限被拒，请在浏览器设置中允许后重试。');
      else if (e.error === 'no-speech') { /* silently retry */ }
    };

    try { rec.start(); recRef.current = rec; setListening(true); }
    catch { setMicError('无法启动语音识别，请直接打字。'); }
  }

  function stopListening() { recRef.current?.stop(); setListening(false); }

  async function handleSend() {
    const t = text.trim();
    if (!t) return;

    if (isAskMode) {
      stopListening();
      setSendState('analyzing');
      const allCandidates = getRecentNodes(80).filter((node) => canUsePrivateData || !isPrivateExternalNode(node));
      // Signal 事实面语义搜索优先(cutover 后读事实缓存),模糊/近期节点补位
      const semanticFirst = searchSignalsSemantically(t, 20)
        .map(signalToLifeNode)
        .filter((node) => canUsePrivateData || !isPrivateExternalNode(node));
      const fuzzyFirst = searchLifeGraphFuzzy(t, 20);
      const seenIds = new Set<string>();
      const merged: LifeNode[] = [];
      for (const n of [...semanticFirst, ...fuzzyFirst, ...allCandidates]) {
        if (!seenIds.has(n.id)) { seenIds.add(n.id); merged.push(n); }
      }
      const candidates = merged.slice(0, 60);
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
        const fuzzyFallback = searchLifeGraphFuzzy(t, 4);
        setAskResults(fuzzyFallback.map((n) => ({ id: n.id, name: n.name, source: n.source || '' })));
        setAskAnswer('');
      }
      setSendState('saved');
      setText('');
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
    let aiConfidence = 0.7;
    try {
      const res = await fetch('/api/portal/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'text', content: t }),
      });
      const data = await res.json() as {
        ok?: boolean;
        nodes?: Array<{ name?: string; confidence?: number }>;
      };
      const best = data.ok && data.nodes?.length ? data.nodes[0] : null;
      if (best?.name) title = stripInlineTags(best.name) || title;
      if (typeof best?.confidence === 'number') aiConfidence = best.confidence;
    } catch {
      /* offline — keep rule-based title/confidence */
    }

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
      edited: false,
    };

    // §6.2 绝对控制优先: AI only SUGGESTS. If it found something worth confirming
    // (a domain or any entity), show it for confirmation/edit before it becomes a
    // trusted fact. If there's nothing to confirm, write straight through.
    if (hasContext(context)) {
      setDraft(pending);
      setSendState('confirm');
      return;
    }
    writeSignalFromDraft(pending, false);
  }

  function writeSignalFromDraft(d: PendingDraft, userConfirmed: boolean) {
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

    createSignal({
      source: 'voice',
      type: signalTypeForDomain(d.domain, hasPlaceOrObject),
      title: d.title,
      payload: { note: d.cleanText, ...extraPayload },
      confidence: d.aiConfidence,
      context,
      tags: mergeTags(['说一句', d.domain ? `domain:${d.domain}` : ''], d.inlineTags),
      raw: d.rawText,
    });

    setSavedCount(1);
    setDraft(null);
    setSendState('saved');
    setTimeout(() => { onClose(); setText(''); setSendState('idle'); }, 1100);
  }

  // Confirm-panel editors — each edit flips `edited` so provenance records it (§6.2).
  function setDraftDomain(domain: FrontDomain) {
    setDraft((d) => (d ? { ...d, domain: d.domain === domain ? null : domain, edited: true } : d));
  }
  function dropChip(kind: 'people' | 'places' | 'objects', value: string) {
    setDraft((d) => (d ? { ...d, [kind]: d[kind].filter((item) => item !== value), edited: true } : d));
  }
  function setDraftTitle(title: string) {
    setDraft((d) => (d ? { ...d, title, edited: true } : d));
  }
  function setDraftDTP(v: DTPValue) {
    setDraft((d) => d ? { ...d, dueDate: v.date || undefined, dueTime: v.time, recurring: v.recurring, priority: v.priority, edited: true } : d);
  }

  // 判断是否是提醒/计划类型（需要显示时间相关字段）
  function isCommitmentLike(d: PendingDraft): boolean {
    return d.domain === 'growth' ||
      /提醒|提醒我|安排|计划|任务|待办|记得|别忘|remind|todo|schedule|plan/i.test(d.rawText);
  }

  if (!open) return null;

  return (
    <>
    <div className="nesio-voice-sheet" role="dialog" aria-modal="true" aria-label={isAskMode ? '问宝盒' : '说一句'}>
      <div className="nesio-voice-sheet-backdrop" onClick={onClose} />
      <div className="nesio-voice-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />

        <div className="nesio-voice-sheet-header">
          <h2 className="nesio-voice-sheet-title">{isAskMode ? '问宝盒' : '说一句'}</h2>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        {/* Context confirm (§6.2 绝对控制优先) — AI suggested; you decide before it's trusted. */}
        {sendState === 'confirm' && draft && (
          <div className="nesio-voice-confirm">
            <p className="nesio-voice-confirm-lead">先确认一下，再存入 Memory</p>

            <label className="nesio-voice-confirm-field">
              <span className="nesio-voice-confirm-label">这条叫什么</span>
              <input
                className="nesio-voice-confirm-input"
                value={draft.title}
                onChange={(e) => setDraftTitle(e.target.value)}
                aria-label="标题"
              />
            </label>

            <div className="nesio-voice-confirm-field">
              <span className="nesio-voice-confirm-label">属于哪个领域</span>
              <div className="nesio-voice-confirm-domains">
                {ALL_DOMAINS.map((meta) => (
                  <button
                    key={meta.id}
                    type="button"
                    className={`nesio-voice-confirm-domain${draft.domain === meta.id ? ' is-active' : ''}`}
                    onClick={() => setDraftDomain(meta.id)}
                    aria-pressed={draft.domain === meta.id}
                  >
                    <DomainIcon domain={meta.id} size={12} /> {meta.label}
                  </button>
                ))}
              </div>
            </div>

            {(['people', 'places', 'objects'] as const).some((k) => draft[k].length > 0) && (
              <div className="nesio-voice-confirm-field">
                <span className="nesio-voice-confirm-label">识别到的线索（点 × 去掉不对的）</span>
                <div className="nesio-voice-confirm-chips">
                  {([
                    ['people', <IconUser key="p" size={12} />],
                    ['places', <IconMapPin key="l" size={12} />],
                    ['objects', <IconBox key="o" size={12} />],
                  ] as const).flatMap(([kind, icon]) =>
                    draft[kind].map((value) => (
                      <button
                        key={`${kind}-${value}`}
                        type="button"
                        className="nesio-voice-confirm-chip"
                        onClick={() => dropChip(kind, value)}
                        aria-label={`去掉 ${value}`}
                      >
                        {icon} {value} <span className="nesio-voice-confirm-chip-x">✕</span>
                      </button>
                    )),
                  )}
                </div>
              </div>
            )}

            {/* 提醒/计划专属字段 — 点击日期按钮弹出日历 */}
            {isCommitmentLike(draft) && (() => {
              const todayStr = new Date().toISOString().slice(0, 10);
              const dateStr = draft.dueDate ?? todayStr;
              const dateLabel = (() => {
                const d = new Date(dateStr + 'T00:00:00');
                const today = new Date(todayStr + 'T00:00:00');
                const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
                const wds = ['日','一','二','三','四','五','六'];
                const base = `${d.getMonth()+1}月${d.getDate()}日 周${wds[d.getDay()]}`;
                if (diff === 0) return `今天 · ${base}`;
                if (diff === 1) return `明天 · ${base}`;
                if (diff === -1) return `昨天 · ${base}`;
                return base;
              })();
              return (
                <div className="nesio-voice-confirm-field">
                  <span className="nesio-voice-confirm-label">截止日期 / 提醒时间</span>
                  <button
                    type="button"
                    className="nesio-dtp-trigger"
                    onClick={() => setShowDatePicker(true)}
                  >
                    <span>{dateLabel}</span>
                    {draft.dueTime && <span className="nesio-dtp-trigger-time" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><IconClock size={12} /> {draft.dueTime}</span>}
                    {draft.recurring && <span className="nesio-dtp-trigger-badge">{draft.recurring}</span>}
                    {draft.priority && <span className="nesio-dtp-trigger-badge"><span aria-hidden style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: draft.priority === '高' ? 'var(--status-risk)' : draft.priority === '中' ? 'var(--status-gentle)' : 'var(--status-go)', marginRight: 3 }} /> {draft.priority}</span>}
                  </button>
                  {showDatePicker && (
                    <DateTimePicker
                      value={{ date: dateStr, time: draft.dueTime, recurring: draft.recurring, priority: draft.priority }}
                      onChange={(v) => setDraftDTP(v)}
                      onClose={() => setShowDatePicker(false)}
                    />
                  )}
                </div>
              );
            })()}

            <div className="nesio-voice-confirm-actions">
              <button type="button" className="nesio-voice-confirm-back" onClick={() => { setDraft(null); setSendState('idle'); }}>
                返回修改
              </button>
              <button type="button" className="nesio-voice-send-btn nesio-voice-confirm-save" onClick={() => draft && writeSignalFromDraft(draft, true)}>
                确认存入 Memory
              </button>
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
            placeholder={isAskMode ? '打字问宝盒,或点麦克风说…' : '说一句,或直接打字…'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          <button
            type="button"
            className={`nesio-voice-mic-btn${listening ? ' nesio-voice-mic-btn--active' : ''}`}
            onClick={listening ? stopListening : startListening}
            aria-label={listening ? '停止录音' : '开始录音'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
              <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
            </svg>
          </button>
        </div>
        )}


        {/* Intent label */}
        {!isAskMode && intentLabel && sendState !== 'confirm' && (
          <div className="nesio-voice-intent-label">
            <span>✦</span> {intentLabel}
          </div>
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
              <span className="nesio-voice-status-label">{isAskMode ? '正在听这一句…' : '正在记录…'}</span>
              <button type="button" style={{ fontSize: '0.72rem', color: 'var(--portal-muted)', marginLeft: '0.5rem', padding: '0.2rem 0.5rem' }} onClick={stopListening}>
                停止
              </button>
            </>
          ) : micError ? (
            <span style={{ fontSize: '0.73rem', color: 'var(--status-risk)', textAlign: 'center', lineHeight: 1.4 }}>{micError}</span>
          ) : text && !isAskMode ? (
            <span style={{ fontSize: '0.72rem', color: 'var(--portal-muted)' }}>识别完成 · 点「告诉 Nesio」保存</span>
          ) : null}
        </div>
        )}

        {/* Quick intent chips */}
        {!isAskMode && sendState !== 'confirm' && (
          <div className="nesio-voice-quick">
            {QUICK_INTENTS.map((q) => (
              <button key={q.label} type="button" className="nesio-voice-quick-btn"
                onClick={() => { stopListening(); setText(q.prefix); setTimeout(() => inputRef.current?.focus(), 50); }}>
                {q.label}
              </button>
            ))}
          </div>
        )}

        {/* Ask 结果展示 */}
        {isAskMode && sendState === 'saved' ? (
          <div className="nesio-ask-result">
            {/* AI 综合回答 */}
            {askAnswer ? (
              <div className="nesio-ask-answer-block">
                <span className="nesio-ask-answer-icon">✦</span>
                <p className="nesio-ask-answer-text">{askAnswer}</p>
                {webSearchUsed && <span className="nesio-ask-web-badge">网络搜索</span>}
              </div>
            ) : (!askResults.length && (
              <div className="nesio-ask-answer-block">
                <p className="nesio-ask-answer-text" style={{ color: 'var(--portal-muted)' }}>还没找到相关线索。</p>
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
                <p className="nesio-ask-citations-title">来源线索</p>
                {askResults.slice(0, 5).map((node) => (
                  <div key={node.id} className="nesio-ask-citation-card">
                    <span className="nesio-ask-citation-name">{node.name}</span>
                    {node.reason && <span className="nesio-ask-citation-reason">{node.reason}</span>}
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              className="nesio-ask-again-btn"
              onClick={() => { setSendState('idle'); setAskAnswer(''); setAskResults([]); setAskAggregations([]); setWebSearchUsed(false); }}
            >
              再问一句
            </button>
          </div>
        ) : sendState === 'saved' ? (
          <div className="nesio-voice-saved">✓ 已存入 Memory（{savedCount} 条）</div>
        ) : sendState === 'analyzing' ? (
          <div className="nesio-voice-send-btn" style={{ opacity: 0.6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <span className="nesio-camera-recognizing-dot" style={{ background: '#fff' }} />{isAskMode ? '正在搜索记忆…' : 'Nesio 正在分析…'}
          </div>
        ) : text.trim() && sendState !== 'confirm' ? (
          <button type="button" className="nesio-voice-send-btn" onClick={handleSend}>
            {isAskMode ? '问宝盒' : '告诉 Nesio'}
          </button>
        ) : null}
      </div>
    </div>
    </>
  );
}
