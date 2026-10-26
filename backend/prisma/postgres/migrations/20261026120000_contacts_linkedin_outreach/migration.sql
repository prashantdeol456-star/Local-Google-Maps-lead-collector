-- CreateEnum
CREATE TYPE "TemplateChannel" AS ENUM ('email', 'whatsapp', 'sms', 'linkedin');

-- AlterTable: templates get their own channel type (sms and linkedin have no campaigns in "Campaign")
ALTER TABLE "MessageTemplate" ALTER COLUMN "channel" TYPE "TemplateChannel" USING ("channel"::text::"TemplateChannel");

-- CreateTable
CREATE TABLE "OutreachContact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "linkedinUrl" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "designation" TEXT,
    "company" TEXT,
    "listName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'sheet',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkedInCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "statusReason" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'assisted',
    "intervalSec" INTEGER NOT NULL DEFAULT 300,
    "dailyLimit" INTEGER NOT NULL DEFAULT 20,
    "windowStart" TEXT NOT NULL DEFAULT '10:00',
    "windowEnd" TEXT NOT NULL DEFAULT '18:00',
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "startAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkedInCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkedInMessage" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT,
    "profileUrl" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "renderedBody" TEXT NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkedInMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutreachContact_linkedinUrl_key" ON "OutreachContact"("linkedinUrl");
CREATE INDEX "OutreachContact_listName_idx" ON "OutreachContact"("listName");
CREATE INDEX "OutreachContact_email_idx" ON "OutreachContact"("email");
CREATE INDEX "OutreachContact_createdAt_idx" ON "OutreachContact"("createdAt");
CREATE INDEX "LinkedInCampaign_status_idx" ON "LinkedInCampaign"("status");
CREATE INDEX "LinkedInMessage_campaignId_status_createdAt_idx" ON "LinkedInMessage"("campaignId", "status", "createdAt");
CREATE INDEX "LinkedInMessage_status_updatedAt_idx" ON "LinkedInMessage"("status", "updatedAt");
CREATE INDEX "LinkedInMessage_contactId_idx" ON "LinkedInMessage"("contactId");
CREATE UNIQUE INDEX "LinkedInMessage_campaignId_profileUrl_key" ON "LinkedInMessage"("campaignId", "profileUrl");

-- AddForeignKey
ALTER TABLE "LinkedInCampaign" ADD CONSTRAINT "LinkedInCampaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LinkedInMessage" ADD CONSTRAINT "LinkedInMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "LinkedInCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LinkedInMessage" ADD CONSTRAINT "LinkedInMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "OutreachContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
