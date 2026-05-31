import { prisma } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

export async function GET(_request: Request, { params }: Params) {
  const article = await prisma.article.findFirst({
    where: { slug: params.id, published: true },
  });
  if (!article) return jsonError("文章不存在", 404);

  return jsonOk({
    article: {
      id: article.slug,
      cat: article.cat,
      catLabel: article.catLabel,
      title: article.title,
      summary: article.summary,
      body: article.body,
      emoji: article.emoji,
      bg: article.bgStyle,
    },
  });
}
