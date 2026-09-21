-- CreateTable
CREATE TABLE "RuleSourceCheck" (
    "id" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "checkedByUserId" TEXT NOT NULL,
    "checkedByName" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'USER_PRELIMINARY',

    CONSTRAINT "RuleSourceCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RuleSourceCheck_document_idx" ON "RuleSourceCheck"("document");

-- CreateIndex
CREATE UNIQUE INDEX "RuleSourceCheck_document_checkedByUserId_key" ON "RuleSourceCheck"("document", "checkedByUserId");

-- AddForeignKey
ALTER TABLE "RuleSourceCheck" ADD CONSTRAINT "RuleSourceCheck_checkedByUserId_fkey" FOREIGN KEY ("checkedByUserId") REFERENCES "UserAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
