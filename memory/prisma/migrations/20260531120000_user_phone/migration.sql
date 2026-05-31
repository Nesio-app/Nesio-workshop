-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_phone_key" ON "User"("phone");
