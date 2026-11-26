-- CreateTable
CREATE TABLE "ApolloAccount" (
    "id" TEXT NOT NULL,
    "keyEnc" TEXT NOT NULL,
    "keyHint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "statusReason" TEXT,
    "creditsLimit" DOUBLE PRECISION,
    "creditsUsed" DOUBLE PRECISION,
    "cycleEnd" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApolloAccount_pkey" PRIMARY KEY ("id")
);

