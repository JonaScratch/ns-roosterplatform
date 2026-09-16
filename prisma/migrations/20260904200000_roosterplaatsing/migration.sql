-- CreateEnum
CREATE TYPE "RosterPlacementType" AS ENUM ('PERMANENT', 'TEMPORARY');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'ENDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "RosterMembership" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "locationCode" TEXT NOT NULL,
    "baseRosterId" TEXT NOT NULL,
    "lineCount" INTEGER NOT NULL,
    "anchorRuleIndex" INTEGER NOT NULL,
    "anchorWeek" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validUntil" DATE,
    "placementType" "RosterPlacementType" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "basePlacementId" TEXT,
    "reason" TEXT,
    "waitlistEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "endedAt" TIMESTAMP(3),
    "endedByUserId" TEXT,

    CONSTRAINT "RosterMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RosterMembership_employeeId_placementType_status_idx" ON "RosterMembership"("employeeId", "placementType", "status");

-- CreateIndex
CREATE INDEX "RosterMembership_baseRosterId_status_idx" ON "RosterMembership"("baseRosterId", "status");

-- CreateIndex
CREATE INDEX "RosterMembership_locationCode_status_idx" ON "RosterMembership"("locationCode", "status");

-- AddForeignKey
ALTER TABLE "RosterMembership" ADD CONSTRAINT "RosterMembership_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterMembership" ADD CONSTRAINT "RosterMembership_baseRosterId_fkey" FOREIGN KEY ("baseRosterId") REFERENCES "BaseRoster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterMembership" ADD CONSTRAINT "RosterMembership_basePlacementId_fkey" FOREIGN KEY ("basePlacementId") REFERENCES "RosterMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
