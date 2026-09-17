-- CreateEnum
CREATE TYPE "GenerationRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED', 'INTERRUPTED');

-- CreateEnum
CREATE TYPE "GenerationRunKind" AS ENUM ('GENERATE', 'REBUILD');

-- AlterTable
ALTER TABLE "CandidateRoster" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "candidateNumber" INTEGER,
ADD COLUMN     "generationRunId" TEXT,
ADD COLUMN     "parentCandidateId" TEXT,
ADD COLUMN     "preferred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qualityMetrics" JSONB;

-- CreateTable
CREATE TABLE "GenerationRun" (
    "id" TEXT NOT NULL,
    "locationCode" TEXT NOT NULL,
    "kind" "GenerationRunKind" NOT NULL DEFAULT 'GENERATE',
    "strategy" TEXT NOT NULL,
    "strategyLabel" TEXT NOT NULL,
    "rosterYear" INTEGER NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dutyPackageId" TEXT,
    "status" "GenerationRunStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT,
    "stageMessage" TEXT,
    "progress" JSONB,
    "requestedCandidates" INTEGER NOT NULL,
    "foundCandidates" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "log" JSONB,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parentCandidateId" TEXT,
    "adjustmentId" TEXT,

    CONSTRAINT "GenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterCommitteeAdjustment" (
    "id" TEXT NOT NULL,
    "parentCandidateId" TEXT NOT NULL,
    "goals" TEXT[],
    "preserveGoodParts" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterCommitteeAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GenerationRun_adjustmentId_key" ON "GenerationRun"("adjustmentId");

-- CreateIndex
CREATE INDEX "GenerationRun_locationCode_createdAt_idx" ON "GenerationRun"("locationCode", "createdAt");

-- CreateIndex
CREATE INDEX "GenerationRun_status_idx" ON "GenerationRun"("status");

-- CreateIndex
CREATE INDEX "CandidateRoster_generationRunId_idx" ON "CandidateRoster"("generationRunId");

-- AddForeignKey
ALTER TABLE "CandidateRoster" ADD CONSTRAINT "CandidateRoster_generationRunId_fkey" FOREIGN KEY ("generationRunId") REFERENCES "GenerationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "RosterCommitteeAdjustment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Eén actieve generatieopdracht per standplaats.
--
-- Een dubbele klik, twee tabbladen of twee planners tegelijk mogen niet twee
-- CP-SAT-berekeningen naast elkaar starten: dat verstikt een laptop en levert
-- twee halve resultaten op. De applicatie controleert dit ook, maar alleen de
-- database kan het onder gelijktijdigheid garanderen. Prisma kent geen
-- gedeeltelijke unieke index; daarom staat hij hier als SQL.
CREATE UNIQUE INDEX "GenerationRun_een_actieve_per_standplaats"
  ON "GenerationRun" ("locationCode")
  WHERE "status" IN ('QUEUED', 'RUNNING');
