CREATE TYPE "AiPromptRevisionStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "AiPromptTestRunStatus" AS ENUM ('PASS', 'FAIL');
CREATE TYPE "AiPromptReleaseAction" AS ENUM ('PUBLISH', 'ROLLBACK');

CREATE TABLE "ai_prompt_templates" (
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "current_sequence" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_prompt_templates_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "ai_prompt_revisions" (
  "id" TEXT NOT NULL,
  "template_key" TEXT NOT NULL,
  "status" "AiPromptRevisionStatus" NOT NULL DEFAULT 'DRAFT',
  "prompt_template" TEXT NOT NULL,
  "negative_prompt_template" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "note" TEXT,
  "created_by_user_id" TEXT NOT NULL,
  "updated_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_prompt_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_prompt_test_runs" (
  "id" TEXT NOT NULL,
  "revision_id" TEXT NOT NULL,
  "revision_checksum" TEXT NOT NULL,
  "status" "AiPromptTestRunStatus" NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_prompt_test_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_prompt_releases" (
  "id" TEXT NOT NULL,
  "template_key" TEXT NOT NULL,
  "revision_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "action" "AiPromptReleaseAction" NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "test_run_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_prompt_releases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_prompt_revisions_template_key_created_at_idx"
  ON "ai_prompt_revisions"("template_key", "created_at");
CREATE INDEX "ai_prompt_revisions_template_key_status_idx"
  ON "ai_prompt_revisions"("template_key", "status");
CREATE INDEX "ai_prompt_test_runs_revision_id_created_at_idx"
  ON "ai_prompt_test_runs"("revision_id", "created_at");
CREATE UNIQUE INDEX "ai_prompt_releases_template_key_sequence_key"
  ON "ai_prompt_releases"("template_key", "sequence");
CREATE INDEX "ai_prompt_releases_revision_id_idx"
  ON "ai_prompt_releases"("revision_id");
CREATE INDEX "ai_prompt_releases_test_run_id_idx"
  ON "ai_prompt_releases"("test_run_id");

ALTER TABLE "ai_prompt_revisions"
  ADD CONSTRAINT "ai_prompt_revisions_template_key_fkey"
  FOREIGN KEY ("template_key") REFERENCES "ai_prompt_templates"("key")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_prompt_test_runs"
  ADD CONSTRAINT "ai_prompt_test_runs_revision_id_fkey"
  FOREIGN KEY ("revision_id") REFERENCES "ai_prompt_revisions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_prompt_releases"
  ADD CONSTRAINT "ai_prompt_releases_template_key_fkey"
  FOREIGN KEY ("template_key") REFERENCES "ai_prompt_templates"("key")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_prompt_releases"
  ADD CONSTRAINT "ai_prompt_releases_revision_id_fkey"
  FOREIGN KEY ("revision_id") REFERENCES "ai_prompt_revisions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_prompt_releases"
  ADD CONSTRAINT "ai_prompt_releases_test_run_id_fkey"
  FOREIGN KEY ("test_run_id") REFERENCES "ai_prompt_test_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
