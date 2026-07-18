import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = (name: string) => readFileSync(
  new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url),
  'utf8',
);

describe('AI media planning migration safety', () => {
  it('prebuilds existing source ownership keys in isolated concurrent migrations', () => {
    for (const name of [
      '20260718130000_prebuild_source_capture_subject_owner_key',
      '20260718130500_prebuild_source_capture_snapshot_subject_key',
    ]) {
      const sql = migration(name).trim();
      expect(sql).toMatch(/^CREATE UNIQUE INDEX CONCURRENTLY /u);
      expect(sql.match(/CREATE\s/gu)).toHaveLength(1);
      expect(sql).not.toMatch(/BEGIN|COMMIT|SET /u);
    }
  });

  it('adds a tenant-bound planning aggregate without reusing paid image operations', () => {
    const attachSql = migration('20260718130700_attach_source_capture_planning_keys');
    const sql = migration('20260718131000_add_ai_media_planning');

    expect(attachSql).toMatch(/UNIQUE USING INDEX "source_capture_subject_id_owner_idx"/u);
    expect(attachSql).toMatch(/UNIQUE USING INDEX "source_capture_snapshot_id_subject_idx"/u);
    expect(attachSql.indexOf('ALTER TABLE "source_capture_snapshots"'))
      .toBeLessThan(attachSql.indexOf('ALTER TABLE "source_capture_subjects"'));
    expect(sql).not.toMatch(/UNIQUE USING INDEX/u);
    for (const table of [
      'ai_media_plans',
      'ai_media_planning_runs',
      'ai_media_plan_versions',
      'ai_media_plan_events',
    ]) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
    expect(sql).toMatch(/FOREIGN KEY \("source_subject_id", "owner_user_id"\)[\s\S]*source_capture_subjects/u);
    expect(sql).toMatch(/FOREIGN KEY \("source_capture_snapshot_id", "source_subject_id"\)[\s\S]*source_capture_snapshots/u);
    expect(sql).toMatch(/ai_media_plan_current_version_fkey[\s\S]*"current_version_id", "id", "owner_user_id"/u);
    expect(sql).toMatch(/ai_media_plan_approved_version_fkey[\s\S]*"approved_version_id", "id", "owner_user_id"/u);
    expect(sql).toMatch(/protect_ai_media_plan_version_immutable/u);
    expect(sql).toMatch(/protect_ai_media_plan_event_immutable/u);
    expect(sql).toMatch(/protect_ai_media_planning_run_identity/u);
    expect(sql).toMatch(/NEW\."version" IS DISTINCT FROM stored_plan\."latest_version" \+ 1/u);
    expect(sql).toMatch(/ai_media_plan_revision_requires_event[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(sql).toMatch(/review_status" IN \('APPROVED', 'REJECTED'\)[\s\S]*reviewed_by_user_id" IS NOT NULL/u);
    expect(sql).toMatch(/AI media plan review requires matching audit evidence/u);
    expect(sql).toMatch(/ai_media_plan_version_parent_fkey[\s\S]*ON DELETE RESTRICT ON UPDATE NO ACTION/u);
    expect(sql).not.toMatch(/ALTER TYPE "AiMediaOperation"/u);
    expect(sql).not.toMatch(/ai_cost_reservations|ai_cost_settlements/u);
  });

  it('keeps Prisma relations aligned with immutable plan history', () => {
    const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');

    for (const model of ['AiMediaPlan', 'AiMediaPlanningRun', 'AiMediaPlanVersion', 'AiMediaPlanEvent']) {
      expect(schema).toContain(`model ${model} {`);
    }
    expect(schema).toMatch(/currentVersionId\s+String\?[\s\S]*approvedVersionId\s+String\?/u);
    expect(schema).toMatch(/@@unique\(\[id, planId, ownerUserId\].*ai_media_plan_version_identity/u);
    expect(schema).toMatch(/@@unique\(\[ownerUserId, idempotencyKey\].*ai_media_plan_owner_idempotency/u);
  });
});
