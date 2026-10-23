-- CreateTable
CREATE TABLE "ServiceCategorySetting" (
    "id" TEXT NOT NULL DEFAULT 'service',
    "name" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ServiceCategorySetting_pkey" PRIMARY KEY ("id")
);
