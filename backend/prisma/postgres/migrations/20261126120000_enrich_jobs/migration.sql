-- CreateTable
CREATE TABLE "EnrichJob" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "fileName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "useWebsites" BOOLEAN NOT NULL DEFAULT true,
    "useHunter" BOOLEAN NOT NULL DEFAULT false,
    "hunterBudget" INTEGER NOT NULL DEFAULT 0,
    "hunterUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "done" INTEGER NOT NULL DEFAULT 0,
    "found" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "EnrichJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichJobRow" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "jobId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "name" TEXT,
    "company" TEXT,
    "website" TEXT,
    "linkedinUrl" TEXT,
    "designation" TEXT,
    "inputEmail" TEXT,
    "inputPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "emails" TEXT NOT NULL DEFAULT '[]',
    "phones" TEXT NOT NULL DEFAULT '[]',
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnrichJobRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnrichJob_ownerId_createdAt_idx" ON "EnrichJob"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "EnrichJob_status_idx" ON "EnrichJob"("status");

-- CreateIndex
CREATE INDEX "EnrichJobRow_jobId_idx_idx" ON "EnrichJobRow"("jobId", "idx");

-- CreateIndex
CREATE INDEX "EnrichJobRow_jobId_status_idx" ON "EnrichJobRow"("jobId", "status");

