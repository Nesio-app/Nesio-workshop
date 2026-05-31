import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api-response";
import {
  canEdit,
  getMemorialBySlug,
  memorialToPublicJson,
} from "@/lib/memorial-access";
import { buildMemorialSchedule } from "@/lib/dates";
import { sanitizeText } from "@/lib/sanitize";
import { sanitizeHtml } from "@/lib/sanitize-html";

type Params = { params: { slug: string } };

export async function GET(_request: Request, { params }: Params) {
  const memorial = await getMemorialBySlug(params.slug);
  if (!memorial) return jsonError("纪念馆不存在", 404);

  const user = await getSessionUser();
  const publicData = memorialToPublicJson(memorial, user);
  if (!publicData) return jsonError("无权访问该纪念馆", 403);

  const schedule = buildMemorialSchedule(memorial.deathDate);

  return jsonOk({
    memorial: publicData,
    schedule,
  });
}

const patchSchema = z.object({
  privacy: z.enum(["private", "family", "public"]).optional(),
  quietMode: z.boolean().optional(),
  motto: z.string().max(200).optional(),
  name: z.string().min(1).max(80).optional(),
  bioHtml: z.string().max(50000).optional(),
  familyNote: z.string().max(10000).optional(),
  themeId: z.string().max(40).optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return jsonError("请先登录", 401);

  const memorial = await getMemorialBySlug(params.slug);
  if (!memorial) return jsonError("纪念馆不存在", 404);
  if (!canEdit(memorial, user)) return jsonError("无权修改", 403);

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError("参数无效", 400);

  const data = parsed.data;
  await prisma.memorial.update({
    where: { id: memorial.id },
    data: {
      ...(data.privacy !== undefined && { privacy: data.privacy }),
      ...(data.quietMode !== undefined && { quietMode: data.quietMode }),
      ...(data.motto !== undefined && { motto: sanitizeText(data.motto, 200) }),
      ...(data.name !== undefined && { name: sanitizeText(data.name, 80) }),
      ...(data.bioHtml !== undefined && { bioHtml: sanitizeHtml(data.bioHtml) }),
      ...(data.familyNote !== undefined && {
        familyNote: sanitizeText(data.familyNote, 10000),
      }),
      ...(data.themeId !== undefined && {
        themeId: sanitizeText(data.themeId, 40),
      }),
    },
  });

  const updated = await getMemorialBySlug(params.slug);
  const publicData = updated ? memorialToPublicJson(updated, user) : null;
  return jsonOk({ updated: true, memorial: publicData });
}
