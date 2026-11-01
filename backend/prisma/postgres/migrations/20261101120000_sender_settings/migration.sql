-- CreateTable
CREATE TABLE "SenderSettings" (
    "ownerId" TEXT NOT NULL,
    "emailConfig" TEXT,
    "emailSummary" TEXT,
    "whatsappConfig" TEXT,
    "whatsappSummary" TEXT,
    "webhookToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SenderSettings_pkey" PRIMARY KEY ("ownerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "SenderSettings_webhookToken_key" ON "SenderSettings"("webhookToken");

