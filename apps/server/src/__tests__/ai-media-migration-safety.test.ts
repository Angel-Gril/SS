import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = (name: string) => readFileSync(
  new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url),
  'utf8',
);

describe('AI media migration safety', () => {
  it('prebuilds each existing-table unique key in its own concurrent migration', () => {
    for (const name of [
      '20260716211500_prebuild_ai_image_job_owner_key',
      '20260716212000_prebuild_ai_image_job_workflow_attempt',
      '20260716212500_prebuild_media_asset_owner_key',
    ]) {
      const sql = migration(name).trim();
      expect(sql).toMatch(/^CREATE UNIQUE INDEX CONCURRENTLY /u);
      expect(sql.match(/CREATE\s/gu)).toHaveLength(1);
      expect(sql).not.toMatch(/BEGIN|COMMIT|SET /u);
    }

    const registry = migration('20260716213000_add_ai_media_workflows');
    expect(registry).toMatch(/UNIQUE USING INDEX "ai_image_job_id_owner"/u);
    expect(registry).toMatch(/UNIQUE USING INDEX "ai_image_job_workflow_attempt"/u);
    expect(registry).toMatch(/UNIQUE USING INDEX "media_asset_id_owner"/u);
  });

  it('locks provenance assets and freezes their job binding after insert', () => {
    const graph = migration('20260716214500_harden_ai_media_workflow_graph');
    const events = migration('20260716215500_validate_ai_media_event_provenance');
    const identity = migration('20260716220500_freeze_ai_media_graph_identity');

    expect(graph).toMatch(/"ai_image_job_id" = NEW\."job_id"\s+FOR SHARE/u);
    expect(events).toMatch(/FOR SHARE OF asset/u);
    expect(identity).toMatch(/media asset job binding is insert-time immutable/u);
    expect(identity).toMatch(/media_assets_ai_image_job_id_fkey[\s\S]*ON DELETE RESTRICT/u);
  });
});
