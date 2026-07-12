'use client';

import { Component, useEffect, useState, type ReactNode } from 'react';
import { deleteLifeNode, getLifeGraph, searchLifeGraphFuzzy, updateLifeNode, type LifeNode } from '@/lib/portal/life-graph';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import LocationPicker from './LocationPicker';
import EmailComposeSheet from './EmailComposeSheet';
import { IconClock, IconLink, NodeTypeIcon, WeatherIcon, IconMail, IconCalendar, IconCamera, IconMic, IconNote, IconMapPin, IconFlag, IconCheckSquare } from './icons';
import { L } from '@/lib/portal/i18n';
import { relativePastLabel } from '@/lib/portal/time-labels';
import { displayNodeName } from '@/lib/portal/node-display';
import dynamicImport from 'next/dynamic';
const ReaderSheetLazy = dynamicImport(() => import('./ArticleReaderSheet'), { ssr: false });
const PlacePickerLazy = dynamicImport(() => import('./PlacePickerSheet'), { ssr: false });
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
const TYPE_BG_DETAIL: Record<string, string> = {
  person: 'var(--chip-indigo)', object: 'var(--chip-blue)', place: 'var(--chip-green)',
  event: 'var(--chip-amber)', commitment: 'var(--chip-violet)', health_state: 'var(--chip-pink)', preference: 'var(--chip-mint)',
};

interface MemoryNodeDetailProps {
  node: LifeNode | null;
  onClose: () => void;
  relatedNodes?: LifeNode[];
  onOpenNode?: (node: LifeNode) => void;
}

const TYPE_LABELS_ZH: Record<string, string> = {
  person: '人物', object: '物品', place: '地点', event: '事件',
  commitment: '承诺', health_state: '健康状态', preference: '偏好',
};
const TYPE_LABELS_EN: Record<string, string> = {
  person: 'Person', object: 'Item', place: 'Place', event: 'Event',
  commitment: 'Promise', health_state: 'Health', preference: 'Taste',
};

const PERSON_CATEGORIES: Record<string, string> = {
  family: '家人', colleague: '同事', friend: '朋友', acquaintance: '认识', other: '其他',
};
const PERSON_CATEGORIES_EN: Record<string, string> = {
  family: 'Family', colleague: 'Colleague', friend: 'Friend', acquaintance: 'Acquaintance', other: 'Other',
};
const HEALTH_TYPES: Record<string, string> = {
  medication: '药物', appointment: '就诊', fitness: '运动',
  sleep: '睡眠', diet: '饮食', checkup: '检查', other: '健康',
};
const HEALTH_TYPES_EN: Record<string, string> = {
  medication: 'Medication', appointment: 'Appointment', fitness: 'Fitness',
  sleep: 'Sleep', diet: 'Diet', checkup: 'Checkup', other: 'Health',
};
const PLACE_CATEGORIES: Record<string, string> = {
  work: '工作', school: '学校', home: '家', shopping: '购物',
  restaurant: '餐厅', gym: '健身', hospital: '医院', other: '地点',
};
const PLACE_CATEGORIES_EN: Record<string, string> = {
  work: 'Work', school: 'School', home: 'Home', shopping: 'Shopping',
  restaurant: 'Restaurant', gym: 'Gym', hospital: 'Hospital', other: 'Place',
};
const PRIORITY_LABELS: Record<string, { label: string; labelEn: string; color: string }> = {
  high: { label: '紧急', labelEn: 'Urgent', color: 'var(--status-risk)' },
  medium: { label: '重要', labelEn: 'Important', color: 'var(--status-gentle)' },
  low: { label: '普通', labelEn: 'Normal', color: 'var(--portal-muted)' },
};

/** 已知属性键 → 中文标签(天气信号等系统属性不再裸奔英文键名) */
const ATTR_KEY_LABELS: Record<string, string> = {
  temperatureC: '温度', condition: '天气', forecastNote: '预报',
  placeName: '地点', humidity: '湿度', windKph: '风速',
};
const ATTR_KEY_LABELS_EN: Record<string, string> = {
  temperatureC: 'Temperature', condition: 'Weather', forecastNote: 'Forecast',
  placeName: 'Place', humidity: 'Humidity', windKph: 'Wind',
};

