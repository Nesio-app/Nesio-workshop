/**
 * 歌词从哪儿来(2026-08-01,用户:「和网易一起。本地没歌词的,都用网易歌词,
 * 即使是本地歌曲」)。
 *
 * 顺序就是用户那句话:
 *   ① 本地曲目**自己带的**(mp3 里的 ID3 USLT)——它一定对得上这个文件;
 *   ② 没带的,拿曲名去网易搜一首同名的,用它的词。
 *
 * ── 为什么②要挑,不能直接拿第一条 ────────────────────────────────────────
 * 搜「晴天」出来的第一条可能是翻唱、现场版、或者纯粹的同名另一首歌。
 * 拿错的词比没有词更糟:没有词是「这首没词」,拿错是「这个 App 的歌词是乱的」。
 * 所以按**时长**卡一道(±5 秒),再按曲名严格程度排。挑不出就当作没有词 ——
 * 宁可空着。
 *
 * ── 三种结局,不许合并 ──────────────────────────────────────────────────────
 *   · ok    → 有词
 *   · none  → **确实没有词**(纯音乐/没人做过/挑不出对得上的)。界面说一句就好,
 *             **不给重试** —— 重试一万次也还是没有。
 *   · error → 网络/风控。这才是该给重试的那一种。
 */

import { parseLrc, mergeTranslation, readEmbeddedLyrics, type LyricLine } from './lyrics';
import { getTrackBlob } from './local-tracks';
import { parseTrackRef, type TrackRef } from './playlists';

export type LyricsStatus = 'ok' | 'none' | 'error';

export interface LyricsResult {
  status: LyricsStatus;
  lines: LyricLine[];
  /** 'embedded' = mp3 自己带的;'netease' = 搜来的。界面可以据此说一句「歌词来自网易云」。 */
  from: 'embedded' | 'netease' | '';
}

const NONE: LyricsResult = { status: 'none', lines: [], from: '' };
const ERR: LyricsResult = { status: 'error', lines: [], from: '' };

/**
 * 会话内缓存。**不落盘**:歌词一首几 KB,几百首就把 localStorage 那 5 MB 挤掉了,
 * 而挤掉的代价是记忆写不进去(见 storage-health)。切来切去不重复请求,这就够了。
 */
const cache = new Map<TrackRef, LyricsResult>();

export interface LyricsQuery {
  ref: TrackRef;
  title: string;
  artist: string;
  /** 秒。用来卡搜出来那条对不对得上。0 = 还不知道,那就不卡这一道。 */
  durationSec?: number;
}

function norm(s: string): string {
  // 「晴天 (Live)」「晴天【纯音乐】」和「晴天」要能对上;全角括号也要
  return String(s || '')
    .toLowerCase()
    .replace(/[（(\[【].*?[)）\]】]/g, '')
    .replace(/[\s\-_·,.!?、,。!?]/g, '')
    .trim();
}

interface Hit { id: string; title: string; artist: string; durationSec: number }

/**
 * 从搜索结果里挑一首**确实是这一首**的。挑不出返回空 ——
 * 「拿不准就空着」在这里是对的:错的歌词比没有歌词更让人不信任这个 App。
 */
export function pickMatch(hits: readonly Hit[], q: LyricsQuery): string {
  const wantTitle = norm(q.title);
  if (!wantTitle) return '';
  const wantArtist = norm(q.artist);
  const wantSec = Number(q.durationSec) || 0;

  const scored = hits
    .map((h) => {
      const t = norm(h.title);
      if (t !== wantTitle) return null;   // 曲名对不上直接出局,不做模糊
      let score = 0;
      // 时长对得上是最硬的证据(翻唱/现场版几乎一定差几十秒)
      if (wantSec > 0 && h.durationSec > 0) {
        const diff = Math.abs(h.durationSec - wantSec);
        if (diff > 5) return null;        // 差太多:这是另一个版本
        score += 10 - diff;
      }
      if (wantArtist && norm(h.artist).includes(wantArtist)) score += 5;
      // 名字**一字不差**再加一点。不知道时长时这是唯一能把「晴天」和
      // 「晴天 (Live)」分开的东西 —— 剥掉括号之后它们看起来一模一样,
      // 而现场版的词几乎一定跟不上录音室版的时间轴。
      if (String(h.title || '').trim() === String(q.title || '').trim()) score += 3;
      return { id: h.id, score };
    })
    .filter((x): x is { id: string; score: number } => x !== null)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.id || '';
}

