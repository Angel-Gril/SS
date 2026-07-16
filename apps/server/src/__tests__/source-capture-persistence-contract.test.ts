import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const migrationUrl = new URL(
  '../../prisma/migrations/20260714210000_add_source_capture_snapshots/migration.sql',
  import.meta.url,
);
const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : '';

function modelBlock(name: string): string {
  return schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] || '';
}

describe('source capture persistence contract', () => {
  it('keeps one tenant-owned subject identity and one bounded legacy projection', () => {
    const subject = modelBlock('SourceCaptureSubject');

    expect(subject).toMatch(/ownerUserId\s+String[\s\S]*sourcePlatform\s+String[\s\S]*sourceProductId\s+String/);
    expect(subject).toMatch(/legacySupplyGoodsId\s+String\?\s+@unique/);
    expect(subject).toMatch(/@@unique\(\[ownerUserId, sourcePlatform, sourceProductId\]/);
    expect(subject).toMatch(/snapshots\s+SourceCaptureSnapshot\[\]/);
    expect(migration).toContain('source_capture_subject_identity_key');
    expect(migration).toContain('source_capture_subject_legacy_projection_key');
  });

  it('stores immutable versioned canonical snapshots with provenance and audit identity', () => {
    const snapshot = modelBlock('SourceCaptureSnapshot');

    expect(schema).toMatch(/enum SourceCaptureIngestChannel[\s\S]*EXTENSION_DEVICE[\s\S]*WEB_ACCOUNT[\s\S]*LEGACY_ADAPTER/);
    expect(snapshot).toMatch(/subjectId\s+String[\s\S]*version\s+Int[\s\S]*schemaVersion\s+String/);
    expect(snapshot).toMatch(/captureHash\s+String[\s\S]*payloadBytes\s+Int[\s\S]*payload\s+Json/);
    expect(snapshot).toMatch(/stageCounts\s+Json[\s\S]*provenance\s+Json/);
    expect(snapshot).toMatch(/parserVersion\s+String[\s\S]*extensionVersion\s+String\?/);
    expect(snapshot).toMatch(/completeness\s+Json[\s\S]*truncations\s+Json[\s\S]*hasEstimatedValues\s+Boolean/);
    expect(snapshot).toMatch(/actorUserId\s+String[\s\S]*deviceSessionId\s+String\?/);
    expect(snapshot).toMatch(/ingestChannel\s+SourceCaptureIngestChannel[\s\S]*rolloutRevision\s+String[\s\S]*rolloutStage\s+String/);
    expect(snapshot).toMatch(/capturedAt\s+DateTime[\s\S]*createdAt\s+DateTime/);
  });

  it('deduplicates exact content while assigning an ordered version per subject', () => {
    const snapshot = modelBlock('SourceCaptureSnapshot');

    expect(snapshot).toMatch(/@@unique\(\[subjectId, version\]/);
    expect(snapshot).toMatch(/@@unique\(\[subjectId, captureHash\]/);
    expect(snapshot).toMatch(/@@index\(\[subjectId, capturedAt\]\)/);
    expect(migration).toContain('source_capture_snapshot_subject_version_key');
    expect(migration).toContain('source_capture_snapshot_subject_hash_key');
  });

  it('enforces the 8 MiB JSONB envelope and normalized identity at the database boundary', () => {
    expect(migration).toContain('source_capture_snapshot_payload_bytes_check');
    expect(migration).toContain('8388608');
    expect(migration).toContain('10485760');
    expect(migration).toContain('"payload_bytes" BETWEEN 1 AND 8388608');
    expect(migration).toContain("jsonb_typeof(\"payload\") = 'object'");
    expect(migration).toContain('source_capture_snapshot_hash_check');
    expect(migration).toContain("'^[0-9a-f]{64}$'");
    expect(migration).toContain('source_capture_subject_identity_check');
    expect(migration).toContain('lower(btrim("source_platform"))');
    expect(migration).toContain('source_capture_snapshot_parser_version_check');
    expect(migration).toContain('source_capture_snapshot_rollout_stage_check');
    expect(migration).toContain("'shadow_write', 'dual_read', 'v2_only'");
    expect(migration).toContain("jsonb_typeof(\"completeness\") = 'object'");
    expect(migration).toContain("jsonb_typeof(\"truncations\") = 'array'");
  });

  it('protects snapshot payload, audit identity and version from update or deletion', () => {
    expect(migration).toContain('prevent_source_capture_snapshot_rewrite');
    expect(migration).toContain('source_capture_snapshots_immutable');
    expect(migration).toContain("TG_OP = 'DELETE'");
    expect(migration).toContain('source capture snapshots are immutable');
  });

  it('retains snapshots if owners, subjects, device sessions, or legacy projections are removed', () => {
    for (const relation of [
      'source_capture_subjects_owner_user_id_fkey',
      'source_capture_snapshots_subject_id_fkey',
      'source_capture_snapshots_actor_user_id_fkey',
      'source_capture_snapshots_device_session_id_fkey',
    ]) {
      const block = migration.match(new RegExp(
        `ADD CONSTRAINT "${relation}"[\\s\\S]*?ON DELETE (?:RESTRICT|CASCADE|SET NULL) ON UPDATE`,
      ))?.[0] || '';
      expect(block, relation).toContain('ON DELETE RESTRICT');
    }

    const projection = migration.match(/ADD CONSTRAINT "source_capture_subjects_legacy_supply_goods_id_fkey"[\s\S]*?ON DELETE (?:RESTRICT|CASCADE|SET NULL) ON UPDATE/)?.[0] || '';
    expect(projection).toContain('ON DELETE SET NULL');
  });
});
