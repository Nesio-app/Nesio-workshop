/**
 * 功能使用追踪 + 回访再触达提醒(Part 3/3)。
 *
 * 场景:用户不是第一次登录(来过好几回),但某些功能一直没碰过 —— 这时轻轻探一句
 *「要不要试试?」,而不是开屏硬塞。区别于新手引导(第一次)和 demo(空库)。
 *
 * 两份本机状态:
 *  ① 会话:firstOpenAt / sessionCount(30 分钟外算新会话)/ activeDays(去重的活跃天)。
 *     用来判定「回访用户」(来过 ≥3 次 或 活跃 ≥3 天)。
 *  ② 使用:每个功能的 lastUsedAt(显式标记)+ 每功能的「稍后」冷却 / 「不再提醒」黑名单。
 *
 * 是否用过某功能 = 显式标记 ∪ 从生命图谱推断(有心情节点=用过心情,有物品=用过收纳…),
 * 这样不必给每个按钮埋点。warm-coach:每条提醒都给「稍后 / 不再提醒」出口,全局两天内不重复叨扰。
 *
 * 纯本机偏好数据(非用户内容),写失败静默重试语义即可(丢了最多重现一次提醒),
 * 不触发 storage-health 掉数据事件。
 */
/** 判定只读 type/tags 两字段,故用结构化最小类型 —— LifeNode 与 today 的 FocusNode 都能喂进来。 */
export type UsageNode = { type: string; tags?: readonly string[] | null };

const USAGE_KEY = 'nesio-feature-usage-v1';
const SESSION_KEY = 'nesio-app-sessions-v1';
export const FEATURE_USAGE_EVENT = 'nesio-feature-usage-updated';

const NEW_SESSION_GAP = 30 * 60_000;       // 30 分钟外算一次新会话
const RETURNING_MIN_SESSIONS = 3;          // 来过 ≥3 次 = 回访
const RETURNING_MIN_DAYS = 3;              // 或 活跃 ≥3 天
const GLOBAL_NUDGE_COOLDOWN = 2 * 86_400_000; // 全局两天内不重复弹
const SNOOZE_DAYS = 4;                      // 「稍后」冷却天数

export type FeatureUsageState = {
  used: Record<string, number>;
  snoozedUntil: Record<string, number>;
  never: string[];
  lastNudgeAt?: number;
};

export type AppSessionState = {
  firstOpenAt: number;
  lastOpenAt: number;
  sessionCount: number;
  activeDays: string[];
};

export type ReengageNudge = {
  key: string;
  title: string;
  body: string;
  ctaLabel: string;
  /** 打开该功能的现有事件名;insights 走回调,无事件名。 */
  openEvent?: string;
};

// ── 低层读写(纯本机,best-effort) ──
function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch { return fallback; }
}
function write(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* 非内容数据,丢了最多重现一次提醒 */ }
}

function emptyUsage(): FeatureUsageState { return { used: {}, snoozedUntil: {}, never: [] }; }
function emptySession(now: number): AppSessionState {
  return { firstOpenAt: now, lastOpenAt: now, sessionCount: 0, activeDays: [] };
}

export function loadFeatureUsage(): FeatureUsageState { return read(USAGE_KEY, emptyUsage()); }
export function loadAppSessions(): AppSessionState { return read(SESSION_KEY, emptySession(Date.now())); }

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 应用打开时调一次:间隔 >30 分钟算新会话,记活跃天。返回新状态。 */
export function recordAppOpen(now = Date.now()): AppSessionState {
  const s = read<AppSessionState>(SESSION_KEY, emptySession(now));
  const isNewSession = s.sessionCount === 0 || now - s.lastOpenAt > NEW_SESSION_GAP;
  const today = dayKey(now);
  const next: AppSessionState = {
    firstOpenAt: s.firstOpenAt || now,
    lastOpenAt: now,
    sessionCount: s.sessionCount + (isNewSession ? 1 : 0),
    activeDays: s.activeDays.includes(today) ? s.activeDays : [...s.activeDays, today].slice(-60),
  };
  write(SESSION_KEY, next);
  return next;
}

/** 显式标记某功能已使用(view 类功能埋点用,如洞察/阅读器)。 */
export function markFeatureUsed(key: string, now = Date.now()): void {
  const u = loadFeatureUsage();
  u.used[key] = now;
  write(USAGE_KEY, u);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FEATURE_USAGE_EVENT));
}

/** 「稍后」:冷却几天。 */
export function snoozeNudge(key: string, now = Date.now()): void {
  const u = loadFeatureUsage();
  u.snoozedUntil[key] = now + SNOOZE_DAYS * 86_400_000;
  write(USAGE_KEY, u);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FEATURE_USAGE_EVENT));
}

/** 「不再提醒」:永久黑名单。 */
export function dismissNudgeForever(key: string): void {
  const u = loadFeatureUsage();
  if (!u.never.includes(key)) u.never.push(key);
  write(USAGE_KEY, u);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FEATURE_USAGE_EVENT));
}

/** 记下「刚弹过一次提醒」,支撑全局冷却。 */
export function markNudgeShown(now = Date.now()): void {
  const u = loadFeatureUsage();
  u.lastNudgeAt = now;
  write(USAGE_KEY, u);
}

