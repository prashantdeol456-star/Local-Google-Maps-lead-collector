-- Lead: coordinates + rename normalizedDomain -> normalizedWebsite.
-- Hand-written so existing values are kept (Prisma's generated SQL would drop the column).
ALTER TABLE "Lead" ADD COLUMN "latitude" REAL;
ALTER TABLE "Lead" ADD COLUMN "longitude" REAL;

DROP INDEX "Lead_normalizedDomain_idx";
ALTER TABLE "Lead" RENAME COLUMN "normalizedDomain" TO "normalizedWebsite";
CREATE INDEX "Lead_normalizedWebsite_idx" ON "Lead"("normalizedWebsite");

-- CollectionJob: search queue
ALTER TABLE "CollectionJob" ADD COLUMN "queueId" TEXT;
ALTER TABLE "CollectionJob" ADD COLUMN "position" INTEGER;
CREATE INDEX "CollectionJob_queueId_position_idx" ON "CollectionJob"("queueId", "position");
