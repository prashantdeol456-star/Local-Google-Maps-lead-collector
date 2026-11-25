-- AlterTable
ALTER TABLE "InboxConversation" ADD COLUMN "contactId" TEXT;
ALTER TABLE "InboxConversation" ADD COLUMN "labels" TEXT;
ALTER TABLE "InboxConversation" ADD COLUMN "notes" TEXT;

-- AlterTable
ALTER TABLE "WaChat" ADD COLUMN "contactId" TEXT;

