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
 * 同日改直连(见 search 那条的说明):协议在 netease-protocol,
 * NETEASE_API_BASE 保留为可选逃生口,配了就优先用。
 *
 * 这条路由的全部职责就是把那个问题问出去,并且**如实转述答案**。
 * 四种结局,四个不同的下一步 —— 合并任意两个都会把用户按在墙上:
 *   · 拿到 url      → `{ ok:true, url }`
 *   · 这一首受限    → `{ ok:true, url:'', reason:'restricted' }`   → 换一首
 *   · 整台被风控    → `{ ok:false, url:'', reason:'blocked' }`     → 换歌没用,得换出口
 *   · 上游/网络挂   → 502                                          → 重试
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { songUrlDirect } from '@/lib/platform/music/netease-protocol';

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

  const id = (new URL(req.url).searchParams.get('id') || '').trim();
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ ok: false, url: '', error: 'bad_id' }, { status: 400, headers: noStore });
  }

  const base = apiBase();
  if (base) {
    try {
      // br=320000:要 320k 那一档。拿不到会自动落到能给的码率,不会因此失败。
      const upstream = await fetch(`${base}/song/url?id=${id}&br=320000`, { cache: 'no-store' });
      if (!upstream.ok) {
        return NextResponse.json(
          { ok: false, url: '', error: 'upstream_failed' },
          { status: 502, headers: noStore },
        );
      }
      const j = await upstream.json() as { data?: Array<{ url?: string | null }> };
      const url = String(j?.data?.[0]?.url || '');
      if (!url) {
        return NextResponse.json({ ok: true, configured: true, url: '', reason: 'restricted' }, { headers: noStore });
      }
      return NextResponse.json({ ok: true, configured: true, url }, { headers: noStore });
    } catch {
      return NextResponse.json({ ok: false, url: '', error: 'network' }, { status: 502, headers: noStore });
    }
  }

  const r = await songUrlDirect(id);
  if (r.kind === 'ok') {
    return NextResponse.json({ ok: true, configured: true, url: r.value }, { headers: noStore });
  }
  if (r.kind === 'restricted') {
    // **不是故障**:这一首受限。分开说,否则用户会一直点重试。
    return NextResponse.json({ ok: true, configured: true, url: '', reason: 'restricted' }, { headers: noStore });
  }
  if (r.kind === 'blocked') {
    // 也**不是故障**,而且和 restricted 是两回事:被风控时每一首都取不到,
    // 说成「这首受限」会让用户一首一首试到放弃,而换歌一点用都没有。
    return NextResponse.json({ ok: false, configured: true, url: '', reason: 'blocked' }, { headers: noStore });
  }
  return NextResponse.json({ ok: false, url: '', error: 'upstream_failed' }, { status: 502, headers: noStore });
}
