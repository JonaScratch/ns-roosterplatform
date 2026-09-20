-- AlterTable
ALTER TABLE "CandidateRoster" ADD COLUMN     "optimizerModelVersion" TEXT,
ADD COLUMN     "provenance" JSONB,
ADD COLUMN     "qualityModelVersion" TEXT;

-- AlterTable
ALTER TABLE "GenerationRun" ADD COLUMN     "ablation" TEXT,
ADD COLUMN     "engine" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "searchCounters" JSONB,
ADD COLUMN     "searchJournal" JSONB,
ADD COLUMN     "searchMode" TEXT;
