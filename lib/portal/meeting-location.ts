/**
 * meeting-location —— 「地点」字段里塞的是会议链接时怎么办(2026-07-30,bug #18)。
 *
 * 现场:一条来自 Gmail 的日程记忆,「地点」写的是一整条 Zoom 链接
 * (https://fmr.…/j/…)。这不是 Nesio 编的 —— Google 日历里 Zoom / Teams / Meet
 * 本来就是把**会议链接**写进 location 字段的,它们那边就这么设计。
 *
 * 但原样挂在「地点」下面语义不对:一条 URL 不是一个地方。
 * 之前的判据是「整段 location 就是一条 URL」才认 —— 现实里常见的是
 * `Zoom Meeting https://…`、`https://… (Room 3)` 这种混着写的,它们全都漏了,
 * 于是照旧把一长串 URL 印在「地点」下面。
 *
 * 判据换成:**把 URL 摘出来**,剩下的文字才是地点。
 *   · 摘完什么都不剩 → 这条记录根本没有地点,只有一个加入方式;
 *   · 还剩文字 → 那才是真地点(会议室、地址),链接单独作为「会议链接」给出。
 *
 * 纯函数。
 */

/** 一眼能认出是「加入会议」的域。认不出的 URL 也照样摘出来 —— URL 本来就不是地点。 */
const MEETING_HOSTS = [
  'zoom.us', 'zoom.com', 'meet.google.com', 'teams.microsoft.com', 'teams.live.com',
  'webex.com', 'whereby.com', 'bluejeans.com', 'gotomeeting.com', 'chime.aws',
  'meeting.tencent.com', 'feishu.cn', 'larksuite.com', 'dingtalk.com', 'around.co',
];

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

export interface SplitLocation {
  /** 真地点(会议室 / 地址)。没有就是空串。 */
  place: string;
  /** 加入会议的链接。没有就是空串。 */
  meetingUrl: string;
  /** 这个链接是一眼能认出的会议服务吗(用于措辞:「会议链接」vs「链接」)。 */
  knownMeeting: boolean;
}

export function splitEventLocation(raw: string | null | undefined): SplitLocation {
  const s = String(raw || '').trim();
  if (!s) return { place: '', meetingUrl: '', knownMeeting: false };

  const urls = s.match(URL_RE) || [];
  if (!urls.length) return { place: s, meetingUrl: '', knownMeeting: false };

  const meetingUrl = urls[0] ?? '';
  let host = '';
  try { host = new URL(meetingUrl).hostname.replace(/^www\./, '').toLowerCase(); } catch { host = ''; }
  const knownMeeting = !!host && MEETING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

  // 摘掉所有 URL,剩下的才有资格叫地点。顺手清掉摘完留下的孤立标点/连接词。
  const place: string = s
    .replace(URL_RE, ' ')
    .replace(/\b(join|link|url|meeting|会议|链接|入口)\b/gi, ' ')
    .replace(/[·|,，、\-–—()（）:：]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { place, meetingUrl, knownMeeting };
}

/** 链接给用户看的短样子(域名),打不开就原样。 */
export function shortUrlLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}
