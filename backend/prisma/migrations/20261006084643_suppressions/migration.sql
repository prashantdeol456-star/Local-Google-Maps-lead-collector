-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "leadId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Suppression_leadId_idx" ON "Suppression"("leadId");

-- CreateIndex
CREATE INDEX "Suppression_createdAt_idx" ON "Suppression"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_channel_address_key" ON "Suppression"("channel", "address");

-- Backfill: opt-outs recorded so far (on leads) become address-based suppressions.
-- Email: unsubscribed / spam complaint / do-not-contact, for the lead's email.
INSERT OR IGNORE INTO "Suppression" ("id", "channel", "address", "reason", "source", "leadId", "createdAt")
SELECT 'bf' || lower(hex(randomblob(12))), 'email', lower(trim(l."email")),
       CASE p."optOutReason" WHEN 'unsubscribe_link' THEN 'Unsubscribed via email link'
                             WHEN 'spam_complaint' THEN 'Marked an email as spam'
                             ELSE coalesce(p."optOutReason", 'Opted out') END,
       CASE WHEN p."optedOut" = 1 AND p."emailAllowed" = 1 THEN 'do_not_contact' ELSE coalesce(p."optOutReason", 'admin') END,
       l."id", coalesce(p."optedOutAt", p."updatedAt")
FROM "LeadCommunicationPreference" p JOIN "Lead" l ON l."id" = p."leadId"
WHERE (p."emailAllowed" = 0 OR p."optedOut" = 1) AND l."email" IS NOT NULL AND trim(l."email") <> '';

-- WhatsApp: every recorded opt-out event with a number (STOP replies, stops in WhatsApp, admin).
INSERT OR IGNORE INTO "Suppression" ("id", "channel", "address", "reason", "source", "leadId", "createdAt")
SELECT 'bf' || lower(hex(randomblob(12))), 'whatsapp', e."phone",
       coalesce(json_extract(e."metadata", '$.reason'), 'Opted out of WhatsApp'),
       CASE e."provider" WHEN 'keyword' THEN 'stop_reply' WHEN 'admin' THEN 'admin' ELSE 'whatsapp_stop' END,
       e."leadId", e."occurredAt"
FROM "WhatsAppEvent" e
WHERE e."type" = 'opted_out' AND e."phone" IS NOT NULL;

-- Do-not-contact leads: their phone too.
INSERT OR IGNORE INTO "Suppression" ("id", "channel", "address", "reason", "source", "leadId", "createdAt")
SELECT 'bf' || lower(hex(randomblob(12))), 'whatsapp', l."normalizedPhone", coalesce(p."optOutReason", 'Do not contact'), 'do_not_contact', l."id",
       coalesce(p."optedOutAt", p."updatedAt")
FROM "LeadCommunicationPreference" p JOIN "Lead" l ON l."id" = p."leadId"
WHERE p."optedOut" = 1 AND l."normalizedPhone" IS NOT NULL;
