/**
 * 行为契约:发给服务端的图必须先缩(2026-07-29,用户实测「问问传图片已经不能用了」)。
 *
 * 根因不在识别,在**根本没发到**:念念的四个传图入口都是把原文件 base64 直接塞进 body。
 * iPhone 一张原图 3–5 MB,base64 再涨 1.33 倍 ≈ 4–6.7 MB,越过 Vercel serverless 的
 * 4.5 MB 请求体上限 → 413。而 413 的响应体是 HTML 不是 JSON,`r.json()` 当场抛错 →
 * 落进 `.catch()` → 显示「图片识别失败,请重试。」重试当然也没用,因为图还是那么大。
 * 「以前成功过一次」也说得通:那次那张图小。
 *
 * 相机路径(CameraSheet.compressImage)一直是先缩再发的 —— 病根是**同一件事有两套做法**,
 * 而只有一套是对的。判据收进 lib/portal/image-payload.ts,四处共用。
 *
 * 这条测试钉三件事:
 *   ① 缩图判据存在,且真的按「长边 + 体积」两道收;
 *   ② 每个把图发给 /api/portal/analyze 的地方都过了这道判据;
 *   ③ 失败不再是一句话包住所有情况 —— 太大 / 断网 / 服务端出错,用户能做的不一样。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const code = stripComments;

// ── ① 判据本身 ──────────────────────────────────────────────────────────────
{
  const src = code(read('lib/portal/image-payload.ts'));
  const cap = /MAX_UPLOAD_BASE64_BYTES = ([0-9_]+)/.exec(src);
  assert.ok(cap, '上限常量不见了');
  const bytes = Number(cap[1].replace(/_/g, ''));
  assert.ok(
    bytes > 0 && bytes < 4_500_000,
    `上限 ${bytes} 没留在 Vercel 的 4.5MB 请求体限制之下 —— 顶着上限设等于没设,JSON 包装和别的字段还要占位置`,
  );
  // 两道收:先按长边缩(省的是大头),再按 quality 降(收尾)。少任何一道都会有图漏过去。
  assert.ok(/MAX_DIM/.test(src) && /Math\.min\(1, MAX_DIM \/ Math\.max/.test(src), '没有按长边缩');
  assert.ok(
    /while \(dataUrl\.length > MAX_UPLOAD_BASE64_BYTES && quality > /.test(src),
    '没有按体积降 quality —— 一张长边不大但极复杂的图仍可能超限',
  );
  // 两道都走完还超,必须**抛**。静默截断 = 又回到「发出去但服务端收不全」。
  assert.ok(
    /if \(base64\.length > MAX_UPLOAD_BASE64_BYTES\) throw new Error\('too_large'\)/.test(src),
    '缩不下来时没有抛错 —— 静默发一张超限的图,用户又只会看到一句「识别失败」',
  );
}

// ── ② 每处传图都过判据 ──────────────────────────────────────────────────────
// 判据是「谁把 imageBase64 发给 analyze,谁就得先过缩图」。
// 用「这一行前面 40 行内出现过缩图函数」来判,比数调用次数稳 —— 加一处新入口会当场红。
{
  const chat = code(read('components/portal/NesioChatSheet.tsx'));
  const lines = chat.split('\n');
  const senders = [];
  lines.forEach((ln, i) => { if (/imageBase64:/.test(ln)) senders.push(i); });
  assert.ok(senders.length >= 4, `念念里发图的地方只剩 ${senders.length} 处 —— 少了就该更新这条契约`);
  for (const i of senders) {
    const before = lines.slice(Math.max(0, i - 40), i).join('\n');
    assert.ok(
      /fileToUploadPayload|dataUrlToUploadPayload/.test(before),
      `念念第 ${i + 1} 行把图发出去之前没过缩图判据 —— 原图会 413,而用户看到的是「识别失败」`,
    );
  }
  assert.ok(
    !/readAsDataURL/.test(chat),
    '念念里又出现了 readAsDataURL —— 那条路绕过缩图,直接把原文件发出去',
  );
}

// ── ③ 失败态要分得开 ────────────────────────────────────────────────────────
{
  const src = code(read('lib/portal/image-payload.ts'));
  for (const [what, re] of [
    ['太大', /too_large/],
    ['断网', /fetch\|network/],
    ['其它', /return zh \? '这次没认出来/],
  ]) {
    assert.ok(re.test(src), `失败文案里没有「${what}」这一档 —— 一句话包住所有失败等于什么都没说`);
  }
  const chat = code(read('components/portal/NesioChatSheet.tsx'));
  assert.ok(
    !/图片识别失败，请重试/.test(chat),
    '念念里还留着那句「图片识别失败，请重试。」—— 它把「图太大」也说成了「识别失败」,'
    + '于是用户重试一百次都还是那张图、还是那么大',
  );
  // 四个入口里三个自己处理失败;第四个(handleFile)把结果交给 analyze(),
  // 失败态由那条流程自己的 onResult 管 —— 所以这里是 3 不是 4。
  const uses = (chat.match(/describeUploadFailure\(/g) || []).length;
  assert.equal(uses, 3, `用分档文案的地方是 ${uses} 处,应该是 3(第四处走 analyze 自己的失败态)`);
}

console.log('image-payload: OK(先缩再发 · 四处入口都过 · 失败分得开)');
