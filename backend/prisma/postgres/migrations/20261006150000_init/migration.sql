-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'running', 'paused', 'completed', 'failed', 'stopped');

-- CreateEnum
CREATE TYPE "ItemResult" AS ENUM ('new', 'duplicate', 'error');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('email', 'whatsapp');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'running', 'paused', 'completed', 'stopped');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('queued', 'sending', 'sent', 'delivered', 'failed', 'skipped', 'cancelled');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('info', 'success', 'warning', 'error');

-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('sent', 'delivered', 'delivery_delayed', 'opened', 'clicked', 'bounced', 'complained', 'failed', 'replied', 'unsubscribed');

-- CreateEnum
CREATE TYPE "WhatsAppEventType" AS ENUM ('sent', 'delivered', 'read', 'failed', 'received', 'opted_out', 'marketing_resumed');

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "scope" TEXT NOT NULL DEFAULT 'full',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "placeId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "postalCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "rating" DOUBLE PRECISION,
    "reviewCount" INTEGER,
    "mapsUrl" TEXT,
    "searchKeyword" TEXT,
    "source" TEXT NOT NULL DEFAULT 'google_maps',
    "normalizedName" TEXT NOT NULL,
    "normalizedPhone" TEXT,
    "normalizedWebsite" TEXT,
    "normalizedAddress" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionJob" (
    "id" TEXT NOT NULL,
    "searchKeyword" TEXT NOT NULL,
    "location" TEXT,
    "maxRecords" INTEGER,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "statusReason" TEXT,
    "totalFound" INTEGER NOT NULL DEFAULT 0,
    "newRecords" INTEGER NOT NULL DEFAULT 0,
    "duplicateRecords" INTEGER NOT NULL DEFAULT 0,
    "errorRecords" INTEGER NOT NULL DEFAULT 0,
    "queueId" TEXT,
    "position" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "CollectionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "result" "ItemResult" NOT NULL,
    "matchedBy" TEXT,
    "leadId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentLog" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "action" TEXT NOT NULL,
    "status" "LogLevel" NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadCommunicationPreference" (
    "leadId" TEXT NOT NULL,
    "emailAllowed" BOOLEAN NOT NULL DEFAULT true,
    "whatsappAllowed" BOOLEAN NOT NULL DEFAULT false,
    "whatsappOptInAt" TIMESTAMP(3),
    "whatsappOptInSource" TEXT,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "optOutReason" TEXT,
    "optedOutAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadCommunicationPreference_pkey" PRIMARY KEY ("leadId")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "provider" TEXT,
    "language" TEXT,
    "category" TEXT,
    "externalTemplateId" TEXT,
    "approvalStatus" TEXT,
    "paramFormat" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "name" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "statusReason" TEXT,
    "intervalSec" INTEGER NOT NULL DEFAULT 180,
    "dailyLimit" INTEGER NOT NULL DEFAULT 50,
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

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactAttempt" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "campaignId" TEXT,
    "channel" "Channel" NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'queued',
    "templateId" TEXT,
    "toAddress" TEXT NOT NULL,
    "renderedSubject" TEXT,
    "renderedBody" TEXT,
    "externalMessageId" TEXT,
    "tries" INTEGER NOT NULL DEFAULT 0,
    "nextTryAt" TIMESTAMP(3),
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "complainedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailEvent" (
    "id" TEXT NOT NULL,
    "type" "EmailEventType" NOT NULL,
    "attemptId" TEXT,
    "leadId" TEXT,
    "providerEventId" TEXT,
    "source" TEXT NOT NULL,
    "metadata" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedLink" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackedLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppEvent" (
    "id" TEXT NOT NULL,
    "type" "WhatsAppEventType" NOT NULL,
    "attemptId" TEXT,
    "leadId" TEXT,
    "phone" TEXT,
    "providerEventId" TEXT,
    "externalMessageId" TEXT,
    "provider" TEXT NOT NULL,
    "text" TEXT,
    "metadata" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "address" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "leadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "secretHint" TEXT NOT NULL,
    "events" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseStatus" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_placeId_key" ON "Lead"("placeId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_dedupeKey_key" ON "Lead"("dedupeKey");

-- CreateIndex
CREATE INDEX "Lead_normalizedPhone_idx" ON "Lead"("normalizedPhone");

-- CreateIndex
CREATE INDEX "Lead_normalizedWebsite_idx" ON "Lead"("normalizedWebsite");

-- CreateIndex
CREATE INDEX "Lead_normalizedName_idx" ON "Lead"("normalizedName");

-- CreateIndex
CREATE INDEX "Lead_city_idx" ON "Lead"("city");

-- CreateIndex
CREATE INDEX "Lead_category_idx" ON "Lead"("category");

-- CreateIndex
CREATE INDEX "Lead_searchKeyword_idx" ON "Lead"("searchKeyword");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "CollectionJob_status_idx" ON "CollectionJob"("status");

-- CreateIndex
CREATE INDEX "CollectionJob_createdAt_idx" ON "CollectionJob"("createdAt");

-- CreateIndex
CREATE INDEX "CollectionJob_queueId_position_idx" ON "CollectionJob"("queueId", "position");

-- CreateIndex
CREATE INDEX "JobItem_leadId_idx" ON "JobItem"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "JobItem_jobId_clientKey_key" ON "JobItem"("jobId", "clientKey");

-- CreateIndex
CREATE INDEX "AgentLog_jobId_createdAt_idx" ON "AgentLog"("jobId", "createdAt");

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

-- CreateIndex
CREATE UNIQUE INDEX "EmailEvent_providerEventId_key" ON "EmailEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "EmailEvent_attemptId_occurredAt_idx" ON "EmailEvent"("attemptId", "occurredAt");

-- CreateIndex
CREATE INDEX "EmailEvent_leadId_occurredAt_idx" ON "EmailEvent"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "EmailEvent_type_occurredAt_idx" ON "EmailEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "TrackedLink_attemptId_idx" ON "TrackedLink"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppEvent_providerEventId_key" ON "WhatsAppEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "WhatsAppEvent_attemptId_occurredAt_idx" ON "WhatsAppEvent"("attemptId", "occurredAt");

-- CreateIndex
CREATE INDEX "WhatsAppEvent_leadId_occurredAt_idx" ON "WhatsAppEvent"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "WhatsAppEvent_type_occurredAt_idx" ON "WhatsAppEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "Suppression_leadId_idx" ON "Suppression"("leadId");

-- CreateIndex
CREATE INDEX "Suppression_createdAt_idx" ON "Suppression"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_channel_address_key" ON "Suppression"("channel", "address");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery"("endpointId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_endpointId_eventId_key" ON "WebhookDelivery"("endpointId", "eventId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionJob" ADD CONSTRAINT "CollectionJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobItem" ADD CONSTRAINT "JobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CollectionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobItem" ADD CONSTRAINT "JobItem_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentLog" ADD CONSTRAINT "AgentLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CollectionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCommunicationPreference" ADD CONSTRAINT "LeadCommunicationPreference_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ContactAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedLink" ADD CONSTRAINT "TrackedLink_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ContactAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppEvent" ADD CONSTRAINT "WhatsAppEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ContactAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppEvent" ADD CONSTRAINT "WhatsAppEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

