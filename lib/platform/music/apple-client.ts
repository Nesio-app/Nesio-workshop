/**
 * Apple Music 客户端接线(MusicKit JS v3)。
 *
 * 四个源里,这是**唯一** Nesio 自己当播放器、又不用用户额外装一个 App 的远端源:
 * 声音走 Nesio 的音频会话,车机蓝牙上显示的还是 Nesio。
 * 代价是用户得有 Apple Music 订阅,而且 developer token 必须服务端签
 * (见 app/api/portal/music/apple-token/route.ts)。
 *
 * MusicKit 是从 Apple 的 CDN 动态载入的,**只在用户真的要连 Apple Music 时才载** ——
 * 不在首屏塞一个第三方脚本。
 */

interface MusicKitInstance {
  isAuthorized: boolean;
  authorize: () => Promise<string>;
  unauthorize: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  setQueue: (o: Record<string, unknown>) => Promise<unknown>;
}
interface MusicKitGlobal {
  configure: (o: Record<string, unknown>) => Promise<MusicKitInstance>;
  getInstance: () => MusicKitInstance | undefined;
}
declare global {
  interface Window { MusicKit?: MusicKitGlobal }
}

const CDN = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';

let loading: Promise<boolean> | null = null;

function loadScript(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.MusicKit) return Promise.resolve(true);
  // 记住这次加载:两个入口同时点「连接」不该插两份 script。
  if (loading) return loading;
  loading = new Promise<boolean>((resolve) => {
    const el = document.createElement('script');
    el.src = CDN;
    el.async = true;
    el.onload = () => resolve(!!window.MusicKit);
    // 载不进来(断网 / 被拦)是**可见失败**:调用方要把「Apple Music 没连上」说出来,
    // 不能静默停在 idle。
    el.onerror = () => { loading = null; resolve(false); };
    document.head.appendChild(el);
  });
  return loading;
}

export interface AppleTokenResponse {
  ok: boolean;
  configured: boolean;
  token?: string;
  error?: string;
  missingEnv?: string[];
}

export async function fetchAppleToken(): Promise<AppleTokenResponse> {
  try {
    const res = await fetch('/api/portal/music/apple-token', { cache: 'no-store' });
    if (!res.ok) return { ok: false, configured: false, error: `http_${res.status}` };
    return await res.json() as AppleTokenResponse;
  } catch {
    return { ok: false, configured: false, error: 'network' };
  }
}

/**
 * 准备好 MusicKit 实例(不弹授权框)。返回 null = 这条路今天走不通,
 * 原因在 lastAppleError 里 —— 调用方必须显示它。
 */
let lastError = '';
export function lastAppleError(): string { return lastError; }

export async function prepareMusicKit(): Promise<MusicKitInstance | null> {
  lastError = '';
  const tok = await fetchAppleToken();
  if (!tok.configured) {
    lastError = 'Apple Music 还没配好开发者密钥,这一步得先在服务端补上。';
    return null;
  }
  if (!tok.token) {
    lastError = 'Apple Music 的密钥签不出来 —— 配置里有一项不对。';
    return null;
  }
  if (!(await loadScript())) {
    lastError = 'Apple Music 的组件没加载出来,可能是网络被挡了。稍后再试,或先用本地歌曲。';
    return null;
  }
  try {
    const mk = window.MusicKit!;
    return mk.getInstance() || await mk.configure({
      developerToken: tok.token,
      app: { name: 'Nesio', build: '1' },
    });
  } catch (e) {
    lastError = `Apple Music 初始化没成功(${(e as Error)?.message || '未知'})。`;
    return null;
  }
}

/** 用户点「连接」时调。返回是否已授权。 */
export async function authorizeApple(): Promise<boolean> {
  const inst = await prepareMusicKit();
  if (!inst) return false;
  if (inst.isAuthorized) return true;
  try {
    await inst.authorize();
    return inst.isAuthorized;
  } catch {
    // 用户自己取消也走这里 —— 不当成错误刷屏,返回 false 让界面回到「未连接」。
    return false;
  }
}

/** 已加载的实例是否已授权。**不触发加载** —— 探测就绪状态不该有副作用。 */
export function appleAuthorizedNow(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.MusicKit?.getInstance?.()?.isAuthorized === true; } catch { return false; }
}
