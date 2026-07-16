import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { envValue } from '@/lib/portal/env';
import { writeEntitlementByUid } from '@/lib/portal/auth/server-entitlement';

export const runtime = 'nodejs';

/**
 * Stripe webhook —— 订阅生命周期回调,验签后把 plan 写进账号级权益真源表。
 * 这是收费闭环的「真源写入」端:客户端谁都改不动,只有 Stripe 签名过的事件能改。
 *
 * 默认休眠:未配 STRIPE_WEBHOOK_SECRET → 503(没配 = 没接 Stripe)。
 * 验签:Stripe-Signature 的 t + v1(HMAC-SHA256(secret, `t.rawBody`)),常量时间比对 +
 * 5 分钟时效窗(防重放)。验不过一律 400,绝不写库。
 */
function verifyStripeSignature(payload: string, header: string, secret: string): boolean {
  if (!header) return false;
  const parts = header.split(',').map((kv) => kv.split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false; // 时效窗
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const expBuf = Buffer.from(expected);
  return sigs.some((s) => {
    const sBuf = Buffer.from(s);
    return sBuf.length === expBuf.length && crypto.timingSafeEqual(sBuf, expBuf);
  });
}

export async function POST(req: NextRequest) {
  const secret = envValue('STRIPE_WEBHOOK_SECRET');
  if (!secret) return NextResponse.json({ ok: false, error: 'billing_not_configured' }, { status: 503 });

  const raw = await req.text();
  const sig = req.headers.get('stripe-signature') || '';
  if (!verifyStripeSignature(raw, sig, secret)) {
    return NextResponse.json({ ok: false, error: 'bad_signature' }, { status: 400 });
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  try {
    const obj = event.data?.object || {};
    if (event.type === 'checkout.session.completed') {
      const uid = typeof obj.client_reference_id === 'string' ? obj.client_reference_id : '';
      if (uid) {
        await writeEntitlementByUid(uid, {
          plan: 'pro',
          stripe_customer_id: typeof obj.customer === 'string' ? obj.customer : null,
          stripe_subscription_id: typeof obj.subscription === 'string' ? obj.subscription : null,
          stripe_status: 'active',
        });
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const meta = (obj.metadata as Record<string, unknown> | undefined) || {};
      const uid = typeof meta.user_id === 'string' ? meta.user_id : '';
      if (uid) {
        const status = typeof obj.status === 'string' ? obj.status : '';
        const active = status === 'active' || status === 'trialing';
        const periodEnd = typeof obj.current_period_end === 'number'
          ? new Date(obj.current_period_end * 1000).toISOString()
          : null;
        await writeEntitlementByUid(uid, {
          plan: active ? 'pro' : 'free',
          stripe_subscription_id: typeof obj.id === 'string' ? obj.id : null,
          stripe_status: status || null,
          current_period_end: periodEnd,
        });
      }
    }
  } catch {
    /* 吞异常并回 200 —— 避免 Stripe 因 5xx 重试风暴;写失败下次事件会再纠正 */
  }
  return NextResponse.json({ received: true });
}
