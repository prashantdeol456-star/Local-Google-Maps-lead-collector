-- CreateTable
CREATE TABLE "JustdialDetail" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "leadId" TEXT NOT NULL,
    "docid" TEXT NOT NULL,
    "jdUrl" TEXT,
    "jdPhone" TEXT,
    "jdRating" DOUBLE PRECISION,
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
    "mapsRating" DOUBLE PRECISION,
    "mapsReviewCount" INTEGER,
    "mapsUrl" TEXT,
    "emailCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JustdialDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JustdialJob" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "jobId" TEXT NOT NULL,
    "templateId" TEXT,
    "campaignId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JustdialJob_pkey" PRIMARY KEY ("id")
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


-- AddForeignKey
ALTER TABLE "JustdialDetail" ADD CONSTRAINT "JustdialDetail_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
