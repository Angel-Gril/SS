import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../../prisma/migrations/20260717130000_add_ai_cost_ledger/migration.sql', import.meta.url),
  'utf8',
);
const stateMigration = readFileSync(
  new URL('../../prisma/migrations/20260717134500_validate_ai_cost_ledger_state/migration.sql', import.meta.url),
  'utf8',
);
const identityMigration = readFileSync(
  new URL('../../prisma/migrations/20260717135500_freeze_ai_cost_provider_identity/migration.sql', import.meta.url),
  'utf8',
);
const acceptanceMigration = readFileSync(
  new URL('../../prisma/migrations/20260717140000_pair_ai_cost_provider_acceptance/migration.sql', import.meta.url),
  'utf8',
);

describe('AI cost ledger persistence contract', () => {
  it('stores one reservation per job and append-only idempotent settlements', () => {
    expect(schema).toContain('model AiCostReservation {');
    expect(schema).toContain('jobId                    String                  @unique');
    expect(schema).toContain('@@unique([ownerUserId, idempotencyKey]');
    expect(schema).toContain('model AiCostSettlement {');
    expect(schema).toContain('@@unique([reservationId, idempotencyKey]');
    expect(migration).toMatch(/ai_cost_settlements_immutable/u);
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON "ai_cost_settlements"/u);
    expect(stateMigration).toMatch(/ai_cost_settlement_reservation_idempotency.*UNIQUE/su);
    expect(stateMigration).toMatch(/ai_cost_reservations_job_id_key.*UNIQUE/su);
  });

  it('constrains amounts and terminal settlement payloads at the database boundary', () => {
    expect(migration).toMatch(/estimated_cost_minor" >= 0/u);
    expect(migration).toMatch(/maximum_cost_minor" >= "estimated_cost_minor/u);
    expect(migration).toMatch(/actual_cost_minor" >= 0/u);
    expect(migration).toMatch(/RECONCILIATION_REQUIRED.*actual_cost_minor" IS NULL/su);
    expect(migration).toMatch(/RECONCILED_CHARGE.*actual_cost_minor" IS NOT NULL/su);
    expect(stateMigration).toMatch(/cost reservation does not match its frozen job/u);
    expect(stateMigration).toMatch(/cost settlement is invalid for reservation state/u);
    expect(stateMigration).toMatch(/cost overrun requires reconciliation/u);
    expect(identityMigration).toMatch(/reconciliation requires provider acceptance identity/u);
    expect(identityMigration).toMatch(/costed AI job identity is immutable/u);
    expect(acceptanceMigration).toMatch(/provider request identity and acceptance time must be paired/u);
    expect(acceptanceMigration).toMatch(/provider acceptance may only be bound when reconciliation starts/u);
  });
});
