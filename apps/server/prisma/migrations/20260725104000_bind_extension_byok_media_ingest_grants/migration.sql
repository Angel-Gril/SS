-- PostgreSQL must commit the enum addition in the preceding migration before
-- this transaction may reference the new value in a CHECK expression.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE "extension_command_grants"
  ADD CONSTRAINT "extension_command_grant_byok_ingest_binding_check"
  CHECK (
    "operation" <> 'BYOK_MEDIA_INGEST'
    OR (
      "shop_id" IS NOT NULL
      AND "workflow_id" IS NOT NULL
      AND "draft_version" IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE "extension_command_grants"
  VALIDATE CONSTRAINT "extension_command_grant_byok_ingest_binding_check";

COMMIT;
