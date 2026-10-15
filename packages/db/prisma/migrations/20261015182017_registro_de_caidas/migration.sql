-- CreateTable
CREATE TABLE "Outage" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "cause" TEXT NOT NULL,

    CONSTRAINT "Outage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Outage_startedAt_idx" ON "Outage"("startedAt");
