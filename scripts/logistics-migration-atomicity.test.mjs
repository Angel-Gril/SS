import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrations = [
  '20260712150000_add_ozon_logistics_rule_distribution',
  '20260712170500_add_extension_device_sessions',
  '20260712213000_add_logistics_capture_tasks',
  '20260712230000_add_logistics_capture_candidate_sets',
  '20260713033000_add_logistics_scope_bootstrap',
  '20260713080000_add_official_input_unit_contracts',
];

test('large logistics migrations execute atomically', () => {
  for (const migration of migrations) {
    const sql = readFileSync(
      `apps/server/prisma/migrations/${migration}/migration.sql`,
      'utf8',
    ).trim();
    assert.match(sql, /^BEGIN;/, `${migration} must start a transaction`);
    assert.match(sql, /COMMIT;$/, `${migration} must commit the transaction`);
    assert.doesNotMatch(
      sql,
      /(?:CREATE|DROP)\s+INDEX\s+CONCURRENTLY/i,
      `${migration} cannot use concurrent index DDL inside the transaction`,
    );
  }
});
