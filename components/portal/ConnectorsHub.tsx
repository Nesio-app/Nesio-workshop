'use client';

import { useEffect, useRef, useState } from 'react';
import { IconActivity, IconBook, IconBookOpen, IconCalendar, IconCar, IconCheckSquare, IconCloudSun, IconHeartPulse, IconMail, IconNote, IconTimer , IconImage, IconMapPin, IconCard } from './icons';
import dynamic from 'next/dynamic';
const WechatReadingImportSheet = dynamic(() => import('./WechatReadingImportSheet'), { ssr: false });
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { type LifeNode } from '@/lib/portal/life-graph';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

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
  { id: 'flomo', name: 'Flomo', icon: <IconNote />, iconBg: 'var(--chip-indigo)', method: 'server', syncEndpoint: '/api/portal/flomo?limit=100', description: '同步 flomo 笔记，提取想法与记录', descriptionEn: 'Sync flomo notes; extract ideas and records' },
  // 批次 18:Notion 转正 —— OAuth 一键授权(像 flomo 那样选页面),内部 token 流保留为回退
  { id: 'notion', name: 'Notion', icon: <IconBook />, iconBg: 'var(--chip-gray)', method: 'token', syncEndpoint: '/api/portal/notion', tokenHint: 'notion.so/my-integrations → 新建集成(Internal)→ 复制 Internal Integration Secret(ntn_… 或 secret_…)→ 在要同步的 Notion 页面右上角「…」→ 连接 → 选中这个集成', tokenHintEn: 'notion.so/my-integrations → New internal integration → copy the secret (ntn_… / secret_…) → on each page: ••• → Connections → add this integration', description: '粘贴内部集成 token,同步共享给它的页面(提取项目与想法)', descriptionEn: 'Paste an internal integration token to sync the pages you shared with it' },
  { id: 'toggl', name: 'Toggl Track', icon: <IconTimer />, iconBg: 'var(--chip-red)', method: 'token', syncEndpoint: '/api/portal/toggl', tokenHint: 'track.toggl.com → Profile → API Token', tokenHintEn: 'track.toggl.com → Profile → API Token', description: '同步时间记录，了解你的专注分布', descriptionEn: 'Sync time entries to see where your focus goes', dev: true },
  { id: 'health', name: 'Apple Health 导出', nameEn: 'Apple Health export', icon: <IconHeartPulse />, iconBg: 'var(--chip-pink)', method: 'file', description: '上传 export.xml，提取步数、睡眠、心率', descriptionEn: 'Upload export.xml to extract steps, sleep, heart rate' },
  { id: 'reminder', name: 'Apple 提醒事项', nameEn: 'Apple Reminders', icon: <IconCheckSquare />, iconBg: 'var(--chip-amber)', method: 'shortcuts', ingestSource: 'reminder', description: '通过快捷指令推送提醒，自动转为承诺', descriptionEn: 'Push reminders via Shortcuts; they become commitments', dev: true },
  { id: 'keep', name: 'Keep 健康', nameEn: 'Keep fitness', icon: <IconActivity />, iconBg: 'var(--chip-green)', method: 'shortcuts', ingestSource: 'keep', description: '通过快捷指令推送运动数据（点设置看步骤）', descriptionEn: 'Push workout data via Shortcuts (tap Set up for steps)' },
  // 批次 22:微信读书无开放 API —— App 内导出笔记,粘贴文本解析入库
  { id: 'wechat_reading', name: '微信读书', nameEn: 'WeChat Reading', icon: <IconBookOpen />, iconBg: 'var(--chip-leaf)', method: 'file', description: '微信读书 App 导出笔记,粘进来解析成划线记忆', descriptionEn: 'Export notes from WeChat Reading and paste to parse highlights' },
  // 批次 22:微信公众号/视频收藏无 API —— 说明可用路径,不做假按钮
  { id: 'wechat_fav', name: '微信收藏 · 公众号/视频', nameEn: 'WeChat favorites', icon: <IconBook />, iconBg: 'var(--chip-mint)', method: 'file', dev: true, description: '公众号文章 / 视频号收藏没有开放接口。可用:① 打开文章 → 分享 → 复制链接 → 用「分享给 Nesio」或冷冻仓存入;② 关注 flomo 服务号,收藏自动进 flomo,再用 Flomo 同步。', descriptionEn: 'Official-account articles and Channels favorites have no public API. Options: ① copy the article link and use Share to Nesio; ② follow flomo\'s service account so favorites flow into flomo, then use Flomo sync.' },
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
    const savedConn = loadConnectors();
    // 批次 37:有 Notion token 就算已连接 —— 连接(token 有效)和有没有共享页面是两回事。
    // 之前只在「同步成功且返回了页面」才翻成已连接,导致 token 已存但没共享页面时按钮
    // 永远停在「接入」,用户以为没连上。
    if (loadToken('notion')) savedConn.notion = true;
    setConnected(savedConn);
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
            content: '请只根据图片里真实可见的内容生成 Memory 节点:优先具体物品、文件、小票条目、场景;不要把指令当节点名。',
            imageBase64: base64,
            mimeType: 'image/jpeg',
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
          const ex = await fetch('/api/portal/plaid/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publicToken }),
          });
          const exData = await ex.json() as { ok?: boolean; error?: string };
          if (exData.ok) {
            saveConnectorState('plaid', true);
            setConnected((p) => ({ ...p, plaid: true }));
            showToast(L(dict, '银行已连接,点「同步」拉取流水', 'Bank linked — tap Sync to pull transactions'), true);
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

  async function syncPlaid() {
    setSyncing('plaid');
    try {
      const res = await fetch('/api/portal/plaid/transactions');
      const data = await res.json() as { ok?: boolean; transactions?: Array<{ id: string; accountId?: string; date: string; name: string; amount: number; currency: string; category: string }>; accounts?: unknown[]; error?: string };
      // 批次 31:账户/卡片信息存本机,供财务「卡片」子分类分卡显示
      if (data.accounts?.length) { try { localStorage.setItem('nesio-bank-accounts-v1', JSON.stringify(data.accounts)); } catch { /* quota */ } }
      if (!data.ok) {
        if (data.error === 'not_connected' || data.error === 'relink_required') {
          showToast(L(dict, '需要(重新)连接银行', 'Bank needs (re)linking'), false);
          void connectPlaid();
        } else {
          showToast(L(dict, `流水同步失败:${data.error || '未知'}`, `Sync failed: ${data.error || 'unknown'}`), false);
        }
        setSyncing(null);
        return;
      }
      // 明细只存本机,按交易 id 去重,封顶 1000
      const KEY = 'nesio-bank-tx-v1';
      let existing: Array<{ id: string }> = [];
      try { existing = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { /* ignore */ }
      const seen = new Set(existing.map((t) => t.id));
      const fresh = (data.transactions || []).filter((t) => !seen.has(t.id));
      const merged = [...fresh, ...existing].slice(0, 1000);
      try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* quota */ }
      setCounts((p) => ({ ...p, plaid: merged.length }));
      saveConnectorState('plaid', true);
      setConnected((p) => ({ ...p, plaid: true }));
      const acctCount = data.accounts?.length || 0;
      showToast(L(dict, `流水同步完成:新增 ${fresh.length} 笔,共 ${merged.length} 笔,${acctCount} 个账户。到「洞察 → 财务」看总览/支出/交易/卡片`, `Synced: ${fresh.length} new, ${merged.length} total, ${acctCount} accounts. See Insights → Finance`), true);
    } catch {
      showToast(L(dict, '网络错误', 'Network error'), false);
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
      // 批次 38:Notion 若已选定数据库,把行按结构化存进记忆(否则退回页面正文提取)。
      const notionDbs = c.id === 'notion' ? loadNotionDbs() : [];
      const res = await fetch(c.syncEndpoint!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notionDbs.length ? { token, databaseIds: notionDbs } : { token }),
      });
      const data = await res.json() as { ok?: boolean; nodes?: NodeInput[]; error?: string; pageCount?: number; aiUsed?: boolean };
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
      // 批次 31:Notion 没配 Gemini 时走标题/正文兜底,提示里说清是页面数
      const suffix = c.id === 'notion' && data.aiUsed === false ? L(dict, '(未接 AI,已按页面标题/正文存入,可直接阅读)', '(no AI — saved by page title/text, readable directly)') : '';
      showToast(L(dict, `已提取 ${n.length} 个节点${suffix}`, `Extracted ${n.length} nodes ${suffix}`), true);
    } catch { showToast(L(dict, '网络错误', 'Network error'), false); }
    setSyncing(null);
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
    try {
      const res = await fetch(c.syncEndpoint!);
      const data = await res.json() as { ok?: boolean; memos?: Array<{ content: string; created_at: string; tags: string[]; slug?: string }>; error?: string };
      if (!data.ok) { showToast(L(dict, `Flomo 未配置或同步失败`, 'Flomo not configured or sync failed'), false); setSyncing(null); return; }
      const memos = data.memos || [];
      // 批次 19:按 slug 去重——重复同步不再重复入库;取最新 50 条
      const { getLifeGraph } = await import('@/lib/portal/life-graph');
      const existingSlugs = new Set(
        getLifeGraph().map((n) => n.attributes?.flomoSlug as string).filter(Boolean),
      );
      const fresh = memos.filter((m) => !existingSlugs.has((m as { slug?: string }).slug || ''));
      const nodes: Array<Omit<NodeInput, 'source'>> = fresh.slice(0, 50).map((m) => ({
        type: 'preference' as const,
        name: m.content.replace(/<[^>]+>/g, '').slice(0, 40),
        attributes: { source: 'Flomo', created: m.created_at, flomoSlug: (m as { slug?: string }).slug || '' },
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
    if (c.id === 'plaid') { await syncPlaid(); return; }
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
    if (c.method === 'batch-photos') { photosRef.current?.click(); return; }
    if (c.id === 'timeline') { timelineRef.current?.click(); return; }
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
                      {isSync ? '…' : c.method === 'file' ? L(dict, '上传', 'Upload') : L(dict, '接入', 'Connect')}
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

                {/* 批次 38:Notion 数据库选择器 —— 勾选要同步的表,每行存成一条记忆 */}
                {c.id === 'notion' && notionDbList && (
                  <div className="nesio-connector-token-box">
                    <p style={{ fontSize: '0.75rem', color: 'var(--portal-ink)', fontWeight: 600, marginBottom: '0.2rem' }}>{L(dict, '选择要同步的表', 'Pick tables to sync')}</p>
                    <p style={{ fontSize: '0.68rem', color: 'var(--portal-muted)', marginBottom: '0.5rem', lineHeight: 1.5 }}>{L(dict, '勾选的表,每一行会存成一条记忆(字段变成属性/标签/日期)。选完点上面「同步」。', 'Each row in the checked tables becomes a memory (fields → attributes/tags/dates). Then tap Sync above.')}</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: 220, overflowY: 'auto' }}>
                      {notionDbList.map((db) => (
                        <label key={db.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--portal-ink)', cursor: 'pointer' }}>
                          <input type="checkbox" checked={notionDbSel.includes(db.id)} onChange={() => toggleNotionDb(db.id)} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{db.title}</span>
                        </label>
                      ))}
                    </div>
                    <p style={{ fontSize: '0.66rem', color: 'var(--portal-muted)', marginTop: '0.5rem' }}>{L(dict, `已选 ${notionDbSel.length} 个 · 每表最多 100 行`, `${notionDbSel.length} selected · up to 100 rows each`)}</p>
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
      <WechatReadingImportSheet open={wechatReadingOpen} onClose={() => setWechatReadingOpen(false)} />
    </div>
  );
}
