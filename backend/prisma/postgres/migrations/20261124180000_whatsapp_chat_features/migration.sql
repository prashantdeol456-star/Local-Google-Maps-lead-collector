-- AlterTable
ALTER TABLE "WaChat" ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "awaySentAt" TIMESTAMP(3),
ADD COLUMN "blockedAt" TIMESTAMP(3),
ADD COLUMN "greetedAt" TIMESTAMP(3),
ADD COLUMN "labels" TEXT,
ADD COLUMN "mutedUntil" TIMESTAMP(3),
ADD COLUMN "notes" TEXT,
ADD COLUMN "pinnedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WaMessage" ADD COLUMN "editedAt" TIMESTAMP(3),
ADD COLUMN "forwarded" TEXT,
ADD COLUMN "hiddenAt" TIMESTAMP(3),
ADD COLUMN "payload" TEXT,
ADD COLUMN "reactions" TEXT,
ADD COLUMN "replyToWamid" TEXT,
ADD COLUMN "revokedAt" TIMESTAMP(3),
ADD COLUMN "starred" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WaQuickReply" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "shortcut" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaQuickReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaChatSettings" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "greetingOn" BOOLEAN NOT NULL DEFAULT false,
    "greetingText" TEXT,
    "awayOn" BOOLEAN NOT NULL DEFAULT false,
    "awayText" TEXT,
    "workStart" TEXT NOT NULL DEFAULT '10:00',
    "workEnd" TEXT NOT NULL DEFAULT '19:00',
    "workDays" TEXT NOT NULL DEFAULT '[1,2,3,4,5,6]',
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaChatSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaQuickReply_ownerId_idx" ON "WaQuickReply"("ownerId");

-- CreateIndex
CREATE INDEX "WaChatSettings_ownerId_idx" ON "WaChatSettings"("ownerId");
