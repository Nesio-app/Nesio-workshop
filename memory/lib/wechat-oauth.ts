import { createHmac, randomBytes } from "crypto";

const STATE_COOKIE = "wechat_oauth_state";
const STATE_TTL = 600;

export function wechatLoginConfigured(): boolean {
  return Boolean(process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET);
}

function appId() {
  const id = process.env.WECHAT_APP_ID;
  if (!id) throw new Error("WECHAT_APP_ID not configured");
  return id;
}

function appSecret() {
  const s = process.env.WECHAT_APP_SECRET;
  if (!s) throw new Error("WECHAT_APP_SECRET not configured");
  return s;
}

export function wechatRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL required for WeChat OAuth");
  return `${base}/api/auth/wechat/callback`;
}

export function createOAuthState(): string {
  const nonce = randomBytes(16).toString("hex");
  const exp = Date.now() + STATE_TTL * 1000;
  const payload = `${nonce}.${exp}`;
  const secret = process.env.AUTH_SECRET || "wechat-state";
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyOAuthState(state: string | null): boolean {
  if (!state) return false;
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [nonce, expStr, sig] = parts;
  const payload = `${nonce}.${expStr}`;
  const secret = process.env.AUTH_SECRET || "wechat-state";
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (sig !== expected) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  return true;
}

export { STATE_COOKIE };

export function buildAuthorizeUrl(state: string): string {
  const redirect = encodeURIComponent(wechatRedirectUri());
  return (
    "https://open.weixin.qq.com/connect/qrconnect" +
    `?appid=${appId()}` +
    `&redirect_uri=${redirect}` +
    "&response_type=code" +
    "&scope=snsapi_login" +
    `&state=${encodeURIComponent(state)}` +
    "#wechat_redirect"
  );
}

type TokenResponse = {
  access_token?: string;
  openid?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
};

type UserInfoResponse = {
  openid?: string;
  nickname?: string;
  headimgurl?: string;
  errcode?: number;
  errmsg?: string;
};

export async function exchangeCode(code: string) {
  const url =
    "https://api.weixin.qq.com/sns/oauth2/access_token" +
    `?appid=${appId()}` +
    `&secret=${appSecret()}` +
    `&code=${encodeURIComponent(code)}` +
    "&grant_type=authorization_code";

  const res = await fetch(url);
  const data = (await res.json()) as TokenResponse;
  if (data.errcode || !data.access_token || !data.openid) {
    throw new Error(data.errmsg || "微信授权失败");
  }
  return data as Required<Pick<TokenResponse, "access_token" | "openid">> & {
    unionid?: string;
  };
}

export async function fetchWechatUserInfo(
  accessToken: string,
  openid: string
) {
  const url =
    "https://api.weixin.qq.com/sns/userinfo" +
    `?access_token=${encodeURIComponent(accessToken)}` +
    `&openid=${encodeURIComponent(openid)}`;

  const res = await fetch(url);
  const data = (await res.json()) as UserInfoResponse;
  if (data.errcode) {
    throw new Error(data.errmsg || "获取微信用户信息失败");
  }
  return data;
}

export function wechatEmail(openid: string) {
  return `wx_${openid}@nianguichu.local`;
}
