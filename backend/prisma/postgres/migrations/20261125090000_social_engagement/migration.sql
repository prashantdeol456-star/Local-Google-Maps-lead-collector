-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "accountId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "message" TEXT,
    "permalink" TEXT,
    "imageUrl" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "reactionCount" INTEGER NOT NULL DEFAULT 0,
    "shareCount" INTEGER,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPerson" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT,
    "profileUrl" TEXT,
    "pictureUrl" TEXT,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "reactions" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "leadSignal" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'new',
    "notes" TEXT,
    "contactId" TEXT,
    "lastComment" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialEngagement" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "accountId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "reactionType" TEXT,
    "text" TEXT,
    "parentExternalId" TEXT,
    "permalink" TEXT,
    "leadSignal" BOOLEAN NOT NULL DEFAULT false,
    "repliedAt" TIMESTAMP(3),
    "replyText" TEXT,
    "removedAt" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialPost_ownerId_postedAt_idx" ON "SocialPost"("ownerId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_accountId_externalId_key" ON "SocialPost"("accountId", "externalId");

-- CreateIndex
CREATE INDEX "SocialPerson_ownerId_lastSeenAt_idx" ON "SocialPerson"("ownerId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPerson_ownerId_platform_externalId_key" ON "SocialPerson"("ownerId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "SocialEngagement_ownerId_occurredAt_idx" ON "SocialEngagement"("ownerId", "occurredAt");

-- CreateIndex
CREATE INDEX "SocialEngagement_postId_idx" ON "SocialEngagement"("postId");

-- CreateIndex
CREATE INDEX "SocialEngagement_personId_idx" ON "SocialEngagement"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialEngagement_accountId_kind_externalId_key" ON "SocialEngagement"("accountId", "kind", "externalId");

