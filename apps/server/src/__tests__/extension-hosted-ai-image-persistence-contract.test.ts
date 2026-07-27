import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(new URL(
  '../../prisma/migrations/20260727100000_add_extension_hosted_ai_image_plan_bindings/migration.sql',
  import.meta.url,
), 'utf8');
const compactMigration = migration.replace(/\s+/gu, ' ').trim();

function modelBlock(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`, 'u'));
  expect(match, `model ${name} must exist`).not.toBeNull();
  return match?.[0] || '';
}

function quotedColumns(value: string): string[] {
  return [...value.matchAll(/"([^"]+)"/gu)].map((match) => match[1]!);
}

function uniqueIndexes(table: string): Array<{ name: string; columns: string[] }> {
  const pattern = new RegExp(
    `CREATE UNIQUE INDEX "([^"]+)" ON "${table}"\\(([^)]+)\\);`,
    'gu',
  );
  return [...compactMigration.matchAll(pattern)].map((match) => ({
    name: match[1]!,
    columns: quotedColumns(match[2]!),
  }));
}

function foreignKeys(table: string): Array<{
  name: string;
  columns: string[];
  targetTable: string;
  targetColumns: string[];
}> {
  const pattern = new RegExp(
    `ALTER TABLE "${table}" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \\(([^)]+)\\) REFERENCES "([^"]+)"\\(([^)]+)\\)`,
    'gu',
  );
  return [...compactMigration.matchAll(pattern)].map((match) => ({
    name: match[1]!,
    columns: quotedColumns(match[2]!),
    targetTable: match[3]!,
    targetColumns: quotedColumns(match[4]!),
  }));
}