/** 长文本(如日历事件的会议记录)默认只显示摘要,点「详情」展开 */
function CollapsibleText({ text, limit = 110 }: { text: string; limit?: number }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [expanded, setExpanded] = useState(false);
  if (text.length <= limit) return <span className="nesio-node-attr-val">{text}</span>;
  return (
    <span className="nesio-node-attr-val">
      {expanded ? text : `${text.slice(0, limit)}…`}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{ marginLeft: 6, fontSize: '0.72rem', fontWeight: 600, color: 'var(--portal-blue-deep)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        {expanded ? L(dict, '收起', 'Less') : L(dict, '详情', 'More')}
      </button>
    </span>
  );
}

/** 标题一行化:超长标题(偏好类常见=整段原文)取第一个分句 */
function displayTitle(name: string): string {
  if (name.length <= 28) return name;
  const clause = name.split(/[。！？!?；;\n]/)[0];
  return `${clause.length > 28 ? clause.slice(0, 28) : clause}…`;
}

function attr(node: LifeNode, ...keys: string[]): string {
  for (const k of keys) {
    const v = node.attributes[k];
    if (v !== null && v !== undefined && v !== '') return String(v);
  }
  return '';
}

// 纯日期(YYYY-MM-DD)按**本地**日期解析,绝不做时区换算。JS 的 new Date("2026-07-15")
// 会当成 UTC 零点,美区浏览器读本地小时就变「7月14日」+ 凭空 20:00 —— 截止日算错一天,
// 对一个记 deadline 的工具是信任底线问题。日期-only 一律走这里,不经 UTC。
function parseLocalDate(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(raw: string, dict: string = 'zh'): string {
  if (!raw) return '';
  const d = parseLocalDate(raw);
  if (!d) return raw;
  return d.toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function fmtDateTime(raw: string, dict: string = 'zh'): string {
  if (!raw) return '';
  // 纯日期没有时间分量 —— 只显示日期,绝不凭空造出「20:00」这类时区伪影。
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fmtDate(raw, dict);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  if (!hasTime) return fmtDate(raw, dict);
  return d.toLocaleString(dict === 'en' ? 'en-US' : 'zh-CN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function mapUrl(address: string, lat?: string, lon?: string, dict: string = 'zh'): string {
  if (lat && lon) return `https://maps.apple.com/?ll=${lat},${lon}&q=${encodeURIComponent(address || L(dict, '位置', 'Location'))}`;
  if (address) return `https://maps.apple.com/?q=${encodeURIComponent(address)}`;
  return '';
}

function isMeetingUrl(url: string): boolean {
  return /zoom\.us|meet\.google|teams\.microsoft|webex\.com|whereby\.com/i.test(url);
}

// 确保外部链接有 https:// 前缀，防止缺少协议时被当成相对路径导致 404
function safeExternalUrl(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  // zoommtg:// deep link → 转成 web 版，避免 iOS PWA 卡死
  if (url.startsWith('zoommtg://')) return url.replace('zoommtg://', 'https://');
  return `https://${url}`;
}

const HIDDEN_ATTRIBUTE_KEYS = new Set([
  // Internal / calendar
  'calendarId', 'calendarName', 'description', 'emailId', 'messageId', 'htmlLink',
  // System / task internals
  'subtasksJson', 'done', 'doneAt', 'userTags', 'status', 'context', 'reminder',
  // 批次 74:fullText 与原始记录重复,不再当属性平铺
  'fullText', 'savedFromChat', 'checklist', 'planImported', 'planContainer', 'planKind',
  // Location (shown in PlaceSection)
  'lat', 'lon', 'address', 'location', 'room',
  // 批次 57:捕获位置戳 —— 裸坐标不见人,地名已并入「记录于 · 地点」行
  'capturedLat', 'capturedLon', 'capturedPlace',
  // Signal infrastructure — never user-visible
  'signalId', 'signalSource', 'signalType', 'signalVersion',
  'occuredAt', 'occurredAt', 'capturedAt', 'retentionPolicy', 'sensitivity',
  'sourceNodeId', 'schemaVersion',
  // Type-specific (handled in sections)
  'note', 'price', 'purchaseDate', 'expiry', 'store', 'paymentMethod',
  'visitCount', 'category', 'lastSeen', 'birthday',
  'start', 'end', 'date', 'dueDate', 'deadline',
  'priority', 'owner', 'recurring', 'participants',
  'url', 'healthType', 'unit', 'value', 'receiptDate',
  // Moment capture internals (emotion shown via its own section, not raw keys)
  'emotion', 'emotionLabel', 'emotionEmoji', 'emotionQuadrant',
  'energyValue', 'energyLevel', 'recordedAt', 'hourOfDay',
  'isWorkHours', 'isEvening', 'isMorning', 'isJournal', 'journalText',
  'article', 'image',
]);

function InfoRow({ label, value, link }: { label: string; value: string; link?: string }) {
  if (!value) return null;
  return (
    <div className="nesio-node-attr-row">
      <span className="nesio-node-attr-key">{label}</span>
      {link
        ? <a href={link} target="_blank" rel="noopener noreferrer" className="nesio-node-attr-val nesio-node-attr-link">{value}</a>
        : <span className="nesio-node-attr-val">{value}</span>}
    </div>
  );
}

// ── Type-specific sections ──────────────────────────────────────────────────

function PersonSection({ node }: {
  node: LifeNode;
  relatedNodes?: LifeNode[];
  onOpenNode?: (n: LifeNode) => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const category = attr(node, 'category');
  const lastSeen = attr(node, 'lastSeen');
  const birthday = attr(node, 'birthday');
  const note = attr(node, 'note');

  return (
    <div className="nesio-type-section">
      {category && (
        <div className="nesio-type-badge-row">
          <span className="nesio-type-category-pill">
            {(dict === 'en' ? PERSON_CATEGORIES_EN : PERSON_CATEGORIES)[category] || category}
          </span>
        </div>
      )}
      <InfoRow label={L(dict, '上次见面', 'Last seen')} value={fmtDate(lastSeen, dict)} />
      <InfoRow label={L(dict, '生日', 'Birthday')} value={fmtDate(birthday, dict)} />
      <InfoRow label={L(dict, '备注', 'Note')} value={note} />
    </div>
  );
}

function ObjectSection({ node, assetUrls }: {
  node: LifeNode;
  assetUrls: Record<string, string>;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const location = attr(node, 'location', 'room');
  const purchaseDate = attr(node, 'purchaseDate');
  const price = attr(node, 'price');
  const expiry = attr(node, 'expiry');
  const note = attr(node, 'note');
  const fileUrl = attr(node, 'url');
  const store = attr(node, 'store');
  const paymentMethod = attr(node, 'paymentMethod');
  const assets = node.assets || [];
  const firstImage = assets.find((a) => a.kind === 'image' || a.mimeType?.startsWith('image/'));
  const previewUrl = firstImage ? assetUrls[firstImage.id || firstImage.storagePath || ''] : '';

  return (
    <div className="nesio-type-section">
      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt={node.name} className="nesio-type-thumb" draggable={false}
          role="button" tabIndex={0} style={{ cursor: 'zoom-in' }}
          onClick={() => window.dispatchEvent(new CustomEvent('nesio-view-image', { detail: { url: previewUrl, name: node.name } }))} />
      )}
      <InfoRow label={L(dict, '存放位置', 'Stored at')} value={location} />
      <InfoRow label={L(dict, '购买日期', 'Bought on')} value={fmtDate(purchaseDate, dict)} />
      <InfoRow label={L(dict, '价格', 'Price')} value={price} />
      <InfoRow label={L(dict, '有效期', 'Expires')} value={fmtDate(expiry, dict)} />
      <InfoRow label={L(dict, '购买商家', 'Store')} value={store} />
      <InfoRow label={L(dict, '支付方式', 'Paid with')} value={paymentMethod} />
      <InfoRow label={L(dict, '备注', 'Note')} value={note} />
      {fileUrl && (
        <div style={{ marginTop: '0.75rem' }}>
          <a href={safeExternalUrl(fileUrl)} target="_blank" rel="noopener noreferrer" className="nesio-type-action-btn">
            <IconLink size={13} /> {L(dict, '打开链接', 'Open link')}
          </a>
        </div>
      )}
    </div>
  );
}

function PlaceSection({ node }: {
  node: LifeNode;
  relatedNodes?: LifeNode[];
  onOpenNode?: (n: LifeNode) => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const address = attr(node, 'address', 'location');
  const lat = attr(node, 'lat');
  const lon = attr(node, 'lon');
  const visitCount = attr(node, 'visitCount');
  const category = attr(node, 'category');
  const note = attr(node, 'note');
  const link = mapUrl(address, lat, lon, dict);

  return (
    <div className="nesio-type-section">
      {category && (
        <div className="nesio-type-badge-row">
          <span className="nesio-type-category-pill">
            {(dict === 'en' ? PLACE_CATEGORIES_EN : PLACE_CATEGORIES)[category] || category}
          </span>
        </div>
      )}
      {address && (
        <div className="nesio-node-attr-row">
          <span className="nesio-node-attr-key">{L(dict, '地址', 'Address')}</span>
          {link
            ? <a href={link} target="_blank" rel="noopener noreferrer" className="nesio-node-attr-val nesio-node-attr-link">{address}</a>
            : <span className="nesio-node-attr-val">{address}</span>
          }
        </div>
      )}
      {(lat && lon && !address) && (
        <div style={{ marginTop: '0.5rem' }}>
          <a href={mapUrl('', lat, lon, dict)} target="_blank" rel="noopener noreferrer" className="nesio-type-action-btn">
            {L(dict, '在地图中查看', 'View on map')}
          </a>
        </div>
      )}
      <InfoRow label={L(dict, '来访次数', 'Visits')} value={visitCount ? L(dict, `${visitCount} 次`, `${visitCount}×`) : ''} />
      <InfoRow label={L(dict, '备注', 'Note')} value={note} />
    </div>
  );
}

function EventSection({ node }: {
  node: LifeNode;
  relatedNodes?: LifeNode[];
  onOpenNode?: (n: LifeNode) => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const start = attr(node, 'start', 'date', 'datetime');
  const end = attr(node, 'end');
  const location = attr(node, 'location');
  const participants = attr(node, 'participants');
  const url = attr(node, 'url', 'htmlLink');
  const note = attr(node, 'note');
  const lat = attr(node, 'lat');
  const lon = attr(node, 'lon');
  const mapLink = mapUrl(location, lat, lon, dict);
  const isMeeting = url && isMeetingUrl(url);

  return (
    <div className="nesio-type-section">
      {start && (
        <div className="nesio-type-event-time">
          <span className="nesio-type-event-time-icon"><IconClock size={15} /></span>
          <span>{fmtDateTime(start, dict)}{end ? ` — ${fmtDateTime(end, dict)}` : ''}</span>
        </div>
      )}
      {location && (
        <div className="nesio-node-attr-row">
          <span className="nesio-node-attr-key">{L(dict, '地点', 'Location')}</span>
          {mapLink
            ? <a href={mapLink} target="_blank" rel="noopener noreferrer" className="nesio-node-attr-val nesio-node-attr-link">{location}</a>
            : <span className="nesio-node-attr-val">{location}</span>
          }
        </div>
      )}
      {participants && <InfoRow label={L(dict, '参与者', 'People')} value={participants} />}
      {note && (
        <div className="nesio-node-attr-row">
          <span className="nesio-node-attr-key">{L(dict, '会议记录', 'Meeting notes')}</span>
          <CollapsibleText text={note} />
        </div>
      )}
      {url && (
        <div style={{ marginTop: '0.75rem' }}>
          <a href={safeExternalUrl(url)} target="_blank" rel="noopener noreferrer"
            className={`nesio-type-action-btn${isMeeting ? ' nesio-type-action-btn--meeting' : ''}`}>
            {isMeeting ? L(dict, '加入会议', 'Join meeting') : <><IconLink size={13} /> {L(dict, '直达链接', 'Open link')}</>}
          </a>
        </div>
      )}
    </div>
  );
}

function CommitmentSection({ node, onToggleDone }: {
  node: LifeNode;
  onToggleDone: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const dueDate = attr(node, 'dueDate', 'deadline', 'due', 'date');
  const priority = attr(node, 'priority');
  const owner = attr(node, 'owner');
  const recurring = attr(node, 'recurring');
  const note = attr(node, 'note');
  const isDone = Boolean(node.attributes.done);
  const priorityInfo = priority ? PRIORITY_LABELS[priority] : null;

  // 同上:纯日期按本地解析,否则「今天截止」也会因 UTC 换算差一天。
  const dueParsed = dueDate ? parseLocalDate(dueDate) : null;
  const dueMs = dueParsed ? dueParsed.getTime() - Date.now() : null;
  const isOverdue = dueMs !== null && dueMs < 0 && !isDone;
  const dueSoon = dueMs !== null && dueMs >= 0 && dueMs < 24 * 3_600_000 && !isDone;

  // 批次 72:可勾选清单(subtasksJson)—— 存进来的打包清单在详情里直接打勾
  const [checkItems, setCheckItems] = useState<Array<{ id: string; name: string; done: boolean }>>(() => {
    try { return JSON.parse(String(node.attributes.subtasksJson || '[]')) as Array<{ id: string; name: string; done: boolean }>; } catch { return []; }
  });
  function toggleCheckItem(id: string) {
    const next = checkItems.map((it) => (it.id === id ? { ...it, done: !it.done } : it));
    setCheckItems(next);
    updateLifeNode(node.id, { attributes: { ...node.attributes, subtasksJson: JSON.stringify(next) } });
  }

  return (
    <div className="nesio-type-section">
      {checkItems.length > 0 && (
        <ul className="nesio-check-list">
          {checkItems.map((it) => (
            <li key={it.id}>
              <button type="button" className={`nesio-check-item${it.done ? ' is-done' : ''}`} onClick={() => toggleCheckItem(it.id)}>
                <span className="nesio-check-box">{it.done ? '✓' : ''}</span>
                <span className="nesio-check-name">{it.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="nesio-commitment-status-row">
        <button
          type="button"
          className={`nesio-commitment-toggle${isDone ? ' nesio-commitment-toggle--done' : ''}`}
          onClick={onToggleDone}
        >
          {isDone ? L(dict, '✓ 已完成', '✓ Done') : L(dict, '○ 待完成', '○ To do')}
        </button>
        {priorityInfo && (
          <span className="nesio-type-priority-badge" style={{ color: priorityInfo.color }}>
            {L(dict, priorityInfo.label, priorityInfo.labelEn)}
          </span>
        )}
      </div>
      {dueDate && (
        <div className={`nesio-node-attr-row${isOverdue ? ' nesio-attr-overdue' : dueSoon ? ' nesio-attr-due-soon' : ''}`}>
          <span className="nesio-node-attr-key">{L(dict, '截止日期', 'Due')}</span>
          <span className="nesio-node-attr-val">
            {fmtDateTime(dueDate, dict)}
            {isOverdue && <span className="nesio-overdue-tag"> {L(dict, '已过期', 'overdue')}</span>}
            {dueSoon && <span className="nesio-due-soon-tag"> {L(dict, '今天截止', 'due today')}</span>}
          </span>
        </div>
      )}
      <InfoRow label={L(dict, '对方/负责人', 'Owner')} value={owner} />
      {recurring && <InfoRow label={L(dict, '重复', 'Repeats')} value={recurring} />}
      <InfoRow label={L(dict, '备注', 'Note')} value={note} />
    </div>
  );
}

function HealthSection({ node }: { node: LifeNode }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const healthType = attr(node, 'healthType', 'category');
  const date = attr(node, 'date', 'start', 'datetime');
  const value = attr(node, 'value');
  const unit = attr(node, 'unit');
  const note = attr(node, 'note');
  const typeLabel = (dict === 'en' ? HEALTH_TYPES_EN : HEALTH_TYPES)[healthType] || (healthType || L(dict, '健康', 'Health'));

  return (
    <div className="nesio-type-section">
      <div className="nesio-type-badge-row">
        <span className="nesio-type-category-pill nesio-type-category-pill--health">{typeLabel}</span>
      </div>
      <InfoRow label={L(dict, '时间', 'Time')} value={fmtDateTime(date, dict)} />
      {value && <InfoRow label={L(dict, '数值', 'Value')} value={unit ? `${value} ${unit}` : value} />}
      <InfoRow label={L(dict, '备注', 'Note')} value={note} />
    </div>
  );
}

function PreferenceSection({ node, assetUrls }: {
  node: LifeNode;
  assetUrls: Record<string, string>;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const category = attr(node, 'category');
  const note = attr(node, 'note');
  const date = attr(node, 'date');
  const assets = node.assets || [];
  const firstImage = assets.find((a) => a.kind === 'image' || a.mimeType?.startsWith('image/'));
  const previewUrl = firstImage ? assetUrls[firstImage.id || firstImage.storagePath || ''] : '';

  return (
    <div className="nesio-type-section">
      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt={node.name} className="nesio-type-thumb" draggable={false}
          role="button" tabIndex={0} style={{ cursor: 'zoom-in' }}
          onClick={() => window.dispatchEvent(new CustomEvent('nesio-view-image', { detail: { url: previewUrl, name: node.name } }))} />
      )}
      {category && (
        <div className="nesio-type-badge-row">
          <span className="nesio-type-category-pill">{category}</span>
        </div>
      )}
      <InfoRow label={L(dict, '记录时间', 'Noted on')} value={fmtDate(date, dict)} />
      <InfoRow label={L(dict, '备注', 'Note')} value={note} />
    </div>
  );
}

// 批次 73:关联链的手动增删是最直接的反馈信号 —— 本地留痕(后续喂遥测/学习)。
function logLinkFeedback(entry: Record<string, unknown>): void {
  try {
    const k = 'nesio-link-feedback-v1';
    const arr = JSON.parse(localStorage.getItem(k) || '[]') as unknown[];
    arr.unshift({ t: Date.now(), ...entry });
    localStorage.setItem(k, JSON.stringify(arr.slice(0, 200)));
  } catch { /* 留痕失败不拦操作 */ }
}

// ── Main component ──────────────────────────────────────────────────────────

interface EditFields {
  name: string;
  // object
  location: string; price: string; purchaseDate: string; expiry: string;
  // commitment
  dueDate: string; priority: string; owner: string; recurring: string;
  // event
  url: string; eventLocation: string;
  // person
  category: string; birthday: string;
  // shared
  note: string;
}

// ── Graph helpers ─────────────────────────────────────────────────────────────

// 批次 76(用户实锤「点关联记忆进入页面错误」):详情崩溃只崩这张卡,
// 不再把整页打成错误页 —— 卡片级边界,给出关闭出口。
class DetailErrorBoundary extends Component<{ onClose: () => void; children: ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  render() {
    if (this.state.err) {
      return (
        <div className="nesio-node-detail-overlay" role="dialog" aria-modal="true" onClick={this.props.onClose}>
          <div className="nesio-node-detail-sheet" style={{ padding: '1.4rem 1.2rem', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: '0 0 0.4rem', fontSize: '1rem', fontWeight: 600 }}>这条记忆的详情没打开成功</p>
            <p style={{ margin: '0 0 0.9rem', fontSize: '0.8rem', color: 'var(--portal-muted)' }}>数据没有丢。关闭后再试一次;若反复出现,请截图这条记忆的名字。</p>
            <button type="button" className="nesio-fin-review-accept" onClick={this.props.onClose}>关闭</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function MemoryNodeDetail(props: MemoryNodeDetailProps) {
  return (
    <DetailErrorBoundary key={props.node?.id ?? 'none'} onClose={props.onClose}>
      <MemoryNodeDetailInner {...props} />
    </DetailErrorBoundary>
  );
}

function MemoryNodeDetailInner({ node, onClose, relatedNodes, onOpenNode }: MemoryNodeDetailProps) {
  // 批次 73:关联链手动管理(增/删即反馈)
  const [removedRels, setRemovedRels] = useState<Set<string>>(new Set());
  const [addedRels, setAddedRels] = useState<Array<{ targetId: string; relation: string }>>([]);
  const [linkPicking, setLinkPicking] = useState(false);
  const [linkQuery, setLinkQuery] = useState('');
  const [linkError, setLinkError] = useState(''); // 批次 94:关联出错时可见,便于用户截图反馈
  const [rawExpanded, setRawExpanded] = useState(false); // 批次 74:原始记录折叠
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<EditFields>({
    name: '', location: '', price: '', purchaseDate: '', expiry: '',
    dueDate: '', priority: '', owner: '', recurring: '',
    url: '', eventLocation: '', category: '', birthday: '', note: '',
  });
  const [deleted, setDeleted] = useState(false);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  // 批次 23:全屏看图 + 问一问这张图
  const [viewImage, setViewImage] = useState<{ url: string; name: string } | null>(null);
  // 批次 24:文章阅读器(节点有 article 时)
  const [readerOpen, setReaderOpen] = useState(false);
  // 批次 36:在 Nesio 内回复邮件
  const [composeOpen, setComposeOpen] = useState(false);
  // 批次 57:有坐标没地名(反查当时没跑完/存量节点)→ 打开详情时自愈回填
  const [healedPlace, setHealedPlace] = useState('');
  const [placePickOpen, setPlacePickOpen] = useState(false); // 批次 63:记忆页也能改地址(与足迹同库)
  useEffect(() => {
    setHealedPlace('');
    const attrs = node?.attributes;
    if (!attrs || attrs.capturedPlace || typeof attrs.capturedLat !== 'number' || typeof attrs.capturedLon !== 'number') return;
    let cancelled = false;
    // 批次 60:改用两级健壮反查(天气链空手落服务端 geocode)—— 设备侧
    // 直连第三方反查偶发全空,此前自愈会一直失败
    void import('@/lib/portal/capture-location').then(({ reverseGeocodeRobust }) =>
      reverseGeocodeRobust(attrs.capturedLat as number, attrs.capturedLon as number).then(({ label }) => {
        if (cancelled || !label) return;
        setHealedPlace(label);
        const live = getLifeGraph().find((x) => x.id === node.id);
        if (live && !live.attributes.capturedPlace) {
          updateLifeNode(node.id, { attributes: { ...live.attributes, capturedPlace: label } });
        }
      }),
    ).catch(() => {});
    return () => { cancelled = true; };
  }, [node]);
  useEffect(() => {
    const onView = (e: Event) => setViewImage((e as CustomEvent).detail);
    window.addEventListener('nesio-view-image', onView);
    return () => window.removeEventListener('nesio-view-image', onView);
  }, []);

  function field(k: keyof EditFields) {
    return fields[k];
  }
  function setField(k: keyof EditFields, v: string) {
    setFields((prev) => ({ ...prev, [k]: v }));
  }

  useEffect(() => {
    const assets = node?.assets || [];
    if (assets.length === 0) { setAssetUrls({}); return; }
    let cancelled = false;
    const client = createAppApiClient();
    setAssetUrls({});
    for (const asset of assets) {
      const key = asset.id || asset.storagePath || '';
      if (!key) continue;
      // 批次 23:本机图优先从 IndexedDB 读(未登录/离线也能看)
      if (asset.local) {
        void import('@/lib/portal/local-image-store').then(({ getLocalImage }) =>
          getLocalImage(asset.id).then((dataUrl) => {
            if (!cancelled && dataUrl) setAssetUrls((cur) => ({ ...cur, [key]: dataUrl }));
          }),
        ).catch(() => {});
        continue;
      }
      if (!asset.storagePath) continue;
      void client.fetchCloudAssetReadUrl({ storagePath: asset.storagePath })
        .then((result) => {
          if (cancelled || !result.ok || !result.signedUrl) return;
          setAssetUrls((cur) => ({ ...cur, [key]: result.signedUrl || '' }));
        })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [node?.id, node?.assets]);

  if (!node || deleted) return null;
  const n = node;

  function startEdit() {
    setFields({
      name: n.name,
      location: attr(n, 'location', 'room'),
      price: attr(n, 'price'),
      purchaseDate: attr(n, 'purchaseDate'),
      expiry: attr(n, 'expiry'),
      dueDate: attr(n, 'dueDate', 'deadline', 'due', 'date'),
      priority: attr(n, 'priority'),
      owner: attr(n, 'owner'),
      recurring: attr(n, 'recurring'),
      url: attr(n, 'url', 'htmlLink'),
      eventLocation: attr(n, 'location'),
      category: attr(n, 'category'),
      birthday: attr(n, 'birthday'),
      note: attr(n, 'note'),
    });
    setEditing(true);
  }
  function saveEdit() {
    if (!fields.name.trim()) return;
    const extra: Record<string, string | null> = {};
    if (n.type === 'object') {
      if (fields.location !== attr(n, 'location', 'room')) extra.location = fields.location || null;
      if (fields.price !== attr(n, 'price')) extra.price = fields.price || null;
      if (fields.purchaseDate !== attr(n, 'purchaseDate')) extra.purchaseDate = fields.purchaseDate || null;
      if (fields.expiry !== attr(n, 'expiry')) extra.expiry = fields.expiry || null;
    }
    if (n.type === 'commitment') {
      if (fields.dueDate !== attr(n, 'dueDate', 'deadline')) extra.dueDate = fields.dueDate || null;
      if (fields.priority !== attr(n, 'priority')) extra.priority = fields.priority || null;
      if (fields.owner !== attr(n, 'owner')) extra.owner = fields.owner || null;
      if (fields.recurring !== attr(n, 'recurring')) extra.recurring = fields.recurring || null;
    }
    if (n.type === 'event') {
      if (fields.url !== attr(n, 'url', 'htmlLink')) extra.url = fields.url || null;
      if (fields.eventLocation !== attr(n, 'location')) extra.location = fields.eventLocation || null;
    }
    if (n.type === 'person') {
      if (fields.category !== attr(n, 'category')) extra.category = fields.category || null;
      if (fields.birthday !== attr(n, 'birthday')) extra.birthday = fields.birthday || null;
    }
    if (fields.note !== attr(n, 'note')) extra.note = fields.note || null;
    const newAttrs = { ...n.attributes };
    for (const [k, v] of Object.entries(extra)) {
      if (v === null) delete newAttrs[k];
      else newAttrs[k] = v;
    }
    updateLifeNode(n.id, { name: fields.name.trim(), attributes: newAttrs });
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
    setEditing(false);
    onClose();
  }
  function handleDelete() {
    if (!confirm(L(dict, `确认删除「${n.name}」？`, `Delete "${n.name}"?`))) return;
    deleteLifeNode(n.id);
    setDeleted(true);
    onClose();
  }
  function toggleDone() {
    const isDone = Boolean(n.attributes.done);
    updateLifeNode(n.id, {
      attributes: {
        ...n.attributes,
        done: !isDone,
        ...(isDone ? { doneAt: null } : { doneAt: new Date().toISOString() }),
      },
    });
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
    onClose();
  }

  // 标签三层 §3.3:「记录于 2026年7月9日」→ 相对时间(今天 12:34 / 昨天 / N 天前)
  const createdDate = (() => {
    const created = new Date(n.createdAt);
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const time = created.toLocaleTimeString(dict === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (created >= dayStart) return L(dict, `今天 ${time}`, `today ${time}`);
    if (created >= new Date(dayStart.getTime() - 86_400_000)) return L(dict, `昨天 ${time}`, `yesterday ${time}`);
    return relativePastLabel(created, Date.now(), dict);
  })();

  // Remaining attributes not shown in type-specific sections
  const shownAttrs = Object.entries(n.attributes).filter(
    ([k, v]) => v !== null && v !== '' && !HIDDEN_ATTRIBUTE_KEYS.has(k),
  );
  const showRawInput = Boolean(n.rawInput && n.source !== 'calendar' && n.source !== 'email');
  const typeBg = TYPE_BG_DETAIL[n.type] || 'var(--chip-fog)';

  // 批次 27:阅读入口不再只认 article —— 老邮件节点没存 article,退到 summary/snippet/正文,
  // 只要有一段够长的正文(>40 字)就给「阅读」按钮,进瀑布流阅读器。
  const readableAttrs = n.attributes as Record<string, unknown>;
  const readableText = [readableAttrs.article, readableAttrs.summary, readableAttrs.snippet, readableAttrs.body, n.rawInput]
    .find((v): v is string => typeof v === 'string' && v.trim().length > 40);

  // 批次 36:邮件节点 → 可在 Nesio 内直接回复。识别:source=email 且带发件人。
  const emailFrom = typeof readableAttrs.from === 'string' ? readableAttrs.from : '';
  const emailId = typeof readableAttrs.emailId === 'string' ? readableAttrs.emailId : '';
  const isEmailNode = n.source === 'email' && Boolean(emailFrom);

  // 批次 124·设计来源行:图标 + 「来自 {来源} · {provider} · {时间}」。可信度统一——只在 AI 没把握时标「待确认」。
  const SRC = (() => {
    const sz = 14;
    const tags = n.tags || [];
    if (tags.includes('notion')) return { icon: <IconNote size={sz} />, label: 'Notion', provider: '' };
    if (tags.includes('keep')) return { icon: <IconNote size={sz} />, label: 'Keep', provider: '' };
    if (n.type === 'place') return { icon: <IconMapPin size={sz} />, label: L(dict, '位置', 'Place'), provider: '' };
    switch (n.source) {
      case 'email': return { icon: <IconMail size={sz} />, label: L(dict, '邮件', 'Email'), provider: 'Gmail' };
      case 'calendar': return { icon: <IconCalendar size={sz} />, label: L(dict, '日历', 'Calendar'), provider: L(dict, 'Google 日历', 'Google Calendar') };
      case 'photo': return { icon: <IconCamera size={sz} />, label: L(dict, '拍照', 'Photo'), provider: '' };
      case 'voice': return { icon: <IconMic size={sz} />, label: L(dict, '语音', 'Voice'), provider: '' };
      case 'system': return { icon: <IconNote size={sz} />, label: L(dict, '系统', 'System'), provider: '' };
      default: return { icon: <IconNote size={sz} />, label: L(dict, '手记', 'Note'), provider: '' };
    }
  })();
  const srcTimeRaw = (typeof readableAttrs.date === 'string' && readableAttrs.date) ? readableAttrs.date : n.createdAt;
  const srcTime = (() => {
    const d = new Date(srcTimeRaw);
    if (isNaN(d.getTime())) return '';
    return `${d.getMonth() + 1}·${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  })();
  const srcUncertain = n.confidence > 0 && n.confidence < 0.6;

  return (
    <div className="nesio-node-detail-overlay" role="dialog" aria-modal="true" aria-label={n.name}>
      {readerOpen && readableText && (
        <ReaderSheetLazy title={n.name} article={readableText} onClose={() => setReaderOpen(false)} />
      )}
      {isEmailNode && (
        <EmailComposeSheet
          open={composeOpen}
          onClose={() => setComposeOpen(false)}
          context={{ emailId, from: emailFrom, subject: n.name, snippet: typeof readableAttrs.snippet === 'string' ? readableAttrs.snippet : undefined, article: readableText }}
        />
      )}
      {viewImage && (
        <div className="nesio-image-viewer" role="dialog" aria-modal="true" onClick={() => setViewImage(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewImage.url} alt={viewImage.name} className="nesio-image-viewer-img" />
          <div className="nesio-image-viewer-actions" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="nesio-ob-primary-btn"
              onClick={() => {
                // 把这张图交给问一问(chat sheet 监听此事件,带图打开)
                window.dispatchEvent(new CustomEvent('nesio-ask-image', { detail: { url: viewImage.url, name: viewImage.name } }));
                setViewImage(null);
                onClose();
              }}
            >
              {L(dict, '问一问这张图', 'Ask about this photo')}
            </button>
            <button type="button" className="nesio-image-viewer-close" onClick={() => setViewImage(null)}>{L(dict, '关闭', 'Close')}</button>
          </div>
        </div>
      )}
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-settings-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />

        {/* Type color strip */}
        {/* 类型色条:tint 走 CSS 变量,夜间由 CSS 混暗 —— 直接 inline background 会让
            浅色 pastel 在夜间糊成一条白带(QA 截图「弹出框上侧白边」)。 */}
        <div className="nesio-type-header-strip" style={{ ['--type-strip-bg' as string]: typeBg }}>
          <span className="nesio-type-header-icon"><NodeTypeIcon type={n.type} size={15} /></span>
          <span className="nesio-type-header-label">{(dict === 'en' ? TYPE_LABELS_EN : TYPE_LABELS_ZH)[n.type] || n.type}</span>
        </div>

        <div className="nesio-settings-sheet-header">
          {editing ? (
            <input
              className="nesio-ob-input" style={{ fontSize: '1rem', marginBottom: 0, flex: 1 }}
              value={field('name')} onChange={(e) => setField('name', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); }}
              autoFocus
            />
          ) : (
            <h2 className="nesio-settings-sheet-title" title={n.name}>{displayTitle(displayNodeName(n.name, dict))}</h2>
          )}
          {/* 批次 31/37:顶部放「阅读」「回复」并排替换 ✕(背景点击仍可关闭) */}
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            {!editing && readableText && (
              <button type="button" className="nesio-node-read-top" onClick={() => setReaderOpen(true)}>{L(dict, '阅读', 'Read')}</button>
            )}
            {!editing && isEmailNode && (
              <button type="button" className="nesio-node-read-top" onClick={() => setComposeOpen(true)}>{L(dict, '回复', 'Reply')}</button>
            )}
            {(editing || (!readableText && !isEmailNode)) && (
              <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
            )}
          </div>
        </div>

        {/* Expanded edit form — type-specific fields */}
        {editing && (
          <div className="nesio-edit-form">
            {n.type === 'object' && (<>
              <div className="nesio-edit-row">
                <span>{L(dict, '存放位置', 'Stored at')}</span>
                <LocationPicker value={field('location')} onChange={(v) => setField('location', v)} />
              </div>
              <label className="nesio-edit-row"><span>{L(dict, '价格', 'Price')}</span><input value={field('price')} onChange={(e) => setField('price', e.target.value)} placeholder="$12.99" /></label>
              <label className="nesio-edit-row"><span>{L(dict, '购买日期', 'Bought on')}</span><input type="date" value={field('purchaseDate')} onChange={(e) => setField('purchaseDate', e.target.value)} /></label>
              <label className="nesio-edit-row"><span>{L(dict, '有效期', 'Expires')}</span><input type="date" value={field('expiry')} onChange={(e) => setField('expiry', e.target.value)} /></label>
            </>)}
            {n.type === 'commitment' && (<>
              <label className="nesio-edit-row"><span>{L(dict, '截止日期', 'Due')}</span><input type="date" value={field('dueDate').slice(0, 10)} onChange={(e) => setField('dueDate', e.target.value)} /></label>
              <label className="nesio-edit-row">
                <span>{L(dict, '优先级', 'Priority')}</span>
                <select value={field('priority')} onChange={(e) => setField('priority', e.target.value)}>
                  <option value="">{L(dict, '未设置', 'Not set')}</option>
                  <option value="high">{L(dict, '紧急', 'Urgent')}</option>
                  <option value="medium">{L(dict, '重要', 'Important')}</option>
                  <option value="low">{L(dict, '普通', 'Normal')}</option>
                </select>
              </label>
              <label className="nesio-edit-row"><span>{L(dict, '对方/负责人', 'Owner')}</span><input value={field('owner')} onChange={(e) => setField('owner', e.target.value)} placeholder={L(dict, '负责人姓名', "Owner's name")} /></label>
              <label className="nesio-edit-row"><span>{L(dict, '重复', 'Repeats')}</span><input value={field('recurring')} onChange={(e) => setField('recurring', e.target.value)} placeholder={L(dict, '每周/每月…', 'weekly / monthly…')} /></label>
            </>)}
            {n.type === 'event' && (<>
              <label className="nesio-edit-row"><span>{L(dict, '会议链接', 'Meeting link')}</span><input value={field('url')} onChange={(e) => setField('url', e.target.value)} placeholder="https://zoom.us/…" /></label>
              <label className="nesio-edit-row"><span>{L(dict, '地点', 'Location')}</span><input value={field('eventLocation')} onChange={(e) => setField('eventLocation', e.target.value)} placeholder={L(dict, '地点或地址', 'Place or address')} /></label>
            </>)}
            {n.type === 'person' && (<>
              <label className="nesio-edit-row">
                <span>{L(dict, '关系', 'Relationship')}</span>
                <select value={field('category')} onChange={(e) => setField('category', e.target.value)}>
                  <option value="">{L(dict, '未分类', 'Uncategorized')}</option>
                  <option value="family">{L(dict, '家人', 'Family')}</option>
                  <option value="colleague">{L(dict, '同事', 'Colleague')}</option>
                  <option value="friend">{L(dict, '朋友', 'Friend')}</option>
                  <option value="acquaintance">{L(dict, '认识', 'Acquaintance')}</option>
                </select>
              </label>
              <label className="nesio-edit-row"><span>{L(dict, '生日', 'Birthday')}</span><input type="date" value={field('birthday').slice(0, 10)} onChange={(e) => setField('birthday', e.target.value)} /></label>
            </>)}
            <label className="nesio-edit-row"><span>{L(dict, '备注', 'Note')}</span><input value={field('note')} onChange={(e) => setField('note', e.target.value)} placeholder={L(dict, '补充说明…', 'Anything else…')} /></label>
          </div>
        )}

        <div className="nesio-settings-sheet-body">
          {/* 批次 124·设计来源行:来自 {来源}·{provider} · {时间}(带图标)。
              可信度统一:默认不显示;只有 AI 没把握时标一个「待确认」(取代 比较确定/可能相关/建议确认)。 */}
          <div className="nesio-node-source-row">
            <span className="nesio-node-source-icon" aria-hidden>{SRC.icon}</span>
            <span className="nesio-node-source-text">
              {L(dict, '来自 ', 'From ')}{SRC.label}{SRC.provider ? ` · ${SRC.provider}` : ''}{srcTime ? ` · ${srcTime}` : ''}
            </span>
            {srcUncertain && <span className="nesio-node-pending">{L(dict, '待确认', 'Unconfirmed')}</span>}
          </div>

          {/* 批次 70:关联链 —— 行程↔邮件自动挂钩、计划容器↔条目,点开跳转;
              批次 73:手动增删关联(删除自动连线 = 反馈信号,本地留痕) */}
          {(() => {
            try {
            const g = getLifeGraph();
            // 批次 77(用户点名图标问题):emoji → 设计系统线性图标
            const REL_LABEL: Record<string, [ReactNode, string, string]> = {
              confirmed_by_email: [<IconMail key="i" size={13} />, '确认邮件', 'Confirmation email'],
              confirms_plan: [<IconCalendar key="i" size={13} />, '对应行程', 'Linked plan'],
              part_of_plan: [<IconFlag key="i" size={13} />, '所属计划', 'Part of plan'],
              plan_item: [<IconCalendar key="i" size={13} />, '计划条目', 'Plan item'],
              related_plan: [<IconLink key="i" size={13} />, '相关计划', 'Related plan'],
              has_checklist: [<IconCheckSquare key="i" size={13} />, '对应清单', 'Checklist'],
              user_linked: [<IconLink key="i" size={13} />, '手动关联', 'Linked'],
            };
            const rels = [
              ...(n.relations || []).filter((r) => !removedRels.has(`${r.relation}:${r.targetId}`)),
              ...addedRels,
            ];
            const live = rels
              .map((r) => ({ r, node: g.find((x) => x.id === r.targetId) }))
              .filter((x): x is { r: { targetId: string; relation: string }; node: LifeNode } => Boolean(x.node) && Boolean(REL_LABEL[x.r.relation]));
            // 批次 94(用户实锤关联记忆闪退):onClick 里抛的错 React 错误边界
            // 抓不到(只抓 render),会冒到全局 → 批次 85 处理器可能触发重载 =
            // 看起来「闪退」。addRel/removeRel 全包 try/catch,任何异常只吞不炸。
            const removeRel = (r: { targetId: string; relation: string }) => {
              try {
                setRemovedRels((prev) => new Set(prev).add(`${r.relation}:${r.targetId}`));
                const liveN = g.find((x) => x.id === n.id);
                if (liveN) updateLifeNode(n.id, { relations: (liveN.relations || []).filter((x) => !(x.targetId === r.targetId && x.relation === r.relation)) });
                const t = g.find((x) => x.id === r.targetId);
                if (t) updateLifeNode(t.id, { relations: (t.relations || []).filter((x) => x.targetId !== n.id) });
                logLinkFeedback({ action: 'removed', relation: r.relation, from: n.id, to: r.targetId });
              } catch (err) { console.error('[link] remove_failed', err); setLinkError(`解除出错:${err instanceof Error ? err.message : String(err)}`.slice(0, 120)); }
            };
            const addRel = (t: LifeNode) => {
              try {
                if (t.id === n.id || rels.some((x) => x.targetId === t.id)) { setLinkPicking(false); setLinkQuery(''); return; }
                const liveN = g.find((x) => x.id === n.id);
                updateLifeNode(n.id, { relations: [...(liveN?.relations || []), { targetId: t.id, relation: 'user_linked' }] });
                updateLifeNode(t.id, { relations: [...((g.find((x) => x.id === t.id)?.relations) || []), { targetId: n.id, relation: 'user_linked' }] });
                setAddedRels((prev) => [...prev, { targetId: t.id, relation: 'user_linked' }]);
                logLinkFeedback({ action: 'added', relation: 'user_linked', from: n.id, to: t.id });
              } catch (err) {
                console.error('[link] add_failed', err);
                setLinkError(`关联出错:${err instanceof Error ? err.message : String(err)}`.slice(0, 120));
              } finally {
                setLinkQuery('');
              }
            };
            const candidates = linkPicking && linkQuery.trim().length >= 1
              ? searchLifeGraphFuzzy(linkQuery.trim(), 6).filter((x) => x.id !== n.id)
              : [];
            return (
              <div className="nesio-node-links">
                {live.map(({ r, node: t }) => (
                  <div key={`${r.relation}-${r.targetId}`} className="nesio-node-link-row">
                    <button type="button" className="nesio-node-link-chip" onClick={() => onOpenNode?.(t)}>
                      <span>{REL_LABEL[r.relation][0]}</span>
                      <span className="nesio-node-link-kind">{L(dict, REL_LABEL[r.relation][1], REL_LABEL[r.relation][2])}</span>
                      <span className="nesio-node-link-name">{t.name.slice(0, 24)}</span>
                    </button>
                    <button type="button" className="nesio-node-link-x" aria-label={L(dict, '解除关联', 'Unlink')} onClick={() => removeRel(r)}>✕</button>
                  </div>
                ))}
                {!linkPicking ? (
                  <button type="button" className="nesio-node-link-add" onClick={() => setLinkPicking(true)}>
                    ＋ {L(dict, '关联一条记忆', 'Link a memory')}
                  </button>
                ) : (
                  <div className="nesio-node-link-picker">
                    <input
                      className="nesio-tl-rename-input"
                      value={linkQuery}
                      onChange={(e) => setLinkQuery(e.target.value)}
                      placeholder={L(dict, '搜记忆名字…', 'Search memories…')}
                      autoFocus
                    />
                    {candidates.map((c) => (
                      <button key={c.id} type="button" className="nesio-node-link-cand" onClick={() => addRel(c)}>
                        <NodeTypeIcon type={c.type} size={12} /> {c.name.slice(0, 28)}
                      </button>
                    ))}
                    <button type="button" className="nesio-node-link-add" onClick={() => { setLinkPicking(false); setLinkQuery(''); }}>{L(dict, '收起', 'Close')}</button>
                  </div>
                )}
                {linkError && (
                  <p style={{ fontSize: '0.7rem', color: 'var(--status-risk)', margin: '0.3rem 0 0', wordBreak: 'break-all' }}>{linkError}</p>
                )}
              </div>
            );
            } catch {
              // 批次 83(用户实锤「添加关联闪退卡死」):关联块自身出错只藏本块,
              // 不放大成整卡崩溃;等真机栈定点修根因。
              return null;
            }
          })()}

          {/* Type-specific section */}
          {n.type === 'person' && (
            <PersonSection node={n} relatedNodes={relatedNodes} onOpenNode={onOpenNode} />
          )}
          {n.type === 'object' && (
            <ObjectSection node={n} assetUrls={assetUrls} />
          )}
          {n.type === 'place' && (
            <PlaceSection node={n} relatedNodes={relatedNodes} onOpenNode={onOpenNode} />
          )}
          {n.type === 'event' && (
            <EventSection node={n} relatedNodes={relatedNodes} onOpenNode={onOpenNode} />
          )}
          {n.type === 'commitment' && (
            <CommitmentSection node={n} onToggleDone={toggleDone} />
          )}
          {n.type === 'health_state' && (
            <HealthSection node={n} />
          )}
          {n.type === 'preference' && (
            <PreferenceSection node={n} assetUrls={assetUrls} />
          )}

          {/* Raw input —— 批次 74:长文默认折叠(清单类原文动辄上千字) */}
          {showRawInput && (
            <div className="nesio-node-raw" style={{ marginTop: '0.75rem' }}>
              <p className="nesio-settings-section-label">{L(dict, '原始记录', 'Original note')}</p>
              <p style={{ fontSize: '0.88rem', color: 'var(--portal-muted)', fontStyle: 'italic' }}>
                &ldquo;{rawExpanded || (n.rawInput || '').length <= 180 ? n.rawInput : `${(n.rawInput || '').slice(0, 180)}…`}&rdquo;
              </p>
              {(n.rawInput || '').length > 180 && (
                <button type="button" className="nesio-node-link-add" onClick={() => setRawExpanded((v) => !v)}>
                  {rawExpanded ? L(dict, '收起', 'Collapse') : L(dict, '展开全文', 'Show all')}
                </button>
              )}
            </div>
          )}

          {/* Remaining attributes not covered above */}
          {shownAttrs.length > 0 && (
            <>
              <p className="nesio-settings-section-label" style={{ marginTop: '0.75rem' }}>{L(dict, '其他属性', 'Other details')}</p>
              {shownAttrs.map(([k, v]) => (
                <div key={k} className="nesio-node-attr-row">
                  <span className="nesio-node-attr-key">{(dict === 'en' ? ATTR_KEY_LABELS_EN : ATTR_KEY_LABELS)[k] ?? k}</span>
                  <span className="nesio-node-attr-val" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    {k === 'condition' && <WeatherIcon condition={String(v)} size={15} />}
                    {k === 'temperatureC' ? `${String(v)} °C` : String(v)}
                  </span>
                </div>
              ))}
            </>
          )}

          {/* 标签三层重构:L2 语义标签(AI 冗余打的检索词,如 餐具/玻璃/水杯)不再上屏 ——
              只进检索索引。唯一露面的是 L3「主题门」:同标签 ≥3 条记忆才出现,是门不是签
              (可点,跳回记忆页搜该主题),每处最多 2 扇。 */}
          {(() => {
            if (!n.tags?.length) return null;
            let graph: LifeNode[] = [];
            try { graph = getLifeGraph(); } catch { /* ignore */ }
            const doors = n.tags
              .map((t) => ({ t, count: graph.filter((x) => x.id !== n.id && x.tags?.includes(t)).length + 1 }))
              .filter((d) => d.count >= 3)
              .sort((a, b) => b.count - a.count)
              .slice(0, 2);
            if (!doors.length) return null;
            return (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                {doors.map(({ t, count }) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      onClose();
                      window.dispatchEvent(new CustomEvent('nesio-memory-search', { detail: { query: t } }));
                    }}
                    style={{ background: 'var(--portal-accent-soft, rgba(88,140,227,0.12))', border: 'none', borderRadius: 999, padding: '0.35rem 0.8rem', fontSize: '0.78rem', color: 'var(--portal-accent, #588ce3)', cursor: 'pointer' }}
                  >
                    {t} · {count} {L(dict, '条', '')} ›
                  </button>
                ))}
              </div>
            );
          })()}

          {/* 批次 39:去重 —— 物品/偏好节点顶部 Object/PreferenceSection 已展示首图作 hero,
              图片线索里跳过它,避免同一张图出现两次;只剩额外图时才显示本区。 */}
          {(() => {
            const allAssets = n.assets || [];
            const heroShown = n.type === 'object' || n.type === 'preference';
            const heroKey = heroShown
              ? (() => { const f = allAssets.find((a) => a.kind === 'image' || a.mimeType?.startsWith('image/')); return f ? (f.id || f.storagePath || f.label || 'asset') : ''; })()
              : '';
            const galleryAssets = allAssets.filter((a) => (a.id || a.storagePath || a.label || 'asset') !== heroKey);
            if (galleryAssets.length === 0) return null;
            return (
            <>
              <p className="nesio-settings-section-label" style={{ marginTop: '0.75rem' }}>{L(dict, '图片线索', 'Image clues')}</p>
              <div style={{ display: 'grid', gap: '0.6rem' }}>
                {galleryAssets.map((asset) => {
                  const key = asset.id || asset.storagePath || asset.label || 'asset';
                  const previewUrl = assetUrls[key];
                  const isImage = asset.kind === 'image' || asset.mimeType?.startsWith('image/');
                  return (
                    <div key={key} className="nesio-type-asset-card">
                      {isImage && previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={previewUrl} alt={asset.label || n.name} draggable={false} className="nesio-type-asset-img" onClick={() => setViewImage({ url: previewUrl, name: asset.label || n.name })} style={{ cursor: 'zoom-in' }} />
                      ) : (
                        <p style={{ fontSize: '0.82rem', color: 'var(--portal-muted)', marginBottom: '0.35rem' }}>
                          {asset.local ? L(dict, '图片加载中…', 'Loading image…') : asset.storagePath ? L(dict, '图片线索已保存，登录后可查看。', 'Image clue saved — sign in to view.') : L(dict, '附件线索已保存。', 'Attachment clue saved.')}
                        </p>
                      )}
                      {asset.analysisSummary && (
                        <p style={{ fontSize: '0.78rem', color: 'var(--portal-muted)', margin: 0 }}>
                          {asset.analysisSummary}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
            );
          })()}

          <p style={{ fontSize: '0.7rem', color: 'var(--portal-muted)', marginTop: '1rem' }}>
            {L(dict, '记录于', 'Noted on')} {createdDate}
            {/* 批次 55/57/63:位置戳 —— 点地点可纠正(与足迹同一套地址库) */}
            {(() => {
              // healedPlace 优先:自愈反查/刚改名的结果 —— 节点 prop 是打开时的快照会滞后
              const place = healedPlace || (typeof n.attributes?.capturedPlace === 'string' && n.attributes.capturedPlace) || '';
              if (!place) return null;
              return (
                <>
                  {' · '}
                  <button type="button" onClick={() => setPlacePickOpen(true)}
                    aria-label={L(dict, '纠正地点', 'Fix place')}
                    style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>
                    {place}
                    {/* 批次 82:用户找不到改地址的入口 —— 可供性显性化(同足迹一套选择器) */}
                    <span aria-hidden style={{ marginLeft: 4, fontSize: '0.82em', opacity: 0.55 }}>✎</span>
                  </button>
                </>
              );
            })()}
          </p>

          {/* 标签三层重构:详情页的关联图撤下 —— 它把「同天创建/弱相似」画成箭头,
              视觉上像因果实际是噪声(QA:「全是乱连接」)。换成诚实的「相关记忆」列表;
              全景图谱仍在记忆页的「关联图」入口。 */}
          {relatedNodes && relatedNodes.length > 0 && (
            <div className="nesio-related-section">
              <p className="nesio-settings-section-label">{L(dict, '相关记忆', 'Related memories')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {relatedNodes.slice(0, 6).map((r) => {
                  // 批次 53:循环日历事件(每周 Sprint 计划)同名难辨 —— 行内带日期标签
                  const rs = typeof r.attributes?.start === 'string' ? r.attributes.start : '';
                  const rd = rs ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(rs) ? `${rs}T00:00` : rs) : null;
                  const dateTag = rd && !Number.isNaN(rd.getTime())
                    ? L(dict, `${rd.getMonth() + 1}月${rd.getDate()}日`, `${rd.getMonth() + 1}/${rd.getDate()}`)
                    : '';
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => onOpenNode?.(r)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', padding: '0.5rem 0.7rem', borderRadius: '0.7rem', border: '1px solid var(--portal-line, rgba(127,127,127,0.18))', background: 'none', color: 'var(--portal-ink)', textAlign: 'left', cursor: 'pointer' }}
                    >
                      <NodeTypeIcon type={r.type} size={13} />
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.85rem' }}>{r.name}</span>
                      {dateTag && <span style={{ color: 'var(--portal-muted)', fontSize: '0.74rem', flex: 'none' }}>{dateTag}</span>}
                      <span style={{ color: 'var(--portal-muted)' }}>›</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {placePickOpen && (
        <PlacePickerLazy
          raw={(typeof n.attributes?.capturedPlace === 'string' && n.attributes.capturedPlace) || healedPlace}
          lat={typeof n.attributes?.capturedLat === 'number' ? n.attributes.capturedLat : undefined}
          lon={typeof n.attributes?.capturedLon === 'number' ? n.attributes.capturedLon : undefined}
          onClose={() => setPlacePickOpen(false)}
          onRenamed={(name) => setHealedPlace(name)}
        />
      )}

      {/* Actions */}
          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.25rem' }}>
            {editing ? (
              <>
                <button type="button" className="nesio-ob-primary-btn" style={{ flex: 1 }} onClick={saveEdit}>{L(dict, '保存', 'Save')}</button>
                <button type="button" className="nesio-today-btn nesio-today-btn--ghost" style={{ flex: 1 }} onClick={() => setEditing(false)}>{L(dict, '取消', 'Cancel')}</button>
              </>
            ) : (
              <>
                {/* 批次 33:阅读入口顶部有(替换✕),底部也放回来一份 —— 用户反馈顶部那颗找不到 */}
                {readableText && (
                  <button type="button" className="nesio-ob-primary-btn" style={{ flex: 1 }} onClick={() => setReaderOpen(true)}>{L(dict, '阅读', 'Read')}</button>
                )}
                {/* 批次 37:回复按钮移到顶部「阅读」旁,底部不再重复 */}
                <button type="button" className="nesio-today-btn nesio-today-btn--ghost" style={{ flex: 1 }} onClick={startEdit}>{L(dict, '编辑', 'Edit')}</button>
                <button type="button" className="nesio-settings-danger-btn" style={{ flex: 1, marginTop: 0 }} onClick={handleDelete}>{L(dict, '删除', 'Delete')}</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
