-- CreateEnum
CREATE TYPE "MemoryScope" AS ENUM ('PROJECT', 'LOCATION', 'NATIONAL', 'TECHNICAL');

-- CreateEnum
CREATE TYPE "MemoryStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "MemoryKind" AS ENUM ('PREFERENCE', 'FACT', 'DECISION', 'LESSON');

-- CreateTable
CREATE TABLE "AgentMemoryItem" (
    "id" TEXT NOT NULL,
    "scope" "MemoryScope" NOT NULL,
    "kind" "MemoryKind" NOT NULL,
    "locationCode" TEXT,
    "rosterPeriodId" TEXT,
    "dutyPackageId" TEXT,
    "statement" TEXT NOT NULL,
    "rationale" TEXT,
    "evidence" JSONB,
    "status" "MemoryStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedByAgent" BOOLEAN NOT NULL DEFAULT false,
    "proposedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnReason" TEXT,
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMemoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMemoryApplication" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "generationRunId" TEXT,
    "candidateId" TEXT,
    "effect" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMemoryApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentMemoryItem_scope_locationCode_status_idx" ON "AgentMemoryItem"("scope", "locationCode", "status");

-- CreateIndex
CREATE INDEX "AgentMemoryItem_status_updatedAt_idx" ON "AgentMemoryItem"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "AgentMemoryApplication_itemId_at_idx" ON "AgentMemoryApplication"("itemId", "at");

-- AddForeignKey
ALTER TABLE "AgentMemoryItem" ADD CONSTRAINT "AgentMemoryItem_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "AgentMemoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemoryApplication" ADD CONSTRAINT "AgentMemoryApplication_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "AgentMemoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
