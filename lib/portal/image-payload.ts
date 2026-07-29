/**
 * image-payload — 把一张图缩到「能发出去」的尺寸(2026-07-29)。
 *
 * 真实故障:念念里传一张 iPhone 原图,回「图片识别失败,请重试。」
 * 根因不在识别,在**根本没发到**:三个传图入口都是 readAsDataURL(file) 直接把原文件
 * base64 发出去。iPhone 一张原图 3–5 MB,base64 再涨 1.33 倍 ≈ 4–6.7 MB,
 * 越过 Vercel serverless 的 4.5 MB 请求体上限 → 413,而 413 的响应体不是 JSON,
 * r.json() 当场抛错 → 落进 .catch() → 那句「识别失败」。
 * 「以前成功过一次」也就说得通了:那次那张图小。
 *
 * 相机路径一直是先缩再发的(CameraSheet 的 compressImage),只是聊天这三处没走。
 * 判据收到这里一份,谁要把图发给服务端就调它。
 *
 * 契约:scripts/image-payload.test.mjs。
 */

/** 服务端能收的上限。Vercel serverless 请求体 4.5 MB,留出 JSON 包装和别的字段的余量。 */
export const MAX_UPLOAD_BASE64_BYTES = 3_000_000;

/** 长边上限。识别用不着原图分辨率 —— 1600 已经比模型实际看的还大。 */
const MAX_DIM = 1600;

export interface ImagePayload {
  /** 纯 base64(不含 data: 前缀),可直接进 body.imageBase64 */
  base64: string;
  mimeType: string;
  /** 缩完的字节数,用来判断还超不超 */
  bytes: number;
}

/**
 * 读一个图片文件 → 缩到可发送的 JPEG base64。
 *
 * 先按长边缩,再按体积降 quality;两条都走完还超,就抛 —— **不静默截断**,
 * 上层要能把「这张实在太大」说给用户听,而不是又变成一句「识别失败」。
 */
export async function fileToUploadPayload(file: File): Promise<ImagePayload> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) { bmp.close?.(); throw new Error('canvas_unavailable'); }
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();

  let quality = 0.85;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length > MAX_UPLOAD_BASE64_BYTES && quality > 0.3) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  const base64 = dataUrl.split(',')[1] || '';
  if (!base64) throw new Error('encode_failed');
  if (base64.length > MAX_UPLOAD_BASE64_BYTES) throw new Error('too_large');
  return { base64, mimeType: 'image/jpeg', bytes: base64.length };
}

/**
 * 同上,但入口是 dataURL —— 记忆详情的「问一问这张图」走的是这条(图来自本机图库,
 * 同样可能是原图尺寸)。已经够小就原样返回,不做无谓的重新编码。
 */
export async function dataUrlToUploadPayload(dataUrl: string): Promise<ImagePayload> {
  const base64 = dataUrl.split(',')[1] || '';
  const mimeType = dataUrl.match(/:(.*?);/)?.[1] || 'image/jpeg';
  if (base64 && base64.length <= MAX_UPLOAD_BASE64_BYTES) return { base64, mimeType, bytes: base64.length };
  const blob = await (await fetch(dataUrl)).blob();
  return fileToUploadPayload(new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' }));
}

/**
 * 把一次识别请求的失败翻译成人话。
 *
 * 之前三处都是 `.catch(() => '图片识别失败,请重试。')` —— 断网、图太大、服务端 500
 * 全说同一句,而这三件事用户能做的完全不同(等一下 / 换张小图 / 过会儿再来)。
 * 一句话包住所有失败,等于什么都没说。
 */
export function describeUploadFailure(err: unknown, zh: boolean): string {
  const msg = err instanceof Error ? err.message : String(err || '');
  if (msg === 'too_large' || msg === 'encode_failed') {
    return zh ? '这张图太大了,发不过去 —— 换一张小一点的,或者用相机拍一张。'
      : 'This photo is too large to send — try a smaller one, or take one with the camera.';
  }
  if (msg === 'canvas_unavailable') {
    return zh ? '这台设备处理不了这张图 —— 换一张试试。'
      : 'This device could not process the photo — try another one.';
  }
  if (/fetch|network|load failed|networkerror/i.test(msg)) {
    return zh ? '网络没连上 —— 网络回来以后再发一次。'
      : 'No connection — send it again once you are back online.';
  }
  return zh ? '这次没认出来 —— 过一会儿再试一次。' : 'That did not go through — try again in a moment.';
}
