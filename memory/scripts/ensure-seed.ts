import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const demo = await prisma.user.findUnique({
    where: { email: "demo@nianguichu.local" },
    select: { id: true },
  });

  let productCount = 0;
  try {
    productCount = await prisma.product.count();
  } catch {
    // Product table may not exist yet during first migrate
  }

  const galleryPhotos = [
    "https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1564890369478-c89ca2ed55e5?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1511895426328-dc8714191300?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=900&q=80",
  ];

  const li = await prisma.memorial.findUnique({
    where: { slug: "li-mingde" },
    include: { mediaItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (li?.mediaItems?.length) {
    let patched = 0;
    for (let i = 0; i < li.mediaItems.length; i++) {
      const m = li.mediaItems[i];
      if (m.imageUrl) continue;
      await prisma.memorialMedia.update({
        where: { id: m.id },
        data: { imageUrl: galleryPhotos[i % galleryPhotos.length] },
      });
      patched++;
    }
    if (patched) console.log(`Backfilled ${patched} demo gallery photo(s) for li-mingde`);
  }

  if (demo && productCount > 0) {
    console.log("Seed skipped — demo user and catalog already exist");
    return;
  }

  console.log("Running seed…");
  execSync("npm run seed", { stdio: "inherit" });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
