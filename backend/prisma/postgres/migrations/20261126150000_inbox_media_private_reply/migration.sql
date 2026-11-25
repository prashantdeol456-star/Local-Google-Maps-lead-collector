-- AlterTable
ALTER TABLE "InboxMessage" ADD COLUMN     "attachments" TEXT;

-- AlterTable
ALTER TABLE "AiAssistantSettings" ADD COLUMN     "telegramBusiness" TEXT;

-- AlterTable
ALTER TABLE "SocialEngagement" ADD COLUMN     "privateReplyAt" TIMESTAMP(3),
ADD COLUMN     "privateReplyText" TEXT;

