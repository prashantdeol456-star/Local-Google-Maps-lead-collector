-- AlterTable
ALTER TABLE "WaChat" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "WaChat" ADD COLUMN "awaySentAt" DATETIME;
ALTER TABLE "WaChat" ADD COLUMN "blockedAt" DATETIME;
ALTER TABLE "WaChat" ADD COLUMN "greetedAt" DATETIME;
ALTER TABLE "WaChat" ADD COLUMN "labels" TEXT;
ALTER TABLE "WaChat" ADD COLUMN "mutedUntil" DATETIME;
ALTER TABLE "WaChat" ADD COLUMN "notes" TEXT;
ALTER TABLE "WaChat" ADD COLUMN "pinnedAt" DATETIME;

-- CreateTable
CREATE TABLE "WaQuickReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "shortcut" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WaChatSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "greetingOn" BOOLEAN NOT NULL DEFAULT false,
    "greetingText" TEXT,
    "awayOn" BOOLEAN NOT NULL DEFAULT false,
    "awayText" TEXT,
    "workStart" TEXT NOT NULL DEFAULT '10:00',
    "workEnd" TEXT NOT NULL DEFAULT '19:00',
    "workDays" TEXT NOT NULL DEFAULT '[1,2,3,4,5,6]',
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WaMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "chatId" TEXT NOT NULL,
    "wamid" TEXT,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT,
    "mediaId" TEXT,
    "mediaMime" TEXT,
    "mediaName" TEXT,
    "mediaSize" INTEGER,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "templateName" TEXT,
    "replyToWamid" TEXT,
    "forwarded" TEXT,
    "reactions" TEXT,
    "payload" TEXT,
    "editedAt" DATETIME,
    "revokedAt" DATETIME,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "hiddenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WaMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "WaChat" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WaMessage" ("body", "chatId", "createdAt", "direction", "error", "id", "mediaId", "mediaMime", "mediaName", "mediaSize", "ownerId", "status", "templateName", "type", "wamid") SELECT "body", "chatId", "createdAt", "direction", "error", "id", "mediaId", "mediaMime", "mediaName", "mediaSize", "ownerId", "status", "templateName", "type", "wamid" FROM "WaMessage";
DROP TABLE "WaMessage";
ALTER TABLE "new_WaMessage" RENAME TO "WaMessage";
CREATE INDEX "WaMessage_chatId_createdAt_idx" ON "WaMessage"("chatId", "createdAt");
CREATE INDEX "WaMessage_wamid_idx" ON "WaMessage"("wamid");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "WaQuickReply_ownerId_idx" ON "WaQuickReply"("ownerId");

-- CreateIndex
CREATE INDEX "WaChatSettings_ownerId_idx" ON "WaChatSettings"("ownerId");

