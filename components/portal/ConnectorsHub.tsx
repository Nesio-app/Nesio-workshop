'use client';

import { useEffect, useRef, useState } from 'react';
import { IconActivity, IconBook, IconBookOpen, IconCalendar, IconCar, IconCheckSquare, IconCloudSun, IconHeartPulse, IconMail, IconNote, IconTimer , IconImage, IconMapPin, IconCard } from './icons';
import dynamic from 'next/dynamic';
const WechatReadingImportSheet = dynamic(() => import('./WechatReadingImportSheet'), { ssr: false });
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { runPlaidSync, runFlomoSync, saveCalendarEventsToMemory } from '@/lib/portal/connector-sync';
import { type LifeNode, pruneNotionNodes } from '@/lib/portal/life-graph';
import type { HealthMetrics, HealthNode } from '@/lib/portal/apple-health';
import { readLaunchSurfaceContextFromBrowser } from '@/lib/portal/launch-surface.mjs';
import { L } from '@/lib/portal/i18n';
import { InfoTip } from './InfoTip';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { markBusy } from '@/lib/portal/app-busy';
import { isPro } from '@/lib/portal/entitlement';
import { isLabModeOn } from '@/lib/portal/module-overrides';

interface ConnectorsHubProps { open: boolean; onClose: () => void; }

type ConnMethod = 'oauth' | 'geo' | 'file' | 'server' | 'token' | 'shortcuts' | 'batch-photos';
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
  // 批次 21:银行流水(Plaid)—— Link 授权后增量同步交易,明细只存本机
  { id: 'plaid', name: '银行流水 · Plaid', nameEn: 'Bank feed · Plaid', icon: <IconCard />, iconBg: 'var(--chip-fog)', method: 'oauth', description: '连接美国银行账户,交易流水增量同步(明细只存本机)', descriptionEn: 'Link a US bank account; transactions sync incrementally (details stay on-device)' },
  // 批次 21:Google 地图时间轴导入 —— 手机端导出的 JSON 并入地点足迹
  { id: 'timeline', name: 'Google 时间轴导入', nameEn: 'Google Timeline import', icon: <IconMapPin />, iconBg: 'var(--chip-leaf)', method: 'file', description: '手机 Google 地图 → 设置 → 时间轴 → 导出数据,把 JSON 传进来并入地点足迹', descriptionEn: 'Google Maps app → Settings → Timeline → export, upload the JSON to merge into your place trail' },
  // 批次 19:相册批量导入 —— 一次选多张,AI 逐张识别入库(解决「一张张传太麻烦」)
  { id: 'photos', name: '相册批量导入', nameEn: 'Batch photo import', icon: <IconImage />, iconBg: 'var(--chip-frost)', method: 'batch-photos', description: '一次选多张照片,自动识别成记忆(每批最多 10 张)', descriptionEn: 'Pick multiple photos; each is recognized into memories (up to 10 per batch)' },
  { id: 'flomo', name: 'Flomo', icon: <IconNote />, iconBg: 'var(--chip-indigo)', method: 'server', syncEndpoint: '/api/portal/flomo?limit=5000', description: '同步 flomo 笔记，提取想法与记录', descriptionEn: 'Sync flomo notes; extract ideas and records' },
  // 批次 18:Notion 转正 —— OAuth 一键授权(像 flomo 那样选页面),内部 token 流保留为回退
  { id: 'notion', name: 'Notion', icon: <IconBook />, iconBg: 'var(--chip-gray)', method: 'token', syncEndpoint: '/api/portal/notion', tokenHint: 'notion.so/my-integrations → 新建集成(Internal)→ 复制 Internal Integration Secret(ntn_… 或 secret_…)→ 在要同步的 Notion 页面右上角「…」→ 连接 → 选中这个集成', tokenHintEn: 'notion.so/my-integrations → New internal integration → copy the secret (ntn_… / secret_…) → on each page: ••• → Connections → add this integration', description: '粘贴内部集成 token,同步共享给它的页面(提取项目与想法)', descriptionEn: 'Paste an internal integration token to sync the pages you shared with it' },
  { id: 'toggl', name: 'Toggl Track', icon: <IconTimer />, iconBg: 'var(--chip-red)', method: 'token', syncEndpoint: '/api/portal/toggl', tokenHint: 'track.toggl.com → Profile → API Token', tokenHintEn: 'track.toggl.com → Profile → API Token', description: '同步时间记录，了解你的专注分布', descriptionEn: 'Sync time entries to see where your focus goes', dev: true },
  { id: 'health', name: 'Apple Health 导出', nameEn: 'Apple Health export', icon: <IconHeartPulse />, iconBg: 'var(--chip-pink)', method: 'file', description: '直接传导出的 zip 或 export.xml,提取步数、睡眠、心率、锻炼', descriptionEn: 'Drop the exported zip or export.xml — extracts steps, sleep, heart rate, workouts' },
  { id: 'reminder', name: 'Apple 提醒事项', nameEn: 'Apple Reminders', icon: <IconCheckSquare />, iconBg: 'var(--chip-amber)', method: 'shortcuts', ingestSource: 'reminder', description: '通过快捷指令推送提醒，自动转为承诺', descriptionEn: 'Push reminders via Shortcuts; they become commitments', dev: true },
  { id: 'keep', name: 'Keep 健康', nameEn: 'Keep fitness', icon: <IconActivity />, iconBg: 'var(--chip-green)', method: 'shortcuts', ingestSource: 'keep', description: '通过快捷指令推送运动数据（点设置看步骤）', descriptionEn: 'Push workout data via Shortcuts (tap Set up for steps)' },
  // 批次 22:微信读书无开放 API —— App 内导出笔记,粘贴文本解析入库
  { id: 'wechat_reading', name: '微信读书', nameEn: 'WeChat Reading', icon: <IconBookOpen />, iconBg: 'var(--chip-leaf)', method: 'file', description: '微信读书 App 导出笔记,粘进来解析成划线记忆', descriptionEn: 'Export notes from WeChat Reading and paste to parse highlights' },
  // 批次 22:微信公众号/视频收藏无 API —— 说明可用路径,不做假按钮
  { id: 'wechat_fav', name: '微信收藏 · 公众号/视频', nameEn: 'WeChat favorites', icon: <IconBook />, iconBg: 'var(--chip-mint)', method: 'file', dev: true, description: '公众号文章 / 视频号收藏没有开放接口。可用:① 打开文章 → 分享 → 复制链接 → 用「分享给 Nesio」或冷冻仓存入;② 关注 flomo 服务号,收藏自动进 flomo,再用 Flomo 同步。', descriptionEn: 'Official-account articles and Channels favorites have no public API. Options: ① copy the article link and use Share to Nesio; ② follow flomo\'s service account so favorites flow into flomo, then use Flomo sync.' },
  { id: 'tesla', name: 'Tesla', icon: <IconCar />, iconBg: 'var(--chip-green)', method: 'oauth', description: '只读接入:通勤/停放状态与充电记录(充电花费自动进财务),不发任何车控指令', descriptionEn: 'Read-only: commute/parked state and charging records (charging cost flows into finance); never sends vehicle commands' },
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

