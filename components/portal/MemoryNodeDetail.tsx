'use client';

import { useEffect, useState } from 'react';
import { deleteLifeNode, updateLifeNode, type LifeNode } from '@/lib/portal/life-graph';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import LocationPicker from './LocationPicker';
import RelationGraph from './RelationGraph';
import EmailComposeSheet from './EmailComposeSheet';
import type { GNode, GEdge } from '@/lib/platform/graph-engine';
import { IconClock, IconLink, NodeTypeIcon, WeatherIcon } from './icons';
import { L } from '@/lib/portal/i18n';
import { displayNodeName } from '@/lib/portal/node-display';
import dynamicImport from 'next/dynamic';
const ReaderSheetLazy = dynamicImport(() => import('./ArticleReaderSheet'), { ssr: false });
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
  // Location (shown in PlaceSection)
  'lat', 'lon', 'address', 'location', 'room',
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

  return (
    <div className="nesio-type-section">
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

const NODE_COLOR: Record<string, string> = {
  person:       'var(--portal-accent)',
  object:       'var(--status-calm)',
  place:        'var(--status-go)',
  event:        'var(--status-gentle)',
  commitment:   'var(--portal-cool-accent)',
  health_state: 'var(--status-risk)',
  preference:   'var(--portal-muted)',
};

function buildGraphNodes(focus: LifeNode, related: LifeNode[]): GNode[] {
  const all = [focus, ...related];
  const maxRel = Math.max(1, ...all.map(n => n.relations?.length ?? 0));
  return all.map(n => ({
    id: n.id,
    label: n.name,
    type: n.type,
    weight: 0.3 + ((n.relations?.length ?? 0) / maxRel) * 0.7,
    color: NODE_COLOR[n.type] ?? 'var(--portal-accent)',
  }));
}

function buildGraphEdges(focus: LifeNode, related: LifeNode[]): GEdge[] {
  const edges: GEdge[] = [];
  const seen = new Set<string>();
  const all = [focus, ...related];
  const idSet = new Set(all.map(n => n.id));

  for (const node of all) {
    if (!node.relations?.length) continue;
    for (const rel of node.relations) {
      if (!idSet.has(rel.targetId)) continue;
      const key = [node.id, rel.targetId].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: node.id, target: rel.targetId, label: rel.relation });
    }
  }
  // Ensure focus node connects to at least direct neighbours
  for (const r of related) {
    const key = [focus.id, r.id].sort().join('|');
    if (!seen.has(key)) {
      seen.add(key);
      edges.push({ source: focus.id, target: r.id, weight: 0.3 });
    }
  }
  return edges;
}

export default function MemoryNodeDetail({ node, onClose, relatedNodes, onOpenNode }: MemoryNodeDetailProps) {
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

  const createdDate = new Date(n.createdAt).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'long', day: 'numeric', year: 'numeric' });

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
          {/* Source / confidence */}
          <div className="nesio-node-meta-row">
            <span className="nesio-node-source">
              {(dict === 'en' ? { manual: 'Manual', photo: 'Photo', voice: 'Voice', calendar: 'Calendar', email: 'Email', system: 'System' } : { manual: '手动', photo: '拍照', voice: '语音', calendar: '日历', email: '邮件', system: '系统' } as Record<string, string>)[n.source] || n.source}
            </span>
            <span className="nesio-node-confidence">
              {n.confidence >= 0.82 ? L(dict, '比较确定', 'Confident') : n.confidence >= 0.58 ? L(dict, '可能相关', 'Likely') : L(dict, '建议确认', 'Please confirm')}
            </span>
          </div>

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

          {/* Raw input */}
          {showRawInput && (
            <div className="nesio-node-raw" style={{ marginTop: '0.75rem' }}>
              <p className="nesio-settings-section-label">{L(dict, '原始记录', 'Original note')}</p>
              <p style={{ fontSize: '0.88rem', color: 'var(--portal-muted)', fontStyle: 'italic' }}>&ldquo;{n.rawInput}&rdquo;</p>
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

          {/* Tags */}
          {n.tags && n.tags.length > 0 && (
            <div className="nesio-today-card-tags" style={{ marginTop: '0.75rem' }}>
              {n.tags.map((t) => <span key={t} className="nesio-today-card-tag">{t}</span>)}
            </div>
          )}

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

          <p style={{ fontSize: '0.7rem', color: 'var(--portal-muted)', marginTop: '1rem' }}>{L(dict, '记录于', 'Noted on')} {createdDate}</p>

          {/* Related memories — 关联地图 */}
          {relatedNodes && relatedNodes.length > 0 && (
            <div className="nesio-related-section">
              <p className="nesio-settings-section-label">{L(dict, '关联地图', 'Connections')}</p>
              <RelationGraph
                nodes={buildGraphNodes(n, relatedNodes)}
                edges={buildGraphEdges(n, relatedNodes)}
                focusId={n.id}
                height={220}
                onNodeClick={(id) => {
                  const target = relatedNodes.find(r => r.id === id);
                  if (target) onOpenNode?.(target);
                }}
                emptyText={L(dict, '暂无关联记忆', 'No connections yet')}
              />
            </div>
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
