-- AlterTable
ALTER TABLE "Memorial" ADD COLUMN IF NOT EXISTS "bioHtml" TEXT;
ALTER TABLE "Memorial" ADD COLUMN IF NOT EXISTS "familyNote" TEXT;
ALTER TABLE "Memorial" ADD COLUMN IF NOT EXISTS "themeId" TEXT NOT NULL DEFAULT 'ink-default';

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL,
    "memorialId" TEXT NOT NULL,
    "yearLabel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyPerson" (
    "id" TEXT NOT NULL,
    "memorialId" TEXT NOT NULL,
    "groupLabel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "avatarChar" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FamilyPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemorialMedia" (
    "id" TEXT NOT NULL,
    "memorialId" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '📸',
    "yearLabel" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MemorialMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderInquiry" (
    "id" TEXT NOT NULL,
    "memorialSlug" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactName" TEXT,
    "items" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderInquiry_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_memorialId_fkey" FOREIGN KEY ("memorialId") REFERENCES "Memorial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyPerson" ADD CONSTRAINT "FamilyPerson_memorialId_fkey" FOREIGN KEY ("memorialId") REFERENCES "Memorial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemorialMedia" ADD CONSTRAINT "MemorialMedia_memorialId_fkey" FOREIGN KEY ("memorialId") REFERENCES "Memorial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
