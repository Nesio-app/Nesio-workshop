import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser, slugify } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api-response";
import { sanitizeText } from "@/lib/sanitize";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  birthDate: z.string().optional(),
  deathDate: z.string().min(1),
  motto: z.string().max(200).optional(),
  privacy: z.enum(["private", "family", "public"]).default("family"),
  quietMode: z.boolean().default(true),
});

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("请先登录", 401);

  const memorials = await prisma.memorial.findMany({
    where: { ownerId: user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      slug: true,
      name: true,
      deathDate: true,
      privacy: true,
      quietMode: true,
      updatedAt: true,
    },
  });

  return jsonOk({ memorials });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("请先登录", 401);

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonError("纪念馆信息无效", 400);

  const data = parsed.data;
  let slug = slugify(sanitizeText(data.name, 40));
  const exists = await prisma.memorial.findUnique({ where: { slug } });
  if (exists) slug = slugify(slug + "-" + Math.random().toString(36).slice(2, 6));

  const memorial = await prisma.memorial.create({
    data: {
      slug,
      ownerId: user.id,
      name: sanitizeText(data.name, 80),
      birthDate: data.birthDate ? new Date(data.birthDate) : null,
      deathDate: new Date(data.deathDate),
      motto: data.motto ? sanitizeText(data.motto, 200) : null,
      privacy: data.privacy,
      quietMode: data.quietMode,
      members: {
        create: { email: user.email, role: "owner" },
      },
    },
  });

  return jsonOk({ slug: memorial.slug, id: memorial.id }, 201);
}
