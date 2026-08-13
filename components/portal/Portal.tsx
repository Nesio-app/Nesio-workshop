'use client';

import '@/lib/life-domain/node-fact-sink'; // 节点事实 sink:任何写入前武装
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ingestLifeNode, ingestLifeNodesBatch } from '@/lib/life-domain/ingest-node';
import dynamic from 'next/dynamic';
import TodayFeed from './TodayFeed';
import MemoryTab from './MemoryTab';
/**
 * 2026-07-29:删掉 TellNesioSheet(点中间键先弹「拍/说/收」三个扇形按钮那一层)。
 * 中间键现在**一按直达相机**;另外两个动作在别处本来就有更近的入口
 * (说 = 输入框右边的话筒,收 = 输入框左边的「+」)。这一层是纯中转,删掉少一次点击。
 */
type CaptureMode = 'camera' | 'voice' | 'share';
import PortalBottomNav from './PortalBottomNav';
import PortalOnboarding from './PortalOnboarding';
import InstallPrompt from './InstallPrompt';
import NesioSheet from './ui/NesioSheet';
import { canUse, canOpenFreeze, refreshServerEntitlement } from '@/lib/portal/entitlement';
import { reconcileLocalOwner, claimLocalDataForUser, purgeAllLocalUserData, setLocalOwner, getLocalOwner } from '@/lib/portal/local-owner';
import { archiveCurrentSpace, restoreArchivedSpace } from '@/lib/portal/account-spaces';
import { syncMemoryWithCloud } from '@/lib/portal/cloud-memory-sync';
import { syncLearningWithCloud, registerLearningAutoPush } from '@/lib/portal/cloud-learning-sync';
import { syncProfileWithCloud, registerProfileAutoPush } from '@/lib/portal/cloud-profile-sync';
import { autoSyncModulesWithCloud } from '@/lib/portal/cloud-module-sync';
import { isCloudSyncSuspended, whenIdle, SYNC_RESUME_EVENT } from '@/lib/portal/sync-suspend';
import { autoSyncEmailBodiesWithCloud } from '@/lib/portal/cloud-email-sync';
import { autoSyncReaderBooksWithCloud } from '@/lib/portal/cloud-reader-sync';
import { autoSyncPlaceImagesWithCloud } from '@/lib/portal/cloud-place-image-sync';
import { autoSyncWardrobeImagesWithCloud } from '@/lib/portal/cloud-wardrobe-image-sync';
import { autoSyncCareImagesWithCloud } from '@/lib/portal/cloud-care-image-sync';
import { autoSyncLocalFilesWithCloud } from '@/lib/portal/cloud-file-sync';
import { autoSyncConnectorsOnBoot } from '@/lib/portal/connector-sync';
import { OPEN_MODE_CAMERA_EVENT, setPendingCapture, backfillMissingPhotoUploads, type ModeCameraMode } from '@/lib/portal/capture-pipeline';

// Heavy sheets load on first open, not at boot — together they were ~3.5k
// lines of first-paint JS for UI the user may never touch in a session.
const CameraSheet = dynamic(() => import('./CameraSheet'), { ssr: false });
const VoiceInputSheet = dynamic(() => import('./VoiceInputSheet'), { ssr: false });
const ShareSheet = dynamic(() => import('./ShareSheet'), { ssr: false });
const MoodSheet = dynamic(() => import('./MoodSheet'), { ssr: false });
const FreezeVaultSheet = dynamic(() => import('./FreezeVaultSheet'), { ssr: false });
const WorkoutPlayer = dynamic(() => import('./fitness/WorkoutPlayer'), { ssr: false });
import TabErrorBoundary from './TabErrorBoundary';
const NesioChatSheet = dynamic(() => import('./NesioChatSheet'), { ssr: false });
const NotePanelEnhanced = dynamic(() => import('./NotePanelEnhanced'), { ssr: false });
const ToolsTreasurePopup = dynamic(() => import('./ToolsTreasureSheet'), { ssr: false });
const InventorySheet = dynamic(() => import('./InventorySheet'), { ssr: false });
// 悬浮播放球:没在放的时候自己返回 null。ssr:false —— 它读的是浏览器里那个 audio 的状态。
const FloatingPlayer = dynamic(() => import('./music/FloatingPlayer'), { ssr: false });
const CalendarCreateSheet = dynamic(() => import('./CalendarCreateSheet'), { ssr: false });
const FamilySharingSheet = dynamic(() => import('./family/FamilySharingSheet'), { ssr: false });
const TeslaSheet = dynamic(() => import('./TeslaSheet'), { ssr: false });
const CookingSheet = dynamic(() => import('./cooking/CookingSheet'), { ssr: false });
const DailyBriefSheet = dynamic(() => import('./DailyBriefSheet').then((m) => m.DailyBriefSheet), { ssr: false });
const DictionarySheet = dynamic(() => import('./dictionary/DictionarySheet'), { ssr: false });
// 洞察 = 全屏浮层(非 surface):提到 Portal 层,底部导航从任意页都能开。1143 行,开时才加载。
const InsightsSheet = dynamic(() => import('./InsightsSheet'), { ssr: false });
type InsightsMainTab = import('./InsightsSheet').MainTab;
import { DEFAULT_PORTAL_CONFIG } from '@/lib/portal/defaults';
import { openToolHref } from '@/lib/portal/open-tool';
import {
  applyFeatureControlToolGate,
  applyFirstLaunchToolGate,
  isToolKilledByLocalFeatureControl,
} from '@/lib/portal/launch-safety';
import { readLaunchSurfaceContextFromBrowser } from '@/lib/portal/launch-surface.mjs';
import {
  resolveShellRuntimeTools,
  shouldShellOpenTool,
} from '@/lib/portal/shell-runtime-resolver.mjs';
import { applyLowSatTheme, loadModuleOverrides, MODULE_OVERRIDES_EVENT } from '@/lib/portal/module-overrides';
import { buildPortalShellManifest } from '@/lib/portal/module-manifest';
import {
  fetchDecModules,
  readDecDataError,
  type DecModulesPayload,
} from '@/lib/portal/dec-data-client';
import {
  PORTAL_CACHE_KEYS,
  readPortalCache,
  TREASURE_TOOLBOX_KEY,
  writePortalCache,
} from '@/lib/portal/prefetch-cache';
import { configUrl } from '@/lib/portal/paths';
import { saveCalendarToLocal } from '@/lib/portal/calendar-local-store';
import {
  importSupabaseHashSession,
  markNesioOnboardingDoneForAuth,
  NESIO_ONBOARDING_COMPLETE_EVENT,
} from '@/lib/portal/auth-client';
import { loadProfileSettings, portalLocaleToDictionaryLocale, PROFILE_UPDATED_EVENT, type PortalLocale } from '@/lib/portal/profile';
import { L } from '@/lib/portal/i18n';
import { usePortalLocale } from './use-portal-locale';
import { runConnectors, refreshWeather } from '@/lib/platform/runtime/integration-runtime';
import { pruneDisposableSignals } from '@/lib/life-domain';
import { hydrateSignalFactStore } from '@/lib/life-domain/signal-read-cache';
import { readSession } from '@/lib/portal/session-state';
import { STORAGE_FULL_EVENT, STORAGE_WARNING_EVENT } from '@/lib/portal/storage-health';
import { recordAppOpen } from '@/lib/portal/feature-usage';
import { track, installErrorTracking } from '@/lib/portal/telemetry';
import type { PortalConfig, PortalDecMetadata, PortalTool } from '@/lib/portal/types';
import { type ToolForShellState } from './tool-state';
import { holdUiOverlay, requestDestructiveReload } from '@/lib/portal/app-busy';

const DEC_METADATA_TTL_MS = 30_000;
const FIRST_MEMORY_RECEIPT_KEY = 'nesio-first-memory-receipt-shown-v1';
const HAPTIC_FEEDBACK_KEY = 'nesio-haptic-feedback-enabled-v1';
const ASK_GUIDE_KEY = 'nesio-ask-guide-seen-v1';

type ActiveSurface = 'today' | 'memory';
type AuthSessionPayload = {
  ok?: boolean;
  user?: { id?: string; email?: string };
  loggedIn?: boolean;
  hasRefreshToken?: boolean;
  status?: string;
  authReady?: boolean;
  profileBootstrapBlocking?: boolean;
};

/**
 * 读登录态。**走 session-state 那个单例,不再自己 fetch。**
 *
 * 原来这里是一句裸 `fetch('/api/auth/session')` —— 而 PortalOnboarding 和
 * mirror-profile 各有一句一模一样的。三趟请求各自在不同时刻回来、各自 setState,
 * 于是开机头几秒登录态会来回变(你报的那个)。
 *
 * bug #21 建 session-state 时统一过一轮,但这三处没并进去,因为它们要的是
 * `hasRefreshToken` / `authReady` / `profileBootstrapBlocking`,而当时那个单例
 * 只回 state + email 装不下。现在单例缓存整个 payload,这里取回来就行 ——
 * **同一时刻只有一趟请求,所有人拿到同一个答案。**
 */
/**
 * @param force `true` = 一定要真的打一次服务器,不吃缓存。
 *
 * ⚠️ 两个调用点要的**不是同一件事**,合并时差点合错:
 *
 *   · 重同步批次开头那句(`runHeavySyncBatch`)要的是**副作用** ——
 *     「先单路刷新会话写回 cookie,再开并行云同步」,为的是避免 access 过期窗口里
 *     多路 `grant_type=refresh_token` 互踢。它必须真的发出去。
 *     吃了 30 秒缓存的话这句就成了空转,而那条保护**静默失效**,
 *     症状要到并发同步互踢时才浮出来 —— 极难查。
 *   · `refreshAuthSession` 要的是**当前状态**,吃缓存正合适(本来就是为了少打几趟)。
 *
 * 所以 force 不是可选的调优参数,是区分这两种语义的开关。
 */
/**
 * 云同步任务表。**名字必须稳定** —— 离线队列里只存名字(函数序列化不了),
 * 重跑时靠它找回该调哪个。改名 = 队列里那条变成认不出来的孤儿。
 */
const CLOUD_SYNC_TASKS = [
  // 记忆图/学习态/profile 逐一 union/LWW 合并回灌(跨端一致)。
  { name: 'memory', run: () => syncMemoryWithCloud() },
  { name: 'learning', run: () => syncLearningWithCloud() },
  { name: 'profile', run: () => syncProfileWithCloud() },
  // 记录级模块同步(**唯一的通用云同步**):健康/足迹/财务/物品/关系… 每个 durable key 一行。
  { name: 'modules', run: () => autoSyncModulesWithCloud() },
  // 邮件全文/导入书籍/地点封面照/衣帽间照片/文件附件:各自独立 IDB 的记录级同步,量级大不进模块同步。
  { name: 'email-bodies', run: () => autoSyncEmailBodiesWithCloud() },
  { name: 'reader-books', run: () => autoSyncReaderBooksWithCloud() },
  { name: 'place-images', run: () => autoSyncPlaceImagesWithCloud() },
  { name: 'wardrobe-images', run: () => autoSyncWardrobeImagesWithCloud() },
  { name: 'care-images', run: () => autoSyncCareImagesWithCloud() },
  { name: 'local-files', run: () => autoSyncLocalFilesWithCloud() },
  // 本机有图、无 storagePath 的记忆节点 → 补传 memory_assets(不限衣物/一餐)。
  { name: 'photo-backfill', run: () => backfillMissingPhotoUploads({ limit: 24 }).then(() => {}) },
  // 外部连接器(日历/邮件/flomo/银行/通讯录)拉新,30 分钟节流,内部保证。
  { name: 'connectors', run: () => autoSyncConnectorsOnBoot() },
];

/** 名字 → 怎么跑。给 drainCloudSyncQueue 用(队列里只有名字)。 */
const CLOUD_SYNC_REGISTRY: Record<string, () => Promise<unknown>> =
  Object.fromEntries(CLOUD_SYNC_TASKS.map((t) => [t.name, t.run]));

async function fetchAuthSessionPayload(force = false): Promise<AuthSessionPayload | null> {
  const info = await readSession(force ? { force: true } : {});
  return (info.payload as AuthSessionPayload | null) ?? null;
}

