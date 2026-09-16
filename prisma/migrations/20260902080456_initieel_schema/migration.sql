-- CreateEnum
CREATE TYPE "Role" AS ENUM ('EMPLOYEE', 'ROSTER_COMMITTEE', 'DUTY_ASSIGNMENT', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'LOCKED', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "AuthProviderKind" AS ENUM ('LOCAL', 'OIDC');

-- CreateEnum
CREATE TYPE "AuthLevel" AS ENUM ('PASSWORD', 'MFA');

-- CreateEnum
CREATE TYPE "RosterProfile" AS ENUM ('VROEG', 'VROEG_LAAT', 'LAAT', 'LAAT_NACHT', 'MIX');

-- CreateEnum
CREATE TYPE "ReservePreferenceKind" AS ENUM ('VROEG', 'LAAT', 'VROEG_LAAT', 'VROEG_LAAT_NACHT', 'GEEN_VOORKEUR');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'LEFT');

-- CreateEnum
CREATE TYPE "DutyKind" AS ENUM ('VROEG', 'LAAT', 'NACHT', 'RESERVE', 'RANGEER');

-- CreateEnum
CREATE TYPE "DutyPeriod" AS ENUM ('VROEG', 'LAAT', 'NACHT', 'GEEN');

-- CreateEnum
CREATE TYPE "DutyWorkType" AS ENUM ('RIJDEND', 'RANGEER', 'RESERVE');

