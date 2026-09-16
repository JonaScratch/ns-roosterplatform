-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SWAP_REQUEST_RECEIVED', 'SWAP_ACCEPTED', 'SWAP_REJECTED', 'SWAP_CANCELLED', 'SWAP_INVALIDATED', 'AVAILABLE_DUTY_OPENED', 'AVAILABLE_DUTY_INTEREST_REGISTERED', 'AVAILABLE_DUTY_ALLOCATED', 'AVAILABLE_DUTY_NOT_ALLOCATED', 'RES_ASSIGNMENT_CONFIRMED', 'RES_ASSIGNMENT_CHANGED', 'RES_ASSIGNMENT_WITHDRAWN', 'ROSTER_CHANGED', 'SYSTEM_NOTICE');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('RUILING', 'BESCHIKBARE_DIENST', 'ROOSTER', 'DIENSTINDELING', 'SYSTEEM');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- AlterTable
ALTER TABLE "StationLocation" ADD COLUMN     "didContactEmail" TEXT,
ADD COLUMN     "qualificationsConfigured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rosterProfilesConfigured" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "actionPath" TEXT,
    "eventKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_readAt_idx" ON "Notification"("recipientUserId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_createdAt_idx" ON "Notification"("recipientUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_recipientUserId_eventKey_key" ON "Notification"("recipientUserId", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_eventKey_key" ON "OutboxEvent"("eventKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_createdAt_idx" ON "OutboxEvent"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
