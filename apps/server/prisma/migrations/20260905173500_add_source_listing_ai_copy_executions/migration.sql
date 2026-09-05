CREATE TABLE "source_listing_ai_copy_executions" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "operation_key" VARCHAR(200) NOT NULL,
    "client_request_hash" CHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_listing_ai_copy_executions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "source_listing_ai_copy_execution_owner_draft_operation_key"
ON "source_listing_ai_copy_executions"("owner_user_id", "draft_id", "operation_key");

CREATE INDEX "source_listing_ai_copy_execution_status_updated_idx"
ON "source_listing_ai_copy_executions"("status", "updated_at");
