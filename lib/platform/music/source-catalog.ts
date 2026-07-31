/**
 * 音乐源目录(2026-07-30,「本地歌曲 + 网易 + 自由切换 + Spotify + Apple Music」)。
 *
 * 这个文件存在的唯一理由:**「自由切换」不是一个播放器接四个源,是两种不同的播放模型**。
 * 把这件事写死在类型里,比在 UI 里靠人记住可靠。
 *
 *   · in-app      —— 声音从 **Nesio 自己**的音频会话出来。本地文件、Apple Music(MusicKit)属这类。
 *                    车机蓝牙上显示的是 Nesio,曲名/暂停键归 Nesio 管。
 *   · remote      —— 声音从**别的 App** 出来,Nesio 只是遥控器。Spotify 属这类
 *                    (iOS 是 App Remote,web 是 Connect):必须装着 Spotify、且是 Premium,
 *                    车机上显示的是 **Spotify 不是 Nesio**。
 *   · metadata-only —— 查得到、放不出声。网易在**没有国内出口**时就是这一类:
 *                    搜索/歌单/封面都不锁区,锁的是「拿播放地址」那一步。
 *
 * 从 in-app 切到 remote,用户看到的东西会当场变(车机屏幕换一个 App、音量走另一条通道)。
 * 这**必须提前说**,不能切完了让他自己发现 —— switchNotice() 就是那句话。
 *
 * ── 判据方向(仓里反复栽的那个坑)────────────────────────────────────────────
 * canPlayNow() 是**正向判据**:一个源必须自己证明「凭证齐了、授权过了、这首歌拿得到流」
 * 才算能放。不是「没被拦住的就算能放」。
 * 反过来写的后果很具体:网易没配代理 → 判不出「不能放」→ 进了回退链 → 用户点播放,
 * 静默无声,而界面上一切正常。这正是这个仓已经犯过很多次的病。
 *
 * 纯函数,不碰网络、不碰存储 —— 就绪状态由调用方(各源的适配器)测出来传进来。
 */

export type MusicSourceId = 'local' | 'netease' | 'apple' | 'spotify';

export type PlaybackModel = 'in-app' | 'remote' | 'metadata-only';

export interface MusicSourceInfo {
  id: MusicSourceId;
  zh: string;
  en: string;
  model: PlaybackModel;
  /** 车机/蓝牙上会显示成哪个 App —— 切源提示要用它,不能含糊成「可能会变」。 */
  showsOnCar: string;
  /** 需要用户额外持有什么(订阅/客户端)。空 = 不需要。中英各一份 —— 它会被拼进
   *  给用户看的句子里,只留中文的话英文界面会当场混进中文。 */
  requires: string;
  requiresEn: string;
}

export const MUSIC_SOURCES: readonly MusicSourceInfo[] = Object.freeze([
  {
    id: 'local',
    zh: '本地歌曲',
    en: 'Local files',
    model: 'in-app',
    showsOnCar: 'Nesio',
    requires: '',
    requiresEn: '',
  },
  {
    id: 'apple',
    zh: 'Apple Music',
    en: 'Apple Music',
    model: 'in-app',
    showsOnCar: 'Nesio',
    requires: 'Apple Music 订阅',
    requiresEn: 'an Apple Music subscription',
  },
  {
    id: 'spotify',
    zh: 'Spotify',
    en: 'Spotify',
    // 遥控模型:Nesio 发指令,声音和界面都在 Spotify 那边。
    model: 'remote',
    showsOnCar: 'Spotify',
    requires: 'Spotify Premium + 装着 Spotify',
    requiresEn: 'Spotify Premium with the Spotify app installed',
  },
  {
    id: 'netease',
    zh: '网易云音乐',
    en: 'NetEase',
    // 没有国内出口 IP 就拿不到播放地址 —— 这是它此刻的真实能力,不是「暂时故障」。
    model: 'metadata-only',
    showsOnCar: '—',
    requires: '国内网络出口',
    requiresEn: 'a mainland-China network route',
  },
]);

export function sourceInfo(id: MusicSourceId): MusicSourceInfo {
  const s = MUSIC_SOURCES.find((x) => x.id === id);
  // 目录是常量、id 是联合类型,取不到只可能是有人改坏了目录 —— 不静默兜底成能放。
  if (!s) throw new Error(`unknown music source: ${id}`);
  return s;
}

/* ── 就绪状态 ────────────────────────────────────────────────────────────── */

/**
 * 一个源此刻的就绪状态。三项**分开**报,因为用户要看的不是「不能用」,
 * 而是「差哪一步、我能做什么」——「还没连 Spotify」和「连了但不是 Premium」
 * 是完全不同的两句话、两个动作。
 */
