'use client';

/**
 * MoodSheet — Moment Capture（留住这一刻）
 *
 * 设计原则（来自 lib/portal/moment-capture.md）：
 * - 不是情绪记录，而是 Moment Capture — 情绪只是此刻的一个维度
 * - 5 秒完成 Level 1 记录，所有层级可选
 * - 12 情绪基于 Russell 环状模型（效价 × 唤醒 4象限，每象限 3 个）
 * - Energy 维度：水平拖动把手，位置→颜色（蓝→紫→金），内感受唤醒度
 * - 滑动选择（touchmove），不需要点击保存按钮
 * - 长按转盘中心 500ms → 直接进入 Journal
 * - Level 3 可展开为 Journal
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { IconBook, IconMoon, IconZap } from './icons';
import { L, type DictLocale } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { useSheetDrag } from './use-sheet-drag';
import { getLifeGraph, type LifeNode } from '@/lib/portal/life-graph';

// ── Journal 历史(批次 6:富文本-lite + 历史时间线 + 搜索)────────────────────

/** HTML 净化:只留基础排版标签,剥所有属性(Journal 自产自读,双保险)。 */
function sanitizeJournalHtml(html: string): string {
  const ALLOW = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'BR', 'DIV', 'P', 'SPAN']);
  const root = document.createElement('div');
  root.innerHTML = html;
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (!ALLOW.has(child.tagName)) {
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      for (const attr of Array.from(child.attributes)) child.removeAttribute(attr.name);
      walk(child);
    }
  };
  walk(root);
  return root.innerHTML;
}

/** markdown-lite 渲染:**加粗** 与「- 」列表,其余原样。Journal 自家写自家读。 */
function renderMdLite(text: string): React.ReactNode {
  return text.split('\n').map((line, i) => {
    const isBullet = line.startsWith('- ');
    const content = isBullet ? line.slice(2) : line;
    const parts = content.split('**');
    const rendered = parts.map((seg, j) => (j % 2 === 1 ? <strong key={j}>{seg}</strong> : <span key={j}>{seg}</span>));
    if (isBullet) {
      return (
        <div key={i} style={{ display: 'flex', gap: 6 }}>
          <span aria-hidden style={{ color: 'var(--portal-blue-deep)' }}>•</span>
          <span style={{ flex: 1 }}>{rendered}</span>
        </div>
      );
    }
    return <div key={i} style={{ minHeight: line ? undefined : '0.5em' }}>{rendered}</div>;
  });
}

interface JournalEntry { id: string; date: Date; text: string; html?: string; emotionColor?: string; emotionLabel?: string; energyLevel?: EnergyLevel }

