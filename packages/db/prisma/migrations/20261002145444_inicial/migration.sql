-- CreateEnum
CREATE TYPE "RuleType" AS ENUM ('cif', 'razon_social', 'remitente', 'dominio', 'palabra_clave');

-- CreateEnum
CREATE TYPE "RuleWeight" AS ENUM ('fuerte', 'medio');

-- CreateEnum
CREATE TYPE "ExtractionMethod" AS ENUM ('texto', 'ocr');

-- CreateEnum
CREATE TYPE "DecisionMode" AS ENUM ('shadow', 'live');

-- CreateTable
CREATE TABLE "SyncState" (
    "id" TEXT NOT NULL,
    "deltaLink" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "seenCategories" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttachmentText" (
    "id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "method" "ExtractionMethod" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttachmentText_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "type" "RuleType" NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "weight" "RuleWeight" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "decision" JSONB NOT NULL,
    "categories" TEXT[],
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costUsd" DECIMAL(10,6),
    "mode" "DecisionMode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Correction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "decisionId" TEXT,
    "proposed" TEXT[],
    "final" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Correction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmSetting" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "LlmSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllowedUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllowedUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryAudit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategoryAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "Message_receivedAt_idx" ON "Message"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttachmentText_hash_key" ON "AttachmentText"("hash");

-- CreateIndex
CREATE INDEX "AttachmentText_expiresAt_idx" ON "AttachmentText"("expiresAt");

-- CreateIndex
CREATE INDEX "Rule_active_idx" ON "Rule"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Rule_type_value_category_key" ON "Rule"("type", "value", "category");

-- CreateIndex
CREATE INDEX "Decision_messageId_idx" ON "Decision"("messageId");

-- CreateIndex
CREATE INDEX "Decision_createdAt_idx" ON "Decision"("createdAt");

-- CreateIndex
CREATE INDEX "Correction_messageId_idx" ON "Correction"("messageId");

-- CreateIndex
CREATE INDEX "Correction_createdAt_idx" ON "Correction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LlmSetting_provider_model_key" ON "LlmSetting"("provider", "model");

-- CreateIndex
CREATE UNIQUE INDEX "AllowedUser_email_key" ON "AllowedUser"("email");

-- CreateIndex
CREATE INDEX "CategoryAudit_createdAt_idx" ON "CategoryAudit"("createdAt");

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
