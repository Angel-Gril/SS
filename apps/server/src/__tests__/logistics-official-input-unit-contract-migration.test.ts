import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Official input-unit contract migration contract', () => {
  it('creates scoped append-only reviewed evidence with CAS and revocation guards', () => {
    const sql = readFileSync(
      resolve(
        import.meta.dirname,
        '../../prisma/migrations/20260713080000_add_official_input_unit_contracts/migration.sql',
      ),
      'utf8',
    );

    expect(sql).toContain('CREATE TABLE "logistics_official_input_unit_contracts"');
    expect(sql).toContain('official_input_unit_assignment_scope_fkey');
    expect(sql).toContain('official_input_unit_candidate_scope_fkey');
    expect(sql).toContain('official_input_unit_candidate_checksum_fkey');
    expect(sql).toContain('"currency" = \'CNY\'');
    expect(sql).toContain('"weight_unit" = \'g\'');
    expect(sql).toContain('"dimension_unit" = \'mm\'');
    expect(sql).toContain('"price_input_unit" = \'CNY_MAJOR\'');
    expect(sql).toContain('official_input_unit_contract_validate');
    expect(sql).toContain('official_input_unit_contract_protect');
    expect(sql).toContain('Official input-unit contract content is immutable');
    expect(sql).toContain('OFFICIAL_INPUT_UNIT_CONTRACT');
    expect(sql).toContain('official_input_unit_contract_event_required');
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "official_input_unit_supersedes_key"\s+ON "logistics_official_input_unit_contracts"\("supersedes_id"\);/,
    );
  });

  it('widens only measurement increments in a follow-up migration', () => {
    const original = readFileSync(
      resolve(
        import.meta.dirname,
        '../../prisma/migrations/20260713080000_add_official_input_unit_contracts/migration.sql',
      ),
      'utf8',
    );
    const migrationPath = resolve(
      import.meta.dirname,
      '../../prisma/migrations/20260713083000_allow_fractional_official_input_unit_steps/migration.sql',
    );
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');

    expect(original).toContain('"weight_increment_g" INTEGER NOT NULL');
    expect(original).toContain('"dimension_increment_mm" INTEGER NOT NULL');
    expect(sql).toMatch(/ALTER COLUMN "weight_increment_g" TYPE DECIMAL\(20, 9\)/);
    expect(sql).toMatch(/ALTER COLUMN "dimension_increment_mm" TYPE DECIMAL\(20, 9\)/);
    expect(sql).not.toMatch(/ALTER COLUMN "currency_minor_increment"/);
  });

  it('declares the matching Prisma model and reviewer relations', () => {
    const schema = readFileSync(
      resolve(import.meta.dirname, '../../prisma/schema.prisma'),
      'utf8',
    );

    expect(schema).toContain('model LogisticsOfficialInputUnitContract');
    expect(schema).toContain('sourceCandidateChecksum');
    expect(schema).toContain('supersedesId');
    expect(schema).toContain('reviewedOfficialInputUnitContracts');
    expect(schema).toContain('revokedOfficialInputUnitContracts');
    expect(schema).toMatch(/weightIncrementG\s+Decimal\s+@map\("weight_increment_g"\)\s+@db\.Decimal\(20, 9\)/);
    expect(schema).toMatch(/dimensionIncrementMm\s+Decimal\s+@map\("dimension_increment_mm"\)\s+@db\.Decimal\(20, 9\)/);
    expect(schema).toMatch(/currencyMinorIncrement\s+Int\s+@map\("currency_minor_increment"\)/);
  });
});
