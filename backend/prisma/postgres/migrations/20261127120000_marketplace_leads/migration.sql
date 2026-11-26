-- CreateTable
CREATE TABLE "MarketplaceSource" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "configEnc" TEXT NOT NULL,
    "configHint" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "lastError" TEXT,
    "cursorAt" TIMESTAMP(3),
    "lastPolledAt" TIMESTAMP(3),
    "lastLeadAt" TIMESTAMP(3),
    "waTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceLead" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "sourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "email" TEXT,
    "company" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "product" TEXT,
    "subject" TEXT,
    "message" TEXT,
    "queryType" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "contactId" TEXT,
    "followUp" TEXT NOT NULL DEFAULT 'none',
    "followUpNote" TEXT,
    "waChatId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketplaceSource_ownerId_idx" ON "MarketplaceSource"("ownerId");

-- CreateIndex
CREATE INDEX "MarketplaceLead_ownerId_receivedAt_idx" ON "MarketplaceLead"("ownerId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceLead_sourceId_externalId_key" ON "MarketplaceLead"("sourceId", "externalId");

