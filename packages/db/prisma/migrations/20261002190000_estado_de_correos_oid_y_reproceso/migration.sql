-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('pending', 'processed', 'failed');

-- AlterTable
ALTER TABLE "AllowedUser" ADD COLUMN "oid" TEXT;

-- AlterTable
ALTER TABLE "Decision" ADD COLUMN "degraded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Message"
  ADD COLUMN "needsReprocess" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "status" "MessageStatus" NOT NULL DEFAULT 'pending';

-- Los correos que ya tienen decisión están procesados (hasta ahora el correo solo se creaba al decidir).
UPDATE "Message" SET "status" = 'processed'
WHERE EXISTS (SELECT 1 FROM "Decision" WHERE "Decision"."messageId" = "Message"."id");

-- CreateIndex
CREATE UNIQUE INDEX "AllowedUser_oid_key" ON "AllowedUser"("oid");

-- CreateIndex
CREATE INDEX "Message_status_idx" ON "Message"("status");

-- CreateIndex
CREATE INDEX "Message_needsReprocess_idx" ON "Message"("needsReprocess");
