import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api-response";
import { canEdit, getMemorialBySlug } from "@/lib/memorial-access";
import { syncFragmentToNotion } from "@/lib/composio";

const schema = z.object({
  slug: z.string().min(1),
  fragmentId: z.string().min(1),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("请先登录", 401);

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("参数无效", 400);

  const memorial = await getMemorialBySlug(parsed.data.slug);
  if (!memorial) return jsonError("纪念馆不存在", 404);
  if (!canEdit(memorial, user)) return jsonError("无权审核", 403);

  const fragment = await prisma.memoryFragment.findFirst({
    where: { id: parsed.data.fragmentId, memorialId: memorial.id },
  });
  if (!fragment) return jsonError("记忆不存在", 404);

  await prisma.memoryFragment.update({
    where: { id: fragment.id },
    data: { status: "approved" },
  });

  await syncFragmentToNotion({
    memorialName: memorial.name,
    slug: memorial.slug,
    author: fragment.author || "家人",
    relation: fragment.relation,
    year: fragment.year,
    content: fragment.content,
    status: "approved",
  });

  return jsonOk({ approved: true });
}