function AskGuideSheet({
  open,
  onClose,
  onStart,
}: {
  open: boolean;
  onClose: () => void;
  onStart: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  return (
    <NesioSheet
      variant="center"
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      card={false}
      ariaLabel={L(dict, '问念念', 'Ask Nessa')}
    >
      <div className="nesio-ask-guide-card">
        <div className="nesio-sheet-handle" aria-hidden />
        <p className="nesio-ask-guide-kicker">{L(dict, '长按中间按钮', 'Long-press the center button')}</p>
        <h2>{L(dict, '问念念', 'Ask Nessa')}</h2>
        <p>{L(dict, '念念替你记得 —— 找东西、找线索，也可以问下一步。', "Nessa remembers for you — find things, find clues, or ask what's next.")}</p>
        <div className="nesio-ask-guide-examples" aria-label={L(dict, '问念念示例', 'Ask Nessa examples')}>
          <span>{L(dict, '钥匙在哪里', 'Where are my keys')}</span>
          <span>{L(dict, 'Linda 生日买什么', "What to buy for Linda's birthday")}</span>
          <span>{L(dict, '上次买的药还有吗', 'Any of that medicine left')}</span>
        </div>
        <div className="nesio-ask-guide-actions">
          <button type="button" className="nesio-ob-primary-btn" onClick={onStart}>{L(dict, '开始问念念', 'Start asking')}</button>
          <button type="button" className="nesio-ask-guide-later" onClick={onClose}>{L(dict, '稍后', 'Later')}</button>
        </div>
      </div>
    </NesioSheet>
  );
}

// 批次 116:localStorage 键 → 人话(存储报警诊断「哪里占空间」)。
function storageKeyLabel(key: string, dict: Parameters<typeof L>[0]): string {
  const MAP: Record<string, [string, string]> = {
    'treasurebox-profile-avatar': ['头像图片', 'Avatar image'],
    'nesio-life-graph-v1': ['记忆本体(未上云)', 'Memories (not synced)'],
    'nesio-bank-tx-v1': ['银行流水', 'Bank transactions'],
    'nesio-bank-accounts-v1': ['银行账户', 'Bank accounts'],
    'nesio-place-trail-v1': ['足迹轨迹', 'Place trail'],
    'nesio-travel-trips-v1': ['行程计划', 'Travel trips'],
    'nesio-img-hash-v1': ['图片指纹索引', 'Image index'],
    'nesio-health-v1': ['健康数据', 'Health data'],
    'nesio-experiments-v2': ['实验数据', 'Experiments'],
    'nesio-rewards-v1': ['奖品仓库', 'Rewards'],
  };
  const hit = MAP[key];
  if (hit) return L(dict, hit[0], hit[1]);
  if (/chat/i.test(key)) return L(dict, '聊天记录', 'Chat history');
  if (/cache/i.test(key)) return L(dict, '缓存', 'Cache');
  if (/embed/i.test(key)) return L(dict, '语义索引', 'Embeddings');
  return key.replace(/^(nesio-|treasurebox-)/, '').replace(/-v\d+$/, '');
}

function normalizeLaunchSurfaceContext(raw: {
  viewerRole?: unknown;
  testerAllowlist?: unknown;
  testerCohort?: unknown;
}) {
  return {
    viewerRole:
      raw.viewerRole === 'personal_lab'
        ? ('personal_lab' as const)
        : raw.viewerRole === 'tester'
          ? ('tester' as const)
          : ('public' as const),
    testerAllowlist: Array.isArray(raw.testerAllowlist)
      ? raw.testerAllowlist.filter((item): item is string => typeof item === 'string')
      : [],
    testerCohort: typeof raw.testerCohort === 'string' ? raw.testerCohort : null,
  };
}

function parseDecMetaFromModules(payload: DecModulesPayload): Map<string, PortalDecMetadata> {
  const map = new Map<string, PortalDecMetadata>();
  if (!payload.ok || !('modules' in payload) || !Array.isArray(payload.modules)) return map;
  for (const entry of payload.modules) {
    if (!entry || typeof entry !== 'object') continue;
    const moduleId =
      typeof (entry as { moduleId?: unknown }).moduleId === 'string'
        ? (entry as { moduleId?: string }).moduleId!
        : '';
    const mode =
      typeof (entry as { mode?: unknown }).mode === 'string'
        ? (entry as { mode?: string }).mode!
        : '';
    if (!moduleId || !mode) continue;
    const n = entry as {
      dependencyCount?: unknown;
      ownedData?: unknown;
      emittedEvents?: unknown;
      approvalRequiredActions?: unknown;
      dependencyDataKeys?: unknown;
    };
    map.set(moduleId, {
      moduleId,
      mode,
      dependencyCount: typeof n.dependencyCount === 'number' ? n.dependencyCount : undefined,
      ownedDataCount: Array.isArray(n.ownedData) ? n.ownedData.length : undefined,
      emittedEventsCount: Array.isArray(n.emittedEvents) ? n.emittedEvents.length : undefined,
      approvalActionCount: Array.isArray(n.approvalRequiredActions) ? n.approvalRequiredActions.length : undefined,
      dependencyDataKeys: Array.isArray(n.dependencyDataKeys) ? n.dependencyDataKeys : undefined,
    });
  }
  return map;
}

function parseDecShellRoutesFromModules(
  payload: DecModulesPayload,
): Map<string, Pick<ToolForShellState, 'entryStatus' | 'modeAvailability' | 'emptyStateKey' | 'approvalGateKeys'>> {
  const routes = new Map<
    string,
    Pick<ToolForShellState, 'entryStatus' | 'modeAvailability' | 'emptyStateKey' | 'approvalGateKeys'>
  >();
  if (!payload.ok || !payload.shellRoutes || !Array.isArray(payload.shellRoutes.routes)) return routes;
  for (const route of payload.shellRoutes.routes) {
    if (!route || typeof route !== 'object') continue;
    const moduleId =
      typeof (route as { moduleId?: unknown }).moduleId === 'string'
        ? (route as { moduleId?: string }).moduleId!
        : '';
    if (!moduleId) continue;
    routes.set(moduleId, {
      entryStatus: (route as { entryStatus?: unknown }).entryStatus,
      modeAvailability: (route as { modeAvailability?: unknown }).modeAvailability,
      emptyStateKey: (route as { emptyStateKey?: unknown }).emptyStateKey,
      approvalGateKeys: (route as { approvalGateKeys?: unknown }).approvalGateKeys,
    });
  }
  return routes;
}

function mergePortalConfigWithDecMetadata(
  config: PortalConfig,
  moduleMeta: Map<string, PortalDecMetadata>,
): PortalConfig {
  if (!moduleMeta.size) return config;
  return {
    ...config,
    tools: config.tools.map((tool) => {
      const meta = moduleMeta.get(tool.id);
      return meta ? { ...tool, decMeta: meta } : tool;
    }),
  };
}

export default function Portal() {
  // 架构审查 #4:向浏览器申请持久存储,降低 IDB/localStorage 被静默驱逐的风险
  //(Safari/Chrome 对已安装 PWA 通常放行;拒绝也无害,云备份仍是兜底)。
  useEffect(() => {
    try { void navigator.storage?.persist?.(); } catch { /* 不支持则算了 */ }
    // 记一次应用打开(会话/活跃天),供回访再触达提醒判定「不是第一次登录」
    try { recordAppOpen(); } catch { /* 本机偏好,失败不影响使用 */ }
  }, []);

  // 原生壳:已连位置或已有 Always → 恢复足迹后台监听(significant / visits)。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { isNativePlatform } = await import('@/lib/portal/platform-capabilities');
        if (!isNativePlatform() || cancelled) return;
        const { checkLocationPermission, ensurePlaceTrailWatch } = await import('@/lib/portal/native-geolocation');
        const perm = await checkLocationPermission();
        if (!perm.whenInUse || cancelled) return;
        await ensurePlaceTrailWatch();
      } catch { /* 无插件时安静跳过 */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const [config, setConfig] = useState<PortalConfig>(DEFAULT_PORTAL_CONFIG);
  const [decModules, setDecModules] = useState<Map<string, PortalDecMetadata>>(new Map());
  const [decShellRoutes, setDecShellRoutes] = useState<
    ReturnType<typeof parseDecShellRoutesFromModules>
  >(new Map());
  const [activeSurface, setActiveSurface] = useState<ActiveSurface>('today');
  const [reliefBusy, setReliefBusy] = useState(false);
  const [reliefMsg, setReliefMsg] = useState('');
  const [storageAlert, setStorageAlert] = useState<{ kind: 'full' | 'warning'; percent: number; largest?: Array<{ key: string; bytes: number }> } | null>(null);
  /**
   * 邀请制挡下的那一次(2026-07-31)。magic link / 第三方登录被挡时,callback 会带
   * `?status=not_invited` 把人送回这里 —— 不说一句的话,他看到的是「点了邮件链接、
   * 回来了、然后什么也没发生」,只会再点一次、再等一封信。
   */
  const [notInvited, setNotInvited] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('status') !== 'not_invited' && params.get('auth') !== 'auth_not_invited') return;
    setNotInvited(true);
    // 读完就把参数擦掉,免得刷新一次又弹一遍。
    // 只擦触发这条提示的那两个。**刻意不列 profileBootstrap\* 那几个**:
    // test:auth-product-profile-bootstrap 禁止 Portal 里出现那个词 —— 它守的是
    // 「不许拿 profile bootstrap 去挡已登录用户」。我这儿只是清 URL 参数、
    // 跟门控毫无关系,但契约是文本匹配,抓不出这个区别。
    // 与其为了一个清参数的便利去放宽那条保护(放宽了就可能漏掉真的门控用法),
    // 不如少清两个无害的参数 —— 它们本来也不影响什么。
    for (const k of ['status', 'auth']) params.delete(k);
    const qs = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, []);
  const [captureMode, setCaptureMode] = useState<CaptureMode | null>(null);

  // 批次 7:iOS PWA 后台驻留页面从不重载,用户会停在几天前的旧 UI。
  // 回到前台时对比部署版本,变了就整页刷新(间隔 ≥60s,不打扰输入中的表单:
  // 仅在没有打开任何 sheet/输入焦点时刷)。
  useEffect(() => {
    // 批次202:基线用**客户端构建 SHA**(编译期内联),而非「首次拉到的线上版本」。
    // 旧逻辑 known='' → 首检设成线上当前版,于是只能发现「用着用着上了新版」;发现不了
    // 「冷启动加载的本就是旧缓存代码」(PWA/浏览器缓存)——各端版本不一、修复程度不同的真因。
    // 现在:客户端构建 ≠ 线上部署 → 这个 surface 在跑旧代码 → 强刷(SW 导航是 network-first,
    // 刷新即取到新 HTML→新 chunk)。3 分钟防抖防 SW/CDN 抖动导致的循环。
    let known = process.env.NEXT_PUBLIC_BUILD_SHA || '';
    let lastCheck = 0;
    const check = async () => {
      if (Date.now() - lastCheck < 60_000) return;
      lastCheck = Date.now();
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        const data = await res.json() as { v?: string };
        if (!data.v || data.v === 'dev') return;
        if (!known) { known = data.v; return; } // 本地无构建标识(dev)→ 退回旧行为
        if (data.v !== known) {
          const last = Number(sessionStorage.getItem('nesio-version-reload') || 0);
          if (Date.now() - last < 3 * 60_000) return; // 防抖:3 分钟内不重复整页刷
          const typing = document.activeElement instanceof HTMLInputElement
            || document.activeElement instanceof HTMLTextAreaElement;
          // busy / 浮层开着时 requestDestructiveReload 会推迟到浮层关完再刷,
          // 避免整页 reload 把状态打回「今天」、冲掉正在进行的家务/车/运营操作。
          if (!typing) {
            sessionStorage.setItem('nesio-version-reload', String(Date.now()));
            requestDestructiveReload();
          }
        }
      } catch { /* offline 等下次 */ }
    };
    void check();
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  // 拍一下直达:扇形按钮同手势调起原生相机,拍完的文件直接进 CameraSheet
  const [cameraFile, setCameraFile] = useState<File | null>(null);
  // 批次 66(用户定案):所有入口的图片统一走「拍一下」同一识别界面 ——
  // 分享/上传选图派发此事件,EXIF 拍摄时间地点 + AI 识别 + 确认卡一条链路。
  // 批次 70:行程↔确认邮件确定性自动挂钩(纯规则,图谱一变就去抖调和)
  useEffect(() => {
    void import('@/lib/portal/plan-links').then((m) => m.initPlanLinks()).catch(() => {});
    // 月度小结:让「我这个月练了什么」搜得到。只折本机有流水的那些域,
    // 边界写在 monthly-digest.ts 文件尾。
    void import('@/lib/portal/monthly-digest').then((m) => m.refreshMonthlyDigestsOnBoot()).catch(() => {});
    // 健康:壳里 NesioHealthKit 是真的(从 IPA 核过),但之前**只有连接中心那一个手动按钮**
    // 在用它 —— 步数睡眠心率要靠你自己想起来去点一下同步。开机静默拉一次(一天一次)。
    // 静默 = 不弹权限:授权是在连接中心点「同步」时给的,开机路上突然弹 HealthKit 授权页
    // 和用户正在做的事对不上。没授权的话 fetch 只是拿不到东西,不会打扰。
    void import('@/lib/portal/native-healthkit').then((m) => m.syncHealthKitQuietly()).catch(() => {});
  }, []);

  /**
   * 提醒 → 系统通知(2026-07-31,壳里 NesioLocalNotify 已确认可用)。
   *
   * 在这之前,你设的「每月 15 号早上 9 点交房租」到点什么都不会发生 ——
   * 得自己打开 App 才看得见。能力一直在,只是没接到业务上。
   *
   * 三个时机各有各的必要,少一个就有洞:
   *   · **开机**   —— 上次排的可能已经响完了,或者跨了时区;
   *   · **回前台** —— 同上,而且这是最高频的一次校准(壳只认相对秒数,必须现算);
   *   · **提醒变了** —— 新建/改时间/删除/打勾,立刻反映到排程,不用等下次回前台。
   *
   * 一律**不弹权限**(askPermission 默认 false):没人按按钮的时候突然弹一个系统弹窗
   * 是最招人烦的那种。若 iOS 设置里已经允许通知、App 内开关从未点过,
   * applyAll 会把开关视为已开并排程(否则系统开了、App 永远 no_permission_ask)。
   */
  useEffect(() => {
    let stop = false;
    let welcomed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      if (stop) return;
      // 图更新很勤,合并成一次排程,别把 64 格配额打满又撤。
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void import('@/lib/portal/notify-apply')
          .then((m) => m.applyAllLocalNotifications({ welcomePing: !welcomed }))
          .then(() => { welcomed = true; })
          .catch(() => { /* 排不上不影响 App —— 提醒本体在列表里,一条没丢 */ });
      }, 600);
    };
    sync();
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      sync();
      // 点系统通知后 App 回前台 → 尝试打开刚响过的那条详情
      void import('@/lib/portal/notify-deep-link').then((m) => {
        m.tryOpenRecentNotifyTarget();
      }).catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('nesio-schedule-reminders-updated', sync);
    window.addEventListener('nesio-notify-prefs-updated', sync);
    window.addEventListener('nesio-family-board-updated', sync);
    window.addEventListener('nesio-tesla-snapshot-updated', sync);
    window.addEventListener('nesio-life-graph-updated', sync);
    const onNotifyOpen = (e: Event) => {
      const id = String((e as CustomEvent).detail?.id || '');
      if (!id) return;
      try {
        window.dispatchEvent(new CustomEvent('nesio-open-memory-node', { detail: { id } }));
      } catch { /* ignore */ }
    };
    window.addEventListener('nesio-open-notify-target', onNotifyOpen);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('nesio-schedule-reminders-updated', sync);
      window.removeEventListener('nesio-notify-prefs-updated', sync);
      window.removeEventListener('nesio-family-board-updated', sync);
      window.removeEventListener('nesio-tesla-snapshot-updated', sync);
      window.removeEventListener('nesio-life-graph-updated', sync);
      window.removeEventListener('nesio-open-notify-target', onNotifyOpen);
    };
  }, []);
  // 批次 85:懒加载 chunk 跨部署失效的全局兜底(错误页之外的路径,
  // 比如事件回调里的 dynamic import 被拒)—— 同一把 5 分钟防循环锁。
  useEffect(() => {
    const CHUNK_ERR_RE = /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed/i;
    const heal = (msg: string) => {
      if (!CHUNK_ERR_RE.test(msg)) return;
      try {
        const last = Number(sessionStorage.getItem('nesio-chunk-reload') || 0);
        if (Date.now() - last > 5 * 60_000) {
          sessionStorage.setItem('nesio-chunk-reload', String(Date.now()));
          requestDestructiveReload();
        }
      } catch { /* ignore */ }
    };
    const onRejection = (e: PromiseRejectionEvent) => heal(String(e.reason?.message || e.reason || ''));
    const onError = (e: ErrorEvent) => heal(`${e.message || ''}`);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }, []);
  // 批次 86(用户实锤「打字时看不到输入框」):批次 81 把浮层锚到物理屏后,
  // 键盘弹起不再自动挤压布局 —— 用 visualViewport 实时把键盘高度写进
  // --kb-inset,聊天/语音/底部 sheet 的输入区随它抬升。
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      document.documentElement.style.setProperty('--kb-inset', `${kb}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  // 批次 81(白边拔根的兜底半边):iOS standalone 键盘收起后 window 高度
  // 偶发卡短(WebKit 老 bug),主页面 100dvh 布局随之缩水。焦点离开输入框
  // 后滚回顶部,促使视口回弹;浮层已用 lvh 免疫,这里管的是主页面。
  useEffect(() => {
    const heal = () => setTimeout(() => {
      const t = document.activeElement as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      window.scrollTo(0, 0);
    }, 60);
    window.addEventListener('focusout', heal);
    return () => window.removeEventListener('focusout', heal);
  }, []);
  // 批次 78(补丁清偿 P1):「联网后自动重试」此前只在记忆页挂载期间成立
  // (online 监听挂在 MemoryTab)。移到应用根,承诺无条件兑现;
  // retryLifeGraphCloudSync 自带 cloudMemorySyncEnabled 门,匿名/关同步时是空转。
  useEffect(() => {
    const retry = () => { void import('@/lib/portal/life-graph').then((m) => m.retryLifeGraphCloudSync()).catch(() => {}); };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, []);
  useEffect(() => {
    const onRecog = (e: Event) => {
      const f = (e as CustomEvent<{ file?: File }>).detail?.file;
      // 批次 80(用户实锤「分享图后闪退回首页」):ShareSheet 派发本事件后随即
      // onClose → setCaptureMode(null),同一批次里把这里刚设的 'camera' 清掉,
      // CameraSheet 一闪即关。延迟一拍,让关闭先落地再开相机。
      if (f instanceof File) {
        setTimeout(() => { setCameraFile(f); setCaptureMode('camera'); }, 80);
      }
    };
    window.addEventListener('nesio-recognize-image', onRecog);
    return () => window.removeEventListener('nesio-recognize-image', onRecog);
  }, []);
  /*
   * voiceIntent / voiceSeed 已删(2026-07-31)。
   *
   * 语音 sheet 曾经有两副面孔:intent='note' 记一笔、intent='ask' 问念念。
   * 现在**所有**问念念入口都进真对话页(见 openAskChat),ask 那一支再没有人走 ——
   * 留着一个不可达的 state 就是留一条会被人重新接上的旧路。
   * 这张 sheet 从此只做一件事:说一句、记下来。
   */
  const [noteOpen, setNoteOpen] = useState(false);
  const [locale, setLocale] = useState<PortalLocale>('zh');
  const dict = portalLocaleToDictionaryLocale(locale);
  const [authReady, setAuthReady] = useState(false);
  // 批次 14 数据完整性:会话接口网络失败/非 200 时不能当「未登录」——
  // 瞬时失败绝不能清库(否则重同步后列表大洗牌)。
  // 三态:true=确定登录 / false=服务器明确说未登录 / null=未知(启动中/网络问题/session_unverified)。
  // 未知态:不跑连接器、不清库;UI 私据门 fail-closed(不露真实数据,可短暂 demo)。
  // 明确匿名且本机仍有残留:与登出同款 purge(共享设备泄露收口)。
  const [authDefinitelyAnonymous, setAuthDefinitelyAnonymous] = useState(false);
  const [authSessionLoggedIn, setAuthSessionLoggedIn] = useState<boolean | null>(null);
  const [onboardingActive, setOnboardingActive] = useState(false);
  const [memoryReceipt, setMemoryReceipt] = useState(false);
  const [askGuideOpen, setAskGuideOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // 批次 23:节点详情「问一问这张图」→ 开聊天并把图交给它
  useEffect(() => {
    const onAskImage = (e: Event) => {
      const detail = (e as CustomEvent).detail as { url?: string; name?: string };
      if (detail?.url) {
        try { sessionStorage.setItem('nesio-pending-ask-image', JSON.stringify(detail)); } catch { /* ignore */ }
        setChatOpen(true);
      }
    };
    window.addEventListener('nesio-ask-image', onAskImage);
    return () => window.removeEventListener('nesio-ask-image', onAskImage);
  }, []);
  // 阅读器划词「问念念」→ 开聊天并把选中文作为引用喂进输入框(仿 ask-image)
  useEffect(() => {
    const onAskText = (e: Event) => {
      const detail = (e as CustomEvent).detail as { text?: string; send?: boolean };
      const text = (detail?.text || '').trim();
      if (!text) return;
      // send:true = 这句话本身就是问题(首页输入条点「问念念」),开页即发,不再让人按一次;
      // 不带 send = 划词引用,预填等用户补问题。两种意图存在同一个信封里,由 sheet 分流。
      try {
        sessionStorage.setItem('nesio-pending-ask-text', JSON.stringify({ text, send: detail?.send === true }));
      } catch { /* ignore */ }
      setInsightsOpen(false);   // 浮层不关会盖住聊天页 —— 仓里「表面死按钮」的老根因
      setChatOpen(true);
    };
    window.addEventListener('nesio-ask-text', onAskText);
    return () => window.removeEventListener('nesio-ask-text', onAskText);
  }, []);
  const [moodOpen, setMoodOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false); // 批次 176:每日简报全局挂载(例行卡 + Lab demo 都派 nesio-open-brief 打开)
  const [dictOpen, setDictOpen] = useState(false);
  const [dictQuery, setDictQuery] = useState('');
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false); // 洞察全屏浮层(底部导航第 3 个 tab / nesio-open-insights 事件打开)
  const [insightsTab, setInsightsTab] = useState<InsightsMainTab | undefined>(undefined);
  // 深链的「第几次」。只传 tab 的话,**同一个 tab 连点第二次 state 值没变** ——
  // InsightsSheet 那边 useEffect([initialTab]) 就不会再触发,表现是这一行死了、别的行还好
  // (用户原话:「充电花费」和「行驶记录」能跳,只有「停车/充电位置」这一行是死的 ——
  //  其实是那一次他已经在 timeline 上了)。带个自增号,每次派发都算一次新的深链。
  const [insightsNonce, setInsightsNonce] = useState(0);
  // 洞察是否停在宫格首页 —— 首页要露出底部导航(Bug4 图12)。由 InsightsSheet 回报。
  const [insightsHub, setInsightsHub] = useState(false);
  const [proGate, setProGate] = useState<string | null>(null); // 非 null = 显示 Pro 升级引导(值=功能名)
  // 跨账号本地数据冲突(P0 隐私):登录后本机数据归属与当前用户不符 → 阻断处理
  const [ownerConflict, setOwnerConflict] = useState<
    { kind: 'other_account'; prevEmail: string; userId: string; email: string }
    | { kind: 'anonymous_data'; userId: string; email: string }
    | null
  >(null);
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [calendarCreateOpen, setCalendarCreateOpen] = useState(false);
  const [familyOpen, setFamilyOpen] = useState(false);
  const [teslaOpen, setTeslaOpen] = useState(false);
  const [cookingOpen, setCookingOpen] = useState(false);
  const [cookingRecipeName, setCookingRecipeName] = useState<string | undefined>(undefined);
  const [pantryIntake, setPantryIntake] = useState(false);   // 做饭页「拍一拍进货」:复用相机、拍的当食材落库
  // 「一个相机、多种模式」:记一餐/衣帽间带模式调起主相机;拍完经 capture-pipeline 交接匣回到来源 sheet。
  const [modeCamera, setModeCamera] = useState<ModeCameraMode | null>(null);
  const [workoutSession, setWorkoutSession] = useState<import('./fitness/WorkoutPlayer').PlayerSession | null>(null);
  // 每次「开始跟练」自增,用作 WorkoutPlayer 的 key → 换一个训练(如跑步→力量)必定全新挂载,
  // 绝不复用上一个训练的内部态(idx/phase/repCount)。修「打开力量没反应 / 退出力量却冒出跑步」的换练串台。
  const [workoutKey, setWorkoutKey] = useState(0);
  // 首次打开后保持挂载:关掉再开不丢 tab/加载结果(家务/洞察每次卸载 = 永远 Loading)。
  const [insightsMounted, setInsightsMounted] = useState(false);
  const [familyMounted, setFamilyMounted] = useState(false);
  const [teslaMounted, setTeslaMounted] = useState(false);
  useEffect(() => { if (insightsOpen) setInsightsMounted(true); }, [insightsOpen]);
  useEffect(() => { if (familyOpen) setFamilyMounted(true); }, [familyOpen]);
  useEffect(() => { if (teslaOpen) setTeslaMounted(true); }, [teslaOpen]);
  // 浮层开着 → 推迟整页 reload(版本检查/模块水合),否则操作中被踢回今天。
  useEffect(() => {
    const held = insightsOpen || familyOpen || cookingOpen || inventoryOpen
      || chatOpen || briefOpen || Boolean(workoutSession) || Boolean(captureMode)
      || Boolean(modeCamera) || noteOpen || moodOpen || freezeOpen || calendarCreateOpen
      || teslaOpen;
    if (!held) return;
    return holdUiOverlay();
  }, [
    insightsOpen, familyOpen, cookingOpen, inventoryOpen, chatOpen, briefOpen,
    workoutSession, captureMode, modeCamera, noteOpen, moodOpen, freezeOpen, calendarCreateOpen,
    teslaOpen,
  ]);
  const [launchSurfaceContext, setLaunchSurfaceContext] = useState({
    viewerRole: 'public' as 'public' | 'tester' | 'personal_lab',
    testerAllowlist: [] as string[],
    testerCohort: null as string | null,
    moduleOverrides: {} as Record<string, 'on' | 'off'>,
  });

  // 逐模块本地开关:客户端加载 + 订阅更新(SSR 期为空,避免水合不一致,与 lab 旗一致)。
  useEffect(() => {
    const sync = () => setLaunchSurfaceContext((prev) => ({ ...prev, moduleOverrides: loadModuleOverrides() }));
    sync();
    window.addEventListener(MODULE_OVERRIDES_EVENT, sync);
    return () => window.removeEventListener(MODULE_OVERRIDES_EVENT, sync);
  }, []);

  // Lab 开关反应式:切换后重读浏览器上下文(含 lab 旗 → viewerRole),工具箱即时变,
  // 不需 reload —— 修「点 Lab 闪退出设置」。保留逐模块覆盖不被整包覆盖冲掉。
  useEffect(() => {
    const sync = () => setLaunchSurfaceContext((prev) => ({
      ...normalizeLaunchSurfaceContext(readLaunchSurfaceContextFromBrowser()),
      moduleOverrides: prev.moduleOverrides,
    }));
    window.addEventListener('nesio-lab-mode-updated', sync);
    return () => window.removeEventListener('nesio-lab-mode-updated', sync);
  }, []);

  const configWithDecMetadata = useMemo(
    () => mergePortalConfigWithDecMetadata(config, decModules),
    [config, decModules],
  );

  const configWithShellState = useMemo(() => {
    const tools = configWithDecMetadata.tools.map((rawTool) => {
      const tool = applyFeatureControlToolGate(applyFirstLaunchToolGate(rawTool));
      const shellState = decShellRoutes.get(tool.id);
      const mergedTool = shellState ? ({ ...tool, ...shellState } as ToolForShellState) : tool;
      return applyFeatureControlToolGate(applyFirstLaunchToolGate(mergedTool));
    });
    return { ...configWithDecMetadata, tools };
  }, [configWithDecMetadata, decShellRoutes]);

  const shellManifest = useMemo(
    () => buildPortalShellManifest(configWithShellState),
    [configWithShellState],
  );
  const shellRuntime = useMemo(
    () => resolveShellRuntimeTools(shellManifest.tools, launchSurfaceContext),
    [shellManifest.tools, launchSurfaceContext],
  );
  // 云同步/连接器:必须「确定已登录」(null/false 都不跑,防未鉴权上传)。
  const canUsePrivateRuntime = authSessionLoggedIn === true;
  // UI 读本机私据:**fail-closed** —— 只有确定已登录才露真实数据。
  // 旧契约 `!== false` 让未知(null)也读本机图/财务/健康 → 共享设备/会话过期未登出
  // 时等于数据泄露。未知态宁可短暂 demo/空,也不能把上一账号的生活摊开。
  const canViewPrivateData = authSessionLoggedIn === true;
  // 数据泄露收口(P0):在「本机数据归属」核对通过前,**任何**私有云同步都不许跑 —— 否则 A 没登出、
  // B 同机登录时,弹窗还没弹,A 的记忆/健康/财务已按 B 的身份上传落库(进了 B 的账号)。ownerConflict
  // 非空(other_account / anonymous_data)= 归属未定 → 一律不同步,直到用户在弹窗里选定归属。
  const canSyncPrivateData = canUsePrivateRuntime && ownerConflict === null;

  useEffect(() => {
    setLaunchSurfaceContext((prev) => ({
      ...normalizeLaunchSurfaceContext(readLaunchSurfaceContextFromBrowser()),
      moduleOverrides: prev.moduleOverrides, // 逐模块覆盖由独立 effect 维护,别被整包覆盖冲掉
    }));
    setLocale(loadProfileSettings().locale);
  }, []);

  // 服务器授予的访问角色(权限管理):登录后领取,只增不减地并入
  // 浏览器侧上下文(personal_lab > tester > public;flags=true 的模块
  // 进 testerAllowlist)。管理员在 /admin 改角色,用户下次加载生效。
  useEffect(() => {
    if (!canUsePrivateRuntime) return;
    let cancelled = false;
    void fetch('/api/portal/access', { credentials: 'same-origin' })
      .then((res) => res.json() as Promise<{ ok?: boolean; role?: string; featureFlags?: Record<string, boolean> }>)
      .then((access) => {
        if (cancelled || !access?.ok) return;
        const rank = { public: 0, tester: 1, personal_lab: 2 } as const;
        const serverRole = access.role === 'personal_lab' ? 'personal_lab' : access.role === 'tester' ? 'tester' : 'public';
        const grantedModules = Object.entries(access.featureFlags || {})
          .filter(([, on]) => on === true)
          .map(([id]) => id);
        setLaunchSurfaceContext((prev) => ({
          ...prev,
          viewerRole: rank[serverRole] > rank[prev.viewerRole] ? serverRole : prev.viewerRole,
          testerAllowlist: Array.from(new Set([...prev.testerAllowlist, ...grantedModules])),
        }));
      })
      .catch(() => { /* 领取失败按本机上下文继续 */ });
    return () => { cancelled = true; };
  }, [canUsePrivateRuntime]);

  // 批次198 P1:前台自动云同步 —— 登录后拉一次云端记忆合并进本地(last-write-wins),
  // 并在标签页回到前台(visibilitychange→visible)时再拉一次。此前 pull 只在「记忆」页
  // mount 时发生,落在「今天」页就看不到别端数据 —— 提到顶层后,打开落任何页都先拉平。
  // best-effort:未登录/离线静默,不阻塞渲染;20s 节流由 syncMemoryWithCloud 内部保证。
  useEffect(() => {
    if (!canSyncPrivateData) return; // 归属未定(换人/匿名残留)绝不同步,防跨账号泄露
    // 账号级权益真源:登录即拉一次 /api/entitlements 落缓存 —— getTier() 优先读它,
    // 清缓存/换设备/换浏览器不再白嫖 Pro,到期也据实收权(报告 #6)。best-effort。
    void refreshServerEntitlement();
    // ⚠️ 重云同步一律走 whenIdle + 暂停闸门(修真机「跟练卡死」根因):所有 gzip/JSON/hash 都在主线程,
    // 大数据下单个调用就能卡住主线程数秒。① 跟练等交互全屏开着(isCloudSyncSuspended)时整批跳过;
    // ② 永不在「挂载/回前台」那一帧同步跑,统一推到浏览器空闲时。退出跟练会经 SYNC_RESUME_EVENT 补跑一次。
    const runHeavySyncBatch = () => {
      if (isCloudSyncSuspended()) { return; } // 跟练中:先不同步,退出时(resume)再补
      // 先单路刷新会话写回 cookie,再开并行云同步 —— 避免 access 过期窗口多路 grant_type=refresh_token 互踢。
      void (async () => {
        await fetchAuthSessionPayload(true);   // ← 要副作用(刷 cookie),不能吃缓存
        if (isCloudSyncSuspended()) return;
        // 全部云同步统一走 runCloudSyncBatch:**哪条这次没跑成就记进离线队列**,
        // 下次开机或 online 事件回来时自动重跑(带退避)。
        // 之前这里是一排 void —— 断网/超时/5xx 一律无声无息,这一轮就这么丢了。
        //
        // ⚠️ 它接住的是**整条任务抛出来的**失败。那些函数内部的
        // `void pushXxxToCloud()`(即发即忘)在里面就把错吃掉了,这一层看不见 ——
        // 诚实的说法是「拉取失败会重试,推送失败暂时还不会」。见 cloud-sync-runner 文件头。
        const { runCloudSyncBatch } = await import('@/lib/portal/cloud-sync-runner');
        await runCloudSyncBatch(CLOUD_SYNC_TASKS);
      })();
    };
    const scheduleHeavySyncBatch = () => whenIdle(runHeavySyncBatch);
    // 语音 sheet 的 chunk 预取:点麦克风时才下载会有一段「点了没反应」的空白
    // (真机上常与图谱事件风暴撞在一起,更像卡死)。空闲时先拉好,点开即出。
    whenIdle(() => { void import('./VoiceInputSheet').catch(() => {}); });
    // 一次性自愈(2026-07-29):清历史邮件重复节点 + 已拆模块的孤儿 key。幂等,跑过即零开销。
    whenIdle(() => { void import('@/lib/portal/storage-heal').then((m) => m.runStorageHealOnce()).catch(() => {}); });
    scheduleHeavySyncBatch(); // 挂载/登录:也推到空闲,不阻塞首屏交互
    // 网络回来时把队列里攒着的失败同步补掉 —— **这才是离线队列的意义所在**:
    // 你在地铁里改的东西,出站那一刻自动补上,而不是等你下次想起来打开 App。
    // 开机也补一次(上次可能是关 App 关掉的,没等到 online 事件)。
    const drainQueued = () => {
      whenIdle(() => {
        void import('@/lib/portal/cloud-sync-runner')
          .then((m) => m.drainCloudSyncQueue(CLOUD_SYNC_REGISTRY))
          .catch(() => {});
      });
    };
    drainQueued();
    window.addEventListener('online', drainQueued);
    const unregisterLearningPush = registerLearningAutoPush();
    // 批次205:改名字/头像/语言/教练/日报/主题任一 → 防抖自动推上云,别端拉取即一致。
    const unregisterProfilePush = registerProfileAutoPush();
    const onVisible = () => { if (document.visibilityState === 'visible') { scheduleHeavySyncBatch(); } };
    const onSyncResume = () => { scheduleHeavySyncBatch(); }; // 退出跟练等 → 补跑一次(此时已离开交互场景)
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(SYNC_RESUME_EVENT, onSyncResume);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(SYNC_RESUME_EVENT, onSyncResume);
      window.removeEventListener('online', drainQueued);
      unregisterLearningPush();
      unregisterProfilePush();
    };
  }, [canSyncPrivateData]);

  useEffect(() => {
    const onOnboardingVisibility = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean }>).detail;
      setOnboardingActive(Boolean(detail?.active));
    };
    window.addEventListener('nesio-onboarding-visibility-change', onOnboardingVisibility);
    return () => window.removeEventListener('nesio-onboarding-visibility-change', onOnboardingVisibility);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onMemoryReceived = () => {
      track('memory_saved'); // 激活漏斗:用户真的存下了一条记忆(每次都记,不只首条)
      try {
        if (localStorage.getItem(FIRST_MEMORY_RECEIPT_KEY) === '1') return;
        track('first_memory'); // 激活里程碑:此设备第一条记忆(注册→激活转化)
        localStorage.setItem(FIRST_MEMORY_RECEIPT_KEY, '1');
        if (localStorage.getItem(HAPTIC_FEEDBACK_KEY) !== '0') {
          navigator.vibrate?.(18);
        }
      } catch {
        navigator.vibrate?.(18);
      }
      setMemoryReceipt(true);
      timer = setTimeout(() => setMemoryReceipt(false), 1800);
    };
    window.addEventListener('nesio-memory-received', onMemoryReceived);
    return () => {
      window.removeEventListener('nesio-memory-received', onMemoryReceived);
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // 必须 return Promise:外层不能在 fetch 尚未完成时就把 authReady 置 true
    // (否则会短暂「已就绪+未登录」→ 演示数据/空洞察闪一下再跳回已登录)。
    const refreshAuthSession = () => fetchAuthSessionPayload()
      .then((data) => {
        if (cancelled) return;
        // 非 200 / 解析失败 = 未知:保持上一拍登录态,绝不打成匿名。
        if (data == null) {
          setAuthDefinitelyAnonymous(false);
          return;
        }
        // access 校验失败但还在刷新中的瞬时态 —— 也当未知,别把已登录用户踢成游客。
        // 有 refresh cookie 却 refresh 失败(并发旋转/瞬时网络)同理:绝不当 signed_out。
        if (data.status === 'session_unverified' || (!data.loggedIn && data.hasRefreshToken)) {
          setAuthDefinitelyAnonymous(false);
          return;
        }
        const loggedIn = Boolean(data.loggedIn);
        const sessionReady = loggedIn && data.authReady !== false && data.profileBootstrapBlocking !== true;
        setAuthSessionLoggedIn(loggedIn);
        if (loggedIn) {
          // 允许下次「明确匿名」再走残留清库(本会话登出→再进游客时仍能收口)。
          try { sessionStorage.removeItem('nesio-signed-out-purged'); } catch { /* ignore */ }
        }
        // P0 隐私:核对本机数据归属。换账号登录时,上一个人的记忆绝不能默默留给下一个人。
        if (loggedIn && data.user?.id) {
          const verdict = reconcileLocalOwner(data.user.id, data.user.email || '');
          if (verdict.kind !== 'ok') {
            setOwnerConflict((cur) => cur ?? {
              ...(verdict.kind === 'other_account'
                ? { kind: 'other_account' as const, prevEmail: verdict.prevEmail }
                : { kind: 'anonymous_data' as const }),
              userId: data.user!.id!,
              email: data.user!.email || '',
            });
          }
        }
        setAuthDefinitelyAnonymous(!loggedIn);
        if (sessionReady) {
          try {
            markNesioOnboardingDoneForAuth();
            window.dispatchEvent(new CustomEvent(NESIO_ONBOARDING_COMPLETE_EVENT, { detail: data }));
          } catch {
            // Auth state is still valid; local onboarding persistence is best-effort.
          }
        }
      })
      .catch(() => {
        // 网络失败 = 未知:不改 loggedIn,不触发数据清理
        if (!cancelled) setAuthDefinitelyAnonymous(false);
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });

    importSupabaseHashSession()
      .catch(() => ({ imported: false, ok: false }))
      .then(() => refreshAuthSession())
      .catch(() => {
        // hash 导入失败不代表已登出;等 refreshAuthSession 自己定性
        if (!cancelled) setAuthDefinitelyAnonymous(false);
      });

    window.addEventListener('nesio-auth-session-ready', refreshAuthSession);
    window.addEventListener('nesio-auth-session-imported', refreshAuthSession);
    return () => {
      cancelled = true;
      window.removeEventListener('nesio-auth-session-ready', refreshAuthSession);
      window.removeEventListener('nesio-auth-session-imported', refreshAuthSession);
    };
  }, []);

  // Platform Runtime: the shell drives Integration collection + Pruning.
  // The Experience layer (Today) only consumes results, never calls connectors.
  useEffect(() => {
    if (!authReady) return;
    pruneDisposableSignals();
    // M3 读切换:回填 + 删除传导 + 水合事实缓存(见 signal-read-cache.ts)
    void hydrateSignalFactStore();
    // IDB 那一整套(开库/健康检查/配额/定期清理/P1 缓存迁移/删源)。
    // 它自己排到 requestIdleCallback,不挡首屏;失败只降级到 localStorage,不抛。
    // 在这之前 lib/idb 的 16 个模块里有 14 个零调用方 —— 建好了从没接上。
    void import('@/lib/idb/boot').then((m) => m.bootStorage()).catch(() => {});
    if (!canUsePrivateRuntime) {
      // 服务器明确 signed_out:本机若还留着用户数据 = 共享设备泄露面。
      // 旧逻辑只 prune 邮件/日历外部节点,手记/健康/财务/持仓仍躺在 localStorage
      // 且 Memory 旧门会继续渲染 —— 现改为与登出同款纯本地清库(不传导云删除)。
      // 未知态(网络抖动)绝不走这里(authDefinitelyAnonymous 仍为 false)。
      if (authDefinitelyAnonymous) {
        void (async () => {
          try {
            const { hasMeaningfulLocalData, purgeLocalUserDataForLogout, getLocalOwner } = await import('@/lib/portal/local-owner');
            // 有主人记录或仍有残留私据才清;空游客反复 purge/reload 没意义。
            const hadResidual = Boolean(getLocalOwner()) || hasMeaningfulLocalData();
            if (!hadResidual) return;
            await purgeLocalUserDataForLogout();
            track('private_purge_signed_out', { reason: 'anonymous_residual' });
            // 清完让各 store 重读空态;否则内存里还挂着上一拍的图。
            if (typeof window.location?.reload === 'function') {
              const FLAG = 'nesio-signed-out-purged';
              try {
                if (sessionStorage.getItem(FLAG) === '1') return;
                sessionStorage.setItem(FLAG, '1');
                if (sessionStorage.getItem(FLAG) === '1') window.location.reload();
              } catch { /* 隐私模式写不进就不 reload,UI 门已挡住展示 */ }
            }
          } catch { /* best-effort;UI 门仍 fail-closed */ }
        })();
      }
      try {
        sessionStorage.removeItem(PORTAL_CACHE_KEYS.calendar);
      } catch { /* ignore unavailable storage */ }
      return;
    }
    runConnectors().catch(() => undefined);
  }, [authReady, canUsePrivateRuntime, authDefinitelyAnonymous]);

  // 天气按小时更新(2026-08-01 用户点名):runConnectors 只在挂载时拉一次,天气缓存
  // TTL 5 分钟(prefetch-cache.ts)但从没人隔一小时再喊它——一天里天气就再也不会变了。
  // 定时 + 回前台各触发一次 refreshWeather();缓存过期(>5min)才会真的重新请求接口,
  // 短时间内来回切前后台不会重复打 API。
  useEffect(() => {
    if (!authReady || !canUsePrivateRuntime) return;
    const tick = () => { void refreshWeather(); };
    const timer = setInterval(tick, 60 * 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [authReady, canUsePrivateRuntime]);

  useEffect(() => {
    const syncLocale = () => setLocale(loadProfileSettings().locale);
    window.addEventListener(PROFILE_UPDATED_EVENT, syncLocale);
    window.addEventListener('storage', syncLocale);
    return () => {
      window.removeEventListener(PROFILE_UPDATED_EVENT, syncLocale);
      window.removeEventListener('storage', syncLocale);
    };
  }, []);

  // Telemetry: app open + global error hooks (event counts only, no content)
  useEffect(() => {
    installErrorTracking();
    track('app_open');
    // QA(白屏/卡死):新部署后旧标签页请求已被替换的 chunk → 404 → 懒加载组件挂掉,
    // 表现为白屏/半死。捕获 ChunkLoadError 自动整页刷新一次(30s 冷却防循环)。
    const onChunkError = (e: ErrorEvent | PromiseRejectionEvent) => {
      const msg = String((e as PromiseRejectionEvent).reason?.message ?? (e as ErrorEvent).message ?? '');
      if (!/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg)) return;
      try {
        const last = Number(sessionStorage.getItem('nesio-chunk-reload-at') || '0');
        if (Date.now() - last < 30_000) return; // 冷却:别陷入刷新循环
        sessionStorage.setItem('nesio-chunk-reload-at', String(Date.now()));
      } catch { /* ignore */ }
      requestDestructiveReload();
    };
    window.addEventListener('error', onChunkError);
    window.addEventListener('unhandledrejection', onChunkError);
    // Offline shell: data is local, so a cached shell = readable memories offline
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
    return () => {
      window.removeEventListener('error', onChunkError);
      window.removeEventListener('unhandledrejection', onChunkError);
    };
  }, []);

  // Storage quota alerts — a dropped write must never be silent
  useEffect(() => {
    void import('@/lib/portal/storage-relief').then((m) => m.migrateBookkeepingOffLs()).catch(() => {});
    // 批次 51:用户可以「先不管」打盹 24h(报警不能去不掉);存储满时 localStorage
    // 自身可能写不进,落 sessionStorage 兜底(至少本次会话不再骚扰)。
    const snoozedUntil = (): number => {
      try {
        return Number(localStorage.getItem('nesio-storage-alert-snooze-v1') || sessionStorage.getItem('nesio-storage-alert-snooze-v1') || 0);
      } catch { return 0; }
    };
    const onFull = (e: Event) => {
      if (Date.now() < snoozedUntil()) return;
      const detail = (e as CustomEvent<{ percent?: number; largestKeys?: Array<{ key: string; bytes: number }> }>).detail;
      setStorageAlert({ kind: 'full', percent: detail?.percent ?? 100, largest: detail?.largestKeys });
    };
    const onWarning = (e: Event) => {
      if (Date.now() < snoozedUntil()) return;
      const detail = (e as CustomEvent<{ percent?: number; largestKeys?: Array<{ key: string; bytes: number }> }>).detail;
      setStorageAlert((prev) => prev?.kind === 'full' ? prev : { kind: 'warning', percent: detail?.percent ?? 80, largest: detail?.largestKeys });
    };
    window.addEventListener(STORAGE_FULL_EVENT, onFull);
    window.addEventListener(STORAGE_WARNING_EVENT, onWarning);
    return () => {
      window.removeEventListener(STORAGE_FULL_EVENT, onFull);
      window.removeEventListener(STORAGE_WARNING_EVENT, onWarning);
    };
  }, []);

  // 批次 31:低饱和配色预览(Lab)—— 启动即按本机开关应用
  useEffect(() => { applyLowSatTheme(); }, []);

  // 批次 57:「记忆自动定位」开着时,开屏预热一次手机定位 —— 顺手喂足迹
  // (capture-location 内部:开关关/未授权都安全跳过,不弹框)
  useEffect(() => {
    void import('@/lib/portal/capture-location').then((m) => m.prefetchCaptureLocation()).catch(() => {});
  }, []);

  // Allow TodayFeed empty state / other surfaces to open Tell Nesio or capture directly
  useEffect(() => {
    const voiceHandler = () => { track('capture_voice_open'); setCaptureMode('voice'); };
    /**
     * 「问念念」—— 一律进**真对话页**(2026-07-31 用户:「点击问问符号,进入真的问问界面」)。
     *
     * 这个事件以前开的是语音 sheet 的 ask 形态:一次性问答,回一段摘要 + 一列「来源线索」,
     * 追问一句就得从头再问。用户管它叫「搜索对话」,准确。
     *
     * 这一版把**所有**问念念入口收到一处:底部中间那颗大按钮、引导页的「开始」、
     * 首页输入条的晶体,全都开 NesioChatSheet。上一轮只切了输入条那一条,
     * 结果同一个念念在两个地方长两个样 —— 那本身就是要修的东西。
     * detail.text = 已经打好的那句话;send = 它本身就是问题,开页即发。
     */
    const askHandler = (e: Event) => {
      const d = (e as CustomEvent).detail as { text?: string; send?: boolean } | undefined;
      track('capture_voice_open');
      const text = typeof d?.text === 'string' ? d.text.trim() : '';
      if (text) {
        try {
          sessionStorage.setItem('nesio-pending-ask-text', JSON.stringify({ text, send: d?.send !== false }));
        } catch { /* ignore */ }
      }
      setInsightsOpen(false);
      setChatOpen(true);
    };
    const moodHandler = () => { track('mood_open'); setMoodOpen(true); };
    const freezeHandler = () => {
      // 冷冻仓:未上线 → 免费/Pro 都不上(走「会随 Pro 开放」引导);上线后 Pro 专属。唯一开门点。
      if (!canOpenFreeze()) { track('pro_gate_shown', { feature: 'freeze' }); setProGate('freeze'); return; }
      track('freeze_open'); setFreezeOpen(true);
    };
    // bug2(护理页死按钮):从洞察浮层(z=901)里点「去物品」,物品页开在浮层之下看不见 ——
    // 与记忆搜索同根因,先关洞察再开。
    const inventoryHandler = () => { track('inventory_open'); setInsightsOpen(false); setInventoryOpen(true); };
    const calendarCreateHandler = () => { track('calendar_create_open'); setCalendarCreateOpen(true); };
    const familyHandler = () => { track('family_sharing_open'); setFamilyOpen(true); };
    const teslaHandler = () => { track('tesla_open'); setTeslaOpen(true); };
    const cookingHandler = () => { track('cooking_open'); setCookingRecipeName(undefined); setCookingOpen(true); };
    const cookingRecipeHandler = (e: Event) => {
      const name = String((e as CustomEvent).detail?.name || '').trim();
      if (!name) return;
      track('cooking_open_recipe');
      setInsightsOpen(false);
      setCookingRecipeName(name);
      setCookingOpen(true);
    };
    // 做饭页「拍一拍进货」:做饭页先原生拍照拿到 File(detail.file)→ 关做饭 → 用文件走已验证的相机识别路径
    // (进货模式,拍到的打食材)。相机 z=400 在全屏 sheet 之下,故先关做饭;相机关后自动重开做饭。
    const cookingCameraHandler = (e: Event) => {
      const file = (e as CustomEvent).detail?.file as File | undefined;
      track('cooking_camera_open');
      // ⚠️ 必须先关洞察:相机是 z-index 400,洞察浮层是 901。
      // 做饭页是从洞察 hub 进来的,所以点「拍一拍进货」时洞察还开着 ——
      // 相机确实打开了,但整个盖在洞察底下,用户看到的是「做饭页没了,什么也没出现」,
      // 也就是「点完闪退」。下面那个 openCameraHandler 早就修过同一个坑(护理页死按钮),
      // 这条漏了。加相机入口时**都要问一句**:这条路上洞察关了没有。
      setInsightsOpen(false);
      setCookingOpen(false); setPantryIntake(true); setCameraFile(file ?? null); setCaptureMode('camera');
    };
    // 「一个相机、多种模式」:记一餐/衣帽间派事件调起主相机。同进货:先关洞察/做饭
    // (相机 z=400 在全屏 sheet 901 之下),拍完由 onModeCaptured 重开来源 sheet。
    const modeCameraHandler = (e: Event) => {
      const m = (e as CustomEvent).detail?.mode as ModeCameraMode | undefined;
      if (m !== 'meal' && m !== 'wardrobe') return;
      track('mode_camera_open');
      setInsightsOpen(false);
      setCookingOpen(false);
      setPantryIntake(false);
      setModeCamera(m);
      setCameraFile(null);
      setCaptureMode('camera');
    };
    // 行程购物/预算「拍小票」—— 打开通用相机识别(不强制食材进货模式)
    const openCameraHandler = (e: Event) => {
      const file = (e as CustomEvent).detail?.file as File | undefined;
      track('travel_camera_open');
      // bug2(护理页死按钮):相机 z=400 在洞察浮层(901)之下,先关洞察。
      setInsightsOpen(false);
      setPantryIntake(false); setCameraFile(file ?? null); setCaptureMode('camera');
    };
    // 2026-08-01 用户点名:积分从今天页顶栏 chip 打开的浮层商城,升级成洞察下的独立页 ——
    // 不再单独维护一个 RewardsStoreSheet 浮层,统一走 Insights 的 tab 打开路径。
    const rewardsHandler = () => {
      track('rewards_open');
      setInsightsTab('rewards');
      setInsightsNonce((n) => n + 1);
      setInsightsOpen(true);
    };
    const briefHandler = () => { track('brief_open', {}); setBriefOpen(true); };
    const dictHandler = (e: Event) => {
      const q = (e as CustomEvent).detail?.query;
      setDictQuery(typeof q === 'string' ? q : '');
      setDictOpen(true);
    };
    // 洞察浮层:底部导航 / 卡片 / 「开始练」都派事件打开;detail.tab 指定进哪个 tab(如 fitness)
    // 2026-07-28(标注 图21):原来只认 tab==='fitness',别的一律落回默认页 ——
    // 于是车页那几个「去财务 / 去足迹看」的入口即使派了事件也跳不过去。改成认一份白名单。
    // 2026-07-29 合并 QA 分支:白名单补齐**全部**板块 —— 原来漏了 reflection/montage/tesla/admin,
    // 那几个板块的深链(车页「→ 财务/足迹」等指路行)派了事件也落回默认页,看着像死链。
    const INSIGHTS_TABS: ReadonlySet<string> = new Set([
      'reflection', 'growth', 'montage', 'health', 'fitness', 'timeline', 'schedule',
      'finance', 'inventory', 'wardrobe', 'relationships', 'tesla', 'living', 'music', 'rewards', 'admin',
      'dictionary',
    ]);
    const insightsHandler = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab;
      track('insights_open', {});
      setInsightsTab(typeof tab === 'string' && INSIGHTS_TABS.has(tab) ? (tab as InsightsMainTab) : undefined);
      setInsightsNonce((n) => n + 1);
      setInsightsOpen(true);
    };
    const trainingHandler = () => { setInsightsTab('fitness'); setInsightsNonce((n) => n + 1); setInsightsOpen(true); };
    // Bug4 图25-30:全屏子页(美味等)右上角的「今天」—— 一步回今天,不是逐层往回退。
    // 关掉洞察浮层再切面,否则浮层还盖着,点了像没反应。
    const goTodayHandler = () => {
      setInsightsOpen(false);
      setCookingOpen(false);
      setInventoryOpen(false);
      setActiveSurface('today');
    };
    const workoutHandler = (e: Event) => { track('workout_start', {}); setWorkoutKey((k) => k + 1); setWorkoutSession((e as CustomEvent).detail); };
    const proGateHandler = (e: Event) => {
      const feature = (e as CustomEvent).detail?.feature || 'pro';
      track('pro_gate_shown', { feature });
      setProGate(feature);
    };
    // 洞察页的主题门/线头/走走看点击后跳记忆页搜索:MemoryTab 只在 memory 面挂载,
    // 事件比挂载先到会丢 —— 这里先切面,再把事件补发一次给刚挂上的 MemoryTab。
    const memorySearchHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.resent) return; // 补发的那次别再切面/再补发
      setInsightsOpen(false); // 从洞察里跳记忆搜索:浮层不关会盖住记忆页(「表面死按钮」根因之一)
      setActiveSurface((s) => {
        if (s === 'memory') return s;
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('nesio-memory-search', { detail: { ...detail, resent: true } }));
        }, 150);
        return 'memory';
      });
    };
    window.addEventListener('nesio-memory-search', memorySearchHandler);
    window.addEventListener('nesio-pro-gate', proGateHandler);
    window.addEventListener('nesio-open-voice', voiceHandler);
    window.addEventListener('nesio-open-ask', askHandler);
    window.addEventListener('nesio-open-mood', moodHandler);
    window.addEventListener('nesio-open-freeze', freezeHandler);
    window.addEventListener('nesio-open-inventory', inventoryHandler);
    window.addEventListener('nesio-open-calendar-create', calendarCreateHandler);
    window.addEventListener('nesio-open-family', familyHandler);
    window.addEventListener('nesio-open-tesla', teslaHandler);
    window.addEventListener('nesio-open-cooking', cookingHandler);
    window.addEventListener('nesio-open-cooking-recipe', cookingRecipeHandler);
    window.addEventListener('nesio-open-cooking-camera', cookingCameraHandler);
    window.addEventListener(OPEN_MODE_CAMERA_EVENT, modeCameraHandler);
    window.addEventListener('nesio-open-camera', openCameraHandler);
    window.addEventListener('nesio-open-rewards', rewardsHandler);
    window.addEventListener('nesio-open-brief', briefHandler);
    window.addEventListener('nesio-open-dictionary', dictHandler);
    window.addEventListener('nesio-open-insights', insightsHandler);
    window.addEventListener('nesio-open-training', trainingHandler);
    window.addEventListener('nesio-go-today', goTodayHandler);
    window.addEventListener('nesio-start-workout', workoutHandler);
    return () => {
      window.removeEventListener('nesio-memory-search', memorySearchHandler);
      window.removeEventListener('nesio-pro-gate', proGateHandler);
      window.removeEventListener('nesio-open-voice', voiceHandler);
      window.removeEventListener('nesio-open-ask', askHandler);
      window.removeEventListener('nesio-open-mood', moodHandler);
      window.removeEventListener('nesio-open-freeze', freezeHandler);
      window.removeEventListener('nesio-open-inventory', inventoryHandler);
      window.removeEventListener('nesio-open-calendar-create', calendarCreateHandler);
      window.removeEventListener('nesio-open-family', familyHandler);
      window.removeEventListener('nesio-open-tesla', teslaHandler);
      window.removeEventListener('nesio-open-cooking', cookingHandler);
      window.removeEventListener('nesio-open-cooking-recipe', cookingRecipeHandler);
      window.removeEventListener('nesio-open-cooking-camera', cookingCameraHandler);
      window.removeEventListener(OPEN_MODE_CAMERA_EVENT, modeCameraHandler);
      window.removeEventListener('nesio-open-camera', openCameraHandler);
      window.removeEventListener('nesio-open-rewards', rewardsHandler);
      window.removeEventListener('nesio-open-brief', briefHandler);
      window.removeEventListener('nesio-open-dictionary', dictHandler);
      window.removeEventListener('nesio-open-insights', insightsHandler);
      window.removeEventListener('nesio-open-training', trainingHandler);
      window.removeEventListener('nesio-go-today', goTodayHandler);
      window.removeEventListener('nesio-start-workout', workoutHandler);
    };
  }, []);

  // Handle OAuth callbacks from connectors (Calendar, Gmail)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // Gmail callback: ?connector=gmail&status=connected
    const connector = params.get('connector');
    const status = params.get('status');

    // Calendar callback: ?calendar=google_oauth_connected&status=calendar_session_established
    const calendarParam = params.get('calendar');
    const calendarStatus = params.get('status') || '';

    const oauthError = params.get('error');

    // Detect calendar connection
    const calendarConnected = calendarParam === 'google_oauth_connected' ||
      calendarStatus === 'calendar_session_established';

    if (!connector && !calendarParam) return;
    if (!authReady) return;

    // Clean URL immediately
    params.delete('connector'); params.delete('status'); params.delete('error');
    params.delete('calendar'); params.delete('safePublicStatus'); params.delete('secretsRedacted');
    const qs = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);

    function saveConnector(id: string) {
      try {
        const saved = JSON.parse(localStorage.getItem('nesio-connectors-v1') || '{}');
        saved[id] = true;
        localStorage.setItem('nesio-connectors-v1', JSON.stringify(saved));
      } catch { /* ignore */ }
    }

    function triggerCalendarRefresh() {
      if (!canUsePrivateRuntime) return;
      setTimeout(() => {
        fetch('/api/portal/calendar', { cache: 'no-store' })
          .then((r) => r.json())
          .then((data: { events?: Array<{
            id?: string; title?: string; start?: string; end?: string;
            description?: string; location?: string; url?: string; calendarName?: string;
          }>; feeds?: unknown }) => {
            if (data?.events || data?.feeds) {
              import('@/lib/portal/prefetch-cache').then(({ writePortalCache, PORTAL_CACHE_KEYS }) => {
                writePortalCache(PORTAL_CACHE_KEYS.calendar, data);
              });
              if (Array.isArray(data.events) && data.events.length > 0) {
                saveCalendarToLocal(data.events);
              }
              // Save upcoming events (next 7 days) as LifeGraph event nodes so they appear in memory/focus
              if (Array.isArray(data.events) && data.events.length > 0) {
                import('@/lib/portal/life-graph').then(({ getLifeGraph }) => {
                  const now = Date.now();
                  const week = now + 60 * 86_400_000;
                  const existing = getLifeGraph();
                  const existingCalIds = new Set(
                    existing.filter((n) => n.source === 'calendar').map((n) => n.attributes.calendarId as string).filter(Boolean)
                  );
                  data.events!.forEach((ev) => {
                    if (!ev.start || !ev.title) return;
                    const t = new Date(ev.start).getTime();
                    if (t < now - 86_400_000 || t > week) return;
                    const calId = ev.id || `${ev.title}-${ev.start}`;
                    if (existingCalIds.has(calId)) return; // already saved
                    ingestLifeNode({
                      name: ev.title,
                      type: 'event',
                      source: 'calendar',
                      confidence: 1,
                      rawInput: ev.title,
                      tags: [ev.calendarName || '日历'].filter(Boolean),
                      attributes: {
                        start: ev.start,
                        ...(ev.end ? { end: ev.end } : {}),
                        ...(ev.url ? { url: ev.url } : {}),
                        ...(ev.location ? { location: ev.location } : {}),
                        ...(ev.description ? { note: ev.description.slice(0, 300) } : {}),
                        calendarId: calId,
                        calendarName: ev.calendarName || '',
                      },
                      relations: [],
                    });
                  });
                  window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
                });
              }
              window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
            }
          })
          .catch(() => undefined);
      }, 500);
    }

    // Handle Calendar OAuth callback (?calendar=google_oauth_connected)
    if (calendarConnected) {
      // Save connector state unconditionally — doesn't require Supabase auth
      saveConnector('calendar');
      // BUG FIX(批次 5):Gmail 授权回调同时带 calendar 参数,这里曾提前 return,
      // 发起授权的 connector(gmail)标记永远没写 → UI 一直显示「接入」。
      // Google 一次授权覆盖日历+邮件,两个标记一起写,合并入口 google 也写。
      if (status === 'connected' && connector) saveConnector(connector);
      saveConnector('google');
      window.dispatchEvent(new CustomEvent('nesio-connector-connected', { detail: { connector: connector || 'calendar' } }));
      if (canUsePrivateRuntime) triggerCalendarRefresh();
      return;
    }

    if (status === 'connected' && connector) {
      // Save connector state unconditionally — localStorage doesn't need auth
      saveConnector(connector);
      window.dispatchEvent(new CustomEvent('nesio-connector-connected', { detail: { connector } }));

      // API-level sync requires auth
      if (!canUsePrivateRuntime) return;

      // Auto-sync Gmail after OAuth (with full body analysis)
      if (connector === 'gmail') {
        // Clear throttle so OAuth reconnect always triggers a fresh sync
        localStorage.removeItem('nesio-gmail-last-sync');
        setTimeout(() => {
          fetch('/api/portal/gmail?includeBody=true&analyze=true')
            .then((r) => r.json())
            .then((data: { ok?: boolean; nodes?: Array<Record<string, unknown>>; count?: number }) => {
              if (data.ok && data.nodes?.length) {
                void import('@/lib/portal/life-graph').then(async ({ whenGraphHydrated }) => {
                  await whenGraphHydrated();
                  ingestLifeNodesBatch(data.nodes!.map((n) => ({ source: 'email', ...n } as Parameters<typeof ingestLifeNodesBatch>[0][number])));
                  window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
                });
              }
            })
            .catch(() => undefined);
        }, 1000);
      }

      if (connector === 'calendar') {
        triggerCalendarRefresh();
      }
    } else if (oauthError) {
      console.warn(`[nesio] connector ${connector} oauth error:`, oauthError);
    }
  }, [authReady, canUsePrivateRuntime]);

  useEffect(() => {
    fetch(configUrl())
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PortalConfig | null) => {
        if (data?.tools?.length) setConfig(data);
      })
      .catch(() => undefined);

    const cachedDecModules = readPortalCache<DecModulesPayload>(PORTAL_CACHE_KEYS.decModules);
    if (cachedDecModules?.ok) {
      setDecModules(parseDecMetaFromModules(cachedDecModules));
      setDecShellRoutes(parseDecShellRoutesFromModules(cachedDecModules));
    }

    let mounted = true;
    void fetchDecModules({ force: false, ttl: DEC_METADATA_TTL_MS })
      .then((payload) => {
        if (!mounted || payload.ok === false) return;
        const map = parseDecMetaFromModules(payload);
        const shellRouteMap = parseDecShellRoutesFromModules(payload);
        setDecModules(map);
        setDecShellRoutes(shellRouteMap);
        if (map.size) writePortalCache(PORTAL_CACHE_KEYS.decModules, payload);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        console.error('DEC modules prefetch failed:', readDecDataError(error));
      });

    if (canUsePrivateRuntime) {
      // Calendar: fetch → cache + save upcoming 7-day events to LifeGraph
      fetch('/api/portal/calendar', { cache: 'no-store' })
        .then((r) => r.json())
        .then((data: { ok?: boolean; events?: Array<{
          id?: string; title?: string; start?: string; end?: string;
          description?: string; location?: string; url?: string; calendarName?: string;
        }>; feeds?: unknown }) => {
          if (!data?.events && !data?.feeds) return;
          writePortalCache(PORTAL_CACHE_KEYS.calendar, data);
          if (Array.isArray(data.events) && data.events.length > 0) {
            saveCalendarToLocal(data.events);
          }
          if (!Array.isArray(data.events) || data.events.length === 0) return;
          import('@/lib/portal/life-graph').then(({ getLifeGraph }) => {
            const now = Date.now();
            const week = now + 60 * 86_400_000;
            const existing = getLifeGraph();
            const existingCalIds = new Set(
              existing.filter((n) => n.source === 'calendar')
                .map((n) => n.attributes.calendarId as string).filter(Boolean),
            );
            let added = 0;
            data.events!.forEach((ev) => {
              if (!ev.start || !ev.title) return;
              const t = new Date(ev.start).getTime();
              if (t < now - 86_400_000 || t > week) return;
              const calId = ev.id || `${ev.title}-${ev.start}`;
              if (existingCalIds.has(calId)) return;
              ingestLifeNode({
                name: ev.title,
                type: 'event',
                source: 'calendar',
                confidence: 1,
                rawInput: ev.title,
                tags: [ev.calendarName || '日历'].filter(Boolean),
                attributes: {
                  start: ev.start,
                  ...(ev.end ? { end: ev.end } : {}),
                  ...(ev.url ? { url: ev.url } : {}),
                  ...(ev.location ? { location: ev.location } : {}),
                  ...(ev.description ? { note: ev.description.slice(0, 300) } : {}),
                  calendarId: calId,
                  calendarName: ev.calendarName || '',
                },
                relations: [],
              });
              added++;
            });
            if (added > 0) window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
          });
        })
        .catch(() => undefined);

      // Gmail: auto-sync on app load if connected and not synced recently (6h throttle)
      // 批次 37:合并后的连接器存成 connectors.google(不是 gmail),之前只认 gmail →
      // 自动同步对走「Google 日历·Gmail」的用户从不触发,只能手动点同步。认两者。
      try {
        const connectors = JSON.parse(localStorage.getItem('nesio-connectors-v1') || '{}') as Record<string, boolean>;
        const lastSync = parseInt(localStorage.getItem('nesio-gmail-last-sync') || '0', 10);
        const SIX_HOURS = 6 * 60 * 60 * 1000;
        if ((connectors.google || connectors.gmail) && Date.now() - lastSync > SIX_HOURS) {
          fetch('/api/portal/gmail?includeBody=true&analyze=true')
            .then((r) => r.json())
            .then((data: { ok?: boolean; nodes?: Array<Record<string, unknown>> }) => {
              if (data.ok && data.nodes?.length) {
                localStorage.setItem('nesio-gmail-last-sync', String(Date.now()));
                void import('@/lib/portal/life-graph').then(async ({ whenGraphHydrated }) => {
                  await whenGraphHydrated();
                  ingestLifeNodesBatch(data.nodes!.map((n) => ({ source: 'email', ...n } as Parameters<typeof ingestLifeNodesBatch>[0][number])));
                  window.dispatchEvent(new CustomEvent('nesio-connectors-refreshed'));
                });
              }
            })
            .catch(() => undefined);
        }
      } catch { /* localStorage unavailable */ }
    }

    fetch('/api/portal/flomo?limit=200', { cache: 'no-store' }).catch(() => undefined);

    return () => { mounted = false; };
  }, [canUsePrivateRuntime]);

  // Spotify 授权回调跳回的是 `/?music=1&spotify=…` —— 不接这一下,用户从 Spotify
  // 回来只会看到首页,以为什么都没发生。`spotify` 参数**故意留着**不清,
  // 由音乐面板读出来显示成一句话(成功/被拒/要重连各不相同)。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('music') === '1') {
      setInsightsTab('music');
      setInsightsNonce((n) => n + 1);
      setInsightsOpen(true);
      params.delete('music');
      const qs = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const noteParam = params.get('note');
    if (noteParam === '1' || noteParam === 'open') {
      setNoteOpen(true);
      params.delete('note');
      const qs = params.toString();
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`,
      );
    }
  }, []);

  const openTool = useCallback(
    (tool: PortalTool) => {
      const runtimeTool = resolveShellRuntimeTools([tool], launchSurfaceContext).tools[0];
      if (!shouldShellOpenTool(runtimeTool?.shellRuntime)) return;
      if (isToolKilledByLocalFeatureControl(tool)) return;
      // 收纳已原生重建(InventorySheet · life-graph object 节点视图),不再跳静态 /storage/
      if (tool.id === 'inventory') {
        setInventoryOpen(true);
        return;
      }
      const href = openToolHref(tool, launchSurfaceContext);
      if (!href) return;
      window.location.assign(href);
    },
    [launchSurfaceContext],
  );

  /**
   * 打开问念念。**只有这一个实现** —— 底部中间键、引导页的「开始」、
   * 首页输入条的晶体,走的都是它(2026-07-31 用户:「点击问问符号,进入真的问问界面」)。
   *
   * 以前它开的是语音 sheet 的 ask 形态。那一屏是一次性问答:回一段摘要 + 一列
   * 「来源线索」,追问不了 —— 而念念的对话页(多轮、有历史、能翻回去)一直都在,
   * 只是这个入口没通到那儿。同一个念念在两个地方长两个样,是这次要收掉的东西。
   */
  const openAskChat = useCallback(() => {
    try {
      localStorage.setItem(ASK_GUIDE_KEY, '1');
    } catch { /* ignore unavailable storage */ }
    setAskGuideOpen(false);
    setInsightsOpen(false);   // 浮层不关会盖住对话页 —— 仓里「表面死按钮」的老根因
    setChatOpen(true);
  }, []);

  const handleAskFromCenterButton = useCallback(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(ASK_GUIDE_KEY) === '1';
    } catch { /* ignore unavailable storage */ }
    if (!seen) {
      setAskGuideOpen(true);
      return;
    }
    openAskChat();
  }, [openAskChat]);

  return (
    <>
      <div className="portal-root portal-root--home">
        <div className="portal-grain" aria-hidden />
        {notInvited && (
          <div
            role="alert"
            style={{
              position: 'fixed', top: 8, left: 12, right: 12, zIndex: 300,
              padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)',
              background: 'var(--status-gentle-soft)', color: 'var(--portal-ink)',
              fontSize: 'var(--text-sm)', lineHeight: 1.6,
              display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
            }}
          >
            <span style={{ flex: 1 }}>
              {L(dict,
                '这个邮箱还不在名单上。Nesio 现在是邀请制 —— 跟主人说一声就能加进来。不登录也能先本地用。',
                'This email is not on the list yet. Nesio is invite-only right now — ask the owner to add you. You can still use it locally.')}
            </span>
            <button
              type="button"
              onClick={() => setNotInvited(false)}
              style={{ flex: 'none', minHeight: 'var(--tap-min, 44px)', padding: '0 var(--space-3)', border: 'none', background: 'transparent', color: 'var(--portal-muted)', cursor: 'pointer', fontSize: 'var(--text-sm)' }}
            >
              {L(dict, '知道了', 'OK')}
            </button>
          </div>
        )}
        {storageAlert && (
          <div
            role="alert"
            style={{
              position: 'fixed', top: 8, left: 12, right: 12, zIndex: 300,
              background: 'var(--status-risk-soft)', border: '1px solid var(--status-risk)',
              borderRadius: 'var(--radius-sm)', padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-sm)',
              color: 'var(--status-risk, #d33)', display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>
                {reliefMsg ? reliefMsg : storageAlert.kind === 'full'
                  ? L(dict, `本机空间紧张，新的记忆可能存不进来。先在设置里导出一份备份保底；登录后记忆会自动备份到云端。「一键腾空间」会清临时图与附件缓存。`, 'Local storage is tight — new memories may not save. Export a backup in Settings first; signing in backs memories up to the cloud. "Free up space" clears cached images and file attachments.')
                  : L(dict, `本机空间已用 ${storageAlert.percent}%。方便的时候导出一份备份；「一键腾空间」会清临时图与附件缓存。`, `Local storage is ${storageAlert.percent}% used. Export a backup when convenient; "Free up space" clears cached images and file attachments.`)}
              </span>
              {/* 批次 116:占用最多的几项(诊断「哪里占空间」),按皮肤中性色显示 */}
              {!reliefMsg && storageAlert.largest && storageAlert.largest.length > 0 && (
                <span style={{ fontSize: 'var(--text-xs)', opacity: 0.88 }}>
                  {L(dict, '占用最多：', 'Biggest: ')}
                  {storageAlert.largest.slice(0, 3).map((k) =>
                    `${storageKeyLabel(k.key, dict)} ${k.bytes >= 1048576 ? `${(k.bytes / 1048576).toFixed(1)}M` : `${Math.round(k.bytes / 1024)}K`}`
                  ).join(' · ')}
                </span>
              )}
            </span>
            <button
              type="button"
              disabled={reliefBusy}
              onClick={async () => {
                setReliefBusy(true);
                try {
                  const { runStorageRelief } = await import('@/lib/portal/storage-relief');
                  const r = await runStorageRelief();
                  const cacheHint = (r.purgedImages || r.purgedFiles)
                    ? L(dict, ` · 清了 ${r.purgedImages + r.purgedFiles} 个临时图/附件`, ` · cleared ${r.purgedImages + r.purgedFiles} cached images/files`)
                    : '';
                  setReliefMsg(L(dict,
                    `已腾出 ${Math.round(r.freedBytes / 1024)} KB(${r.percentBefore}% → ${r.percentAfter}%${r.dedupedContacts ? `,清理重复联系人 ${r.dedupedContacts} 个` : ''})${cacheHint}`,
                    `Freed ${Math.round(r.freedBytes / 1024)} KB (${r.percentBefore}% → ${r.percentAfter}%${r.dedupedContacts ? `, removed ${r.dedupedContacts} duplicate contacts` : ''})${cacheHint}`));
                  setTimeout(() => { setStorageAlert(null); setReliefMsg(''); }, 3500);
                } finally { setReliefBusy(false); }
              }}
              style={{ flex: 'none', background: 'var(--status-risk)', color: '#fff', border: 'none', borderRadius: 999, padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--text-xs)', fontWeight: 600, cursor: 'pointer', opacity: reliefBusy ? 0.6 : 1 }}
            >{reliefBusy ? L(dict, '清理中…', 'Cleaning…') : L(dict, '一键腾空间', 'Free up space')}</button>
            <button
              type="button"
              onClick={() => {
                // 批次 51:「去不掉」根因 —— 存储满时每次写入失败都重发事件,横幅秒回。
                // 关闭 = 打盹 24h;localStorage 此刻可能写不进,sessionStorage 兜底。
                const until = String(Date.now() + 24 * 3600_000);
                try { localStorage.setItem('nesio-storage-alert-snooze-v1', until); } catch { /* 满了 */ }
                try { sessionStorage.setItem('nesio-storage-alert-snooze-v1', until); } catch { /* ignore */ }
                setStorageAlert(null);
              }}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 'var(--text-body)', padding: 0 }}
              aria-label={L(dict, '关闭存储警告', 'Dismiss storage warning')}
            >✕</button>
          </div>
        )}
        <div className="nesio-shell">
          {!onboardingActive && activeSurface === 'today' && (
            <TodayFeed canUsePrivateData={canViewPrivateData} onOpenMemory={() => setActiveSurface('memory')} />
          )}
          {!onboardingActive && activeSurface === 'memory' && <MemoryTab canUsePrivateData={canViewPrivateData} />}
        </div>

        {!onboardingActive && (
          <PortalBottomNav
            activeSurface={activeSurface}
            locale={locale}
            /*
             * Bug4 图12:洞察宫格页把这条导航抬到了浮层之上(z=931),于是它**看得见也点得着** ——
             * 但它打开的东西全在浮层**底下**:相机 / 说一句 = .nesio-camera-sheet、
             * .nesio-voice-sheet(z=400),聊天 = .nesio-wechat-fullscreen(z=310),
             * 而洞察这层是 929/930。点下去 state 确实变了、sheet 也确实挂上了,
             * 只是被整个盖住 —— 表现就是三颗键全是死的(用户实锤:「没有真正接入功能」)。
             *
             * 修法与仓库既有做法一致(见 memorySearchHandler 的同款注释):**先关浮层再开** ——
             * 拍一下 / 说一句 / 聊天本来就是主面上的动作,不是洞察里的动作。
             * 不走「把这些 sheet 全抬到 930 以上」那条路:400/310 是相对一堆别的东西定的,
             * 全局抬层会把 .nesio-sheet-overlay 那段层序契约弄坏。
             */
            onToday={() => { setInsightsOpen(false); setActiveSurface('today'); }}
            onCamera={(file) => { setInsightsOpen(false); setCameraFile(file); setCaptureMode('camera'); }}
            onAsk={() => { setInsightsOpen(false); handleAskFromCenterButton(); }}
            // 已经在洞察首页了,再点「洞察」不做任何事(和系统 tab bar 一致)。
            onInsights={() => { setInsightsTab(undefined); setInsightsOpen(true); }}
            insightsActive={insightsOpen}
            aboveOverlay={insightsOpen && insightsHub}
            onChatOpen={() => { setInsightsOpen(false); setChatOpen(true); }}
          />
        )}
      </div>

      {/* Capture sheets — rendered at root level, independent of TellNesioSheet state */}
      <CameraSheet
        open={captureMode === 'camera'}
        initialFile={cameraFile}
        intakeSubtype={pantryIntake ? '食材' : undefined}
        mode={modeCamera ?? undefined}
        onModeCaptured={(photo) => {
          const m = modeCamera;
          if (!m) return;
          // 拍完:照片进交接匣 → 关相机 → 重开来源 sheet(挂载时取走照片继续)。80ms 同进货的节拍。
          setPendingCapture(m, photo);
          setModeCamera(null); setCaptureMode(null); setCameraFile(null);
          setTimeout(() => {
            if (m === 'meal') setCookingOpen(true);
            else { setInsightsTab('wardrobe'); setInsightsNonce((n) => n + 1); setInsightsOpen(true); }
          }, 80);
        }}
        onClose={() => {
          const wasPantry = pantryIntake;
          const m = modeCamera;
          setCaptureMode(null); setCameraFile(null); setPantryIntake(false); setModeCamera(null);
          if (wasPantry) setTimeout(() => setCookingOpen(true), 80);
          // 模式相机取消:也回到来源 sheet,别把用户丢在首页。
          else if (m === 'meal') setTimeout(() => setCookingOpen(true), 80);
          else if (m === 'wardrobe') setTimeout(() => { setInsightsTab('wardrobe'); setInsightsNonce((n) => n + 1); setInsightsOpen(true); }, 80);
        }}
      />
      <VoiceInputSheet
        open={captureMode === 'voice'}
        canUsePrivateData={canViewPrivateData}
        onClose={() => setCaptureMode(null)}
      />
      <ShareSheet open={captureMode === 'share'} onClose={() => setCaptureMode(null)} />
      <MoodSheet open={moodOpen} onClose={() => setMoodOpen(false)} />
      <FreezeVaultSheet open={freezeOpen} onClose={() => setFreezeOpen(false)} initialTab="add" />
      {ownerConflict && (
        <NesioSheet
          variant="center"
          open
          onOpenChange={() => { /* 强制选择:不可点外/Esc 关,出口是卡片内的按钮 */ }}
          dismissible={false}
          card={false}
          opaqueOverlay // 隐私:不透明遮罩,换人时背后不透出上一账号界面

          ariaLabel={ownerConflict.kind === 'other_account'
            ? L(dict, '这台设备上有另一个账号的数据', 'This device holds another account’s data')
            : L(dict, '把本机已有的记录归入这个账号?', 'Keep the records already on this device?')}
        >
          <div style={{ width: 'min(96vw, 440px)', background: 'var(--sheet-opaque, #fff)', color: 'var(--portal-ink, #2c2c2c)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-6) var(--space-5)', boxShadow: '0 12px 48px rgba(4,10,22,0.4)' }}>
            <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-h3)', fontWeight: 700 }}>
              {ownerConflict.kind === 'other_account'
                ? L(dict, '这台设备上有另一个账号的数据', 'This device holds another account’s data')
                : L(dict, '把本机已有的记录归入这个账号?', 'Keep the records already on this device?')}
            </h3>
            <p style={{ margin: '0 0 var(--space-4)', lineHeight: 1.6, color: 'var(--portal-muted, #8a94a6)', fontSize: 'var(--text-body)' }}>
              {ownerConflict.kind === 'other_account'
                ? L(dict,
                    `本机现在是${ownerConflict.prevEmail ? `「${ownerConflict.prevEmail}」` : '上一个账号'}的空间。切换后,ta 的记忆会先归档在本机 ta 的名下(不删除、不外泄),换回 ta 的账号时原样回来;你会进入自己的空间。`,
                    `This device currently holds ${ownerConflict.prevEmail ? `"${ownerConflict.prevEmail}"` : 'the previous account'}'s space. Switching archives their memories on this device under their name (nothing deleted or exposed) — they come back when they sign in again. You'll enter your own space.`)
                : L(dict,
                    '登录前这台设备上已经有一些未登录时的记录。归入这个账号后会随账号同步;也可以清除后从零开始。',
                    'There are records made on this device before signing in. Keep them under this account (they will sync with it), or clear them and start fresh.')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {ownerConflict.kind === 'other_account' ? (
                <>
                  <button type="button" disabled={ownerBusy}
                    onClick={async () => {
                      // 批次 34:不再逼用户清数据 —— 账号空间互换:
                      // 上一账号本地数据整包归档(独立 IDB,按 userId 存),清场,
                      // 恢复本账号归档(若有);没有则空场起步,云同步拉回。
                      setOwnerBusy(true);
                      const prev = getLocalOwner();
                      if (prev?.userId) await archiveCurrentSpace(prev.userId);
                      await purgeAllLocalUserData();
                      await restoreArchivedSpace(ownerConflict.userId);
                      setLocalOwner(ownerConflict.userId, ownerConflict.email);
                      window.location.reload();
                    }}
                    style={{ width: '100%', background: 'var(--portal-accent, #588ce3)', color: 'var(--portal-on-accent, #fff)', border: 'none', borderRadius: 999, padding: 'var(--space-3)', fontSize: 'var(--text-body)', fontWeight: 600, cursor: 'pointer', opacity: ownerBusy ? 0.6 : 1 }}>
                    {ownerBusy ? L(dict, '正在切换空间…', 'Switching spaces…') : L(dict, '切换到我的空间', 'Switch to my space')}
                  </button>
                  <button type="button" disabled={ownerBusy}
                    onClick={async () => { setOwnerBusy(true); await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); window.location.reload(); }}
                    style={{ width: '100%', background: 'none', color: 'var(--portal-muted, #8a94a6)', border: '1px solid var(--portal-line, #d7deea)', borderRadius: 999, padding: 'var(--space-3)', fontSize: 'var(--text-body)', cursor: 'pointer' }}>
                    {L(dict, '退出登录', 'Sign out')}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" disabled={ownerBusy}
                    onClick={() => { claimLocalDataForUser(ownerConflict.userId, ownerConflict.email); setOwnerConflict(null); }}
                    style={{ width: '100%', background: 'var(--portal-accent, #588ce3)', color: 'var(--portal-on-accent, #fff)', border: 'none', borderRadius: 999, padding: 'var(--space-3)', fontSize: 'var(--text-body)', fontWeight: 600, cursor: 'pointer' }}>
                    {L(dict, '归入这个账号', 'Keep them under this account')}
                  </button>
                  <button type="button" disabled={ownerBusy}
                    onClick={async () => { setOwnerBusy(true); await purgeAllLocalUserData(); setLocalOwner(ownerConflict.userId, ownerConflict.email); window.location.reload(); }}
                    style={{ width: '100%', background: 'none', color: 'var(--portal-muted, #8a94a6)', border: '1px solid var(--portal-line, #d7deea)', borderRadius: 999, padding: 'var(--space-3)', fontSize: 'var(--text-body)', cursor: 'pointer' }}>
                    {ownerBusy ? L(dict, '清除中…', 'Clearing…') : L(dict, '清除本机数据,从零开始', 'Clear local data & start fresh')}
                  </button>
                </>
              )}
            </div>
          </div>
        </NesioSheet>
      )}
      {proGate && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setProGate(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(4, 10, 22, 0.55)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(96vw, 460px)', margin: '0 0 max(1rem, env(safe-area-inset-bottom))', background: 'var(--sheet-opaque, #fff)', color: 'var(--portal-ink, #2c2c2c)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-6) var(--space-5)', boxShadow: '0 -8px 40px rgba(4,10,22,0.35)' }}
          >
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', letterSpacing: '0.08em', color: 'var(--portal-accent, #588ce3)', fontWeight: 700 }}>PRO</p>
            <h3 style={{ margin: 'var(--space-1) 0 var(--space-2)', fontSize: '1.15rem', fontWeight: 700 }}>
              {proGate === 'freeze'
                ? L(dict, '冷冻仓是 Pro 功能', 'Freeze Vault is a Pro feature')
                : L(dict, 'AI 深度识别是 Pro 功能', 'AI recognition is a Pro feature')}
            </h3>
            <p style={{ margin: '0 0 var(--space-4)', lineHeight: 1.6, color: 'var(--portal-muted, #8a94a6)' }}>
              {proGate === 'freeze'
                ? L(dict, '想冲动买的先冻起来,给自己一个冷静期。这项功能会随 Pro 订阅一起开放。', 'Freeze impulse buys and give yourself a cooling-off period. This unlocks with Pro when subscriptions go live.')
                : L(dict, '记录、搜索、手动标签永远免费。AI 自动识别与整理会随 Pro 订阅开放。', 'Capturing, search, and manual tags stay free forever. AI auto-recognition and organizing unlock with Pro.')}
            </p>
            <button
              type="button"
              onClick={() => setProGate(null)}
              style={{ width: '100%', background: 'var(--portal-accent, #588ce3)', color: 'var(--portal-on-accent, #fff)', border: 'none', borderRadius: 999, padding: 'var(--space-3)', fontSize: 'var(--text-body)', fontWeight: 600, cursor: 'pointer' }}
            >
              {L(dict, '知道了', 'Got it')}
            </button>
          </div>
        </div>
      )}
      {/* 洞察 = 真全屏页(Radix fullscreen),不是「底部 Vaul 抽屉硬撑 100lvh」。
          假全屏会让 Vaul transform 把整页上推叠状态栏、底下留缝;下滑只是重算位置。 */}
      {insightsMounted && (
        <NesioSheet
          variant="fullscreen"
          open={insightsOpen}
          onOpenChange={(next) => { if (!next) setInsightsOpen(false); }}
          card={false}
          className="nesio-insights-sheet-card"
          ariaLabel={L(dict, 'Nesio 的洞察', "Nesio's insights")}
        >
          <InsightsSheet onClose={() => setInsightsOpen(false)} canUsePrivateData={canViewPrivateData} initialTab={insightsTab} tabNonce={insightsNonce} onHubChange={setInsightsHub} />
        </NesioSheet>
      )}
      {/* 悬浮播放球:挂在这一层,才能在**每一页**都看得见。
          音频本体在 player-engine 的模块级 audio 上(不在音乐面板里),
          所以切走那一页歌不会断 —— 这颗球就是那时候唯一的控制入口。 */}
      <FloatingPlayer />
      <InventorySheet open={inventoryOpen} onClose={() => setInventoryOpen(false)} />
      {calendarCreateOpen && <CalendarCreateSheet open={calendarCreateOpen} onClose={() => setCalendarCreateOpen(false)} />}
      {/* onToday:右上「今天」要连洞察一起关(bug3:左边回洞察、右边回今天) */}
      {familyMounted && (
        <FamilySharingSheet
          open={familyOpen}
          onClose={() => setFamilyOpen(false)}
          onToday={() => { setFamilyOpen(false); setInsightsOpen(false); }}
        />
      )}
      {teslaMounted && (
        <TeslaSheet open={teslaOpen} onClose={() => setTeslaOpen(false)} />
      )}
      {cookingOpen && (
        <CookingSheet
          open={cookingOpen}
          onClose={() => { setCookingOpen(false); setCookingRecipeName(undefined); }}
          initialRecipeName={cookingRecipeName}
        />
      )}
      {workoutSession && (
        // 错误边界(修「打开跟练 app 卡死」):跟练播放器一旦被畸形数据(如别端同步回的坏 workout)
        // 击中 throw,绝不能冒泡卸载整棵 Portal(=白屏/卡死);就地兜住、显示可截图的报错。
        <TabErrorBoundary key={workoutKey} label="workout">
          <WorkoutPlayer session={workoutSession} onClose={() => setWorkoutSession(null)} />
        </TabErrorBoundary>
      )}
      {briefOpen && <DailyBriefSheet open={briefOpen} onClose={() => setBriefOpen(false)} canUsePrivateData={canViewPrivateData} />}
      {dictOpen && (
        <DictionarySheet open={dictOpen} initialQuery={dictQuery}
          onClose={() => { setDictOpen(false); setDictQuery(''); }} />
      )}
      <AskGuideSheet open={askGuideOpen} onClose={() => setAskGuideOpen(false)} onStart={openAskChat} />

      <NesioChatSheet open={chatOpen} onClose={() => setChatOpen(false)} canUsePrivateData={canViewPrivateData} />
      <NotePanelEnhanced open={noteOpen} onOpenChange={setNoteOpen} />
      {memoryReceipt && (
        <div className="nesio-memory-receipt" role="status" aria-live="polite">
          <span className="nesio-memory-receipt-crystal" aria-hidden />
          <span>{L(dict, '收好了，以后可以找回来。', 'Tucked away — you can find it again later.')}</span>
        </div>
      )}
      <PortalOnboarding />
      <InstallPrompt locale={locale} />
    </>
  );
}
