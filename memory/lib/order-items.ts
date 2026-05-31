import { prisma } from "@/lib/db";
import { sanitizeText } from "@/lib/sanitize";

export type OrderLineInput = {
  slug: string;
  qty: number;
  name?: string;
};

export type ResolvedOrderLine = {
  slug: string;
  name: string;
  priceCents: number;
  qty: number;
  category: string;
};

export async function resolveOrderLineItems(
  items: OrderLineInput[]
): Promise<{ items: ResolvedOrderLine[] } | { error: string }> {
  if (!items.length) return { error: "购物车为空" };

  const slugs = Array.from(new Set(items.map((i) => i.slug)));
  const products = await prisma.product.findMany({
    where: { slug: { in: slugs }, active: true },
  });
  const bySlug = new Map(products.map((p) => [p.slug, p]));

  const resolved: ResolvedOrderLine[] = [];
  for (const item of items) {
    const product = bySlug.get(item.slug);
    if (!product) {
      return { error: `商品不存在或已下架：${item.slug}` };
    }
    if (item.qty < 1 || item.qty > 99) {
      return { error: "商品数量无效" };
    }
    const label = item.name?.trim()
      ? sanitizeText(item.name, 120)
      : product.name;
    resolved.push({
      slug: product.slug,
      name: label,
      priceCents: product.priceCents,
      qty: item.qty,
      category: product.category,
    });
  }

  return { items: resolved };
}

export function orderLinesToText(lines: ResolvedOrderLine[]) {
  return lines
    .map(
      (i) =>
        `${i.name} x${i.qty} ¥${((i.priceCents * i.qty) / 100).toFixed(0)}`
    )
    .join("；");
}

export function orderLinesTotalCents(lines: ResolvedOrderLine[]) {
  return lines.reduce((sum, i) => sum + i.priceCents * i.qty, 0);
}

export function orderLinesToJson(lines: ResolvedOrderLine[]) {
  return lines.map((i) => ({
    slug: i.slug,
    name: i.name,
    price: i.priceCents / 100,
    qty: i.qty,
  }));
}
