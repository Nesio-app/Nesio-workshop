/**
 * 行为契约:Stripe 订阅支付(美国市场 Web 收费 —— 功能分层报告「上线前必闭 #3」)。
 * 锁死(源断言,支付/验签依赖网络与真密钥,锁关键安全不变量防回归):
 *  - 默认休眠:未配 STRIPE_* → checkout 503、webhook 503(没配 = 没接 Stripe,不误导)。
 *  - checkout:登录 gate(匿名 401,防刷);订阅模式 + client_reference_id 认领账号。
 *  - webhook:HMAC-SHA256 验签 + 常量时间比对 + 时效窗(防重放);验不过一律 400 不写库。
 *  - 收据 → writeEntitlementByUid 写 plan;merge-duplicates 不覆盖 trial_started_at。
 *  - 会员页:checkout 503 优雅降级为 waitlist(现网无支付时不误导)。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

// ── checkout ──
const checkout = read('../app/api/billing/checkout/route.ts');
assert.match(checkout, /!secret \|\| !priceId[\s\S]*billing_not_configured[\s\S]*503/, '未配 → 503 休眠');
assert.match(checkout, /getSupabaseUserId\(accessToken\)/, '取真实 uid');
assert.match(checkout, /if \(!uid\)[\s\S]*not_signed_in[\s\S]*401/, '匿名 → 401(防刷)');
assert.match(checkout, /mode', 'subscription'/, '订阅模式');
assert.match(checkout, /client_reference_id', uid/, 'client_reference_id 认领账号');
assert.match(checkout, /line_items\[0\]\[price\]', priceId/, '用 STRIPE_PRICE_ID(真实金额在 Stripe 后台)');
assert.match(checkout, /api\.stripe\.com\/v1\/checkout\/sessions/, '调 Stripe Checkout API');

// ── webhook ──
const webhook = read('../app/api/billing/webhook/route.ts');
assert.match(webhook, /STRIPE_WEBHOOK_SECRET[\s\S]*503/, '未配 secret → 503');
assert.match(webhook, /createHmac\('sha256', secret\)\.update\(`\$\{t\}\.\$\{payload\}`\)/, 'HMAC-SHA256(secret, t.body)');
assert.match(webhook, /timingSafeEqual/, '常量时间比对(防时序侧信道)');
assert.match(webhook, /Math\.abs\(Date\.now\(\) \/ 1000 - ts\) > 300/, '5 分钟时效窗(防重放)');
assert.match(webhook, /if \(!verifyStripeSignature\([\s\S]*bad_signature[\s\S]*400/, '验不过 → 400,不写库');
assert.match(webhook, /await req\.text\(\)/, '读原始 body(验签需要)');
assert.match(webhook, /checkout\.session\.completed[\s\S]*plan: 'pro'/, '结账完成 → plan pro');
assert.match(webhook, /status === 'active' \|\| status === 'trialing'/, '订阅 active/trialing → pro,否则 free');
assert.match(webhook, /received: true/, '处理后回 200(避免 Stripe 重试风暴)');

// ── 权益写入 ──
const se = read('../lib/portal/auth/server-entitlement.ts');
assert.match(se, /export async function writeEntitlementByUid/, '按 uid 写权益');
assert.match(se, /resolution=merge-duplicates/, 'merge-duplicates:只覆盖传入列,不动 trial_started_at');

// ── 会员页降级 ──
const settings = read('../components/portal/SettingsSheets.tsx');
assert.match(settings, /\/api\/billing\/checkout/, '会员页调 checkout');
assert.match(settings, /window\.location\.href = data\.url/, '成功 → 跳转 Stripe');
assert.match(settings, /optIn\(\);[\s\S]*503 真·未配/, '503 真·未配 → 降级 waitlist');
assert.match(settings, /stripe_checkout_failed[\s\S]{0,80}setBillingError/, '502 拒结账 → 显真错因(不静默当 waitlist)');

// checkout 路由把 Stripe 真错因透出(诊断:否则付费为何不通谁也看不见)
assert.match(checkout, /logDropped\('billing\.checkout'/, 'Stripe 拒结账记 Vercel 日志');
assert.match(checkout, /detail: data\.error\?\.message/, '回传 Stripe 错误 message(不含密钥,安全)');

console.log('billing-stripe: OK');
