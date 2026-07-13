import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('logistics method binding version migration contract', () => {
  it('versions active method bindings by immutable source revision', () => {
    const sql = readFileSync(
      resolve(
        import.meta.dirname,
        '../../prisma/migrations/20260713070000_version_logistics_method_bindings/migration.sql',
      ),
      'utf8',
    );

    expect(sql).toContain('DROP INDEX "method_rule_binding_active_method_key"');
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "method_rule_binding_active_method_revision_key"\s+ON "shop_delivery_method_rule_bindings"\("delivery_method_id", "source_revision_id"\)\s+WHERE "retired_at" IS NULL;/,
    );
    expect(sql).not.toMatch(
      /CREATE UNIQUE INDEX\s+"[^"]+"\s+ON "shop_delivery_method_rule_bindings"\("delivery_method_id"\)\s+WHERE "retired_at" IS NULL;/,
    );
  });
});
