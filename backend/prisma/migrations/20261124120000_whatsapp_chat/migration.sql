-- CreateTable
CREATE TABLE "WaChat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "phone" TEXT NOT NULL,
    "profileName" TEXT,
    "customName" TEXT,
    "leadId" TEXT,
    "lastInboundAt" DATETIME,
    "lastMessageAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageText" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "aiDraft" TEXT,
    "aiDraftAt" DATETIME,
    "aiNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WaMessage" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WaMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "WaChat" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WaMedia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "mime" TEXT NOT NULL,
    "name" TEXT,
    "size" INTEGER NOT NULL,
    "data" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "WaChat_ownerId_lastMessageAt_idx" ON "WaChat"("ownerId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "WaChat_ownerId_phone_idx" ON "WaChat"("ownerId", "phone");

-- CreateIndex
CREATE INDEX "WaMessage_chatId_createdAt_idx" ON "WaMessage"("chatId", "createdAt");

-- CreateIndex
CREATE INDEX "WaMessage_wamid_idx" ON "WaMessage"("wamid");

-- CreateIndex
CREATE INDEX "WaMedia_ownerId_idx" ON "WaMedia"("ownerId");

