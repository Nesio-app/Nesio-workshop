'use client';

import { useEffect, useRef, useState } from 'react';
import { useSheetDrag } from './use-sheet-drag';
import { IconActivity, IconBook, IconBookOpen, IconCalendar, IconCar, IconCheckSquare, IconCloudSun, IconHeartPulse, IconMail, IconNote, IconTimer , IconImage, IconMapPin, IconCard } from './icons';
import dynamic from 'next/dynamic';
const WechatReadingImportSheet = dynamic(() => import('./WechatReadingImportSheet'), { ssr: false });
const TeslaSheet = dynamic(() => import('./TeslaSheet'), { ssr: false });
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { ingestGranolaMeeting } from '@/lib/platform/view-models/today-view-model';
import { runPlaidSync, runFlomoSync, saveCalendarEventsToMemory, enrichGmailInBackground } from '@/lib/portal/connector-sync';
import { type LifeNode, pruneNotionNodes } from '@/lib/portal/life-graph';
import type { HealthMetrics, HealthNode } from '@/lib/portal/apple-health';
import { readLaunchSurfaceContextFromBrowser } from '@/lib/portal/launch-surface.mjs';
import { L } from '@/lib/portal/i18n';
import { InfoTip } from './InfoTip';
// #21:登录态只有一个答案 —— 各处自己 fetch 一遍就会「已登录」和「未登录」同屏
import { useSessionState } from './use-session-state';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { markBusy } from '@/lib/portal/app-busy';
import { isPro, canUsePaidCloudAi } from '@/lib/portal/entitlement';
import { IMPORT_WINDOWS } from '@/lib/portal/backup-inventory';
import { isLabModeOn } from '@/lib/portal/module-overrides';
import { logDropped } from '@/lib/portal/storage-health';
import { executeBackgroundCloudOnly } from '@/lib/portal/client-flow-control';

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
  { id: 'weather', name: '地理位置 · 天气', nameEn: 'Location · Weather', icon: <IconCloudSun />, iconBg: 'var(--chip-amber)', method: 'geo', description: '使用期间定位 + 可选始终(后台足迹);驱动天气与外出建议', descriptionEn: 'When-in-use location + optional Always for background place trail; powers weather tips' },
  // 批次 21:银行流水(Plaid)—— Link 授权后增量同步交易,明细只存本机
  { id: 'plaid', name: '银行流水 · Plaid', nameEn: 'Bank feed · Plaid', icon: <IconCard />, iconBg: 'var(--chip-fog)', method: 'oauth', description: '连接美国银行账户,交易流水增量同步(明细只存本机)', descriptionEn: 'Link a US bank account; transactions sync incrementally (details stay on-device)' },
  // 批次 21:Google 地图时间轴导入 —— 手机端导出的 JSON 并入地点足迹
  { id: 'timeline', name: 'Google 时间轴导入', nameEn: 'Google Timeline import', icon: <IconMapPin />, iconBg: 'var(--chip-leaf)', method: 'file', description: '手机 Google 地图 → 设置 → 时间轴 → 导出数据,把 JSON 传进来并入地点足迹', descriptionEn: 'Google Maps app → Settings → Timeline → export, upload the JSON to merge into your place trail' },
  // 批次 19:相册批量导入 —— 一次选多张,AI 逐张识别入库(解决「一张张传太麻烦」)
  { id: 'photos', name: '相册批量导入', nameEn: 'Batch photo import', icon: <IconImage />, iconBg: 'var(--chip-frost)', method: 'batch-photos', description: '一次选多张照片,自动识别成记忆(每批最多 30 张)', descriptionEn: 'Pick multiple photos; each is recognized into memories (up to 30 per batch)' },
  { id: 'flomo', name: 'Flomo', icon: <IconNote />, iconBg: 'var(--chip-indigo)', method: 'server', syncEndpoint: '/api/portal/flomo?limit=5000', description: '同步 flomo 笔记，提取想法与记录', descriptionEn: 'Sync flomo notes; extract ideas and records' },
  // 批次 18:Notion 转正 —— OAuth 一键授权(像 flomo 那样选页面),内部 token 流保留为回退
  { id: 'notion', name: 'Notion', icon: <IconBook />, iconBg: 'var(--chip-gray)', method: 'token', syncEndpoint: '/api/portal/notion', tokenHint: 'notion.so/my-integrations → 新建集成(Internal)→ 复制 Internal Integration Secret(ntn_… 或 secret_…)→ 在要同步的 Notion 页面右上角「…」→ 连接 → 选中这个集成', tokenHintEn: 'notion.so/my-integrations → New internal integration → copy the secret (ntn_… / secret_…) → on each page: ••• → Connections → add this integration', description: '粘贴内部集成 token,同步共享给它的页面(提取项目与想法)', descriptionEn: 'Paste an internal integration token to sync the pages you shared with it' },
  // 批次 158:Granola 会议 —— Nesio 作为其远程 MCP 客户端(OAuth 2.0 DCR)。转写自动提炼成 To do/推断项。
  { id: 'granola', name: 'Granola 会议', nameEn: 'Granola meetings', icon: <IconBookOpen />, iconBg: 'var(--chip-leaf)', method: 'oauth', description: '连接 Granola,会议转写自动提炼成 To do(带截止日)和推断项,直接进今天页', descriptionEn: 'Connect Granola — meeting transcripts distill into dated to-dos and inferred items, straight to Today' },
  { id: 'toggl', name: 'Toggl Track', icon: <IconTimer />, iconBg: 'var(--chip-red)', method: 'token', syncEndpoint: '/api/portal/toggl', tokenHint: 'track.toggl.com → Profile → API Token', tokenHintEn: 'track.toggl.com → Profile → API Token', description: '同步时间记录，了解你的专注分布', descriptionEn: 'Sync time entries to see where your focus goes', dev: true },
  { id: 'health', name: 'Apple 健康', nameEn: 'Apple Health', icon: <IconHeartPulse />, iconBg: 'var(--chip-pink)', method: 'file', description: '免费侧载无法进「健康」共享列表。请导入导出的 zip/export.xml;或付费开发者账号签带 HealthKit 的包', descriptionEn: 'Free sideload cannot join Health sharing. Import export zip/xml; or sign with a paid Apple Developer team + HealthKit' },
  { id: 'reminder', name: 'Apple 提醒事项', nameEn: 'Apple Reminders', icon: <IconCheckSquare />, iconBg: 'var(--chip-amber)', method: 'shortcuts', ingestSource: 'reminder', description: '通过快捷指令推送提醒，自动转为承诺', descriptionEn: 'Push reminders via Shortcuts; they become commitments', dev: true },
  { id: 'keep', name: 'Keep 健康', nameEn: 'Keep fitness', icon: <IconActivity />, iconBg: 'var(--chip-green)', method: 'shortcuts', ingestSource: 'keep', description: '通过快捷指令推送运动数据（点设置看步骤）', descriptionEn: 'Push workout data via Shortcuts (tap Set up for steps)' },
  // 批次 22:微信读书无开放 API —— App 内导出笔记,粘贴文本解析入库
  { id: 'wechat_reading', name: '微信读书', nameEn: 'WeChat Reading', icon: <IconBookOpen />, iconBg: 'var(--chip-leaf)', method: 'file', description: '微信读书 App 导出笔记,粘进来解析成划线记忆', descriptionEn: 'Export notes from WeChat Reading and paste to parse highlights' },
  // 批次 161:微信读书自动同步(cookie 方案,非官方接口,cookie 会过期需重粘)
  { id: 'weread', name: '微信读书 · 自动同步', nameEn: 'WeChat Reading · auto', icon: <IconBookOpen />, iconBg: 'var(--chip-leaf)', method: 'token', syncEndpoint: '/api/portal/weread', tokenHint: '电脑浏览器登录 weread.qq.com → F12 开发者工具 → Network 里任一请求 → 复制 Request Headers 的 Cookie 整串粘进来。cookie 数小时会过期,过期重粘一次即可。', tokenHintEn: 'Log into weread.qq.com on desktop → DevTools → Network → copy the full Cookie request header. The cookie expires after hours — re-paste when it does.', description: '粘贴微信读书 cookie,自动同步有笔记的书的划线(非官方接口,cookie 会过期)', descriptionEn: 'Paste a WeChat Reading cookie to auto-sync highlights from books with notes (unofficial; cookie expires)', dev: true },
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
  const [teslaSheetOpen, setTeslaSheetOpen] = useState(false);
  // 需要 update-mode 修复的银行连接下标(来自上次同步)—— 有值时 Plaid 行给「修复」入口
  const [plaidRelink, setPlaidRelink] = useState<number[]>([]);
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState<string | null>(null);
  // 同步代:syncGoogle 串行拉多段(10–20s)全程无守卫,收尾无条件把 google 写回「已连接」。
  // 若期间用户点了「断开」(已撤销服务端 token),收尾会把连接器弹回「已连接」—— 本地标记与
  // 实际不一致的隐私隐患。disconnect 递增此代作废在途同步,收尾按代校验后跳过回写。
  const syncGenRef = useRef(0);
  // 「错付」防线:一次只发起一个 Plaid Link —— 连点会各建一个 Item,每个占 1 个试用名额。
  const plaidBusyRef = useRef(false);
  // 连好一家银行后就地问「再连一家」,免得跳回设置页重新找入口(多银行连续连接)。
  const [plaidChain, setPlaidChain] = useState<{ count: number } | null>(null);
  // P0 隐私:连接私有数据源(邮箱/日历/银行/Notion/Flomo)必须先登录 —— 匿名授权=无主
  // token,换人用这台设备就能看到你的邮件。null=未知(网络失败不误伤),false 才拦。
  // #21:三态照旧(null = 问不出来,不误伤),但答案来自唯一那份
  const session = useSessionState(open);
  const signedIn: boolean | null = session.state === 'unknown' ? null : session.state === 'signed-in';
  const [importPct, setImportPct] = useState<number | null>(null); // 健康大文件导入进度(0–100)
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [tokenInputFor, setTokenInputFor] = useState<string | null>(null);
  const [tokenValue, setTokenValue] = useState('');
  const [shortcutsFor, setShortcutsFor] = useState<string | null>(null);
  const [ingestUrl, setIngestUrl] = useState('');
  const [oauthSyncResult, setOauthSyncResult] = useState<Record<string, SyncResult>>({});
  // 批次 160:Granola 同步前的会议勾选(隐私门)。granolaList=null 时不显示选择器。
  const [granolaList, setGranolaList] = useState<Array<{ id: string; title: string; date?: string }> | null>(null);
  const [granolaSel, setGranolaSel] = useState<Set<string>>(new Set());
  const [granolaKnown, setGranolaKnown] = useState<Set<string>>(new Set());
  // 批次 38:Notion 数据库选择器
  const [notionDbLoading, setNotionDbLoading] = useState(false);
  const [notionDbList, setNotionDbList] = useState<Array<{ id: string; title: string }> | null>(null);
  const [notionDbSel, setNotionDbSel] = useState<string[]>([]);
  const { handleProps, cardStyle, expanded } = useSheetDrag(onClose);

  useEffect(() => {
    if (!open) return;
    const savedConn = loadConnectors();
    // 批次 37:有 Notion token 就算已连接 —— 连接(token 有效)和有没有共享页面是两回事。
    // 之前只在「同步成功且返回了页面」才翻成已连接,导致 token 已存但没共享页面时按钮
    // 永远停在「接入」,用户以为没连上。
    if (loadToken('notion')) savedConn.notion = true;
    setConnected(savedConn);
    // 服务端真源合并(同公众仓修法):iOS PWA 的 OAuth 在独立存储的应用内浏览器里
    // 完成,本机 nesio-connectors-v1 标记写不回主环境 —— 授权成功 UI 却一直显示
    // 「接入」。登录用户 token 在 Supabase(跨设备),服务端说已连就是已连,回写本机。
    fetch('/api/portal/integrations', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { integrations?: Record<string, { connected?: boolean }> } | null) => {
        const s = d?.integrations;
        if (!s) return;
        const updates: Record<string, boolean> = {};
        if (s.gmail?.connected || s.calendar?.connected) updates.google = true;
        // plaid 加进服务端真源合并 —— 令牌上云后,换浏览器登录即显示已连(不再要求重连)。
        for (const p of ['tesla', 'granola', 'notion', 'plaid'] as const) {
          if (s[p]?.connected) updates[p] = true;
        }
        if (!Object.keys(updates).length) return;
        for (const id of Object.keys(updates)) saveConnectorState(id, true);
        setConnected((prev) => ({ ...prev, ...updates }));
      })
      .catch(() => {});
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
      showToast(L(dict, 'Notion 已授权,点「同步」拉取你选择的页面', 'Notion authorized — tap Sync to pull the pages you shared'), true);
    }
    // 批次 158:Granola OAuth 回参
    const granolaParam = params.get('granola');
    if (granolaParam === 'connected') {
      saveConnectorState('granola', true);
      setConnected((p) => ({ ...p, granola: true }));
      showToast(L(dict, 'Granola 已连接,点「同步」提炼会议行动项', 'Granola connected — tap Sync to distill meeting action items'), true);
    } else if (granolaParam === 'login_required') {
      showToast(L(dict, '请先登录 Nesio 再连接 Granola', 'Sign in to Nesio first, then connect Granola'), false);
    } else if (granolaParam === 'connect_failed') {
      showToast(L(dict, `Granola 连接失败:${params.get('reason') || '未知'}`, `Granola connect failed: ${params.get('reason') || 'unknown'}`), false);
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
            <span className="nesio-connector-soon">{c.comingSoon ? L(dict, '即将上线', 'Coming soon') : L(dict, '开发中', 'In development')}</span>
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
    // 每批上限 30(此前 10 太少,用户要「多一些」)。逐张走云识别 + 进度提示,顺序不阻塞 UI。
    const list = Array.from(files || []).slice(0, 30);
    if (!list.length) return;
    setSyncing('photos');
    let saved = 0; let failed = 0;
    for (let i = 0; i < list.length; i++) {
      showToast(L(dict, `识别中 ${i + 1} / ${list.length}…`, `Recognizing ${i + 1} / ${list.length}…`), true);
      try {
        // 批次 66:压缩会剥 EXIF —— 先从原始字节读拍摄时间/拍摄地
        const { readExifCapture } = await import('@/lib/portal/exif-gps');
        const cap = await readExifCapture(list[i]);
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
        const savedForThis = nodes.map((n) => ingestLifeNode({
          ...n,
          source: 'photo',
          tags: [...(n.tags || []), '批量导入'],
          attributes: {
            ...(n as { attributes?: Record<string, string | number | boolean | null> }).attributes,
            // EXIF 拍摄地优先于"上传时在哪"(带 capturedLat 时 ingest 不再盖现场定位)
            ...(cap.lat != null && cap.lon != null ? { capturedLat: cap.lat, capturedLon: cap.lon } : {}),
            ...(cap.takenAt ? { takenAt: cap.takenAt } : {}),
          },
        } as NodeInput));
        // 批次 66:时间线落**拍摄那天**;拍摄地按拍摄时间记进足迹并回填地名
        if (savedForThis.length > 0 && (cap.takenAt || (cap.lat != null && cap.lon != null))) {
          const { updateLifeNode: patchNode, getLifeGraph: readGraph } = await import('@/lib/portal/life-graph');
          if (cap.takenAt) for (const sn of savedForThis) patchNode(sn.id, { createdAt: cap.takenAt });
          if (cap.lat != null && cap.lon != null) {
            const exLat = cap.lat; const exLon = cap.lon; const takenAt = cap.takenAt;
            const firstId = savedForThis[0].id;
            void Promise.all([import('@/lib/portal/place-trail'), import('@/lib/portal/capture-location')])
              .then(async ([trail, cl]) => {
                const geo = await cl.reverseGeocodeRobust(exLat, exLon).catch(() => ({ label: '' }));
                const label = geo.label || `${exLat.toFixed(3)},${exLon.toFixed(3)}`;
                trail.recordVisitAt(label, takenAt || new Date().toISOString());
                if (geo.label) {
                  const live = readGraph().find((x) => x.id === firstId);
                  if (live && !live.attributes.capturedPlace) {
                    patchNode(firstId, { attributes: { ...live.attributes, capturedPlace: geo.label } });
                  }
                }
              })
              .catch(() => {});
          }
        }
        // 批次 23:每张导入的照片也存本机,挂到该照片的第一个节点上(可看图、可问一问)
        if (savedForThis.length > 0) {
          try {
            const { compressToDataUrl, putLocalImage } = await import('@/lib/portal/local-image-store');
            const { updateLifeNode } = await import('@/lib/portal/life-graph');
            const dataUrl = await compressToDataUrl(list[i]);
            const imgId = `img-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
            await putLocalImage(imgId, dataUrl);
            // 批次 87:批量导入也建视觉指纹(以图搜图索引)
            void import('@/lib/portal/image-hash')
              .then(async ({ computeDHash, saveImageHash }) => {
                const h = await computeDHash(dataUrl);
                if (h) saveImageHash(savedForThis[0].id, h);
              })
              .catch(() => {});
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
  // 清理「失败链接」在 Plaid 侧已建但没换成 token 的 Item —— 否则每次失败都占 1 个试用名额
  //(错付根因)。best-effort,不阻断 UI。
  function releaseFailedPlaidItem(publicToken: string, linkToken?: string) {
    void fetch('/api/portal/plaid/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicToken, linkToken }),
    }).catch(() => { /* 清理失败最差回到占一个名额,不再抛 */ });
  }

  async function connectPlaid(updateIndex?: number) {
    const isUpdate = typeof updateIndex === 'number';
    // 防连点:发起阶段互斥。每发起一次 Link 都可能建一个 Item,连点 = 多烧名额。
    if (plaidBusyRef.current) return;
    plaidBusyRef.current = true;
    setSyncing('plaid');
    try {
      const res = await fetch('/api/portal/plaid/link-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isUpdate ? { updateIndex } : {}),
      });
      const data = await res.json() as { ok?: boolean; linkToken?: string; error?: string; env?: string; mode?: string };
      if (!data.ok || !data.linkToken) {
        const msg = data.error === 'plaid_not_configured'
          ? L(dict, 'Plaid 还没配置:dashboard.plaid.com → Keys 拿 client_id 和 Sandbox secret,配到 Vercel(PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV)', 'Plaid not configured: dashboard.plaid.com → Keys → set PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV on Vercel')
          : data.error === 'auth_required'
          ? L(dict, '连接银行需要先登录 Nesio(数据接入的私有数据都要求登录)', 'Linking a bank requires signing in to Nesio first')
          : L(dict, `Plaid 连接失败:${data.error || '未知'}`, `Plaid connect failed: ${data.error || 'unknown'}`);
        showToast(msg, false);
        plaidBusyRef.current = false;
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
        plaidBusyRef.current = false;
        setSyncing(null);
        return;
      }
      // OAuth 银行会整窗跳去银行授权,回来落在 /plaid-oauth 续接页 —— 它需要
      // 用同一个 link_token 重建 Link,发起前先存本机(成功/退出时清)。
      // JSON 带 mode:update 模式的 onSuccess 不做 exchange(修复既有 item,
      // public_token 不可换),续接页据此分流。
      try { localStorage.setItem('nesio-plaid-link-token', JSON.stringify({ token: data.linkToken, update: isUpdate })); } catch { /* ignore */ }
      const link = Plaid.create({
        token: data.linkToken,
        onSuccess: async (publicToken: string) => {
          try { localStorage.removeItem('nesio-plaid-link-token'); } catch { /* ignore */ }
          plaidBusyRef.current = false; // 模态已完成,放行下次发起
          if (isUpdate) {
            // 修复模式:item 已就地修好,不换 token、不烧名额 —— 直接重同步。
            setPlaidRelink((prev) => prev.filter((x) => x !== updateIndex));
            showToast(L(dict, '银行连接已修复,正在重新同步…', 'Bank connection repaired — resyncing…'), true);
            void syncPlaid();
            return;
          }
          // 财务⑥:带上 linkToken —— 多机构一次授权时服务端据此捞出 session 里
          // 全部 item 的 public_token 逐个交换,不再只连上第一家。
          try {
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
              // 就地问「再连一家」——连续连多家银行不用跳回设置页重新点入口。
              setPlaidChain((prev) => ({ count: (prev?.count || 0) + n }));
              void syncPlaid(); // 连上就同步,账户/流水立即可见,不再等用户手点
            } else {
              // 错付防线:Plaid 已在 onSuccess 建好 Item(占 1 个名额),exchange 失败必须
              // 把它释放掉,否则「失败也烧名额」重演(20/10 的根因)。
              releaseFailedPlaidItem(publicToken, data.linkToken);
              showToast(L(dict, `绑定失败:${exData.error || '未知'}(已释放这次连接,不占名额)`, `Link failed: ${exData.error || 'unknown'} — connection released, no quota used`), false);
            }
          } catch {
            // 网络中断同样可能留下已建 Item → 一并释放
            releaseFailedPlaidItem(publicToken, data.linkToken);
            showToast(L(dict, '绑定时网络中断(已释放这次连接,不占名额),请重试', 'Network dropped while linking — connection released, no quota used. Try again'), false);
          }
        },
        onExit: () => {
          // 用户取消:清掉续接用的 link_token,避免 /plaid-oauth 误用过期 token。
          try { localStorage.removeItem('nesio-plaid-link-token'); } catch { /* ignore */ }
          plaidBusyRef.current = false; // 放行下次发起
        },
      });
      link.open();
    } catch {
      showToast(L(dict, 'Plaid Link 加载失败,请检查网络', 'Failed to load Plaid Link — check your network'), false);
      plaidBusyRef.current = false;
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
    // 有连接需要修复(授权过期/改密码)→ 记下标,行内出「修复」按钮(update mode 不烧名额)
    setPlaidRelink(r.relinkIndexes || []);
    if (r.relinkIndexes?.length) {
      showToast(L(dict, `${r.relinkIndexes.length} 家银行的授权需要修复 —— 点 Plaid 行的「修复」,走的是修复模式,不占新名额`, `${r.relinkIndexes.length} bank connection(s) need repair — tap Repair on the Plaid row (update mode, doesn't use a new connection)`), false);
    }
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
      const { parseGoogleTimeline, mergeImportedVisits, backfillGenericPlaceLabels } = await import('@/lib/portal/place-trail');
      const json = JSON.parse(await file.text()) as unknown;
      const visits = parseGoogleTimeline(json);
      if (!visits.length) {
        showToast(L(dict, '没有解析到地点记录:请确认是 Google 地图时间轴导出的 JSON', 'No visits found — make sure this is the Google Maps Timeline export JSON'), false);
      } else {
        const added = mergeImportedVisits(visits);
        saveConnectorState('timeline', true);
        setConnected((p) => ({ ...p, timeline: true }));
        setCounts((p) => ({ ...p, timeline: added }));
        // Google 新版导出大多只有坐标没地名(满屏「未知地点」的根因)—— 导入完
        // 就地反查回填,常去的先有名字;查不完的下次打开地图/再导入时继续。
        showToast(L(dict, `时间轴导入完成:解析 ${visits.length} 段,新增 ${added} 条足迹。正在为地点补名字…`, `Timeline imported: ${visits.length} segments, ${added} new visits. Naming places…`), true);
        const named = await backfillGenericPlaceLabels(60);
        showToast(named > 0
          ? L(dict, `已为 ${named} 条足迹补上真实地名(洞察 → 分析 → 地点足迹)`, `Named ${named} visits (Insights → Analytics → Place trail)`)
          : L(dict, '导入完成(洞察 → 分析 → 地点足迹)', 'Import done (Insights → Analytics → Place trail)'), true);
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
        showToast(L(dict, `已提取 ${n.length} 个节点${suffix}`, `Extracted ${n.length} items${suffix}`), true);
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
      // 路由已返回可操作提示(缺 FLOMO_API_KEY / 令牌过期 / 格式不对)——直接透出,
      // 别再用「未配置或同步失败」把用户真正该做的一步(配读取令牌)藏起来。
      const raw = r.error || '';
      const actionable = raw && raw !== 'network' && raw !== 'not_configured';
      showToast(
        actionable
          ? L(dict, raw, raw)
          : L(
              dict,
              raw === 'network' ? 'Flomo 同步网络不稳,稍后再试一次' : 'Flomo 还差一步:需配置读取令牌 FLOMO_API_KEY',
              raw === 'network' ? 'Flomo sync hit a network hiccup — try again shortly' : 'Flomo needs one more step: set the read key FLOMO_API_KEY',
            ),
        false,
      );
      setSyncing(null);
      return;
    }
    saveConnectorState(c.id, true);
    setConnected((p) => ({ ...p, [c.id]: true }));
    setCounts((p) => ({ ...p, [c.id]: r.fresh }));
    // 单次封顶(防闪退):若还有剩余,提示再点一次继续导入。
    const more = r.remaining && r.remaining > 0 ? r.remaining : 0;
    showToast(
      L(
        dict,
        r.fresh
          ? more
            ? `已同步 ${r.fresh} 条 flomo 笔记,还剩 ${more} 条 —— 再点一次「同步」继续导入`
            : `已同步 ${r.fresh} 条 flomo 笔记(按 slug 去重,老笔记不重复入库)`
          : '没有新笔记 —— 已全部同步过',
        r.fresh
          ? more
            ? `Synced ${r.fresh} flomo notes; ${more} left — tap Sync again to continue`
            : `Synced ${r.fresh} flomo notes (deduped by slug)`
          : 'No new notes — everything already synced',
      ),
      true,
    );
    setSyncing(null);
  }

  // ── OAuth sync(google = 日历 + 邮件一起同步,结果分行展示)──
  async function syncGoogle(c: ConnectorDef) {
    const myGen = ++syncGenRef.current;
    setSyncing(c.id);
    setOauthSyncResult((p) => ({ ...p, google: { ok: true, msg: L(dict, '同步中…', 'Syncing…') } }));
    const parts: string[] = [];
    let allOk = true;
    let reauth = false;

    // 平台超时(504)回的是 HTML 不是 JSON —— 直接 res.json() 会炸进 catch,
    // 用户只能看到笼统的「网络错误」。先安全解析,解析不动就把状态码如实带出。
    const readJson = async <T,>(res: Response): Promise<T | null> => {
      try { return JSON.parse(await res.text()) as T; } catch { return null; }
    };

    // 日历
    try {
      const res = await fetch('/api/portal/calendar', { cache: 'no-store' });
      const data = await readJson<{ ok?: boolean; events?: Array<Record<string, unknown>>; error?: string; message?: string }>(res);
      if (!data) {
        allOk = false;
        parts.push(L(dict, `日历:服务器没接住(HTTP ${res.status}),稍等再点一次同步`, `Calendar: server hiccup (HTTP ${res.status}) — try again shortly`));
      } else if (data.ok && data.events?.length) {
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

    // 邮件:阻塞段用 analyze=false → 服务端本地正则抽取,快且稳(不再卡在云 AI 上超 60s → 504 →
    // 「网络错误」)。云 AI 抽取转后台富化(下方 enrichGmailInBackground),拿到更好的语义节点原位升级。
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 55_000); // 55s < 服务端 60s:拿干净 abort,不等平台 504
      let res: Response;
      try {
        // returnBodies=false:同步按钮只要 nodes,不拉几百 KB 全文回来(弱网会传断);
        // 全文由 connector-sync 专路另存本机。
        res = await fetch('/api/portal/gmail?includeBody=true&analyze=false&returnBodies=false', { signal: ctrl.signal });
      } finally {
        clearTimeout(to);
      }
      const data = await readJson<{ ok?: boolean; nodes?: NodeInput[]; error?: string; emailCount?: number; messages?: unknown[] }>(res);
      if (!data) {
        allOk = false;
        parts.push(L(dict, `邮件:服务器没接住(HTTP ${res.status}),稍等再点一次同步`, `Mail: server hiccup (HTTP ${res.status}) — try again shortly`));
      } else if (data.ok) {
        const nodeCount = data.nodes?.length ?? 0;
        if (nodeCount > 0) {
          data.nodes!.forEach((n) => ingestLifeNode({ ...n, source: 'email' } as NodeInput));
          localStorage.setItem('nesio-gmail-last-sync', String(Date.now()));
        }
        // Phase 2: 后台富化改为检查付费权限（免费用户跳过）
        // 云 AI 抽取后台富化(不阻塞本次同步;失败无声)—— 保留 AI 语义节点,同时同步不再超时。
        if (canUsePaidCloudAi()) {
          void enrichGmailInBackground(0);
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
    } catch (e) {
      allOk = false;
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      parts.push(aborted
        ? L(dict, '邮件:这批较多没跑完(已在后台处理),过一会儿再点一次同步就好,不影响日历/记忆', 'Mail: this batch was large and timed out — tap Sync again in a bit; calendar/memory are unaffected')
        : L(dict, '邮件:网络不稳,请重试', 'Mail: network unstable — please retry'));
    }

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

    // 若同步期间用户点了「断开」(bump 了 syncGenRef),不许收尾把连接器弹回「已连接」——
    // 那会和已撤销的服务端 token 不一致。仅清同步态,保留 disconnect 写下的断开状态。
    if (syncGenRef.current !== myGen) { setSyncing(null); return; }
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

  // 批次 160:Granola 同步 = 隐私门。点「同步」先列会议(免费档 list_meetings 只出标题/日期,
  // 不碰内容),让用户勾选哪些再拉 —— 你列表里有很私密的会议,不默认全拉。
  async function syncGranola() {
    setSyncing('granola');
    try {
      const res = await fetch('/api/portal/granola?listOnly=1&range=last_30_days', { cache: 'no-store' });
      const data = await res.json() as { ok?: boolean; error?: string; list?: Array<{ id: string; title: string; date?: string }> };
      if (!data.ok) {
        const reauth = data.error === 'token_expired' || data.error === 'not_connected';
        showToast(reauth ? L(dict, 'Granola 授权已失效,请重新连接', 'Granola auth expired — reconnect') : L(dict, `拉取会议列表失败:${data.error || '未知'}`, `Failed to list meetings: ${data.error || 'unknown'}`), false);
        return;
      }
      const { getLifeGraph } = await import('@/lib/portal/life-graph');
      const known = new Set(
        getLifeGraph().map((n) => n.attributes?.granolaMeetingId).filter((v): v is string => typeof v === 'string' && v.length > 0),
      );
      const list = data.list || [];
      setGranolaKnown(known);
      setGranolaList(list);
      // 默认勾选还没同步过的;已同步的不预选(避免重复,用户仍可手动勾)。
      setGranolaSel(new Set(list.map((m) => m.id).filter((id) => !known.has(id))));
    } catch (err) {
      showToast(L(dict, `拉取会议列表失败:${err instanceof Error ? err.message : ''}`, 'Failed to list meetings'), false);
    } finally {
      setSyncing(null);
    }
  }

  // 只提炼用户勾选的会议(≤10),过批次154 抽取落今天页。
  async function syncGranolaSelected(ids: string[]) {
    const picked = ids.slice(0, 10);
    if (!picked.length) { setGranolaList(null); return; }
    setGranolaList(null);
    setSyncing('granola');
    setOauthSyncResult((p) => ({ ...p, granola: { ok: true, msg: L(dict, '提炼中…', 'Distilling…') } }));
    try {
      const res = await fetch(`/api/portal/granola?ids=${encodeURIComponent(picked.join(','))}`, { cache: 'no-store' });
      const data = await res.json() as { ok?: boolean; error?: string; meetings?: Array<{ id: string; title: string; transcript: string; date?: string }> };
      if (!data.ok) {
        const reauth = data.error === 'token_expired' || data.error === 'not_connected';
        setOauthSyncResult((p) => ({ ...p, granola: { ok: false, msg: reauth ? L(dict, '需要重新授权', 'Reauth needed') : L(dict, '同步失败', 'Sync failed'), detail: data.error, needsReauth: reauth } }));
        showToast(reauth ? L(dict, 'Granola 授权已失效,请重新连接', 'Granola auth expired — reconnect') : L(dict, `同步失败:${data.error || '未知'}`, `Sync failed: ${data.error || 'unknown'}`), false);
        return;
      }
      const meetings = data.meetings || [];
      let created = 0;
      let linked = 0; // 挂到对应日历日程的场次(端到端可见:没挂上 = 标题/时间差超容差或日历没同步)
      for (const m of meetings) {
        const r = await ingestGranolaMeeting({ id: m.id, title: m.title, transcript: m.transcript, startedAt: m.date }, dict);
        if (r.status !== 'skipped') created += 1;
        if (r.linked) linked += 1;
      }
      setCounts((p) => ({ ...p, granola: created }));
      window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
      window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
      const detail = L(dict, `提炼 ${meetings.length} 场 · 新增 ${created} · 挂到日程 ${linked}`, `Distilled ${meetings.length} · ${created} new · ${linked} linked`);
      setOauthSyncResult((p) => ({ ...p, granola: { ok: true, msg: L(dict, '同步成功', 'Synced'), detail } }));
      showToast(created > 0 ? detail : L(dict, '没有新的行动项', 'No new action items'), true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOauthSyncResult((p) => ({ ...p, granola: { ok: false, msg: L(dict, '同步失败', 'Sync failed'), detail: msg } }));
      showToast(L(dict, `Granola 同步失败:${msg}`, `Granola sync failed: ${msg}`), false);
    } finally {
      setSyncing(null);
    }
  }

  async function syncOAuth(c: ConnectorDef) {
    if (c.id === 'google') { await syncGoogle(c); return; }
    if (c.id === 'granola') { await syncGranola(); return; }
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
          const detail = L(dict, `读取 ${emailCount} 封邮件 · 提取 ${nodeCount} 个节点`, `Read ${emailCount} emails · extracted ${nodeCount} items`);
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
    if (c.id === 'granola') { window.location.href = '/api/portal/granola/connect'; return; }
    if (c.id === 'tesla') { window.location.href = '/api/portal/tesla/connect'; return; }
    if (c.method === 'geo') {
      setSyncing(c.id);
      void (async () => {
        const {
          getDevicePosition,
          requestLocationPermission,
          requestAlwaysLocationPermission,
        } = await import('@/lib/portal/native-geolocation');
        const { isNativePlatform } = await import('@/lib/portal/platform-capabilities');
        const allowed = await requestLocationPermission();
        if (!allowed) {
          setSyncing(null);
          showToast(L(dict, '位置权限被拒绝 — 可在系统设置里打开定位后再试', 'Location denied — enable Location in Settings and retry'), false);
          return;
        }
        const pos = await getDevicePosition({ timeoutMs: 18_000, maximumAgeMs: 300_000, enableHighAccuracy: false });
        let alwaysOk = false;
        if (isNativePlatform()) {
          const always = await requestAlwaysLocationPermission();
          alwaysOk = always.always;
          // 即使这一次没拿到点,也开足迹监听(Always 已开时后台会补点)
          try {
            const { ensurePlaceTrailWatch } = await import('@/lib/portal/native-geolocation');
            void ensurePlaceTrailWatch();
          } catch { /* ignore */ }
        }
        if (!pos) {
          // 权限已有但本轮无点:仍标已连接,避免「Always 开了却像没接入」
          saveConnectorState('weather', true);
          setConnected((p) => ({ ...p, weather: true }));
          window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
          setSyncing(null);
          showToast(
            L(
              dict,
              alwaysOk
                ? '权限已是始终,这一次没拿到实时点 — 稍后再点接入,或到窗边/室外试一次(足迹监听已开)'
                : '暂时拿不到坐标 — 到窗边/室外再试;系统定位需开「精确位置」',
              alwaysOk
                ? 'Always granted but no fix this time — retry near a window; trail watch is on'
                : 'No coordinates — try near a window outdoors; enable Precise Location',
            ),
            false,
          );
          return;
        }
        // 写入天气/记忆定位缓存,让「已连接」真有实时坐标可用。
        try {
          const { prefetchCaptureLocation } = await import('@/lib/portal/capture-location');
          const cacheKey = 'nesio-weather-last-geo-v1';
          localStorage.setItem(cacheKey, JSON.stringify({ lat: pos.lat, lon: pos.lon, ts: Date.now() }));
          void prefetchCaptureLocation(true);
        } catch { /* ignore */ }

        // 立刻记一条足迹 + 开后台监听(此前只要权限、不记点 → Always 了足迹仍空)。
        try {
          const { recordVisitFromCoords, ensurePlaceTrailWatch } = await import('@/lib/portal/native-geolocation');
          await recordVisitFromCoords(pos.lat, pos.lon);
          if (isNativePlatform()) void ensurePlaceTrailWatch();
        } catch { /* ignore */ }
        setSyncing(null);
        saveConnectorState('weather', true);
        setConnected((p) => ({ ...p, weather: true }));
        window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
        window.dispatchEvent(new CustomEvent('nesio-place-trail-updated'));
        const alwaysHint = alwaysOk
          ? L(dict, ' · 始终已开 · 已写入足迹', ' · Always on · trail updated')
          : (isNativePlatform()
            ? L(dict, ' · 足迹已记(始终可在系统设置打开)', ' · Trail saved (enable Always in Settings)')
            : L(dict, ' · 足迹已记', ' · Trail saved'));
        showToast(
          L(dict, `位置已授权 · ${pos.lat.toFixed(3)}, ${pos.lon.toFixed(3)}${alwaysHint}`, `Location granted · ${pos.lat.toFixed(3)}, ${pos.lon.toFixed(3)}${alwaysHint}`),
          true,
        );
        // 顺手要本地通知权限 + 3 秒后一条自检提醒(失败不影响定位)。
        void import('@/lib/portal/native-local-notifications')
          .then(async (m) => {
            const ok = await m.ensureLocalNotificationPermission();
            if (!ok) return;
            await m.scheduleLocalAlert({
              title: L(dict, 'Nesio 提醒已就绪', 'Nesio alerts ready'),
              body: L(dict, '本地通知可用。之后的到点提醒会走这条通道。', 'Local notifications work. Timed reminders will use this channel.'),
              afterSec: 3,
            });
          })
          .catch(() => {});
      })();
      return;
    }
    // 原生壳优先 HealthKit;失败或 Web 再走导出文件。
    if (c.id === 'health') {
      void (async () => {
        const { isNativePlatform, healthKit } = await import('@/lib/portal/platform-capabilities');
        if (!isNativePlatform()) {
          markBusy();
          fileRef.current?.click();
          return;
        }
        if (healthKit() !== 'native') {
          showToast(
            L(dict, '这版壳还没带 HealthKit — 请装最新 Nesio-shell-fix.ipa 后再点', 'This shell build has no HealthKit — install latest Nesio-shell-fix.ipa'),
            false,
          );
          return;
        }
        setSyncing('health');
        showToast(
          L(dict, '即将弹出「健康」权限 — 请打开需要的类别(步数/睡眠/心率…)', 'Health permission sheet next — turn on steps/sleep/HR…'),
          true,
        );
        try {
          const { syncHealthKitToStore } = await import('@/lib/portal/native-healthkit');
          const res = await syncHealthKitToStore(30);
          setSyncing(null);
          if (!res.ok || !res.metrics) {
            const reason = res.reason || 'denied';
            const entitlementBlocked = /entitlement|missing|unauthorized|not available|HealthKit/i.test(reason)
              || reason === 'denied';
            showToast(
              L(
                dict,
                entitlementBlocked
                  ? '直连 HealthKit 需要付费 Apple 开发者账号签名；免费 Sideloadly 进不了「健康→共享」列表。请改用导出 zip/xml。'
                  : `HealthKit 未读到数据(${reason})。请改用导出 zip/xml。`,
                entitlementBlocked
                  ? 'Live HealthKit needs a paid Apple Developer signed build; free Sideloadly cannot appear in Health→Sharing. Use export zip/xml.'
                  : `HealthKit empty (${reason}). Use export zip/xml instead.`,
              ),
              false,
            );
            markBusy();
            fileRef.current?.click();
            return;
          }
          saveConnectorState('health', true);
          setConnected((p) => ({ ...p, health: true }));
          setCounts((p) => ({ ...p, health: res.metrics!.metrics.length || res.metrics!.workouts }));
          // 洞察「健康」tab 默认跟 Lab;同步成功后强制打开,免得数据进了却看不到。
          try {
            const { setModuleOverride } = await import('@/lib/portal/module-overrides');
            setModuleOverride('health', 'on');
          } catch { /* ignore */ }
          window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
          showToast(
            L(
              dict,
              `已接入 HealthKit:${res.metrics.metrics.length} 项 · 洞察→健康。改权限:「健康」App→共享→App→Nesio`,
              `HealthKit: ${res.metrics.metrics.length} metrics · Insights→Health. Permissions: Health app→Sharing→Apps→Nesio`,
            ),
            true,
          );
        } catch {
          setSyncing(null);
          showToast(L(dict, 'HealthKit 同步失败 — 可改用导出文件', 'HealthKit sync failed — try export file'), false);
          markBusy();
          fileRef.current?.click();
        }
      })();
      return;
    }
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
          // 健康镜头 H1:临床数据同步接进 Signal 主事实表 —— 不接的话它就还是一条盲肠,
          // 问一问/时间线/相关性都看不见(存了等于没存)。幂等,重复导入不会长重复。
          const { ensureClinicalProjected } = await import('@/lib/health/health-signals');
          const projected = ensureClinicalProjected({ ...clinical, importedAt: new Date().toISOString() });
          if (clinical.labs.length || clinical.medications.length || clinical.conditions.length) {
            const tail = projected ? L(dict, ' · 已接进记忆', ' · linked to memory') : '';
            showToast(L(dict, `临床记录:${clinical.labs.length} 项化验 · ${clinical.medications.length} 用药 · ${clinical.conditions.length} 诊断${tail}`, `Clinical: ${clinical.labs.length} labs · ${clinical.medications.length} meds · ${clinical.conditions.length} conditions${tail}`), true);
          }
        } catch (err) {
          // 红线:不静默吞。临床解析失败不该拖垮健康导入,但也不该假装什么都没发生。
          logDropped('connectors.clinical_import', err);
          showToast(L(dict, '临床记录这部分没读出来,健康指标已照常导入', 'Clinical records could not be read; health metrics imported as usual'), false);
        }
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
    // 作废任何在途 syncGoogle 的收尾回写(否则它会把刚断开的连接器弹回「已连接」)。
    syncGenRef.current++;
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

    // Notion — 断连撤销闭环(S2):清 httpOnly nesio_notion_access cookie + Supabase 集成行 + 本机选中的 DB。
    // Notion 无公开 token 撤销端点 → 彻底移除需用户在 Notion 集成设置里删授权(文案点明,不装能做)。
    if (id === 'notion') {
      try { localStorage.removeItem(NOTION_DB_KEY); } catch { /* ignore */ }
      setNotionDbSel([]);
      void fetch('/api/portal/integrations?provider=notion', { method: 'DELETE' })
        .then((r) => r.json() as Promise<{ ok?: boolean }>)
        .then((d) => showToast(d.ok
          ? L(dict, '已断开 Notion 并清除 token（彻底移除请在 Notion 集成设置里删除授权）', 'Disconnected Notion and cleared tokens (to fully remove, delete it in Notion integration settings)')
          : L(dict, '已断开本地连接', 'Disconnected locally'), true))
        .catch(() => showToast(L(dict, '已断开本地连接，云端清除失败——稍后重试', 'Disconnected locally; cloud clear failed — retry later'), false));
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
      <input ref={photosRef} type="file" accept="image/*" multiple className="nesio-visually-hidden" onChange={(e) => { void handleBatchPhotos(e.target.files); e.target.value = ''; }} />
      <input ref={timelineRef} type="file" accept="application/json,.json" className="nesio-visually-hidden" onChange={(e) => { void handleTimelineFile(e.target.files); e.target.value = ''; }} />
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className={`nesio-settings-sheet-card${expanded ? ' nesio-settings-sheet-card--expanded' : ''}`} style={cardStyle}>
        <div className="nesio-sheet-handle" {...handleProps} />
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">{L(dict, '数据接入', 'Data sources')}</h2>
        </div>
        <p className="nesio-settings-sheet-desc">{L(dict, '连接外部信号源，让 Today Feed 出现真实数据驱动的建议。', 'Connect outside signals so Today runs on real data.')}</p>

        {toast && (
          <div style={{ background: toast.ok ? 'var(--status-go-soft)' : 'var(--status-risk-soft)', border: `1px solid ${toast.ok ? 'var(--status-go)' : 'var(--status-risk)'}`, borderRadius: 'var(--radius-sm)', padding: 'var(--space-3) var(--space-3)', marginBottom: 'var(--space-3)', fontSize: 'var(--text-sm)', color: toast.ok ? 'var(--status-go)' : 'var(--status-risk)' }}>
            {toast.ok ? '✓ ' : ''}{toast.msg}
          </div>
        )}

        {/* 多银行连续连接:连好一家后就地问要不要再连一家(不用跳回设置页重新找入口)。 */}
        {plaidChain && (
          <div style={{ background: 'var(--portal-accent-soft)', border: '1px solid var(--portal-accent-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3) var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--portal-ink)' }}>
              {L(dict, `已连接 ${plaidChain.count} 家银行。还有别的银行要连吗?`, `${plaidChain.count} bank(s) linked. Add another?`)}
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button type="button" className="nesio-ob-primary-btn" style={{ flex: 1 }}
                onClick={() => { setPlaidChain(null); void connectPlaid(); }}>
                {L(dict, '＋ 再连一家', '＋ Add another')}
              </button>
              <button type="button"
                style={{ flex: 1, borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-muted)', fontSize: 'var(--text-sm)' }}
                onClick={() => setPlaidChain(null)}>
                {L(dict, '连好了', 'All done')}
              </button>
            </div>
          </div>
        )}

        <div className="nesio-settings-sheet-body">
          {/* 分层入口(用户定):免费只留 Google(日历+邮件)和 地理位置·天气;
              Pro 加 Flomo(Google people/tasks 的 scope 已随 google 一次授权带上,无独立行);
              Lab 全量可见 —— 本仓个人版 Lab 默认开(isLabModeOn 默认 true),
              显式关掉 Lab 才会看到这里的分层公开形态。 */}
          {CONNECTORS.filter((c) => !c.dev)
            .filter((c) => {
              if (isLabModeOn()) return true;
              // 位置/健康是壳能力自测与日常刚需,Lab 关也保留入口。
              const FREE = ['google', 'weather', 'health'];
              const PRO = ['google', 'weather', 'health', 'flomo'];
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
                      <p className="nesio-connector-sync" style={{ color: oauthSyncResult[c.id].ok ? 'var(--status-go)' : 'var(--status-risk)', fontSize: 'var(--text-overline)', lineHeight: 1.4 }}>
                        {oauthSyncResult[c.id].msg}
                        {oauthSyncResult[c.id].detail && <><br /><span style={{ opacity: 0.8, whiteSpace: 'pre-line' }}>{oauthSyncResult[c.id].detail}</span></>}
                        {oauthSyncResult[c.id].needsReauth && (
                          <><br /><button type="button" style={{ marginTop: 'var(--space-1)', fontSize: 'var(--text-overline)', color: 'var(--portal-blue-deep)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }} onClick={() => handleConnect(c)}>{L(dict, '点击重新授权 →', 'Tap to reconnect →')}</button></>
                        )}
                      </p>
                    )}
                  </div>

                  {c.comingSoon ? (
                    <span style={{ fontSize: 'var(--text-overline)', color: 'var(--portal-muted)', flexShrink: 0 }}>{L(dict, '敬请期待', 'Stay tuned')}</span>
                  ) : c.method === 'shortcuts' ? (
                    <button type="button" className="nesio-connector-connect" onClick={() => setShortcutsFor(shortcutsFor === c.id ? null : c.id)} style={{ flexShrink: 0 }}>
                      {shortcutsFor === c.id ? L(dict, '收起', 'Collapse') : L(dict, '设置', 'Set up')}
                    </button>
                  ) : isConn && (c.method === 'token' || c.method === 'server') ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', flexShrink: 0 }}>
                      <button type="button" className="nesio-connector-connect" onClick={() => c.method === 'server' ? syncFlomo(c) : syncToken(c)} disabled={isSync}>{isSync ? <span className="nesio-sync-spin" aria-hidden /> : L(dict, '同步', 'Sync')}</button>
                      {/* 批次 38:Notion 选择要同步哪些数据库(表) */}
                      {c.id === 'notion' && (
                        <button type="button" className="nesio-connector-connect" style={{ background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)' }} onClick={() => openNotionPicker()} disabled={notionDbLoading}>{notionDbLoading ? '…' : L(dict, '选表', 'Pick tables')}</button>
                      )}
                      <button type="button" className="nesio-connector-disconnect" onClick={() => disconnect(c.id)}>{L(dict, '断开', 'Disconnect')}</button>
                    </div>
                  ) : isConn && c.method === 'oauth' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', flexShrink: 0 }}>
                      <button type="button" className="nesio-connector-connect" onClick={() => syncOAuth(c)} disabled={isSync}>{isSync ? <span className="nesio-sync-spin" aria-hidden /> : L(dict, '同步', 'Sync')}</button>
                      {/* 批次 27:Plaid 连了一家还想连别家 —— 已连接也给「+银行」再开一次 Link */}
                      {c.id === 'plaid' && (
                        <button type="button" className="nesio-connector-connect" style={{ background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)' }} onClick={() => connectPlaid()} disabled={isSync}>{L(dict, '+ 银行', '+ Bank')}</button>
                      )}
                      {/* update mode:授权过期的连接就地修复,不新建 connection、不烧名额 */}
                      {c.id === 'plaid' && plaidRelink.length > 0 && (
                        <button type="button" className="nesio-connector-connect" style={{ background: 'var(--status-gentle-soft)', color: 'var(--status-gentle)' }} onClick={() => connectPlaid(plaidRelink[0])} disabled={isSync}>{L(dict, `修复 (${plaidRelink.length})`, `Repair (${plaidRelink.length})`)}</button>
                      )}
                      {/* Tesla 独立数据视图(用户定):电量/里程/充电历史直接看,不用翻财务/足迹 */}
                      {c.id === 'tesla' && (
                        <button type="button" className="nesio-connector-connect" style={{ background: 'var(--portal-accent-soft)', color: 'var(--portal-blue-deep)' }} onClick={() => setTeslaSheetOpen(true)}>{L(dict, '数据', 'Data')}</button>
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
                          style={{ width: '100%', marginBottom: 'var(--space-2)' }}
                        >
                          {isSync ? '…' : L(dict, '用 Notion 授权(选择页面)→', 'Authorize with Notion (pick pages) →')}
                        </button>
                        <p style={{ fontSize: 'var(--text-overline)', color: 'var(--portal-muted)', margin: '0 0 var(--space-2)', lineHeight: 1.5 }}>
                          {L(dict, '会跳到 Notion 同意页,像 flomo 那样勾选要同步的页面。若在 iOS 上被 Notion App 劫持打不开,改用下面的粘贴 token。', 'Opens the Notion consent page (pick pages, like flomo). If iOS hijacks it into the Notion app, use paste-token below instead.')}
                        </p>
                        <div style={{ borderTop: '1px solid var(--portal-hairline, rgba(127,127,127,0.18))', margin: '0 0 var(--space-2)' }} />
                        <a
                          href="https://www.notion.so/my-integrations"
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: 'inline-block', marginBottom: 'var(--space-2)', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--portal-blue-deep)', textDecoration: 'underline' }}
                        >
                          {L(dict, '或粘贴 token:打开 notion.so/my-integrations →', 'Or paste a token: open notion.so/my-integrations →')}
                        </a>
                      </>
                    )}
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', marginBottom: 'var(--space-2)', lineHeight: 1.5 }}>{dict === 'en' ? (c.tokenHintEn ?? c.tokenHint) : c.tokenHint}</p>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <input className="nesio-ob-input" style={{ marginBottom: 0, flex: 1, fontSize: 'var(--text-sm)' }} type="password" placeholder={L(dict, '粘贴 Token…', 'Paste token…')} value={tokenValue} onChange={(e) => setTokenValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitToken(c); }} autoFocus />
                      <button type="button" className="nesio-connector-connect" onClick={() => submitToken(c)} disabled={!tokenValue.trim()}>{L(dict, '连接', 'Connect')}</button>
                    </div>
                  </div>
                )}

                {/* Notion 数据源选择器 —— N-5:选表 → 同步走 N-3 结构折叠(书=一条记忆,划线折进去);附一键重来 */}
                {c.id === 'notion' && notionDbList && (
                  <div className="nesio-connector-token-box">
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-ink)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>{L(dict, '选择要同步的表', 'Pick tables to sync')}</p>
                    <p style={{ fontSize: 'var(--text-overline)', color: 'var(--portal-muted)', marginBottom: 'var(--space-2)', lineHeight: 1.5 }}>{L(dict, '勾选后点上面「同步」:会按结构理解 —— 读书这类自动把划线折进书里(一本书=一条记忆),丢掉日历表和技术列。重复同步幂等,删了不会重复。', 'Check tables, then tap Sync above. We read the structure — e.g. highlights fold into their book (one book = one memory), calendar tables and ID columns dropped. Re-syncing is idempotent, no duplicates.')}</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', maxHeight: 220, overflowY: 'auto' }}>
                      {notionDbList.map((db) => (
                        <label key={db.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--portal-ink)', cursor: 'pointer' }}>
                          <input type="checkbox" checked={notionDbSel.includes(db.id)} onChange={() => toggleNotionDb(db.id)} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{db.title}</span>
                        </label>
                      ))}
                    </div>
                    <p style={{ fontSize: 'var(--text-overline)', color: 'var(--portal-muted)', marginTop: 'var(--space-2)' }}>{L(dict, `已选 ${notionDbSel.length} 个`, `${notionDbSel.length} selected`)}</p>
                    <button
                      type="button"
                      onClick={clearNotionMemories}
                      style={{ marginTop: 'var(--space-2)', width: '100%', padding: 'var(--space-2)', fontSize: 'var(--text-xs)', fontWeight: 600, borderRadius: 'var(--radius-sm, 12px)', border: '1.5px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-muted)', cursor: 'pointer' }}
                    >
                      {L(dict, '清除已导入的 Notion 记忆(重来)', 'Clear imported Notion memories (start over)')}
                    </button>
                  </div>
                )}

                {/* Shortcuts setup */}
                {shortcutsFor === c.id && (
                  <div className="nesio-connector-token-box">
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-ink)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>{L(dict, '通过 iOS 快捷指令接入', 'Connect via iOS Shortcuts')}</p>
                    <ol style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', lineHeight: 1.7, paddingLeft: 'var(--space-4)', marginBottom: 'var(--space-2)' }}>
                      <li>{L(dict, '打开「快捷指令」App，新建快捷指令', 'Open the Shortcuts app and create a new shortcut')}</li>
                      <li>{L(dict, '添加动作「获取 URL 内容」', 'Add the "Get Contents of URL" action')}</li>
                      <li>{L(dict, 'URL 填下方地址，方法选 ', 'Use the URL below, method ')}<strong>POST</strong></li>
                      <li>{L(dict, '请求体 JSON：', 'Request body JSON: ')}<code style={{ fontSize: 'var(--text-overline)' }}>{L(dict, `{"source":"${c.ingestSource}","content":"数据内容"}`, `{"source":"${c.ingestSource}","content":"your data"}`)}</code></li>
                      <li>{L(dict, '可设为自动化，定时推送', 'Optionally automate it on a schedule')}</li>
                    </ol>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                      <code style={{ flex: 1, fontSize: 'var(--text-overline)', background: 'rgba(88,140,227,0.08)', padding: 'var(--space-2) var(--space-2)', borderRadius: 'var(--radius-xs)', wordBreak: 'break-all', color: 'var(--portal-ink)' }}>{ingestUrl}</code>
                      <button type="button" className="nesio-connector-connect" onClick={copyIngestUrl} style={{ flexShrink: 0 }}>{L(dict, '复制', 'Copy')}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* 各接入的取数窗口:用户看到某板块「内容很少」时,先对这张表再怀疑同步坏了。
              合起来还揭示一件事 —— 一个把「回溯>预测」写进公理的 App,导进来的数据
              大部分只有「最近」和「未来」。这是事实,不藏着。 */}
          <details style={{ marginTop: 'var(--space-4)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)', padding: 'var(--space-1) var(--space-3)' }}>
            <summary style={{ cursor: 'pointer', padding: 'var(--space-2) 0', fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--portal-ink)', fontWeight: 600 }}>{L(dict, '各接入能拿到多久的数据', 'How far back each source reaches')}</span>
              <span aria-hidden>▾</span>
            </summary>
            <div style={{ paddingBottom: 'var(--space-2)' }}>
              {IMPORT_WINDOWS.map((w) => (
                <div key={w.source[0]} style={{ padding: 'var(--space-2) 0', borderTop: '1px solid var(--portal-line)' }}>
                  <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--portal-ink)' }}>
                    {L(dict, w.source[0], w.source[1])}
                    {!w.canBackfill && (
                      <span style={{ marginLeft: 6, fontSize: 'var(--text-overline)', color: 'var(--status-gentle)', background: 'var(--status-gentle-soft)', borderRadius: 999, padding: '0.05rem 0.4rem' }}>
                        {L(dict, '拿不到更早', 'no earlier data')}
                      </span>
                    )}
                  </p>
                  <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', lineHeight: 1.6 }}>
                    {L(dict, w.window[0], w.window[1]).replace(/\*\*/g, '')}
                  </p>
                </div>
              ))}
            </div>
          </details>

          {/* ── 开发中 · 折叠二级(以后慢慢开发的接入不占主列表) ── */}
          <details className="nesio-conn-dev-group" style={{ marginTop: 'var(--space-4)', border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)', padding: 'var(--space-1) var(--space-3)' }}>
            <summary style={{ cursor: 'pointer', padding: 'var(--space-2) 0', fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                <span style={{ color: 'var(--portal-ink)', fontWeight: 600 }}>{L(dict, '开发中 · 抢先看', 'In development · preview')}</span>
                <span style={{ marginLeft: 8, fontSize: 'var(--text-overline)' }}>{CONNECTORS.filter((c) => c.dev).length} {L(dict, '项在打磨', 'being polished')}</span>
              </span>
              <span aria-hidden>▾</span>
            </summary>
            {CONNECTORS.filter((c) => c.dev).map((c) => renderDevRow(c))}
          </details>

          {/* 批次 35:三行说明收进一个小信息符号 */}
          <div style={{ marginTop: 'var(--space-4)', textAlign: 'center', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
            {L(dict, '连接方式与数据去向', 'How sources connect & where data lives')}
            <InfoTip text={L(dict,
              '有 API 的(Google 日历+Gmail / Notion / Toggl / Flomo)直接连接;没有公开 API 的(提醒事项 / Keep / 微信读书)通过快捷指令推送。抽取出的记录存在你的设备;连接邮箱/日历/Notion/银行等账号时,授权与数据拉取会经过对应服务商的服务器。',
              "API sources (Google Calendar+Gmail / Notion / Toggl / Flomo) connect directly; no-API sources (Reminders / Keep / WeRead) push via Shortcuts. Extracted records live on your device; connecting email/calendar/Notion/bank accounts routes authorization and fetching through those providers' servers.")} />
          </div>
        </div>
      </div>
      {/* 批次 160:Granola 会议勾选(隐私门)—— 同步前选哪些会议再提炼 */}
      {granolaList && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} onClick={() => setGranolaList(null)} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 560, maxHeight: '80vh', background: 'var(--glass-bg-solid, #fff)', borderRadius: '1rem 1rem 0 0', display: 'flex', flexDirection: 'column', paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div style={{ padding: 'var(--space-4) var(--space-4) var(--space-2)' }}>
              <p style={{ margin: 0, fontWeight: 700, color: 'var(--portal-ink)' }}>{L(dict, '选择要提炼的会议', 'Pick meetings to distill')}</p>
              <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{L(dict, '只提炼你勾选的(每次最多 10 场)。灰色=已同步过。', 'Only the ones you check are distilled (max 10). Grey = already synced.')}</p>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-1) var(--space-4)' }}>
              {granolaList.map((m) => {
                const done = granolaKnown.has(m.id);
                const checked = granolaSel.has(m.id);
                return (
                  <label key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--portal-line)', cursor: 'pointer', opacity: done ? .55 : 1 }}>
                    <input type="checkbox" checked={checked} onChange={(e) => setGranolaSel((prev) => { const n = new Set(prev); if (e.target.checked) n.add(m.id); else n.delete(m.id); return n; })} style={{ marginTop: 'var(--space-1)', flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--portal-ink)' }}>{m.title || L(dict, '(无标题)', '(untitled)')}</span>
                      {(m.date || done) && (
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
                          {m.date ? new Date(m.date).toLocaleDateString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' }) : ''}{done ? L(dict, ' · 已同步', ' · synced') : ''}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
              {!granolaList.length && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', padding: 'var(--space-4) 0' }}>{L(dict, '最近 30 天没有会议', 'No meetings in the last 30 days')}</p>}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4) var(--space-4)', borderTop: '1px solid var(--portal-line)' }}>
              <button type="button" className="nesio-connector-disconnect" onClick={() => setGranolaList(null)} style={{ flex: 1 }}>{L(dict, '取消', 'Cancel')}</button>
              <button type="button" className="nesio-connector-connect" onClick={() => syncGranolaSelected(Array.from(granolaSel))} disabled={granolaSel.size === 0} style={{ flex: 2 }}>{L(dict, `同步选中 (${granolaSel.size})`, `Sync selected (${granolaSel.size})`)}</button>
            </div>
          </div>
        </div>
      )}
      <WechatReadingImportSheet open={wechatReadingOpen} onClose={() => setWechatReadingOpen(false)} />
      <TeslaSheet open={teslaSheetOpen} onClose={() => setTeslaSheetOpen(false)} />
    </div>
  );
}
