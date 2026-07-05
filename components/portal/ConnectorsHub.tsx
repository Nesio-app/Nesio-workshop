'use client';

import { useEffect, useRef, useState } from 'react';
import { IconActivity, IconBook, IconBookOpen, IconCalendar, IconCar, IconCheckSquare, IconCloudSun, IconHeartPulse, IconMail, IconNote, IconTimer } from './icons';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { type LifeNode } from '@/lib/portal/life-graph';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

interface ConnectorsHubProps { open: boolean; onClose: () => void; }

type ConnMethod = 'oauth' | 'geo' | 'file' | 'server' | 'token' | 'shortcuts';
type NodeInput = Omit<LifeNode, 'id' | 'createdAt'>;

interface ConnectorDef {
  id: string;
  name: string;
  nameEn?: string;
  descriptionEn?: string;
  icon: React.ReactNode;
  iconBg: string;
  description: string;
  method: ConnMethod;
  /** token connectors: the API endpoint to POST { token } to */
  syncEndpoint?: string;
  /** token connectors: where to get the token */
  tokenHint?: string;
  tokenHintEn?: string;
  /** shortcuts connectors: the source id for /api/portal/ingest */
  ingestSource?: string;
  comingSoon?: boolean;
  dev?: boolean;
}

// dev: true = 还在打磨的接入,收进「开发中」折叠组,不占主列表
const CONNECTORS: ConnectorDef[] = [
  // 日历和 Gmail 是同一次 Google 授权,合并为一个入口(批次 5 用户反馈)
  { id: 'google', name: 'Google 日历 · Gmail', nameEn: 'Google Calendar · Gmail', icon: <IconCalendar />, iconBg: 'var(--chip-blue)', method: 'oauth', description: '一次授权同时接入:日程生成提醒和简报,邮件提取人物、日期、承诺', descriptionEn: 'One consent covers both: calendar drives reminders and briefs; email yields people, dates, promises' },
  { id: 'weather', name: '地理位置 · 天气', nameEn: 'Location · Weather', icon: <IconCloudSun />, iconBg: 'var(--chip-amber)', method: 'geo', description: '基于实时天气生成外出和健康建议', descriptionEn: 'Live weather feeds outing and health suggestions' },
  { id: 'flomo', name: 'Flomo', icon: <IconNote />, iconBg: 'var(--chip-indigo)', method: 'server', syncEndpoint: '/api/portal/flomo?limit=30', description: '同步 flomo 笔记，提取想法与记录', descriptionEn: 'Sync flomo notes; extract ideas and records' },
  // 批次 18:Notion 转正 —— OAuth 一键授权(像 flomo 那样选页面),内部 token 流保留为回退
  { id: 'notion', name: 'Notion', icon: <IconBook />, iconBg: 'var(--chip-gray)', method: 'token', syncEndpoint: '/api/portal/notion', tokenHint: 'notion.so/my-integrations → 新建集成 → 复制 Internal Integration Secret，并把页面共享给它', tokenHintEn: 'notion.so/my-integrations → New integration → copy the Internal Integration Secret, then share your pages with it', description: '授权后同步你选择的页面，提取项目与想法', descriptionEn: 'Authorize, pick pages, and sync projects and ideas' },
  { id: 'toggl', name: 'Toggl Track', icon: <IconTimer />, iconBg: 'var(--chip-red)', method: 'token', syncEndpoint: '/api/portal/toggl', tokenHint: 'track.toggl.com → Profile → API Token', tokenHintEn: 'track.toggl.com → Profile → API Token', description: '同步时间记录，了解你的专注分布', descriptionEn: 'Sync time entries to see where your focus goes', dev: true },
  { id: 'health', name: 'Apple Health 导出', nameEn: 'Apple Health export', icon: <IconHeartPulse />, iconBg: 'var(--chip-pink)', method: 'file', description: '上传 export.xml，提取步数、睡眠、心率', descriptionEn: 'Upload export.xml to extract steps, sleep, heart rate', dev: true },
  { id: 'reminder', name: 'Apple 提醒事项', nameEn: 'Apple Reminders', icon: <IconCheckSquare />, iconBg: 'var(--chip-amber)', method: 'shortcuts', ingestSource: 'reminder', description: '通过快捷指令推送提醒，自动转为承诺', descriptionEn: 'Push reminders via Shortcuts; they become commitments', dev: true },
  { id: 'keep', name: 'Keep 健康', nameEn: 'Keep fitness', icon: <IconActivity />, iconBg: 'var(--chip-green)', method: 'shortcuts', ingestSource: 'keep', description: '通过快捷指令推送运动数据', descriptionEn: 'Push workout data via Shortcuts', dev: true },
  { id: 'wechat_reading', name: '微信读书', nameEn: 'WeRead', icon: <IconBookOpen />, iconBg: 'var(--chip-leaf)', method: 'shortcuts', ingestSource: 'wechat_reading', description: '通过快捷指令推送阅读进度与笔记', descriptionEn: 'Push reading progress and notes via Shortcuts', dev: true },
  { id: 'tesla', name: 'Tesla', icon: <IconCar />, iconBg: 'var(--chip-green)', method: 'oauth', description: '电量、行程信号，自动提醒充电', descriptionEn: 'Battery and trip signals; charging reminders', comingSoon: true, dev: true },
];

