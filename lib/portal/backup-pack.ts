/**
 * 备份打包口径:一律「JSON 放进 gzip 压缩包」(.json.gz)。
 * Google Drive 与本机导出共用,避免再出现明文 .json 让人误以为没有照片。
 */
import { gzip, gunzip, strToU8, strFromU8 } from 'fflate';

function gzipAsync(u8: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => gzip(u8, (err, out) => (err ? reject(err) : resolve(out))));
}

function gunzipAsync(u8: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => gunzip(u8, (err, out) => (err ? reject(err) : resolve(out))));
}

export const BACKUP_GZ_MIME = 'application/gzip';
export const BACKUP_GZ_EXT = '.json.gz';

/** 把备份对象压成 .json.gz Blob。 */
export async function packBackupGzip(backup: unknown): Promise<{ blob: Blob; bytes: number }> {
  const gz = await gzipAsync(strToU8(JSON.stringify(backup)));
  // 拷一份 ArrayBuffer,避免 SharedArrayBuffer/子视图类型在 BlobPart 上不通过。
  const copy = new Uint8Array(gz.byteLength);
  copy.set(gz);
  const blob = new Blob([copy], { type: BACKUP_GZ_MIME });
  return { blob, bytes: copy.byteLength };
}

/**
 * 读入备份文件:支持 .json.gz(推荐)与旧明文 .json。
 * 返回解析后的对象;失败抛错。
 */
export async function parseBackupFile(file: File | Blob): Promise<unknown> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const name = (file instanceof File ? file.name : '') || '';
  const looksGz = name.endsWith('.gz')
    || (file.type || '').includes('gzip')
    || (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b);

  let text: string;
  if (looksGz) {
    text = strFromU8(await gunzipAsync(buf));
  } else {
    text = strFromU8(buf);
  }
  return JSON.parse(text) as unknown;
}
