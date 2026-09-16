import { describe, expect, it, vi } from 'vitest';
import {
  enforceAiImageSuiteCostControlsInTransaction,
  resolveAiImageSuiteCostControls,
} from '../services/ai-image-suite-cost-controls.js';

function database(input: {
  activeUnits?: number;
  billedUnits?: number;
  settledCostCents?: number;
  pendingMaximumCostCents?: number;
} = {}) {
  return {
    $queryRawUnsafe: vi.fn(async () => [{ locked: 1 }]),
    aiImageJob: {
      aggregate: vi.fn(async ({ _sum }: any) => (
        'requestedImageCount' in _sum
          ? { _sum: { requestedImageCount: input.activeUnits || 0 } }
          : { _sum: { billedUnits: input.billedUnits || 0 } }
      )),
    },
    aiCostSettlement: {
      aggregate: vi.fn(async () => ({
        _sum: { actualCostMinor: input.settledCostCents || 0 },
      })),
    },
    aiCostReservation: {
      aggregate: vi.fn(async () => ({
        _sum: { maximumCostMinor: input.pendingMaximumCostCents || 0 },
      })),
    },
  };
}

describe('AI image suite paid cost controls', () => {
  it('counts only the frozen CNY currency for both new reservations and dispatch exposure', async () => {
    for (const requestedMaximumCostCents of [14, 0]) {
      const tx = database();
      await expect(enforceAiImageSuiteCostControlsInTransaction(tx, {
        ownerUserId: 'owner-1', controls: { dailyLimit: 4, globalDailyBudgetCents: 100 },
        requestedUnits: 1, requestedMaximumCostCents, currency: 'CNY',
      } as any)).resolves.toBeNull();
      expect(tx.aiCostSettlement.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ reservation: { currency: 'CNY' } }) }));
      expect(tx.aiCostReservation.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ currency: 'CNY' }) }));
    }
  });

  it('admits one new retry only when active+billed units and maximum exposure both fit', async () => {
    const tx = database({
      activeUnits: 2,
      billedUnits: 1,
      settledCostCents: 20,
      pendingMaximumCostCents: 30,
    });

    await expect(enforceAiImageSuiteCostControlsInTransaction(tx, {
      ownerUserId: 'owner-1',
      controls: { dailyLimit: 4, globalDailyBudgetCents: 61 },
      requestedUnits: 1,
      requestedMaximumCostCents: 11,
    })).resolves.toBeNull();

    expect(tx.$queryRawUnsafe).toHaveBeenCalledOnce();
    expect(tx.aiImageJob.aggregate).toHaveBeenCalledTimes(2);
    expect(tx.aiCostSettlement.aggregate).toHaveBeenCalledOnce();
    expect(tx.aiCostReservation.aggregate).toHaveBeenCalledOnce();
  });

  it('rejects a retry whose new unit exceeds the per-user daily active+billed limit', async () => {
    const tx = database({ activeUnits: 3, billedUnits: 2 });

    await expect(enforceAiImageSuiteCostControlsInTransaction(tx, {
      ownerUserId: 'owner-1',
      controls: { dailyLimit: 5, globalDailyBudgetCents: 100 },
      requestedUnits: 1,
      requestedMaximumCostCents: 10,
    })).resolves.toEqual({
      kind: 'quota-exceeded',
      used: 5,
      requested: 1,
      limit: 5,
    });

    expect(tx.aiCostSettlement.aggregate).not.toHaveBeenCalled();
    expect(tx.aiCostReservation.aggregate).not.toHaveBeenCalled();
  });

  it('rejects a new reservation whose maximum cost would exceed the global budget', async () => {
    const tx = database({
      settledCostCents: 20,
      pendingMaximumCostCents: 30,
    });

    await expect(enforceAiImageSuiteCostControlsInTransaction(tx, {
      ownerUserId: 'owner-1',
      controls: { dailyLimit: 5, globalDailyBudgetCents: 60 },
      requestedUnits: 1,
      requestedMaximumCostCents: 11,
    })).resolves.toEqual({
      kind: 'budget-exceeded',
      settledCostCents: 20,
      pendingMaximumCostCents: 30,
      requestedMaximumCostCents: 11,
      limit: 60,
    });
  });

  it('revalidates dispatch exposure without double-counting already-held reservations', async () => {
    const tx = database({
      activeUnits: 2,
      billedUnits: 1,
      settledCostCents: 20,
      pendingMaximumCostCents: 40,
    });

    await expect(enforceAiImageSuiteCostControlsInTransaction(tx, {
      ownerUserId: 'owner-1',
      controls: { dailyLimit: 3, globalDailyBudgetCents: 60 },
      requestedUnits: 0,
      requestedMaximumCostCents: 0,
    })).resolves.toBeNull();

    const lowered = database({
      activeUnits: 2,
      billedUnits: 1,
      settledCostCents: 20,
      pendingMaximumCostCents: 40,
    });
    await expect(enforceAiImageSuiteCostControlsInTransaction(lowered, {
      ownerUserId: 'owner-1',
      controls: { dailyLimit: 3, globalDailyBudgetCents: 59 },
      requestedUnits: 0,
      requestedMaximumCostCents: 0,
    })).resolves.toMatchObject({
      kind: 'budget-exceeded',
      requestedMaximumCostCents: 0,
      limit: 59,
    });
  });

  it('fails closed when paid cost-control configuration is missing or invalid', async () => {
    await expect(resolveAiImageSuiteCostControls(undefined, 'owner-1')).resolves.toMatchObject({
      kind: 'cost-controls-unavailable',
    });
    await expect(resolveAiImageSuiteCostControls(async () => ({
      dailyLimit: -1,
      globalDailyBudgetCents: 1,
    }), 'owner-1')).resolves.toMatchObject({
      kind: 'cost-controls-unavailable',
    });
  });
});
