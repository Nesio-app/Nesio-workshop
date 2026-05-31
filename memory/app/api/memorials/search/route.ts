import { prisma } from "@/lib/db";
import { getSessionUser, slugify } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api-response";
import { canView, getMemorialBySlug } from "@/lib/memorial-access";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q || q.length > 80) return jsonError("请输入有效的搜索词", 400);

  const user = await getSessionUser();
  const results: Array<{
    slug: string;
    name: string;
    motto: string | null;
    privacy: string;
    viewable: boolean;
  }> = [];

  const slugCandidate = slugify(q);
  if (slugCandidate.length > 2) {
    const bySlug = await getMemorialBySlug(slugCandidate);
    if (bySlug) {
      results.push({
        slug: bySlug.slug,
        name: bySlug.name,
        motto: bySlug.motto,
        privacy: bySlug.privacy,
        viewable: canView(bySlug, user),
      });
    }
  }

  const nameMatches = await prisma.memorial.findMany({
    where: { name: { contains: q, mode: "insensitive" } },
    take: 12,
    include: { members: true },
  });

  for (const m of nameMatches) {
    if (results.some((r) => r.slug === m.slug)) continue;
    results.push({
      slug: m.slug,
      name: m.name,
      motto: m.motto,
      privacy: m.privacy,
      viewable: canView(
        {
          ...m,
          rituals: [],
          fragments: [],
          reminders: [],
          timelineEvents: [],
          familyPeople: [],
          mediaItems: [],
        },
        user
      ),
    });
  }

  const publicMatches = await prisma.memorial.findMany({
    where: {
      privacy: "public",
      slug: { contains: q, mode: "insensitive" },
    },
    take: 8,
    include: { members: true },
  });

  for (const m of publicMatches) {
    if (results.some((r) => r.slug === m.slug)) continue;
    results.push({
      slug: m.slug,
      name: m.name,
      motto: m.motto,
      privacy: m.privacy,
      viewable: canView(
        {
          ...m,
          rituals: [],
          fragments: [],
          reminders: [],
          timelineEvents: [],
          familyPeople: [],
          mediaItems: [],
        },
        user
      ),
    });
  }

  if (user) {
    const owned = await prisma.memorial.findMany({
      where: {
        ownerId: user.id,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { slug: { contains: slugCandidate, mode: "insensitive" } },
        ],
      },
      take: 8,
      select: { slug: true, name: true, motto: true, privacy: true },
    });
    for (const m of owned) {
      if (results.some((r) => r.slug === m.slug)) continue;
      results.push({
        slug: m.slug,
        name: m.name,
        motto: m.motto,
        privacy: m.privacy,
        viewable: true,
      });
    }
  }

  return jsonOk({ memorials: results.slice(0, 10) });
}
