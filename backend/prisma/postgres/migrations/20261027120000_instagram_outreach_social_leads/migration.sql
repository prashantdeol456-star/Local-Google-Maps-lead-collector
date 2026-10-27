-- AlterEnum
ALTER TYPE "TemplateChannel" ADD VALUE 'instagram';

-- AlterTable
ALTER TABLE "OutreachContact" ADD COLUMN "instagramUrl" TEXT;
ALTER TABLE "LinkedInCampaign" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'linkedin';

-- CreateTable
CREATE TABLE "SocialLead" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "handle" TEXT,
    "name" TEXT NOT NULL,
    "bio" TEXT,
    "category" TEXT,
    "followers" INTEGER,
    "audienceText" TEXT,
    "privacy" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "location" TEXT,
    "keyword" TEXT,
    "tag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutreachContact_instagramUrl_key" ON "OutreachContact"("instagramUrl");
CREATE INDEX "LinkedInCampaign_platform_status_idx" ON "LinkedInCampaign"("platform", "status");
CREATE UNIQUE INDEX "SocialLead_url_key" ON "SocialLead"("url");
CREATE INDEX "SocialLead_platform_kind_idx" ON "SocialLead"("platform", "kind");
CREATE INDEX "SocialLead_keyword_idx" ON "SocialLead"("keyword");
CREATE INDEX "SocialLead_createdAt_idx" ON "SocialLead"("createdAt");
