import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(new URL(
  '../../prisma/migrations/20260716010000_add_ozon_publisher_parity_observations/migration.sql',
  import.meta.url,
), 'utf8');
const hardeningMigration = readFileSync(new URL(
  '../../prisma/migrations/20260716011000_harden_ozon_publisher_parity_observations/migration.sql',
  import.meta.url,
), 'utf8');
const provenanceMigration = readFileSync(new URL(
  '../../prisma/migrations/20260716012000_complete_ozon_publisher_parity_provenance/migration.sql',
  import.meta.url,
), 'utf8');

describe('Ozon publisher parity persistence contract', () => {
  it('separates expiring observations, durable subjects, and immutable decisions', () => {
    expect(schema).toContain('model OzonPublisherParityObservation');
    expect(schema).toContain('model OzonPublisherParityDifferenceSubject');
    expect(schema).toContain('model OzonPublisherParityDecision');
    expect(schema).toMatch(/model OzonPublisherParityObservation \{[\s\S]*recordKey\s+String[\s\S]*recordContractVersion\s+String[\s\S]*reportContractVersion\s+String[\s\S]*reportHash\s+String[\s\S]*expiresAt\s+DateTime/);
    expect(schema).toMatch(/model OzonPublisherParityDifferenceSubject \{[\s\S]*rolloutRevision\s+String[\s\S]*recordContractVersion\s+String[\s\S]*reportContractVersion\s+String[\s\S]*publisherContractVersion\s+String\s+[\s\S]*payloadCompilerVersion\s+String\s+[\s\S]*differenceTotal\s+Int[\s\S]*differenceRows\s+Json[\s\S]*approvalState\s+OzonPublisherParityApprovalState[\s\S]*stateVersion\s+Int/);
    expect(schema).toMatch(/model OzonPublisherParityDecision \{[\s\S]*transitionVersion\s+Int[\s\S]*decisionKey\s+String[\s\S]*operationKey\s+String[\s\S]*requestHash\s+String/);
  });

  it('allows only exact compiler contracts to create an approvable subject', () => {
    expect(hardeningMigration).toContain(
      '"publisher_contract_version" = \'ozon-listing-production-compile-adapter/v1\'',
    );
    expect(hardeningMigration).toContain(
      '"payload_compiler_version" = \'ozon-listing-payload-compiler/v1\'',
    );
    expect(hardeningMigration).toContain('ALTER COLUMN "publisher_contract_version" SET NOT NULL');
    expect(hardeningMigration).toContain('IS NOT DISTINCT FROM');
    expect(hardeningMigration).toContain('Ozon publisher parity defect evidence cannot be approved');
  });

  it('persists record and report contracts independently', () => {
    expect(hardeningMigration).toContain(
      'RENAME COLUMN "contract_version" TO "report_contract_version"',
    );
    expect(hardeningMigration).toContain(
      '"record_contract_version" TEXT NOT NULL',
    );
    expect(hardeningMigration).toContain('ozon-publisher-parity-observation/v1');
    expect(hardeningMigration).toContain('ozon-publisher-parity-difference-subject/v1');
    expect(hardeningMigration).toContain('ozon-publisher-entrypoint-parity/v1');
  });

  it('binds observations to complete fixed difference evidence and bounded retention rows', () => {
    const compact = migration.replace(/\s+/g, ' ');
    expect(compact).toContain('jsonb_array_length("difference_rows_json") = "difference_returned"');
    expect(compact).toContain('pg_column_size("difference_rows_json") <= 131072');
    expect(compact).toContain('NEW."difference_truncated"');
    expect(compact).toContain('NEW."rollout_revision" IS DISTINCT FROM aggregate."rollout_revision"');
    expect(migration).toContain('CREATE INDEX "ozon_publisher_parity_observation_expiry_idx"');
    expect(hardeningMigration).toContain(
      'CREATE FUNCTION "ozon_publisher_parity_difference_rows_valid"',
    );
    expect(hardeningMigration).toContain(
      "difference_row ?& ARRAY['path', 'kind', 'classification', 'presence', 'type']",
    );
  });

  it('makes observation history immutable and subject aggregates database-owned', () => {
    expect(hardeningMigration).toContain(
      'BEFORE UPDATE ON "ozon_publisher_parity_observations"',
    );
    expect(hardeningMigration).toContain(
      'AFTER INSERT ON "ozon_publisher_parity_observations"',
    );
    expect(hardeningMigration).toContain('"observation_count" = "observation_count" + 1');
    expect(hardeningMigration).toContain('pg_trigger_depth() < 2');
    expect(hardeningMigration).toContain('Ozon publisher parity subject observations are database-owned');
  });

  it('binds subject identity to payload item counts and validates existing approvals', () => {
    expect(schema).toMatch(/model OzonPublisherParityDifferenceSubject \{[\s\S]*legacyItemCount\s+Int[\s\S]*v2ItemCount\s+Int/);
    expect(provenanceMigration).toContain(
      'Existing Ozon publisher parity subject observations disagree on item counts',
    );
    expect(provenanceMigration).toContain(
      'Existing Ozon publisher parity subject has no retained count evidence',
    );
    expect(provenanceMigration).toContain(
      'NEW."legacy_item_count" IS DISTINCT FROM aggregate."legacy_item_count"',
    );
    expect(provenanceMigration).toContain(
      'NEW."v2_item_count" IS DISTINCT FROM aggregate."v2_item_count"',
    );
    expect(provenanceMigration).toContain(
      'ADD CONSTRAINT "ozon_parity_subject_approval_eligibility_check"',
    );
    expect(provenanceMigration).toContain(
      '"ozon_publisher_parity_difference_rows_approvable"("difference_rows_json")',
    );
  });

  it('requires one matching decision per deferred CAS transition and prevents history mutation', () => {
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(migration).toContain('UNIQUE ("subject_key", "transition_version")');
    expect(migration).toContain('UNIQUE ("subject_key", "operation_key")');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "ozon_publisher_parity_decisions"');
    expect(migration).toContain('BEFORE DELETE ON "ozon_publisher_parity_difference_subjects"');
  });
});
