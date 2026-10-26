-- CreateTable
CREATE TABLE "OutreachContact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "linkedinUrl" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "designation" TEXT,
    "company" TEXT,
    "listName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'sheet',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LinkedInCampaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
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

-- CreateTable
CREATE TABLE "LinkedInMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT,
    "profileUrl" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "renderedBody" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "claimedAt" DATETIME,
    "sentAt" DATETIME,
    "failedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LinkedInMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "LinkedInCampaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LinkedInMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "OutreachContact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "OutreachContact_linkedinUrl_key" ON "OutreachContact"("linkedinUrl");

-- CreateIndex
CREATE INDEX "OutreachContact_listName_idx" ON "OutreachContact"("listName");

-- CreateIndex
CREATE INDEX "OutreachContact_email_idx" ON "OutreachContact"("email");

-- CreateIndex
CREATE INDEX "OutreachContact_createdAt_idx" ON "OutreachContact"("createdAt");

-- CreateIndex
CREATE INDEX "LinkedInCampaign_status_idx" ON "LinkedInCampaign"("status");

-- CreateIndex
CREATE INDEX "LinkedInMessage_campaignId_status_createdAt_idx" ON "LinkedInMessage"("campaignId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "LinkedInMessage_status_updatedAt_idx" ON "LinkedInMessage"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "LinkedInMessage_contactId_idx" ON "LinkedInMessage"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedInMessage_campaignId_profileUrl_key" ON "LinkedInMessage"("campaignId", "profileUrl");
