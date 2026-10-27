-- AlterTable
ALTER TABLE "AiAssistantSettings" ADD COLUMN "aiProvider" TEXT NOT NULL DEFAULT 'anthropic',
ADD COLUMN "aiModel" TEXT NOT NULL DEFAULT '',
ADD COLUMN "aiEffort" TEXT NOT NULL DEFAULT 'medium',
ADD COLUMN "anthropicKeyEnc" TEXT,
ADD COLUMN "anthropicKeyHint" TEXT,
ADD COLUMN "geminiKeyEnc" TEXT,
ADD COLUMN "geminiKeyHint" TEXT,
ADD COLUMN "telegramTokenEnc" TEXT,
ADD COLUMN "telegramTokenHint" TEXT;