const CONNECTORS_KEY = 'nesio-connectors-v1';
const TOKENS_KEY = 'nesio-connector-tokens-v1';

function loadConnectors(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(CONNECTORS_KEY) || '{}'); } catch { return {}; }
}
function saveConnectorState(id: string, connected: boolean) {
  const saved = loadConnectors();
  if (connected) saved[id] = true; else delete saved[id];
  try { localStorage.setItem(CONNECTORS_KEY, JSON.stringify(saved)); } catch { /* ignore */ }
}
function loadToken(id: string): string {
  try { return JSON.parse(localStorage.getItem(TOKENS_KEY) || '{}')[id] || ''; } catch { return ''; }
}
function saveToken(id: string, token: string) {
  try {
    const all = JSON.parse(localStorage.getItem(TOKENS_KEY) || '{}');
    if (token) all[id] = token; else delete all[id];
    localStorage.setItem(TOKENS_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

interface SyncResult { ok: boolean; msg: string; detail?: string; needsReauth?: boolean }

export default function ConnectorsHub({ open, onClose }: ConnectorsHubProps) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const fileRef = useRef<HTMLInputElement>(null);
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [tokenInputFor, setTokenInputFor] = useState<string | null>(null);
  const [tokenValue, setTokenValue] = useState('');
  const [shortcutsFor, setShortcutsFor] = useState<string | null>(null);
  const [ingestUrl, setIngestUrl] = useState('');
  const [oauthSyncResult, setOauthSyncResult] = useState<Record<string, SyncResult>>({});

  useEffect(() => {
    if (!open) return;
    setConnected(loadConnectors());
    setIngestUrl(`${window.location.origin}/api/portal/ingest`);
    // Check OAuth callback
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (params.get('connector') === 'notion' && params.get('status') === 'connected') {
      saveConnectorState('notion', true);
      setConnected((p) => ({ ...p, notion: true }));
      showToast(L(dict, 'Notion 已授权,点「同步」拉取你选择的页面', 'Notion authorized — tap Sync to pull the pages you granted'), true);
    }
    if (err === 'notion_not_configured') {
      showToast(L(dict,
        'Notion 集成还没配置:去 notion.so/my-integrations 创建 Public integration,把 NOTION_CLIENT_ID / NOTION_CLIENT_SECRET 配到 Vercel,Redirect URI 填 /api/portal/notion/callback',
        'Notion integration not configured yet: create a Public integration at notion.so/my-integrations, set NOTION_CLIENT_ID / NOTION_CLIENT_SECRET on Vercel, redirect URI /api/portal/notion/callback'), false);
    } else if (err === 'gmail_scope_not_granted') {
      showToast(L(dict,
        'Google 没有授出邮件权限:需在 Google Cloud 同意屏幕配置 gmail.readonly(测试模式下把自己加为测试用户)',
        "Google didn't grant Gmail access: add gmail.readonly on the OAuth consent screen (and add yourself as a test user while in Testing)"), false);
    } else if (err) {
      showToast(L(dict, `连接失败：${err}`, `Connection failed: ${err}`), false);
    }
  }, [open]);


  // 开发中的接入:只展示,不给操作按钮(不做假交互)
  function renderDevRow(c: ConnectorDef) {
    return (
      <div key={c.id} className="nesio-connector-row" style={{ opacity: 0.75 }}>
        <span className="nesio-connector-icon" style={{ background: c.iconBg }}>{c.icon}</span>
        <div className="nesio-connector-body">
          <p className="nesio-connector-name">
            {dict === 'en' ? (c.nameEn ?? c.name) : c.name}
            <span className="nesio-connector-soon">{c.comingSoon ? L(dict, '即将上线', 'Coming soon') : L(dict, '开发中', 'In dev')}</span>
          </p>
          <p className="nesio-connector-desc">{dict === 'en' ? (c.descriptionEn ?? c.description) : c.description}</p>
        </div>
      </div>
    );
  }

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  function saveNodes(nodes: Array<Omit<NodeInput, 'source'>>, source: LifeNode['source']) {
    nodes.forEach((n) => ingestLifeNode({ ...n, source } as NodeInput));
    window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
  }

  // ── Token-based sync (Notion, Toggl) ──
  async function syncToken(c: ConnectorDef) {
    const token = loadToken(c.id);
    // Notion OAuth:cookie 里有授权时不需要本地 token,直接空 body 同步
    if (!token && c.id !== 'notion') { setTokenInputFor(c.id); setTokenValue(''); return; }
    setSyncing(c.id);
    try {
      const res = await fetch(c.syncEndpoint!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json() as { ok?: boolean; nodes?: NodeInput[]; error?: string };
      if (!data.ok) {
        if (data.error === 'not_connected' && c.id === 'notion') {
          setSyncing(null);
          window.location.href = '/api/portal/notion/connect';
          return;
        }
        if (data.error === 'invalid_token') { saveToken(c.id, ''); setTokenInputFor(c.id); setTokenValue(''); showToast(L(dict, 'Token 无效，请重新输入', 'Invalid token — please re-enter'), false); }
        else showToast(L(dict, `同步失败：${data.error || '未知'}`, `Sync failed: ${data.error || 'unknown'}`), false);
        setSyncing(null);
        return;
      }
      const n = data.nodes || [];
      saveNodes(n, c.id === 'toggl' ? 'system' : 'manual');
      saveConnectorState(c.id, true);
      setConnected((p) => ({ ...p, [c.id]: true }));
      setCounts((p) => ({ ...p, [c.id]: n.length }));
      showToast(L(dict, `已提取 ${n.length} 个节点`, `Extracted ${n.length} nodes`), true);
    } catch { showToast(L(dict, '网络错误', 'Network error'), false); }
    setSyncing(null);
  }

  function submitToken(c: ConnectorDef) {
    if (!tokenValue.trim()) return;
    saveToken(c.id, tokenValue.trim());
    setTokenInputFor(null);
    syncToken(c);
  }

  // ── Server-configured sync (Flomo) ──
  async function syncFlomo(c: ConnectorDef) {
    setSyncing(c.id);
    try {
      const res = await fetch(c.syncEndpoint!);
      const data = await res.json() as { ok?: boolean; memos?: Array<{ content: string; created_at: string; tags: string[] }>; error?: string };
      if (!data.ok) { showToast(L(dict, `Flomo 未配置或同步失败`, 'Flomo not configured or sync failed'), false); setSyncing(null); return; }
      const memos = data.memos || [];
      const nodes: Array<Omit<NodeInput, 'source'>> = memos.slice(0, 20).map((m) => ({
        type: 'preference' as const,
        name: m.content.replace(/<[^>]+>/g, '').slice(0, 40),
        attributes: { source: 'Flomo', created: m.created_at },
        relations: [],
        tags: ['Flomo', ...(m.tags || [])],
        confidence: 0.9,
        rawInput: m.content.replace(/<[^>]+>/g, '').slice(0, 200),
      }));
      saveNodes(nodes, 'manual');
      saveConnectorState(c.id, true);
      setConnected((p) => ({ ...p, [c.id]: true }));
      setCounts((p) => ({ ...p, [c.id]: nodes.length }));
      showToast(L(dict, `已同步 ${nodes.length} 条 flomo 笔记`, `Synced ${nodes.length} flomo notes`), true);
    } catch { showToast(L(dict, '网络错误', 'Network error'), false); }
    setSyncing(null);
  }

  // ── OAuth sync(google = 日历 + 邮件一起同步,结果分行展示)──
  async function syncGoogle(c: ConnectorDef) {
    setSyncing(c.id);
    setOauthSyncResult((p) => ({ ...p, google: { ok: true, msg: L(dict, '同步中…', 'Syncing…') } }));
    const parts: string[] = [];
    let allOk = true;
    let reauth = false;

    // 日历
    try {
      const res = await fetch('/api/portal/calendar', { cache: 'no-store' });
      const data = await res.json() as { ok?: boolean; events?: Array<Record<string, unknown>>; error?: string; message?: string };
      if (data.ok && data.events?.length) {
        const count = data.events.length;
        const { saveCalendarToLocal } = await import('@/lib/portal/calendar-local-store');
        saveCalendarToLocal(data.events as Parameters<typeof saveCalendarToLocal>[0]);
        const added = await saveCalendarEventsToMemory(data.events);
        parts.push(L(dict, `日历:${count} 条事件${added > 0 ? `,${added} 条加入记忆` : ''}`, `Calendar: ${count} events${added > 0 ? `, ${added} added to memory` : ''}`));
        window.dispatchEvent(new CustomEvent('nesio-calendar-updated'));
      } else {
        allOk = false;
        parts.push(L(dict, `日历:没同步上(${data.message || data.error || '无事件'})`, `Calendar: not synced (${data.message || data.error || 'no events'})`));
      }
    } catch { allOk = false; parts.push(L(dict, '日历:网络错误', 'Calendar: network error')); }

    // 邮件
    try {
      const res = await fetch('/api/portal/gmail?includeBody=true&analyze=true');
      const data = await res.json() as { ok?: boolean; nodes?: NodeInput[]; error?: string; emailCount?: number; messages?: unknown[] };
      if (data.ok) {
        const nodeCount = data.nodes?.length ?? 0;
        if (nodeCount > 0) {
          data.nodes!.forEach((n) => ingestLifeNode({ ...n, source: 'email' } as NodeInput));
          localStorage.setItem('nesio-gmail-last-sync', String(Date.now()));
        }
        parts.push(L(dict, `邮件:读取 ${data.emailCount ?? data.messages?.length ?? 0} 封,提取 ${nodeCount} 条`, `Mail: read ${data.emailCount ?? data.messages?.length ?? 0}, extracted ${nodeCount}`));
      } else {
        allOk = false;
        const isNotConnected = data.error === 'not_connected' || data.error === 'token_expired';
        // 403/insufficient_scope = 旧授权只有日历权限,重新授权会带上邮件读取
        const isApiDisabled = data.error === 'gmail_api_disabled';
        const isScopeMissing = data.error === 'insufficient_scope' || (data.error || '').includes('403');
        if (isNotConnected || (isScopeMissing && !isApiDisabled)) reauth = true;
        parts.push(isApiDisabled
          ? L(dict, '邮件:Google Cloud 项目没启用 Gmail API——去 console.cloud.google.com 的「API 和服务→库」搜 Gmail API 点启用(重新授权解决不了这个)', 'Mail: Gmail API is not enabled on the Google Cloud project — enable it under APIs & Services → Library (reauthorizing will not fix this)')
          : isScopeMissing
          ? L(dict, '邮件:当前授权不含邮件权限,点「重新授权」补上邮件读取', 'Mail: consent lacks Gmail access — tap Reauthorize to add mail read')
          : isNotConnected
            ? L(dict, '邮件:授权已失效,需重新授权', 'Mail: authorization expired, reconnect needed')
            : L(dict, `邮件:同步失败(${data.error || '未知'})`, `Mail: sync failed (${data.error || 'unknown'})`));
      }
    } catch { allOk = false; parts.push(L(dict, '邮件:网络错误', 'Mail: network error')); }

    saveConnectorState('google', true);
    setConnected((p) => ({ ...p, google: true }));
    setOauthSyncResult((p) => ({ ...p, google: { ok: allOk, msg: allOk ? L(dict, '同步成功', 'Synced') : L(dict, '部分同步失败', 'Partly failed'), detail: parts.join('\n'), needsReauth: reauth } }));
    showToast(parts.join(' · '), allOk);
    window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
    window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
    setSyncing(null);
  }

  async function saveCalendarEventsToMemory(events: Array<Record<string, unknown>>): Promise<number> {
    const { getLifeGraph } = await import('@/lib/portal/life-graph');
    const now = Date.now();
    const windowEnd = now + 60 * 86_400_000;
    const existingCalIds = new Set(
      getLifeGraph().filter((n) => n.source === 'calendar')
        .map((n) => n.attributes.calendarId as string).filter(Boolean),
    );
    let added = 0;
    events.forEach((evAny) => {
      const start = evAny.start as string | undefined;
      const title = evAny.title as string | undefined;
      if (!start || !title) return;
      const t = new Date(start).getTime();
      if (t < now - 86_400_000 || t > windowEnd) return;
      const calId = (evAny.id as string) || `${title}-${start}`;
      if (existingCalIds.has(calId)) return;
      ingestLifeNode({
        name: title,
        type: 'event',
        source: 'calendar',
        confidence: 1,
        rawInput: title,
        tags: [(evAny.calendarName as string) || '日历'].filter(Boolean),
        attributes: {
          start,
          ...(evAny.end ? { end: evAny.end as string } : {}),
          ...(evAny.url ? { url: evAny.url as string } : {}),
          ...(evAny.location ? { location: evAny.location as string } : {}),
          ...(evAny.description ? { note: (evAny.description as string).slice(0, 300) } : {}),
          calendarId: calId,
          calendarName: (evAny.calendarName as string) || '',
        },
        relations: [],
      });
      added++;
    });
    return added;
  }

  // ── OAuth sync (Gmail / Calendar 旧入口,google 合并后仅内部保留) ──
  async function syncOAuth(c: ConnectorDef) {
    if (c.id === 'google') { await syncGoogle(c); return; }
    setSyncing(c.id);
    setOauthSyncResult((p) => ({ ...p, [c.id]: { ok: true, msg: L(dict, '同步中…', 'Syncing…') } }));
    try {
      if (c.id === 'gmail') {
        const res = await fetch('/api/portal/gmail?includeBody=true&analyze=true');
        const data = await res.json() as {
          ok?: boolean; nodes?: NodeInput[]; error?: string;
          emailCount?: number; count?: number; messages?: unknown[];
        };
        if (!data.ok) {
          const isNotConnected = data.error === 'not_connected' || data.error === 'token_expired';
          const detail = isNotConnected
            ? L(dict, 'OAuth token 已失效，请重新授权', 'OAuth token expired — please reconnect')
            : L(dict, `error: ${data.error || '未知'} | HTTP ${res.status}`, `error: ${data.error || 'unknown'} | HTTP ${res.status}`);
          setOauthSyncResult((p) => ({ ...p, gmail: { ok: false, msg: isNotConnected ? L(dict, '需要重新授权', 'Reauth needed') : L(dict, '同步失败', 'Sync failed'), detail, needsReauth: isNotConnected } as SyncResult }));
          showToast(isNotConnected ? L(dict, 'Gmail token 已失效，点击重新授权', 'Gmail token expired — tap to reconnect') : L(dict, `Gmail 同步失败：${data.error || '未知'}`, `Gmail sync failed: ${data.error || 'unknown'}`), false);
        } else {
          const nodeCount = data.nodes?.length ?? 0;
          const emailCount = data.emailCount ?? data.messages?.length ?? 0;
          if (nodeCount > 0) {
            const { addLifeNode } = await import('@/lib/portal/life-graph');
            data.nodes!.forEach((n) => ingestLifeNode({ ...n, source: 'email' } as Parameters<typeof addLifeNode>[0]));
            localStorage.setItem('nesio-gmail-last-sync', String(Date.now()));
            window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
          }
          setCounts((p) => ({ ...p, gmail: nodeCount }));
          const detail = L(dict, `读取 ${emailCount} 封邮件 · 提取 ${nodeCount} 个节点`, `Read ${emailCount} emails · extracted ${nodeCount} nodes`);
          setOauthSyncResult((p) => ({ ...p, gmail: { ok: true, msg: L(dict, '同步成功', 'Synced'), detail } }));
          showToast(detail, true);
        }
      } else if (c.id === 'calendar') {
        const res = await fetch('/api/portal/calendar', { cache: 'no-store' });
        const data = await res.json() as {
          ok?: boolean; events?: Array<Record<string, unknown>>; feeds?: Array<{ label: string; ok: boolean; count: number; error?: string }>;
          error?: string; message?: string; provider?: string;
        };
        const feedSummary = data.feeds?.map((f) => f.label + ': ' + (f.ok ? L(dict, f.count + '条', String(f.count)) : L(dict, '失败(' + (f.error || '?') + ')', 'failed (' + (f.error || '?') + ')'))).join(' · ') || '';
        if (!data.ok || !data.events?.length) {
          const detail = [
            `HTTP ${res.status}`,
            data.message || data.error || '',
            feedSummary,
          ].filter(Boolean).join(' | ');
          setOauthSyncResult((p) => ({ ...p, calendar: { ok: false, msg: L(dict, `无日历数据`, 'No calendar data'), detail } }));
          showToast(L(dict, `日历这次没同步上，稍后再试。（${data.message || data.error || '无事件'}）`, `Calendar didn't sync this time — try again later. (${data.message || data.error || 'no events'})`), false);
        } else {
          const count = data.events.length;
          const { saveCalendarToLocal } = await import('@/lib/portal/calendar-local-store');
          const calEvents = data.events as Parameters<typeof saveCalendarToLocal>[0];
          saveCalendarToLocal(calEvents);

          // Also save upcoming events to LifeGraph so Memory tab reflects the sync
          const { getLifeGraph } = await import('@/lib/portal/life-graph');
          const now = Date.now();
          const windowEnd = now + 60 * 86_400_000;
          const existingCalIds = new Set(
            getLifeGraph().filter((n) => n.source === 'calendar')
              .map((n) => n.attributes.calendarId as string).filter(Boolean),
          );
          let lifeGraphAdded = 0;
          calEvents.forEach((ev) => {
            const evAny = ev as Record<string, unknown>;
            const start = evAny.start as string | undefined;
            const title = evAny.title as string | undefined;
            if (!start || !title) return;
            const t = new Date(start).getTime();
            if (t < now - 86_400_000 || t > windowEnd) return;
            const calId = (evAny.id as string) || `${title}-${start}`;
            if (existingCalIds.has(calId)) return;
            ingestLifeNode({
              name: title,
              type: 'event',
              source: 'calendar',
              confidence: 1,
              rawInput: title,
              tags: [(evAny.calendarName as string) || '日历'].filter(Boolean),
              attributes: {
                start,
                ...(evAny.end ? { end: evAny.end as string } : {}),
                ...(evAny.url ? { url: evAny.url as string } : {}),
                ...(evAny.location ? { location: evAny.location as string } : {}),
                ...(evAny.description ? { note: (evAny.description as string).slice(0, 300) } : {}),
                calendarId: calId,
                calendarName: (evAny.calendarName as string) || '',
              },
              relations: [],
            });
            lifeGraphAdded++;
          });

          setCounts((p) => ({ ...p, calendar: count }));
          const detail = L(dict,
            `${feedSummary || `来源: ${data.provider || '?'}`} · ${count} 条事件${lifeGraphAdded > 0 ? ` · ${lifeGraphAdded} 条加入记忆` : ''}`,
            `${feedSummary || `source: ${data.provider || '?'}`} · ${count} events${lifeGraphAdded > 0 ? ` · ${lifeGraphAdded} added to memory` : ''}`);
          setOauthSyncResult((p) => ({ ...p, calendar: { ok: true, msg: L(dict, '同步成功', 'Synced'), detail } }));
          showToast(L(dict, `日历同步成功：${count} 条事件`, `Calendar synced: ${count} events`), true);
          window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
          window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : L(dict, '网络错误', 'network error');
      setOauthSyncResult((p) => ({ ...p, [c.id]: { ok: false, msg: L(dict, '同步失败', 'Sync failed'), detail: msg } }));
      showToast(L(dict, `这次没同步上（${msg}）。稍后再试一次就好。`, `Didn't sync this time (${msg}). Try again in a bit.`), false);
    }
    setSyncing(null);
  }

  // ── OAuth / Geo / File ──
  function handleConnect(c: ConnectorDef) {
    if (c.comingSoon) return;
    // 一次 Google 授权覆盖日历+邮件两个 scope(gmail/connect 请求全量 scope)
    if (c.id === 'google') { window.location.href = '/api/portal/gmail/connect'; return; }
    if (c.method === 'geo') {
      setSyncing(c.id);
      navigator.geolocation.getCurrentPosition(
        () => { saveConnectorState('weather', true); setConnected((p) => ({ ...p, weather: true })); setSyncing(null); window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed')); showToast(L(dict, '位置已授权', 'Location granted'), true); },
        () => { setSyncing(null); showToast(L(dict, '位置权限被拒绝', 'Location permission denied'), false); },
        { timeout: 8000 },
      );
      return;
    }
    if (c.id === 'health') { fileRef.current?.click(); return; }
    // Notion:先走 OAuth(服务端未配 NOTION_CLIENT_ID 会带 error 跳回,给出指引)
    if (c.id === 'notion' && !loadToken('notion')) { window.location.href = '/api/portal/notion/connect'; return; }
    if (c.method === 'token') { syncToken(c); return; }
    if (c.method === 'server') { syncFlomo(c); return; }
    if (c.method === 'shortcuts') { setShortcutsFor(c.id); return; }
  }

  async function handleHealthFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (file.name.endsWith('.zip')) { showToast(L(dict, '请先解压 zip，上传里面的 export.xml', 'Unzip first, then upload the export.xml inside'), false); return; }
    setSyncing('health');
    try {
      const text = await file.text();
      const res = await fetch('/api/portal/health', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ xml: text }) });
      const data = await res.json() as { ok?: boolean; nodes?: NodeInput[]; count?: number };
      if (data.ok && data.nodes?.length) {
        saveNodes(data.nodes, 'system');
        saveConnectorState('health', true);
        setConnected((p) => ({ ...p, health: true }));
        setCounts((p) => ({ ...p, health: data.count || 0 }));
        showToast(L(dict, `已提取 ${data.count} 个健康节点`, `Extracted ${data.count} health nodes`), true);
      } else showToast(L(dict, '未识别到健康数据', 'No health data recognized'), false);
    } catch { showToast(L(dict, '解析失败', 'Parse failed'), false); }
    setSyncing(null);
  }

  function disconnect(id: string) {
    saveConnectorState(id, false);
    saveToken(id, '');
    setConnected((p) => ({ ...p, [id]: false }));

    // Google connectors share one OAuth consent — really revoke it at
    // Google and clear the HTTP-only token cookies (both providers).
    if (id === 'gmail' || id === 'calendar' || id === 'google') {
      for (const g of ['google', 'gmail', 'calendar'].filter((x) => x !== id)) {
        saveConnectorState(g, false);
        setConnected((p) => ({ ...p, [g]: false }));
      }
      void fetch('/api/portal/oauth/disconnect', { method: 'POST' })
        .then((r) => r.json() as Promise<{ ok?: boolean; revoked?: boolean }>)
        .then((d) => {
          showToast(d.revoked
            ? L(dict, '已断开并撤销 Google 授权（邮件与日历共用授权，已一并断开）', 'Disconnected and revoked Google access (mail and calendar share one consent — both disconnected)')
            : L(dict, '已断开并清除本地 token（邮件与日历一并断开）', 'Disconnected and cleared local tokens (mail and calendar both)'), true);
        })
        .catch(() => showToast(L(dict, '已断开本地连接，撤销请求失败——可在 Google 账号安全页手动移除', 'Disconnected locally; revoke request failed — remove it manually in Google account security'), false));
    }
  }

  function copyIngestUrl() {
    navigator.clipboard?.writeText(ingestUrl).then(() => showToast(L(dict, '接入地址已复制', 'Ingest URL copied'), true)).catch(() => {});
  }

  if (!open) return null;

  const def = (id: string) => CONNECTORS.find((c) => c.id === id)!;

  return (
    <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label={L(dict, '数据接入', 'Data sources')}>
      <input ref={fileRef} type="file" accept=".xml,.zip" style={{ display: 'none' }} onChange={handleHealthFile} />
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-settings-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">{L(dict, '数据接入', 'Data sources')}</h2>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose}>✕</button>
        </div>
        <p className="nesio-settings-sheet-desc">{L(dict, '连接外部信号源，让 Today Feed 出现真实数据驱动的建议。', 'Connect outside signals so Today runs on real data.')}</p>

        {toast && (
          <div style={{ background: toast.ok ? 'var(--status-go-soft)' : 'var(--status-risk-soft)', border: `1px solid ${toast.ok ? 'var(--status-go)' : 'var(--status-risk)'}`, borderRadius: '0.75rem', padding: '0.65rem 0.85rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: toast.ok ? 'var(--status-go)' : 'var(--status-risk)' }}>
            {toast.ok ? '✓ ' : ''}{toast.msg}
          </div>
        )}

        <div className="nesio-settings-sheet-body">
          {CONNECTORS.filter((c) => !c.dev).map((c) => {
            const isConn = c.id === 'google'
              ? Boolean(connected.google || connected.calendar || connected.gmail)
              : connected[c.id];
            const isSync = syncing === c.id;
            const cnt = counts[c.id];
            return (
              <div key={c.id}>
                <div className="nesio-connector-row">
                  <span className="nesio-connector-icon" style={{ background: c.iconBg }}>{c.icon}</span>
                  <div className="nesio-connector-body">
                    <p className="nesio-connector-name">
                      {dict === 'en' ? (c.nameEn ?? c.name) : c.name}
                      {c.comingSoon && <span className="nesio-connector-soon">{L(dict, '即将上线', 'Coming soon')}</span>}
                      {c.method === 'shortcuts' && !c.comingSoon && <span className="nesio-connector-soon" style={{ background: 'rgba(88,140,227,0.12)', color: 'var(--portal-blue-deep)' }}>{L(dict, '快捷指令', 'Shortcuts')}</span>}
                    </p>
                    <p className="nesio-connector-desc">{dict === 'en' ? (c.descriptionEn ?? c.description) : c.description}</p>
                    {isConn && !oauthSyncResult[c.id] && <p className="nesio-connector-sync">{isSync ? L(dict, '同步中…', 'Syncing…') : L(dict, '已连接', 'Connected')}{cnt ? L(dict, `  ·  ${cnt} 个节点`, `  ·  ${cnt} nodes`) : ''}</p>}
                    {oauthSyncResult[c.id] && (
                      <p className="nesio-connector-sync" style={{ color: oauthSyncResult[c.id].ok ? 'var(--status-go)' : 'var(--status-risk)', fontSize: '0.68rem', lineHeight: 1.4 }}>
                        {oauthSyncResult[c.id].msg}
                        {oauthSyncResult[c.id].detail && <><br /><span style={{ opacity: 0.8, whiteSpace: 'pre-line' }}>{oauthSyncResult[c.id].detail}</span></>}
                        {oauthSyncResult[c.id].needsReauth && (
                          <><br /><button type="button" style={{ marginTop: '0.25rem', fontSize: '0.68rem', color: 'var(--portal-blue-deep)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }} onClick={() => handleConnect(c)}>{L(dict, '点击重新授权 →', 'Tap to reconnect →')}</button></>
                        )}
                      </p>
                    )}
                  </div>

                  {c.comingSoon ? (
                    <span style={{ fontSize: '0.7rem', color: 'var(--portal-muted)', flexShrink: 0 }}>{L(dict, '敬请期待', 'Stay tuned')}</span>
                  ) : c.method === 'shortcuts' ? (
                    <button type="button" className="nesio-connector-connect" onClick={() => setShortcutsFor(shortcutsFor === c.id ? null : c.id)} style={{ flexShrink: 0 }}>
                      {shortcutsFor === c.id ? L(dict, '收起', 'Collapse') : L(dict, '设置', 'Set up')}
                    </button>
                  ) : isConn && (c.method === 'token' || c.method === 'server') ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flexShrink: 0 }}>
                      <button type="button" className="nesio-connector-connect" onClick={() => c.method === 'server' ? syncFlomo(c) : syncToken(c)} disabled={isSync}>{isSync ? '…' : L(dict, '同步', 'Sync')}</button>
                      <button type="button" className="nesio-connector-disconnect" onClick={() => disconnect(c.id)}>{L(dict, '断开', 'Disconnect')}</button>
                    </div>
                  ) : isConn && c.method === 'oauth' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flexShrink: 0 }}>
                      <button type="button" className="nesio-connector-connect" onClick={() => syncOAuth(c)} disabled={isSync}>{isSync ? '…' : L(dict, '同步', 'Sync')}</button>
                      <button type="button" className="nesio-connector-disconnect" onClick={() => disconnect(c.id)}>{L(dict, '断开', 'Disconnect')}</button>
                    </div>
                  ) : isConn ? (
                    <button type="button" className="nesio-connector-disconnect" onClick={() => disconnect(c.id)} style={{ flexShrink: 0 }}>{L(dict, '断开', 'Disconnect')}</button>
                  ) : (
                    <button type="button" className="nesio-connector-connect" onClick={() => handleConnect(c)} disabled={isSync} style={{ flexShrink: 0 }}>
                      {isSync ? '…' : c.method === 'file' ? L(dict, '上传', 'Upload') : L(dict, '接入', 'Connect')}
                    </button>
                  )}
                </div>

                {/* Token input */}
                {tokenInputFor === c.id && (
                  <div className="nesio-connector-token-box">
                    <p style={{ fontSize: '0.72rem', color: 'var(--portal-muted)', marginBottom: '0.5rem', lineHeight: 1.5 }}>{dict === 'en' ? (c.tokenHintEn ?? c.tokenHint) : c.tokenHint}</p>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input className="nesio-ob-input" style={{ marginBottom: 0, flex: 1, fontSize: '0.8rem' }} type="password" placeholder={L(dict, '粘贴 Token…', 'Paste token…')} value={tokenValue} onChange={(e) => setTokenValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitToken(c); }} autoFocus />
                      <button type="button" className="nesio-connector-connect" onClick={() => submitToken(c)} disabled={!tokenValue.trim()}>{L(dict, '连接', 'Connect')}</button>
                    </div>
                  </div>
                )}

                {/* Shortcuts setup */}
                {shortcutsFor === c.id && (
                  <div className="nesio-connector-token-box">
                    <p style={{ fontSize: '0.75rem', color: 'var(--portal-ink)', fontWeight: 600, marginBottom: '0.4rem' }}>{L(dict, '通过 iOS 快捷指令接入', 'Connect via iOS Shortcuts')}</p>
                    <ol style={{ fontSize: '0.72rem', color: 'var(--portal-muted)', lineHeight: 1.7, paddingLeft: '1.1rem', marginBottom: '0.6rem' }}>
                      <li>{L(dict, '打开「快捷指令」App，新建快捷指令', 'Open the Shortcuts app and create a new shortcut')}</li>
                      <li>{L(dict, '添加动作「获取 URL 内容」', 'Add the "Get Contents of URL" action')}</li>
                      <li>{L(dict, 'URL 填下方地址，方法选 ', 'Use the URL below, method ')}<strong>POST</strong></li>
                      <li>{L(dict, '请求体 JSON：', 'Request body JSON: ')}<code style={{ fontSize: '0.68rem' }}>{L(dict, `{"source":"${c.ingestSource}","content":"数据内容"}`, `{"source":"${c.ingestSource}","content":"your data"}`)}</code></li>
                      <li>{L(dict, '可设为自动化，定时推送', 'Optionally automate it on a schedule')}</li>
                    </ol>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <code style={{ flex: 1, fontSize: '0.68rem', background: 'rgba(88,140,227,0.08)', padding: '0.4rem 0.6rem', borderRadius: '0.5rem', wordBreak: 'break-all', color: 'var(--portal-ink)' }}>{ingestUrl}</code>
                      <button type="button" className="nesio-connector-connect" onClick={copyIngestUrl} style={{ flexShrink: 0 }}>{L(dict, '复制', 'Copy')}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* ── 开发中 · 折叠二级(以后慢慢开发的接入不占主列表) ── */}
          <details className="nesio-conn-dev-group" style={{ marginTop: '0.9rem', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)', padding: '0.15rem 0.75rem' }}>
            <summary style={{ cursor: 'pointer', padding: '0.6rem 0', fontSize: '0.82rem', color: 'var(--portal-muted)', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                <span style={{ color: 'var(--portal-ink)', fontWeight: 600 }}>{L(dict, '开发中 · 抢先看', 'In development · preview')}</span>
                <span style={{ marginLeft: 8, fontSize: '0.7rem' }}>{CONNECTORS.filter((c) => c.dev).length} {L(dict, '项在打磨', 'being polished')}</span>
              </span>
              <span aria-hidden>▾</span>
            </summary>
            {CONNECTORS.filter((c) => c.dev).map((c) => renderDevRow(c))}
          </details>

          <div style={{ marginTop: '1rem', fontSize: '0.72rem', color: 'var(--portal-muted)', textAlign: 'center', lineHeight: 1.6 }}>
            {L(dict, '有 API 的（Google 日历+Gmail / Notion / Toggl / Flomo）直接连接；', 'API sources (Google Calendar+Gmail / Notion / Toggl / Flomo) connect directly;')}<br />
            {L(dict, '没有公开 API 的（提醒事项 / Keep / 微信读书）通过快捷指令推送。', 'no-API sources (Reminders / Keep / WeRead) push via Shortcuts.')}<br />
            {L(dict, '所有数据仅在你的设备上处理和存储。', 'All data is processed and stored on your device only.')}
          </div>
        </div>
      </div>
    </div>
  );
}
