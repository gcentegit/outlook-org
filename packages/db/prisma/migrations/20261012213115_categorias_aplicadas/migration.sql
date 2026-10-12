-- CreateTable
CREATE TABLE "AppliedCategory" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppliedCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppliedCategory_messageId_category_key" ON "AppliedCategory"("messageId", "category");

-- AddForeignKey
ALTER TABLE "AppliedCategory" ADD CONSTRAINT "AppliedCategory_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
