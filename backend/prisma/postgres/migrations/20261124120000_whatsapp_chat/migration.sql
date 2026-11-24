-- CreateTable
CREATE TABLE "WaChat" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "phone" TEXT NOT NULL,
    "profileName" TEXT,
    "customName" TEXT,
    "leadId" TEXT,
    "lastInboundAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageText" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "aiDraft" TEXT,
    "aiDraftAt" TIMESTAMP(3),
    "aiNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaMessage" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaMedia" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "mime" TEXT NOT NULL,
    "name" TEXT,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaMedia_pkey" PRIMARY KEY ("id")
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


-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "WaChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
