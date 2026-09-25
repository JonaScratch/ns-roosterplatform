-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('PROPOSED', 'RUNNING', 'MEASURED', 'PASSED', 'REJECTED');

-- CreateTable
CREATE TABLE "AgentExperiment" (
    "id" TEXT NOT NULL,
    "locationCode" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "variant" JSONB NOT NULL,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'PROPOSED',
    "baseline" JSONB,
    "result" JSONB,
    "gateResults" JSONB,
    "conclusion" TEXT,
    "proposedByAgent" BOOLEAN NOT NULL DEFAULT false,
    "proposedByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentExperiment_locationCode_createdAt_idx" ON "AgentExperiment"("locationCode", "createdAt");

-- CreateIndex
CREATE INDEX "AgentExperiment_status_idx" ON "AgentExperiment"("status");

-- AddForeignKey
ALTER TABLE "AgentExperiment" ADD CONSTRAINT "AgentExperiment_proposedByUserId_fkey" FOREIGN KEY ("proposedByUserId") REFERENCES "UserAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
