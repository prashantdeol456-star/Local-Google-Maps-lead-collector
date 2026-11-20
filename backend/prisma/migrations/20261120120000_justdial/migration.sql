-- CreateTable
CREATE TABLE "JustdialDetail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "leadId" TEXT NOT NULL,
    "docid" TEXT NOT NULL,
    "jdUrl" TEXT,
    "jdPhone" TEXT,
    "jdRating" REAL,
    "jdReviewCount" INTEGER,
    "categories" TEXT,
    "area" TEXT,
    "established" TEXT,
    "hours" TEXT,
    "photos" TEXT,
    "mapsMatched" BOOLEAN NOT NULL DEFAULT false,
    "mapsName" TEXT,
    "mapsPhone" TEXT,
    "mapsWebsite" TEXT,
    "mapsRating" REAL,
    "mapsReviewCount" INTEGER,
    "mapsUrl" TEXT,
    "emailCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JustdialDetail_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JustdialJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "jobId" TEXT NOT NULL,
    "templateId" TEXT,
    "campaignId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "JustdialDetail_leadId_key" ON "JustdialDetail"("leadId");

-- CreateIndex
CREATE INDEX "JustdialDetail_ownerId_idx" ON "JustdialDetail"("ownerId");

-- CreateIndex
CREATE INDEX "JustdialDetail_emailCheckedAt_idx" ON "JustdialDetail"("emailCheckedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JustdialJob_jobId_key" ON "JustdialJob"("jobId");

-- CreateIndex
CREATE INDEX "JustdialJob_ownerId_idx" ON "JustdialJob"("ownerId");

