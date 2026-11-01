-- DropIndex
DROP INDEX "Suppression_channel_address_key";

-- DropIndex
DROP INDEX "OutreachContact_linkedinUrl_key";

-- DropIndex
DROP INDEX "OutreachContact_instagramUrl_key";

-- AlterTable
ALTER TABLE "LeadCommunicationPreference" ADD COLUMN "ownerId" TEXT;

-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN "ownerId" TEXT;

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "ownerId" TEXT;

-- AlterTable
ALTER TABLE "ContactAttempt" ADD COLUMN "ownerId" TEXT;

-- AlterTable
ALTER TABLE "EmailEvent" ADD COLUMN "ownerId" TEXT;

-- AlterTable
ALTER TABLE "TrackedLink" ADD COLUMN "ownerId" TEXT;

-- AlterTable
ALTER TABLE "WhatsAppEvent" ADD COLUMN "ownerId" TEXT;

-- AlterTable
ALTER TABLE "Suppression" ADD COLUMN "ownerId" TEXT;

-- AlterTable
ALTER TABLE "OutreachContact" ADD COLUMN "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "LeadCommunicationPreference_ownerId_idx" ON "LeadCommunicationPreference"("ownerId");

-- CreateIndex
CREATE INDEX "MessageTemplate_ownerId_idx" ON "MessageTemplate"("ownerId");

-- CreateIndex
CREATE INDEX "Campaign_ownerId_idx" ON "Campaign"("ownerId");

-- CreateIndex
CREATE INDEX "ContactAttempt_ownerId_idx" ON "ContactAttempt"("ownerId");

-- CreateIndex
CREATE INDEX "EmailEvent_ownerId_idx" ON "EmailEvent"("ownerId");

-- CreateIndex
CREATE INDEX "TrackedLink_ownerId_idx" ON "TrackedLink"("ownerId");

-- CreateIndex
CREATE INDEX "WhatsAppEvent_ownerId_idx" ON "WhatsAppEvent"("ownerId");

-- CreateIndex
CREATE INDEX "Suppression_ownerId_idx" ON "Suppression"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_ownerId_channel_address_key" ON "Suppression"("ownerId", "channel", "address");

-- CreateIndex
CREATE INDEX "OutreachContact_ownerId_idx" ON "OutreachContact"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachContact_ownerId_linkedinUrl_key" ON "OutreachContact"("ownerId", "linkedinUrl");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachContact_ownerId_instagramUrl_key" ON "OutreachContact"("ownerId", "instagramUrl");


-- Outreach data so far was created by super admins only: it belongs to the first admin,
-- preferences to the owner of their lead.
UPDATE "MessageTemplate" SET "ownerId" = (SELECT "id" FROM "AdminUser" ORDER BY "createdAt" LIMIT 1) WHERE "ownerId" IS NULL;
UPDATE "Campaign" SET "ownerId" = (SELECT "id" FROM "AdminUser" ORDER BY "createdAt" LIMIT 1) WHERE "ownerId" IS NULL;
UPDATE "ContactAttempt" SET "ownerId" = (SELECT "id" FROM "AdminUser" ORDER BY "createdAt" LIMIT 1) WHERE "ownerId" IS NULL;
UPDATE "EmailEvent" SET "ownerId" = (SELECT "id" FROM "AdminUser" ORDER BY "createdAt" LIMIT 1) WHERE "ownerId" IS NULL;
UPDATE "TrackedLink" SET "ownerId" = (SELECT "id" FROM "AdminUser" ORDER BY "createdAt" LIMIT 1) WHERE "ownerId" IS NULL;
UPDATE "WhatsAppEvent" SET "ownerId" = (SELECT "id" FROM "AdminUser" ORDER BY "createdAt" LIMIT 1) WHERE "ownerId" IS NULL;
UPDATE "Suppression" SET "ownerId" = (SELECT "id" FROM "AdminUser" ORDER BY "createdAt" LIMIT 1) WHERE "ownerId" IS NULL;
UPDATE "OutreachContact" SET "ownerId" = (SELECT "id" FROM "AdminUser" ORDER BY "createdAt" LIMIT 1) WHERE "ownerId" IS NULL;
UPDATE "LeadCommunicationPreference" SET "ownerId" = (SELECT "ownerId" FROM "Lead" WHERE "Lead"."id" = "LeadCommunicationPreference"."leadId") WHERE "ownerId" IS NULL;
