import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api-response";
import { canManageContent } from "@/lib/content-admin";
import { sanitizeText } from "@/lib/sanitize";
import { slugify } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cat = new URL(request.url).searchParams.get("cat");
  const where = {
    published: true,
    ...(cat && cat !== "all" ? { cat } : {}),
  };

  const articles = await prisma.article.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });

  return jsonOk({
    articles: articles.map((a) => ({
      id: a.slug,
      cat: a.cat,
      catLabel: a.catLabel,
      title: a.title,
      summary: a.summary,
      emoji: a.emoji,
      bg: a.bgStyle,
    })),
  });
}

const createSchema = z.object({
  title: z.string().min(1).max(120),
  cat: z.enum(["grief", "ritual", "memory", "child", "legal", "custom"]),
  catLabel: z.string().min(1).max(40),
  summary: z.string().min(1).max(300),
  body: z.string().min(1).max(50000),
  emoji: z.string().max(8).optional(),
  bg: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!canManageContent(user)) {
    return jsonError("无权发布文章，请联系管理员", 403);
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonError("文章参数无效", 400);

  const data = parsed.data;
  const baseSlug = slugify(data.title).slice(0, 60) || "article";
  let slug = baseSlug;
  let n = 1;
  while (await prisma.article.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${n++}`;
  }

  const article = await prisma.article.create({
    data: {
      slug,
      cat: data.cat,
      catLabel: sanitizeText(data.catLabel, 40),
      title: sanitizeText(data.title, 120),
      summary: sanitizeText(data.summary, 300),
      body: sanitizeText(data.body, 50000),
      emoji: data.emoji || "📖",
      bgStyle: data.bg || "linear-gradient(135deg,#e8f4f8,#d0e8f0)",
    },
  });

  return jsonOk({ article: { id: article.slug, title: article.title } });
}
