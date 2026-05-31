-- AlterTable MemorialMedia
ALTER TABLE "MemorialMedia" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
ALTER TABLE "MemorialMedia" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable Article
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "cat" TEXT NOT NULL,
    "catLabel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '📖',
    "bgStyle" TEXT NOT NULL DEFAULT 'linear-gradient(135deg,#e8f4f8,#d0e8f0)',
    "published" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable Product
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "listCents" INTEGER,
    "category" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🛍️',
    "bgStyle" TEXT NOT NULL DEFAULT 'linear-gradient(135deg,#f5f5f5,#e8e8e8)',
    "badge" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- AlterTable OrderInquiry
ALTER TABLE "OrderInquiry" ADD COLUMN IF NOT EXISTS "orderNumber" TEXT;
ALTER TABLE "OrderInquiry" ADD COLUMN IF NOT EXISTS "contactPhone" TEXT;
ALTER TABLE "OrderInquiry" ADD COLUMN IF NOT EXISTS "shippingAddress" TEXT;
ALTER TABLE "OrderInquiry" ADD COLUMN IF NOT EXISTS "shippingCity" TEXT;
ALTER TABLE "OrderInquiry" ADD COLUMN IF NOT EXISTS "shippingProvince" TEXT;
ALTER TABLE "OrderInquiry" ADD COLUMN IF NOT EXISTS "shippingPostal" TEXT;
ALTER TABLE "OrderInquiry" ADD COLUMN IF NOT EXISTS "itemsJson" TEXT;
ALTER TABLE "OrderInquiry" ADD COLUMN IF NOT EXISTS "totalCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrderInquiry" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "OrderInquiry" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT NOT NULL DEFAULT 'inquiry';
ALTER TABLE "OrderInquiry" ADD COLUMN IF NOT EXISTS "stripeSessionId" TEXT;

-- Backfill order numbers for existing rows
UPDATE "OrderInquiry" SET "orderNumber" = 'NG' || substr(id, 1, 8) WHERE "orderNumber" IS NULL;
ALTER TABLE "OrderInquiry" ALTER COLUMN "orderNumber" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Article_slug_key" ON "Article"("slug");
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");
CREATE UNIQUE INDEX "OrderInquiry_orderNumber_key" ON "OrderInquiry"("orderNumber");
