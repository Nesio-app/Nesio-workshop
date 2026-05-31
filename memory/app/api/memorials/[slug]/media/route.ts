import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api-response";
import {
  canEdit,
  canView,
  getMemorialBySlug,
} from "@/lib/memorial-access";
import { saveMemorialImage } from "@/lib/upload";
import { sanitizeShort, sanitizeText } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

type Params = { params: { slug: string } };

export async function POST(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return jsonError("请先登录", 401);

  const memorial = await getMemorialBySlug(params.slug);
  if (!memorial) return jsonError("纪念馆不存在", 404);
  if (!canEdit(memorial, user)) return jsonError("无权上传", 403);

  const formData = await request.formData().catch(() => null);
  if (!formData) return jsonError("无效的上传请求", 400);

  const file = formData.get("file");
  if (!(file instanceof File)) return jsonError("请选择图片文件", 400);

  const caption = sanitizeText(String(formData.get("caption") || "珍贵影像"), 200);
  const yearLabel = formData.get("yearLabel")
    ? sanitizeShort(String(formData.get("yearLabel")))
    : null;

  let imageUrl: string;
  try {
    const saved = await saveMemorialImage(params.slug, file);
    imageUrl = saved.imageUrl;
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "上传失败", 400);
  }

  const maxOrder = await prisma.memorialMedia.aggregate({
    where: { memorialId: memorial.id },
    _max: { sortOrder: true },
  });

  const media = await prisma.memorialMedia.create({
    data: {
      memorialId: memorial.id,
      caption,
      yearLabel,
      imageUrl,
      emoji: "📸",
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
    },
  });

  return jsonOk({
    media: {
      id: media.id,
      caption: media.caption,
      emoji: media.emoji,
      imageUrl: imageUrl,
      yearLabel: media.yearLabel,
    },
  });
}

export async function GET(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  const memorial = await getMemorialBySlug(params.slug);
  if (!memorial) return jsonError("纪念馆不存在", 404);
  if (!canView(memorial, user)) return jsonError("无权访问", 403);

  return jsonOk({
    media: memorial.mediaItems.map((m) => ({
      id: m.id,
      caption: m.caption,
      emoji: m.emoji,
      imageUrl: m.imageUrl,
      yearLabel: m.yearLabel,
    })),
  });
}
