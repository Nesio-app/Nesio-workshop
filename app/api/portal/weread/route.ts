/**
 * POST /api/portal/weread  (批次 161)
 * 微信读书自动同步 —— 用用户粘贴的 weread cookie 调其 web 接口(i.weread.qq.com)取
 * 「有笔记的书 + 划线 + 想法」,归一成划线记忆节点(type:'note', sourceApp:'wechat')返回浏览器 ingest。
 *
 * 非官方接口:微信读书没有公开 API,靠 cookie。wr_skey 会过期(数小时),过期需重粘 cookie
 * —— 返回 invalid_token,syncToken 会提示重新输入。参考社区实现 mcp-server-weread / weread2notion。
 * Body: { token: <weread cookie 字符串> }
 * 返回: { ok, nodes, summary } | { ok:false, error }
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const WEREAD = 'https://i.weread.qq.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

type Json = Record<string, unknown>;

async function wr(path: string, cookie: string): Promise<Json> {
  const res = await fetch(`${WEREAD}${path}`, {
    headers: { Cookie: cookie, 'User-Agent': UA, Accept: 'application/json' },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({})) as Json;
  // 微信读书用 errcode/errCode 表达登录失效(如 -2012 需重新登录)。
  const errcode = Number(data.errcode ?? data.errCode ?? 0);
  if (res.status === 401 || errcode === -2012 || errcode === -2010) {
    throw new Error('cookie_expired');
  }
  if (!res.ok) throw new Error(`weread_${res.status}`);
  return data;
}

interface NotebookBook {
  bookId: string;
  noteCount?: number;
  book?: { title?: string; author?: string; cover?: string };
}
interface Bookmark { markText?: string; chapterName?: string }

export async function POST(req: NextRequest) {
  // 会话门:登录后才用(cookie 是用户自己的,但不放行匿名代理)。
  const cookieStore = await cookies();
  const signedIn = Boolean(
    cookieStore.get('baohe_auth_access')?.value ||
    cookieStore.get('baohe_auth_refresh')?.value ||
    cookieStore.get('baohe_wechat_openid')?.value,
  );
  if (!signedIn) return NextResponse.json({ ok: false, error: 'auth_required' }, { status: 401 });

  const { token: cookie } = await req.json().catch(() => ({})) as { token?: string };
  if (!cookie || !cookie.trim()) return NextResponse.json({ ok: false, error: 'no_cookie' }, { status: 200 });

  try {
    const nb = await wr('/user/notebooks', cookie) as { books?: NotebookBook[] };
    const books = (nb.books || []).filter((b) => b.bookId).slice(0, 15);
    if (!books.length) return NextResponse.json({ ok: true, nodes: [], summary: '没有找到有笔记的书' });

    const nodes: Json[] = [];
    for (const b of books) {
      let highlights: string[] = [];
      try {
        const marks = await wr(`/book/bookmarklist?bookId=${encodeURIComponent(b.bookId)}`, cookie) as { updated?: Bookmark[] };
        highlights = (marks.updated || []).map((m) => (m.markText || '').trim()).filter(Boolean).slice(0, 60);
      } catch (e) {
        // 单本取划线失败:cookie 失效则整体中断,其余错误跳过这本继续。
        if (e instanceof Error && e.message === 'cookie_expired') throw e;
        continue;
      }
      if (!highlights.length) continue;
      const title = b.book?.title?.trim() || '未命名书';
      const author = b.book?.author?.trim() || '';
      const body = highlights.map((h) => `• ${h}`).join('\n');
      nodes.push({
        name: title,
        type: 'note',
        tags: ['微信读书', '读书划线', ...(author ? [author] : [])],
        attributes: {
          category: '读书划线',
          sourceApp: 'wechat',
          author,
          bookId: b.bookId,
          highlightCount: highlights.length,
          article: body, // ArticleReaderSheet 可读
        },
        rawInput: body,
        confidence: 1,
        relations: [],
      });
    }
    return NextResponse.json({
      ok: true,
      nodes,
      summary: `${books.length} 本书 · ${nodes.length} 本有划线`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // cookie 过期 → invalid_token,syncToken 会清并提示重新粘贴。
    if (msg === 'cookie_expired') return NextResponse.json({ ok: false, error: 'invalid_token' }, { status: 200 });
    return NextResponse.json({ ok: false, error: msg || 'weread_failed' }, { status: 200 });
  }
}
