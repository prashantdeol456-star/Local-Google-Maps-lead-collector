-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AiAssistantSettings" (
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
    "aiProvider" TEXT NOT NULL DEFAULT 'anthropic',
    "aiModel" TEXT NOT NULL DEFAULT '',
    "aiEffort" TEXT NOT NULL DEFAULT 'medium',
    "anthropicKeyEnc" TEXT,
    "anthropicKeyHint" TEXT,
    "geminiKeyEnc" TEXT,
    "geminiKeyHint" TEXT,
    "telegramTokenEnc" TEXT,
    "telegramTokenHint" TEXT,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AiAssistantSettings" ("businessProfile", "enabled", "faqs", "id", "maxAutoPerChatPerDay", "minConfidence", "modes", "neverSay", "style", "telegramOffset", "updatedAt") SELECT "businessProfile", "enabled", "faqs", "id", "maxAutoPerChatPerDay", "minConfidence", "modes", "neverSay", "style", "telegramOffset", "updatedAt" FROM "AiAssistantSettings";
DROP TABLE "AiAssistantSettings";
ALTER TABLE "new_AiAssistantSettings" RENAME TO "AiAssistantSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
