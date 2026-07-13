import { describe, expect, it, vi } from 'vitest';
import {
  createPrismaOfficialInputUnitContractRepository,
} from '../services/logistics-official-input-unit-contract-prisma.js';

const NOW = new Date('2026-07-13T08:00:00.000Z');
const VALID_UNTIL = new Date('2026-07-20T08:00:00.000Z');

function decimal(value: string) {
  return { toString: () => value };
}

function assignmentRow() {
  return {
    assignmentId: 'assignment-1',
    channelId: 'channel-1',
    tenantId: 'tenant-1',
    shopId: 'shop-1',
    companyId: 'company-1',
    warehouseId: 'warehouse-1',
    originCountryUid: 'china',
    originCityUid: 'xiamen',
    destinationCountryUid: 'russia',
    destinationLocationUid: 'moscow',
    destinationLabel: 'Moscow',
  };
}

function candidateRow() {
  return {
    candidateId: 'official-candidate-1',
    responseChecksum: 'a'.repeat(64),
    capturedAt: new Date('2026-07-13T07:30:00.000Z'),
    reviewedAt: new Date('2026-07-13T07:40:00.000Z'),
    fingerprint: { currency: 'CNY', weightGrams: '1000' },
    quoteCount: 63,
  };
}

function verifyInput(overrides: Record<string, unknown> = {}) {
  return {
    actorUserId: 'super-admin-1',
    assignmentId: 'assignment-1',
    candidateId: 'official-candidate-1',
    expectedCandidateChecksum: 'a'.repeat(64),
    weightIncrementG: 1,
    dimensionIncrementMm: 1,
    currencyMinorIncrement: 1,
    unitAttestation: {
      currency: 'CNY' as const,
      weightUnit: 'g' as const,
      dimensionUnit: 'mm' as const,
      priceInputUnit: 'CNY_MAJOR' as const,
    },
    reviewNote: 'Official page units checked',
    expectedCurrentContractId: null,
    verifiedAt: NOW,
    validUntil: VALID_UNTIL,
    sourceMaxAgeMs: 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

function sqlClient(query: ReturnType<typeof vi.fn>, execute = vi.fn(async (_sql: string, ..._params: unknown[]) => 1)) {
  const tx = { $queryRawUnsafe: query, $executeRawUnsafe: execute };
  return {
    client: {
      ...tx,
      $transaction: vi.fn(async (operation: (value: typeof tx) => Promise<unknown>) =>
        operation(tx)),
    },
    execute,
  };
}

describe('Prisma Official input-unit contract repository', () => {
  it('derives immutable source provenance and writes its audit event atomically', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('official-input-unit:assignment')) return [assignmentRow()];
      if (sql.includes('official-input-unit:candidate')) return [candidateRow()];
      if (sql.includes('official-input-unit:current')) return [];
      if (sql.includes('official-input-unit:duplicate')) return [];
      throw new Error('Unexpected query: ' + sql);
    });
    const { client, execute } = sqlClient(query);
    const repository = createPrismaOfficialInputUnitContractRepository({
      client: client as never,
      id: () => 'unit-contract-1',
    });

    const result = await repository.verifyContract(verifyInput()) as { contract: { sourceRevision: string; sourceChecksum: string } };

    expect(result).toMatchObject({
      duplicate: false,
      contract: {
        id: 'unit-contract-1',
        status: 'VERIFIED',
        sourceCandidateId: 'official-candidate-1',
        sourceCandidateChecksum: 'a'.repeat(64),
        reviewerId: 'super-admin-1',
        verifiedAt: NOW,
        validUntil: VALID_UNTIL,
      },
    });
    expect(result.contract.sourceRevision).toMatch(/^official-input-units\/v1:[a-f0-9]{64}$/);
    expect(result.contract.sourceChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(String(execute.mock.calls[0]?.[0])).toContain(
      'INSERT INTO "logistics_official_input_unit_contracts"',
    );
    expect(String(execute.mock.calls[1]?.[0])).toContain(
      'INSERT INTO "logistics_rule_events"',
    );
  });

  it('serializes the current-contract lock before the duplicate lookup', async () => {
    let currentLockCompleted = false;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('official-input-unit:assignment')) return [assignmentRow()];
      if (sql.includes('official-input-unit:candidate')) return [candidateRow()];
      if (sql.includes('official-input-unit:current')) {
        await Promise.resolve();
        currentLockCompleted = true;
        return [];
      }
      if (sql.includes('official-input-unit:duplicate')) {
        expect(currentLockCompleted).toBe(true);
        return [];
      }
      throw new Error('Unexpected query: ' + sql);
    });
    const { client } = sqlClient(query);
    const repository = createPrismaOfficialInputUnitContractRepository({
      client: client as never,
      id: () => 'unit-contract-serialized',
    });

    await repository.verifyContract(verifyInput());
  });

  it('rejects a stale expected-current contract before inserting a replacement', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('official-input-unit:assignment')) return [assignmentRow()];
      if (sql.includes('official-input-unit:candidate')) return [candidateRow()];
      if (sql.includes('official-input-unit:current')) return [{ id: 'unit-contract-current' }];
      if (sql.includes('official-input-unit:duplicate')) return [];
      throw new Error('Unexpected query: ' + sql);
    });
    const { client, execute } = sqlClient(query);
    const repository = createPrismaOfficialInputUnitContractRepository({
      client: client as never,
      id: () => 'unit-contract-2',
    });

    await expect(repository.verifyContract(verifyInput())).rejects.toMatchObject({
      code: 'INPUT_UNIT_CONTRACT_STALE',
      statusCode: 409,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects duplicate verification when the terminal contract is revoked', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('official-input-unit:assignment')) return [assignmentRow()];
      if (sql.includes('official-input-unit:candidate')) return [candidateRow()];
      if (sql.includes('official-input-unit:current')) {
        return [{ id: 'unit-contract-revoked', revokedAt: NOW }];
      }
      if (sql.includes('official-input-unit:duplicate')) {
        return [{ id: 'unit-contract-revoked' }];
      }
      throw new Error('Unexpected query: ' + sql);
    });
    const { client, execute } = sqlClient(query);
    const repository = createPrismaOfficialInputUnitContractRepository({
      client: client as never,
      id: () => 'unit-contract-should-not-exist',
    });

    await expect(repository.verifyContract(verifyInput())).rejects.toMatchObject({
      code: 'INPUT_UNIT_CONTRACT_ALREADY_REVOKED',
      statusCode: 409,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns only the active terminal contract while retaining derived history states', async () => {
    const expired = {
      id: 'unit-contract-old',
      ...assignmentRow(),
      currency: 'CNY',
      weightUnit: 'g',
      dimensionUnit: 'mm',
      priceInputUnit: 'CNY_MAJOR',
      weightIncrementG: decimal('0.1'),
      dimensionIncrementMm: decimal('0.25'),
      currencyMinorIncrement: 1,
      sourceCandidateId: 'official-old',
      sourceCandidateChecksum: 'b'.repeat(64),
      sourceRevision: 'official-input-units/v1:' + 'b'.repeat(64),
      sourceChecksum: 'b'.repeat(64),
      reviewerId: 'admin-old',
      reviewNote: 'old',
      verifiedAt: new Date('2026-07-01T00:00:00.000Z'),
      validUntil: new Date('2026-07-08T00:00:00.000Z'),
      supersedesId: null,
      supersededById: 'unit-contract-current',
      revokedAt: null,
      revokedById: null,
      revocationReason: null,
    };
    const current = {
      ...expired,
      id: 'unit-contract-current',
      sourceCandidateId: 'official-candidate-1',
      sourceCandidateChecksum: 'a'.repeat(64),
      sourceRevision: 'official-input-units/v1:' + 'a'.repeat(64),
      sourceChecksum: 'a'.repeat(64),
      verifiedAt: NOW,
      validUntil: VALID_UNTIL,
      supersedesId: expired.id,
      supersededById: null,
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('official-input-unit:assignment')) return [assignmentRow()];
      if (sql.includes('official-input-unit:history')) return [current, expired];
      if (sql.includes('official-input-unit:candidates')) return [candidateRow()];
      throw new Error('Unexpected query: ' + sql);
    });
    const { client } = sqlClient(query);
    const repository = createPrismaOfficialInputUnitContractRepository({
      client: client as never,
    });

    const context = await repository.readContext({
      assignmentId: 'assignment-1',
      at: new Date('2026-07-19T12:00:00.000Z'),
      sourceMaxAgeMs: 24 * 60 * 60 * 1000,
    });

    expect(context.current).toMatchObject({
      id: 'unit-contract-current',
      state: 'EXPIRING',
      weightIncrementG: 0.1,
      dimensionIncrementMm: 0.25,
      currencyMinorIncrement: 1,
    });
    expect(context.history).toEqual([
      expect.objectContaining({
        id: 'unit-contract-current', state: 'EXPIRING', weightIncrementG: 0.1,
      }),
      expect.objectContaining({
        id: 'unit-contract-old', state: 'SUPERSEDED', dimensionIncrementMm: 0.25,
      }),
    ]);
    expect(context.candidates).toEqual([
      expect.objectContaining({ id: 'official-candidate-1', quoteCount: 63 }),
    ]);
  });

  it('revokes the current contract and writes an invalidation event in one transaction', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('official-input-unit:revoke-current')) {
        return [{
          id: 'unit-contract-1',
          channelId: 'channel-1',
          tenantId: 'tenant-1',
          revokedAt: null,
          revokedById: null,
          revocationReason: null,
        }];
      }
      throw new Error('Unexpected query: ' + sql);
    });
    const { client, execute } = sqlClient(query);
    const repository = createPrismaOfficialInputUnitContractRepository({
      client: client as never,
    });

    const result = await repository.revokeContract({
      actorUserId: 'super-admin-1',
      contractId: 'unit-contract-1',
      reason: 'Incorrect unit evidence',
      expectedCurrentContractId: 'unit-contract-1',
      revokedAt: NOW,
    });

    expect(result).toMatchObject({ duplicate: false, contractId: 'unit-contract-1' });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(String(execute.mock.calls[0]?.[0])).toContain('UPDATE "logistics_official_input_unit_contracts"');
    expect(String(execute.mock.calls[1]?.[0])).toContain("'INVALIDATED'");
  });
});
