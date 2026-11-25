-- CreateTable
CREATE TABLE "HunterAccount" (
    "id" TEXT NOT NULL,
    "keyEnc" TEXT NOT NULL,
    "keyHint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "statusReason" TEXT,
    "planName" TEXT,
    "creditsUsed" DOUBLE PRECISION,
    "creditsAvailable" DOUBLE PRECISION,
    "resetDate" TIMESTAMP(3),
    "exhaustedUntil" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HunterAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichLookup" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'hunter',
    "kind" TEXT NOT NULL,
    "queryKey" TEXT NOT NULL,
    "reservedUnits" DOUBLE PRECISION NOT NULL,
    "usedUnits" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "result" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "EnrichLookup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnrichLookup_ownerId_queryKey_idx" ON "EnrichLookup"("ownerId", "queryKey");

-- CreateIndex
CREATE INDEX "EnrichLookup_ownerId_createdAt_idx" ON "EnrichLookup"("ownerId", "createdAt");

