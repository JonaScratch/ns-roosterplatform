-- CreateEnum
CREATE TYPE "EmployeeGroup" AS ENUM ('MACHINIST', 'HOOFDCONDUCTEUR', 'RANGEERDER', 'NEDTRAIN', 'TICKETS_SERVICE', 'OVERIG');

-- AlterTable
ALTER TABLE "Duty" ADD COLUMN     "breakMinutes" INTEGER,
ADD COLUMN     "overtimeMinutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "company" TEXT NOT NULL DEFAULT 'NSR',
ADD COLUMN     "contractHours" DECIMAL(4,2),
ADD COLUMN     "earlyStartProtectionWaived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "employeeGroup" "EmployeeGroup" NOT NULL DEFAULT 'MACHINIST',
ADD COLUMN     "protections" JSONB NOT NULL DEFAULT '[]';
