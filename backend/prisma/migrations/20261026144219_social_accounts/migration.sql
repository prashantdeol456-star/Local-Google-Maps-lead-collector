-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT,
    "pictureUrl" TEXT,
    "tokenEnc" TEXT NOT NULL,
    "tokenExpiresAt" DATETIME,
    "scopes" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "meta" TEXT NOT NULL DEFAULT '{}',
    "connectedById" TEXT,
    "lastCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "SocialAccount_platform_idx" ON "SocialAccount"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_platform_externalId_key" ON "SocialAccount"("platform", "externalId");