export function isReturningUser(session: AppSessionState = loadAppSessions()): boolean {
  return session.sessionCount >= RETURNING_MIN_SESSIONS || session.activeDays.length >= RETURNING_MIN_DAYS;
}

/**
 * 预览/模拟运行:把状态改成「回访用户 + 清掉所有已用/冷却/黑名单」,
 * 让下一次进今天页时再触达提醒必然浮现(设置页「预览引导」用)。
 */
export function primeReengagementPreview(now = Date.now()): void {
  write(SESSION_KEY, {
    firstOpenAt: now - 7 * 86_400_000,
    lastOpenAt: now - 86_400_000,
    sessionCount: RETURNING_MIN_SESSIONS,
    activeDays: [],
  } satisfies AppSessionState);
  write(USAGE_KEY, emptyUsage());
}

// ── 功能目录(仅指向已存在的入口;功能以现有为准) ──
type FeatureDef = {
  key: string;
  title: string;
  body: string;
  ctaLabel: string;
  openEvent?: string;
  /** 从生命图谱推断是否用过(无则只看显式标记)。 */
  infer?: (nodes: readonly UsageNode[]) => boolean;
  /** 数据够不够格触发(如洞察需要攒够节点才有的看)。 */
  readyWhen?: (nodes: readonly UsageNode[]) => boolean;
};

const FEELING_TAGS = new Set(['feeling', 'moment']);

/** locale 友好文案由调用方决定;这里存中英双份,pick 时按 zh 传入。 */
export function featureCatalog(zh: boolean): FeatureDef[] {
  const L = (a: string, b: string) => (zh ? a : b);
  return [
    {
      key: 'insights',
      title: L('看看念念读到的你', 'See what Nesio has learned'),
      body: L('心情、关系、足迹、花销,念念已经悄悄连成了几条规律 —— 想看看吗?', 'Mood, people, places, spending — Nesio has quietly found a few patterns. Want a look?'),
      ctaLabel: L('打开洞察', 'Open Insights'),
      readyWhen: (nodes) => nodes.length >= 8,
    },
    {
      key: 'mood',
      title: L('记一下此刻的心情?', 'Log how you feel right now?'),
      body: L('今天页顶上点一下心情球,几秒钟。攒几次,洞察就能帮你看出情绪的节奏。', 'Tap the mood orb atop Today — a few seconds. A few logs and Insights reveals your rhythm.'),
      ctaLabel: L('记心情', 'Log mood'),
      openEvent: 'nesio-open-mood',
      infer: (nodes) => nodes.some((n) => n.type === 'health_state' && (n.tags ?? []).some((t) => FEELING_TAGS.has(t))),
    },
    {
      key: 'inventory',
      title: L('东西太多?让念念帮你记住放哪', 'Too many things? Let Nesio remember where'),
      body: L('拍一下或说一句,念念记住它放哪了 —— 要用时一搜就有,不用再翻箱倒柜。', 'Snap or say it — Nesio remembers where it went, so a search brings it back.'),
      ctaLabel: L('整理物品', 'Organize items'),
      openEvent: 'nesio-open-inventory',
      infer: (nodes) => nodes.some((n) => n.type === 'object'),
    },
    {
      key: 'capture',
      title: L('有什么想记的,随手说一句', 'Anything to remember? Just say it'),
      body: L('长按中间按钮,说「备用钥匙放在玄关」—— 记过就能找回,不用再存在脑子里。', 'Hold the center button: "Spare keys in the hallway." Noted once, found anytime.'),
      ctaLabel: L('记一笔', 'Jot it'),
      openEvent: 'nesio-open-tell',
    },
  ];
}

function isUsed(def: FeatureDef, usage: FeatureUsageState, nodes: readonly UsageNode[]): boolean {
  if (usage.used[def.key]) return true;
  if (def.infer && def.infer(nodes)) return true;
  return false;
}

/**
 * 挑一条再触达提醒 —— 回访用户 + 全局冷却外 + 该功能没用过/没拉黑/冷却已过 + 数据够格。
 * 返回 null = 现在不打扰。返回后调用方渲染,并在真正展示时 markNudgeShown()。
 */
export function pickReengagementNudge(opts: {
  nodes?: readonly UsageNode[];
  now?: number;
  zh?: boolean;
  session?: AppSessionState;
  usage?: FeatureUsageState;
} = {}): ReengageNudge | null {
  const now = opts.now ?? Date.now();
  const nodes = opts.nodes ?? [];
  const zh = opts.zh ?? true;
  const session = opts.session ?? loadAppSessions();
  const usage = opts.usage ?? loadFeatureUsage();

  if (!isReturningUser(session)) return null;
  if (usage.lastNudgeAt && now - usage.lastNudgeAt < GLOBAL_NUDGE_COOLDOWN) return null;

  for (const def of featureCatalog(zh)) {
    if (usage.never.includes(def.key)) continue;
    if (usage.snoozedUntil[def.key] && now < usage.snoozedUntil[def.key]) continue;
    if (isUsed(def, usage, nodes)) continue;
    if (def.readyWhen && !def.readyWhen(nodes)) continue;
    return { key: def.key, title: def.title, body: def.body, ctaLabel: def.ctaLabel, openEvent: def.openEvent };
  }
  return null;
}
