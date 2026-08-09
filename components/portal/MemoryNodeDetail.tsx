'use client';

import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { deleteLifeNode, getLifeGraph, linkNodes, searchLifeGraphFuzzy, unlinkNodes, updateLifeNode, type LifeNode, type LifeNodeAsset } from '@/lib/portal/life-graph';
import { displayStoredLocation } from '@/lib/portal/named-places';
import type { LocationMeta } from './LocationPicker';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import { makeAssetErrorHandler } from '@/lib/portal/signed-asset-url';
import LocationPicker from './LocationPicker';
import EmailComposeSheet from './EmailComposeSheet';
import { IconClock, IconLink, NodeTypeIcon, WeatherIcon, IconMail, IconCalendar, IconCamera, IconMic, IconNote, IconMapPin, IconFlag, IconCheckSquare, IconFile, IconBookmark } from './icons';
import { isTopicTag } from '@/lib/portal/topic-tags';
import {
  addCustomMemoryTag,
  isCustomMemoryTag,
  loadCustomMemoryTags,
  MEMORY_CUSTOM_TAGS_EVENT,
} from '@/lib/portal/memory-custom-tags';
import { memoryEventAt } from '@/lib/portal/memory-event-at';
// #18:「地点」字段里塞的是会议链接 —— 一条 URL 不是一个地方
import { splitEventLocation, shortUrlLabel } from '@/lib/portal/meeting-location';
import { L } from '@/lib/portal/i18n';
import { relativePastLabel } from '@/lib/portal/time-labels';
import { displayNodeName, stripMarkdownInline } from '@/lib/portal/node-display';
import dynamicImport from 'next/dynamic';
const ReaderSheetLazy = dynamicImport(() => import('./ArticleReaderSheet'), { ssr: false });
const PlacePickerLazy = dynamicImport(() => import('./PlacePickerSheet'), { ssr: false });
const AssignChoreLazy = dynamicImport(() => import('./family/AssignChoreButton'), { ssr: false });
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import NesioSheet from './ui/NesioSheet';
import { isLensEligible } from '@/lib/portal/lens-eligible';
import Button from './ui/Button';
import MemoryLensSheet from './MemoryLensSheet';
import { shouldNudge } from '@/lib/portal/lens';
// 2026-08-01 改名批:object→Thing / commitment→task / health_state+preference→Mind(合并,
// 取 health_state 原色)/ note→collection。collection 之前一直没有专属色(遗留 bug),借这次改名
// 把 preference 空出来的 chip-mint 补给它。
const TYPE_BG_DETAIL: Record<string, string> = {
  person: 'var(--chip-indigo)', Thing: 'var(--chip-blue)', place: 'var(--chip-green)',
  event: 'var(--chip-amber)', task: 'var(--chip-violet)', Mind: 'var(--chip-pink)', collection: 'var(--chip-mint)',
};

interface MemoryNodeDetailProps {
  node: LifeNode | null;
  onClose: () => void;
  relatedNodes?: LifeNode[];
  onOpenNode?: (node: LifeNode) => void;
  /**
   * 从 fullscreen 面板(洞察)内部打开时传 true —— 否则这张 bottom 卡(z-901)会被
   * 洞察面板(z-930)整个盖住,表现成「点了没反应」(见 NesioSheet 的 elevated 注释)。
   * 默认 false:从记忆页/今天页打开时,它自己要能被内部的全屏阅读器盖住。
   */
  elevated?: boolean;
}

