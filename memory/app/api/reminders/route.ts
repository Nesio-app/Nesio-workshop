import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api-response";
import { canView, getMemorialBySlug } from "@/lib/memorial-access";

const schema = z.object({
  slug: z.string().min(1),
  email: z.string().email().max(254),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("邮箱无效", 400);

  const memorial = await getMemorialBySlug(parsed.data.slug);
  if (!memorial) return jsonError("纪念馆不存在", 404);
  if (!canView(memorial, user)) return jsonError("无权订阅", 403);

  const email = parsed.data.email.toLowerCase().trim();

  await prisma.reminder.upsert({
    where: {
      memorialId_email: { memorialId: memorial.id, email },
    },
    create: { memorialId: memorial.id, email },
    update: {},
  });

  return jsonOk({ subscribed: true });
}
