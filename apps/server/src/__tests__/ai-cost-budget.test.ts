import { describe, expect, it, vi } from 'vitest';
import {
  AiGlobalCostBudgetError,
  reserveGlobalAiCostBudgetInTransaction,
} from '../services/ai-cost-budget.js';

function database(input: { settled?: number; pending?: number } = {}) {
  return {
    $queryRawUnsafe: vi.fn(async () => [{ locked: 1 }]),
    aiCostSettlement: {
      aggregate: vi.fn(async () => ({ _sum: { actualCostMinor: input.settled || 0 } })),
    },
    aiCostReservation: {
      aggregate: vi.fn(async () => ({ _sum: { maximumCostMinor: input.pending || 0 } })),
    },
  };
}

describe('global AI cost budget', () => {
  it('serializes and returns the UTC-day settled plus all unresolved exposure', async () => {
    const db = database({ settled: 20, pending: 30 });
    await expect(reserveGlobalAiCostBudgetInTransaction(db, {
      limit: 100,
      requestedMaximumCostMinor: 40,
    })).resolves.toEqual({
      settledCostMinor: 20,
      pendingMaximumCostMinor: 30,
      requestedMaximumCostMinor: 40,
      totalExposureMinor: 90,
      limit: 100,
    });
    expect(db.$queryRawUnsafe).toHaveBeenCalledOnce();
    expect(db.aiCostSettlement.aggregate).toHaveBeenCalledWith({
      where: {
        kind: { in: ['CHARGE', 'RECONCILED_CHARGE'] },
        createdAt: { gte: expect.any(Date) },
        actualCostMinor: { not: null },
      },
      _sum: { actualCostMinor: true },
    });
    const settledCalls = db.aiCostSettlement.aggregate.mock.calls as unknown as Array<[
      { where: { createdAt: { gte: Date } } },
    ]>;
    const start = settledCalls[0]![0].where.createdAt.gte;
    expect(start.toISOString()).toMatch(/T00:00:00\.000Z$/u);
    expect(db.aiCostReservation.aggregate).toHaveBeenCalledWith({
      where: { status: { in: ['RESERVED', 'SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED'] } },
      _sum: { maximumCostMinor: true },
    });
  });

  it.each([
    [0, 1],
    [100, 101],
  ])('fails closed for limit %s and exposure %s', async (limit, requestedMaximumCostMinor) => {
    const error = await reserveGlobalAiCostBudgetInTransaction(database(), {
      limit,
      requestedMaximumCostMinor,
    }).catch((caught) => caught) as AiGlobalCostBudgetError;
    expect(error).toBeInstanceOf(AiGlobalCostBudgetError);
    expect(error.code).toBe('BUDGET_EXCEEDED');
    expect(error.summary).toEqual(expect.objectContaining({
      limit,
      requestedMaximumCostMinor,
    }));
  });

  it.each([
    { limit: -1, requestedMaximumCostMinor: 1 },
    { limit: 1.5, requestedMaximumCostMinor: 1 },
    { limit: 100, requestedMaximumCostMinor: 0 },
    { limit: 100, requestedMaximumCostMinor: Number.MAX_SAFE_INTEGER },
  ])('rejects an invalid budget request before querying exposure: %j', async (input) => {
    const db = database();
    await expect(reserveGlobalAiCostBudgetInTransaction(db, input))
      .rejects.toMatchObject({ code: 'INVALID_BUDGET' });
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
