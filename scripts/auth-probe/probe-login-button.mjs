/**
 * 验登录按钮的三条退路(改动④)。全部靠拦截 /api/auth/start 造失败态,
 * 不需要任何真凭据 —— 要验的是「按钮会不会卡死」,不是 Google 会不会答。
 */
import { chromium } from 'playwright';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

async function scenario(name, handler, waitMs) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.route('**/api/auth/start', handler);

  await p.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
  const btn = p.locator('.nesio-ob-auth-btn--google');
  await btn.waitFor({ timeout: 10000 });
  const t0 = Date.now();
  await btn.click();
  await p.waitForTimeout(waitMs);
  const disabled = await btn.isDisabled();
  // 直接读错误元素,别拿关键词去筛正文 —— 第一版用关键词筛,把
  //「登录服务还没有配置好」漏掉了,差点当成产品没给提示。
  const err = await p.$$eval('.nesio-ob-error', (els) => els.map((e) => e.textContent.trim()));
  console.log(`${name}`);
  console.log(`  等了 ${((Date.now() - t0) / 1000).toFixed(1)}s → 按钮${disabled ? '仍然禁用 ✗' : '恢复可点 ✓'}`);
  console.log(`  提示: ${err.length ? err.join(' / ') : '(没有任何提示 ✗)'}`);
  await p.close();
}

// ① start 一直不回 → 10 秒超时兜底
await scenario('① /api/auth/start 挂死不回(验 10s 超时)',
  async (route) => { await new Promise((r) => setTimeout(r, 60_000)); route.abort(); }, 13_000);

// ② start 说 ok 但没给 url → no_redirect_url 文案
await scenario('② 服务端说 ok 却没给跳转地址',
  (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }), 2_000);

// ③ 给了 url,但跳转到不了(拦掉目标)→ 12 秒兜底
await scenario('③ 拿到 url 但跳不过去(验 12s 兜底)',
  // 用**未注册的 scheme**来造「跳转指令发出去了、浏览器没跳」这一档:页面原地不动,
  // 12s 定时器才有机会跑。试过两种不行的:跳不存在的域名 / route.abort() —— 那两种
  // Chromium 都会换成错误页,原文档卸载,定时器跟着一起没,根本测不到这条退路。
  (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: 'nesio-no-such-scheme://oauth' }) }), 14_000);

// ④ 对照:服务端明确报错 —— 本来就该给可点的错误
await scenario('④ 对照组:服务端 503 provider_not_configured',
  (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'provider_not_configured' }) }), 1_500);

await b.close();
