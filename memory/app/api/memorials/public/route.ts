import { prisma } from "@/lib/db";
import { jsonOk } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET() {
  const memorials = await prisma.memorial.findMany({
    where: { privacy: "public" },
    orderBy: { updatedAt: "desc" },
    take: 12,
    select: {
      slug: true,
      name: true,
      motto: true,
      deathDate: true,
      birthDate: true,
      themeId: true,
    },
  });

  return jsonOk({
    memorials: memorials.map((m) => ({
      slug: m.slug,
      name: m.name,
      motto: m.motto,
      deathDate: m.deathDate.toISOString().slice(0, 10),
      birthDate: m.birthDate?.toISOString().slice(0, 10) ?? null,
      themeId: m.themeId,
    })),
  });
}
