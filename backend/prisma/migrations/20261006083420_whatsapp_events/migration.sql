-- AlterTable
ALTER TABLE "ContactAttempt" ADD COLUMN "readAt" DATETIME;

-- CreateTable
CREATE TABLE "WhatsAppEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "attemptId" TEXT,
    "leadId" TEXT,
    "phone" TEXT,
    "providerEventId" TEXT,
    "externalMessageId" TEXT,
    "provider" TEXT NOT NULL,
    "text" TEXT,
    "metadata" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ContactAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WhatsAppEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppEvent_providerEventId_key" ON "WhatsAppEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "WhatsAppEvent_attemptId_occurredAt_idx" ON "WhatsAppEvent"("attemptId", "occurredAt");

-- CreateIndex
CREATE INDEX "WhatsAppEvent_leadId_occurredAt_idx" ON "WhatsAppEvent"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "WhatsAppEvent_type_occurredAt_idx" ON "WhatsAppEvent"("type", "occurredAt");