describe('extension hosted AI image persistence contract', () => {
  it('runs the hosted persistence migration with bounded DDL waits', () => {
    expect(migration).toMatch(
      /^BEGIN;\r?\nSET LOCAL lock_timeout = '5s';\r?\nSET LOCAL statement_timeout = '15min';/u,
    );
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u);
  });

  it('persists one exact owner-bound plan binding', () => {
    const model = modelBlock('ExtensionHostedAiImagePlanBinding');

    expect(model).toContain('@@map("extension_hosted_ai_image_plan_bindings")');
    expect(migration).toContain('CREATE TABLE "extension_hosted_ai_image_plan_bindings"');
    expect(uniqueIndexes('extension_hosted_ai_image_plan_bindings')).toEqual([
      {
        name: 'extension_hosted_ai_plan_binding_plan_owner_key',
        columns: ['plan_id', 'owner_user_id'],
      },
      {
        name: 'extension_hosted_ai_plan_binding_owner_authority_key',
        columns: ['owner_user_id', 'authority_hash'],
      },
      {
        name: 'extension_hosted_ai_plan_binding_owner_hash_key',
        columns: ['owner_user_id', 'binding_hash'],
      },
    ]);
    expect(foreignKeys('extension_hosted_ai_image_plan_bindings')).toEqual([
      {
        name: 'extension_hosted_ai_plan_binding_plan_owner_fkey',
        columns: ['plan_id', 'owner_user_id'],
        targetTable: 'ai_media_plans',
        targetColumns: ['id', 'owner_user_id'],
      },
      {
        name: 'extension_hosted_ai_plan_binding_listing_owner_fkey',
        columns: ['listing_workflow_id', 'owner_user_id'],
        targetTable: 'source_listing_workflows',
        targetColumns: ['id', 'owner_user_id'],
      },
    ]);
  });

  it('serializes Hosted and BYOK execution mode claims for one exact draft', () => {
    const model = modelBlock('ExtensionAiImageExecutionModeLock');

    expect(model).toContain('@@map("extension_ai_image_execution_mode_locks")');
    expect(migration).toContain('CREATE TABLE "extension_ai_image_execution_mode_locks"');
    expect(compactMigration).toContain(
      "CHECK (\"execution_mode\" IN ('ERP_HOSTED', 'BYOK'))",
    );
    expect(compactMigration).toContain(
      "PERFORM pg_advisory_xact_lock(hashtextextended( jsonb_build_array( 'extension-ai-image-execution-mode/v1'",
    );
    expect(compactMigration).toContain(
      'ON CONFLICT ( "owner_user_id", "listing_workflow_id", "draft_revision", "draft_version" ) DO UPDATE',
    );
    expect(compactMigration).toContain(
      'RETURNING "execution_mode", "shop_id" INTO stored_execution_mode, stored_shop_id',
    );
    expect(compactMigration).toContain(
      'OR stored_shop_id IS DISTINCT FROM requested_shop_id',
    );
    expect(compactMigration).toContain(
      'CREATE TRIGGER "ai_media_suite_extension_mode_lock" BEFORE INSERT ON "ai_media_suites"',
    );
    expect(compactMigration).toContain(
      'CREATE TRIGGER "extension_byok_media_provenance_mode_lock" BEFORE INSERT ON "extension_byok_media_provenance"',
    );
    expect(compactMigration).toContain(
      'FROM "extension_byok_media_provenance" provenance',
    );
    expect(compactMigration).toContain(
      'JOIN "ai_media_suites" suite ON suite."plan_id" = binding."plan_id"',
    );
    expect(compactMigration).toContain(
      "CONSTRAINT = 'extension_ai_image_execution_mode_exclusive'",
    );
  });

  it('keeps hosted listing assignment identity and replay keys exact', () => {
    const model = modelBlock('ExtensionHostedAiImageListingAssignment');

    expect(model).toMatch(/assignmentId\s+String\s+@id\s+@map\("assignment_id"\)\s+@db\.VarChar\(100\)/u);
    expect(model).toMatch(/executionMode\s+String\s+@default\("ERP_HOSTED"\)/u);
    expect(model).toMatch(/batchId\s+String\s+@map\("batch_id"\)\s+@db\.VarChar\(100\)/u);
    expect(model).toMatch(/batchItemOrdinal\s+Int\s+@map\("batch_item_ordinal"\)/u);
    expect(model).toMatch(/assignmentScope\s+String\s+@map\("assignment_scope"\)/u);
    expect(migration).toContain('CREATE TABLE "extension_hosted_ai_image_listing_assignments"');
    expect(migration).toContain('"assignment_id" VARCHAR(100) NOT NULL');
    expect(compactMigration).toContain(
      'CONSTRAINT "extension_hosted_listing_assignment_mode_check" CHECK ("execution_mode" = \'ERP_HOSTED\')',
    );
    expect(compactMigration).toContain(
      'CONSTRAINT "extension_hosted_listing_assignment_scope_check" CHECK ("assignment_scope" IN (\'SKU\', \'PRODUCT\'))',
    );
    expect(uniqueIndexes('extension_hosted_ai_image_listing_assignments')).toEqual([
      {
        name: 'extension_hosted_listing_assignment_owner_idempotency_item_key',
        columns: ['owner_user_id', 'idempotency_key', 'batch_item_ordinal'],
      },
      {
        name: 'extension_hosted_listing_assignment_owner_batch_item_key',
        columns: ['owner_user_id', 'batch_id', 'batch_item_ordinal'],
      },
      {
        name: 'extension_hosted_listing_assignment_asset_owner_key',
        columns: ['asset_id', 'owner_user_id'],
      },
      {
        name: 'extension_hosted_listing_assignment_job_owner_key',
        columns: ['job_id', 'owner_user_id'],
      },
      {
        name: 'extension_hosted_listing_assignment_bound_revision_ordinal_key',
        columns: ['listing_workflow_id', 'bound_draft_revision', 'assignment_ordinal'],
      },
    ]);
  });

  it('allows one batch to share its idempotency key and bound draft only by exact ordinals', () => {
    expect(compactMigration).not.toContain(
      'ON "extension_hosted_ai_image_listing_assignments"("owner_user_id", "idempotency_key");',
    );
    expect(compactMigration).not.toContain(
      'ON "extension_hosted_ai_image_listing_assignments"( "listing_workflow_id", "bound_draft_revision" );',
    );
    expect(compactMigration).toContain(
      '"owner_user_id", "idempotency_key", "batch_item_ordinal"',
    );
    expect(compactMigration).toContain(
      '"listing_workflow_id", "bound_draft_revision", "assignment_ordinal"',
    );
  });

  it('binds every hosted assignment authority to its exact parent identity', () => {
    expect(foreignKeys('extension_hosted_ai_image_listing_assignments')).toEqual([
      {
        name: 'extension_hosted_listing_assignment_owner_fkey',
        columns: ['owner_user_id'],
        targetTable: 'users',
        targetColumns: ['id'],
      },
      {
        name: 'extension_hosted_listing_assignment_actor_fkey',
        columns: ['actor_user_id'],
        targetTable: 'users',
        targetColumns: ['id'],
      },
      {
        name: 'extension_hosted_listing_assignment_device_owner_fkey',
        columns: ['device_session_id', 'owner_user_id'],
        targetTable: 'extension_device_sessions',
        targetColumns: ['id', 'owner_user_id'],
      },
      {
        name: 'extension_hosted_listing_assignment_shop_owner_fkey',
        columns: ['shop_id', 'owner_user_id'],
        targetTable: 'shops',
        targetColumns: ['id', 'user_id'],
      },
      {
        name: 'extension_hosted_listing_assignment_workflow_owner_fkey',
        columns: ['listing_workflow_id', 'owner_user_id'],
        targetTable: 'source_listing_workflows',
        targetColumns: ['id', 'owner_user_id'],
      },
      {
        name: 'extension_hosted_listing_assignment_source_draft_fkey',
        columns: [
          'listing_workflow_id',
          'source_draft_revision',
          'owner_user_id',
          'source_draft_version',
        ],
        targetTable: 'source_listing_draft_versions',
        targetColumns: ['workflow_id', 'revision', 'owner_user_id', 'draft_version'],
      },
      {
        name: 'extension_hosted_listing_assignment_bound_draft_fkey',
        columns: [
          'listing_workflow_id',
          'bound_draft_revision',
          'owner_user_id',
          'bound_draft_version',
        ],
        targetTable: 'source_listing_draft_versions',
        targetColumns: ['workflow_id', 'revision', 'owner_user_id', 'draft_version'],
      },
      {
        name: 'extension_hosted_listing_assignment_asset_owner_fkey',
        columns: ['asset_id', 'owner_user_id'],
        targetTable: 'media_assets',
        targetColumns: ['id', 'owner_user_id'],
      },
      {
        name: 'extension_hosted_listing_assignment_plan_owner_fkey',
        columns: ['plan_id', 'owner_user_id'],
        targetTable: 'ai_media_plans',
        targetColumns: ['id', 'owner_user_id'],
      },
      {
        name: 'extension_hosted_listing_assignment_plan_version_fkey',
        columns: ['plan_version_id', 'plan_id', 'owner_user_id'],
        targetTable: 'ai_media_plan_versions',
        targetColumns: ['id', 'plan_id', 'owner_user_id'],
      },
      {
        name: 'extension_hosted_listing_assignment_suite_owner_fkey',
        columns: ['suite_id', 'owner_user_id'],
        targetTable: 'ai_media_suites',
        targetColumns: ['id', 'owner_user_id'],
      },
      {
        name: 'extension_hosted_listing_assignment_suite_slot_fkey',
        columns: ['suite_slot_id', 'suite_id', 'owner_user_id'],
        targetTable: 'ai_media_suite_slots',
        targetColumns: ['id', 'suite_id', 'owner_user_id'],
      },
      {
        name: 'extension_hosted_listing_assignment_child_workflow_fkey',
        columns: ['child_workflow_id', 'owner_user_id'],
        targetTable: 'ai_media_workflows',
        targetColumns: ['id', 'owner_user_id'],
      },
      {
        name: 'extension_hosted_listing_assignment_job_owner_fkey',
        columns: ['job_id', 'owner_user_id'],
        targetTable: 'ai_image_jobs',
        targetColumns: ['id', 'owner_user_id'],
      },
      {
        name: 'extension_hosted_listing_assignment_reservation_owner_fkey',
        columns: ['reservation_id', 'owner_user_id'],
        targetTable: 'ai_cost_reservations',
        targetColumns: ['id', 'owner_user_id'],
      },
      {
        name: 'extension_hosted_listing_assignment_settlement_fkey',
        columns: ['settlement_id'],
        targetTable: 'ai_cost_settlements',
        targetColumns: ['id'],
      },
    ]);
  });

  it('defers only the forward bound-draft foreign key until transaction commit', () => {
    const boundDraftConstraint = compactMigration.match(
      /ADD CONSTRAINT "extension_hosted_listing_assignment_bound_draft_fkey"[\s\S]*?;/u,
    )?.[0];
    const sourceDraftConstraint = compactMigration.match(
      /ADD CONSTRAINT "extension_hosted_listing_assignment_source_draft_fkey"[\s\S]*?;/u,
    )?.[0];

    expect(boundDraftConstraint).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(sourceDraftConstraint).not.toContain('DEFERRABLE');
    expect(migration.match(/DEFERRABLE INITIALLY DEFERRED/gu)).toHaveLength(1);
  });

  it('permits only an exact ledger-backed apply-only suite job transition', () => {
    expect(compactMigration).toContain(
      'CREATE OR REPLACE FUNCTION require_ai_media_suite_execution_graph_from_job()',
    );
    expect(compactMigration).toContain(
      "OLD.\"applied_at\" IS NULL AND NEW.\"applied_at\" IS NOT NULL",
    );
    expect(compactMigration).toContain(
      "to_jsonb(NEW) - ARRAY[ 'applied_mode', 'apply_target_type', 'apply_target_id', 'applied_at', 'updated_at' ]::TEXT[]",
    );
    expect(compactMigration).toContain(
      'FROM "extension_hosted_ai_image_listing_assignments" assignment',
    );
    expect(compactMigration).toContain(
      'assignment."listing_workflow_id" = NEW."apply_target_id"',
    );
    expect(compactMigration).toContain('IF hosted_assignment_count = 1 THEN RETURN NULL;');
    expect(compactMigration).toContain(
      'PERFORM assert_ai_media_suite_execution_graph( bound_slot."suite_id", bound_slot."owner_user_id" );',
    );
  });
});
