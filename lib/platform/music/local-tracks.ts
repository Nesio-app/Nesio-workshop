/**
 * 本地歌曲库(2026-07-30)。四个音源里**唯一今天就能出声**的那个 ——
 * 不要账号、不要订阅、不看网络出口,文件在机器上就能放。
 *
 * 结构照 local-file-store 的骨架(同一副:IDB 存 Blob、localStorage 存元数据),
 * 但**不共用**它那个 DB,两处有意分开:
 *   · 体积档次不同。附件上限 25MB 是给 pdf 定的;一首无损动辄 40MB+,
 *     套用附件的限额会让用户「导了一半的歌莫名其妙不见」。
 *   · 生命周期不同。附件跟着记忆条目走(记忆删了附件跟着删),歌是独立曲库。
 *
 * ── 为什么元数据是 cache 而不是 durable ────────────────────────────────────
 * 直觉上「我导进来的歌单」像用户数据。但音频 Blob **不进备份**(几百 MB 的备份
 * JSON 没有意义,也传不上去),所以元数据同步到另一台设备的结果是:
 * 那台设备上出现一份**点了放不出声**的曲目列表 —— 比没有更糟。
 * 判据(仓里那句):「换台设备从零开始是否正确?」—— 是的,因为文件本来就没过去。
 * 所以 cache。曲库要跨设备,靠的是把文件也带过去,不是把列表偷偷同步过去。
 */

import { logDropped, reportStorageDropped } from '@/lib/portal/storage-health';
import type { MusicLocale } from './source-catalog';

const DB_NAME = 'nesio-music';
const STORE = 'tracks';

/** 元数据键。cache 类,理由见文件头。必须在 scripts/storage-key-registry.test.mjs 登记。 */
export const LOCAL_TRACKS_KEY = 'nesio-music-local-tracks-v1';

/**
 * 单曲上限。比附件的 25MB 宽 —— 无损/长音频是正常需求。
 * 超了**明确拒收**,不截断:截断的音频是坏文件,放到一半戛然而止比没导进来更让人困惑。
 */
export const MAX_TRACK_BYTES = 80 * 1024 * 1024;

/** 常见音频扩展名。认得出就直接收。 */
const AUDIO_EXT = /\.(mp3|m4a|m4b|mp4a|aac|flac|wav|wave|ogg|oga|opus|aiff?|aif|wma|alac|ape|dsf|dff|mka|amr|caf|3gp)$/i;

/** 一眼就知道**不是**音频的。只挡这几类,别的一律让它进来试。 */
const NOT_AUDIO_TYPE = /^(image|video|text)\//i;
const NOT_AUDIO_EXT = /\.(jpe?g|png|gif|heic|heif|webp|bmp|svg|mov|mp4|m4v|avi|mkv|webm|pdf|docx?|xlsx?|pptx?|zip|rar|7z|txt|md|csv|json)$/i;

export interface LocalTrack {
  id: string;
  title: string;
  /** 取不到就空串。**不猜**、不填「未知艺术家」—— 界面自己决定空的时候怎么显示。 */
  artist: string;
  /** 秒。0 = 还没读出来(元数据要等 audio 元素加载才知道)。 */
  durationSec: number;
  sizeBytes: number;
  mimeType: string;
  fileName: string;
  addedAt: number;
}

/**
 * 这个文件收不收进曲库。
 *
 * 2026-07-31 实测「本地音乐无法识别任何格式,无法上传」之后翻过来写:
 * 原来是**白名单**(type 以 audio/ 开头,或扩展名在表里),别的一律拒。
 * 在 iOS 上这一条几乎必然踩空 —— 「文件」App 交出来的 File 常常
 * `type` 是空串,而 iCloud Drive 同步下来的文件名可能连扩展名都没有。
 * 于是每一个都被判成「看着不像音频」,一首都进不来。
 *
 * 现在改成**只挡明显不是的**(图片/视频/文档),其余一律收下 ——
 * 到底能不能解码,由 audio 元素说了算,不由我在这里猜。
 * 猜错的代价不对称:误收一个放不出声的文件,用户删掉就是了;
 * 误拒一首真的歌,他根本不知道为什么、也没有别的路可走。
 */
export function isAudioFile(file: { name?: string; type?: string }): boolean {
  const type = String(file?.type || '');
  const name = String(file?.name || '');
  if (type.startsWith('audio/')) return true;
  if (AUDIO_EXT.test(name)) return true;
  // 明确不是音频的挡掉;剩下的(type 空 + 扩展名不认识)让它进来试。
  if (NOT_AUDIO_TYPE.test(type) || NOT_AUDIO_EXT.test(name)) return false;
  return true;
}

/**
 * 从文件名猜「艺术家 - 曲名」。只认最常见的那一种排布,认不出就整名当曲名。
 * 刻意不做更聪明的解析:猜错了艺术家比不填更烦人,而用户可以自己改。
 */
export function parseTrackName(fileName: string): { title: string; artist: string } {
  const base = String(fileName || '').replace(/\.[^.]+$/, '').trim();
  const m = base.match(/^(.{1,60}?)\s+-\s+(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: '', title: base || fileName };
}

export function prettyDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '--:--';
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/* ── 元数据(localStorage)────────────────────────────────────────────────── */

export function loadLocalTracks(): LocalTrack[] {
  if (typeof window === 'undefined') return [];
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_TRACKS_KEY) || '[]') as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((t): t is LocalTrack => !!t && typeof (t as LocalTrack).id === 'string');
  } catch { return []; }
}

