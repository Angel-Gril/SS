import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../../prisma/migrations/20260712150000_add_ozon_logistics_rule_distribution/migration.sql', import.meta.url),
  'utf8',
);

describe('logistics rule persistence contract', () => {
  it('allows non-release events to identify an immutable subject', () => {
    expect(schema).toMatch(/model LogisticsRuleEvent[\s\S]*releaseId\s+String\?/);
    expect(schema).toMatch(/model LogisticsRuleEvent[\s\S]*subjectType\s+String/);
    expect(schema).toMatch(/model LogisticsRuleEvent[\s\S]*subjectId\s+String/);

    expect(migration).toContain('"release_id" TEXT,');
    expect(migration).toContain('"subject_type" TEXT NOT NULL');
    expect(migration).toContain('"subject_id" TEXT NOT NULL');
    expect(migration).toContain('logistics_event_release_requirement_check');
    expect(migration).toContain('logistics_release_event_once');
  });

  it('enforces release confidentiality, tenant ownership and same-channel rollback in PostgreSQL', () => {
    expect(migration).toContain('validate_logistics_release_scope');
    expect(migration).toContain('logistics_release_scope_constraint');
    expect(migration).toContain('rollback target belongs to another channel');
    expect(migration).toContain('release revision confidentiality does not match channel');
  });
  it('enforces publish versus rollback shape and exact historical rollback snapshots', () => {
    expect(migration).toContain('logistics_release_kind_target_check');
    expect(migration).toContain('rollback target cannot reference itself');
    expect(migration).toContain('rollback target must be an earlier release');
    expect(migration).toContain('rollback snapshot does not exactly match target release');
  });

  it('prevents mutation of channel identity fields', () => {
    expect(migration).toContain('protect_logistics_channel_identity');
    expect(migration).toContain('logistics_channel_identity_immutable');
    expect(migration).toContain('logistics channel identity is immutable');
  });

  it('validates transition event type, subject, tenant and non-transition subjects', () => {
    expect(migration).toContain('validate_logistics_rule_event');
    expect(migration).toContain('logistics_rule_event_constraint');
    expect(migration).toContain('event type does not match release kind');
    expect(migration).toContain('event tenant does not match channel');
    expect(migration).toContain('event subject is invalid');
  });


  it('deduplicates PUBLIC revisions despite a NULL source tenant', () => {
    expect(migration).toContain('logistics_public_revision_checksum_key');
    expect(migration).toContain('"source_owner_type" = \'PUBLIC\'');
    expect(migration).toContain('"source_tenant_id" IS NULL');
  });
});
