/**
 * GET /api/portal/music/netease/song-url?id=… —— 问一首歌**现在能不能放**。
 *
 * 2026-07-31 新增。上一版我把网易整个判成「查得到、放不出声」,理由是
 * 「没有国内出口就拿不到播放地址」。用户当场指出这是错的:
 * 「不是所有歌都锁着的,为什么 github 的就可以」——他是对的。
 *
 * 真实情况是**逐曲**的:非独家、非 VIP 的曲子在国外出口上照样返回可播 URL,
 * 拿不到的是版权受限那部分。所以这件事没法在源级别一次判完,只能一首一首问。
 *
 * 这条路由的全部职责就是把那个问题问出去,并且**如实转述答案**:
 *   · 真拿到非空 url  → `{ ok: true, url }`
 *   · 拿到了但 url 是 null / 空 → `{ ok: true, url: '', reason: 'restricted' }`
 *     (这不是故障,是这一首确实放不了 —— 界面要按「换一首」来说,不是「重试」)
 *   · 上游挂了 / 网络不通 → 502,那才是故障
 * 把后两者混成一句话,用户会对着一首永远放不了的歌一直点重试。
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

export async function GET(req: NextRequest) {
  const blocked = await guardAiRoute(req, 'music-netease-song-url', { limit: 30, windowMs: 60_000 });
  if (blocked) return blocked;

  const base = apiBase();
  if (!base) {
    return NextResponse.json(
      { ok: true, configured: false, url: '', missingEnv: ['NETEASE_API_BASE'] },
      { headers: noStore },
    );
  }
  const id = (new URL(req.url).searchParams.get('id') || '').trim();
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ ok: false, url: '', error: 'bad_id' }, { status: 400, headers: noStore });
  }

  try {
    // br=320000:要 320k 那一档。拿不到会自动落到能给的码率,不会因此失败。
    const upstream = await fetch(`${base}/song/url?id=${id}&br=320000`, { cache: 'no-store' });
    if (!upstream.ok) {
      return NextResponse.json(
        { ok: false, url: '', error: 'upstream_failed' },
        { status: 502, headers: noStore },
      );
    }
    const j = await upstream.json() as { data?: Array<{ url?: string | null; code?: number }> };
    const url = String(j?.data?.[0]?.url || '');
    if (!url) {
      // **不是故障**:这一首受限。分开说,否则用户会一直点重试。
      return NextResponse.json({ ok: true, configured: true, url: '', reason: 'restricted' }, { headers: noStore });
    }
    return NextResponse.json({ ok: true, configured: true, url }, { headers: noStore });
  } catch {
    return NextResponse.json({ ok: false, url: '', error: 'network' }, { status: 502, headers: noStore });
  }
}
