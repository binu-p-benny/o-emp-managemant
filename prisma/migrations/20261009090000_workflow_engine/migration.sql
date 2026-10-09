-- CreateEnum
CREATE TYPE "Phase" AS ENUM ('DESIGN_1', 'DESIGN_2', 'DESIGN_3', 'DESIGN_4', 'CONSTRUCTION');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'REWORK', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('STAGE', 'PHASE_START', 'APPROVAL');

-- CreateEnum
CREATE TYPE "DateSource" AS ENUM ('AUTO', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DelayType" AS ENUM ('IN_HOUSE', 'CLIENT_SIDE', 'REWORK');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('SUBMITTED', 'APPROVED', 'SENT_BACK');

-- CreateEnum
CREATE TYPE "PhaseStatus" AS ENUM ('LOCKED', 'AWAITING_START', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ASSIGNED', 'REASSIGNED', 'START_TASK_CREATED', 'REVIEW_REQUESTED', 'APPROVED', 'SENT_BACK', 'DELAY_FLAGGED', 'DUE_SOON', 'DUE_TODAY', 'OVERDUE', 'ESCALATION', 'REVIEW_WAITING', 'START_TASK_WAITING');

-- DropForeignKey
ALTER TABLE "ProjectStage" DROP CONSTRAINT "ProjectStage_projectId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectStage" DROP CONSTRAINT "ProjectStage_updatedById_fkey";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "constructionKickoff" DATE,
ADD COLUMN     "constructionStartedAt" TIMESTAMP(3),
ADD COLUMN     "currentPhase" "Phase" NOT NULL DEFAULT 'DESIGN_1',
ADD COLUMN     "designApprovedAt" TIMESTAMP(3),
ADD COLUMN     "designApprovedById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "reportsToId" TEXT;

-- DropTable
DROP TABLE "ProjectStage";

-- DropEnum
DROP TYPE "StageStatus";

-- DropEnum
DROP TYPE "WorkflowPhase";

-- CreateTable
CREATE TABLE "WorkflowTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "WorkflowTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseTemplate" (
    "id" TEXT NOT NULL,
    "workflowTemplateId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "phase" "Phase" NOT NULL,
    "constructionPhase" INTEGER,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "ownerRoleKey" TEXT NOT NULL,
    "taskGroup" TEXT NOT NULL,
    "startTrigger" JSONB NOT NULL,
    "startPlannedRule" JSONB,

    CONSTRAINT "PhaseTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "phaseTemplateId" TEXT NOT NULL,
    "kind" "TaskKind" NOT NULL DEFAULT 'STAGE',
    "phase" "Phase" NOT NULL,
    "constructionPhase" INTEGER,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "durationDays" INTEGER,
    "requiresReview" BOOLEAN NOT NULL DEFAULT true,
    "reviewerRoleKey" TEXT,
    "offsetRule" JSONB,
    "afterKey" TEXT,
    "assigneeRoleKeys" TEXT[],
    "preferredRoleKeys" TEXT[],
    "defaultAssigneeRoleKeys" TEXT[],
    "multiAssignee" BOOLEAN NOT NULL DEFAULT false,
    "milestone" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TaskTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPhase" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" "PhaseStatus" NOT NULL DEFAULT 'LOCKED',
    "actualStart" DATE,
    "actualEnd" DATE,
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectPhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "kind" "TaskKind" NOT NULL DEFAULT 'STAGE',
    "phaseKey" TEXT NOT NULL,
    "phase" "Phase" NOT NULL,
    "constructionPhase" INTEGER,
    "startsPhaseKey" TEXT,
    "startsPhase" "Phase",
    "startsConstructionPhase" INTEGER,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "plannedStart" DATE,
    "plannedEnd" DATE,
    "plannedSource" "DateSource" NOT NULL DEFAULT 'AUTO',
    "originalAutoPlannedEnd" DATE,
    "plannedChangedById" TEXT,
    "plannedChangedAt" TIMESTAMP(3),
    "shiftDays" INTEGER NOT NULL DEFAULT 0,
    "actualStart" DATE,
    "actualEnd" DATE,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "submittedAt" TIMESTAMP(3),
    "lastSubmittedAt" TIMESTAMP(3),
    "reworkCount" INTEGER NOT NULL DEFAULT 0,
    "reviewerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignee" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignmentHistory" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAssignmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDelay" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" "DelayType" NOT NULL,
    "reason" TEXT NOT NULL,
    "delayDays" INTEGER NOT NULL,
    "shiftedFollowing" BOOLEAN NOT NULL DEFAULT false,
    "flaggedById" TEXT NOT NULL,
    "flaggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDelay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskReview" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "note" TEXT,
    "byUserId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "data" JSONB,
    "byUserId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "taskId" TEXT,
    "projectId" TEXT,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupeKey" TEXT NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTemplate_key_key" ON "WorkflowTemplate"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PhaseTemplate_key_key" ON "PhaseTemplate"("key");

-- CreateIndex
CREATE UNIQUE INDEX "TaskTemplate_key_key" ON "TaskTemplate"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPhase_projectId_key_key" ON "ProjectPhase"("projectId", "key");

-- CreateIndex
CREATE INDEX "Task_projectId_phaseKey_order_idx" ON "Task"("projectId", "phaseKey", "order");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Task_projectId_templateKey_key" ON "Task"("projectId", "templateKey");

-- CreateIndex
CREATE INDEX "TaskAssignee_userId_idx" ON "TaskAssignee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignee_taskId_userId_key" ON "TaskAssignee"("taskId", "userId");

-- CreateIndex
CREATE INDEX "TaskAssignmentHistory_taskId_idx" ON "TaskAssignmentHistory"("taskId");

-- CreateIndex
CREATE INDEX "TaskDelay_taskId_idx" ON "TaskDelay"("taskId");

-- CreateIndex
CREATE INDEX "TaskReview_taskId_idx" ON "TaskReview"("taskId");

-- CreateIndex
CREATE INDEX "TaskEvent_taskId_idx" ON "TaskEvent"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "User_reportsToId_idx" ON "User"("reportsToId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_reportsToId_fkey" FOREIGN KEY ("reportsToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_designApprovedById_fkey" FOREIGN KEY ("designApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseTemplate" ADD CONSTRAINT "PhaseTemplate_workflowTemplateId_fkey" FOREIGN KEY ("workflowTemplateId") REFERENCES "WorkflowTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplate" ADD CONSTRAINT "TaskTemplate_phaseTemplateId_fkey" FOREIGN KEY ("phaseTemplateId") REFERENCES "PhaseTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhase" ADD CONSTRAINT "ProjectPhase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhase" ADD CONSTRAINT "ProjectPhase_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_plannedChangedById_fkey" FOREIGN KEY ("plannedChangedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignmentHistory" ADD CONSTRAINT "TaskAssignmentHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignmentHistory" ADD CONSTRAINT "TaskAssignmentHistory_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignmentHistory" ADD CONSTRAINT "TaskAssignmentHistory_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignmentHistory" ADD CONSTRAINT "TaskAssignmentHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDelay" ADD CONSTRAINT "TaskDelay_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDelay" ADD CONSTRAINT "TaskDelay_flaggedById_fkey" FOREIGN KEY ("flaggedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReview" ADD CONSTRAINT "TaskReview_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReview" ADD CONSTRAINT "TaskReview_byUserId_fkey" FOREIGN KEY ("byUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_byUserId_fkey" FOREIGN KEY ("byUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: line managers from the org chart (first active user holding the parent role).
UPDATE "User" AS u
SET "reportsToId" = (
  SELECT m."id"
  FROM "Role" r
  JOIN "User" m ON m."roleId" = r."parentId" AND m."isActive" = true
  WHERE r."id" = u."roleId"
  ORDER BY m."createdAt" ASC
  LIMIT 1
)
WHERE u."reportsToId" IS NULL;
