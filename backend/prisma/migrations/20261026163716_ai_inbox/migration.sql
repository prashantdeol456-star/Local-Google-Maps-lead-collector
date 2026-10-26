-- CreateTable
CREATE TABLE "InboxConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InboxMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "externalId" TEXT,
    "text" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboxMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "InboxConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InboxDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "text" TEXT NOT NULL,
    "intent" TEXT,
    "summary" TEXT,
    "language" TEXT,
    "confidence" REAL,
    "needsHuman" BOOLEAN NOT NULL DEFAULT false,
    "decision" TEXT,
    "forMessageId" TEXT,
    "model" TEXT,
    "error" TEXT,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InboxDraft_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "InboxConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiAssistantSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "businessProfile" TEXT NOT NULL DEFAULT '',
    "faqs" TEXT NOT NULL DEFAULT '',
    "style" TEXT NOT NULL DEFAULT '',
    "neverSay" TEXT NOT NULL DEFAULT '',
    "modes" TEXT NOT NULL DEFAULT '{"telegram":"smart","facebook":"smart","instagram":"smart","linkedin":"draft"}',
    "minConfidence" REAL NOT NULL DEFAULT 0.8,
    "maxAutoPerChatPerDay" INTEGER NOT NULL DEFAULT 5,
    "telegramOffset" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "InboxConversation_status_lastMessageAt_idx" ON "InboxConversation"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "InboxConversation_platform_lastMessageAt_idx" ON "InboxConversation"("platform", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboxConversation_platform_accountKey_externalThreadId_key" ON "InboxConversation"("platform", "accountKey", "externalThreadId");

-- CreateIndex
CREATE INDEX "InboxMessage_conversationId_sentAt_idx" ON "InboxMessage"("conversationId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboxMessage_conversationId_externalId_key" ON "InboxMessage"("conversationId", "externalId");

-- CreateIndex
CREATE INDEX "InboxDraft_conversationId_createdAt_idx" ON "InboxDraft"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "InboxDraft_status_createdAt_idx" ON "InboxDraft"("status", "createdAt");
