-- AlterTable
ALTER TABLE "InboxMessage" ADD COLUMN "attachments" TEXT;

-- AlterTable
ALTER TABLE "AiAssistantSettings" ADD COLUMN "telegramBusiness" TEXT;

-- AlterTable
ALTER TABLE "SocialEngagement" ADD COLUMN "privateReplyAt" DATETIME;
ALTER TABLE "SocialEngagement" ADD COLUMN "privateReplyText" TEXT;

