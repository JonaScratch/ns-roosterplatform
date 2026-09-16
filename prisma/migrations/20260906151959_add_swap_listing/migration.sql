-- CreateEnum
CREATE TYPE "SwapListingStatus" AS ENUM ('OPEN', 'MATCHED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SwapListingPreference" AS ENUM ('NONE', 'EARLIER', 'LATER');

-- AlterTable
ALTER TABLE "SwapProposal" ADD COLUMN     "listingId" TEXT;

-- CreateTable
CREATE TABLE "SwapListing" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "scheduledDutyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "preference" "SwapListingPreference" NOT NULL DEFAULT 'NONE',
    "status" "SwapListingStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "withdrawnAt" TIMESTAMP(3),
    "matchedProposalId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SwapListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SwapListing_matchedProposalId_key" ON "SwapListing"("matchedProposalId");

-- CreateIndex
CREATE INDEX "SwapListing_status_date_idx" ON "SwapListing"("status", "date");

-- CreateIndex
CREATE INDEX "SwapListing_employeeId_status_idx" ON "SwapListing"("employeeId", "status");

-- CreateIndex
CREATE INDEX "SwapProposal_listingId_idx" ON "SwapProposal"("listingId");

-- AddForeignKey
ALTER TABLE "SwapProposal" ADD CONSTRAINT "SwapProposal_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "SwapListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapListing" ADD CONSTRAINT "SwapListing_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapListing" ADD CONSTRAINT "SwapListing_scheduledDutyId_fkey" FOREIGN KEY ("scheduledDutyId") REFERENCES "ScheduledDuty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapListing" ADD CONSTRAINT "SwapListing_matchedProposalId_fkey" FOREIGN KEY ("matchedProposalId") REFERENCES "SwapProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
