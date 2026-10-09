import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readMigration = (name: string) => readFile(new URL(
  `../../prisma/migrations/${name}/migration.sql`,
  import.meta.url,
), 'utf8');

describe('AI provider reconciliation persistence migrations', () => {
  it('adds the provider reconciliation state and due queue additively', async () => {
    const [schema, migration] = await Promise.all([
      readFile(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8'),
      readMigration('20260721124000_add_ai_provider_reconciliation_state'),
    ]);

    expect(schema).toMatch(/enum AiProviderReconciliationStatus \{\s+NOT_REQUIRED\s+PENDING\s+RUNNING\s+RETRY_WAIT\s+MANUAL_REVIEW\s+RECOVERED\s+NO_OUTPUT\s+NOT_SUBMITTED\s+CANCELLED_OUTPUT_RETAINED\s+\}/u);
    expect(schema).toMatch(/providerReconciliationStatus\s+AiProviderReconciliationStatus\s+@default\(NOT_REQUIRED\)/u);
    expect(schema).toMatch(/@@index\(\[providerReconciliationStatus, providerReconciliationNextAt, id\], map: "ai_image_job_provider_reconciliation_due"\)/u);

    expect(migration).toMatch(/CREATE TYPE "AiProviderReconciliationStatus" AS ENUM/u);
    expect(migration).toMatch(/ADD COLUMN "provider_reconciliation_status" "AiProviderReconciliationStatus" NOT NULL DEFAULT 'NOT_REQUIRED'/u);
    expect(migration).toMatch(/CREATE INDEX "ai_image_job_provider_reconciliation_due"[\s\S]*"provider_reconciliation_next_at"[\s\S]*"id"/u);
    expect(migration).not.toMatch(/DROP (?:TABLE|COLUMN|TYPE|INDEX)/u);
  });

  it('backfills only terminal unresolved jobs into bounded states', async () => {
    const migration = await readMigration('20260721124000_add_ai_provider_reconciliation_state');

    expect(migration.match(/WHERE "status" IN \('FAILED', 'CANCELLED'\)/gu)).toHaveLength(3);
    expect(migration).toMatch(/"provider_job_id" IS NULL AND "error_code" = 'PROVIDER_SUBMISSION_UNCERTAIN'/u);
    expect(migration).toMatch(/"operation" <> 'IMAGE_TRANSLATE'/u);
    expect(migration).toMatch(/'PROVIDER_JOB_ID_MISMATCH'/u);
    expect(migration).toMatch(/"provider_reconciliation_status" = 'NO_OUTPUT'[\s\S]*"error_code" = 'PROVIDER_TASK_FAILED'/u);
    expect(migration).toMatch(/"provider_reconciliation_status" = 'PENDING'[\s\S]*"provider_reconciliation_next_at" = CURRENT_TIMESTAMP[\s\S]*INTERVAL '15 minutes'/u);
    expect(migration).not.toMatch(/WHERE "status" (?:=|IN) \('RUNNING'/u);
  });

  it('validates state shape and narrowly guards transitions', async () => {
    const migration = await readMigration('20260721125000_harden_ai_provider_reconciliation_state');

    expect(migration).toMatch(/ADD CONSTRAINT "ai_image_job_provider_reconciliation_state_check" CHECK \([\s\S]*\) NOT VALID;/u);
    expect(migration).toMatch(/VALIDATE CONSTRAINT "ai_image_job_provider_reconciliation_state_check"/u);
    expect(migration).toMatch(/"provider_reconciliation_status" = 'RUNNING'[\s\S]*"provider_reconciliation_lease_owner" IS NOT NULL[\s\S]*"provider_reconciliation_lease_token_hash" ~ '\^\[0-9a-f\]\{64\}\$'/u);
    expect(migration).toMatch(/"provider_reconciliation_status" IN \('PENDING', 'RETRY_WAIT'\)[\s\S]*"provider_reconciliation_next_at" IS NOT NULL/u);
    expect(migration).toMatch(/'RECOVERED', 'NO_OUTPUT', 'NOT_SUBMITTED', 'CANCELLED_OUTPUT_RETAINED'[\s\S]*"provider_reconciled_at" IS NOT NULL/u);
    expect(migration).toMatch(/terminal AI provider reconciliation is immutable/u);
    expect(migration).toMatch(/AI provider reconciliation revision must advance exactly once/u);
    expect(migration).toMatch(/invalid AI provider reconciliation transition/u);
    expect(migration).toMatch(/BEFORE UPDATE OF\s+"provider_reconciliation_status"/u);
    expect(migration).not.toMatch(/BEFORE UPDATE ON "ai_image_jobs"/u);
  });

  it('indexes unresolved tasks for contextual workflow recovery without a table lock', async () => {
    const [schema, migration] = await Promise.all([
      readFile(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8'),
      readMigration('20260721126000_add_ai_provider_reconciliation_workflow_index'),
    ]);

    expect(schema).toMatch(/@@index\(\[workflowId, providerReconciliationStatus\], map: "ai_image_job_workflow_provider_reconciliation"\)/u);
    expect(migration).toMatch(/CREATE INDEX CONCURRENTLY IF NOT EXISTS "ai_image_job_workflow_provider_reconciliation"/u);
    expect(migration).toMatch(/\("workflow_id", "provider_reconciliation_status"\)/u);
    expect(migration).not.toMatch(/BEGIN;|ALTER TABLE|DROP INDEX/u);
  });

  it('adds an immutable provider reconciliation event ledger for standalone and workflow jobs', async () => {
    const [schema, migration] = await Promise.all([
      readFile(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8'),
      readMigration('20260721127000_add_ai_provider_reconciliation_events'),
    ]);

    expect(schema).toMatch(/model AiProviderReconciliationEvent \{[\s\S]*eventKey\s+String\s+@unique\(/u);
    expect(migration).toMatch(/CREATE TABLE "ai_provider_reconciliation_events"/u);
    expect(migration).toMatch(/INSERT INTO "ai_provider_reconciliation_events"/u);
    expect(migration).toMatch(/FOREIGN KEY \("job_id", "owner_user_id"\)[\s\S]*REFERENCES "ai_image_jobs"/u);
    expect(migration).toMatch(/provider reconciliation events are immutable/u);
    expect(migration).not.toMatch(/DROP (?:TABLE|COLUMN|TYPE|INDEX)/u);
  });

  it('normalizes legacy blank task identities and rejects new blank evidence', async () => {
    const migration = await readMigration('20260721128000_normalize_ai_provider_reconciliation_identity');

    expect(migration).toMatch(/DISABLE TRIGGER "ai_image_jobs_workflow_request_immutable"/u);
    expect(migration).toMatch(/SET "provider_job_id" = NULL[\s\S]*NULLIF\(BTRIM\("provider_job_id"\), ''\) IS NULL/u);
    expect(migration).toMatch(/ENABLE TRIGGER "ai_image_jobs_workflow_request_immutable"/u);
    expect(migration).toMatch(/ADD CONSTRAINT "ai_image_job_provider_job_id_nonblank_check" CHECK/u);
    expect(migration).toMatch(/VALIDATE CONSTRAINT "ai_image_job_provider_job_id_nonblank_check"/u);
    expect(migration).not.toMatch(/DROP (?:TABLE|COLUMN|TYPE|INDEX)/u);
  });

  it('allows immutable terminal anomalies and indexes expired reconciliation leases', async () => {
    const [schema, anomalyMigration, leaseMigration, deadlineMigration] = await Promise.all([
      readFile(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8'),
      readMigration('20260721129000_allow_ai_provider_reconciliation_anomalies'),
      readMigration('20260721130000_index_ai_provider_reconciliation_leases'),
      readMigration('20260721131000_extend_ai_provider_reconciliation_backfill_deadlines'),
    ]);

    expect(schema).toMatch(/@@index\(\[jobId, reconciliationRevision, createdAt\], map: "ai_provider_reconciliation_event_job_revision"\)/u);
    expect(schema).toMatch(/@@index\(\[providerReconciliationStatus, providerReconciliationLeaseExpiresAt, id\], map: "ai_image_job_provider_reconciliation_lease_due"\)/u);
    expect(anomalyMigration).toMatch(/DROP CONSTRAINT "ai_provider_reconciliation_event_job_revision"/u);
    expect(anomalyMigration).toMatch(/CREATE INDEX "ai_provider_reconciliation_event_job_revision"[\s\S]*"created_at"/u);
    expect(leaseMigration).toMatch(/CREATE INDEX CONCURRENTLY IF NOT EXISTS "ai_image_job_provider_reconciliation_lease_due"/u);
    expect(leaseMigration).not.toMatch(/BEGIN;|ALTER TABLE|DROP INDEX/u);
    expect(deadlineMigration).toMatch(/provider_reconciliation_status" IN \('PENDING', 'RUNNING', 'RETRY_WAIT'\)/u);
    expect(deadlineMigration).toMatch(/CURRENT_TIMESTAMP \+ INTERVAL '24 hours'/u);
    expect(deadlineMigration).toMatch(/provider_reconciliation_revision" = "provider_reconciliation_revision" \+ 1/u);
    expect(deadlineMigration).toMatch(/PROVIDER_RECONCILIATION_DEADLINE_EXTENDED/u);
    expect(deadlineMigration).toMatch(/INSERT INTO "ai_provider_reconciliation_events"/u);
  });

  it('adds an explicit, narrow terminal transition for approved historical suite abandonment', async () => {
    const migration = await readMigration('20261002120000_allow_historical_suite_reconciliation_abandonment');
    expect(migration).toMatch(/REPLACE\(definition, old_transition, new_transition\)/u);
    expect(migration).toMatch(/OLD\."provider_reconciliation_status" = 'MANUAL_REVIEW'/u);
    expect(migration).toMatch(/NEW\."provider_reconciliation_status"[^\n]*'CANCELLED_OUTPUT_RETAINED'/u);
    expect(migration).toMatch(/PROVIDER_OUTPUT_DIMENSIONS_MISMATCH/u);
    expect(migration).toMatch(/workflow.*suite_slot|suite_slot.*workflow/iu);
    expect(migration).toMatch(/24 hours|INTERVAL '24 hours'/u);
    expect(migration).not.toMatch(/DROP (?:TABLE|COLUMN|TYPE|INDEX)/u);
  });

  it('adds a precise known count-response abandonment branch without rewriting old Provider facts or disabling guards', async () => {
    const migration = await readMigration('20261009160000_allow_count_undelivered_suite_abandonment');
    expect(migration).toMatch(/CREATE FUNCTION ai_media_count_undelivered_abandonment_allowed/u);
    expect(migration).toMatch(/job\.provider = 'custom' AND job\.model = 'gpt-image-2-count'/u);
    expect(migration).toMatch(/job\.error_code = 'INVALID_PROVIDER_RESULT'/u);
    expect(migration).toMatch(/job\.workflow_attempt = workflow\.current_attempt AND slot\.attempt = job\.workflow_attempt/u);
    expect(migration).toMatch(/cost\.status = 'RECONCILIATION_REQUIRED'/u);
    expect(migration).toMatch(/cost\.provider_request_id = job\.provider_job_id/u);
    expect(migration).toMatch(/NOT EXISTS \(SELECT 1 FROM media_assets/u);
    expect(migration).toMatch(/ai_media_gpt2_count_suite_runtime_valid/u);
    expect(migration).toContain('PROVIDER_OUTPUT_DIMENSIONS_MISMATCH');
    expect(migration).toContain("INTERVAL '24 hours'");
    expect(migration).not.toMatch(/UPDATE\s+"?(?:ai_image_jobs|ai_cost_reservations)|DISABLE TRIGGER|DROP (?:TABLE|COLUMN|TYPE|INDEX)/u);
  });
});
