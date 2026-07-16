import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(new URL(
  '../../prisma/migrations/20260715090000_add_source_ozon_category_mappings/migration.sql',
  import.meta.url,
), 'utf8');

describe('source Ozon category mapping persistence contract', () => {
  it('declares scoped mapping and append-only decision models with actor/reviewer evidence', () => {
    expect(schema).toContain('enum SourceOzonCategoryMappingScope');
    expect(schema).toContain('enum SourceOzonCategoryMappingStatus');
    expect(schema).toContain('enum SourceOzonCategoryMappingDecisionAction');
    expect(schema).toMatch(/model SourceOzonCategoryMapping \{[\s\S]*scopeKey\s+String[\s\S]*ownerUserId\s+String\?[\s\S]*sourceSnapshotId\s+String[\s\S]*sourceProfileHash\s+String[\s\S]*catalogRevision\s+String[\s\S]*confirmCount\s+Int[\s\S]*rejectCount\s+Int[\s\S]*reviewedByUserId\s+String\?/);
    expect(schema).toMatch(/model SourceOzonCategoryMappingDecision \{[\s\S]*operationKey\s+String[\s\S]*transitionVersion\s+Int[\s\S]*decisionKey\s+String\s+@unique[\s\S]*requestHash\s+String[\s\S]*actorUserId\s+String[\s\S]*sourceSnapshotId\s+String[\s\S]*sourceProfileHash\s+String/);
    expect(schema).toContain('name: "source_ozon_category_mapping_identity_key"');
  });

  it('enforces scope ownership and reviewed global promotion in PostgreSQL', () => {
    const compact = migration.replace(/\s+/g, ' ');
    expect(compact).toMatch(/CONSTRAINT "source_ozon_category_mapping_scope_owner_check" CHECK \( \( "scope" = 'TENANT' AND "owner_user_id" IS NOT NULL AND "scope_key" = 'tenant:' \|\| "owner_user_id" \) OR \( "scope" = 'GLOBAL' AND "owner_user_id" IS NULL AND "scope_key" = 'global' \) \)/);
    expect(compact).toMatch(/CONSTRAINT "source_ozon_category_mapping_global_review_check" CHECK \( "scope" <> 'GLOBAL' OR \( "reviewed_by_user_id" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "promoted_from_mapping_id" IS NOT NULL \) \)/);
    expect(compact).toMatch(/CONSTRAINT "source_ozon_category_mapping_decision_scope_check" CHECK \([\s\S]*"action" IN \('CONFIRM', 'REJECT'\)[\s\S]*"action" = 'PROMOTE'/);
  });

  it('makes decision idempotency durable and audit rows immutable', () => {
    expect(migration).toContain('UNIQUE ("decision_key")');
    expect(migration).toContain('UNIQUE ("mapping_id", "transition_version")');
    expect(migration.replace(/\s+/g, ' ')).toContain(
      'NEW."transition_version" IS DISTINCT FROM (aggregate."confirm_count" + aggregate."reject_count")',
    );
    expect(migration).toContain('FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")');
    expect(migration).toContain('CREATE FUNCTION "prevent_source_ozon_category_mapping_decision_mutation"()');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "source_ozon_category_mapping_decisions"');
  });
});