// 批次 38:用户选定的 Notion 数据库 id(每行存成一条记忆)。
const NOTION_DB_KEY = 'nesio-notion-db-v1';
function loadNotionDbs(): string[] {
  try { const v = JSON.parse(localStorage.getItem(NOTION_DB_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function saveNotionDbs(ids: string[]) {
  try { localStorage.setItem(NOTION_DB_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
}

interface SyncResult { ok: boolean; msg: string; detail?: string; needsReauth?: boolean }

export default function ConnectorsHub({ open, onClose }: ConnectorsHubProps) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const fileRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<HTMLInputElement>(null);
  const timelineRef = useRef<HTMLInputElement>(null);
  const [wechatReadingOpen, setWechatReadingOpen] = useState(false);
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState<string | null>(null);
  // P0 隐私:连接私有数据源(邮箱/日历/银行/Notion/Flomo)必须先登录 —— 匿名授权=无主
  // token,换人用这台设备就能看到你的邮件。null=未知(网络失败不误伤),false 才拦。
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [importPct, setImportPct] = useState<number | null>(null); // 健康大文件导入进度(0–100)
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [tokenInputFor, setTokenInputFor] = useState<string | null>(null);
  const [tokenValue, setTokenValue] = useState('');
  const [shortcutsFor, setShortcutsFor] = useState<string | null>(null);
  const [ingestUrl, setIngestUrl] = useState('');
  const [oauthSyncResult, setOauthSyncResult] = useState<Record<string, SyncResult>>({});
  // 批次 38:Notion 数据库选择器
  const [notionDbLoading, setNotionDbLoading] = useState(false);
  const [notionDbList, setNotionDbList] = useState<Array<{ id: string; title: string }> | null>(null);
  const [notionDbSel, setNotionDbSel] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    // 私有数据源连接门:查一次会话(失败=未知,不误伤)
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { loggedIn?: boolean } | null) => { if (d != null) setSignedIn(Boolean(d.loggedIn)); })
      .catch(() => {});
    const savedConn = loadConnectors();
    // 批次 37:有 Notion token 就算已连接 —— 连接(token 有效)和有没有共享页面是两回事。
    // 之前只在「同步成功且返回了页面」才翻成已连接,导致 token 已存但没共享页面时按钮
    // 永远停在「接入」,用户以为没连上。
    if (loadToken('notion')) savedConn.notion = true;
    setConnected(savedConn);
    setIngestUrl(`${window.location.origin}/api/portal/ingest`);
    // 批次 39:OAuth 连过(cookie token,没有本地 token)也要翻成已连接。
    // Notion 修:授权可能在另一个浏览器完成(token 落 Supabase),回到本 App
    // 前台时重查一次,按钮自动翻,不用重启。
    const checkNotionStatus = () => {
      fetch('/api/portal/notion/status')
        .then((r) => r.json())
        .then((d: { connected?: boolean }) => { if (d.connected) setConnected((p) => ({ ...p, notion: true })); })
        .catch(() => undefined);
    };
    checkNotionStatus();
    const onVisible = () => { if (document.visibilityState === 'visible') checkNotionStatus(); };
    document.addEventListener('visibilitychange', onVisible);
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
    } else if (err === 'state_mismatch' || err === 'state_expired') {
      showToast(L(dict,
        'Notion 授权返回校验未通过(常见于超时或在别的浏览器打开)。请回到 Nesio 再点一次「连接」;若反复失败,改用粘贴 token 最稳。',
        'Notion authorization check failed (timeout or opened in a different browser). Tap Connect again from Nesio; if it keeps failing, paste a token instead.'), false);
    } else if (err === 'token_failed') {
      showToast(L(dict,
        'Notion 换取令牌失败,请重试;若反复失败,改用粘贴 token。',
        'Notion token exchange failed — try again, or paste a token instead.'), false);
    } else if (err === 'gmail_scope_not_granted') {
      showToast(L(dict,
        'Google 没有授出邮件权限:需在 Google Cloud 同意屏幕配置 gmail.readonly(测试模式下把自己加为测试用户)',
        "Google didn't grant Gmail access: add gmail.readonly on the OAuth consent screen (and add yourself as a test user while in Testing)"), false);
    } else if (err) {
      showToast(L(dict, `连接失败：${err}`, `Connection failed: ${err}`), false);
    }
    return () => document.removeEventListener('visibilitychange', onVisible);
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


  // ── 批次 19:相册批量导入 ──
  async function fileToJpegBase64(file: File, maxDim = 1280): Promise<string> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  }

  async function handleBatchPhotos(files: FileList | null) {
    const list = Array.from(files || []).slice(0, 10);
    if (!list.length) return;
    setSyncing('photos');
    let saved = 0; let failed = 0;
    for (let i = 0; i < list.length; i++) {
      showToast(L(dict, `识别中 ${i + 1} / ${list.length}…`, `Recognizing ${i + 1} / ${list.length}…`), true);
      try {
        const base64 = await fileToJpegBase64(list[i]);
        const res = await fetch('/api/portal/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-baohe-access-mode': 'personal_lab' },
          body: JSON.stringify({
            type: 'image',
            content: L(dict, '请只根据图片里真实可见的内容生成 Memory 节点:优先具体物品、文件、小票条目、场景;不要把指令当节点名。', 'Generate Memory nodes only from what is actually visible in the image: prefer concrete items, documents, receipt line-items, scenes; never use this instruction as a node name.'),
            imageBase64: base64,
            mimeType: 'image/jpeg',
            uiLocale: dict,
          }),
        });
        const data = await res.json() as { ok?: boolean; nodes?: Array<Omit<NodeInput, 'source'>> };
        const nodes = (data.ok && data.nodes) || [];
        const savedForThis = nodes.map((n) => ingestLifeNode({ ...n, source: 'photo', tags: [...(n.tags || []), '批量导入'] } as NodeInput));
        // 批次 23:每张导入的照片也存本机,挂到该照片的第一个节点上(可看图、可问一问)
        if (savedForThis.length > 0) {
          try {
            const { compressToDataUrl, putLocalImage } = await import('@/lib/portal/local-image-store');
            const { updateLifeNode } = await import('@/lib/portal/life-graph');
            const dataUrl = await compressToDataUrl(list[i]);
            const imgId = `img-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
            await putLocalImage(imgId, dataUrl);
            const ex = savedForThis[0].assets || [];
            updateLifeNode(savedForThis[0].id, { assets: [...ex, { id: imgId, kind: 'image', mimeType: 'image/jpeg', local: true, createdAt: new Date().toISOString() }] });
          } catch { /* 图存本机失败不影响文字入库 */ }
        }
        saved += nodes.length;
        if (!nodes.length) failed++;
      } catch { failed++; }
    }
    setSyncing(null);
    setCounts((p) => ({ ...p, photos: saved }));
    saveConnectorState('photos', true);
    setConnected((p) => ({ ...p, photos: true }));
    window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
    showToast(L(dict,
      `批量导入完成:${list.length} 张照片,入库 ${saved} 条${failed ? `,${failed} 张没识别出内容` : ''}`,
      `Batch done: ${list.length} photos, ${saved} memories saved${failed ? `, ${failed} unrecognized` : ''}`), failed === 0);
  }




  // ── 批次 23:Notion 连接(先预检配置)──
  async function connectNotion() {
    setSyncing('notion');
    try {
      const res = await fetch('/api/portal/notion/status');
      const data = await res.json() as { ok?: boolean; configured?: boolean };
      if (!data.configured) {
        showToast(L(dict,
          'Notion 还没配置:notion.so/my-integrations 建 Public integration(选 OAuth),把 client ID/secret 配到 Vercel(NOTION_CLIENT_ID / NOTION_CLIENT_SECRET),Redirect URI 填 /api/portal/notion/callback',
          'Notion not configured: create a Public integration (OAuth) at notion.so/my-integrations, set NOTION_CLIENT_ID / NOTION_CLIENT_SECRET on Vercel, redirect URI /api/portal/notion/callback'), false);
        setSyncing(null);
        return;
      }
      window.location.href = '/api/portal/notion/connect';
    } catch {
      showToast(L(dict, '网络错误,请重试', 'Network error — try again'), false);
      setSyncing(null);
    }
  }

  // ── 批次 38:Notion 数据库选择器 ──
  async function openNotionPicker() {
    if (notionDbList) { setNotionDbList(null); return; } // 已展开 → 收起
    setNotionDbLoading(true);
    try {
      const res = await fetch('/api/portal/notion/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: loadToken('notion') }),
      });
      const data = await res.json() as { ok?: boolean; databases?: Array<{ id: string; title: string }>; error?: string };
      if (!data.ok) {
        showToast(data.error === 'invalid_token'
          ? L(dict, 'Token 无效,请重新连接', 'Invalid token — reconnect')
          : L(dict, '取数据库列表失败', 'Failed to load databases'), false);
        return;
      }
      if (!data.databases?.length) {
        showToast(L(dict, '没找到共享给集成的数据库。到你要同步的表右上角「…」→ 连接 → 选中这个集成,再来选表。', 'No databases shared with the integration. On each table: ••• → Connections → add this integration, then pick tables.'), false);
        return;
      }
      setNotionDbList(data.databases);
      setNotionDbSel(loadNotionDbs());
    } catch {
      showToast(L(dict, '网络错误', 'Network error'), false);
    } finally {
      setNotionDbLoading(false);
    }
  }

  function toggleNotionDb(id: string) {
    setNotionDbSel((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      saveNotionDbs(next);
      return next;
    });
  }

  // ── 批次 21:Plaid 银行流水 ──
  async function connectPlaid() {
    setSyncing('plaid');
    try {
      const res = await fetch('/api/portal/plaid/link-token', { method: 'POST' });
      const data = await res.json() as { ok?: boolean; linkToken?: string; error?: string; env?: string };
      if (!data.ok || !data.linkToken) {
        const msg = data.error === 'plaid_not_configured'
          ? L(dict, 'Plaid 还没配置:dashboard.plaid.com → Keys 拿 client_id 和 Sandbox secret,配到 Vercel(PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV)', 'Plaid not configured: dashboard.plaid.com → Keys → set PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV on Vercel')
          : data.error === 'auth_required'
          ? L(dict, '连接银行需要先登录 Nesio(数据接入的私有数据都要求登录)', 'Linking a bank requires signing in to Nesio first')
          : L(dict, `Plaid 连接失败:${data.error || '未知'}`, `Plaid connect failed: ${data.error || 'unknown'}`);
        showToast(msg, false);
        setSyncing(null);
        return;
      }
      // Link 前端从官方 CDN 按需加载
      if (!(window as unknown as { Plaid?: unknown }).Plaid) {
        await new Promise<void>((resolve, reject) => {
          const sc = document.createElement('script');
          sc.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
          sc.onload = () => resolve();
          sc.onerror = () => reject(new Error('link_script'));
          document.head.appendChild(sc);
        });
      }
      // 批次 26:环境提示——sandbox 只会出假银行(First Platypus Bank);
      // 要真实银行需 PLAID_ENV=production/development + Vercel 生产环境重新部署
      if (data.env === 'sandbox') {
        showToast(L(dict, '当前是 Plaid 沙盒(只会出假银行)。要连真实银行:Vercel 生产环境设 PLAID_ENV=production 并重新部署', 'Plaid is in Sandbox (test banks only). For real banks set PLAID_ENV=production on Vercel Production and redeploy'), false);
      }
      const Plaid = (window as unknown as { Plaid?: { create: (cfg: object) => { open: () => void } } }).Plaid;
      if (!Plaid) {
        showToast(L(dict, 'Plaid Link 脚本没加载(可能被网络或拦截器挡了),请稍后重试', "Plaid Link script didn't load (network or a blocker may have stopped it) — try again"), false);
        setSyncing(null);
        return;
      }
      const link = Plaid.create({
        token: data.linkToken,
        onSuccess: async (publicToken: string) => {
          // 财务⑥:带上 linkToken —— 多机构一次授权时服务端据此捞出 session 里
          // 全部 item 的 public_token 逐个交换,不再只连上第一家。
          const ex = await fetch('/api/portal/plaid/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publicToken, linkToken: data.linkToken }),
          });
          const exData = await ex.json() as { ok?: boolean; error?: string; items?: number };
          if (exData.ok) {
            saveConnectorState('plaid', true);
            setConnected((p) => ({ ...p, plaid: true }));
            const n = exData.items || 1;
            showToast(n > 1 ? L(dict, `已连接 ${n} 家机构,正在同步流水…`, `${n} institutions linked — syncing…`) : L(dict, '银行已连接,正在同步流水…', 'Bank linked — syncing…'), true);
            void syncPlaid(); // 连上就同步,账户/流水立即可见,不再等用户手点
          } else {
            showToast(L(dict, `绑定失败:${exData.error || '未知'}`, `Link failed: ${exData.error || 'unknown'}`), false);
          }
        },
        onExit: () => { /* 用户取消 */ },
      });
      link.open();
    } catch {
      showToast(L(dict, 'Plaid Link 加载失败,请检查网络', 'Failed to load Plaid Link — check your network'), false);
    }
    setSyncing(null);
  }

  async function syncPlaid(retry = 0) {
    setSyncing('plaid');
    // 数据核心在 connector-sync(与记忆页下拉全同步共用);这里只做 UI:toast/重试/引导重连
    const r = await runPlaidSync();
    if (!r.ok) {
      if (r.error === 'not_connected' || r.error === 'relink_required') {
        showToast(L(dict, '需要(重新)连接银行', 'Bank needs (re)linking'), false);
        void connectPlaid();
      } else if (r.error === 'network') {
        showToast(L(dict, '网络错误', 'Network error'), false);
      } else {
        showToast(L(dict, `流水同步失败:${r.error || '未知'}`, `Sync failed: ${r.error || 'unknown'}`), false);
      }
      setSyncing(null);
      return;
    }
    setCounts((p) => ({ ...p, plaid: r.total }));
    saveConnectorState('plaid', true);
    setConnected((p) => ({ ...p, plaid: true }));
    // 财务⑦:新连接的机构流水在 Plaid 侧要准备几分钟——明示状态并自动再试,不静默空同步
    if (r.pending > 0 && retry < 3) {
      showToast(L(dict, `已同步 ${r.fresh} 笔;还有 ${r.pending} 家机构的流水在准备中(新连接约需几分钟),1 分钟后自动再试`, `Synced ${r.fresh}; ${r.pending} institution(s) still preparing transactions (takes a few minutes) — retrying in 1 min`), true);
      setTimeout(() => { void syncPlaid(retry + 1); }, 60_000);
    } else if (r.pending > 0) {
      showToast(L(dict, `还有 ${r.pending} 家机构的流水仍在准备中,先保存已同步的,几分钟后再点「同步」即可`, `${r.pending} institution(s) still preparing — synced data saved; tap Sync again in a few minutes`), false);
    } else {
      // 财务㉒:富化覆盖诊断 —— 一眼分辨「数据没来」还是「UI 没显示」
      showToast(L(dict, `流水同步完成:新增 ${r.fresh} 笔,共 ${r.total} 笔,${r.accounts} 个账户(商户 logo 覆盖 ${r.withLogo} 笔)。到「洞察 → 财务」看总览/预算/交易`, `Synced: ${r.fresh} new, ${r.total} total, ${r.accounts} accounts (${r.withLogo} tx with merchant logos). See Insights → Finance`), true);
    }
    // 投资可见失败态:有投资账户但没拉到持仓/流水 —— 不再静默,给出原因 + 出路(多为需断开重连券商)。
    const inv = r.investments;
    if (inv && inv.accounts > 0 && inv.holdings === 0 && inv.transactions === 0) {
      const relink = /CONSENT|NOT_SUPPORTED|PRODUCT/i.test(inv.error || '');
      showToast(L(dict,
        `识别到 ${inv.accounts} 个投资账户,但没拉到持仓/流水${inv.error ? `(${inv.error})` : ''}。${relink ? '多半是这个账户没授权 Plaid 的 investments 产品 —— 断开重连一次券商账户即可;若仍不行,是 Plaid 后台未开通 Investments 产品。' : '稍后再同步一次;持续为空则需断开重连券商账户。'}`,
        `Found ${inv.accounts} investment account(s) but no holdings/transactions${inv.error ? ` (${inv.error})` : ''}. ${relink ? "Likely this item isn't authorized for Plaid's investments product — disconnect and re-link the brokerage. If it persists, enable the Investments product in the Plaid dashboard." : 'Try syncing again; if it stays empty, disconnect and re-link the brokerage.'}`), false);
    }
    setSyncing(null);
  }

  // ── 批次 21:Google 时间轴 JSON 导入 ──
  async function handleTimelineFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setSyncing('timeline');
    try {
      const { parseGoogleTimeline, mergeImportedVisits } = await import('@/lib/portal/place-trail');
      const json = JSON.parse(await file.text()) as unknown;
      const visits = parseGoogleTimeline(json);
      if (!visits.length) {
        showToast(L(dict, '没有解析到地点记录:请确认是 Google 地图时间轴导出的 JSON', 'No visits found — make sure this is the Google Maps Timeline export JSON'), false);
      } else {
        const added = mergeImportedVisits(visits);
        saveConnectorState('timeline', true);
        setConnected((p) => ({ ...p, timeline: true }));
        setCounts((p) => ({ ...p, timeline: added }));
        showToast(L(dict, `时间轴导入完成:解析 ${visits.length} 段,新增 ${added} 条足迹(洞察 → 分析 → 地点足迹)`, `Timeline imported: ${visits.length} segments parsed, ${added} new visits (Insights → Analytics → Place trail)`), true);
      }
    } catch {
      showToast(L(dict, '文件不是有效的 JSON', 'Not a valid JSON file'), false);
    }
    setSyncing(null);
  }

  // ── Token-based sync (Notion, Toggl) ──
  async function syncToken(c: ConnectorDef) {
    const token = loadToken(c.id);
    // Notion OAuth:cookie 里有授权时不需要本地 token,直接空 body 同步
    if (!token && c.id !== 'notion') { setTokenInputFor(c.id); setTokenValue(''); return; }
    setSyncing(c.id);
    try {
      // Notion 选定数据源 → N-3 结构折叠:一本书一条记忆(划线折进书里),丢日历/技术列。
      // N-5:N-0 的暂停已撤销 —— 折叠管道上线后逐行倒的噪声问题已根治,恢复同步。
      const notionDbs = c.id === 'notion' ? loadNotionDbs() : [];
      const res = await fetch(c.syncEndpoint!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notionDbs.length ? { token, databaseIds: notionDbs } : { token }),
      });
      const data = await res.json() as { ok?: boolean; nodes?: NodeInput[]; error?: string; pageCount?: number; aiUsed?: boolean; folded?: boolean };
      if (!data.ok) {
        if (data.error === 'not_connected' && c.id === 'notion') {
          setSyncing(null);
          window.location.href = '/api/portal/notion/connect';
          return;
        }
        // 批次 31:token 有效但集成没被授权任何页面 —— 这是 Notion 最常见的坑,给准话。
        if (data.error === 'no_shared_pages') {
          showToast(L(dict, 'Token 有效,但这个集成还没被授权任何页面。到你要同步的 Notion 页面右上角「…」→ 连接 → 选中这个集成,再点同步。', 'Token works, but no pages are shared with this integration. On each Notion page: ••• → Connections → add this integration, then Sync.'), false);
          setSyncing(null); return;
        }
        if (data.error === 'invalid_token') { saveToken(c.id, ''); saveConnectorState(c.id, false); setConnected((p) => ({ ...p, [c.id]: false })); setTokenInputFor(c.id); setTokenValue(''); showToast(L(dict, 'Token 无效，请重新输入', 'Invalid token — please re-enter'), false); }
        else showToast(L(dict, `同步失败：${data.error || '未知'}`, `Sync failed: ${data.error || 'unknown'}`), false);
        setSyncing(null);
        return;
      }
      const n = data.nodes || [];
      saveNodes(n, c.id === 'toggl' ? 'system' : 'manual');
      saveConnectorState(c.id, true);
      setConnected((p) => ({ ...p, [c.id]: true }));
      setCounts((p) => ({ ...p, [c.id]: n.length }));
      // N-6:折叠现在默认就走(没选表也自动发现数据库折叠),按响应的 folded 标志判断,
      //   不再靠「是否选了表」—— 否则自动折叠会误报「未接 AI 按页面存入」。
      if (c.id === 'notion' && data.folded) {
        showToast(n.length
          ? L(dict, `已按结构折叠成 ${n.length} 条记忆(子表已折进对应条目,日历/技术列已丢)`, `Folded into ${n.length} memories by structure (sub-tables nested, calendar/ID columns dropped)`)
          : L(dict, '这些库都是日历/维度表,已跳过(没有可折叠的书/项目等主表)。想导松散页面可在 Notion 里把页面共享给集成。', 'Those databases are all calendar/dimension tables — skipped. To import loose pages, share them with the integration in Notion.'), true);
      } else {
        const suffix = c.id === 'notion' && data.aiUsed === false ? L(dict, '(未接 AI,已按页面标题/正文存入,可直接阅读)', '(no AI — saved by page title/text, readable directly)') : '';
        showToast(L(dict, `已提取 ${n.length} 个节点${suffix}`, `Extracted ${n.length} nodes ${suffix}`), true);
      }
    } catch { showToast(L(dict, '网络错误', 'Network error'), false); }
    setSyncing(null);
  }

  // N-0:一键清除旧的 Notion 逐行导入噪声(不碰微信读书手动导入)。
  function clearNotionMemories() {
    let removed = 0;
    try {
      removed = pruneNotionNodes();
    } catch {
      showToast(L(dict, '清除失败,请重试', 'Clear failed — please try again'), false);
      return;
    }
    window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
    showToast(
      removed > 0
        ? L(dict, `已清除 ${removed} 条 Notion 导入的记忆`, `Cleared ${removed} imported Notion memories`)
        : L(dict, '没有找到 Notion 导入的记忆', 'No imported Notion memories found'),
      true,
    );
  }

  function submitToken(c: ConnectorDef) {
    if (!tokenValue.trim()) return;
    saveToken(c.id, tokenValue.trim());
    setTokenInputFor(null);
    // 批次 37:存了 token 立刻标记已连接(按钮翻成 同步/断开)。
    // 若随后 syncToken 判定 invalid_token,会把它清回未连接并重开输入框。
    saveConnectorState(c.id, true);
    setConnected((p) => ({ ...p, [c.id]: true }));
    syncToken(c);
  }

  // ── Server-configured sync (Flomo) ──
  async function syncFlomo(c: ConnectorDef) {
    setSyncing(c.id);
    const r = await runFlomoSync(); // 数据核心在 connector-sync,与记忆页下拉共用
    if (!r.ok) {
      showToast(L(dict, 'Flomo 未配置或同步失败', 'Flomo not configured or sync failed'), false);
      setSyncing(null);
      return;
    }
    saveConnectorState(c.id, true);
    setConnected((p) => ({ ...p, [c.id]: true }));
    setCounts((p) => ({ ...p, [c.id]: r.fresh }));
    showToast(L(dict, r.fresh ? `已同步 ${r.fresh} 条 flomo 笔记(按 slug 去重,老笔记不重复入库)` : '没有新笔记 —— 已全部同步过', r.fresh ? `Synced ${r.fresh} flomo notes (deduped by slug)` : 'No new notes — everything already synced'), true);
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

    // 通讯录(People)→ 关系 tab 的 person 节点(人缘管理)
    try {
      const { runPeopleSync } = await import('@/lib/portal/connector-sync');
      const p = await runPeopleSync();
      if (p.ok) {
        parts.push(L(dict, `通讯录:导入 ${p.imported}、更新 ${p.updated}`, `Contacts: +${p.imported}, updated ${p.updated}`));
      } else if (p.error === 'not_connected') {
        allOk = false; reauth = true;
        parts.push(L(dict, '通讯录:授权不含通讯录权限,点「重新授权」勾上「查看通讯录」', 'Contacts: consent lacks contacts scope — reauthorize and check "See your contacts"'));
      } else {
        allOk = false;
        parts.push(L(dict, '通讯录:没同步上(可能 People API 未启用,去 console 库里启用)', 'Contacts: not synced (enable People API in Google Cloud Library)'));
      }
    } catch { allOk = false; parts.push(L(dict, '通讯录:网络错误', 'Contacts: network error')); }

    saveConnectorState('google', true);
    setConnected((p) => ({ ...p, google: true }));
    setOauthSyncResult((p) => ({ ...p, google: { ok: allOk, msg: allOk ? L(dict, '同步成功', 'Synced') : L(dict, '部分同步失败', 'Partly failed'), detail: parts.join('\n'), needsReauth: reauth } }));
    showToast(parts.join(' · '), allOk);
    window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
    window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
    setSyncing(null);
  }


  // ── OAuth sync (Gmail / Calendar 旧入口,google 合并后仅内部保留) ──
  async function syncTesla() {
    setSyncing('tesla');
    try {
      const res = await fetch('/api/portal/tesla', { cache: 'no-store' });
      const data = await res.json() as { ok?: boolean; error?: string; drives?: unknown[]; charges?: unknown[] };
      if (!data.ok) {
        const reauth = data.error === 'not_connected' || data.error === 'token_expired';
        showToast(reauth
          ? L(dict, 'Tesla 授权已失效,点击重新连接', 'Tesla auth expired — tap to reconnect')
          : L(dict, `Tesla 同步失败:${data.error || '未知'}`, `Tesla sync failed: ${data.error || 'unknown'}`), false);
        setSyncing(null);
        return;
      }
      // Reuse the payload we already fetched — no second (billed) Tesla call.
      const { refreshTesla } = await import('@/lib/portal/connectors');
      await refreshTesla({ drives: data.drives as never[], charges: data.charges as never[] });
      const n = (data.drives?.length || 0) + (data.charges?.length || 0);
      setCounts((p) => ({ ...p, tesla: n }));
      saveConnectorState('tesla', true);
      setConnected((p) => ({ ...p, tesla: true }));
      showToast(L(dict, `Tesla 已同步:${data.drives?.length || 0} 行程 · ${data.charges?.length || 0} 充电`, `Tesla synced: ${data.drives?.length || 0} drives · ${data.charges?.length || 0} charges`), true);
    } catch {
      showToast(L(dict, '网络错误', 'Network error'), false);
    }
    setSyncing(null);
  }

  async function syncOAuth(c: ConnectorDef) {
    if (c.id === 'google') { await syncGoogle(c); return; }
    if (c.id === 'plaid') { await syncPlaid(); return; }
    if (c.id === 'tesla') { await syncTesla(); return; }
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

  // 连接后产生「无主 token / 无主外部数据」的私有数据源 —— 必须先有账号。
  // 本地文件导入(健康 zip/照片/时间轴)和设备定位不在此列(数据只进本机)。
  const PRIVATE_SOURCE_IDS = new Set(['google', 'tesla', 'plaid', 'notion', 'flomo']);

  // ── OAuth / Geo / File ──
  function handleConnect(c: ConnectorDef) {
    if (c.comingSoon) return;
    if (PRIVATE_SOURCE_IDS.has(c.id) && signedIn === false) {
      showToast(L(dict, '连接邮箱/日历/银行等私有数据需要先登录账号。', 'Sign in first to connect private sources like email, calendar, or banks.'), false);
      setTimeout(() => { window.location.href = '/login?reason=connect_requires_account'; }, 900);
      return;
    }
    // 一次 Google 授权覆盖日历+邮件两个 scope(gmail/connect 请求全量 scope)
    if (c.id === 'google') { window.location.href = '/api/portal/gmail/connect'; return; }
    if (c.id === 'tesla') { window.location.href = '/api/portal/tesla/connect'; return; }
    if (c.method === 'geo') {
      setSyncing(c.id);
      navigator.geolocation.getCurrentPosition(
        () => { saveConnectorState('weather', true); setConnected((p) => ({ ...p, weather: true })); setSyncing(null); window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed')); showToast(L(dict, '位置已授权', 'Location granted'), true); },
        () => { setSyncing(null); showToast(L(dict, '位置权限被拒绝', 'Location permission denied'), false); },
        { timeout: 8000 },
      );
      return;
    }
    // 打开文件选择器前标记 busy —— 选完文件回到前台时,别被"新部署自动整页刷新"冲掉上传。
    if (c.id === 'health') { markBusy(); fileRef.current?.click(); return; }
    if (c.method === 'batch-photos') { markBusy(); photosRef.current?.click(); return; }
    if (c.id === 'timeline') { markBusy(); timelineRef.current?.click(); return; }
    if (c.id === 'wechat_reading') { setWechatReadingOpen(true); return; }
    if (c.id === 'wechat_fav') { return; } // 纯说明行,无操作
    if (c.id === 'plaid') { void connectPlaid(); return; }
    // 批次 25:Notion 直接走内部 token 粘贴——iOS 上 OAuth authorize 会被
    // Notion App 的 universal link 劫持、进不了授权页(用户报「直接进了 Notion App」)。
    // 内部集成 token 最可靠:notion.so/my-integrations → 新建内部集成 → 复制 secret。
    if (c.id === 'notion' && !loadToken('notion')) { setTokenInputFor('notion'); setTokenValue(''); return; }
    if (c.method === 'token') { syncToken(c); return; }
    if (c.method === 'server') { syncFlomo(c); return; }
    if (c.method === 'shortcuts') { setShortcutsFor(c.id); return; }
  }

  // 批次 38/39/41:直接传 zip 或 export.xml,全部在浏览器里流式解析(不上传大文件)。
  // 批次 41:改为「边解压边解析」—— 1GB zip 解压后 export.xml 常达 10GB+,旧写法
  // (file.arrayBuffer() 整包读入 + unzipSync 整体解压成一个 Uint8Array)会把手机标签页
  // 内存打爆 → 闪退。现用 File.stream() 逐块喂 fflate 流式 Unzip,再把解出的每块喂给
  // 增量解析器后立即丢弃,任何时刻只持有一小块;Apple 按类型分块导出仍扫全文件不漏指标。
  async function importHealthFile(
    file: File,
    onProgress?: (pct: number) => void,
    captureCda = false,
  ): Promise<{ metrics: HealthMetrics; nodes: HealthNode[]; cdaXml?: string } | null> {
    const { createHealthStreamParser } = await import('@/lib/portal/apple-health');
    const parser = createHealthStreamParser();
    // D2:lab 模式下顺带缓冲 export_cda.xml(临床记录,通常很小)—— 整体缓冲有上限,防 OOM。
    const cdaChunks: Uint8Array[] = [];
    let cdaBytes = 0;
    const CDA_CAP = 40_000_000; // 40MB 上限,超了就丢弃(临床文档几乎不会这么大)
    let cdaOverflow = false;

    // 进度按「已读字节 / 文件总大小」上报(zip 读的是压缩字节,正好对应 file.size);
    // 按整数百分比节流,避免 ~64KB 一块的高频 setState 拖慢 UI。
    const total = file.size || 0;
    let read = 0;
    let lastPct = -1;
    const report = () => {
      if (!total || !onProgress) return;
      const pct = Math.min(99, Math.floor((read / total) * 100)); // 收尾 finalize 还有一点,留到 100
      if (pct !== lastPct) { lastPct = pct; onProgress(pct); }
    };

    // 文件字节按块产出:优先 File.stream()(不把整包读进内存),不支持则回退分片 arrayBuffer。
    async function forEachChunk(onChunk: (c: Uint8Array) => void): Promise<void> {
      if (typeof file.stream === 'function') {
        const reader = file.stream().getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) { read += value.length; onChunk(value); report(); }
        }
        return;
      }
      const whole = new Uint8Array(await file.arrayBuffer());
      const STEP = 4_000_000;
      for (let i = 0; i < whole.length; i += STEP) {
        const slice = whole.subarray(i, Math.min(whole.length, i + STEP));
        read += slice.length;
        onChunk(slice);
        report();
        await Promise.resolve(); // 让出主线程,大文件下避免长任务卡死 UI
      }
    }

    // 裸 export.xml:直接分块喂解析器。
    if (!file.name.toLowerCase().endsWith('.zip')) {
      let any = false;
      await forEachChunk((c) => { parser.push(c); any = true; });
      parser.push(new Uint8Array(0), true);
      return any ? parser.finish() : null;
    }

    // zip:流式解压,start export.xml(+ lab 模式下 export_cda.xml),其它条目不解压。
    const { Unzip, UnzipInflate, UnzipPassThrough } = await import('fflate');
    const isExport = (n: string) => /(^|\/)export\.xml$/i.test(n);
    const isCda = (n: string) => /(^|\/)export_cda\.xml$/i.test(n);
    let sawExport = false;
    let failed: Error | null = null;
    const unzip = new Unzip((entry) => {
      if (isExport(entry.name)) {
        sawExport = true;
        entry.ondata = (err, chunk, final) => {
          if (err) { failed = err instanceof Error ? err : new Error(String(err)); return; }
          if (chunk.length) parser.push(chunk, final);
          else if (final) parser.push(new Uint8Array(0), true);
        };
        entry.start();
      } else if (captureCda && isCda(entry.name)) {
        entry.ondata = (err, chunk) => {
          if (err || cdaOverflow) return; // 临床解析尽力而为,出错不影响健康导入
          if (chunk.length) {
            if (cdaBytes + chunk.length > CDA_CAP) { cdaOverflow = true; cdaChunks.length = 0; return; }
            cdaChunks.push(chunk.slice()); cdaBytes += chunk.length;
          }
        };
        entry.start();
      }
    });
    unzip.register(UnzipInflate);      // deflate(export.xml 常规压缩)
    unzip.register(UnzipPassThrough);  // stored(极少数未压缩存储,免 start() 抛错)

    await forEachChunk((c) => { unzip.push(c, false); if (failed) throw failed; });
    unzip.push(new Uint8Array(0), true);
    if (failed) throw failed;
    if (!sawExport) return null;
    const result = parser.finish();
    let cdaXml: string | undefined;
    if (captureCda && cdaChunks.length) {
      const dec = new TextDecoder('utf-8');
      cdaXml = cdaChunks.map((c, i) => dec.decode(c, { stream: i < cdaChunks.length - 1 })).join('');
    }
    return { ...result, cdaXml };
  }

  async function handleHealthFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    markBusy(); // 解析期间也保持 busy,别被自动刷新打断
    setSyncing('health');
    setImportPct(0);
    try {
      // 看板指标 + 记忆节点(概况/锻炼)都基于全文件的同一次流式解析 —— 概况不再只看尾部 6MB,
      // 避免 Apple 按类型分块导出时尾部缺步数/心率/睡眠而漏进概况。
      // D2:仅 lab 模式下顺带捕获+解析 export_cda.xml 的临床记录(化验单/用药/诊断)。
      const labMode = readLaunchSurfaceContextFromBrowser().viewerRole === 'personal_lab';
      const result = await importHealthFile(file, setImportPct, labMode);
      setImportPct(null); // 读取+解析完成,余下持久化很快
      if (labMode && result?.cdaXml) {
        try {
          const [{ parseCda }, { saveClinical }] = await Promise.all([
            import('@/lib/portal/cda-parse'),
            import('@/lib/portal/clinical-store'),
          ]);
          const clinical = parseCda(result.cdaXml);
          saveClinical(clinical);
          if (clinical.labs.length || clinical.medications.length || clinical.conditions.length) {
            showToast(L(dict, `临床记录:${clinical.labs.length} 项化验 · ${clinical.medications.length} 用药 · ${clinical.conditions.length} 诊断`, `Clinical: ${clinical.labs.length} labs · ${clinical.medications.length} meds · ${clinical.conditions.length} conditions`), true);
          }
        } catch { /* 临床解析尽力而为,失败不影响健康导入 */ }
      }
      if (!result) {
        showToast(L(dict, 'zip 里没找到 export.xml(别选 export_cda / 子文件夹)', 'No export.xml in the zip (not export_cda / subfolders)'), false);
        setSyncing(null); return;
      }
      const { metrics, nodes } = result;
      if (metrics.metrics.length) {
        const { saveHealthMetrics } = await import('@/lib/portal/health-store');
        saveHealthMetrics(metrics);
      }
      if (!nodes.length && !metrics.metrics.length) {
        showToast(L(dict, '未识别到健康数据(确认选的是 export.xml/zip,不是 export_cda)', 'No health data (make sure it is export.xml/zip, not export_cda)'), false);
        setSyncing(null); return;
      }
      if (nodes.length) saveNodes(nodes as Array<Omit<NodeInput, 'source'>>, 'system');
      saveConnectorState('health', true);
      setConnected((p) => ({ ...p, health: true }));
      setCounts((p) => ({ ...p, health: metrics.metrics.length || nodes.length }));
      showToast(L(dict, `已接入健康数据:${metrics.metrics.length} 项指标,到「洞察 → 健康」看看`, `Health imported: ${metrics.metrics.length} metrics — see Insights → Health`), true);
    } catch {
      showToast(L(dict, '解析失败(文件可能损坏或不是 Apple 健康导出 —— 可先在电脑上解压后单传 export.xml)', 'Parse failed (file may be corrupt or not an Apple Health export — unzip on a computer and upload export.xml)'), false);
    }
    setImportPct(null);
    setSyncing(null);
  }

  function disconnect(id: string) {
    saveConnectorState(id, false);
    saveToken(id, '');
    setConnected((p) => ({ ...p, [id]: false }));

    // Tesla — real revoke闭环: revoke the grant + clear token cookies server-side.
    if (id === 'tesla') {
      void fetch('/api/portal/tesla/disconnect', { method: 'POST' })
        .then((r) => r.json() as Promise<{ ok?: boolean; revoked?: boolean }>)
        .then((d) => showToast(d.revoked
          ? L(dict, '已断开并撤销 Tesla 授权', 'Disconnected and revoked Tesla access')
          : L(dict, '已断开并清除本地 token', 'Disconnected and cleared local tokens'), true))
        .catch(() => showToast(L(dict, '已断开本地连接,撤销请求失败——可在 Tesla 账号里手动移除', 'Disconnected locally; revoke failed — remove it in your Tesla account'), false));
    }

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
      <input ref={photosRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void handleBatchPhotos(e.target.files); e.target.value = ''; }} />
      <input ref={timelineRef} type="file" accept="application/json,.json" hidden onChange={(e) => { void handleTimelineFile(e.target.files); e.target.value = ''; }} />
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
          {/* 分层入口(用户定):免费只留 Google(日历+邮件)和 地理位置·天气;
              Pro 加 Flomo(Google people/tasks 的 scope 已随 google 一次授权带上,无独立行);
              Lab(内测)全量可见。 */}
          {CONNECTORS.filter((c) => !c.dev)
            .filter((c) => {
              if (isLabModeOn()) return true;
              const FREE = ['google', 'weather'];
              const PRO = ['google', 'weather', 'flomo'];
              return (isPro() ? PRO : FREE).includes(c.id);
            })
            .map((c) => {
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
                    {isConn && !oauthSyncResult[c.id] && <p className="nesio-connector-sync">{isSync ? (importPct != null ? L(dict, `导入中 ${importPct}%`, `Importing ${importPct}%`) : L(dict, '同步中…', 'Syncing…')) : L(dict, '已连接', 'Connected')}{cnt ? L(dict, `  ·  ${cnt} 个节点`, `  ·  ${cnt} nodes`) : ''}</p>}
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
                      {/* 批次 38:Notion 选择要同步哪些数据库(表) */}
                      {c.id === 'notion' && (
                        <button type="button" className="nesio-connector-connect" style={{ background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)' }} onClick={() => openNotionPicker()} disabled={notionDbLoading}>{notionDbLoading ? '…' : L(dict, '选表', 'Pick tables')}</button>
                      )}
                      <button type="button" className="nesio-connector-disconnect" onClick={() => disconnect(c.id)}>{L(dict, '断开', 'Disconnect')}</button>
                    </div>
                  ) : isConn && c.method === 'oauth' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flexShrink: 0 }}>
                      <button type="button" className="nesio-connector-connect" onClick={() => syncOAuth(c)} disabled={isSync}>{isSync ? '…' : L(dict, '同步', 'Sync')}</button>
                      {/* 批次 27:Plaid 连了一家还想连别家 —— 已连接也给「+银行」再开一次 Link */}
                      {c.id === 'plaid' && (
                        <button type="button" className="nesio-connector-connect" style={{ background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)' }} onClick={() => connectPlaid()} disabled={isSync}>{L(dict, '+ 银行', '+ Bank')}</button>
                      )}
                      <button type="button" className="nesio-connector-disconnect" onClick={() => disconnect(c.id)}>{L(dict, '断开', 'Disconnect')}</button>
                    </div>
                  ) : isConn ? (
                    <button type="button" className="nesio-connector-disconnect" onClick={() => disconnect(c.id)} style={{ flexShrink: 0 }}>{L(dict, '断开', 'Disconnect')}</button>
                  ) : (
                    <button type="button" className="nesio-connector-connect" onClick={() => handleConnect(c)} disabled={isSync} style={{ flexShrink: 0 }}>
                      {isSync ? (importPct != null ? `${importPct}%` : '…') : c.method === 'file' ? L(dict, '上传', 'Upload') : L(dict, '接入', 'Connect')}
                    </button>
                  )}
                </div>

                {/* Token input */}
                {tokenInputFor === c.id && (
                  <div className="nesio-connector-token-box">
                    {/* 批次 36:Notion 给两条路 —— 上面「一键授权」是 flomo 那样的 OAuth 同意页(选页面),
                        下面「粘贴 token」是 iOS 上更稳的回退(OAuth 在 iOS 可能被 Notion App 劫持)。 */}
                    {c.id === 'notion' && (
                      <>
                        <button
                          type="button"
                          className="nesio-connector-connect"
                          onClick={() => connectNotion()}
                          disabled={isSync}
                          style={{ width: '100%', marginBottom: '0.5rem' }}
                        >
                          {isSync ? '…' : L(dict, '用 Notion 授权(选择页面)→', 'Authorize with Notion (pick pages) →')}
                        </button>
                        <p style={{ fontSize: '0.68rem', color: 'var(--portal-muted)', margin: '0 0 0.6rem', lineHeight: 1.5 }}>
                          {L(dict, '会跳到 Notion 同意页,像 flomo 那样勾选要同步的页面。若在 iOS 上被 Notion App 劫持打不开,改用下面的粘贴 token。', 'Opens the Notion consent page (pick pages, like flomo). If iOS hijacks it into the Notion app, use paste-token below instead.')}
                        </p>
                        <div style={{ borderTop: '1px solid var(--portal-hairline, rgba(127,127,127,0.18))', margin: '0 0 0.6rem' }} />
                        <a
                          href="https://www.notion.so/my-integrations"
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: 'inline-block', marginBottom: '0.5rem', fontSize: '0.74rem', fontWeight: 600, color: 'var(--portal-blue-deep)', textDecoration: 'underline' }}
                        >
                          {L(dict, '或粘贴 token:打开 notion.so/my-integrations →', 'Or paste a token: open notion.so/my-integrations →')}
                        </a>
                      </>
                    )}
                    <p style={{ fontSize: '0.72rem', color: 'var(--portal-muted)', marginBottom: '0.5rem', lineHeight: 1.5 }}>{dict === 'en' ? (c.tokenHintEn ?? c.tokenHint) : c.tokenHint}</p>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input className="nesio-ob-input" style={{ marginBottom: 0, flex: 1, fontSize: '0.8rem' }} type="password" placeholder={L(dict, '粘贴 Token…', 'Paste token…')} value={tokenValue} onChange={(e) => setTokenValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitToken(c); }} autoFocus />
                      <button type="button" className="nesio-connector-connect" onClick={() => submitToken(c)} disabled={!tokenValue.trim()}>{L(dict, '连接', 'Connect')}</button>
                    </div>
                  </div>
                )}

                {/* Notion 数据源选择器 —— N-5:选表 → 同步走 N-3 结构折叠(书=一条记忆,划线折进去);附一键重来 */}
                {c.id === 'notion' && notionDbList && (
                  <div className="nesio-connector-token-box">
                    <p style={{ fontSize: '0.75rem', color: 'var(--portal-ink)', fontWeight: 600, marginBottom: '0.2rem' }}>{L(dict, '选择要同步的表', 'Pick tables to sync')}</p>
                    <p style={{ fontSize: '0.68rem', color: 'var(--portal-muted)', marginBottom: '0.5rem', lineHeight: 1.5 }}>{L(dict, '勾选后点上面「同步」:会按结构理解 —— 读书这类自动把划线折进书里(一本书=一条记忆),丢掉日历表和技术列。重复同步幂等,删了不会重复。', 'Check tables, then tap Sync above. We read the structure — e.g. highlights fold into their book (one book = one memory), calendar tables and ID columns dropped. Re-syncing is idempotent, no duplicates.')}</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: 220, overflowY: 'auto' }}>
                      {notionDbList.map((db) => (
                        <label key={db.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--portal-ink)', cursor: 'pointer' }}>
                          <input type="checkbox" checked={notionDbSel.includes(db.id)} onChange={() => toggleNotionDb(db.id)} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{db.title}</span>
                        </label>
                      ))}
                    </div>
                    <p style={{ fontSize: '0.66rem', color: 'var(--portal-muted)', marginTop: '0.5rem' }}>{L(dict, `已选 ${notionDbSel.length} 个`, `${notionDbSel.length} selected`)}</p>
                    <button
                      type="button"
                      onClick={clearNotionMemories}
                      style={{ marginTop: '0.6rem', width: '100%', padding: '0.5rem', fontSize: '0.76rem', fontWeight: 600, borderRadius: 'var(--radius-sm, 12px)', border: '1.5px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-muted)', cursor: 'pointer' }}
                    >
                      {L(dict, '清除已导入的 Notion 记忆(重来)', 'Clear imported Notion memories (start over)')}
                    </button>
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

          {/* 批次 35:三行说明收进一个小信息符号 */}
          <div style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.74rem', color: 'var(--portal-muted)' }}>
            {L(dict, '连接方式与数据去向', 'How sources connect & where data lives')}
            <InfoTip text={L(dict,
              '有 API 的(Google 日历+Gmail / Notion / Toggl / Flomo)直接连接;没有公开 API 的(提醒事项 / Keep / 微信读书)通过快捷指令推送。抽取出的记录存在你的设备;连接邮箱/日历/Notion/银行等账号时,授权与数据拉取会经过对应服务商的服务器。',
              "API sources (Google Calendar+Gmail / Notion / Toggl / Flomo) connect directly; no-API sources (Reminders / Keep / WeRead) push via Shortcuts. Extracted records live on your device; connecting email/calendar/Notion/bank accounts routes authorization and fetching through those providers' servers.")} />
          </div>
        </div>
      </div>
      <WechatReadingImportSheet open={wechatReadingOpen} onClose={() => setWechatReadingOpen(false)} />
    </div>
  );
}
