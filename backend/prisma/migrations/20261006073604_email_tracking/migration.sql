-- AlterTable
ALTER TABLE "ContactAttempt" ADD COLUMN "bouncedAt" DATETIME;
ALTER TABLE "ContactAttempt" ADD COLUMN "clickedAt" DATETIME;
ALTER TABLE "ContactAttempt" ADD COLUMN "complainedAt" DATETIME;
ALTER TABLE "ContactAttempt" ADD COLUMN "openedAt" DATETIME;
ALTER TABLE "ContactAttempt" ADD COLUMN "repliedAt" DATETIME;

-- CreateTable
CREATE TABLE "EmailEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "attemptId" TEXT,
    "leadId" TEXT,
    "providerEventId" TEXT,
    "source" TEXT NOT NULL,
    "metadata" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ContactAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmailEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrackedLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attemptId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackedLink_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ContactAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
