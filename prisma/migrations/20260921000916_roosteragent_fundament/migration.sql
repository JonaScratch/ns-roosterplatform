-- CreateEnum
CREATE TYPE "AgentRole" AS ENUM ('USER', 'AGENT', 'SYSTEM');

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL,
    "locationCode" TEXT NOT NULL,
    "rosterPeriodId" TEXT,
    "title" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3),

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "AgentRole" NOT NULL,
    "text" TEXT NOT NULL,
    "uiContext" JSONB,
    "toolCalls" JSONB,
    "sources" JSONB,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCapabilityGrant" (
    "id" TEXT NOT NULL,
    "locationCode" TEXT NOT NULL,
    "rosterPeriodId" TEXT,
    "capabilities" TEXT[],
    "maxRounds" INTEGER NOT NULL DEFAULT 0,
    "maxSolverSeconds" INTEGER NOT NULL DEFAULT 0,
    "allowedStrategies" TEXT[],
    "protectedRosters" TEXT[],
    "grantedByUserId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "AgentCapabilityGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentSession_locationCode_lastMessageAt_idx" ON "AgentSession"("locationCode", "lastMessageAt");

-- CreateIndex
CREATE INDEX "AgentSession_createdByUserId_idx" ON "AgentSession"("createdByUserId");

-- CreateIndex
CREATE INDEX "AgentMessage_sessionId_createdAt_idx" ON "AgentMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentCapabilityGrant_locationCode_revokedAt_idx" ON "AgentCapabilityGrant"("locationCode", "revokedAt");

-- AddForeignKey
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "UserAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCapabilityGrant" ADD CONSTRAINT "AgentCapabilityGrant_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "UserAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
