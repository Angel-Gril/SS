import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('logistics scope bootstrap migration contract', () => {
  it('persists one-time probes with expiry, immutable evidence and sanitized events', () => {
    const sql = readFileSync(
      resolve(
        import.meta.dirname,
        '../../prisma/migrations/20260713033000_add_logistics_scope_bootstrap/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain("'REJECTED', 'EXPIRED'");
    expect(sql).toContain('"nonce_digest" TEXT NOT NULL');
    expect(sql).toContain('"logistics_company_probes_one_live_per_bootstrap"');
    expect(sql).toContain("\"status\" IN ('ISSUED', 'CLAIMED', 'SUBMITTED')");
    expect(sql).toContain('"status" = \'EXPIRED\'');
    expect(sql).toContain('submitted evidence is immutable');
    expect(sql).toContain('logistics_scope_event_sanitized_payload_check');
    expect(sql).not.toMatch(/"nonce"\s+TEXT/i);
  });

  it('adds explicit deployment and schema-major identity to logistics channels', () => {
    const sql = readFileSync(
      resolve(
        import.meta.dirname,
        '../../prisma/migrations/20260713033000_add_logistics_scope_bootstrap/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain('ALTER TABLE "logistics_rule_channels"');
    expect(sql).toContain('"deployment_id" TEXT NOT NULL');
    expect(sql).toContain('"schema_major" INTEGER NOT NULL DEFAULT 1');
    expect(sql).toContain('logistics_rule_channel_deployment_schema_check');
    expect(sql).toContain('logistics_rule_channels_deployment_schema_scope_idx');
  });
});
