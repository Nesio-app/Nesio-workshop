/**
 * GET /api/portal/music/netease/lyric?id=… —— 一首歌的歌词。
 *
 * 2026-08-01 新增(用户:「歌词从哪来 —— 和网易一起。本地没歌词的,都用网易歌词,
 * 即使是本地歌曲」)。所以这条路由服务的**不只是**网易那边的歌:本地导入的 mp3
 * 如果自己没带词,也拿它的曲名去搜一首同名的,再来这里取词。
 *
 * 三种结局分开报,理由和 song-url 那条完全一样 —— 各自的下一步不同:
 *   · 有词          → `{ ok:true, lrc, translated }`
 *   · **没有词**    → `{ ok:true, lrc:'' }`  → 界面说「这一首没有歌词」,**不给重试**。
 *                     纯音乐重试一万次也还是没有,挂一个点不好的按钮比不给更伤。
 *   · 被风控/挂了   → `{ ok:false, reason:'blocked' }` / 502 → 这才是该重试的
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { lyricDirect } from '@/lib/platform/music/netease-protocol';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const noStore = { 'Cache-Control': 'no-store, max-age=0' };

function apiBase(): string {
  const v = process.env['NETEASE_API_BASE'];
  return typeof v === 'string' ? v.trim().replace(/\/+$/, '') : '';
}

export async function GET(req: NextRequest) {
  const blocked = await guardAiRoute(req, 'music-netease-lyric', { limit: 40, windowMs: 60_000 });
  if (blocked) return blocked;

  const id = (new URL(req.url).searchParams.get('id') || '').trim();
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ ok: false, lrc: '', error: 'bad_id' }, { status: 400, headers: noStore });
  }

  const base = apiBase();
  if (base) {
    try {
      const upstream = await fetch(`${base}/lyric?id=${id}`, { cache: 'no-store' });
      if (!upstream.ok) {
        return NextResponse.json({ ok: false, lrc: '', error: 'upstream_failed' }, { status: 502, headers: noStore });
      }
      const j = await upstream.json() as { lrc?: { lyric?: string }; tlyric?: { lyric?: string } };
      return NextResponse.json({
        ok: true, lrc: String(j?.lrc?.lyric || ''), translated: String(j?.tlyric?.lyric || ''),
      }, { headers: noStore });
    } catch {
      return NextResponse.json({ ok: false, lrc: '', error: 'network' }, { status: 502, headers: noStore });
    }
  }

  const r = await lyricDirect(id);
  if (r.kind === 'ok') {
    return NextResponse.json({ ok: true, lrc: r.value.lrc, translated: r.value.translated }, { headers: noStore });
  }
  if (r.kind === 'blocked') {
    return NextResponse.json({ ok: false, lrc: '', reason: 'blocked' }, { headers: noStore });
  }
  return NextResponse.json({ ok: false, lrc: '', error: 'upstream_failed' }, { status: 502, headers: noStore });
}
