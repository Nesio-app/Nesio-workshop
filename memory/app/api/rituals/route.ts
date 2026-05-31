import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api-response";
import { canView, getMemorialBySlug } from "@/lib/memorial-access";
import { sanitizeShort, sanitizeText } from "@/lib/sanitize";

const schema = z.object({
  slug: z.string().min(1),
  type: z.enum(["蜡烛", "鲜花", "焚香", "贡品", "心语"]),
  message: z.string().max(500).optional(),
  author: z.string().max(80).optional(),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("祭奠信息无效", 400);

  const memorial = await getMemorialBySlug(parsed.data.slug);
  if (!memorial) return jsonError("纪念馆不存在", 404);
  if (!canView(memorial, user)) return jsonError("无权祭奠", 403);

  const ritual = await prisma.ritual.create({
    data: {
      memorialId: memorial.id,
      type: parsed.data.type,
      message: parsed.data.message
        ? sanitizeText(parsed.data.message, 500)
        : null,
      author: parsed.data.author
        ? sanitizeShort(parsed.data.author)
        : user?.name || user?.email || "家人",
      authorUserId: user?.id,
    },
  });

  return jsonOk({
    ritual: {
      id: ritual.id,
      type: ritual.type,
      at: ritual.createdAt.toISOString(),
    },
  });
}
