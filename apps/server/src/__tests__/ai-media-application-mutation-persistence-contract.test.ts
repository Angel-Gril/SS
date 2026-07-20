import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(new URL(
  '../../prisma/migrations/20260720169000_add_ai_media_application_mutations/migration.sql',
  import.meta.url,
), 'utf8');
const authorityMigration = readFileSync(new URL(
  '../../prisma/migrations/20260720170000_harden_ai_media_application_mutation_authority/migration.sql',
  import.meta.url,
), 'utf8');

describe('AI media application mutation persistence contract', () => {
  it('declares an owner-bound immutable application and rollback ledger', () => {
    expect(schema).toMatch(/enum AiMediaApplicationMutationKind[\s\S]*APPLY[\s\S]*ROLLBACK/u);
    expect(schema).toMatch(/enum AiMediaApplicationMode[\s\S]*APPEND[\s\S]*REPLACE/u);
    expect(schema).toMatch(/model AiMediaApplicationMutation[\s\S]*rollbackOfId[\s\S]*beforeState[\s\S]*afterState/u);
    expect(schema).toContain('@@unique([ownerUserId, operationKey], map: "ai_media_application_mutation_owner_operation_key")');
    expect(schema).toContain('@@unique([jobId, kind], map: "ai_media_application_mutation_job_kind_key")');
    expect(schema).toContain('@@unique([ownerUserId, targetType, targetId, targetSequence], map: "ai_media_application_mutation_target_sequence_key")');
  });

  it('enforces provenance, rollback shape and append-only history in PostgreSQL', () => {
    expect(migration).toContain('ai_media_application_mutations_workflow_id_owner_user_id_fkey');
    expect(migration).toContain('ai_media_application_mutations_job_id_owner_user_id_fkey');
    expect(migration).toContain('ai_media_application_mutations_asset_id_owner_user_id_fkey');
    expect(migration).toContain('application mutation job does not belong to workflow');
    expect(migration).toContain('application mutation output is not the reviewed job asset');
    expect(migration).toContain('application rollback does not mirror the applied projection');
    expect(migration).toContain('AI media application mutations are immutable');
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON "ai_media_application_mutations"/u);
    expect(authorityMigration.match(/\) IS TRUE\)/gu)).toHaveLength(2);
    expect(authorityMigration).toContain('authority upgrade requires an empty ledger');
    expect(authorityMigration.indexOf('LOCK TABLE "ai_media_application_mutations" IN ACCESS EXCLUSIVE MODE'))
      .toBeLessThan(authorityMigration.indexOf('authority upgrade requires an empty ledger'));
    expect(authorityMigration).toContain('"before_state_json" IS DISTINCT FROM "after_state_json"');
    expect(authorityMigration.match(/CASE WHEN jsonb_typeof/gu)).toHaveLength(12);
    expect(authorityMigration).toContain("ARRAY['version', 'images', 'watermarkedImages', 'editedImages']::text[]");
    expect(authorityMigration).toContain("ARRAY['present', 'value']::text[]");
    expect(authorityMigration).toContain('stored_job."workflow_attempt" IS DISTINCT FROM stored_workflow."current_attempt"');
    expect(authorityMigration).toContain('stored_job."operation"::text IS DISTINCT FROM stored_workflow."operation"::text');
    expect(authorityMigration).toContain('NEW."target_version_before" IS DISTINCT FROM target_updated_at');
    expect(authorityMigration).toContain("target_metadata = 'null'::jsonb");
    expect(authorityMigration).toContain('before projection does not match current target');
    const workflowLock = authorityMigration.indexOf('FROM "ai_media_workflows"');
    const jobLock = authorityMigration.indexOf('FROM "ai_image_jobs"');
    const assetLock = authorityMigration.indexOf('FROM "media_assets"');
    const targetLock = authorityMigration.indexOf('FROM "supply_goods"');
    expect(workflowLock).toBeGreaterThan(0);
    expect(jobLock).toBeGreaterThan(workflowLock);
    expect(assetLock).toBeGreaterThan(jobLock);
    expect(targetLock).toBeGreaterThan(assetLock);
    expect(authorityMigration.match(/FOR UPDATE;/gu)).toHaveLength(2);
    expect(authorityMigration).not.toContain('CREATE TRIGGER "ai_media_application_mutations_validate_authority_insert"');
  });
});
