import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api-response";
import { canEdit, getMemorialBySlug } from "@/lib/memorial-access";
import { deleteMemorialImage } from "@/lib/upload";

export const dynamic = "force-dynamic";

type Params = { params: { slug: string; id: string } };

export async function DELETE(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return jsonError("请先登录", 401);

  const memorial = await getMemorialBySlug(params.slug);
  if (!memorial) return jsonError("纪念馆不存在", 404);
  if (!canEdit(memorial, user)) return jsonError("无权删除", 403);

  const media = await prisma.memorialMedia.findFirst({
    where: { id: params.id, memorialId: memorial.id },
  });
  if (!media) return jsonError("照片不存在", 404);

  await deleteMemorialImage(media.imageUrl);
  await prisma.memorialMedia.delete({ where: { id: media.id } });

  return jsonOk({ deleted: true });
}
