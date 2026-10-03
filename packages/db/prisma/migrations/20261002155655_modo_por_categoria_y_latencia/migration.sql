-- AlterTable
ALTER TABLE "Decision" ADD COLUMN     "latencyMs" INTEGER;

-- CreateTable
CREATE TABLE "CategorySetting" (
    "category" TEXT NOT NULL,
    "mode" "DecisionMode" NOT NULL DEFAULT 'shadow',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "CategorySetting_pkey" PRIMARY KEY ("category")
);
