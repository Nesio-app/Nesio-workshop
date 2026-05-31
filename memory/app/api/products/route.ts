import { prisma } from "@/lib/db";
import { jsonOk } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cat = new URL(request.url).searchParams.get("cat");
  const where = {
    active: true,
    ...(cat && cat !== "all" ? { category: cat } : {}),
  };

  const products = await prisma.product.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return jsonOk({
    products: products.map((p) => ({
      slug: p.slug,
      name: p.name,
      description: p.description,
      price: p.priceCents / 100,
      listPrice: p.listCents ? p.listCents / 100 : null,
      category: p.category,
      emoji: p.emoji,
      bg: p.bgStyle,
      badge: p.badge,
    })),
  });
}
