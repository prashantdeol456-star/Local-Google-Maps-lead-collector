-- CreateTable
CREATE TABLE "LeadCommunicationPreference" (
    "leadId" TEXT NOT NULL PRIMARY KEY,
    "emailAllowed" BOOLEAN NOT NULL DEFAULT true,
    "whatsappAllowed" BOOLEAN NOT NULL DEFAULT false,
    "whatsappOptInAt" DATETIME,
    "whatsappOptInSource" TEXT,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "optOutReason" TEXT,
    "optedOutAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeadCommunicationPreference_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "provider" TEXT,
    "language" TEXT,
    "category" TEXT,
    "externalTemplateId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "statusReason" TEXT,
    "intervalSec" INTEGER NOT NULL DEFAULT 180,
    "dailyLimit" INTEGER NOT NULL DEFAULT 50,
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
    CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContactAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "campaignId" TEXT,
    "channel" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "templateId" TEXT,
    "toAddress" TEXT NOT NULL,
    "renderedSubject" TEXT,
    "renderedBody" TEXT,
    "externalMessageId" TEXT,
    "tries" INTEGER NOT NULL DEFAULT 0,
    "nextTryAt" DATETIME,
    "error" TEXT,
    "sentAt" DATETIME,
    "deliveredAt" DATETIME,
    "failedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContactAttempt_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContactAttempt_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MessageTemplate_channel_idx" ON "MessageTemplate"("channel");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "ContactAttempt_campaignId_status_createdAt_idx" ON "ContactAttempt"("campaignId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ContactAttempt_leadId_createdAt_idx" ON "ContactAttempt"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactAttempt_externalMessageId_idx" ON "ContactAttempt"("externalMessageId");

-- CreateIndex
CREATE INDEX "ContactAttempt_status_sentAt_idx" ON "ContactAttempt"("status", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContactAttempt_campaignId_leadId_key" ON "ContactAttempt"("campaignId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactAttempt_campaignId_toAddress_key" ON "ContactAttempt"("campaignId", "toAddress");
