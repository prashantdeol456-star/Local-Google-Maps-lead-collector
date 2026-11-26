-- CreateTable
CREATE TABLE "ApolloAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyEnc" TEXT NOT NULL,
    "keyHint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "statusReason" TEXT,
    "creditsLimit" REAL,
    "creditsUsed" REAL,
    "cycleEnd" DATETIME,
    "checkedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

