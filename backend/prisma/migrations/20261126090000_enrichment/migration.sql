-- CreateTable
CREATE TABLE "HunterAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyEnc" TEXT NOT NULL,
    "keyHint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "statusReason" TEXT,
    "planName" TEXT,
    "creditsUsed" REAL,
    "creditsAvailable" REAL,
    "resetDate" DATETIME,
    "exhaustedUntil" DATETIME,
    "checkedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EnrichLookup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'hunter',
    "kind" TEXT NOT NULL,
    "queryKey" TEXT NOT NULL,
    "reservedUnits" REAL NOT NULL,
    "usedUnits" REAL,
    "status" TEXT NOT NULL,
    "result" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" DATETIME
);

-- CreateIndex
CREATE INDEX "EnrichLookup_ownerId_queryKey_idx" ON "EnrichLookup"("ownerId", "queryKey");

-- CreateIndex
CREATE INDEX "EnrichLookup_ownerId_createdAt_idx" ON "EnrichLookup"("ownerId", "createdAt");

