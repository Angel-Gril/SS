import { describe, expect, it, vi } from 'vitest';
import { createOfficialInputUnitContractService } from '../services/logistics-official-input-unit-contract.js';

describe('Official input-unit contract service', () => {
  it('derives reviewer and seven-day validity from the authenticated server clock', async () => {
    const verifiedAt = new Date('2026-07-13T08:00:00.000Z');
    const verifyContract = vi.fn(async (input: unknown) => ({
      duplicate: false,
      contract: { id: 'unit-contract-1', ...(input as object) },
    }));
    const service = createOfficialInputUnitContractService({
      repository: {
        readContext: vi.fn(),
        verifyContract,
        revokeContract: vi.fn(),
      },
      now: () => verifiedAt,
    });

    await service.verify({
      actorUserId: 'super-admin-1',
      assignmentId: 'assignment-1',
      candidateId: 'official-candidate-1',
      expectedCandidateChecksum: 'a'.repeat(64),
      weightIncrementG: 1,
      dimensionIncrementMm: 1,
      currencyMinorIncrement: 1,
      unitAttestation: {
        currency: 'CNY',
        weightUnit: 'g',
        dimensionUnit: 'mm',
        priceInputUnit: 'CNY_MAJOR',
      },
      reviewNote: 'Checked against the Official calculator UI',
      expectedCurrentContractId: null,
    });

    expect(verifyContract).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'super-admin-1',
      verifiedAt,
      validUntil: new Date('2026-07-20T08:00:00.000Z'),
      sourceMaxAgeMs: 24 * 60 * 60 * 1000,
    }));
  });
  it('adds the server policy to the assignment review context', async () => {
    const now = new Date('2026-07-13T08:00:00.000Z');
    const readContext = vi.fn(async () => ({
      assignment: { id: 'assignment-1' },
      current: null,
      history: [],
      candidates: [],
    }));
    const service = createOfficialInputUnitContractService({
      repository: {
        readContext,
        verifyContract: vi.fn(),
        revokeContract: vi.fn(),
      },
      now: () => now,
    });

    await expect(service.readContext({ assignmentId: 'assignment-1' })).resolves.toEqual({
      assignment: { id: 'assignment-1' },
      current: null,
      history: [],
      candidates: [],
      policy: {
        defaultValidityDays: 7,
        sourceMaxAgeHours: 24,
      },
    });
    expect(readContext).toHaveBeenCalledWith({
      assignmentId: 'assignment-1',
      at: now,
      sourceMaxAgeMs: 24 * 60 * 60 * 1000,
    });
  });

  it('accepts positive finite decimal measurement increments while keeping minor currency integral', async () => {
    const verifyContract = vi.fn(async (input: unknown) => input);
    const service = createOfficialInputUnitContractService({
      repository: {
        readContext: vi.fn(),
        verifyContract,
        revokeContract: vi.fn(),
      },
      now: () => new Date('2026-07-13T08:00:00.000Z'),
    });
    const input = {
      actorUserId: 'super-admin-1',
      assignmentId: 'assignment-1',
      candidateId: 'official-candidate-1',
      expectedCandidateChecksum: 'a'.repeat(64),
      weightIncrementG: 0.1,
      dimensionIncrementMm: 0.25,
      currencyMinorIncrement: 1,
      unitAttestation: {
        currency: 'CNY' as const,
        weightUnit: 'g' as const,
        dimensionUnit: 'mm' as const,
        priceInputUnit: 'CNY_MAJOR' as const,
      },
      reviewNote: 'Official decimal steps checked',
      expectedCurrentContractId: null,
    };

    await expect(service.verify(input)).resolves.toMatchObject({
      weightIncrementG: 0.1,
      dimensionIncrementMm: 0.25,
      currencyMinorIncrement: 1,
    });
    await expect(service.verify({
      ...input,
      currencyMinorIncrement: 0.5,
    })).rejects.toMatchObject({ code: 'INVALID_INPUT_UNIT_CONTRACT', statusCode: 400 });
    expect(verifyContract).toHaveBeenCalledTimes(1);
  });

  it('rejects an unreviewed unit assertion or non-positive increment', async () => {
    const verifyContract = vi.fn();
    const service = createOfficialInputUnitContractService({
      repository: {
        readContext: vi.fn(),
        verifyContract,
        revokeContract: vi.fn(),
      },
    });
    const valid = {
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
    };

    await expect(service.verify({
      ...valid,
      weightIncrementG: 0,
    })).rejects.toMatchObject({ code: 'INVALID_INPUT_UNIT_CONTRACT', statusCode: 400 });
    await expect(service.verify({
      ...valid,
      weightIncrementG: Number.POSITIVE_INFINITY,
    })).rejects.toMatchObject({ code: 'INVALID_INPUT_UNIT_CONTRACT', statusCode: 400 });
    await expect(service.verify({
      ...valid,
      dimensionIncrementMm: Number.NaN,
    })).rejects.toMatchObject({ code: 'INVALID_INPUT_UNIT_CONTRACT', statusCode: 400 });
    await expect(service.verify({
      ...valid,
      unitAttestation: { ...valid.unitAttestation, priceInputUnit: 'CNY_MINOR' as never },
    })).rejects.toMatchObject({ code: 'INVALID_INPUT_UNIT_CONTRACT', statusCode: 400 });
    expect(verifyContract).not.toHaveBeenCalled();
  });

  it('derives the revocation actor and timestamp on the server', async () => {
    const revokedAt = new Date('2026-07-13T09:00:00.000Z');
    const revokeContract = vi.fn(async (input: unknown) => input);
    const service = createOfficialInputUnitContractService({
      repository: {
        readContext: vi.fn(),
        verifyContract: vi.fn(),
        revokeContract,
      },
      now: () => revokedAt,
    });

    await service.revoke({
      actorUserId: 'super-admin-1',
      contractId: 'unit-contract-1',
      reason: 'Incorrect page-unit observation',
      expectedCurrentContractId: 'unit-contract-1',
    });
    expect(revokeContract).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'super-admin-1',
      revokedAt,
    }));
  });
});
