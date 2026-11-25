-- AlterTable
ALTER TABLE "InboxConversation" ADD COLUMN     "contactId" TEXT,
ADD COLUMN     "labels" TEXT,
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "WaChat" ADD COLUMN     "contactId" TEXT;

