/**
 * GET /api/portal/music/netease/search?q=… —— 网易云搜索。
 *
 * 2026-07-31 改直连(用户:「意味着我电脑要一直开着?」——不用)。
 * 原来这里只会把请求转给 NETEASE_API_BASE 指向的第三方实例,而那个实例得有台机器
 * 常驻。Nesio 统共只用它两个接口,为此养一整个服务不划算。协议搬进
 * lib/platform/music/netease-protocol,跟 Nesio 一起部署,不多任何常驻进程。
 *
 * NETEASE_API_BASE **保留为可选逃生口**:直连走的是逆向协议,网易改了就会坏;
 * 那时候指一个自己的实例还能用。配了就优先用它 —— 判断只此一处,不散开。
 *
 * 走 guard + 限流:它是一个对外转发口,裸奔会被当免费代理刷。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { searchDirect, toHit, type NeteaseHit } from '@/lib/platform/music/netease-protocol';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const noStore = { 'Cache-Control': 'no-store, max-age=0' };

function apiBase(): string {
  const v = process.env['NETEASE_API_BASE'];
  return typeof v === 'string' ? v.trim().replace(/\/+$/, '') : '';
}

export type { NeteaseHit };

export async function GET(req: NextRequest) {
  const blocked = await guardAiRoute(req, 'music-netease-search', { limit: 20, windowMs: 60_000 });
  if (blocked) return blocked;

  const q = (new URL(req.url).searchParams.get('q') || '').trim();
  // configured 恒 true:直连不需要配任何东西。这个字段留着是给 readiness 探
  // 「这条路由通不通、登录态在不在」——未登录时 guard 会先把 401 抛出去。
  if (!q) return NextResponse.json({ ok: true, configured: true, hits: [] }, { headers: noStore });

  const base = apiBase();
  if (base) {
    try {
      const upstream = await fetch(`${base}/search?keywords=${encodeURIComponent(q)}&limit=20`, { cache: 'no-store' });
      if (!upstream.ok) {
        return NextResponse.json(
          { ok: false, configured: true, hits: [], error: 'upstream_failed' },
          { status: 502, headers: noStore },
        );
      }
      const j = await upstream.json() as { result?: { songs?: Array<Record<string, unknown>> } };
      const hits = (j?.result?.songs || []).map(toHit).filter((h) => h.id && h.title);
      return NextResponse.json({ ok: true, configured: true, hits }, { headers: noStore });
    } catch {
      return NextResponse.json(
        { ok: false, configured: true, hits: [], error: 'network' },
        { status: 502, headers: noStore },
      );
    }
  }

  const r = await searchDirect(q);
  if (r.kind === 'ok') return NextResponse.json({ ok: true, configured: true, hits: r.value }, { headers: noStore });
  if (r.kind === 'blocked') {
    // 被风控**不是**故障,也不是「没搜到」:它是一个稳定状态,换个词再搜一遍没用。
    // 200 + reason,和 restricted 同一类 —— 让界面能说出唯一有效的下一步。
    return NextResponse.json(
      { ok: false, configured: true, hits: [], reason: 'blocked' },
      { headers: noStore },
    );
  }
  return NextResponse.json(
    { ok: false, configured: true, hits: [], error: 'upstream_failed' },
    { status: 502, headers: noStore },
  );
}
