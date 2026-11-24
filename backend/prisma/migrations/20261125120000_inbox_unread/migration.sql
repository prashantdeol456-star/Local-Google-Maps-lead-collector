-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_InboxConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "platform" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "externalThreadId" TEXT NOT NULL,
    "participantId" TEXT,
    "participantName" TEXT NOT NULL,
    "participantUsername" TEXT,
    "replyMode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'needs_reply',
    "lastIntent" TEXT,
    "summary" TEXT,
    "lastInboundAt" DATETIME,
    "lastOutboundAt" DATETIME,
    "lastMessageAt" DATETIME NOT NULL,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_InboxConversation" ("accountKey", "createdAt", "externalThreadId", "id", "lastInboundAt", "lastIntent", "lastMessageAt", "lastOutboundAt", "ownerId", "participantId", "participantName", "participantUsername", "platform", "replyMode", "status", "summary", "updatedAt") SELECT "accountKey", "createdAt", "externalThreadId", "id", "lastInboundAt", "lastIntent", "lastMessageAt", "lastOutboundAt", "ownerId", "participantId", "participantName", "participantUsername", "platform", "replyMode", "status", "summary", "updatedAt" FROM "InboxConversation";
DROP TABLE "InboxConversation";
ALTER TABLE "new_InboxConversation" RENAME TO "InboxConversation";
CREATE INDEX "InboxConversation_status_lastMessageAt_idx" ON "InboxConversation"("status", "lastMessageAt");
CREATE INDEX "InboxConversation_platform_lastMessageAt_idx" ON "InboxConversation"("platform", "lastMessageAt");
CREATE INDEX "InboxConversation_ownerId_idx" ON "InboxConversation"("ownerId");
CREATE UNIQUE INDEX "InboxConversation_ownerId_platform_accountKey_externalThreadId_key" ON "InboxConversation"("ownerId", "platform", "accountKey", "externalThreadId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