const TYPE_LABELS_ZH: Record<string, string> = {
  person: '人物', Thing: '物品', place: '地点', event: '事件',
  task: '待办', Mind: '心念', collection: '笔记',
};
const TYPE_LABELS_EN: Record<string, string> = {
  person: 'Person', Thing: 'Item', place: 'Place', event: 'Event',
  task: 'Task', Mind: 'Mind', collection: 'Note',
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

/** 已知属性键 → 中文标签(天气信号等系统属性不再裸奔英文键名)
 *  2026-08-01 扩容:银行流水影子节点(tx-node.ts)、会议记录抽取(today-commands.ts)
 *  落的这些键此前不在名单里 —— 不隐藏(不是纯技术字段,是流水/会议真值),
 *  但没标签就裸奔成 txAmount/merchantId 这类英文键名,一并补齐。 */
const ATTR_KEY_LABELS: Record<string, string> = {
  temperatureC: '温度', condition: '天气', forecastNote: '预报',
  placeName: '地点', humidity: '湿度', windKph: '风速',
  // 邮件本地深抽取(Phase 2)的结构化线索
  amount: '金额', orderNo: '订单号', trackingNo: '快递单号',
  // 银行流水影子节点(tx-node.ts)
  txAmount: '金额', txCurrency: '币种', txCategory: '分类', merchantId: '商户', accountId: '账户',
  // 会议记录抽取(today-commands.ts writeMeetingExtraction)
  summary: '摘要', people: '涉及人物',
};
const ATTR_KEY_LABELS_EN: Record<string, string> = {
  temperatureC: 'Temperature', condition: 'Weather', forecastNote: 'Forecast',
  placeName: 'Place', humidity: 'Humidity', windKph: 'Wind',
  amount: 'Amount', orderNo: 'Order #', trackingNo: 'Tracking #',
  txAmount: 'Amount', txCurrency: 'Currency', txCategory: 'Category', merchantId: 'Merchant', accountId: 'Account',
  summary: 'Summary', people: 'People',
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
        style={{ marginLeft: 6, fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--portal-blue-deep)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
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
  // CARD SPEC:原始邮件头不污染卡片 —— from(「"U.S. Bank Alerts" <usbank@…>」)、
  // 邮件分类、snippet 属技术字段,藏进「原始记录·邮件原文」折叠区,不当属性平铺。
  'from', 'mailCategory', 'snippet',
  // 批次 150(QA #9):日历/外部集成内部 ID 与技术字段,绝不该露给终端用户
  'externalId', 'iCalUID', 'recurringEventId', 'sequence', 'etag', 'organizer', 'creator',
  'notionPageId', 'sourceApp', 'source', 'dayOfWeek', 'aiConfidence',
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
  // 2026-08-01 用户点名:updatedAt 裸露成 "updatedAt 2026-08-01T16:12:12.951Z"(原始 UTC
  // ISO 串,没经过 fmtDateTime 本地化,看着像时区错了)——本该跟 occurredAt/capturedAt
  // 一样是内部记账字段,当年加那两个的时候漏了这个,补上同样隐藏(不是给用户看的字段)。
  'occuredAt', 'occurredAt', 'capturedAt', 'updatedAt', 'retentionPolicy', 'sensitivity',
  'sourceNodeId', 'schemaVersion',
  // 认知谱系内部字段(QA:详情页露出「epistemic: observation」「generator: manual」)
  'epistemic', 'generator', 'provenance', 'confidence',
  // Type-specific (handled in sections)
  'note', 'price', 'purchaseDate', 'expiry', 'store', 'merchant', 'subtype', 'paymentMethod',
  // 电商/物流事件:预计到货由 EventSection 单独渲染,不在通用属性区重复
  'eta', 'expectedDelivery', 'deliveryDate',
  'visitCount', 'category', 'lastSeen', 'birthday',
  'start', 'end', 'date', 'dueDate', 'deadline',
  'priority', 'owner', 'recurring', 'participants',
  'url', 'healthType', 'unit', 'value', 'receiptDate',
  // Moment capture internals (emotion shown via its own section, not raw keys)
  'emotion', 'emotionLabel', 'emotionEmoji', 'emotionQuadrant',
  'energyValue', 'energyLevel', 'recordedAt', 'hourOfDay',
  'isWorkHours', 'isEvening', 'isMorning', 'isJournal', 'journalText',
  'article', 'image',
  // 2026-08-01:银行流水影子节点(tx-node.ts)/会议记录抽取(today-commands.ts)/
  // 多面镜存信(mirror-letter-persist.ts)的纯技术字段 —— 不是用户会想看的值,
  // 真内容已经在各自的专属展示位(流水金额见下方 ATTR_KEY_LABELS,会议正文见
  // CollapsibleText rawInput,信正文同理),这些只是内部关联/去重用的键。
  'txShadow', 'txId', 'kind', 'mirrorId', 'meetingNodeId', 'meetingRecordId',
  'calendarNodeId', 'calendarName', 'granolaMeetingId', 'fromMeeting', 'focusPinnedOn',
  'inferredJson', 'notes', 'recordedAt', 'derivedFrom',
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
      {/* 批次 142·详情页统一(image 1):分类不再用彩色 pill,统一成 关键信息 里的 label→值 行 */}
      <InfoRow label={L(dict, '关系', 'Relationship')} value={category ? ((dict === 'en' ? PERSON_CATEGORIES_EN : PERSON_CATEGORIES)[category] || category) : ''} />
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
  // 批次192:优先用稳定 placeId 解析成当前命名地点名(改名自动传导),否则回退存的字符串/room。
  const location = displayStoredLocation(node.attributes) || attr(node, 'location', 'room');
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
        <div style={{ marginTop: 'var(--space-3)' }}>
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
      <InfoRow label={L(dict, '分类', 'Type')} value={category ? ((dict === 'en' ? PLACE_CATEGORIES_EN : PLACE_CATEGORIES)[category] || category) : ''} />
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
        <div style={{ marginTop: 'var(--space-2)' }}>
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
        <div className="nesio-node-attr-row">
          {/* 批次 144:事件时间统一成「时间 → 值」行(钟图标随值,和别类关键信息一致) */}
          <span className="nesio-node-attr-key">{L(dict, '时间', 'Time')}</span>
          <span className="nesio-node-attr-val" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <IconClock size={13} />{fmtDateTime(start, dict)}{end ? ` — ${fmtDateTime(end, dict)}` : ''}
          </span>
        </div>
      )}
      {location && (() => {
        /* #18:Google 日历里 Zoom / Teams / Meet 是把**会议链接**写进 location 字段的
           (它们那边就这么设计)。一条 URL 不是一个地方,原样挂在「地点」下面语义不对。
           上一版只认「整段 location 就是一条 URL」,而现实里常见的是
           `Zoom Meeting https://…`、`https://… (Room 3)` 这种混着写的 —— 全漏了。
           现在把 URL 摘出来,剩下的文字才是地点:两样都在就分成两行,各说各的。 */
        const { place, meetingUrl, knownMeeting } = splitEventLocation(location);
        return (
          <>
            {place && (
              <div className="nesio-node-attr-row">
                <span className="nesio-node-attr-key">{L(dict, '地点', 'Location')}</span>
                {mapLink
                  ? <a href={mapLink} target="_blank" rel="noopener noreferrer" className="nesio-node-attr-val nesio-node-attr-link">{place}</a>
                  : <span className="nesio-node-attr-val">{place}</span>}
              </div>
            )}
            {meetingUrl && (
              <div className="nesio-node-attr-row">
                <span className="nesio-node-attr-key">
                  {knownMeeting ? L(dict, '会议链接', 'Meeting link') : L(dict, '链接', 'Link')}
                </span>
                <a href={safeExternalUrl(meetingUrl)} target="_blank" rel="noopener noreferrer" className="nesio-node-attr-val nesio-node-attr-link">
                  {shortUrlLabel(meetingUrl)}
                </a>
              </div>
            )}
          </>
        );
      })()}
      {participants && <InfoRow label={L(dict, '参与者', 'People')} value={participants} />}
      {/* CARD SPEC 关键信息:电商/物流类邮件事件的语义键值行(商家/类型/预计到货) */}
      <InfoRow label={L(dict, '商家', 'Merchant')} value={attr(node, 'store', 'merchant')} />
      <InfoRow label={L(dict, '类型', 'Kind')} value={attr(node, 'subtype')} />
      <InfoRow label={L(dict, '预计到货', 'ETA')} value={attr(node, 'eta', 'expectedDelivery', 'deliveryDate')} />
      {note && (
        <div className="nesio-node-attr-row">
          <span className="nesio-node-attr-key">{L(dict, '会议记录', 'Meeting notes')}</span>
          <CollapsibleText text={note} />
        </div>
      )}
      {url && (
        <div style={{ marginTop: 'var(--space-3)' }}>
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
  // 批次188(用户问「同一个 list 能重复用吗」):清单本是就地勾选、勾了长存 —— 打包/采购这类
  // 周期清单没法复用。加「全部重置」:一键清空所有勾,同一条清单下次旅行/采购直接重用。
  function resetCheckItems() {
    const next = checkItems.map((it) => ({ ...it, done: false }));
    setCheckItems(next);
    updateLifeNode(node.id, { attributes: { ...node.attributes, subtasksJson: JSON.stringify(next) } });
  }
  const checkDoneCount = checkItems.filter((it) => it.done).length;

  return (
    <div className="nesio-type-section">
      {checkItems.length > 0 && (
        <>
          <div className="nesio-check-head">
            <span className="nesio-check-progress">{L(dict, `已勾 ${checkDoneCount}/${checkItems.length}`, `${checkDoneCount}/${checkItems.length} done`)}</span>
            {checkDoneCount > 0 && (
              <button type="button" className="nesio-check-reset" onClick={resetCheckItems}>
                {L(dict, '全部重置', 'Reset all')}
              </button>
            )}
          </div>
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
        </>
      )}
      {/* 批次 144:完成 toggle 是关键交互,保留;优先级从并排 badge 收进「优先级 → 值」统一行 */}
      <div className="nesio-commitment-status-row">
        <button
          type="button"
          className={`nesio-commitment-toggle${isDone ? ' nesio-commitment-toggle--done' : ''}`}
          onClick={onToggleDone}
        >
          {isDone ? L(dict, '✓ 已完成', '✓ Done') : L(dict, '○ 待完成', '○ To do')}
        </button>
      </div>
      {priorityInfo && (
        <div className="nesio-node-attr-row">
          <span className="nesio-node-attr-key">{L(dict, '优先级', 'Priority')}</span>
          <span className="nesio-node-attr-val" style={{ color: priorityInfo.color, fontWeight: 700 }}>
            {L(dict, priorityInfo.label, priorityInfo.labelEn)}
          </span>
        </div>
      )}
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

// 2026-08-01 改名批:Mind 合并了旧 health_state + preference —— 两个 Section 合一,
// 内部按"有没有健康类字段(healthType/value/unit)"分支渲染,不新增字段,
// 只是把原来两条互斥的 n.type 分支改成同一 type 下的属性判断。
function MindSection({ node, assetUrls }: {
  node: LifeNode;
  assetUrls: Record<string, string>;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const healthType = attr(node, 'healthType');
  const value = attr(node, 'value');
  const unit = attr(node, 'unit');
  const isHealthLike = Boolean(healthType || value);
  const note = attr(node, 'note');

  if (isHealthLike) {
    const date = attr(node, 'date', 'start', 'datetime');
    const typeLabel = (dict === 'en' ? HEALTH_TYPES_EN : HEALTH_TYPES)[healthType] || (healthType || L(dict, '健康', 'Health'));
    return (
      <div className="nesio-type-section">
        <InfoRow label={L(dict, '类型', 'Type')} value={typeLabel} />
        <InfoRow label={L(dict, '时间', 'Time')} value={fmtDateTime(date, dict)} />
        {value && <InfoRow label={L(dict, '数值', 'Value')} value={unit ? `${value} ${unit}` : value} />}
        <InfoRow label={L(dict, '备注', 'Note')} value={note} />
      </div>
    );
  }

  const category = attr(node, 'category');
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
      <InfoRow label={L(dict, '分类', 'Type')} value={category} />
      <InfoRow label={L(dict, '记录时间', 'Noted on')} value={fmtDate(date, dict)} />
      <InfoRow label={L(dict, '备注', 'Note')} value={note} />
    </div>
  );
}

// 批次 143:note = 外部笔记/文章/收藏(Notion/Flomo/公众号…)。统一格式:关键信息最小几行,
// 正文走详情已有的「阅读原文 / 原始记录」。preference 不再当笔记垃圾桶。
function NoteSection({ node }: { node: LifeNode }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const sourceApp = attr(node, 'sourceApp', 'source');
  const category = attr(node, 'category');
  const date = attr(node, 'date');
  const url = attr(node, 'url');
  // 2026-08-01:手记补填的截止日期(见编辑面板),同 CommitmentSection 一样标一下过期。
  const dueDate = attr(node, 'dueDate');
  const dueParsed = dueDate ? parseLocalDate(dueDate) : null;
  const isOverdue = dueParsed !== null && dueParsed.getTime() - Date.now() < 0 && !node.attributes.done;
  return (
    <div className="nesio-type-section">
      <InfoRow label={L(dict, '来源应用', 'From app')} value={sourceApp} />
      <InfoRow label={L(dict, '分类', 'Type')} value={category} />
      <InfoRow label={L(dict, '记录时间', 'Noted on')} value={fmtDate(date, dict)} />
      {dueDate && (
        <div className={`nesio-node-attr-row${isOverdue ? ' nesio-attr-overdue' : ''}`}>
          <span className="nesio-node-attr-key">{L(dict, '截止日期', 'Due')}</span>
          <span className="nesio-node-attr-val">
            {fmtDateTime(dueDate, dict)}
            {isOverdue && <span className="nesio-overdue-tag"> {L(dict, '已过期', 'overdue')}</span>}
          </span>
        </div>
      )}
      {url && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <a href={safeExternalUrl(url)} target="_blank" rel="noopener noreferrer" className="nesio-type-action-btn">
            <IconLink size={13} /> {L(dict, '打开原文', 'Open source')}
          </a>
        </div>
      )}
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
  detail: string;
}

// ── Graph helpers ─────────────────────────────────────────────────────────────

// 批次 76(用户实锤「点关联记忆进入页面错误」):详情崩溃只崩这张卡,
// 不再把整页打成错误页 —— 卡片级边界,给出关闭出口。
class DetailErrorBoundary extends Component<{ onClose: () => void; dict: string; children: ReactNode }, { err: boolean; msg: string }> {
  state = { err: false, msg: '' };
  static getDerivedStateFromError(e: unknown) {
    return { err: true, msg: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
  // 批次 162:捕获真实错误文案,反复闪退时用户能复制发回来定根因(此前只显示通用文案,没法定位)。
  componentDidCatch(error: unknown) { console.error('[MemoryNodeDetail] crashed:', error); }
  render() {
    if (this.state.err) {
      return (
        <div className="nesio-node-detail-overlay" role="dialog" aria-modal="true" onClick={this.props.onClose}>
          <div className="nesio-node-detail-sheet" style={{ padding: 'var(--space-6) var(--space-5)', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-body)', fontWeight: 600 }}>{L(this.props.dict, '这条记忆的详情没打开成功', "This memory's details didn't open")}</p>
            <p style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--portal-muted)' }}>{L(this.props.dict, '数据没有丢。关闭后再试一次。若反复出现,把下面这行错误复制发回来就能定位。', 'Your data is safe. Close and try again. If it keeps happening, copy the error line below and send it to us so we can pinpoint it.')}</p>
            {this.state.msg && (
              <p style={{
                fontSize: 'var(--text-xs)', color: 'var(--status-risk, #c0392b)', margin: '0 auto 0.8rem', maxWidth: 300,
                padding: '8px 10px', borderRadius: 'var(--radius-xs)', textAlign: 'left', wordBreak: 'break-all', userSelect: 'text',
                background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.25)',
              }}>{this.state.msg.slice(0, 200)}</p>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center' }}>
              {this.state.msg && (
                <button type="button" className="nesio-connector-disconnect" onClick={() => { try { navigator.clipboard?.writeText(this.state.msg); } catch { /* 手抄 */ } }}>{L(this.props.dict, '复制错误', 'Copy error')}</button>
              )}
              <button type="button" className="nesio-fin-review-accept" onClick={this.props.onClose}>{L(this.props.dict, '关闭', 'Close')}</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function MemoryNodeDetail(props: MemoryNodeDetailProps) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  return (
    <DetailErrorBoundary key={props.node?.id ?? 'none'} onClose={props.onClose} dict={dict}>
      <MemoryNodeDetailInner {...props} />
    </DetailErrorBoundary>
  );
}

function MemoryNodeDetailInner({ node, onClose, relatedNodes, onOpenNode, elevated }: MemoryNodeDetailProps) {
  // 批次 73:关联链手动管理(增/删即反馈)
  const [removedRels, setRemovedRels] = useState<Set<string>>(new Set());
  const [addedRels, setAddedRels] = useState<Array<{ targetId: string; relation: string }>>([]);
  const [linkPicking, setLinkPicking] = useState(false);
  const [linkQuery, setLinkQuery] = useState('');
  const [linkError, setLinkError] = useState(''); // 批次 94:关联出错时可见,便于用户截图反馈
  const [linkCandidates, setLinkCandidates] = useState<LifeNode[]>([]);
  const [lensOpen, setLensOpen] = useState(false);        // 镜头看记忆(底部弹层)
  const [nudgeDismissed, setNudgeDismissed] = useState(false); // 情绪重记忆的主动提示已划走
  const [rawExpanded, setRawExpanded] = useState(false); // 批次 74:原始记录折叠
  const [otherAttrsExpanded, setOtherAttrsExpanded] = useState(false); // 2026-08-01:其他属性默认折叠,别让生 key 抢眼
  const [customTagsList, setCustomTagsList] = useState<string[]>(() => loadCustomMemoryTags());
  const [newTagInput, setNewTagInput] = useState('');
  const [nodeTags, setNodeTags] = useState<string[]>(() => node?.tags ?? []);
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  // 批次 172(关联记忆闪退根治):搜索移出渲染热路径 —— 去抖异步跑,不再每次按键同步搜全图
  // (516 节点 + 中文 2-gram 同步搜会卡死主线程 → iOS 看门狗杀 webview = 用户实锤「一打字就闪退」)。
  useEffect(() => { setNodeTags(node?.tags ?? []); }, [node?.id, node?.tags]);
  useEffect(() => {
    const syncTags = () => setCustomTagsList(loadCustomMemoryTags());
    window.addEventListener(MEMORY_CUSTOM_TAGS_EVENT, syncTags);
    return () => window.removeEventListener(MEMORY_CUSTOM_TAGS_EVENT, syncTags);
  }, []);
  useEffect(() => {
    if (!linkPicking || linkQuery.trim().length < 1) { setLinkCandidates([]); return; }
    const q = linkQuery.trim();
    const h = setTimeout(() => {
      try { setLinkCandidates(searchLifeGraphFuzzy(q, 6).filter((x) => x.id !== node?.id)); }
      catch { setLinkCandidates([]); }
    }, 220);
    return () => clearTimeout(h);
  }, [linkQuery, linkPicking, node?.id]);
  const [editing, setEditing] = useState(false);
  // 批次192:编辑存放位置时,从 LocationPicker 捕获稳定 placeId/room/subRoom(存入时写节点/清空)。
  const [editPlaceMeta, setEditPlaceMeta] = useState<LocationMeta | null>(null);
  const [fields, setFields] = useState<EditFields>({
    name: '', location: '', price: '', purchaseDate: '', expiry: '',
    dueDate: '', priority: '', owner: '', recurring: '',
    url: '', eventLocation: '', category: '', birthday: '', note: '', detail: '',
  });
  const [deleted, setDeleted] = useState(false);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  // 批次 23:全屏看图 + 问一问这张图
  const [viewImage, setViewImage] = useState<{ url: string; name: string } | null>(null);
  // 批次 24:文章阅读器(节点有 article 时)
  const [readerOpen, setReaderOpen] = useState(false);
  // 批次 36:在 Nesio 内回复邮件
  const [composeOpen, setComposeOpen] = useState(false);
  // 邮件全链路 Phase 1:邮件全文存本机 IndexedDB(不上云),阅读原文按 emailId 取。
  const [emailFullBody, setEmailFullBody] = useState('');
  // 用户需求:在记忆详情里补传本地照片进这条记忆
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [photoErr, setPhotoErr] = useState('');
  /** 加完照片后端上认字的结果。不是错误态 —— 照片已经加好了,这只是「顺手还做了什么」。 */
  const [scanHint, setScanHint] = useState('');
  const [addedThumbs, setAddedThumbs] = useState<string[]>([]);
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
  // 邮件全链路 Phase 1:邮件节点按 emailId 从本机 IndexedDB 取全文,供「阅读原文」。
  useEffect(() => {
    setEmailFullBody('');
    const eid = node?.source === 'email' && typeof node.attributes?.emailId === 'string' ? node.attributes.emailId : '';
    if (!eid) return;
    let cancelled = false;
    void import('@/lib/portal/local-email-body').then(({ getEmailBody }) =>
      getEmailBody(eid).then((body) => { if (!cancelled && body) setEmailFullBody(body); }),
    ).catch(() => {});
    return () => { cancelled = true; };
  }, [node]);

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
      // 批次 23:本机图优先从 IndexedDB 读(未登录/离线也能看)。
      // 换端时 asset.local=true 但 IDB 空 —— 以前 continue 掉、又不读云孪生 →
      // 记忆详情英雄图空白(衣帽间用 resolveAssetDisplayUrl 能看见,总库看不见)。
      if (asset.local) {
        void import('@/lib/portal/local-image-store').then(({ getLocalImage }) =>
          getLocalImage(asset.id).then(async (dataUrl) => {
            if (cancelled) return;
            if (dataUrl) { setAssetUrls((cur) => ({ ...cur, [key]: dataUrl })); return; }
            const cloudPath = asset.storagePath
              || assets.find((a) => a.storagePath && (a.kind === 'image' || a.mimeType?.startsWith('image/')))?.storagePath;
            if (!cloudPath) return;
            try {
              const result = await client.fetchCloudAssetReadUrl({ storagePath: cloudPath });
              if (cancelled || !result.ok || !result.signedUrl) return;
              setAssetUrls((cur) => ({ ...cur, [key]: result.signedUrl || '' }));
            } catch { /* ignore */ }
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

  function toggleCustomTag(tag: string) {
    const next = nodeTags.includes(tag)
      ? nodeTags.filter((t) => t !== tag)
      : [...nodeTags, tag];
    setNodeTags(next);
    updateLifeNode(n.id, { tags: next });
  }

  function commitNewCustomTag() {
    const trimmed = newTagInput.trim();
    if (!trimmed) return;
    addCustomMemoryTag(trimmed);
    setCustomTagsList(loadCustomMemoryTags());
    const next = nodeTags.includes(trimmed) ? nodeTags : [...nodeTags, trimmed];
    setNodeTags(next);
    updateLifeNode(n.id, { tags: next });
    setNewTagInput('');
  }

  function startEdit() {
    setFields({
      name: n.name,
      location: attr(n, 'location', 'room'),
      price: attr(n, 'price'),
      purchaseDate: attr(n, 'purchaseDate'),
      expiry: attr(n, 'expiry'),
      // 手记只认真正写过的 dueDate —— 不能带 'date' 这个后备键,那是"记录时间"
      // (何时随手记下的),把它当截止日期回填会在下次保存时把记录时间错写成截止日期。
      dueDate: n.type === 'collection' ? attr(n, 'dueDate') : attr(n, 'dueDate', 'deadline', 'due', 'date'),
      priority: attr(n, 'priority'),
      owner: attr(n, 'owner'),
      recurring: attr(n, 'recurring'),
      url: attr(n, 'url', 'htmlLink'),
      eventLocation: attr(n, 'location'),
      category: attr(n, 'category'),
      birthday: attr(n, 'birthday'),
      note: attr(n, 'note'),
      detail: n.rawInput || attr(n, 'detail', 'body', 'description'),
    });
    setEditing(true);
  }
  function saveEdit() {
    if (!fields.name.trim()) return;
    const extra: Record<string, string | null> = {};
    if (n.type === 'Thing') {
      if (fields.location !== attr(n, 'location', 'room')) {
        extra.location = fields.location || null;
        // 批次192:位置一改就同步 placeId(选了命名地点就存,自由文本/清空则删)—— 避免残留旧 placeId 显示错名。
        extra.placeId = editPlaceMeta?.placeId || null;
        extra.placeRoom = editPlaceMeta?.room || null;
        extra.placeSubRoom = editPlaceMeta?.subRoom || null;
      }
      if (fields.price !== attr(n, 'price')) extra.price = fields.price || null;
      if (fields.purchaseDate !== attr(n, 'purchaseDate')) extra.purchaseDate = fields.purchaseDate || null;
      if (fields.expiry !== attr(n, 'expiry')) extra.expiry = fields.expiry || null;
    }
    if (n.type === 'task') {
      if (fields.dueDate !== attr(n, 'dueDate', 'deadline')) extra.dueDate = fields.dueDate || null;
      if (fields.priority !== attr(n, 'priority')) extra.priority = fields.priority || null;
      if (fields.owner !== attr(n, 'owner')) extra.owner = fields.owner || null;
      if (fields.recurring !== attr(n, 'recurring')) extra.recurring = fields.recurring || null;
    }
    // 截止日期这个框,填了也存不进去 —— 日程页因此永远看不到它。手记只开放这一个字段
    // (优先级/负责人/循环那些是"任务"专属概念,套到随手记的一条笔记上不成立)。
    if (n.type === 'collection') {
      if (fields.dueDate !== attr(n, 'dueDate')) extra.dueDate = fields.dueDate || null;
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
    const detailChanged = n.type === 'task'
      && fields.detail.trim() !== (n.rawInput || attr(n, 'detail', 'body', 'description') || '').trim();
    updateLifeNode(n.id, {
      name: fields.name.trim(),
      attributes: newAttrs,
      ...(detailChanged ? { rawInput: fields.detail.trim() } : {}),
    });
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
  // 补传本地照片进这条记忆:压缩存 IndexedDB → 追加 node.assets(本机,不上传)。
  // 失败必须可见(设计红线:每个 async 动作要有显式失败态)。
  async function addPhotos(files: FileList | null) {
    const list = Array.from(files || []).filter((f) => f.type.startsWith('image/')).slice(0, 30);
    if (!list.length) return;
    setAddingPhoto(true);
    setPhotoErr('');
    try {
      const { compressToDataUrl, putLocalImage } = await import('@/lib/portal/local-image-store');
      const added: LifeNodeAsset[] = [];
      const thumbs: string[] = [];
      for (let i = 0; i < list.length; i++) {
        const dataUrl = await compressToDataUrl(list[i], 1400, 0.82);
        const id = `local-${n.id}-${Date.now()}-${i}`;
        await putLocalImage(id, dataUrl);
        added.push({ id, kind: 'image', local: true, mimeType: 'image/jpeg', createdAt: new Date().toISOString() });
        thumbs.push(dataUrl);
      }
      const live = getLifeGraph().find((x) => x.id === n.id);
      const nextAssets = [...(live?.assets || n.assets || []), ...added];
      const ok = updateLifeNode(n.id, { assets: nextAssets });
      if (!ok) throw new Error('updateLifeNode returned false');
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
      setAddedThumbs((p) => [...p, ...thumbs]);

      // 存好了再认字(2026-07-31)。以前到上一行就结束了 —— 图挂进这条记忆,
      // 上面写的字一个都搜不到。认字在这台设备上做,图不出手机;
      // 名字不动(keepName)——这条记忆已经有名字了,是用户的,不该被一张附图改掉。
      const { attachImageUnderstanding } = await import('@/lib/portal/image-understand');
      const seen = await attachImageUnderstanding(n.id, list, { keepName: true });
      if (seen?.text.trim()) {
        setPhotoErr('');
        setScanHint(L(dict, '照片上的字也记下了 —— 现在搜得到。', 'Text in the photos was read too — it\'s searchable now.'));
      } else if (seen?.visionMessage) {
        // 「这台设备认不了字」不是错误,是这条路今天走不通。照片已经加好了。
        setScanHint(seen.visionMessage);
      }
    } catch {
      setPhotoErr(L(dict, '照片没加成功,请再试一次', 'Could not add the photos — try again'));
    } finally {
      setAddingPhoto(false);
    }
  }

  // 标签三层 §3.3:「记录于 2026年7月9日」→ 相对时间(今天 12:34 / 昨天 / N 天前)
  const createdDate = (() => {
    const created = memoryEventAt(n);
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
  // CARD SPEC:邮件也进「原始记录·邮件原文」折叠区(原始 from 头藏这里,不污染卡片)。
  const showRawInput = Boolean(n.rawInput && n.source !== 'calendar');
  const typeBg = TYPE_BG_DETAIL[n.type] || 'var(--chip-fog)';

  // 批次 27:阅读入口不再只认 article —— 老邮件节点没存 article,退到 summary/snippet/正文,
  // 只要有一段够长的正文(>40 字)就给「阅读」按钮,进瀑布流阅读器。
  const readableAttrs = n.attributes as Record<string, unknown>;
  // 邮件全文优先(本机 IndexedDB,Phase 1);没有再退到节点里存的短预览/摘要。
  const readableText = (emailFullBody && emailFullBody.trim().length > 40 ? emailFullBody : undefined)
    ?? [readableAttrs.article, readableAttrs.summary, readableAttrs.snippet, readableAttrs.body, n.rawInput]
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
      // 2026-08-01 用户点名:「来自 邮件 · Gmail · 8.1 10:56」——provider 和后面的时间戳
      // 挤在一行里反而重复(时间已经单独有一行「时间」字段),连接器名对用户没有增量信息,
      // 「来自 邮件」就够了。
      case 'email': return { icon: <IconMail size={sz} />, label: L(dict, '邮件', 'Email'), provider: '' };
      case 'calendar': return { icon: <IconCalendar size={sz} />, label: L(dict, '日历', 'Calendar'), provider: L(dict, 'Google 日历', 'Google Calendar') };
      case 'photo': return { icon: <IconCamera size={sz} />, label: L(dict, '拍照', 'Photo'), provider: '' };
      case 'voice': return { icon: <IconMic size={sz} />, label: L(dict, '语音', 'Voice'), provider: '' };
      case 'system': return { icon: <IconNote size={sz} />, label: L(dict, '系统', 'System'), provider: '' };
      default: return { icon: <IconNote size={sz} />, label: L(dict, '手记', 'Note'), provider: '' };
    }
  })();
  const srcTime = (() => {
    const d = memoryEventAt(n);
    if (isNaN(d.getTime())) return '';
    return `${d.getMonth() + 1}·${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  })();
  const srcUncertain = n.confidence > 0 && n.confidence < 0.6;

  // 阅读器多功能版元信息:头部来源+日期、标签(去系统标)。cover/相关记忆 交给有数据的调用方。
  const readerMeta = {
    kicker: [SRC.label, srcTime].filter(Boolean).join(' · '),
    subtitle: SRC.provider || undefined,
    tags: (n.tags || []).filter((t) => !['notion', 'keep', 'moment', 'journal', 'feeling', '手动记录', '联系人'].includes(t)).slice(0, 5),
  };

  return (
    <>
      {readerOpen && readableText && (
        <ReaderSheetLazy title={n.name} article={readableText} meta={readerMeta} onClose={() => setReaderOpen(false)} />
      )}
      {/* Reader 与 EmailCompose 都是 NesioSheet,自带 portal + 自管 pointer-events,直接渲染即可。 */}
      {isEmailNode && composeOpen && (
        <EmailComposeSheet
          open={composeOpen}
          onClose={() => setComposeOpen(false)}
          context={{ emailId, from: emailFrom, subject: n.name, snippet: typeof readableAttrs.snippet === 'string' ? readableAttrs.snippet : undefined, article: readableText }}
        />
      )}
      {viewImage && typeof document !== 'undefined' && createPortal(
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
        </div>,
        document.body,
      )}
      <NesioSheet
        variant="bottom"
        elevated={elevated}
        open
        onOpenChange={(next) => { if (!next) onClose(); }}
        card={false}
        className="nesio-settings-sheet-card"
        ariaLabel={n.name}
      >

        {/* Type color strip */}
        {/* 类型色条:tint 走 CSS 变量,夜间由 CSS 混暗 —— 直接 inline background 会让
            浅色 pastel 在夜间糊成一条白带(QA 截图「弹出框上侧白边」)。 */}
        <div className="nesio-type-header-strip" style={{ ['--type-strip-bg' as string]: typeBg }}>
          {/* 2026-08-01 用户更正:自定义标签比 type 重要——命中就标签领头(左),
              type 退到这一行右上角小字;没有自定义标签就维持原样(type 领头,无角标)。 */}
          {(() => {
            const customTag = nodeTags.find((t) => isCustomMemoryTag(t));
            if (customTag) {
              return (
                <>
                  <span className="nesio-type-header-icon"><IconBookmark size={15} /></span>
                  <span className="nesio-type-header-label">{customTag}</span>
                  <span className="nesio-type-header-source" aria-hidden>
                    <NodeTypeIcon type={n.type} size={12} /> {(dict === 'en' ? TYPE_LABELS_EN : TYPE_LABELS_ZH)[n.type] || n.type}
                  </span>
                </>
              );
            }
            return (
              <>
                <span className="nesio-type-header-icon"><NodeTypeIcon type={n.type} size={15} /></span>
                <span className="nesio-type-header-label">{(dict === 'en' ? TYPE_LABELS_EN : TYPE_LABELS_ZH)[n.type] || n.type}</span>
              </>
            );
          })()}
        </div>

        <div className="nesio-settings-sheet-header">
          {editing ? (
            <input
              className="nesio-ob-input" style={{ fontSize: 'var(--text-body)', marginBottom: 0, flex: 1 }}
              value={field('name')} onChange={(e) => setField('name', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); }}
              autoFocus
            />
          ) : (
            <h2 className="nesio-settings-sheet-title" title={n.name}>{displayTitle(displayNodeName(n.name, dict))}</h2>
          )}
          {/* 可见关闭出口(QA:只能 Esc/下滑关,触屏用户不知道怎么退) */}
          <button type="button" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}
            style={{ flexShrink: 0, marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--portal-muted)', fontSize: 'var(--text-body)', padding: 'var(--space-1) var(--space-1)', lineHeight: 1 }}>
            ✕
          </button>
        </div>

        {/* Expanded edit form — type-specific fields */}
        {editing && (
          <div className="nesio-edit-form">
            {n.type === 'Thing' && (<>
              <div className="nesio-edit-row">
                <span>{L(dict, '存放位置', 'Stored at')}</span>
                <LocationPicker value={field('location')} onChange={(v, meta) => { setField('location', v); setEditPlaceMeta(meta ?? null); }} />
              </div>
              <label className="nesio-edit-row"><span>{L(dict, '价格', 'Price')}</span><input value={field('price')} onChange={(e) => setField('price', e.target.value)} placeholder="$12.99" /></label>
              <label className="nesio-edit-row"><span>{L(dict, '购买日期', 'Bought on')}</span><input type="date" value={field('purchaseDate')} onChange={(e) => setField('purchaseDate', e.target.value)} /></label>
              <label className="nesio-edit-row"><span>{L(dict, '有效期', 'Expires')}</span><input type="date" value={field('expiry')} onChange={(e) => setField('expiry', e.target.value)} /></label>
            </>)}
            {n.type === 'task' && (<>
              <label className="nesio-edit-row nesio-edit-row--stack">
                <span>{L(dict, '详情', 'Details')}</span>
                <textarea
                  className="nesio-ob-input"
                  rows={4}
                  value={field('detail')}
                  onChange={(e) => setField('detail', e.target.value)}
                  placeholder={L(dict, '待办说明、步骤、链接…', 'What to do, steps, links…')}
                />
              </label>
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
            {n.type === 'collection' && (
              // 2026-08-01:随手记下、没赶上带日期的一句话,事后想设个截止提醒也该有地方填 ——
              // 填了就会出现在「日程」里(见 SchedulePanel 的手记分支)。
              <label className="nesio-edit-row"><span>{L(dict, '截止日期(可选)', 'Due date (optional)')}</span><input type="date" value={field('dueDate').slice(0, 10)} onChange={(e) => setField('dueDate', e.target.value)} /></label>
            )}
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
          {/* 批次 124→125·设计来源行:来自 {来源}·{provider}(加粗) · {时间}(带图标)。
              可信度统一:默认不显示;只有 AI 没把握时标一个「待确认」。 */}
          <div className="nesio-node-source-row">
            <span className="nesio-node-source-icon" aria-hidden>{SRC.icon}</span>
            <span className="nesio-node-source-text">
              {L(dict, '来自 ', 'From ')}
              <b className="nesio-node-source-name">{SRC.label}{SRC.provider ? ` · ${SRC.provider}` : ''}</b>
              {/* 2026-08-01 用户点名时间显示重复:event 类型下面 EventSection 已经有专属的
                  「时间」整行(带起止),这里再补一遍同一个日期只是噪音,其它类型仍保留。 */}
              {srcTime && n.type !== 'event' ? ` · ${srcTime}` : ''}
            </span>
            {srcUncertain && <span className="nesio-node-pending">{L(dict, '待确认', 'Unconfirmed')}</span>}
          </div>

          {/* 自定义标签:注册表 chip 切换;新建标签写入注册表并打上 */}
          <div style={{ marginTop: 'var(--space-3)' }}>
            <p className="nesio-settings-section-label" style={{ marginBottom: 'var(--space-2)' }}>
              {L(dict, '自定义标签', 'Custom tags')}
            </p>
            <div className="nesio-memory-type-filter" role="group" aria-label={L(dict, '切换自定义标签', 'Toggle custom tags')}>
              {customTagsList.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`nesio-type-chip${nodeTags.includes(tag) ? ' is-active' : ''}`}
                  onClick={() => toggleCustomTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)', alignItems: 'center' }}>
              <input
                className="nesio-ob-input"
                style={{ flex: 1, marginBottom: 0 }}
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitNewCustomTag(); }}
                placeholder={L(dict, '新建标签', 'New tag')}
                aria-label={L(dict, '新建标签', 'New tag')}
              />
              <button
                type="button"
                className="nesio-node-action-secondary"
                onClick={commitNewCustomTag}
                disabled={!newTagInput.trim()}
              >
                {L(dict, '添加', 'Add')}
              </button>
            </div>
          </div>

          {/*
           * 2026-08-01 按钮大整理(用户原话:「详情页就阅读和编辑 2 个按钮」,
           * 「删除、分派家人、关联记忆都放进点击编辑后的页面」)。
           *
           * 在这之前这一屏上散着七八个按钮:顶上「阅读原文 / 回复」一排、
           * 紧接着「＋ 添加照片」一排、再一个「分派给家人」、底下还有
           * 「用镜头看看 / 阅读 / 编辑 / 删除」——「阅读」甚至上下各一份。
           * 现在只有底部一排,改这条记忆的那几件事全都收进编辑态。
           *
           * 「添加附件」跟着改名并去掉 accept:原来只收 image/*,而附件本来
           * 就不该只有照片(local-file-store 早就能原样收任意文件)。
           * 白名单在 iOS 的文件选择器里会把 PDF/docx 直接灰掉 —— 这个坑
           * 仓里栽过两次,见 scripts/file-picker-ios.test.mjs。
           */}
          {editing && (
            <div className="nesio-nd-photo-add">
              <button
                type="button"
                className="nesio-node-action-secondary nesio-nd-photo-btn"
                onClick={() => photoInputRef.current?.click()}
                disabled={addingPhoto}
              >
                {addingPhoto ? L(dict, '添加中…', 'Adding…') : L(dict, '＋ 添加附件', '＋ Add files')}
              </button>
              <input
                ref={photoInputRef}
                type="file"
                multiple
                className="nesio-visually-hidden"
                onChange={(e) => { const f = e.currentTarget.files; e.currentTarget.value = ''; void addPhotos(f); }}
              />
              {photoErr && (
                <p className="nesio-nd-photo-err" role="alert">
                  {photoErr}
                  <button type="button" className="nesio-nd-photo-retry" onClick={() => photoInputRef.current?.click()}>
                    {L(dict, '重试', 'Retry')}
                  </button>
                </p>
              )}
              {!photoErr && scanHint && <p className="nesio-nd-scan-hint">{scanHint}</p>}
              {addedThumbs.length > 0 && (
                <div className="nesio-nd-added-thumbs">
                  {addedThumbs.map((u, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={u} alt="" className="nesio-nd-added-thumb" draggable={false} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 闭环起点:日历/承诺类记忆可「分派给家人」(→ 对方今天页看到 → 做完你今天页收到回响)。
              2026-08-01 收进编辑态 —— 它是「对这条记忆做一次安排」,和删除/关联同类。 */}
          {editing && (n.type === 'event' || n.type === 'task') && (
            <AssignChoreLazy node={n} />
          )}

          {/* Type-specific section —— 「关键信息」段标已砍(详情页精简 2026-08-01):
              下面永远只跟着一个类型 Section,Section 自己的字段都带 label 了,
              这行纯装饰的空标题不提供信息,只占地方。 */}
          {n.type === 'person' && (
            <PersonSection node={n} relatedNodes={relatedNodes} onOpenNode={onOpenNode} />
          )}
          {n.type === 'Thing' && (
            <ObjectSection node={n} assetUrls={assetUrls} />
          )}
          {n.type === 'place' && (
            <PlaceSection node={n} relatedNodes={relatedNodes} onOpenNode={onOpenNode} />
          )}
          {n.type === 'event' && (
            <EventSection node={n} relatedNodes={relatedNodes} onOpenNode={onOpenNode} />
          )}
          {n.type === 'task' && (
            <CommitmentSection node={n} onToggleDone={toggleDone} />
          )}
          {n.type === 'Mind' && (
            <MindSection node={n} assetUrls={assetUrls} />
          )}
          {n.type === 'collection' && (
            <NoteSection node={n} />
          )}

          {/* Raw input —— 批次 74:长文默认折叠(清单类原文动辄上千字) */}
          {showRawInput && (
            <div className="nesio-node-raw" style={{ marginTop: 'var(--space-3)' }}>
              <p className="nesio-settings-section-label">{isEmailNode ? L(dict, '原始记录 · 邮件原文', 'Original · email') : L(dict, '原始记录', 'Original note')}</p>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', fontStyle: 'italic' }}>
                &ldquo;{(() => { const raw = stripMarkdownInline(n.rawInput || ''); return rawExpanded || raw.length <= 180 ? raw : `${raw.slice(0, 180)}…`; })()}&rdquo;
              </p>
              {(n.rawInput || '').length > 180 && (
                <button type="button" className="nesio-node-link-add" onClick={() => setRawExpanded((v) => !v)}>
                  {rawExpanded ? L(dict, '收起', 'Collapse') : L(dict, '展开全文', 'Show all')}
                </button>
              )}
            </div>
          )}

          {/* Remaining attributes not covered above — 默认折叠:这里剩下的多是没建专属展示位的
              长尾字段,展开前只给一个可点的标题,不把生 key 糊用户脸上。 */}
          {shownAttrs.length > 0 && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <button
                type="button"
                onClick={() => setOtherAttrsExpanded((v) => !v)}
                className="nesio-settings-section-label"
                style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                {L(dict, '其他属性', 'Other details')}
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', fontWeight: 400 }}>
                  {otherAttrsExpanded ? L(dict, '收起', 'Hide') : L(dict, `展开 ${shownAttrs.length} 项`, `Show ${shownAttrs.length}`)}
                </span>
              </button>
              {otherAttrsExpanded && shownAttrs.map(([k, v]) => (
                <div key={k} className="nesio-node-attr-row">
                  <span className="nesio-node-attr-key">{(dict === 'en' ? ATTR_KEY_LABELS_EN : ATTR_KEY_LABELS)[k] ?? k}</span>
                  <span className="nesio-node-attr-val" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    {k === 'condition' && <WeatherIcon condition={String(v)} size={15} />}
                    {k === 'temperatureC' ? `${String(v)} °C` : String(v)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 标签三层重构:L2 语义标签(AI 冗余打的检索词,如 餐具/玻璃/水杯)不再上屏 ——
              只进检索索引。唯一露面的是 L3「主题门」:同标签 ≥3 条记忆才出现,是门不是签
              (可点,跳回记忆页搜该主题),每处最多 2 扇。 */}
          {(() => {
            if (!n.tags?.length) return null;
            let graph: LifeNode[] = [];
            try { graph = getLifeGraph(); } catch { /* ignore */ }
            const doors = n.tags
              // 只有**主题**才配成门。来源标记(Flomo/Notion…)和层级前缀(「主题」)
              // 点进去等于「全部导入内容」,没有筛选意义 —— 用户看到的
              // 「Flomo · 1917 条」「主题 · 21 条」就是这么冒出来的。
              .filter(isTopicTag)
              .map((t) => ({ t, count: graph.filter((x) => x.id !== n.id && x.tags?.includes(t)).length + 1 }))
              .filter((d) => d.count >= 3)
              .sort((a, b) => b.count - a.count)
              .slice(0, 2);
            if (!doors.length) return null;
            return (
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
                {doors.map(({ t, count }) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      onClose();
                      window.dispatchEvent(new CustomEvent('nesio-memory-search', { detail: { query: t } }));
                    }}
                    style={{ background: 'var(--portal-accent-soft, rgba(88,140,227,0.12))', border: 'none', borderRadius: 999, padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--portal-accent, #588ce3)', cursor: 'pointer' }}
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
            const heroShown = n.type === 'Thing' || n.type === 'Mind';
            const heroKey = heroShown
              ? (() => { const f = allAssets.find((a) => a.kind === 'image' || a.mimeType?.startsWith('image/')); return f ? (f.id || f.storagePath || f.label || 'asset') : ''; })()
              : '';
            // 顶部英雄图已经**真正加载出 URL**时,才跳过云端孪生(避免同图两份)。
            // 以前只看 asset.local 标记 —— 换端标记在、图不在,英雄空白,云孪生还被滤掉。
            const heroLoaded = Boolean(heroKey && assetUrls[heroKey]);
            const galleryAssets = allAssets.filter((a) => {
              if ((a.id || a.storagePath || a.label || 'asset') === heroKey) return false;
              const isImg = a.kind === 'image' || a.mimeType?.startsWith('image/');
              if (heroLoaded && isImg && !a.local && a.storagePath) return false;
              return true;
            });
            if (galleryAssets.length === 0) return null;
            return (
            <>
              <p className="nesio-settings-section-label" style={{ marginTop: 'var(--space-3)' }}>{L(dict, '附件', 'Attachments')}</p>
              <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                {galleryAssets.map((asset) => {
                  const key = asset.id || asset.storagePath || asset.label || 'asset';
                  const previewUrl = assetUrls[key];
                  const isImage = asset.kind === 'image' || asset.mimeType?.startsWith('image/');
                  // 附件(pdf/docx/xlsx…)存在 nesio-files,是 Blob 不是 dataURL —— 单独一行,点了下载/打开。
                  // 不做内嵌预览:各种格式各要一个渲染器,而「能打开」已经解决了「存进去看不见」。
                  if (asset.kind === 'file' && asset.local) {
                    return <LocalFileRow key={key} assetId={asset.id} label={asset.label || n.name} dict={dict} />;
                  }
                  return (
                    <div key={key} className="nesio-type-asset-card">
                      {isImage && previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={previewUrl} alt={asset.label || n.name} draggable={false} className="nesio-type-asset-img"
                          onClick={() => setViewImage({ url: previewUrl, name: asset.label || n.name })} style={{ cursor: 'zoom-in' }}
                          /*
                           * 云图加载失败时:**先换一张签名 URL,换不到才退文案**。
                           *
                           * 原来这里只做后半截 —— 直接把这条从 assetUrls 摘掉,
                           * 回落到「图片线索已保存,登录后可查看」。避免了破图方块,
                           * 但把最常见的那种失败(签名 URL 到期)也一并当成了「你没登录」:
                           * 用户明明登着,照片却消失了,还被告知去登录。
                           * 这比破图更糟 —— 它给了一个**错的**解释。
                           *
                           * 头像那条(批次 11)一直有换签兜底,附件这条从来没有。
                           * 现在共用 signed-asset-url 里那套(同 path 并发去重、只重试一次)。
                           */
                          onError={(e) => {
                            const img = e.currentTarget;
                            if (asset.storagePath && img.dataset.retried !== '1') {
                              makeAssetErrorHandler(asset.storagePath, (url) => {
                                setAssetUrls((cur) => {
                                  if (url) return { ...cur, [key]: url };
                                  // 换签失败 → 摘掉,回落到软文案(可见失败态,不是破图)
                                  if (!(key in cur)) return cur;
                                  const next = { ...cur }; delete next[key]; return next;
                                });
                              })(e);
                              return;
                            }
                            setAssetUrls((cur) => { if (!(key in cur)) return cur; const next = { ...cur }; delete next[key]; return next; });
                          }} />
                      ) : (
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', marginBottom: 'var(--space-1)' }}>
                          {asset.local ? L(dict, '图片加载中…', 'Loading image…') : asset.storagePath ? L(dict, '图片线索已保存，登录后可查看。', 'Image clue saved — sign in to view.') : L(dict, '附件线索已保存。', 'Attachment clue saved.')}
                        </p>
                      )}
                      {asset.analysisSummary && (
                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', margin: 0 }}>
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

          <p style={{ fontSize: 'var(--text-overline)', color: 'var(--portal-muted)', marginTop: 'var(--space-4)' }}>
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

          {/* 详情页精简(2026-08-01):关联块(手动增删)+ 相关记忆(自动算的只读列表)
              原来分两处出现 —— 顶上一个、底下一个,同一件"这条和什么有关"的事说两遍。
              合并到这一处,手动关联(可加/可解)放前面,自动相关记忆(只读浏览)跟在后面。
              标签三层重构那次的初衷仍在:关联图撤下的原因是「同天创建/弱相似」画成箭头
              视觉上像因果实际是噪声,全景图谱仍在记忆页的「关联图」入口。 */}
          {(() => {
            let linksBlock: ReactNode = null;
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
                // 2026-07-30 反链保底:下面这几个原来**不在表里**,后果是关联建了但详情页
                // 一条都不显示 —— 上周刚做的「这笔钱关联了谁」在这里是隐形的。
                checklist_of: [<IconCheckSquare key="i" size={13} />, '所属清单', 'Checklist of'],
                involves_person: [<IconLink key="i" size={13} />, '相关的人', 'Person involved'],
                paid_by_tx: [<IconLink key="i" size={13} />, '对应这笔钱', 'Paid by'],
              };
              /**
               * ⚠️ 关系名**不做白名单过滤**。
               *
               * 原来是 `Boolean(REL_LABEL[x.r.relation])` —— 表里没有的关系类型直接从
               * 界面上消失。那意味着每加一种关系,都要有人记得回来改这张表,
               * 忘了就是「关联明明建了,详情页什么都没有」,而且不报错。
               * 上周新增的 involves_person / paid_by_tx 就正好踩中,checklist_of 更是
               * 一直漏着(从清单那一侧看不到它属于谁)。
               *
               * 现在:认得的用它自己的标签,不认得的走通用标签**照样显示**。
               * 宁可显示一个笼统的「关联」,也不要让一条真实存在的边凭空消失。
               */
              const relMeta = (rel: string): [ReactNode, string, string] =>
                REL_LABEL[rel] ?? [<IconLink key="i" size={13} />, '关联', 'Linked'];
              const rels = [
                ...(n.relations || []).filter((r) => !removedRels.has(`${r.relation}:${r.targetId}`)),
                ...addedRels,
              ];
              const live = rels
                .map((r) => ({ r, node: g.find((x) => x.id === r.targetId) }))
                // 只要目标节点还在就显示 —— 关系名不认得不是隐藏它的理由
                .filter((x): x is { r: { targetId: string; relation: string }; node: LifeNode } => Boolean(x.node));
              // 批次 94(用户实锤关联记忆闪退):onClick 里抛的错 React 错误边界
              // 抓不到(只抓 render),会冒到全局 → 批次 85 处理器可能触发重载 =
              // 看起来「闪退」。addRel/removeRel 全包 try/catch,任何异常只吞不炸。
              const removeRel = (r: { targetId: string; relation: string }) => {
                try {
                  setRemovedRels((prev) => new Set(prev).add(`${r.relation}:${r.targetId}`));
                  // R1:走 unlinkNodes —— 一次读写把两边解完。
                  // 原来反向那次是 `filter(x => x.targetId !== n.id)`,把**所有**指回来的关系
                  // 都删了:两个节点之间有两种关系时(比如 user_linked + has_checklist),
                  // 解掉一种会把另一种一起带走,而这边还留着。
                  unlinkNodes(n.id, r.targetId, r.relation);
                  logLinkFeedback({ action: 'removed', relation: r.relation, from: n.id, to: r.targetId });
                } catch (err) { console.error('[link] remove_failed', err); setLinkError(`解除出错:${err instanceof Error ? err.message : String(err)}`.slice(0, 120)); }
              };
              const addRel = (t: LifeNode) => {
                try {
                  if (t.id === n.id || rels.some((x) => x.targetId === t.id)) { setLinkPicking(false); setLinkQuery(''); return; }
                  const liveN = g.find((x) => x.id === n.id);
                  // R1:一次读写把两边写完 —— 原来是两次 updateLifeNode,
                  // 第二次失败就留下半条关联(这边看得到、那边看不到),没有界面会报错。
                  linkNodes(n.id, t.id, 'user_linked');
                  setAddedRels((prev) => [...prev, { targetId: t.id, relation: 'user_linked' }]);
                  logLinkFeedback({ action: 'added', relation: 'user_linked', from: n.id, to: t.id });
                } catch (err) {
                  console.error('[link] add_failed', err);
                  setLinkError(`关联出错:${err instanceof Error ? err.message : String(err)}`.slice(0, 120));
                } finally {
                  setLinkQuery('');
                }
              };
              // 批次 172:用去抖异步算好的候选(不在渲染里同步搜全图 —— 闪退根因)
              const candidates = linkCandidates;
              linksBlock = (
                <div className="nesio-node-links">
                  {live.map(({ r, node: t }) => (
                    <div key={`${r.relation}-${r.targetId}`} className="nesio-node-link-row">
                      <button type="button" className="nesio-node-link-chip" onClick={() => onOpenNode?.(t)}>
                        <span>{relMeta(r.relation)[0]}</span>
                        <span className="nesio-node-link-kind">{L(dict, relMeta(r.relation)[1], relMeta(r.relation)[2])}</span>
                        <span className="nesio-node-link-name">{t.name.slice(0, 24)}</span>
                      </button>
                      <button type="button" className="nesio-node-link-x" aria-label={L(dict, '解除关联', 'Unlink')} onClick={() => removeRel(r)}>✕</button>
                    </div>
                  ))}
                  {linkPicking && (
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
                    <p style={{ fontSize: 'var(--text-overline)', color: 'var(--status-risk)', margin: 'var(--space-1) 0 0', wordBreak: 'break-all' }}>{linkError}</p>
                  )}
                </div>
              );
            } catch {
              // 批次 83(用户实锤「添加关联闪退卡死」):关联块自身出错只藏本块,
              // 不放大成整卡崩溃;等真机栈定点修根因。
              linksBlock = null;
            }
            const hasRelated = Boolean(relatedNodes && relatedNodes.length > 0);
            if (!linksBlock && !hasRelated) return null;
            return (
              <div className="nesio-related-section">
                {/* 2026-08-01 用户点名整合:「＋关联一条记忆」从独立一行的虚线按钮挪到标题
                    行内,不再多占一整行竖直空间。 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                  <p className="nesio-settings-section-label" style={{ margin: 0 }}>{L(dict, '相关记忆', 'Related memories')}</p>
                  {/* 2026-08-01(用户:「关联记忆…放进点击编辑后的页面」):
                      **加**关联是改这条记忆,收进编辑态;而下面那份列表是只读的,
                      留在详情页 —— 「这条和什么有关」是要看的信息,不是要改的东西。 */}
                  {editing && !linkPicking && (
                    <button type="button" className="nesio-node-link-add-inline" onClick={() => setLinkPicking(true)}>
                      <IconLink size={12} /> {L(dict, '关联', 'Link')}
                    </button>
                  )}
                </div>
                {linksBlock}
                {hasRelated && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: linksBlock ? 'var(--space-2)' : 0 }}>
                    {relatedNodes!.slice(0, 6).map((r) => {
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
                          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-line, rgba(127,127,127,0.18))', background: 'none', color: 'var(--portal-ink)', textAlign: 'left', cursor: 'pointer' }}
                        >
                          <NodeTypeIcon type={r.type} size={13} />
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--text-sm)' }}>{r.name}</span>
                          {dateTag && <span style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-xs)', flex: 'none' }}>{dateTag}</span>}
                          <span style={{ color: 'var(--portal-muted)' }}>›</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {placePickOpen && (
        <PlacePickerLazy
          raw={(typeof n.attributes?.capturedPlace === 'string' && n.attributes.capturedPlace) || healedPlace}
          lat={typeof n.attributes?.capturedLat === 'number' ? n.attributes.capturedLat : undefined}
          lon={typeof n.attributes?.capturedLon === 'number' ? n.attributes.capturedLon : undefined}
          onClose={() => setPlacePickOpen(false)}
          onRenamed={(name) => setHealedPlace(name)}
        />
      )}

      {/* 镜头看记忆:情绪重的主动提示单独留着(不是按钮,是判断出来的时候才出现的一句话);
          「用镜头看看」本身不再单独占一整行 —— 2026-08-01 用户点名底部按钮太占地方,
          并进下面的 Actions 一排,别再多起一段。 */}
          {!editing && shouldNudge(`${n.name} ${(n.attributes?.notes as string) || n.rawInput || ''}`) && !nudgeDismissed && (
            <div className="nesio-growth">
              <div className="ng-hint" style={{ marginTop: 'var(--space-5)' }}>
                <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>
                <p>{L(dict, '念念看到这条情绪有点重 —— 要不要陪你把它看清楚一点?(不是分析你,是把话看清)', 'This one feels heavy — want to look at it more clearly? (not analyzing you — just seeing the words)')}</p>
                <button type="button" className="x" onClick={() => setNudgeDismissed(true)}>{L(dict, '轻轻划走', 'Dismiss')}</button>
              </div>
            </div>
          )}
          <MemoryLensSheet open={lensOpen} onOpenChange={setLensOpen} node={n} />

      {/* Actions —— 2026-08-01:「用镜头看看」并入这一排,不再单独一整行占地方 */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-5)', flexWrap: 'wrap' }}>
            {/* 这一排以前是三套不同的自造按钮拼出来的(ob-primary / today--ghost / settings-danger),
                高度各不相同,只好再加一层 .nesio-nd-action-btn 把它们掰齐。

                2026-07-31:那层「掰齐」的类名其实把 height/padding/border-radius/font-size/
                font-weight 全盖了一遍 —— 写着 <Button variant="primary"> 却又自带一整套外观,
                是**假迁移**。现在外观全交给 variant/size/tone(md 已带 --tap-min 最小高度,
                替掉原来手写的 height:46px),这里只剩 flex:1 这一条真正的布局,走 layoutStyle。 */}
            {editing ? (
              <>
                <Button variant="primary" size="sm" layoutStyle={{ flex: 1 }} onClick={saveEdit}>{L(dict, '保存', 'Save')}</Button>
                <Button variant="secondary" size="sm" layoutStyle={{ flex: 1 }} onClick={() => setEditing(false)}>{L(dict, '取消', 'Cancel')}</Button>
                {/* 删除收进编辑态(2026-08-01 用户点名)。放在保存/取消后面、而且是最后一个 ——
                    误触的代价在这一排里只有它是不可逆的。 */}
                <Button variant="soft" size="sm" tone="risk" layoutStyle={{ flex: 1 }} onClick={handleDelete}>{L(dict, '删除', 'Delete')}</Button>
              </>
            ) : (
              <>
                {/* 阅读 —— 顶上那份「阅读原文」已撤,这里是唯一一处。 */}
                {readableText && (
                  <Button variant="primary" size="sm" layoutStyle={{ flex: 1 }} onClick={() => setReaderOpen(true)}>{L(dict, '阅读', 'Read')}</Button>
                )}
                {/*
                 * 回复。用户列的「详情页就阅读和编辑 2 个按钮」里没点到它,
                 * 但它也没被点名要挪进编辑页 —— 而回复一封邮件和编辑这条记忆
                 * 完全是两件事,塞进编辑态会很别扭。它只在邮件节点上出现,
                 * 所以留在这一排:非邮件的记忆看到的仍然只有阅读 + 编辑。
                 * (要是这条也该撤,说一声就撤。)
                 */}
                {isEmailNode && (
                  <Button variant="secondary" size="sm" layoutStyle={{ flex: 1 }} onClick={() => setComposeOpen(true)}>{L(dict, '回复', 'Reply')}</Button>
                )}
                {/* 「镜头」两个字(用户点名),而且只给写下来的字看 —— 判据在 lens-eligible。
                    一封对账单、一个日历事件底下没有话可看,给它镜头就是一条无话可说的路。 */}
                {isLensEligible(n) && (
                  <Button variant="soft" size="sm" layoutStyle={{ flex: 1 }} onClick={() => setLensOpen(true)}>{L(dict, '镜头', 'Lens')}</Button>
                )}
                <Button variant="secondary" size="sm" layoutStyle={{ flex: 1 }} onClick={startEdit}>{L(dict, '编辑', 'Edit')}</Button>
              </>
            )}
          </div>
        </div>
      </NesioSheet>
    </>
  );
}


/**
 * 本机附件一行:名字 · 大小 · 打开。附件存的是 Blob(nesio-files),
 * 所以 URL 要 createObjectURL 现造,并在卸载时 revoke —— 不 revoke 就是内存泄漏。
 * 取不到(被清过/换了设备)要明说,不能留一个点了没反应的按钮。
 */
function LocalFileRow({ assetId, label, dict }: { assetId: string; label: string; dict: string }) {
  const [meta, setMeta] = useState<{ name: string; size: number } | null>(null);
  const [gone, setGone] = useState(false);
  const urlRef = useRef<string>('');
  useEffect(() => {
    let live = true;
    void import('@/lib/portal/local-file-store').then(({ getLocalFile }) => getLocalFile(assetId)).then((rec) => {
      if (!live) return;
      if (!rec?.blob) { setGone(true); return; }
      urlRef.current = URL.createObjectURL(rec.blob);
      setMeta({ name: rec.name || label, size: rec.size || rec.blob.size });
    }).catch(() => { if (live) setGone(true); });
    return () => {
      live = false;
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = ''; }
    };
  }, [assetId, label]);

  return (
    <div className="nesio-type-asset-card nesio-nd-file-row">
      <span className="nesio-nd-file-icon" aria-hidden><IconFile size={18} /></span>
      <span className="nesio-nd-file-meta">
        <span className="nesio-nd-file-name">{meta?.name || label}</span>
        <span className="nesio-nd-file-sub">
          {gone
            ? L(dict, '这个附件在本机找不到了', 'This attachment is no longer on this device')
            : meta ? prettyFileSize(meta.size) : L(dict, '读取中…', 'Loading…')}
        </span>
      </span>
      {meta && !gone && (
        <a className="nesio-node-action-secondary nesio-nd-file-open" href={urlRef.current} download={meta.name} target="_blank" rel="noreferrer">
          {L(dict, '打开', 'Open')}
        </a>
      )}
    </div>
  );
}
function prettyFileSize(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 KB';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;
}
