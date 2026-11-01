-- DropIndex
DROP INDEX "SocialAccount_platform_externalId_key";

-- DropIndex
DROP INDEX "InboxConversation_platform_accountKey_externalThreadId_key";

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN "ownerId" TEXT;

-- AlterTable
ALTER TABLE "InboxConversation" ADD COLUMN "ownerId" TEXT;

-- AlterTable
ALTER TABLE "InboxMessage" ADD COLUMN "ownerId" TEXT;

-- AlterTable
ALTER TABLE "InboxDraft" ADD COLUMN "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "SocialAccount_ownerId_idx" ON "SocialAccount"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_ownerId_platform_externalId_key" ON "SocialAccount"("ownerId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "InboxConversation_ownerId_idx" ON "InboxConversation"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "InboxConversation_ownerId_platform_accountKey_externalThreadId_key" ON "InboxConversation"("ownerId", "platform", "accountKey", "externalThreadId");

-- CreateIndex
CREATE INDEX "InboxMessage_ownerId_idx" ON "InboxMessage"("ownerId");

-- CreateIndex
CREATE INDEX "InboxDraft_ownerId_idx" ON "InboxDraft"("ownerId");


-- Chats, drafts and connected accounts so far belong to the first admin; the single AI
-- settings row becomes that admin's.
UPDATE "SocialAccount" SET "ownerId" = (SELECT "id" FROM "AdminUser" ORDER BY "createdAt" LIMIT 1) WHERE "ownerId" IS NULL;
UPDATE "InboxConversation" SET "ownerId" = (SELECT "id" FROM "AdminUser" ORDER BY "createdAt" LIMIT 1) WHERE "ownerId" IS NULL;
UPDATE "InboxMessage" SET "ownerId" = (SELECT "id" FROM "AdminUser" ORDER BY "createdAt" LIMIT 1) WHERE "ownerId" IS NULL;
UPDATE "InboxDraft" SET "ownerId" = (SELECT "id" FROM "AdminUser" ORDER BY "createdAt" LIMIT 1) WHERE "ownerId" IS NULL;
UPDATE "AiAssistantSettings" SET "id" = (SELECT "id" FROM "AdminUser" ORDER BY "createdAt" LIMIT 1)
  WHERE "id" = 'default' AND EXISTS (SELECT 1 FROM "AdminUser");
