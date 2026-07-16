BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE TYPE "AiMediaOperation" AS ENUM ('TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE');
CREATE TYPE "AiMediaWorkflowStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED');
CREATE TYPE "AiMediaReviewStatus" AS ENUM ('NOT_READY', 'PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "AiMediaInputRole" AS ENUM ('REFERENCE', 'MASK');

ALTER TABLE "ai_image_jobs"
  ADD COLUMN "operation" "AiMediaOperation" NOT NULL DEFAULT 'TEXT_TO_IMAGE',
  ADD COLUMN "workflow_id" TEXT,
  ADD COLUMN "workflow_attempt" INTEGER;

COMMIT;
