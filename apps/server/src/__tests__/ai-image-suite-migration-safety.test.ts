import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL(
  '../../prisma/migrations/20260719120000_add_ai_media_suites/migration.sql',
  import.meta.url,
), 'utf8');
const hardeningMigration = readFileSync(new URL(
  '../../prisma/migrations/20260719121000_harden_ai_media_suite_audit/migration.sql',
  import.meta.url,
), 'utf8');
const failedStatusMigration = readFileSync(new URL(
  '../../prisma/migrations/20260719120500_add_ai_media_suite_failed_status/migration.sql',
  import.meta.url,
), 'utf8');
const authorityMigration = readFileSync(new URL(
  '../../prisma/migrations/20260719121500_validate_ai_media_suite_authority/migration.sql',
  import.meta.url,
), 'utf8');
const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');

describe('AI image suite migration safety', () => {
  it('adds tenant-bound suite, slot and event tables without changing paid operation enums', () => {
    for (const table of ['ai_media_suites', 'ai_media_suite_slots', 'ai_media_suite_events']) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migration).toMatch(/FOREIGN KEY \("plan_version_id", "plan_id", "owner_user_id"\)[\s\S]*ai_media_plan_versions/u);
    expect(migration).toMatch(/FOREIGN KEY \("source_capture_snapshot_id", "source_subject_id"\)[\s\S]*source_capture_snapshots/u);
    expect(migration).toMatch(/FOREIGN KEY \("suite_id", "owner_user_id"\)[\s\S]*ai_media_suites/u);
    expect(migration).toMatch(/ai_media_suite_plan_version_claim_key/u);
    expect(migration).toMatch(/ai_media_suite_slot_key/u);
    expect(migration).toMatch(/protect_ai_media_suite_identity/u);
    expect(migration).toMatch(/protect_ai_media_suite_slot_identity/u);
    expect(migration).toMatch(/protect_ai_media_suite_event_immutable/u);
    expect(hardeningMigration).toMatch(/ai_media_suite_event_validate_insert/u);
    expect(hardeningMigration).toMatch(/ai_media_suite_revision_requires_event[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(hardeningMigration).not.toMatch(/diagnostics_json" IS DISTINCT/u);
    expect(authorityMigration).toMatch(/validate_ai_media_suite_insert/u);
    expect(authorityMigration).toMatch(/review_status" IS DISTINCT FROM 'APPROVED'/u);
    expect(authorityMigration).toMatch(/current_version_id" IS DISTINCT FROM NEW\."plan_version_id/u);
    expect(authorityMigration).toMatch(/stored_snapshot\."capture_hash" IS DISTINCT FROM NEW\."source_capture_hash/u);
    expect(failedStatusMigration.trim()).toBe(
      'ALTER TYPE "AiMediaSuiteStatus" ADD VALUE IF NOT EXISTS \'FAILED\' AFTER \'PARTIAL_FAILURE\';',
    );
    expect(migration).not.toMatch(/ALTER TYPE "AiMediaOperation"/u);
    expect(migration).not.toMatch(/ai_cost_reservations|ai_cost_settlements/u);
  });

  it('keeps the Prisma model and canonical slot-key bounds aligned', () => {
    expect(schema).toContain('model AiMediaSuite {');
    expect(schema).toContain('model AiMediaSuiteSlot {');
    expect(schema).toContain('model AiMediaSuiteEvent {');
    expect(schema).toMatch(/slotKey\s+String\s+@map\("slot_key"\)\s+@db\.VarChar\(1024\)/u);
    expect(schema).toMatch(/@@unique\(\[planVersionId\].*ai_media_suite_plan_version_claim_key/u);
    expect(schema).toMatch(/@@unique\(\[suiteId, slotKey\].*ai_media_suite_slot_key/u);
  });
});
