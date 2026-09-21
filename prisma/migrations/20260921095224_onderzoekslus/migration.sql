-- CreateEnum
CREATE TYPE "AgentLoopStatus" AS ENUM ('RUNNING', 'DONE', 'STOPPED', 'FAILED', 'INTERRUPTED');

-- CreateTable
CREATE TABLE "AgentResearchLoop" (
    "id" TEXT NOT NULL,
    "locationCode" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "goals" TEXT[],
    "maxRounds" INTEGER NOT NULL,
    "maxSolverSeconds" INTEGER NOT NULL,
    "status" "AgentLoopStatus" NOT NULL DEFAULT 'RUNNING',
    "roundsDone" INTEGER NOT NULL DEFAULT 0,
    "baselineScore" DOUBLE PRECISION,
    "bestScore" DOUBLE PRECISION,
    "bestCandidateId" TEXT,
    "conclusion" TEXT,
    "activityId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),

    CONSTRAINT "AgentResearchLoop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentResearchRound" (
    "id" TEXT NOT NULL,
    "loopId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "generationRunId" TEXT,
    "candidateId" TEXT,
    "score" DOUBLE PRECISION,
    "delta" DOUBLE PRECISION,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentResearchRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentResearchLoop_locationCode_startedAt_idx" ON "AgentResearchLoop"("locationCode", "startedAt");

-- CreateIndex
CREATE INDEX "AgentResearchLoop_status_idx" ON "AgentResearchLoop"("status");

-- CreateIndex
CREATE INDEX "AgentResearchRound_loopId_roundNumber_idx" ON "AgentResearchRound"("loopId", "roundNumber");

-- AddForeignKey
ALTER TABLE "AgentResearchLoop" ADD CONSTRAINT "AgentResearchLoop_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "UserAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentResearchRound" ADD CONSTRAINT "AgentResearchRound_loopId_fkey" FOREIGN KEY ("loopId") REFERENCES "AgentResearchLoop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