function saveLocalTracks(list: readonly LocalTrack[]): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(LOCAL_TRACKS_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    // 红线:存储写失败不许哑吞。元数据没写进去 = 音频躺在 IDB 里但曲库看不见它。
    logDropped('music.tracks.save', e);
    reportStorageDropped();
    return false;
  }
}

/* ── 音频本体(IndexedDB)──────────────────────────────────────────────────── */

function openDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export interface ImportResult {
  ok: boolean;
  track?: LocalTrack;
  /** 失败原因,直接可以显示给用户 —— 红线:每个异步动作都要有可见失败态。 */
  error?: string;
}

const IMPORT_COPY = {
  zh: {
    notAudio: (n: string) => `「${n}」看着不像音频文件,先跳过了。`,
    tooBig: (n: string, mb: number) => `「${n}」超过 ${mb}MB,这一首先留在原处吧。`,
    noStore: '这台设备的本机存储用不了,歌暂时存不下来。',
    writeFailed: (n: string) => `「${n}」没存下来 —— 多半是设备空间满了。`,
    metaFailed: (n: string) => `「${n}」的曲目信息没记下来,这一首没能加进去。`,
  },
  en: {
    notAudio: (n: string) => `“${n}” does not look like an audio file, so it was skipped.`,
    tooBig: (n: string, mb: number) => `“${n}” is over ${mb}MB — leaving that one where it is.`,
    noStore: 'This device will not let us store files, so the track could not be saved.',
    writeFailed: (n: string) => `“${n}” did not save — most likely the device is out of space.`,
    metaFailed: (n: string) => `“${n}” could not be recorded in the library, so it was not added.`,
  },
} as const;

/**
 * 导入一首歌。任何一步失败都**返回原因**,不返回 false 了事:
 * 「按了没反应」的 bug 全出在这种地方。
 */
export async function importLocalTrack(file: File, locale: MusicLocale = 'zh'): Promise<ImportResult> {
  const c = locale === 'en' ? IMPORT_COPY.en : IMPORT_COPY.zh;
  if (!isAudioFile(file)) {
    return { ok: false, error: c.notAudio(file.name) };
  }
  if (file.size > MAX_TRACK_BYTES) {
    return { ok: false, error: c.tooBig(file.name, Math.round(MAX_TRACK_BYTES / 1024 / 1024)) };
  }
  const db = await openDB();
  if (!db) return { ok: false, error: c.noStore };

  const { title, artist } = parseTrackName(file.name);
  const id = `lt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const track: LocalTrack = {
    id, title, artist,
    durationSec: 0,
    sizeBytes: file.size,
    mimeType: file.type || 'audio/mpeg',
    fileName: file.name,
    addedAt: Date.now(),
  };

  const stored = await new Promise<boolean>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(file, id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => {
      logDropped('music.track.put', tx.error);
      reportStorageDropped();
      resolve(false);
    };
  });
  if (!stored) return { ok: false, error: c.writeFailed(file.name) };

  if (!saveLocalTracks([...loadLocalTracks(), track])) {
    // 音频进去了、列表没写上:这条歌会变成看不见的孤儿。当场删掉,别留垃圾。
    await deleteLocalTrack(id, { metaOnly: false });
    return { ok: false, error: c.metaFailed(file.name) };
  }
  return { ok: true, track };
}

/** 拿音频本体。返回 null = 文件不在了(用户清过浏览器数据),调用方要把这事说出来。 */
export async function getTrackBlob(id: string): Promise<Blob | null> {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as Blob) ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function deleteLocalTrack(id: string, opts: { metaOnly?: boolean } = {}): Promise<void> {
  if (!opts.metaOnly) {
    const db = await openDB();
    if (db) {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
  }
  saveLocalTracks(loadLocalTracks().filter((t) => t.id !== id));
}

/** 时长要等 audio 元素读出来才知道,读到了补回去 —— 只补这一个字段,别整条覆盖。 */
export function setTrackDuration(id: string, durationSec: number): void {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return;
  const list = loadLocalTracks();
  const i = list.findIndex((t) => t.id === id);
  if (i < 0 || list[i].durationSec === Math.round(durationSec)) return;
  list[i] = { ...list[i], durationSec: Math.round(durationSec) };
  saveLocalTracks(list);
}

export function renameLocalTrack(id: string, title: string, artist: string): void {
  const list = loadLocalTracks();
  const i = list.findIndex((t) => t.id === id);
  if (i < 0) return;
  list[i] = { ...list[i], title: title.trim() || list[i].title, artist: artist.trim() };
  saveLocalTracks(list);
}

/**
 * 清空整个本地曲库。**收口点**:「删除全部数据」/切账号/登出都要调它 ——
 * 这个仓栽过一模一样的跟头(照片只清了索引,图片留在设备上,用户以为删了其实没删)。
 */
export async function purgeLocalTracks(): Promise<number> {
  const n = loadLocalTracks().length;
  const db = await openDB();
  if (db) {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
  if (typeof window !== 'undefined') {
    try { localStorage.removeItem(LOCAL_TRACKS_KEY); } catch { /* 清不掉下次再清 */ }
  }
  return n;
}

/**
 * 曲库有几首、占多大。给面板抬头用 —— 「12 首 · 340MB」比光说「12 首」有用:
 * 本地曲库的真实代价是设备空间,该让用户看见。
 */
export function libraryHeadline(tracks: readonly LocalTrack[]): { count: number; bytes: number } {
  return { count: tracks.length, bytes: tracks.reduce((s, t) => s + (t.sizeBytes || 0), 0) };
}
