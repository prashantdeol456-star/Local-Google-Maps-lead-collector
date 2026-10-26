-- CreateTable
CREATE TABLE "InboxConversation" (
    "id" TEXT NOT NULL,
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
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "externalId" TEXT,
    "text" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxDraft" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "text" TEXT NOT NULL,
    "intent" TEXT,
    "summary" TEXT,
    "language" TEXT,
    "confidence" DOUBLE PRECISION,
    "needsHuman" BOOLEAN NOT NULL DEFAULT false,
    "decision" TEXT,
    "forMessageId" TEXT,
    "model" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAssistantSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "businessProfile" TEXT NOT NULL DEFAULT '',
    "faqs" TEXT NOT NULL DEFAULT '',
    "style" TEXT NOT NULL DEFAULT '',
    "neverSay" TEXT NOT NULL DEFAULT '',
    "modes" TEXT NOT NULL DEFAULT '{"telegram":"smart","facebook":"smart","instagram":"smart","linkedin":"draft"}',
    "minConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "maxAutoPerChatPerDay" INTEGER NOT NULL DEFAULT 5,
    "telegramOffset" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAssistantSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboxConversation_status_lastMessageAt_idx" ON "InboxConversation"("status", "lastMessageAt");
CREATE INDEX "InboxConversation_platform_lastMessageAt_idx" ON "InboxConversation"("platform", "lastMessageAt");
CREATE UNIQUE INDEX "InboxConversation_platform_accountKey_externalThreadId_key" ON "InboxConversation"("platform", "accountKey", "externalThreadId");
CREATE INDEX "InboxMessage_conversationId_sentAt_idx" ON "InboxMessage"("conversationId", "sentAt");
CREATE UNIQUE INDEX "InboxMessage_conversationId_externalId_key" ON "InboxMessage"("conversationId", "externalId");
CREATE INDEX "InboxDraft_conversationId_createdAt_idx" ON "InboxDraft"("conversationId", "createdAt");
CREATE INDEX "InboxDraft_status_createdAt_idx" ON "InboxDraft"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "InboxMessage" ADD CONSTRAINT "InboxMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "InboxConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboxDraft" ADD CONSTRAINT "InboxDraft_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "InboxConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
