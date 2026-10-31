-- DropIndex
DROP INDEX "Lead_placeId_key";

-- DropIndex
DROP INDEX "Lead_dedupeKey_key";

-- DropIndex
DROP INDEX "LinkedInLead_profileUrl_key";

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "ownerId" TEXT;

-- AlterTable
ALTER TABLE "CollectionJob" ADD COLUMN "ownerId" TEXT;

-- AlterTable
ALTER TABLE "LinkedInLead" ADD COLUMN "ownerId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AdminUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "phone" TEXT,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'customer',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME
);
INSERT INTO "new_AdminUser" ("createdAt", "email", "id", "lastLoginAt", "name", "passwordHash") SELECT "createdAt", "email", "id", "lastLoginAt", "name", "passwordHash" FROM "AdminUser";
DROP TABLE "AdminUser";
ALTER TABLE "new_AdminUser" RENAME TO "AdminUser";
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");
CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Lead_ownerId_idx" ON "Lead"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_ownerId_placeId_key" ON "Lead"("ownerId", "placeId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_ownerId_dedupeKey_key" ON "Lead"("ownerId", "dedupeKey");

-- CreateIndex
CREATE INDEX "CollectionJob_ownerId_idx" ON "CollectionJob"("ownerId");

-- CreateIndex
CREATE INDEX "LinkedInLead_ownerId_idx" ON "LinkedInLead"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedInLead_ownerId_profileUrl_key" ON "LinkedInLead"("ownerId", "profileUrl");


-- Existing admins (created before user accounts existed) are super admins.
UPDATE "AdminUser" SET "role" = 'super_admin', "status" = 'active', "approvedAt" = CURRENT_TIMESTAMP;

-- Data collected so far belongs to the first super admin.
UPDATE "Lead" SET "ownerId" = (SELECT "id" FROM "AdminUser" ORDER BY "createdAt" LIMIT 1) WHERE "ownerId" IS NULL;
UPDATE "CollectionJob" SET "ownerId" = (SELECT "id" FROM "AdminUser" ORDER BY "createdAt" LIMIT 1) WHERE "ownerId" IS NULL;
UPDATE "LinkedInLead" SET "ownerId" = (SELECT "id" FROM "AdminUser" ORDER BY "createdAt" LIMIT 1) WHERE "ownerId" IS NULL;
