-- CreateEnum
CREATE TYPE "MessageFolder" AS ENUM ('inbox', 'foodbox', 'lateral', 'other', 'missing');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "folder" "MessageFolder",
ADD COLUMN     "folderCheckedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Message_folderCheckedAt_idx" ON "Message"("folderCheckedAt");
