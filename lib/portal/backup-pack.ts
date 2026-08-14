/**
 * 备份打包口径:ZIP 压缩包 = nesio-backup.json + photos/*.jpg。
 * 解压就能看见照片文件;导入/Drive 恢复时再把 jpg 装回 local-image:。
 * 仍兼容旧的 .json.gz(照片嵌在 JSON)与明文 .json。
 */
import { gzip, gunzip, zip, unzip, strToU8, strFromU8 } from 'fflate';

const PHOTO_PREFIX = 'local-image:';

function gzipAsync(u8: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => gzip(u8, (err, out) => (err ? reject(err) : resolve(out))));
}

function gunzipAsync(u8: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => gunzip(u8, (err, out) => (err ? reject(err) : resolve(out))));
}

function zipAsync(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

function unzipAsync(u8: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(u8, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

export const BACKUP_ZIP_MIME = 'application/zip';
export const BACKUP_ZIP_EXT = '.zip';
/** @deprecated 旧名,导出已改 zip */
export const BACKUP_GZ_MIME = 'application/gzip';
export const BACKUP_GZ_EXT = '.json.gz';

function copyU8(u8: Uint8Array): Uint8Array {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy;
}

function safePhotoFileName(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'photo';
}

function dataUrlToJpegBytes(dataUrl: string): Uint8Array | null {
  const m = /^data:image\/[a-zA-Z0-9+.-]+;base64,([\s\S]+)$/.exec(dataUrl);
  if (!m) return null;
  try {
    const bin = atob(m[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function bytesToJpegDataUrl(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/jpeg;base64,${btoa(bin)}`;
}

type BackupLike = {
  format?: string;
  version?: number;
  exportedAt?: string;
  entries?: Record<string, string>;
};

/**
 * 把完整备份(含 local-image: dataURL)打成 ZIP:
 *   nesio-backup.json  —— 文字/流水等(照片键改为占位,避免 JSON 再塞一份 base64)
 *   photos/{id}.jpg    —— 可直接打开的照片
 *   请读我.txt
 */
export async function packBackupZip(backup: BackupLike): Promise<{ blob: Blob; bytes: number; photoCount: number }> {
  const entries = { ...(backup.entries || {}) };
  const zipFiles: Record<string, Uint8Array> = {};
  let photoCount = 0;

  for (const [key, value] of Object.entries(entries)) {
    if (!key.startsWith(PHOTO_PREFIX) || typeof value !== 'string') continue;
    const id = key.slice(PHOTO_PREFIX.length);
    const jpeg = dataUrlToJpegBytes(value);
    if (!jpeg) continue;
    const fileName = `photos/${safePhotoFileName(id)}.jpg`;
    zipFiles[fileName] = jpeg;
    // JSON 里只留占位,恢复时从 photos/ 装回
    entries[key] = `zip-photo:${safePhotoFileName(id)}.jpg`;
    photoCount += 1;
  }

  const jsonBody = {
    ...backup,
    entries,
  };
  zipFiles['nesio-backup.json'] = strToU8(JSON.stringify(jsonBody));
  zipFiles['请读我.txt'] = strToU8(
    '宝盒 / Nesio 备份\n\n' +
      '· nesio-backup.json —— 记忆、设置、流水等文字数据\n' +
      '· photos/ —— 照片(可直接打开)\n\n' +
      '换机恢复:在宝盒设置里点「导入」,选这个 .zip。\n' +
      '不要只拷贝 json 而丢掉 photos 文件夹。\n',
  );

  const zipped = await zipAsync(zipFiles);
  const copy = copyU8(zipped);
  return {
    blob: new Blob([copy], { type: BACKUP_ZIP_MIME }),
    bytes: copy.byteLength,
    photoCount,
  };
}

/** @deprecated 旧 gzip 路径;新代码用 packBackupZip */
export async function packBackupGzip(backup: unknown): Promise<{ blob: Blob; bytes: number }> {
  const gz = await gzipAsync(strToU8(JSON.stringify(backup)));
  const copy = copyU8(gz);
  return { blob: new Blob([copy], { type: BACKUP_GZ_MIME }), bytes: copy.byteLength };
}

function looksLikeZip(buf: Uint8Array, name: string, type: string): boolean {
  if (name.endsWith('.zip')) return true;
  // 勿用 type.includes('zip') —— application/gzip 也会误中
  if (type === 'application/zip' || type === 'application/x-zip-compressed') return true;
  // PK\x03\x04
  return buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07);
}

function looksLikeGzip(buf: Uint8Array, name: string, type: string): boolean {
  if (name.endsWith('.gz') || type.includes('gzip')) return true;
  return buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

async function hydratePhotosFromZip(
  backup: BackupLike,
  files: Record<string, Uint8Array>,
): Promise<BackupLike> {
  const entries = { ...(backup.entries || {}) };
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.startsWith('photos/') || !/\.jpe?g$/i.test(path)) continue;
    const base = path.slice('photos/'.length).replace(/\.jpe?g$/i, '');
    // 找回原 assetId:若 JSON 里有 zip-photo 占位则对上;否则用文件名
    let assetId = base;
    for (const [k, v] of Object.entries(entries)) {
      if (!k.startsWith(PHOTO_PREFIX)) continue;
      if (v === `zip-photo:${base}.jpg` || v === `zip-photo:${safePhotoFileName(k.slice(PHOTO_PREFIX.length))}.jpg`) {
        assetId = k.slice(PHOTO_PREFIX.length);
        break;
      }
    }
    // 若占位键已在 entries,用其 id;否则新建 local-image:base
    const key = `${PHOTO_PREFIX}${assetId}`;
    entries[key] = bytesToJpegDataUrl(bytes);
  }
  // 清掉仍是占位、没对上文件的键
  for (const [k, v] of Object.entries(entries)) {
    if (k.startsWith(PHOTO_PREFIX) && typeof v === 'string' && v.startsWith('zip-photo:')) {
      delete entries[k];
    }
  }
  return { ...backup, entries };
}

/**
 * 读入备份:支持 .zip(推荐)、.json.gz、明文 .json。
 */
export async function parseBackupFile(file: File | Blob): Promise<unknown> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const name = (file instanceof File ? file.name : '') || '';
  const type = file.type || '';

  if (looksLikeZip(buf, name, type)) {
    const files = await unzipAsync(buf);
    const jsonFile =
      files['nesio-backup.json']
      || files['backup.json']
      || Object.entries(files).find(([p]) => p.endsWith('.json') && !p.includes('/'))?.[1];
    if (!jsonFile) throw new Error('zip_missing_json');
    const backup = JSON.parse(strFromU8(jsonFile)) as BackupLike;
    return hydratePhotosFromZip(backup, files);
  }

  let text: string;
  if (looksLikeGzip(buf, name, type)) {
    text = strFromU8(await gunzipAsync(buf));
  } else {
    text = strFromU8(buf);
  }
  return JSON.parse(text) as unknown;
}