-- CreateEnum
CREATE TYPE "DutyPackageStatus" AS ENUM ('DRAFT', 'VALIDATED', 'ACTIVE', 'ARCHIVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RosterPositionType" AS ENUM ('DUTY', 'RES', 'WR', 'CO', 'RUST', 'VERLOF', 'OPLEIDING');

-- CreateEnum
CREATE TYPE "BaseRosterStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ScheduleSource" AS ENUM ('BASE', 'RESERVE_FILL', 'AVAILABLE_DUTY', 'SWAP', 'PLANNER_MANUAL');

-- CreateEnum
CREATE TYPE "RosterVersionStatus" AS ENUM ('DRAFT', 'GENERATED', 'UNDER_REVIEW', 'PUBLISHED', 'ARCHIVED', 'FAILED');

-- CreateEnum
CREATE TYPE "WarningSeverity" AS ENUM ('INFO', 'WARNING', 'VIOLATION');

-- CreateEnum
CREATE TYPE "AvailableDutyStatus" AS ENUM ('RESERVE_PENDING', 'OPEN', 'AWARDED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReserveFillOutcome" AS ENUM ('FILLED', 'NO_CANDIDATE', 'BLOCKED_BY_RULES', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SwapStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('ACTIVE', 'FULFILLED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('TEVREDEN', 'TE_VEEL_VROEG', 'TE_VEEL_LAAT', 'TE_VEEL_NACHT', 'TE_VEEL_RANGEER', 'ONVOLDOENDE_AFWISSELING', 'BETERE_WEEKENDVERDELING');

-- CreateEnum
CREATE TYPE "RuleDecision" AS ENUM ('ALLOW', 'WARN', 'BLOCK');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'DENIED', 'FAILED');

-- CreateEnum
CREATE TYPE "SecurityEventKind" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_BLOCKED', 'ACCOUNT_LOCKED', 'LOGOUT', 'SESSION_EXPIRED', 'AUTHORIZATION_DENIED', 'RATE_LIMITED', 'CSRF_REJECTED');

-- CreateTable
CREATE TABLE "UserAccount" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "roles" "Role"[] DEFAULT ARRAY['EMPLOYEE']::"Role"[],
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "provider" "AuthProviderKind" NOT NULL DEFAULT 'LOCAL',
    "passwordHash" TEXT,
    "externalSubject" TEXT,
    "mfaEnrolled" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "passwordSetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "authLevel" "AuthLevel" NOT NULL DEFAULT 'PASSWORD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiry" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "clientFingerprint" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "employeeNumber" TEXT NOT NULL,
    "rosterProfile" "RosterProfile" NOT NULL,
    "depot" TEXT NOT NULL,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "qualifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reservePreference" "ReservePreferenceKind" NOT NULL DEFAULT 'GEEN_VOORKEUR',
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "hiredOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeIdentity" (
    "employeeId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeIdentity_pkey" PRIMARY KEY ("employeeId")
);

-- CreateTable
CREATE TABLE "DutyPackage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "DutyPackageStatus" NOT NULL DEFAULT 'DRAFT',
    "depot" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "sourceChecksum" TEXT NOT NULL,
    "sourceFilename" TEXT NOT NULL,
    "importedByUserId" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DutyPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Duty" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "numericCode" INTEGER NOT NULL,
    "period" "DutyPeriod" NOT NULL,
    "workType" "DutyWorkType" NOT NULL,
    "kinds" "DutyKind"[],
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "depot" TEXT NOT NULL,
    "requiredQualifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weight" INTEGER NOT NULL DEFAULT 3,
    "description" TEXT,

    CONSTRAINT "Duty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaseRoster" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "profile" "RosterProfile" NOT NULL,
    "depot" TEXT NOT NULL,
    "cycleWeeks" INTEGER NOT NULL,
    "status" "BaseRosterStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BaseRoster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterLine" (
    "id" TEXT NOT NULL,
    "baseRosterId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,

    CONSTRAINT "RosterLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterLineDay" (
    "id" TEXT NOT NULL,
    "rosterLineId" TEXT NOT NULL,
    "weekIndex" INTEGER NOT NULL,
    "weekday" INTEGER NOT NULL,
    "positionType" "RosterPositionType" NOT NULL,
    "dutyCode" TEXT,

    CONSTRAINT "RosterLineDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "rosterLineId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledDuty" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "positionType" "RosterPositionType" NOT NULL,
    "dutyId" TEXT,
    "source" "ScheduleSource" NOT NULL DEFAULT 'BASE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledDuty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterVersion" (
    "id" TEXT NOT NULL,
    "baseRosterId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "RosterVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedByUserId" TEXT,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "engineName" TEXT,
    "engineVersion" TEXT,

    CONSTRAINT "RosterVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterVersionDay" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "weekIndex" INTEGER NOT NULL,
    "weekday" INTEGER NOT NULL,
    "positionType" "RosterPositionType" NOT NULL,
    "dutyCode" TEXT,

    CONSTRAINT "RosterVersionDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterWarning" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "severity" "WarningSeverity" NOT NULL,
    "lineNumber" INTEGER,
    "weekIndex" INTEGER,
    "weekday" INTEGER,
    "message" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterWarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailableDuty" (
    "id" TEXT NOT NULL,
    "dutyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AvailableDutyStatus" NOT NULL DEFAULT 'RESERVE_PENDING',
    "originEmployeeId" TEXT,
    "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "awardedEmployeeId" TEXT,
    "awardedAt" TIMESTAMP(3),
    "awardRanking" JSONB,

    CONSTRAINT "AvailableDuty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailableDutyInterest" (
    "id" TEXT NOT NULL,
    "availableDutyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "ruleEvaluationId" TEXT,

    CONSTRAINT "AvailableDutyInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReserveFillAttempt" (
    "id" TEXT NOT NULL,
    "availableDutyId" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "ReserveFillOutcome" NOT NULL,
    "candidatesConsidered" INTEGER NOT NULL DEFAULT 0,
    "filledEmployeeId" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "ruleEvaluationId" TEXT,

    CONSTRAINT "ReserveFillAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotationList" (
    "id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "depot" TEXT NOT NULL,
    "offset" INTEGER NOT NULL DEFAULT 0,
    "offsetWeek" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RotationList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotationEntry" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "baseIndex" INTEGER NOT NULL,

    CONSTRAINT "RotationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotationLog" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "fromOffset" INTEGER NOT NULL,
    "toOffset" INTEGER NOT NULL,
    "isoWeek" TEXT NOT NULL,
    "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RotationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwapProposal" (
    "id" TEXT NOT NULL,
    "initiatorEmployeeId" TEXT NOT NULL,
    "initiatorDutyId" TEXT NOT NULL,
    "counterpartyEmployeeId" TEXT NOT NULL,
    "counterpartyDutyId" TEXT NOT NULL,
    "status" "SwapStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "proposalEvaluationId" TEXT,
    "acceptEvaluationId" TEXT,

    CONSTRAINT "SwapProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "baseRosterId" TEXT NOT NULL,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuarterlyFeedback" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "quarterKey" TEXT NOT NULL,
    "baseRosterCode" TEXT NOT NULL,
    "rosterProfile" "RosterProfile" NOT NULL,
    "categories" "FeedbackCategory"[],
    "satisfaction" INTEGER NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuarterlyFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleEvaluation" (
    "id" TEXT NOT NULL,
    "engineName" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "decision" "RuleDecision" NOT NULL,
    "findings" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "inputDigest" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLogEntry" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorEmployeeNumber" TEXT,
    "actorRoles" "Role"[],
    "action" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" "AuditResult" NOT NULL DEFAULT 'SUCCESS',
    "oldValue" JSONB,
    "newValue" JSONB,
    "correlationId" TEXT,
    "clientFingerprint" TEXT,
    "reason" TEXT,

    CONSTRAINT "AuditLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "kind" "SecurityEventKind" NOT NULL,
    "userId" TEXT,
    "subject" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "clientFingerprint" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserAccount_employeeId_key" ON "UserAccount"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAccount_externalSubject_key" ON "UserAccount"("externalSubject");

-- CreateIndex
CREATE INDEX "UserAccount_status_idx" ON "UserAccount"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeNumber_key" ON "Employee"("employeeNumber");

-- CreateIndex
CREATE INDEX "Employee_depot_rosterProfile_status_idx" ON "Employee"("depot", "rosterProfile", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeIdentity_email_key" ON "EmployeeIdentity"("email");

-- CreateIndex
CREATE INDEX "DutyPackage_status_depot_idx" ON "DutyPackage"("status", "depot");

-- CreateIndex
CREATE UNIQUE INDEX "DutyPackage_name_version_key" ON "DutyPackage"("name", "version");

-- CreateIndex
CREATE INDEX "Duty_depot_numericCode_idx" ON "Duty"("depot", "numericCode");

-- CreateIndex
CREATE UNIQUE INDEX "Duty_packageId_code_key" ON "Duty"("packageId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "BaseRoster_code_key" ON "BaseRoster"("code");

-- CreateIndex
CREATE INDEX "BaseRoster_profile_status_idx" ON "BaseRoster"("profile", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RosterLine_baseRosterId_lineNumber_key" ON "RosterLine"("baseRosterId", "lineNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RosterLineDay_rosterLineId_weekIndex_weekday_key" ON "RosterLineDay"("rosterLineId", "weekIndex", "weekday");

-- CreateIndex
CREATE INDEX "RosterAssignment_employeeId_validFrom_idx" ON "RosterAssignment"("employeeId", "validFrom");

-- CreateIndex
CREATE INDEX "RosterAssignment_rosterLineId_validFrom_idx" ON "RosterAssignment"("rosterLineId", "validFrom");

-- CreateIndex
CREATE INDEX "ScheduledDuty_date_positionType_idx" ON "ScheduledDuty"("date", "positionType");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledDuty_employeeId_date_key" ON "ScheduledDuty"("employeeId", "date");

-- CreateIndex
CREATE INDEX "RosterVersion_status_idx" ON "RosterVersion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RosterVersion_baseRosterId_label_key" ON "RosterVersion"("baseRosterId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "RosterVersionDay_versionId_lineNumber_weekIndex_weekday_key" ON "RosterVersionDay"("versionId", "lineNumber", "weekIndex", "weekday");

-- CreateIndex
CREATE INDEX "RosterWarning_versionId_severity_idx" ON "RosterWarning"("versionId", "severity");

-- CreateIndex
CREATE INDEX "AvailableDuty_status_date_idx" ON "AvailableDuty"("status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AvailableDuty_dutyId_date_key" ON "AvailableDuty"("dutyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AvailableDutyInterest_availableDutyId_employeeId_key" ON "AvailableDutyInterest"("availableDutyId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "RotationList_weekday_depot_key" ON "RotationList"("weekday", "depot");

-- CreateIndex
CREATE UNIQUE INDEX "RotationEntry_listId_employeeId_key" ON "RotationEntry"("listId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "RotationEntry_listId_baseIndex_key" ON "RotationEntry"("listId", "baseIndex");

-- CreateIndex
CREATE INDEX "SwapProposal_counterpartyEmployeeId_status_idx" ON "SwapProposal"("counterpartyEmployeeId", "status");

-- CreateIndex
CREATE INDEX "SwapProposal_initiatorEmployeeId_status_idx" ON "SwapProposal"("initiatorEmployeeId", "status");

-- CreateIndex
CREATE INDEX "WaitlistEntry_baseRosterId_status_enrolledAt_idx" ON "WaitlistEntry"("baseRosterId", "status", "enrolledAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_employeeId_baseRosterId_key" ON "WaitlistEntry"("employeeId", "baseRosterId");

-- CreateIndex
CREATE INDEX "QuarterlyFeedback_quarterKey_rosterProfile_idx" ON "QuarterlyFeedback"("quarterKey", "rosterProfile");

-- CreateIndex
CREATE UNIQUE INDEX "QuarterlyFeedback_employeeId_quarterKey_key" ON "QuarterlyFeedback"("employeeId", "quarterKey");

-- CreateIndex
CREATE INDEX "RuleEvaluation_requestType_createdAt_idx" ON "RuleEvaluation"("requestType", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLogEntry_occurredAt_idx" ON "AuditLogEntry"("occurredAt");

-- CreateIndex
CREATE INDEX "AuditLogEntry_objectType_objectId_idx" ON "AuditLogEntry"("objectType", "objectId");

-- CreateIndex
CREATE INDEX "AuditLogEntry_actorUserId_occurredAt_idx" ON "AuditLogEntry"("actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLogEntry_correlationId_idx" ON "AuditLogEntry"("correlationId");

-- CreateIndex
CREATE INDEX "SecurityEvent_kind_occurredAt_idx" ON "SecurityEvent"("kind", "occurredAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_userId_occurredAt_idx" ON "SecurityEvent"("userId", "occurredAt");

-- AddForeignKey
ALTER TABLE "UserAccount" ADD CONSTRAINT "UserAccount_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeIdentity" ADD CONSTRAINT "EmployeeIdentity_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Duty" ADD CONSTRAINT "Duty_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "DutyPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterLine" ADD CONSTRAINT "RosterLine_baseRosterId_fkey" FOREIGN KEY ("baseRosterId") REFERENCES "BaseRoster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterLineDay" ADD CONSTRAINT "RosterLineDay_rosterLineId_fkey" FOREIGN KEY ("rosterLineId") REFERENCES "RosterLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterAssignment" ADD CONSTRAINT "RosterAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterAssignment" ADD CONSTRAINT "RosterAssignment_rosterLineId_fkey" FOREIGN KEY ("rosterLineId") REFERENCES "RosterLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledDuty" ADD CONSTRAINT "ScheduledDuty_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledDuty" ADD CONSTRAINT "ScheduledDuty_dutyId_fkey" FOREIGN KEY ("dutyId") REFERENCES "Duty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterVersion" ADD CONSTRAINT "RosterVersion_baseRosterId_fkey" FOREIGN KEY ("baseRosterId") REFERENCES "BaseRoster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterVersionDay" ADD CONSTRAINT "RosterVersionDay_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "RosterVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterWarning" ADD CONSTRAINT "RosterWarning_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "RosterVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailableDuty" ADD CONSTRAINT "AvailableDuty_dutyId_fkey" FOREIGN KEY ("dutyId") REFERENCES "Duty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailableDuty" ADD CONSTRAINT "AvailableDuty_originEmployeeId_fkey" FOREIGN KEY ("originEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailableDuty" ADD CONSTRAINT "AvailableDuty_awardedEmployeeId_fkey" FOREIGN KEY ("awardedEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailableDutyInterest" ADD CONSTRAINT "AvailableDutyInterest_availableDutyId_fkey" FOREIGN KEY ("availableDutyId") REFERENCES "AvailableDuty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailableDutyInterest" ADD CONSTRAINT "AvailableDutyInterest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailableDutyInterest" ADD CONSTRAINT "AvailableDutyInterest_ruleEvaluationId_fkey" FOREIGN KEY ("ruleEvaluationId") REFERENCES "RuleEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReserveFillAttempt" ADD CONSTRAINT "ReserveFillAttempt_availableDutyId_fkey" FOREIGN KEY ("availableDutyId") REFERENCES "AvailableDuty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReserveFillAttempt" ADD CONSTRAINT "ReserveFillAttempt_ruleEvaluationId_fkey" FOREIGN KEY ("ruleEvaluationId") REFERENCES "RuleEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationEntry" ADD CONSTRAINT "RotationEntry_listId_fkey" FOREIGN KEY ("listId") REFERENCES "RotationList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationEntry" ADD CONSTRAINT "RotationEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationLog" ADD CONSTRAINT "RotationLog_listId_fkey" FOREIGN KEY ("listId") REFERENCES "RotationList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapProposal" ADD CONSTRAINT "SwapProposal_initiatorEmployeeId_fkey" FOREIGN KEY ("initiatorEmployeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapProposal" ADD CONSTRAINT "SwapProposal_initiatorDutyId_fkey" FOREIGN KEY ("initiatorDutyId") REFERENCES "ScheduledDuty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapProposal" ADD CONSTRAINT "SwapProposal_counterpartyEmployeeId_fkey" FOREIGN KEY ("counterpartyEmployeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapProposal" ADD CONSTRAINT "SwapProposal_counterpartyDutyId_fkey" FOREIGN KEY ("counterpartyDutyId") REFERENCES "ScheduledDuty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapProposal" ADD CONSTRAINT "SwapProposal_proposalEvaluationId_fkey" FOREIGN KEY ("proposalEvaluationId") REFERENCES "RuleEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapProposal" ADD CONSTRAINT "SwapProposal_acceptEvaluationId_fkey" FOREIGN KEY ("acceptEvaluationId") REFERENCES "RuleEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_baseRosterId_fkey" FOREIGN KEY ("baseRosterId") REFERENCES "BaseRoster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuarterlyFeedback" ADD CONSTRAINT "QuarterlyFeedback_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLogEntry" ADD CONSTRAINT "AuditLogEntry_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "UserAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
