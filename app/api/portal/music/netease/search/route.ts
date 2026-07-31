/**
 * GET /api/portal/music/netease/search?q=… —— 网易云的**元数据**搜索。
 *
 * 这条路由刻意只做搜索,不做「取播放地址」。原因是事实层面的:
 * 网易锁的是**拿播放地址**那一步,锁的依据是请求出口 IP 在不在国内。
 * 搜索、歌单、封面都不锁。所以在没有国内出口的当下,
 * 「能搜到、放不出声」是这个源**真实且稳定**的能力边界 ——
 * 于是 source-catalog 里它是 metadata-only,canPlayNow 恒 false。
 *
 * 什么时候能升级成能放:有了国内出口(自建实例跑在国内机器上)之后,
 * 把 MUSIC_SOURCES 里 netease 的 model 改成 'in-app',并在这里加一条
 * 真去取 url 的探测 —— **必须真拿到非空 url 才算 streamable**,
 * 不许因为「配了 base 就假定能放」。
 *
 * 走 guard + 限流:它是一个对外转发口,裸奔会被当免费代理刷。
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const noStore = { 'Cache-Control': 'no-store, max-age=0' };

function apiBase(): string {
  const v = process.env['NETEASE_API_BASE'];
  return typeof v === 'string' ? v.trim().replace(/\/+$/, '') : '';
}

export interface NeteaseHit {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
}

export async function GET(req: NextRequest) {
  const blocked = await guardAiRoute(req, 'music-netease-search', { limit: 20, windowMs: 60_000 });
  if (blocked) return blocked;

  const base = apiBase();
  if (!base) {
    // 「没配」是正常状态,给 200 让界面照实说 —— 不是网络故障。
    return NextResponse.json(
      { ok: true, configured: false, hits: [], missingEnv: ['NETEASE_API_BASE'] },
      { headers: noStore },
    );
  }
  const q = (new URL(req.url).searchParams.get('q') || '').trim();
  if (!q) return NextResponse.json({ ok: true, configured: true, hits: [] }, { headers: noStore });

  try {
    const upstream = await fetch(`${base}/search?keywords=${encodeURIComponent(q)}&limit=20`, { cache: 'no-store' });
    if (!upstream.ok) {
      return NextResponse.json(
        { ok: false, configured: true, hits: [], error: 'upstream_failed' },
        { status: 502, headers: noStore },
      );
    }
    const j = await upstream.json() as { result?: { songs?: Array<Record<string, unknown>> } };
    const hits: NeteaseHit[] = (j?.result?.songs || []).map((s) => ({
      id: String(s['id'] ?? ''),
      title: String(s['name'] ?? ''),
      artist: (Array.isArray(s['artists']) ? (s['artists'] as Array<{ name?: string }>) : [])
        .map((a) => String(a?.name || '')).filter(Boolean).join(' / '),
      album: String((s['album'] as { name?: string } | undefined)?.name || ''),
      durationSec: Math.round((Number(s['duration']) || 0) / 1000),
    })).filter((h) => h.id && h.title);

    return NextResponse.json({ ok: true, configured: true, hits }, { headers: noStore });
  } catch {
    return NextResponse.json(
      { ok: false, configured: true, hits: [], error: 'network' },
      { status: 502, headers: noStore },
    );
  }
}
