-- CreateEnum
CREATE TYPE "CandidateValidationState" AS ENUM ('NOT_VALIDATED', 'TECHNICALLY_VALIDATED', 'REJECTED', 'STALE_SCHEDULE', 'STALE_RULESET', 'STALE_INPUT', 'TAMPERED');

-- CreateTable
CREATE TABLE "CandidateRoster" (
    "id" TEXT NOT NULL,
    "scenarioLabel" TEXT NOT NULL,
    "optimizerName" TEXT NOT NULL,
    "optimizerVersion" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "legalStatus" TEXT NOT NULL,
    "sourceScheduleVersion" TEXT NOT NULL,
    "rulesetVersion" TEXT NOT NULL,
    "inputDataVersion" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "generatedByUserId" TEXT,
    "assignments" JSONB NOT NULL,
    "scoreBreakdown" JSONB NOT NULL,
    "validationState" "CandidateValidationState" NOT NULL DEFAULT 'NOT_VALIDATED',
    "validationSummary" JSONB,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateRoster_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidateRoster_validationState_idx" ON "CandidateRoster"("validationState");

-- CreateIndex
CREATE INDEX "CandidateRoster_generatedAt_idx" ON "CandidateRoster"("generatedAt");
