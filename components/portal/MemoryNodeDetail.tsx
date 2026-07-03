'use client';

import { useEffect, useState } from 'react';
import { deleteLifeNode, updateLifeNode, type LifeNode } from '@/lib/portal/life-graph';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import LocationPicker from './LocationPicker';

const TYPE_ICON_DETAIL: Record<string, string> = {
  person: '👤', object: '📦', place: '📍', event: '📅',
  commitment: '🤝', health_state: '🩷', preference: '⭐',
};
const TYPE_BG_DETAIL: Record<string, string> = {
  person: '#e0e7ff', object: '#dbeafe', place: '#d1fae5',
  event: '#fef3c7', commitment: '#ede9fe', health_state: '#fce7f3', preference: '#f0fdf4',
};

interface MemoryNodeDetailProps {
  node: LifeNode | null;
  onClose: () => void;
  relatedNodes?: LifeNode[];
  onOpenNode?: (node: LifeNode) => void;
}

const TYPE_LABELS: Record<string, string> = {
  person: '人物', object: '物品', place: '地点', event: '事件',
  commitment: '承诺', health_state: '健康状态', preference: '偏好',
};

const PERSON_CATEGORIES: Record<string, string> = {
  family: '家人', colleague: '同事', friend: '朋友', acquaintance: '认识', other: '其他',
};
const HEALTH_TYPES: Record<string, string> = {
  medication: '💊 药物', appointment: '🩺 就诊', fitness: '🏃 运动',
  sleep: '😴 睡眠', diet: '🥗 饮食', checkup: '🔬 检查', other: '🩷 健康',
};
const PLACE_CATEGORIES: Record<string, string> = {
  work: '🏢 工作', school: '🎓 学校', home: '🏠 家', shopping: '🛍️ 购物',
  restaurant: '🍽️ 餐厅', gym: '🏋️ 健身', hospital: '🏥 医院', other: '📍 地点',
};
const PRIORITY_LABELS: Record<string, { label: string; color: string }> = {
  high: { label: '⚠️ 紧急', color: 'var(--status-risk)' },
  medium: { label: '⬆️ 重要', color: 'var(--status-gentle)' },
  low: { label: '↓ 普通', color: 'var(--portal-muted)' },
};

function attr(node: LifeNode, ...keys: string[]): string {
  for (const k of keys) {
    const v = node.attributes[k];
    if (v !== null && v !== undefined && v !== '') return String(v);
  }
  return '';
}

