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
