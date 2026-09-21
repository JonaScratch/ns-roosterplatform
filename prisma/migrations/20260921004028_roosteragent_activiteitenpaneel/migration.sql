-- CreateEnum
CREATE TYPE "AgentActivityStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED', 'STOPPED', 'INTERRUPTED');

-- CreateEnum
CREATE TYPE "AgentEventKind" AS ENUM ('VRAAG', 'PLAN', 'TOOL', 'ANTWOORD', 'WEIGERING', 'STAP', 'STOP', 'FOUT');

-- AlterTable
ALTER TABLE "AgentCapabilityGrant" ADD COLUMN     "suspendReason" TEXT,
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedByUserId" TEXT;

-- CreateTable
CREATE TABLE "AgentActivity" (
    "id" TEXT NOT NULL,
    "locationCode" TEXT NOT NULL,
    "sessionId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "AgentActivityStatus" NOT NULL DEFAULT 'RUNNING',
    "generationRunId" TEXT,
    "stopRequested" BOOLEAN NOT NULL DEFAULT false,
    "stopRequestedByUserId" TEXT,
    "stopRequestedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "detail" JSONB,

    CONSTRAINT "AgentActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEvent" (
    "id" TEXT NOT NULL,
    "locationCode" TEXT NOT NULL,
    "activityId" TEXT,
    "sessionId" TEXT,
    "kind" "AgentEventKind" NOT NULL,
    "message" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentActivity_locationCode_startedAt_idx" ON "AgentActivity"("locationCode", "startedAt");

-- CreateIndex
CREATE INDEX "AgentActivity_status_idx" ON "AgentActivity"("status");

-- CreateIndex
CREATE INDEX "AgentEvent_locationCode_createdAt_idx" ON "AgentEvent"("locationCode", "createdAt");

-- CreateIndex
CREATE INDEX "AgentEvent_activityId_createdAt_idx" ON "AgentEvent"("activityId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "AgentActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