function fmtDate(raw: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function fmtDateTime(raw: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  if (!hasTime) return fmtDate(raw);
  return d.toLocaleString('zh-CN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function mapUrl(address: string, lat?: string, lon?: string): string {
  if (lat && lon) return `https://maps.apple.com/?ll=${lat},${lon}&q=${encodeURIComponent(address || '位置')}`;
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

const HIDDEN_ATTR_KEYS = new Set([
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

function PersonSection({ node, relatedNodes, onOpenNode }: {
  node: LifeNode;
  relatedNodes?: LifeNode[];
  onOpenNode?: (n: LifeNode) => void;
}) {
  const category = attr(node, 'category');
  const lastSeen = attr(node, 'lastSeen');
  const birthday = attr(node, 'birthday');
  const note = attr(node, 'note');
  const events = (relatedNodes || []).filter((n) => n.type === 'event');

  return (
    <div className="nesio-type-section">
      {category && (
        <div className="nesio-type-badge-row">
          <span className="nesio-type-category-pill">
            {PERSON_CATEGORIES[category] || category}
          </span>
        </div>
      )}
      <InfoRow label="上次见面" value={fmtDate(lastSeen)} />
      <InfoRow label="生日" value={fmtDate(birthday)} />
      <InfoRow label="备注" value={note} />
      {events.length > 0 && (
        <div className="nesio-type-related-events">
          <p className="nesio-settings-section-label" style={{ marginTop: '0.75rem' }}>相关事件</p>
          {events.slice(0, 3).map((e) => (
            <button
              key={e.id} type="button"
              className="nesio-related-node-chip"
              onClick={() => onOpenNode?.(e)}
            >
              <span className="nesio-related-node-icon" style={{ background: TYPE_BG_DETAIL.event }}>📅</span>
              <span className="nesio-related-node-name">{e.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ObjectSection({ node, assetUrls }: {
  node: LifeNode;
  assetUrls: Record<string, string>;
}) {
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
        <img src={previewUrl} alt={node.name} className="nesio-type-thumb" draggable={false} />
      )}
      <InfoRow label="存放位置" value={location} />
      <InfoRow label="购买日期" value={fmtDate(purchaseDate)} />
      <InfoRow label="价格" value={price} />
      <InfoRow label="有效期" value={fmtDate(expiry)} />
      <InfoRow label="购买商家" value={store} />
      <InfoRow label="支付方式" value={paymentMethod} />
      <InfoRow label="备注" value={note} />
      {fileUrl && (
        <div style={{ marginTop: '0.75rem' }}>
          <a href={safeExternalUrl(fileUrl)} target="_blank" rel="noopener noreferrer" className="nesio-type-action-btn">
            🔗 打开链接
          </a>
        </div>
      )}
    </div>
  );
}

function PlaceSection({ node, relatedNodes, onOpenNode }: {
  node: LifeNode;
  relatedNodes?: LifeNode[];
  onOpenNode?: (n: LifeNode) => void;
}) {
  const address = attr(node, 'address', 'location');
  const lat = attr(node, 'lat');
  const lon = attr(node, 'lon');
  const visitCount = attr(node, 'visitCount');
  const category = attr(node, 'category');
  const note = attr(node, 'note');
  const link = mapUrl(address, lat, lon);
  const related = (relatedNodes || []).filter((n) => n.id !== node.id).slice(0, 4);

  return (
    <div className="nesio-type-section">
      {category && (
        <div className="nesio-type-badge-row">
          <span className="nesio-type-category-pill">
            {PLACE_CATEGORIES[category] || category}
          </span>
        </div>
      )}
      {address && (
        <div className="nesio-node-attr-row">
          <span className="nesio-node-attr-key">地址</span>
          {link
            ? <a href={link} target="_blank" rel="noopener noreferrer" className="nesio-node-attr-val nesio-node-attr-link">{address} 🗺</a>
            : <span className="nesio-node-attr-val">{address}</span>
          }
        </div>
      )}
      {(lat && lon && !address) && (
        <div style={{ marginTop: '0.5rem' }}>
          <a href={mapUrl('', lat, lon)} target="_blank" rel="noopener noreferrer" className="nesio-type-action-btn">
            🗺 在地图中查看
          </a>
        </div>
      )}
      <InfoRow label="来访次数" value={visitCount ? `${visitCount} 次` : ''} />
      <InfoRow label="备注" value={note} />
      {related.length > 0 && (
        <div className="nesio-type-related-events">
          <p className="nesio-settings-section-label" style={{ marginTop: '0.75rem' }}>关联记忆</p>
          {related.map((r) => (
            <button key={r.id} type="button" className="nesio-related-node-chip" onClick={() => onOpenNode?.(r)}>
              <span className="nesio-related-node-icon" style={{ background: TYPE_BG_DETAIL[r.type] || 'var(--portal-accent-soft)' }}>
                {TYPE_ICON_DETAIL[r.type] || '📌'}
              </span>
              <span className="nesio-related-node-name">{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EventSection({ node, relatedNodes, onOpenNode }: {
  node: LifeNode;
  relatedNodes?: LifeNode[];
  onOpenNode?: (n: LifeNode) => void;
}) {
  const start = attr(node, 'start', 'date', 'datetime');
  const end = attr(node, 'end');
  const location = attr(node, 'location');
  const participants = attr(node, 'participants');
  const url = attr(node, 'url', 'htmlLink');
  const note = attr(node, 'note');
  const lat = attr(node, 'lat');
  const lon = attr(node, 'lon');
  const mapLink = mapUrl(location, lat, lon);
  const isMeeting = url && isMeetingUrl(url);
  const related = (relatedNodes || []).filter((n) => n.id !== node.id).slice(0, 4);

  return (
    <div className="nesio-type-section">
      {start && (
        <div className="nesio-type-event-time">
          <span className="nesio-type-event-time-icon">🕐</span>
          <span>{fmtDateTime(start)}{end ? ` — ${fmtDateTime(end)}` : ''}</span>
        </div>
      )}
      {location && (
        <div className="nesio-node-attr-row">
          <span className="nesio-node-attr-key">地点</span>
          {mapLink
            ? <a href={mapLink} target="_blank" rel="noopener noreferrer" className="nesio-node-attr-val nesio-node-attr-link">{location} 🗺</a>
            : <span className="nesio-node-attr-val">{location}</span>
          }
        </div>
      )}
      {participants && <InfoRow label="参与者" value={participants} />}
      {note && <InfoRow label="会议记录" value={note} />}
      {url && (
        <div style={{ marginTop: '0.75rem' }}>
          <a href={safeExternalUrl(url)} target="_blank" rel="noopener noreferrer"
            className={`nesio-type-action-btn${isMeeting ? ' nesio-type-action-btn--meeting' : ''}`}>
            {isMeeting ? '🎥 加入会议' : '🔗 直达链接'}
          </a>
        </div>
      )}
      {related.length > 0 && (
        <div className="nesio-type-related-events">
          <p className="nesio-settings-section-label" style={{ marginTop: '0.75rem' }}>关联备注</p>
          {related.map((r) => (
            <button key={r.id} type="button" className="nesio-related-node-chip" onClick={() => onOpenNode?.(r)}>
              <span className="nesio-related-node-icon" style={{ background: TYPE_BG_DETAIL[r.type] || 'var(--portal-accent-soft)' }}>
                {TYPE_ICON_DETAIL[r.type] || '📌'}
              </span>
              <span className="nesio-related-node-name">{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CommitmentSection({ node, onToggleDone }: {
  node: LifeNode;
  onToggleDone: () => void;
}) {
  const dueDate = attr(node, 'dueDate', 'deadline', 'due', 'date');
  const priority = attr(node, 'priority');
  const owner = attr(node, 'owner');
  const recurring = attr(node, 'recurring');
  const note = attr(node, 'note');
  const isDone = Boolean(node.attributes.done);
  const priorityInfo = priority ? PRIORITY_LABELS[priority] : null;

  const dueMs = dueDate ? new Date(dueDate).getTime() - Date.now() : null;
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
          {isDone ? '✓ 已完成' : '○ 待完成'}
        </button>
        {priorityInfo && (
          <span className="nesio-type-priority-badge" style={{ color: priorityInfo.color }}>
            {priorityInfo.label}
          </span>
        )}
      </div>
      {dueDate && (
        <div className={`nesio-node-attr-row${isOverdue ? ' nesio-attr-overdue' : dueSoon ? ' nesio-attr-due-soon' : ''}`}>
          <span className="nesio-node-attr-key">截止日期</span>
          <span className="nesio-node-attr-val">
            {fmtDateTime(dueDate)}
            {isOverdue && <span className="nesio-overdue-tag"> 已过期</span>}
            {dueSoon && <span className="nesio-due-soon-tag"> 今天截止</span>}
          </span>
        </div>
      )}
      <InfoRow label="对方/负责人" value={owner} />
      {recurring && <InfoRow label="重复" value={recurring} />}
      <InfoRow label="备注" value={note} />
    </div>
  );
}

function HealthSection({ node }: { node: LifeNode }) {
  const healthType = attr(node, 'healthType', 'category');
  const date = attr(node, 'date', 'start', 'datetime');
  const value = attr(node, 'value');
  const unit = attr(node, 'unit');
  const note = attr(node, 'note');
  const typeLabel = HEALTH_TYPES[healthType] || (healthType || '🩷 健康');

  return (
    <div className="nesio-type-section">
      <div className="nesio-type-badge-row">
        <span className="nesio-type-category-pill nesio-type-category-pill--health">{typeLabel}</span>
      </div>
      <InfoRow label="时间" value={fmtDateTime(date)} />
      {value && <InfoRow label="数值" value={unit ? `${value} ${unit}` : value} />}
      <InfoRow label="备注" value={note} />
    </div>
  );
}

function PreferenceSection({ node, assetUrls }: {
  node: LifeNode;
  assetUrls: Record<string, string>;
}) {
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
        <img src={previewUrl} alt={node.name} className="nesio-type-thumb" draggable={false} />
      )}
      {category && (
        <div className="nesio-type-badge-row">
          <span className="nesio-type-category-pill">{category}</span>
        </div>
      )}
      <InfoRow label="记录时间" value={fmtDate(date)} />
      <InfoRow label="备注" value={note} />
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

export default function MemoryNodeDetail({ node, onClose, relatedNodes, onOpenNode }: MemoryNodeDetailProps) {
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<EditFields>({
    name: '', location: '', price: '', purchaseDate: '', expiry: '',
    dueDate: '', priority: '', owner: '', recurring: '',
    url: '', eventLocation: '', category: '', birthday: '', note: '',
  });
  const [deleted, setDeleted] = useState(false);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});

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
      if (!asset.storagePath) continue;
      void client.fetchCloudAssetReadUrl({ storagePath: asset.storagePath })
        .then((result) => {
          if (cancelled || !result.ok || !result.signedUrl) return;
          const key = asset.id || asset.storagePath || result.storagePath || '';
          if (!key) return;
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
    if (!confirm(`确认删除「${n.name}」？`)) return;
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

  const createdDate = new Date(n.createdAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', year: 'numeric' });

  // Remaining attributes not shown in type-specific sections
  const shownAttrs = Object.entries(n.attributes).filter(
    ([k, v]) => v !== null && v !== '' && !HIDDEN_ATTR_KEYS.has(k),
  );
  const showRawInput = Boolean(n.rawInput && n.source !== 'calendar' && n.source !== 'email');
  const typeBg = TYPE_BG_DETAIL[n.type] || '#f0f4ff';

  return (
    <div className="nesio-node-detail-overlay" role="dialog" aria-modal="true" aria-label={n.name}>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label="关闭" />
      <div className="nesio-settings-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />

        {/* Type color strip */}
        <div className="nesio-type-header-strip" style={{ background: typeBg }}>
          <span className="nesio-type-header-icon">{TYPE_ICON_DETAIL[n.type] || '📌'}</span>
          <span className="nesio-type-header-label">{TYPE_LABELS[n.type] || n.type}</span>
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
            <h2 className="nesio-settings-sheet-title">{n.name}</h2>
          )}
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        {/* Expanded edit form — type-specific fields */}
        {editing && (
          <div className="nesio-edit-form">
            {n.type === 'object' && (<>
              <div className="nesio-edit-row">
                <span>存放位置</span>
                <LocationPicker value={field('location')} onChange={(v) => setField('location', v)} />
              </div>
              <label className="nesio-edit-row"><span>价格</span><input value={field('price')} onChange={(e) => setField('price', e.target.value)} placeholder="$12.99" /></label>
              <label className="nesio-edit-row"><span>购买日期</span><input type="date" value={field('purchaseDate')} onChange={(e) => setField('purchaseDate', e.target.value)} /></label>
              <label className="nesio-edit-row"><span>有效期</span><input type="date" value={field('expiry')} onChange={(e) => setField('expiry', e.target.value)} /></label>
            </>)}
            {n.type === 'commitment' && (<>
              <label className="nesio-edit-row"><span>截止日期</span><input type="date" value={field('dueDate').slice(0, 10)} onChange={(e) => setField('dueDate', e.target.value)} /></label>
              <label className="nesio-edit-row">
                <span>优先级</span>
                <select value={field('priority')} onChange={(e) => setField('priority', e.target.value)}>
                  <option value="">未设置</option>
                  <option value="high">⚠️ 紧急</option>
                  <option value="medium">⬆️ 重要</option>
                  <option value="low">↓ 普通</option>
                </select>
              </label>
              <label className="nesio-edit-row"><span>对方/负责人</span><input value={field('owner')} onChange={(e) => setField('owner', e.target.value)} placeholder="负责人姓名" /></label>
              <label className="nesio-edit-row"><span>重复</span><input value={field('recurring')} onChange={(e) => setField('recurring', e.target.value)} placeholder="每周/每月…" /></label>
            </>)}
            {n.type === 'event' && (<>
              <label className="nesio-edit-row"><span>会议链接</span><input value={field('url')} onChange={(e) => setField('url', e.target.value)} placeholder="https://zoom.us/…" /></label>
              <label className="nesio-edit-row"><span>地点</span><input value={field('eventLocation')} onChange={(e) => setField('eventLocation', e.target.value)} placeholder="地点或地址" /></label>
            </>)}
            {n.type === 'person' && (<>
              <label className="nesio-edit-row">
                <span>关系</span>
                <select value={field('category')} onChange={(e) => setField('category', e.target.value)}>
                  <option value="">未分类</option>
                  <option value="family">家人</option>
                  <option value="colleague">同事</option>
                  <option value="friend">朋友</option>
                  <option value="acquaintance">认识</option>
                </select>
              </label>
              <label className="nesio-edit-row"><span>生日</span><input type="date" value={field('birthday').slice(0, 10)} onChange={(e) => setField('birthday', e.target.value)} /></label>
            </>)}
            <label className="nesio-edit-row"><span>备注</span><input value={field('note')} onChange={(e) => setField('note', e.target.value)} placeholder="补充说明…" /></label>
          </div>
        )}

        <div className="nesio-settings-sheet-body">
          {/* Source / confidence */}
          <div className="nesio-node-meta-row">
            <span className="nesio-node-source">
              {({ manual: '手动', photo: '拍照', voice: '语音', calendar: '日历', email: '邮件', system: '系统' } as Record<string, string>)[n.source] || n.source}
            </span>
            <span className="nesio-node-confidence">
              {n.confidence >= 0.82 ? '比较确定' : n.confidence >= 0.58 ? '可能相关' : '建议确认'}
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
              <p className="nesio-settings-section-label">原始记录</p>
              <p style={{ fontSize: '0.88rem', color: 'var(--portal-muted)', fontStyle: 'italic' }}>&ldquo;{n.rawInput}&rdquo;</p>
            </div>
          )}

          {/* Remaining attributes not covered above */}
          {shownAttrs.length > 0 && (
            <>
              <p className="nesio-settings-section-label" style={{ marginTop: '0.75rem' }}>其他属性</p>
              {shownAttrs.map(([k, v]) => (
                <div key={k} className="nesio-node-attr-row">
                  <span className="nesio-node-attr-key">{k}</span>
                  <span className="nesio-node-attr-val">{String(v)}</span>
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

          {/* Assets for non-object/preference types */}
          {n.type !== 'object' && n.type !== 'preference' && (n.assets || []).length > 0 && (
            <>
              <p className="nesio-settings-section-label" style={{ marginTop: '0.75rem' }}>图片线索</p>
              <div style={{ display: 'grid', gap: '0.6rem' }}>
                {(n.assets || []).map((asset) => {
                  const key = asset.id || asset.storagePath || asset.label || 'asset';
                  const previewUrl = asset.storagePath ? assetUrls[key] : undefined;
                  const isImage = asset.kind === 'image' || asset.mimeType?.startsWith('image/');
                  return (
                    <div key={key} className="nesio-type-asset-card">
                      {isImage && previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={previewUrl} alt={asset.label || n.name} draggable={false} className="nesio-type-asset-img" />
                      ) : (
                        <p style={{ fontSize: '0.82rem', color: 'var(--portal-muted)', marginBottom: '0.35rem' }}>
                          {asset.storagePath ? '图片线索已保存，登录后可查看。' : '附件线索已保存。'}
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
          )}

          <p style={{ fontSize: '0.7rem', color: 'var(--portal-muted)', marginTop: '1rem' }}>记录于 {createdDate}</p>

          {/* Related memories (generic, for types without their own related section) */}
          {relatedNodes && relatedNodes.length > 0 && n.type !== 'person' && n.type !== 'place' && n.type !== 'event' && (
            <div className="nesio-related-section">
              <p className="nesio-settings-section-label">相关记忆</p>
              <div className="nesio-related-nodes">
                {relatedNodes.map((related) => (
                  <button key={related.id} type="button" className="nesio-related-node-chip" onClick={() => onOpenNode?.(related)}>
                    <span className="nesio-related-node-icon" style={{ background: TYPE_BG_DETAIL[related.type] || 'var(--portal-accent-soft)' }}>
                      {TYPE_ICON_DETAIL[related.type] || '📌'}
                    </span>
                    <span className="nesio-related-node-name">{related.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.25rem' }}>
            {editing ? (
              <>
                <button type="button" className="nesio-ob-primary-btn" style={{ flex: 1 }} onClick={saveEdit}>保存</button>
                <button type="button" className="nesio-today-btn nesio-today-btn--ghost" style={{ flex: 1 }} onClick={() => setEditing(false)}>取消</button>
              </>
            ) : (
              <>
                <button type="button" className="nesio-today-btn nesio-today-btn--ghost" style={{ flex: 1 }} onClick={startEdit}>编辑</button>
                <button type="button" className="nesio-settings-danger-btn" style={{ flex: 1, marginTop: 0 }} onClick={handleDelete}>删除</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
