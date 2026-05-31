import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/api-response";
import { canManageContent } from "@/lib/content-admin";
import { sanitizeShort } from "@/lib/sanitize";

const patchSchema = z.object({
  name: z.string().min(1).max(80),
});

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonOk({ user: null });
  return jsonOk({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      canManageContent: canManageContent(user),
    },
  });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("请先登录", 401);

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError("请填写有效的称呼", 400);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { name: sanitizeShort(parsed.data.name) },
  });

  return jsonOk({
    user: {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      canManageContent: canManageContent(updated),
    },
  });
}
