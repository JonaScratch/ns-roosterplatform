-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CandidateValidationState" ADD VALUE 'TECHNICALLY_VALID_UNVERIFIED_RULES';
ALTER TYPE "CandidateValidationState" ADD VALUE 'TECHNICALLY_VALID_INCOMPLETE_CONTEXT';
ALTER TYPE "CandidateValidationState" ADD VALUE 'CONFIRMED_HARD_VIOLATION';
ALTER TYPE "CandidateValidationState" ADD VALUE 'INVALID_STRUCTURE';
