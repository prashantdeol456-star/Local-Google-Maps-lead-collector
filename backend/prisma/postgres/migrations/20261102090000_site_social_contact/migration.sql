-- Social links on the website, and this installation's contact details where none were set yet.
ALTER TABLE "SiteSettings" ADD COLUMN "linkedinUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SiteSettings" ADD COLUMN "youtubeUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SiteSettings" ADD COLUMN "xUrl" TEXT NOT NULL DEFAULT '';
UPDATE "SiteSettings" SET "contactPhone" = '+91 95573 93301' WHERE "contactPhone" = '';
UPDATE "SiteSettings" SET "address" = 'Sector 62, Noida, Uttar Pradesh 201301' WHERE "address" = '';
INSERT INTO "SiteSettings" ("id", "contactPhone", "address", "updatedAt")
SELECT 'site', '+91 95573 93301', 'Sector 62, Noida, Uttar Pradesh 201301', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "SiteSettings" WHERE "id" = 'site');
