import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(new URL(
  '../../prisma/migrations/20260725110000_enforce_extension_ai_billing_separation/migration.sql',
  import.meta.url,
), 'utf8');
const upgradeRunner = readFileSync(new URL(
  '../../scripts/ai-media-postgres-upgrade-integration.mjs',
  import.meta.url,
), 'utf8');

describe('dual-mode AI billing separation persistence contract', () => {
  it('stores hosted and BYOK execution modes in separate fixed-mode ledgers', () => {
    expect(schema).toMatch(/model AiImageJob \{[\s\S]*executionMode\s+String\s+@default\("ERP_HOSTED"\)/u);
    expect(schema).toMatch(/model ExtensionByokMediaProvenance \{[\s\S]*executionMode\s+String\s+@default\("BYOK"\)/u);
    expect(migration).toMatch(/ai_image_jobs_execution_mode_check[\s\S]*"execution_mode" = 'ERP_HOSTED'/u);
    expect(upgradeRunner).toMatch(/addAiImageExecutionModeCompatibilityColumn/u);
    expect(upgradeRunner).toMatch(/dropAiImageExecutionModeCompatibilityColumn/u);
  });

  it('requires an exact reservation before dispatch and an exact charge before success', () => {
    expect(migration).toMatch(/paid AI image provider dispatch requires an exact RESERVED cost reservation/u);
    expect(migration).toMatch(/reservation\."status" = 'RESERVED'/u);
    expect(migration).toMatch(/successful paid AI image job requires its exact cost settlement/u);
    expect(migration).toMatch(/settlement\."kind" IN \('CHARGE', 'RECONCILED_CHARGE'\)/u);
    expect(migration).toMatch(/settlement\."actual_cost_minor" = NEW\."actual_cost_cents"/u);
    expect(migration).toMatch(/IF TG_OP = 'UPDATE' AND EXISTS/u);
    expect(migration).toMatch(/BEFORE INSERT OR UPDATE ON "ai_image_jobs"/u);
    expect(migration).not.toMatch(/OLD\."status" IS DISTINCT FROM 'SUCCEEDED'/u);
  });
});
