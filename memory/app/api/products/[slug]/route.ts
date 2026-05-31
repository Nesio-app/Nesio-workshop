import { prisma } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Params = { params: { slug: string } };

export async function GET(_request: Request, { params }: Params) {
  const product = await prisma.product.findFirst({
    where: { slug: params.slug, active: true },
  });
  if (!product) return jsonError("商品不存在", 404);

  return jsonOk({
    product: {
      slug: product.slug,
      name: product.name,
      description: product.description,
      price: product.priceCents / 100,
      listPrice: product.listCents ? product.listCents / 100 : null,
      category: product.category,
      emoji: product.emoji,
      bg: product.bgStyle,
      badge: product.badge,
    },
  });
}
