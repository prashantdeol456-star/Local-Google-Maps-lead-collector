-- CreateTable
CREATE TABLE "SenderSettings" (
    "ownerId" TEXT NOT NULL PRIMARY KEY,
    "emailConfig" TEXT,
    "emailSummary" TEXT,
    "whatsappConfig" TEXT,
    "whatsappSummary" TEXT,
    "webhookToken" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "SenderSettings_webhookToken_key" ON "SenderSettings"("webhookToken");

