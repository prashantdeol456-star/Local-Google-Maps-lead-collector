-- CreateTable
CREATE TABLE "SnovAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyEnc" TEXT NOT NULL,
    "keyHint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "statusReason" TEXT,
    "credits" REAL,
    "creditsPeak" REAL,
    "resetDate" DATETIME,
    "checkedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

