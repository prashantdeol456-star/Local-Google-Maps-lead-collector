-- CreateTable
CREATE TABLE "LinkedInLead" (
    "id" TEXT NOT NULL,
    "profileUrl" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headline" TEXT,
    "company" TEXT,
    "location" TEXT,
    "emails" TEXT NOT NULL DEFAULT '[]',
    "phones" TEXT NOT NULL DEFAULT '[]',
    "websites" TEXT NOT NULL DEFAULT '[]',
    "ims" TEXT NOT NULL DEFAULT '[]',
    "birthday" TEXT,
    "address" TEXT,
    "connectedSince" TEXT,
    "notes" TEXT,
    "tag" TEXT,
    "source" TEXT NOT NULL,
    "hasEmail" BOOLEAN NOT NULL DEFAULT false,
    "hasPhone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkedInLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LinkedInLead_profileUrl_key" ON "LinkedInLead"("profileUrl");

-- CreateIndex
CREATE INDEX "LinkedInLead_createdAt_idx" ON "LinkedInLead"("createdAt");

-- CreateIndex
CREATE INDEX "LinkedInLead_company_idx" ON "LinkedInLead"("company");

-- CreateIndex
CREATE INDEX "LinkedInLead_tag_idx" ON "LinkedInLead"("tag");

