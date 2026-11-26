-- CreateTable
CREATE TABLE "SnovAccount" (
    "id" TEXT NOT NULL,
    "keyEnc" TEXT NOT NULL,
    "keyHint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "statusReason" TEXT,
    "credits" DOUBLE PRECISION,
    "creditsPeak" DOUBLE PRECISION,
    "resetDate" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SnovAccount_pkey" PRIMARY KEY ("id")
);

