-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT,
    "pictureUrl" TEXT,
    "tokenEnc" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "meta" TEXT NOT NULL DEFAULT '{}',
    "connectedById" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialAccount_platform_idx" ON "SocialAccount"("platform");
CREATE UNIQUE INDEX "SocialAccount_platform_externalId_key" ON "SocialAccount"("platform", "externalId");
