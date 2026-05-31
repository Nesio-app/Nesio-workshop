import {
  Memorial,
  MemorialMember,
  Ritual,
  MemoryFragment,
  Reminder,
  TimelineEvent,
  FamilyPerson,
  MemorialMedia,
} from "@prisma/client";
import { SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicAssetUrl } from "@/lib/public-url";

export type MemorialWithMembers = Memorial & {
  members: MemorialMember[];
  rituals: Ritual[];
  fragments: MemoryFragment[];
  reminders: Reminder[];
  timelineEvents: TimelineEvent[];
  familyPeople: FamilyPerson[];
  mediaItems: MemorialMedia[];
};

export async function getMemorialBySlug(slug: string) {
  return prisma.memorial.findUnique({
    where: { slug },
    include: {
      members: true,
      rituals: { orderBy: { createdAt: "desc" }, take: 100 },
      fragments: { orderBy: { createdAt: "desc" }, take: 100 },
      reminders: true,
      timelineEvents: { orderBy: { sortOrder: "asc" } },
      familyPeople: { orderBy: { sortOrder: "asc" } },
      mediaItems: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export function isOwner(memorial: Memorial, user: SessionUser | null) {
  return !!user && memorial.ownerId === user.id;
}

export function isMember(memorial: MemorialWithMembers, email: string | undefined) {
  if (!email) return false;
  return memorial.members.some((m) => m.email.toLowerCase() === email.toLowerCase());
}

export function canView(memorial: MemorialWithMembers, user: SessionUser | null) {
  if (memorial.privacy === "public") return true;
  if (!user) return false;
  if (isOwner(memorial, user)) return true;
  if (memorial.privacy === "private") return false;
  if (memorial.privacy === "family") {
    return isMember(memorial, user.email);
  }
  return false;
}

export function canEdit(memorial: MemorialWithMembers, user: SessionUser | null) {
  if (!user) return false;
  if (isOwner(memorial, user)) return true;
  return memorial.members.some(
    (m) =>
      m.email.toLowerCase() === user.email.toLowerCase() &&
      (m.role === "admin" || m.role === "owner")
  );
}

export function memorialToPublicJson(
  memorial: MemorialWithMembers,
  viewer: SessionUser | null
) {
  const allowed = canView(memorial, viewer);
  if (!allowed) return null;

  const edit = canEdit(memorial, viewer);
  return {
    slug: memorial.slug,
    name: memorial.name,
    birthDate: memorial.birthDate?.toISOString().slice(0, 10) ?? null,
    deathDate: memorial.deathDate.toISOString().slice(0, 10),
    motto: memorial.motto,
    bioHtml: memorial.bioHtml,
    familyNote: memorial.familyNote,
    themeId: memorial.themeId,
    privacy: memorial.privacy,
    quietMode: memorial.quietMode,
    canEdit: edit,
    timeline: memorial.timelineEvents.map((e) => ({
      id: e.id,
      yearLabel: e.yearLabel,
      title: e.title,
      description: e.description,
    })),
    family: memorial.familyPeople.map((p) => ({
      id: p.id,
      groupLabel: p.groupLabel,
      name: p.name,
      relation: p.relation,
      avatarChar: p.avatarChar,
    })),
    gallery: memorial.mediaItems.map((m) => ({
      id: m.id,
      caption: m.caption,
      emoji: m.emoji,
      imageUrl: m.imageUrl || null,
      yearLabel: m.yearLabel,
    })),
    rituals: memorial.rituals.map((r) => {
      const showMessage =
        edit || memorial.privacy !== "public" || isMember(memorial, viewer?.email);
      return {
        id: r.id,
        type: r.type,
        message: showMessage ? r.message : r.message ? "心意已留下" : null,
        author: r.author,
        at: r.createdAt.toISOString(),
      };
    }),
    fragments: memorial.fragments.map((f) => ({
      id: f.id,
      content: f.content,
      relation: f.relation,
      year: f.year,
      author: f.author,
      status: f.status,
      at: f.createdAt.toISOString(),
    })),
    reminders: edit
      ? memorial.reminders.map((r) => ({ email: r.email, at: r.createdAt.toISOString() }))
      : [],
    tributeCounts: memorial.rituals.reduce(
      (acc, r) => {
        acc[r.type] = (acc[r.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
  };
}