function loadJournalEntries(): JournalEntry[] {
  return getLifeGraph()
    .filter((n: LifeNode) => (n.tags ?? []).includes('journal') && typeof n.attributes.journalText === 'string' && n.attributes.journalText)
    .map((n: LifeNode) => {
      const em = typeof n.attributes.emotion === 'string' ? EMOTIONS.find((e) => e.id === n.attributes.emotion) : undefined;
      const lvl = n.attributes.energyLevel;
      return {
        id: n.id,
        date: new Date(n.createdAt),
        text: String(n.attributes.journalText),
        html: typeof n.attributes.journalHtml === 'string' ? n.attributes.journalHtml : undefined,
        emotionColor: em?.color,
        emotionLabel: em?.label,
        energyLevel: (lvl === 'high' || lvl === 'mid' || lvl === 'low' ? lvl : undefined) as EnergyLevel | undefined,
      };
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

// ── 12-Emotion taxonomy (Russell Circumplex 4 quadrants × 3) ─────────────────
const EMOTIONS = [
  { id: 'joy',        label: '开心', labelEn: 'Joyful',    emoji: '😄', color: 'var(--emotion-joy)', quadrant: 'hv-ha' },
  { id: 'excited',    label: '兴奋', labelEn: 'Excited',   emoji: '🤩', color: 'var(--emotion-excited)', quadrant: 'hv-ha' },
  { id: 'moved',      label: '感动', labelEn: 'Moved',     emoji: '🥰', color: 'var(--emotion-moved)', quadrant: 'hv-ha' },
  { id: 'calm',       label: '平静', labelEn: 'Calm',      emoji: '😌', color: 'var(--emotion-calm)', quadrant: 'hv-la' },
  { id: 'content',    label: '满足', labelEn: 'Content',   emoji: '😊', color: 'var(--emotion-content)', quadrant: 'hv-la' },
  { id: 'grateful',   label: '感激', labelEn: 'Grateful',  emoji: '🤗', color: 'var(--emotion-grateful)', quadrant: 'hv-la' },
  { id: 'tired',      label: '疲惫', labelEn: 'Tired',     emoji: '😪', color: 'var(--emotion-tired)', quadrant: 'lv-la' },
  { id: 'empty',      label: '空洞', labelEn: 'Empty',     emoji: '😶', color: 'var(--emotion-empty)', quadrant: 'lv-la' },
  { id: 'sad',        label: '难过', labelEn: 'Sad',       emoji: '😢', color: 'var(--emotion-sad)', quadrant: 'lv-la' },
  { id: 'anxious',    label: '焦虑', labelEn: 'Anxious',   emoji: '😰', color: 'var(--emotion-anxious)', quadrant: 'lv-ha' },
  { id: 'frustrated', label: '烦躁', labelEn: 'Restless',  emoji: '😤', color: 'var(--emotion-frustrated)', quadrant: 'lv-ha' },
  { id: 'angry',      label: '生气', labelEn: 'Angry',     emoji: '😠', color: 'var(--emotion-angry)', quadrant: 'lv-ha' },
] as const;

function emLabel(em: { label: string; labelEn: string } | null | undefined, dict: DictLocale): string {
  if (!em) return '';
  return dict === 'en' ? em.labelEn : em.label;
}

type EmotionId = typeof EMOTIONS[number]['id'];
type EnergyLevel = 'high' | 'mid' | 'low';

// ── SVG geometry（设计稿 mood-wheel2:圆点环 + 中心大圈,不再是扇形饼)──────────
const N = EMOTIONS.length;
const CX = 150, CY = 150;
const R_DOT = 104;    // 圆点所在环半径
const DOT_R = 15;     // 圆点半径(设计稿 30px)
const CENTER_R = 64;  // 中心大圈半径(设计稿 132px,染当前情绪色)
const LABEL_GAP = 11; // 圆点下方标签间距

function rad(d: number) { return (d * Math.PI) / 180; }

/** 开心在正上方,顺时针排布(与 EMOTIONS 顺序、设计稿落位一致)。 */
function dotAngleDeg(i: number): number { return (i * 360) / N - 90; }

function dotPos(i: number): [number, number] {
  const a = rad(dotAngleDeg(i));
  return [CX + R_DOT * Math.cos(a), CY + R_DOT * Math.sin(a)];
}

/** 环带内按角度就近命中一个圆点(滑过换色的手感);中心/环外返回 null。 */
function nearestDot(svgX: number, svgY: number): number | null {
  const dx = svgX - CX, dy = svgY - CY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < CENTER_R - 2 || dist > R_DOT + DOT_R + 20) return null;
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  if (angle < 0) angle += 360;
  return Math.round(angle / (360 / N)) % N;
}

function isCenterHit(svgX: number, svgY: number): boolean {
  const dx = svgX - CX, dy = svgY - CY;
  return Math.sqrt(dx * dx + dy * dy) < CENTER_R - 2;
}

// ── Energy: value 0–100, derive level and color ───────────────────────────────
function energyLevel(v: number): EnergyLevel {
  if (v >= 67) return 'high';
  if (v >= 34) return 'mid';
  return 'low';
}

function energyColor(v: number): string {
  const blue = [144, 202, 249], purp = [139, 92, 246], gold = [255, 209, 102];
  const lerp = (a: number[], b: number[], t: number) =>
    a.map((c, i) => Math.round(c + (b[i] - c) * t));
  const [r, g, b] = v <= 50 ? lerp(blue, purp, v / 50) : lerp(purp, gold, (v - 50) / 50);
  return `rgb(${r},${g},${b})`;
}

// 批次 141·设计心情节:能量词(满电/中/蔫)、一句身体感受、时段 —— 供能量层 + 一句话上下文 + 历史用
function energyWord(lvl: EnergyLevel, dict: DictLocale = 'zh'): string {
  return lvl === 'high' ? L(dict, '满电', 'charged') : lvl === 'low' ? L(dict, '蔫', 'drained') : L(dict, '中', 'steady');
}
function energyDesc(lvl: EnergyLevel, dict: DictLocale = 'zh'): string {
  return lvl === 'high' ? L(dict, '劲儿正足,趁手做点事。', 'Full charge — ride it while it lasts.')
    : lvl === 'low' ? L(dict, '电量不多了,先歇会儿。', 'Running low — take a breather.')
      : L(dict, '撑得住,但也不满电。', 'Holding up, but not full either.');
}
function timeOfDay(dict: DictLocale = 'zh', d: Date = new Date()): string {
  const h = d.getHours();
  if (h < 5) return L(dict, '深夜', 'late night');
  if (h < 8) return L(dict, '清晨', 'early morning');
  if (h < 11) return L(dict, '上午', 'morning');
  if (h < 13) return L(dict, '中午', 'noon');
  if (h < 17) return L(dict, '下午', 'afternoon');
  if (h < 19) return L(dict, '傍晚', 'evening');
  return L(dict, '夜里', 'night');
}

// ── Rotating prompts ──────────────────────────────────────────────────────────
const THOUGHT_PROMPTS: Array<[string, string]> = [
  ['今天最开心的一件事？', 'The happiest thing today?'], ['今天最感谢什么？', 'What are you most grateful for today?'], ['今天什么最消耗你？', 'What drained you most today?'],
  ['此刻你想对自己说什么？', 'What would you tell yourself right now?'], ['今天发现了什么？', 'What did you discover today?'], ['一句话描述此刻。', 'This moment, in one line.'], ['今天最让你意外的是？', 'What surprised you today?'],
];

const JOURNAL_PROMPTS: Array<[string, string]> = [
  ['今天你注意到什么？', 'What did you notice today?'], ['此刻身体感觉如何？', 'How does your body feel right now?'], ['最近什么让你感到充实？', "What's been fulfilling lately?"],
  ['现在你最需要的是什么？', 'What do you need most right now?'], ['今天什么值得记住？', "What's worth remembering today?"], ['如果此刻可以对未来的自己说一句话…', 'One line to your future self…'],
];

function todayPrompt(list: Array<[string, string]>, dict: DictLocale): string {
  const [zh, en] = list[new Date().getDate() % list.length];
  return dict === 'en' ? en : zh;
}

// ── Context auto-fill ─────────────────────────────────────────────────────────
function autoContext(): Record<string, string | boolean | number> {
  const now = new Date();
  const hour = now.getHours();
  return {
    recordedAt: now.toISOString(),
    hourOfDay: hour,
    isWorkHours: hour >= 9 && hour < 18 && now.getDay() >= 1 && now.getDay() <= 5,
    isEvening: hour >= 21,
    isMorning: hour >= 6 && hour < 10,
    dayOfWeek: now.getDay(),
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface MoodSheetProps { open: boolean; onClose: () => void; }

type Phase = 'wheel' | 'energy' | 'thought' | 'journal' | 'saved';

export default function MoodSheet({ open, onClose }: MoodSheetProps) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [phase, setPhase] = useState<Phase>('wheel');
  const [selected, setSelected] = useState<EmotionId | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [energyVal, setEnergyVal] = useState(50);
  const [thought, setThought] = useState('');
  const [journal, setJournal] = useState('');
  const [longPressing, setLongPressing] = useState(false);
  const [journalTab, setJournalTab] = useState<'write' | 'history'>('write');
  const [journalQuery, setJournalQuery] = useState('');
  const [expandedEntry, setExpandedEntry] = useState('');

  const svgRef = useRef<SVGSVGElement>(null);
  const thoughtRef = useRef<HTMLInputElement>(null);
  const journalRef = useRef<HTMLDivElement>(null);
  const journalHtmlRef = useRef('');
  const sliderRef = useRef<HTMLDivElement>(null);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingSlider = useRef(false);
  const thoughtPromptRef = useRef(todayPrompt(THOUGHT_PROMPTS, dict));
  const journalPromptRef = useRef(todayPrompt(JOURNAL_PROMPTS, dict));

  useEffect(() => {
    if (open) {
      setPhase('wheel'); setSelected(null); setHovered(null);
      setEnergyVal(50); setThought(''); setJournal(''); setLongPressing(false);
      thoughtPromptRef.current = todayPrompt(THOUGHT_PROMPTS, dict);
      journalPromptRef.current = todayPrompt(JOURNAL_PROMPTS, dict);
    }
    return () => {
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
      if (longPressRef.current) clearTimeout(longPressRef.current);
    };
  }, [open]);

  useEffect(() => {
    if (phase === 'thought') {
      thoughtRef.current?.focus();
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
      autoCloseRef.current = setTimeout(() => handleSave(), 4000);
    }
    if (phase === 'journal') {
      journalHtmlRef.current = '';
      setTimeout(() => journalRef.current?.focus(), 80);
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  function cancelAutoClose() {
    if (autoCloseRef.current) { clearTimeout(autoCloseRef.current); autoCloseRef.current = null; }
  }

  const handleSave = useCallback((opts?: { isJournal?: boolean }) => {
    cancelAutoClose();
    const em = selected ? EMOTIONS.find((e) => e.id === selected) : null;
    const lvl = energyLevel(energyVal);
    const isJournalEntry = opts?.isJournal ?? (phase === 'journal');

    if (isJournalEntry) {
      const dateStr = new Date().toISOString().slice(0, 10);
      const html = sanitizeJournalHtml(journalHtmlRef.current || '');
      const plain = (journalRef.current?.textContent ?? journal).trim();
      ingestLifeNode({
        // 批次 12:节点名按保存时的界面语言生成(英文界面下不再冒出中文标题)
        name: `Journal · ${dateStr}${em ? ` · ${L(dict, em.label, em.labelEn)}` : ''}`,
        type: 'health_state',
        tags: ['moment', 'journal', ...(em ? ['feeling', em.id, em.quadrant] : []), `energy-${lvl}`],
        attributes: {
          isJournal: true, journalText: plain || journal.trim(),
          ...(html ? { journalHtml: html } : {}),
          ...(em ? { emotion: em.id, emotionLabel: em.label, emotionEmoji: em.emoji, emotionQuadrant: em.quadrant } : {}),
          energyValue: energyVal, energyLevel: lvl, ...autoContext(),
        },
        rawInput: `Journal ${em ? L(dict, em.label, em.labelEn) : ''} ${journal.slice(0, 40)}`,
        confidence: 1, source: 'manual', relations: [],
      });
    } else if (em) {
      ingestLifeNode({
        // 批次 12:同上,「此刻 · 感激」在英文界面下生成 "This moment · Grateful"
        name: L(dict, `此刻 · ${em.label}`, `This moment · ${em.labelEn}`),
        type: 'health_state',
        tags: ['moment', 'feeling', em.id, em.quadrant, `energy-${lvl}`],
        attributes: {
          emotion: em.id, emotionLabel: em.label, emotionEmoji: em.emoji,
          emotionQuadrant: em.quadrant, energyValue: energyVal, energyLevel: lvl,
          ...(thought.trim() ? { thought: thought.trim() } : {}), ...autoContext(),
        },
        rawInput: L(dict,
          `此刻 ${em.label} · 精力${lvl}${thought.trim() ? ` · ${thought.trim()}` : ''}`,
          `This moment ${em.labelEn} · energy ${lvl}${thought.trim() ? ` · ${thought.trim()}` : ''}`),
        confidence: 1, source: 'manual', relations: [],
      });
    } else { onClose(); return; }

    setPhase('saved');
    setTimeout(() => onClose(), 1600);
  }, [selected, energyVal, thought, journal, phase, onClose, dict]);

  function pickEmotion(idx: number) { setSelected(EMOTIONS[idx].id); setPhase('energy'); }

  function svgCoords(e: React.MouseEvent | React.TouchEvent): [number, number] | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const clientX = 'touches' in e ? (e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX ?? 0) : e.clientX;
    const clientY = 'touches' in e ? (e.touches[0]?.clientY ?? e.changedTouches[0]?.clientY ?? 0) : e.clientY;
    return [(clientX - rect.left) * (300 / rect.width), (clientY - rect.top) * (300 / rect.height)];
  }

  function onSvgMove(e: React.MouseEvent | React.TouchEvent) {
    if (phase !== 'wheel') return;
    const coords = svgCoords(e);
    if (!coords) return;
    setHovered(nearestDot(coords[0], coords[1]));
  }

  function onSvgEnd(e: React.MouseEvent | React.TouchEvent) {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
    setLongPressing(false);
    if (phase !== 'wheel') return;
    const coords = svgCoords(e);
    if (!coords) return;
    if (isCenterHit(coords[0], coords[1])) return;
    const idx = nearestDot(coords[0], coords[1]);
    if (idx !== null) pickEmotion(idx);
    setHovered(null);
  }

  function onSvgStart(e: React.MouseEvent | React.TouchEvent) {
    if (phase !== 'wheel') return;
    const coords = svgCoords(e);
    if (!coords) return;
    if (isCenterHit(coords[0], coords[1])) {
      longPressRef.current = setTimeout(() => {
        setLongPressing(false);
        setPhase('journal');
        try { navigator.vibrate?.(60); } catch { /* ignore */ }
      }, 500);
      setLongPressing(true);
    }
  }

  function onSvgLeave() {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
    setLongPressing(false);
    setHovered(null);
  }

  function sliderPct(clientX: number): number {
    const el = sliderRef.current;
    if (!el) return 50;
    const r = el.getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * 100);
  }

  function onSliderStart(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    isDraggingSlider.current = true;
    setEnergyVal(sliderPct('touches' in e ? e.touches[0].clientX : e.clientX));
  }

  useEffect(() => {
    if (phase !== 'energy') return;
    function onMove(e: MouseEvent | TouchEvent) {
      if (!isDraggingSlider.current) return;
      setEnergyVal(sliderPct('touches' in e ? e.touches[0].clientX : e.clientX));
    }
    function onUp() { isDraggingSlider.current = false; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // 横线拖动:下滑关闭沿用各阶段背景点击的语义(journal/energy/thought 保存后再关)
  const dismiss = useCallback(() => {
    if (phase === 'journal') { if (journalTab === 'write' && journal.trim()) handleSave({ isJournal: true }); else onClose(); return; }
    if (phase === 'energy' || phase === 'thought') { handleSave(); return; }
    onClose();
  }, [phase, journalTab, journal, handleSave, onClose]);
  const { handleProps, cardStyle, expanded } = useSheetDrag(dismiss);

  if (!open) return null;

  if (phase === 'saved') {
    const em = selected ? EMOTIONS.find((e) => e.id === selected) : null;
    return (
      <div className="nesio-mood-overlay" role="dialog" aria-modal>
        <div className="nesio-mood-backdrop" onClick={onClose} />
        <div className="nesio-mood-card nesio-mood-card--saved">
          <div className="nesio-mood-saved-emoji" aria-hidden>
            <span style={{ display: 'inline-block', width: 30, height: 30, borderRadius: '50%', background: em?.color ?? 'var(--portal-blue-deep)', boxShadow: `0 0 0 8px color-mix(in srgb, ${em?.color ?? 'var(--portal-blue-deep)'} 22%, transparent)` }} />
          </div>
          <p className="nesio-mood-saved-text">{L(dict, '留住了这一刻', 'Moment kept')}</p>
          <p className="nesio-mood-saved-hint">{L(dict, '会和你其他的记忆慢慢连起来', 'It will slowly connect with your other memories')}</p>
        </div>
      </div>
    );
  }

  const hoveredEm = hovered !== null ? EMOTIONS[hovered] : null;
  const selectedEm = selected ? EMOTIONS.find((e) => e.id === selected) : null;
  const eColor = energyColor(energyVal);

  if (phase === 'journal') {
    // 所见即所得(批次 8):选中直接变粗/成列表,编辑区里不出现任何记号
    const wrapBold = () => {
      journalRef.current?.focus();
      document.execCommand('bold');
      journalHtmlRef.current = journalRef.current?.innerHTML ?? '';
    };
    const insertBullet = () => {
      journalRef.current?.focus();
      document.execCommand('insertUnorderedList');
      journalHtmlRef.current = journalRef.current?.innerHTML ?? '';
    };
    const entries = journalTab === 'history' ? loadJournalEntries() : [];
    const q = journalQuery.trim();
    const filtered = q ? entries.filter((e) => e.text.includes(q)) : entries;
    // 时间线:按天分组
    const byDay = new Map<string, JournalEntry[]>();
    for (const e of filtered) {
      const key = e.date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(e);
    }

    return (
      <div className="nesio-mood-overlay" role="dialog" aria-modal aria-label="Journal">
        <div className="nesio-mood-backdrop" onClick={() => (journalTab === 'write' && journal.trim() ? handleSave({ isJournal: true }) : onClose())} />
        <div className={`nesio-mood-card nesio-mood-card--journal${expanded ? ' nesio-sheet--expanded' : ''}`} style={cardStyle}>
          <div className="nesio-mood-handle" {...handleProps} />
          <div className="nesio-mood-journal-header">
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              {([['write', L(dict, '写一篇', 'Write')], ['history', L(dict, '历史', 'History')]] as const).map(([id, label]) => (
                <button key={id} type="button"
                  onClick={() => setJournalTab(id)}
                  style={{ fontSize: '0.78rem', fontWeight: 600, padding: '0.3rem 0.8rem', borderRadius: 999, border: 'none', cursor: 'pointer', background: journalTab === id ? 'var(--portal-blue-deep)' : 'rgba(88,140,227,0.1)', color: journalTab === id ? '#fff' : 'var(--portal-blue-deep)' }}>
                  {label}
                </button>
              ))}
            </div>
            <span className="nesio-mood-journal-date">
              {new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', weekday: 'short' })}
            </span>
          </div>

          {journalTab === 'write' ? (
            <>
              {/* 批次 141:展开写也带情绪·能量·时段上下文 */}
              <p className="nesio-mood-moment-context">
                {selectedEm && <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: selectedEm.color, display: 'inline-block' }} />}
                {selectedEm ? `${emLabel(selectedEm, dict)} · ` : ''}{L(dict, '能量', 'energy ')}{energyWord(energyLevel(energyVal), dict)} · {timeOfDay(dict)}
              </p>
              <p className="nesio-mood-journal-prompt">{journalPromptRef.current}</p>
              {/* 富文本-lite 工具条:加粗 / 列表 */}
              <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
                <button type="button" onClick={wrapBold} aria-label={L(dict, '加粗', 'Bold')}
                  style={{ minWidth: 'var(--tap-min)', minHeight: '2.1rem', borderRadius: '0.5rem', border: '1px solid var(--portal-line)', background: 'var(--glass-bg-solid)', fontWeight: 800, color: 'var(--portal-ink)', cursor: 'pointer' }}>B</button>
                <button type="button" onClick={insertBullet} aria-label={L(dict, '列表', 'List')}
                  style={{ minWidth: 'var(--tap-min)', minHeight: '2.1rem', borderRadius: '0.5rem', border: '1px solid var(--portal-line)', background: 'var(--glass-bg-solid)', color: 'var(--portal-ink)', cursor: 'pointer' }}>•—</button>
              </div>
              <div
                ref={journalRef}
                className="nesio-journal-editor"
                contentEditable
                suppressContentEditableWarning
                data-placeholder={L(dict, '写下此刻…', 'Write down this moment…')}
                onInput={(e) => {
                  journalHtmlRef.current = (e.target as HTMLDivElement).innerHTML;
                  setJournal((e.target as HTMLDivElement).textContent ?? '');
                }}
              />
              <button type="button" className="nesio-mood-save-btn nesio-mood-save-btn--ready"
                onClick={() => handleSave({ isJournal: true })}>{L(dict, '保存这一刻', 'Save this moment')}</button>
            </>
          ) : (
            <>
              <input
                value={journalQuery}
                onChange={(e) => setJournalQuery(e.target.value)}
                placeholder={L(dict, '搜索心情与手记…', 'Search moods & notes…')}
                className="nesio-mood-note"
                style={{ marginBottom: '0.6rem' }}
              />
              <div style={{ maxHeight: '46vh', overflowY: 'auto', paddingRight: 2 }}>
                {filtered.length === 0 && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--portal-muted)', textAlign: 'center', padding: '1.2rem 0' }}>
                    {q ? L(dict, `没有找到「${q}」`, `Nothing found for \"${q}\"`) : L(dict, '还没有日记。长按转盘中心,写下第一篇。', 'No journal yet. Long-press the wheel center to write the first one.')}
                  </p>
                )}
                {[...byDay.entries()].map(([day, list]) => (
                  <div key={day} style={{ marginBottom: '0.7rem' }}>
                    {/* 时间线:日期节点 + 竖线 */}
                    <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.72rem', fontWeight: 700, color: 'var(--portal-blue-deep)', margin: '0 0 0.35rem' }}>
                      <IconBook size={13} /> {day}
                    </p>
                    <div style={{ borderLeft: '2px solid var(--portal-line)', marginLeft: 6, paddingLeft: 12, display: 'grid', gap: '0.5rem' }}>
                      {list.map((e) => {
                        const isOpen = expandedEntry === e.id;
                        const preview = e.text.length > 80 && !isOpen ? `${e.text.slice(0, 80)}…` : e.text;
                        return (
                          <button key={e.id} type="button"
                            onClick={() => setExpandedEntry(isOpen ? '' : e.id)}
                            style={{ textAlign: 'left', background: 'rgba(88,140,227,0.05)', border: '1px solid var(--portal-line)', borderRadius: '0.7rem', padding: '0.55rem 0.7rem', cursor: 'pointer' }}>
                            <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.68rem', color: 'var(--portal-muted)', margin: '0 0 0.25rem' }}>
                              {e.emotionColor && <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: e.emotionColor, display: 'inline-block' }} />}
                              {[e.emotionLabel || '', e.energyLevel ? `${L(dict, '能量', 'energy ')}${energyWord(e.energyLevel, dict)}` : '', timeOfDay(dict, e.date), e.date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })].filter(Boolean).join(' · ')}
                            </p>
                            {e.html && isOpen ? (
                              <div className="nesio-journal-history-html" style={{ fontSize: '0.82rem', color: 'var(--portal-ink)', lineHeight: 1.6 }}
                                dangerouslySetInnerHTML={{ __html: sanitizeJournalHtml(e.html) }} />
                            ) : (
                              <div style={{ fontSize: '0.82rem', color: 'var(--portal-ink)', lineHeight: 1.6 }}>{renderMdLite(preview)}</div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {/* 批次 141·设计心情节:历史底部说明去处 —— 情绪与能量喂洞察 */}
              <p className="nesio-mood-history-foot">{L(dict, '情绪与能量都喂给「洞察 → 一周能量 / 情绪回暖」', 'Mood & energy feed Insights → weekly energy / warming trend')}</p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'energy') {
    return (
      <div className="nesio-mood-overlay" role="dialog" aria-modal aria-label={L(dict, '记录精力', 'Log energy')}>
        <div className="nesio-mood-backdrop" onClick={() => handleSave()} />
        <div className={`nesio-mood-card${expanded ? ' nesio-sheet--expanded' : ''}`} style={cardStyle}>
          <div className="nesio-mood-handle" {...handleProps} />
          <p className="nesio-mood-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {selectedEm && <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: selectedEm.color, display: 'inline-block' }} />}
            {emLabel(selectedEm, dict)} · {L(dict, '身体里的劲儿呢？', "How's your energy?")}
          </p>
          <div className="nesio-mood-slider-wrap">
            <div className="nesio-mood-slider-labels">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><IconMoon size={12} /> {L(dict, '低 · 蔫', 'Low · drained')}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><IconZap size={12} /> {L(dict, '高 · 满电', 'High · charged')}</span>
            </div>
            <div ref={sliderRef} className="nesio-mood-slider-track"
              onMouseDown={onSliderStart} onTouchStart={onSliderStart}>
              <div className="nesio-mood-slider-fill"
                style={{ width: `${energyVal}%`, backgroundColor: eColor }} />
              <div className="nesio-mood-slider-thumb"
                style={{ left: `${energyVal}%`, backgroundColor: eColor, boxShadow: `0 0 0 4px ${eColor}33` }}
                role="slider" aria-valuenow={energyVal} aria-valuemin={0} aria-valuemax={100} />
            </div>
            <p className="nesio-mood-slider-label" style={{ color: eColor }}>{energyWord(energyLevel(energyVal), dict)}</p>
            <p className="nesio-mood-energy-desc">{energyDesc(energyLevel(energyVal), dict)}</p>
          </div>
          <p className="nesio-mood-energy-hint">{L(dict, '滑到位就好,不用点保存 · 想细说 ↓ 展开写', 'Just slide — no need to save · say more ↓')}</p>
          <div className="nesio-mood-energy-actions">
            <button type="button" className="nesio-mood-save-btn nesio-mood-save-btn--ready"
              onClick={() => setPhase('thought')}>{L(dict, '展开写', 'Say more')} ↓</button>
            <button type="button" className="nesio-mood-skip-btn"
              onClick={() => handleSave()}>{L(dict, '留住这一刻', 'Keep this moment')}</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'thought') {
    return (
      <div className="nesio-mood-overlay" role="dialog" aria-modal aria-label={L(dict, '记录此刻想法', 'Note this thought')}>
        <div className="nesio-mood-backdrop" onClick={() => handleSave()} />
        <div className={`nesio-mood-card${expanded ? ' nesio-sheet--expanded' : ''}`} style={cardStyle}>
          <div className="nesio-mood-handle" {...handleProps} />
          <p className="nesio-mood-title">{L(dict, '留住这一刻', 'Keep this moment')}</p>
          {/* 批次 141·设计心情节:一句话层带情绪·能量·时段上下文(自动带上,不用手填) */}
          <p className="nesio-mood-moment-context">
            {selectedEm && <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: selectedEm.color, display: 'inline-block' }} />}
            {selectedEm ? `${emLabel(selectedEm, dict)} · ` : ''}{L(dict, '能量', 'energy ')}{energyWord(energyLevel(energyVal), dict)} · {timeOfDay(dict)}
          </p>
          <input ref={thoughtRef} type="text" className="nesio-mood-note nesio-mood-note--large"
            placeholder={L(dict, '此刻想说一句…(可选)', 'One line, if you like… (optional)')} value={thought}
            onChange={(e) => { setThought(e.target.value); cancelAutoClose(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }} maxLength={80} />
          <p className="nesio-mood-auto-hint">{L(dict, '自动带上情绪与能量 · 4 秒无输入自动留住', 'Mood & energy attached · auto-keeps after 4s')}</p>
          <div className="nesio-mood-thought-actions">
            <button type="button" className="nesio-mood-save-btn nesio-mood-save-btn--ready"
              onClick={() => handleSave()}>{L(dict, '留住这一刻', 'Keep this moment')}</button>
            <button type="button" className="nesio-mood-journal-btn"
              onClick={() => { cancelAutoClose(); setPhase('journal'); }}>{L(dict, '展开为 Journal', 'Expand to Journal')}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="nesio-mood-overlay" role="dialog" aria-modal aria-label={L(dict, '记录此刻感受', 'Log how you feel')}>
      <div className="nesio-mood-backdrop" onClick={onClose} />
      <div className={`nesio-mood-card${expanded ? ' nesio-sheet--expanded' : ''}`} style={cardStyle}>
        <div className="nesio-mood-handle" {...handleProps} />
        <p className="nesio-mood-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          {hoveredEm && <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: hoveredEm.color, display: 'inline-block' }} />}
          {hoveredEm ? emLabel(hoveredEm, dict) : L(dict, '此刻，是什么感觉？', 'This moment — how does it feel?')}
        </p>
        <div className="nesio-mood-wheel-wrap">
          <svg ref={svgRef} viewBox="0 0 300 300" className="nesio-mood-wheel-svg"
            role="group" aria-label={L(dict, '情绪转盘', 'Mood wheel')}
            onMouseDown={onSvgStart} onMouseMove={onSvgMove} onMouseUp={onSvgEnd} onMouseLeave={onSvgLeave}
            onTouchStart={(e) => { onSvgStart(e); }}
            onTouchMove={(e) => { e.preventDefault(); onSvgMove(e); }}
            onTouchEnd={(e) => { e.preventDefault(); onSvgEnd(e); }}
            style={{ touchAction: 'none' }}>
            {/* 圆点环:12 情绪各一枚色点,标签在点下方;悬停/滑到的点放大 + 白描边(设计稿 mood-wheel2)*/}
            {EMOTIONS.map((em, i) => {
              const isHov = hovered === i;
              const [dx, dy] = dotPos(i);
              return (
                <g key={em.id} role="button" aria-label={em.label} tabIndex={0}
                  onClick={() => pickEmotion(i)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') pickEmotion(i); }}
                  style={{ cursor: 'pointer' }}>
                  {isHov && <circle cx={dx} cy={dy} r={DOT_R + 6} fill={em.color} opacity={0.3} style={{ filter: 'blur(3px)' }} />}
                  <circle cx={dx} cy={dy} r={isHov ? DOT_R + 2 : DOT_R} fill={em.color}
                    stroke={isHov ? '#fff' : 'rgba(255,255,255,0.55)'} strokeWidth={isHov ? 2.5 : 1}
                    style={{ transition: 'r 0.12s' }} />
                  <text x={dx} y={dy + DOT_R + LABEL_GAP} textAnchor="middle" dominantBaseline="middle"
                    fontSize={isHov ? '10' : '9'} fontWeight={isHov ? '800' : '650'}
                    fill={isHov ? 'var(--portal-ink)' : 'var(--portal-muted)'}
                    style={{ pointerEvents: 'none', userSelect: 'none', transition: 'font-size 0.12s' }}>{emLabel(em, dict)}</text>
                </g>
              );
            })}
            {/* 中心大圈:染成当前(滑到的)情绪色,名字压白字 —— 实时预览;没滑时「此刻 · 滑动换色」。 */}
            <circle cx={CX} cy={CY} r={CENTER_R}
              fill={longPressing ? 'var(--portal-accent-soft)' : (hoveredEm ? hoveredEm.color : 'var(--mood-card-bg, #fff)')}
              stroke={hoveredEm && !longPressing ? 'rgba(255,255,255,0.6)' : 'var(--portal-line)'}
              strokeWidth={hoveredEm && !longPressing ? 4 : 1.5}
              style={{ cursor: 'pointer', transition: 'fill 0.25s' }} />
            {/* 珠光高光:让中心像一颗有质感的珠子(设计稿 inset 白环 + 顶光)*/}
            {hoveredEm && !longPressing && (
              <ellipse cx={CX - 15} cy={CY - 22} rx={24} ry={14} fill="#fff" opacity={0.2} style={{ pointerEvents: 'none' }} />
            )}
            {hoveredEm && !longPressing ? (
              <>
                <text x={CX} y={CY - 3} textAnchor="middle" dominantBaseline="middle" fontSize="21" fontWeight="800"
                  fill="#fff" style={{ userSelect: 'none', pointerEvents: 'none', fontFamily: 'var(--font-portal-serif), Georgia, serif' }}>
                  {emLabel(hoveredEm, dict)}
                </text>
                <text x={CX} y={CY + 18} textAnchor="middle" fontSize="8.5" fill="#fff" opacity={0.9}
                  style={{ userSelect: 'none', pointerEvents: 'none' }}>
                  {L(dict, '此刻 · 滑动换色', 'Now · slide')}
                </text>
              </>
            ) : (
              <>
                <text x={CX} y={CY - 7} textAnchor="middle" fontSize="12"
                  fill={longPressing ? 'var(--portal-cool-accent)' : 'var(--portal-muted)'} fontWeight="700"
                  style={{ userSelect: 'none', pointerEvents: 'none', fontFamily: 'var(--font-portal-serif), Georgia, serif' }}>
                  {longPressing ? L(dict, '放开写 Journal', 'Release to journal') : L(dict, '此刻', 'Now')}
                </text>
                <text x={CX} y={CY + 11} textAnchor="middle" fontSize="8.5" fill="var(--portal-muted)"
                  style={{ userSelect: 'none', pointerEvents: 'none' }}>
                  {longPressing ? 'Journal' : L(dict, '滑动换色', 'Slide to preview')}
                </text>
              </>
            )}
          </svg>
        </div>
        <p className="nesio-mood-hint-text">{L(dict, '滑过一种感觉，松手即记录 · 长按中心写 Journal', 'Slide over a feeling and release to log · long-press center to journal')}</p>
      </div>
    </div>
  );
}