export interface SourceReadiness {
  /** 服务端凭证/环境齐了(开发者密钥、API base 之类)。 */
  configured: boolean;
  /** 这个账号授权过了(本地源恒 true —— 文件就在机器上,没有谁需要授权)。 */
  authorized: boolean;
  /** 现在真拿得到可播放的音频流。地区锁、免费账号、曲库缺歌都卡在这一项。 */
  streamable: boolean;
}

export const UNREADY: SourceReadiness = Object.freeze({ configured: false, authorized: false, streamable: false });

/**
 * 正向判据:这个源**现在**能出声吗。
 * 四个条件全部为真才算 —— 少一个都算不能,不做「大概可以」的推断。
 */
export function canPlayNow(id: MusicSourceId, r: SourceReadiness): boolean {
  if (sourceInfo(id).model === 'metadata-only') return false;
  return r.configured === true && r.authorized === true && r.streamable === true;
}

/**
 * 这些话都收进 COPY,按语言取 —— 上一轮 #24 修的就是「动态生成的文案只有中文」。
 * 用户自己的数据(曲名、账号名)永远不翻译;翻译的只有系统说的这部分。
 */
export type MusicLocale = 'zh' | 'en';

const COPY = {
  zh: {
    name: (s: MusicSourceInfo) => s.zh,
    metaOnly: (s: MusicSourceInfo) => `${s.zh}这里能搜到歌、看得到歌单,但放不出声 —— 差一个${s.requires}。先用别的源听。`,
    unconfigured: (s: MusicSourceInfo) => `${s.zh}还没配好,这一步得在设置里补上。`,
    unauthorized: (s: MusicSourceInfo) => `${s.zh}还没连上你的账号,连一下就能听。`,
    notStreamable: (s: MusicSourceInfo) => `${s.zh}连上了,但这首现在取不到 —— 通常是${s.requires}的关系。换个源试试。`,
    toRemote: (b: MusicSourceInfo) => `换到 ${b.zh} 之后,声音由 ${b.zh} 播、车机上显示的也是 ${b.showsOnCar}。Nesio 这边只当遥控器。`,
    fromRemote: (a: MusicSourceInfo, b: MusicSourceInfo) => `换回 ${b.zh} 之后,${a.zh} 会停,声音回到 Nesio 自己播、车机上显示 ${b.showsOnCar}。`,
    toMetaOnly: (b: MusicSourceInfo) => `${b.zh}现在只能查不能放,切过去不会有声音。`,
    toInApp: (b: MusicSourceInfo) => `换到 ${b.zh},声音回到 Nesio 自己播。`,
    halfWay: (names: string) => `${names}还差一步:连上账号就能听。`,
    // 本地歌曲差的不是账号,是**还没导歌** —— 拿「连上账号」去说它,是一句对不上的话。
    localEmpty: '本地歌曲还是空的 —— 导几首进来就能听,不要账号也不要网络。',
    nothing: '现在还没有能出声的音源。先往本地歌曲里放几首,离线也听得到。',
  },
  en: {
    name: (s: MusicSourceInfo) => s.en,
    metaOnly: (s: MusicSourceInfo) => `${s.en} can search and browse here, but it cannot play — that needs ${s.requiresEn}. Use another source for now.`,
    unconfigured: (s: MusicSourceInfo) => `${s.en} is not set up yet — that step happens in settings.`,
    unauthorized: (s: MusicSourceInfo) => `${s.en} is not linked to your account yet. Connect it and you are set.`,
    notStreamable: (s: MusicSourceInfo) => `${s.en} is connected, but this one will not stream right now — usually about ${s.requiresEn}. Try another source.`,
    toRemote: (b: MusicSourceInfo) => `After switching to ${b.en}, ${b.en} plays the audio and your car shows ${b.showsOnCar}. Nesio is just the remote.`,
    fromRemote: (a: MusicSourceInfo, b: MusicSourceInfo) => `Switching back to ${b.en} stops ${a.en}; Nesio plays again and your car shows ${b.showsOnCar}.`,
    toMetaOnly: (b: MusicSourceInfo) => `${b.en} can only search right now, so switching there will not make any sound.`,
    toInApp: (b: MusicSourceInfo) => `Switching to ${b.en} — Nesio plays the audio again.`,
    halfWay: (names: string) => `${names} are one step away — just connect an account.`,
    localEmpty: 'Local music is still empty — drop a few files in and you can listen, no account and no network needed.',
    nothing: 'No source can play yet. Drop a few files into local music — those work offline.',
  },
} as const;

const t = (locale: MusicLocale) => (locale === 'en' ? COPY.en : COPY.zh);

