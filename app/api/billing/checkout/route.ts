import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { envValue } from '@/lib/portal/env';
import { getSupabaseUserId } from '@/lib/portal/integrations';

export const runtime = 'nodejs';

/**
 * Stripe 订阅结账(美国市场,Web 收费 —— 功能分层报告「上线前必闭 #3 支付通路」)。
 * 创建 Checkout Session 返回跳转 URL。收据由 /api/billing/webhook 验签后写权益真源表。
 *
 * 默认休眠:未配 STRIPE_SECRET_KEY / STRIPE_PRICE_ID → 503 billing_not_configured
 * (客户端据此保持「即将开放」文案)。登录 gate:匿名不能发起(防刷)。
 */
export async function POST(req: NextRequest) {
  const secret = envValue('STRIPE_SECRET_KEY');
  const priceId = envValue('STRIPE_PRICE_ID');
  if (!secret || !priceId) {
    return NextResponse.json({ ok: false, error: 'billing_not_configured' }, { status: 503 });
  }

  const cookieStore = await cookies();
  const accessToken = cookieStore.get('baohe_auth_access')?.value || '';
  const uid = accessToken ? await getSupabaseUserId(accessToken) : null;
  if (!uid) {
    return NextResponse.json({ ok: false, error: 'not_signed_in' }, { status: 401 });
  }

  const origin = req.nextUrl.origin;
  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('line_items[0][price]', priceId);
  form.set('line_items[0][quantity]', '1');
  form.set('client_reference_id', uid);                        // webhook 据此认领账号
  form.set('subscription_data[metadata][user_id]', uid);       // 订阅事件也带上 uid
  form.set('allow_promotion_codes', 'true');
  form.set('success_url', `${origin}/?billing=success`);
  form.set('cancel_url', `${origin}/?billing=cancel`);

  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string };
    if (!res.ok || !data.url) {
      return NextResponse.json({ ok: false, error: 'stripe_checkout_failed' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, url: data.url });
  } catch {
    return NextResponse.json({ ok: false, error: 'network' }, { status: 502 });
  }
}
