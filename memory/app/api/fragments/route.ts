import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api-response";
import { canView, getMemorialBySlug } from "@/lib/memorial-access";
import { syncFragmentToNotion } from "@/lib/composio";
import { sanitizeShort, sanitizeText } from "@/lib/sanitize";

const schema = z.object({
  slug: z.string().min(1),
  content: z.string().min(1).max(2000),
  relation: z.string().max(80).optional(),
  year: z.string().max(20).optional(),
  author: z.string().max(80).optional(),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("记忆内容无效", 400);

  const memorial = await getMemorialBySlug(parsed.data.slug);
  if (!memorial) return jsonError("纪念馆不存在", 404);
  if (!canView(memorial, user)) return jsonError("无权留言", 403);

  const author = parsed.data.author
    ? sanitizeShort(parsed.data.author)
    : user?.name || user?.email || "家人";

  const relation = parsed.data.relation ? sanitizeShort(parsed.data.relation) : null;
  const isGuestbook = relation?.includes("留言") ?? false;

  const fragment = await prisma.memoryFragment.create({
    data: {
      memorialId: memorial.id,
      content: sanitizeText(parsed.data.content, 2000),
      relation,
      year: parsed.data.year ? sanitizeShort(parsed.data.year) : null,
      author,
      authorUserId: user?.id,
      status: isGuestbook ? "approved" : "pending",
    },
  });

  const notion = await syncFragmentToNotion({
    memorialName: memorial.name,
    slug: memorial.slug,
    author,
    relation: fragment.relation,
    year: fragment.year,
    content: fragment.content,
    status: fragment.status,
  });

  if (notion.ok) {
    await prisma.notionSyncLog.create({
      data: {
        memorialId: memorial.id,
        payload: JSON.stringify({ fragmentId: fragment.id }),
        status: "ok",
      },
    });
  } else {
    await prisma.notionSyncLog.create({
      data: {
        memorialId: memorial.id,
        payload: JSON.stringify({ fragmentId: fragment.id, error: notion.error }),
        status: "skipped",
      },
    });
  }

  return jsonOk({
    fragment: {
      id: fragment.id,
      status: fragment.status,
      notionSynced: notion.ok,
    },
  });
}