async function fetchNeteaseLyric(id: string): Promise<LyricsResult> {
  try {
    const res = await fetch(`/api/portal/music/netease/lyric?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
    const j = await res.json().catch(() => null) as
      { ok?: boolean; lrc?: string; translated?: string } | null;
    if (!res.ok || !j?.ok) return ERR;
    const lines = mergeTranslation(parseLrc(String(j.lrc || '')), String(j.translated || ''));
    // 有响应但没有词 —— 这不是故障,是这一首真的没词
    if (!lines.length) return NONE;
    return { status: 'ok', lines, from: 'netease' };
  } catch {
    return ERR;
  }
}

async function searchNeteaseId(q: LyricsQuery): Promise<{ id: string; failed: boolean }> {
  const term = [q.title, q.artist].filter(Boolean).join(' ').trim();
  if (!term) return { id: '', failed: false };
  try {
    const res = await fetch(`/api/portal/music/netease/search?q=${encodeURIComponent(term)}`, { cache: 'no-store' });
    const j = await res.json().catch(() => null) as { ok?: boolean; hits?: Hit[] } | null;
    if (!res.ok || !j?.ok) return { id: '', failed: true };
    return { id: pickMatch(j.hits || [], q), failed: false };
  } catch {
    return { id: '', failed: true };
  }
}

/**
 * 取这一首的歌词。
 *
 * 本地曲目走的是「自己带的 → 网易」这条链,**不是**「本地就只能没有词」——
 * 用户点名要的正是这个:「本地没歌词的,都用网易歌词,即使是本地歌曲」。
 */
export async function loadLyrics(q: LyricsQuery): Promise<LyricsResult> {
  const cached = cache.get(q.ref);
  // error 不缓存:那是可重试的一种,缓下来用户就再也点不动了
  if (cached && cached.status !== 'error') return cached;

  const parsed = parseTrackRef(q.ref);
  if (!parsed) return NONE;

  let result: LyricsResult = NONE;

  if (parsed.source === 'local') {
    // ① 自己带的。它一定对得上这个文件,优先级最高。
    try {
      const blob = await getTrackBlob(parsed.id);
      if (blob && blob.size > 0) {
        // 只读前 1 MB:ID3 tag 在文件头上,读整首(可能几十 MB)进内存没有必要
        const head = new Uint8Array(await blob.slice(0, 1024 * 1024).arrayBuffer());
        const embedded = readEmbeddedLyrics(head);
        const lines = parseLrc(embedded);
        if (lines.length) result = { status: 'ok', lines, from: 'embedded' };
      }
    } catch { /* 读不出来就往下走网易那条,不是故障 */ }
  }

  if (result.status !== 'ok') {
    if (parsed.source === 'netease') {
      result = await fetchNeteaseLyric(parsed.id);
    } else {
      // ② 本地没带词的:拿曲名去搜一首同名的
      const found = await searchNeteaseId(q);
      if (found.failed) result = ERR;
      else if (!found.id) result = NONE;      // 搜不到 / 挑不出对得上的 = 就是没有词
      else result = await fetchNeteaseLyric(found.id);
    }
  }

  if (result.status !== 'error') cache.set(q.ref, result);
  return result;
}

/** 换了源/重新导入之后清掉,免得还拿着上一份。 */
export function clearLyricsCache(ref?: TrackRef): void {
  if (ref) cache.delete(ref); else cache.clear();
}
