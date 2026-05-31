import { z } from "zod";
import { prisma } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/api-response";
import { sanitizeText } from "@/lib/sanitize";

import { generateOrderNumber } from "@/lib/content-admin";

export const dynamic = "force-dynamic";

const schema = z.object({
  contactEmail: z.string().email(),
  contactName: z.string().max(80).optional(),
  items: z.string().min(1).max(2000),
  note: z.string().max(2000).optional(),
  memorialSlug: z.string().max(80).optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("请填写有效的邮箱与商品信息", 400);

  const data = parsed.data;
  await prisma.orderInquiry.create({
    data: {
      orderNumber: generateOrderNumber(),
      contactEmail: data.contactEmail.toLowerCase(),
      contactName: data.contactName
        ? sanitizeText(data.contactName, 80)
        : null,
      items: sanitizeText(data.items, 2000),
      note: data.note ? sanitizeText(data.note, 2000) : null,
      memorialSlug: data.memorialSlug
        ? sanitizeText(data.memorialSlug, 80)
        : null,
    },
  });

  return jsonOk({ submitted: true });
}
