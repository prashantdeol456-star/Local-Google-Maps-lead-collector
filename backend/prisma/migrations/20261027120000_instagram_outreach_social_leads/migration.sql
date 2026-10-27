-- AlterTable
ALTER TABLE "OutreachContact" ADD COLUMN "instagramUrl" TEXT;

-- CreateTable
CREATE TABLE "SocialLead" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LinkedInCampaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL DEFAULT 'linkedin',
    "name" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "statusReason" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'assisted',
    "intervalSec" INTEGER NOT NULL DEFAULT 300,
    "dailyLimit" INTEGER NOT NULL DEFAULT 20,
    "windowStart" TEXT NOT NULL DEFAULT '10:00',
    "windowEnd" TEXT NOT NULL DEFAULT '18:00',
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "startAt" DATETIME,
    "lastSentAt" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LinkedInCampaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_LinkedInCampaign" ("completedAt", "createdAt", "createdById", "dailyLimit", "id", "intervalSec", "lastSentAt", "mode", "name", "startAt", "startedAt", "status", "statusReason", "templateId", "timeZone", "updatedAt", "windowEnd", "windowStart") SELECT "completedAt", "createdAt", "createdById", "dailyLimit", "id", "intervalSec", "lastSentAt", "mode", "name", "startAt", "startedAt", "status", "statusReason", "templateId", "timeZone", "updatedAt", "windowEnd", "windowStart" FROM "LinkedInCampaign";
DROP TABLE "LinkedInCampaign";
ALTER TABLE "new_LinkedInCampaign" RENAME TO "LinkedInCampaign";
CREATE INDEX "LinkedInCampaign_status_idx" ON "LinkedInCampaign"("status");
CREATE INDEX "LinkedInCampaign_platform_status_idx" ON "LinkedInCampaign"("platform", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "SocialLead_url_key" ON "SocialLead"("url");

-- CreateIndex
CREATE INDEX "SocialLead_platform_kind_idx" ON "SocialLead"("platform", "kind");

-- CreateIndex
CREATE INDEX "SocialLead_keyword_idx" ON "SocialLead"("keyword");

-- CreateIndex
CREATE INDEX "SocialLead_createdAt_idx" ON "SocialLead"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachContact_instagramUrl_key" ON "OutreachContact"("instagramUrl");

