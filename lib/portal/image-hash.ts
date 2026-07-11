/**
 * image-hash — 端上视觉指纹(批次 87,用户批准的「以图搜图」v1)。
 *
 * dHash(差值哈希):缩到 9×8 灰度,相邻像素比大小 → 64 位指纹(16 字符 hex)。
 * 对缩放/压缩/轻微裁剪稳健,计算 <5ms,零依赖。索引存 localStorage
 * (nodeId → hash,每条 16 字符,千张图 ~20KB)。汉明距离 ≤12/64 视为相似。
 * 向前生效:新存的照片建索引;存量图不回填(等批量导入需求再做)。
 */

export async function computeDHash(source: Blob | string): Promise<string | null> {
  try {
    const bmp = typeof source === 'string'
      ? await dataUrlToBitmap(source)
      : await createImageBitmap(source);
    if (!bmp) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 9; canvas.height = 8;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, 9, 8);
    (bmp as ImageBitmap).close?.();
    const { data } = ctx.getImageData(0, 0, 9, 8);
    const gray: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
    let hash = '';
    let nibble = 0; let bits = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const bit = gray[y * 9 + x] > gray[y * 9 + x + 1] ? 1 : 0;
        nibble = (nibble << 1) | bit;
        bits += 1;
        if (bits === 4) { hash += nibble.toString(16); nibble = 0; bits = 0; }
      }
    }
    return hash;
  } catch {
    return null;
  }
}

async function dataUrlToBitmap(dataUrl: string): Promise<ImageBitmap | null> {
  // 不用 fetch(dataUrl) —— CSP connect-src 会拦 data: 请求(浏览器实测)。
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = dataUrl;
    await img.decode();
    return await createImageBitmap(img);
  } catch {
    return null;
  }
}

/** 两个 hex 指纹的汉明距离(0-64;≤12 视为图像相似)。 */
export function hammingHex(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

// ── 指纹索引(nodeId → hash) ──
const INDEX_KEY = 'nesio-img-hash-v1';

function loadIndex(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '{}') as Record<string, string>; } catch { return {}; }
}

export function saveImageHash(nodeId: string, hash: string): void {
  if (typeof window === 'undefined' || !nodeId || !hash) return;
  try {
    const idx = loadIndex();
    idx[nodeId] = hash;
    // 千条封顶:超了裁最旧的一批(对象键序即插入序)
    const keys = Object.keys(idx);
    if (keys.length > 1200) for (const k of keys.slice(0, 200)) delete idx[k];
    localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
  } catch { /* 配额满不拦保存 */ }
}

/** 按图像相似度召回:返回 [nodeId, 距离] 升序,距离 ≤ maxDist。 */
export function searchByHash(hash: string, maxDist = 12): Array<[string, number]> {
  const idx = loadIndex();
  const out: Array<[string, number]> = [];
  for (const [nodeId, h] of Object.entries(idx)) {
    const d = hammingHex(hash, h);
    if (d <= maxDist) out.push([nodeId, d]);
  }
  return out.sort((a, b) => a[1] - b[1]).slice(0, 8);
}
