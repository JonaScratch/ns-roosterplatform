-- CreateEnum
CREATE TYPE "CaoDayStatus" AS ENUM ('REQUESTED', 'REGISTERED_IN_LEAVE_BOOK', 'CANCELLED');

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'CAO_DAG';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'CAO_DAY_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'CAO_DAY_REGISTERED';
ALTER TYPE "NotificationType" ADD VALUE 'CAO_DAY_CANCELLED';

-- CreateTable
CREATE TABLE "CaoDayRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "requestedDate" DATE NOT NULL,
    "rosterSnapshot" JSONB NOT NULL,
    "status" "CaoDayStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registeredAt" TIMESTAMP(3),
    "registeredBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CaoDayRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaoDayRequest_locationId_status_requestedDate_idx" ON "CaoDayRequest"("locationId", "status", "requestedDate");

-- CreateIndex
CREATE UNIQUE INDEX "CaoDayRequest_employeeId_requestedDate_key" ON "CaoDayRequest"("employeeId", "requestedDate");

-- AddForeignKey
ALTER TABLE "CaoDayRequest" ADD CONSTRAINT "CaoDayRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaoDayRequest" ADD CONSTRAINT "CaoDayRequest_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StationLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
