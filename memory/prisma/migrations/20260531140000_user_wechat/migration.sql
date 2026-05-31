-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "wechatOpenId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_wechatOpenId_key" ON "User"("wechatOpenId");
