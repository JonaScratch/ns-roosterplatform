-- CreateTable
CREATE TABLE "ProjectOptimisationGoal" (
    "id" TEXT NOT NULL,
    "locationCode" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectOptimisationGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectOptimisationGoal_locationCode_active_idx" ON "ProjectOptimisationGoal"("locationCode", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectOptimisationGoal_locationCode_goal_key" ON "ProjectOptimisationGoal"("locationCode", "goal");

-- AddForeignKey
ALTER TABLE "ProjectOptimisationGoal" ADD CONSTRAINT "ProjectOptimisationGoal_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "UserAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
