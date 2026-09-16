-- CreateEnum
CREATE TYPE "LocationOptimizerMode" AS ENUM ('DISABLED', 'SIMULATION', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "RosterChangeType" AS ENUM ('NEW_TIMETABLE', 'AMENDMENT');

-- CreateEnum
CREATE TYPE "RosterStructureState" AS ENUM ('STRUCTURE_EDITABLE', 'STRUCTURE_LOCKED');

-- CreateEnum
CREATE TYPE "RosterPeriodStatus" AS ENUM ('CONCEPT', 'SIMULATION', 'RULE_VALIDATION_PENDING', 'REVIEWED', 'OR_APPROVAL_REQUIRED', 'APPROVED', 'PUBLISHED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DutyPackageStatus" ADD VALUE 'UPLOADED';
ALTER TYPE "DutyPackageStatus" ADD VALUE 'PARSED';
ALTER TYPE "DutyPackageStatus" ADD VALUE 'NORMALIZED';
ALTER TYPE "DutyPackageStatus" ADD VALUE 'REVIEW_REQUIRED';
ALTER TYPE "DutyPackageStatus" ADD VALUE 'CONFIRMED';
ALTER TYPE "DutyPackageStatus" ADD VALUE 'SUPERSEDED';

-- AlterTable
ALTER TABLE "Duty" ADD COLUMN     "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "DutyPackage" ADD COLUMN     "diffFromPrevious" JSONB,
ADD COLUMN     "label" TEXT,
ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "problems" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "timetableId" TEXT NOT NULL DEFAULT 'HUIDIG',
ADD COLUMN     "totals" JSONB NOT NULL DEFAULT '{}',
ALTER COLUMN "status" SET DEFAULT 'UPLOADED';

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StationLocation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "planningEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rulesConfigured" BOOLEAN NOT NULL DEFAULT false,
    "rostersConfigured" BOOLEAN NOT NULL DEFAULT false,
    "dutiesConfigured" BOOLEAN NOT NULL DEFAULT false,
    "exportTemplateConfigured" BOOLEAN NOT NULL DEFAULT false,
    "optimizerMode" "LocationOptimizerMode" NOT NULL DEFAULT 'DISABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StationLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanningUnit" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "PlanningUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterPeriod" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "timetableId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "changeType" "RosterChangeType" NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "baseVersionId" TEXT,
    "dutyPackageId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "status" "RosterPeriodStatus" NOT NULL DEFAULT 'CONCEPT',
    "structureState" "RosterStructureState" NOT NULL DEFAULT 'STRUCTURE_EDITABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "baselineSealedAt" TIMESTAMP(3),

    CONSTRAINT "RosterPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterStructureBaselineSlot" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "baseRosterCode" TEXT NOT NULL,
    "profile" "RosterProfile" NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "weekIndex" INTEGER NOT NULL,
    "weekday" INTEGER NOT NULL,
    "slotType" TEXT NOT NULL,
    "structuralAnchor" BOOLEAN NOT NULL,
    "dutyCode" TEXT,

    CONSTRAINT "RosterStructureBaselineSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalAssignment" (
    "id" TEXT NOT NULL,
    "scheduledDutyId" TEXT NOT NULL,
    "dutyId" TEXT NOT NULL,
    "underlyingSlotType" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedByUserId" TEXT,
    "reason" TEXT,

    CONSTRAINT "OperationalAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Region_code_key" ON "Region"("code");

-- CreateIndex
CREATE UNIQUE INDEX "StationLocation_code_key" ON "StationLocation"("code");

-- CreateIndex
CREATE INDEX "StationLocation_planningEnabled_idx" ON "StationLocation"("planningEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "PlanningUnit_code_key" ON "PlanningUnit"("code");

-- CreateIndex
CREATE INDEX "PlanningUnit_locationId_idx" ON "PlanningUnit"("locationId");

-- CreateIndex
CREATE INDEX "RosterPeriod_locationId_status_idx" ON "RosterPeriod"("locationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RosterPeriod_locationId_timetableId_version_key" ON "RosterPeriod"("locationId", "timetableId", "version");

-- CreateIndex
CREATE INDEX "RosterStructureBaselineSlot_periodId_structuralAnchor_idx" ON "RosterStructureBaselineSlot"("periodId", "structuralAnchor");

-- CreateIndex
CREATE UNIQUE INDEX "RosterStructureBaselineSlot_periodId_baseRosterCode_lineNum_key" ON "RosterStructureBaselineSlot"("periodId", "baseRosterCode", "lineNumber", "weekIndex", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "OperationalAssignment_scheduledDutyId_key" ON "OperationalAssignment"("scheduledDutyId");

-- CreateIndex
CREATE INDEX "OperationalAssignment_dutyId_idx" ON "OperationalAssignment"("dutyId");

-- CreateIndex
CREATE UNIQUE INDEX "DutyPackage_label_key" ON "DutyPackage"("label");

-- CreateIndex
CREATE INDEX "DutyPackage_locationId_timetableId_version_idx" ON "DutyPackage"("locationId", "timetableId", "version");

-- AddForeignKey
ALTER TABLE "DutyPackage" ADD CONSTRAINT "DutyPackage_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StationLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationLocation" ADD CONSTRAINT "StationLocation_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningUnit" ADD CONSTRAINT "PlanningUnit_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StationLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterPeriod" ADD CONSTRAINT "RosterPeriod_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StationLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterPeriod" ADD CONSTRAINT "RosterPeriod_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "RosterPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterStructureBaselineSlot" ADD CONSTRAINT "RosterStructureBaselineSlot_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "RosterPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalAssignment" ADD CONSTRAINT "OperationalAssignment_scheduledDutyId_fkey" FOREIGN KEY ("scheduledDutyId") REFERENCES "ScheduledDuty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalAssignment" ADD CONSTRAINT "OperationalAssignment_dutyId_fkey" FOREIGN KEY ("dutyId") REFERENCES "Duty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