/**
 * 不能放的时候,给用户看的那句话。warm-coach:说清差哪一步,并且**留出口**
 * (换个源就能听),不指责、不制造焦虑。
 * 能放时返回空串 —— 调用方据此决定要不要显示这一行。
 */
export function blockedReason(id: MusicSourceId, r: SourceReadiness, locale: MusicLocale = 'zh'): string {
  const s = sourceInfo(id);
  const c = t(locale);
  if (canPlayNow(id, r)) return '';
  // 本地歌曲**单独说**:它不需要配置、不需要账号,唯一放不出声的原因是曲库空着。
  // 走下面那条通用话术的话,requires 是空串,句子会变成「连上了,但这首现在取不到 ——
  // 通常是的关系」:一句读不通的话。
  if (id === 'local') return c.localEmpty;
  if (s.model === 'metadata-only') return c.metaOnly(s);
  if (!r.configured) return c.unconfigured(s);
  if (!r.authorized) return c.unauthorized(s);
  return c.notStreamable(s);
}

/* ── 换源 ────────────────────────────────────────────────────────────────── */

/**
 * 从一个源切到另一个源,**在切之前**要说的话。
 * 返回空串 = 两边播放模型一样,用户感知不到差别,不必打扰他。
 *
 * 为什么非说不可:in-app ↔ remote 之间跨过去,车机屏幕上显示的 App 会换、
 * 谁在出声也会换。用户在开车,不该由他自己去猜「怎么突然变成 Spotify 了」。
 */
export function switchNotice(from: MusicSourceId, to: MusicSourceId, locale: MusicLocale = 'zh'): string {
  if (from === to) return '';
  const a = sourceInfo(from);
  const b = sourceInfo(to);
  const c = t(locale);
  if (a.model === b.model) return '';
  if (b.model === 'remote') return c.toRemote(b);
  if (a.model === 'remote') return c.fromRemote(a, b);
  // 剩下的一侧是 metadata-only:那边本来就没在出声,谈不上"换过去听"。
  return b.model === 'metadata-only' ? c.toMetaOnly(b) : c.toInApp(b);
}

/* ── 放不出来就换下一个 ──────────────────────────────────────────────────── */

/**
 * 回退链:优先用 preferred,它放不了就顺着往下找**真能放**的。
 *
 * 只有 canPlayNow() 为真的源才进链 —— 这是这个函数的全部意义。
 * 链是空的就是空的:调用方必须处理「一个都放不了」,不许拿链头当"总有一个能用"。
 *
 * 顺序:preferred 在最前,其余按 MUSIC_SOURCES 的目录顺序(稳定、可预期,
 * 不按「上次成功过的」排 —— 那会让同一次点击在两台设备上走不同的源)。
 */
export function fallbackChain(
  preferred: MusicSourceId,
  readiness: Readonly<Partial<Record<MusicSourceId, SourceReadiness>>>,
): MusicSourceId[] {
  const ok = (id: MusicSourceId) => canPlayNow(id, readiness[id] ?? UNREADY);
  const rest = MUSIC_SOURCES.map((s) => s.id).filter((id) => id !== preferred && ok(id));
  return ok(preferred) ? [preferred, ...rest] : rest;
}

/**
 * 一个都放不了时给用户的那句话。这是**必须有**的分支 ——
 * 「按了没反应」这一类 bug 的根都在这儿:没人写这个空态。
 */
export function noSourceLine(
  readiness: Readonly<Partial<Record<MusicSourceId, SourceReadiness>>>,
  locale: MusicLocale = 'zh',
): string {
  const c = t(locale);
  // 本地歌曲**单独说**。它 configured 恒真、authorized 恒真,不能放只可能是一个原因:
  // 曲库空着。把它混进「还差一步 —— 连上账号」那句里,得到的是一句对不上的话
  // (实测:当前源是 Apple Music,屏幕上却写着「本地歌曲还差一步…连上账号或换成本地歌曲」)。
  const localReady = readiness.local ?? UNREADY;
  if (localReady.configured && !localReady.streamable) return c.localEmpty;

  const half = MUSIC_SOURCES.filter((s) => {
    const r = readiness[s.id] ?? UNREADY;
    return s.id !== 'local' && s.model !== 'metadata-only' && r.configured && !canPlayNow(s.id, r);
  });
  if (half.length) return c.halfWay(half.map(c.name).join(locale === 'en' ? ', ' : '、'));
  return c.nothing;
}

/** 源名(按语言)。界面到处要用,别让每个调用点自己写 `locale === 'en' ? s.en : s.zh`。 */
export function sourceName(id: MusicSourceId, locale: MusicLocale = 'zh'): string {
  return t(locale).name(sourceInfo(id));
}
