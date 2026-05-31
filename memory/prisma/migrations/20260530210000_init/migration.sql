-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Memorial" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "deathDate" TIMESTAMP(3) NOT NULL,
    "motto" TEXT,
    "privacy" TEXT NOT NULL DEFAULT 'family',
    "quietMode" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Memorial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemorialMember" (
    "id" TEXT NOT NULL,
    "memorialId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'family',
    "inviteToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemorialMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ritual" (
    "id" TEXT NOT NULL,
    "memorialId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT,
    "author" TEXT,
    "authorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ritual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryFragment" (
    "id" TEXT NOT NULL,
    "memorialId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "relation" TEXT,
    "year" TEXT,
    "author" TEXT,
    "authorUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryFragment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "memorialId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderDispatch" (
    "id" TEXT NOT NULL,
    "memorialId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotionSyncLog" (
    "id" TEXT NOT NULL,
    "memorialId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotionSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Memorial_slug_key" ON "Memorial"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "MemorialMember_inviteToken_key" ON "MemorialMember"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "MemorialMember_memorialId_email_key" ON "MemorialMember"("memorialId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_memorialId_email_key" ON "Reminder"("memorialId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderDispatch_memorialId_email_eventKey_eventDate_key" ON "ReminderDispatch"("memorialId", "email", "eventKey", "eventDate");

-- AddForeignKey
ALTER TABLE "Memorial" ADD CONSTRAINT "Memorial_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemorialMember" ADD CONSTRAINT "MemorialMember_memorialId_fkey" FOREIGN KEY ("memorialId") REFERENCES "Memorial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ritual" ADD CONSTRAINT "Ritual_memorialId_fkey" FOREIGN KEY ("memorialId") REFERENCES "Memorial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ritual" ADD CONSTRAINT "Ritual_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryFragment" ADD CONSTRAINT "MemoryFragment_memorialId_fkey" FOREIGN KEY ("memorialId") REFERENCES "Memorial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryFragment" ADD CONSTRAINT "MemoryFragment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_memorialId_fkey" FOREIGN KEY ("memorialId") REFERENCES "Memorial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotionSyncLog" ADD CONSTRAINT "NotionSyncLog_memorialId_fkey" FOREIGN KEY ("memorialId") REFERENCES "Memorial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
