-- CreateTable
CREATE TABLE "MarketplaceSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "configEnc" TEXT NOT NULL,
    "configHint" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "lastError" TEXT,
    "cursorAt" DATETIME,
    "lastPolledAt" DATETIME,
    "lastLeadAt" DATETIME,
    "waTemplateId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketplaceLead" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "receivedAt" DATETIME NOT NULL,
    "contactId" TEXT,
    "followUp" TEXT NOT NULL DEFAULT 'none',
    "followUpNote" TEXT,
    "waChatId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "MarketplaceSource_ownerId_idx" ON "MarketplaceSource"("ownerId");

-- CreateIndex
CREATE INDEX "MarketplaceLead_ownerId_receivedAt_idx" ON "MarketplaceLead"("ownerId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceLead_sourceId_externalId_key" ON "MarketplaceLead"("sourceId", "externalId");

