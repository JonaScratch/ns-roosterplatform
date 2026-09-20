-- CreateEnum
CREATE TYPE "HumanReviewVerdict" AS ENUM ('GOOD', 'DOUBT', 'BAD');

-- CreateEnum
CREATE TYPE "PairwiseChoice" AS ENUM ('FIRST', 'SECOND', 'EQUAL');

-- CreateTable
CREATE TABLE "HumanLineReview" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "rosterCode" TEXT NOT NULL,
    "lineNumber" INTEGER,
    "verdict" "HumanReviewVerdict" NOT NULL,
    "reasons" TEXT[],
    "note" TEXT,
    "qualityModelVersion" TEXT,
    "optimizerModelVersion" TEXT,
    "reviewerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HumanLineReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumanPairwisePreference" (
    "id" TEXT NOT NULL,
    "firstCandidateId" TEXT NOT NULL,
    "secondCandidateId" TEXT NOT NULL,
    "rosterCode" TEXT,
    "choice" "PairwiseChoice" NOT NULL,
    "reasons" TEXT[],
    "note" TEXT,
    "firstQualityModelVersion" TEXT,
    "secondQualityModelVersion" TEXT,
    "firstOptimizerModelVersion" TEXT,
    "secondOptimizerModelVersion" TEXT,
    "reviewerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HumanPairwisePreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HumanLineReview_candidateId_idx" ON "HumanLineReview"("candidateId");

-- CreateIndex
CREATE INDEX "HumanLineReview_createdAt_idx" ON "HumanLineReview"("createdAt");

-- CreateIndex
CREATE INDEX "HumanPairwisePreference_firstCandidateId_idx" ON "HumanPairwisePreference"("firstCandidateId");

-- CreateIndex
CREATE INDEX "HumanPairwisePreference_secondCandidateId_idx" ON "HumanPairwisePreference"("secondCandidateId");

-- AddForeignKey
ALTER TABLE "HumanLineReview" ADD CONSTRAINT "HumanLineReview_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateRoster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanLineReview" ADD CONSTRAINT "HumanLineReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "UserAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanPairwisePreference" ADD CONSTRAINT "HumanPairwisePreference_firstCandidateId_fkey" FOREIGN KEY ("firstCandidateId") REFERENCES "CandidateRoster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanPairwisePreference" ADD CONSTRAINT "HumanPairwisePreference_secondCandidateId_fkey" FOREIGN KEY ("secondCandidateId") REFERENCES "CandidateRoster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanPairwisePreference" ADD CONSTRAINT "HumanPairwisePreference_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "UserAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
