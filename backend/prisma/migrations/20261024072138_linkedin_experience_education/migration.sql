-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LinkedInLead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileUrl" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headline" TEXT,
    "company" TEXT,
    "location" TEXT,
    "emails" TEXT NOT NULL DEFAULT '[]',
    "phones" TEXT NOT NULL DEFAULT '[]',
    "websites" TEXT NOT NULL DEFAULT '[]',
    "ims" TEXT NOT NULL DEFAULT '[]',
    "experience" TEXT NOT NULL DEFAULT '[]',
    "education" TEXT NOT NULL DEFAULT '[]',
    "birthday" TEXT,
    "address" TEXT,
    "connectedSince" TEXT,
    "notes" TEXT,
    "tag" TEXT,
    "source" TEXT NOT NULL,
    "hasEmail" BOOLEAN NOT NULL DEFAULT false,
    "hasPhone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_LinkedInLead" ("address", "birthday", "company", "connectedSince", "createdAt", "emails", "hasEmail", "hasPhone", "headline", "id", "ims", "location", "name", "notes", "phones", "profileUrl", "source", "tag", "updatedAt", "websites") SELECT "address", "birthday", "company", "connectedSince", "createdAt", "emails", "hasEmail", "hasPhone", "headline", "id", "ims", "location", "name", "notes", "phones", "profileUrl", "source", "tag", "updatedAt", "websites" FROM "LinkedInLead";
DROP TABLE "LinkedInLead";
ALTER TABLE "new_LinkedInLead" RENAME TO "LinkedInLead";
CREATE UNIQUE INDEX "LinkedInLead_profileUrl_key" ON "LinkedInLead"("profileUrl");
CREATE INDEX "LinkedInLead_createdAt_idx" ON "LinkedInLead"("createdAt");
CREATE INDEX "LinkedInLead_company_idx" ON "LinkedInLead"("company");
CREATE INDEX "LinkedInLead_tag_idx" ON "LinkedInLead"("tag");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
