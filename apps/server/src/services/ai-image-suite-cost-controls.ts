import {
  AI_GLOBAL_COST_BUDGET_MAX_MINOR,
  AiGlobalCostBudgetError,
  assertGlobalAiCostBudgetInTransaction,
  lockGlobalAiCostBudgetInTransaction,
  reserveGlobalAiCostBudgetInTransaction,
} from './ai-cost-budget.js';
import {
  AI_IMAGE_BILLED_JOB_STATUSES,
  aiImageReservedQuotaWhere,
} from './ai-image-quota.js';

export const AI_IMAGE_SUITE_DAILY_LIMIT_MAX = 100_000;

export interface AiImageSuiteCostControls {
  dailyLimit: number;
  globalDailyBudgetCents: number;
}

export type AiImageSuiteCostControlResolver = (
  ownerUserId: string,
) => Promise<AiImageSuiteCostControls>;

export type AiImageSuiteCostControlFailure =
  | {
    kind: 'quota-exceeded';
    used: number;
    requested: number;
    limit: number;
  }
  | {
    kind: 'budget-exceeded';
    settledCostCents: number;
    pendingMaximumCostCents: number;
    requestedMaximumCostCents: number;
    limit: number;
  }
  | { kind: 'cost-controls-unavailable'; reason: string };

type CostControlDatabase = {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
  aiImageJob: {
    aggregate(input: Record<string, unknown>): Promise<{
      _sum?: { requestedImageCount?: unknown; billedUnits?: unknown };
    }>;
  };
  aiCostSettlement: {
    aggregate(input: Record<string, unknown>): Promise<{ _sum?: { actualCostMinor?: unknown } }>;
  };
  aiCostReservation: {
    aggregate(input: Record<string, unknown>): Promise<{ _sum?: { maximumCostMinor?: unknown } }>;
  };
};

function unavailable(reason: string): AiImageSuiteCostControlFailure {
  return { kind: 'cost-controls-unavailable', reason };
}

export async function resolveAiImageSuiteCostControls(
  resolver: AiImageSuiteCostControlResolver | undefined,
  ownerUserId: string,
): Promise<AiImageSuiteCostControls | AiImageSuiteCostControlFailure> {
  if (!resolver) {
    return unavailable('Paid AI image suite cost controls are not configured');
  }
  try {
    const controls = await resolver(ownerUserId);
    if (!Number.isSafeInteger(controls?.dailyLimit)
      || controls.dailyLimit < 0
      || controls.dailyLimit > AI_IMAGE_SUITE_DAILY_LIMIT_MAX
      || !Number.isSafeInteger(controls?.globalDailyBudgetCents)
      || controls.globalDailyBudgetCents < 0
      || controls.globalDailyBudgetCents > AI_GLOBAL_COST_BUDGET_MAX_MINOR) {
      return unavailable('Paid AI image suite cost controls are invalid');
    }
    return controls;
  } catch {
    return unavailable('Paid AI image suite cost controls could not be loaded');
  }
}

function validControls(
  value: AiImageSuiteCostControls | AiImageSuiteCostControlFailure,
): value is AiImageSuiteCostControls {
  return !('kind' in value);
}

export function isAiImageSuiteCostControls(
  value: AiImageSuiteCostControls | AiImageSuiteCostControlFailure,
): value is AiImageSuiteCostControls {
  return validControls(value);
}

function aggregated(value: unknown): number | null {
  const normalized = Number(value || 0);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : null;
}

export async function enforceAiImageSuiteCostControlsInTransaction(
  database: CostControlDatabase,
  input: {
    ownerUserId: string;
    controls: AiImageSuiteCostControls;
    requestedUnits: number;
    requestedMaximumCostCents: number;
    currency?: 'USD' | 'CNY';
  },
): Promise<AiImageSuiteCostControlFailure | null> {
  if (!Number.isSafeInteger(input.requestedUnits)
    || input.requestedUnits < 0
    || input.requestedUnits > AI_IMAGE_SUITE_DAILY_LIMIT_MAX
    || !Number.isSafeInteger(input.requestedMaximumCostCents)
    || input.requestedMaximumCostCents < 0
    || input.requestedMaximumCostCents > AI_GLOBAL_COST_BUDGET_MAX_MINOR) {
    return unavailable('Paid AI image suite cost request is invalid');
  }

  await lockGlobalAiCostBudgetInTransaction(database);
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [active, billed] = await Promise.all([
    database.aiImageJob.aggregate({
      where: {
        ownerUserId: input.ownerUserId,
        createdAt: { gte: dayStart },
        ...aiImageReservedQuotaWhere(),
      },
      _sum: { requestedImageCount: true },
    }),
    database.aiImageJob.aggregate({
      where: {
        ownerUserId: input.ownerUserId,
        createdAt: { gte: dayStart },
        status: { in: [...AI_IMAGE_BILLED_JOB_STATUSES] },
        billedUnits: { gt: 0 },
      },
      _sum: { billedUnits: true },
    }),
  ]);
  const activeUnits = aggregated(active._sum?.requestedImageCount);
  const billedUnits = aggregated(billed._sum?.billedUnits);
  if (activeUnits == null || billedUnits == null) {
    return unavailable('Paid AI image suite daily quota exposure is invalid');
  }
  const used = activeUnits + billedUnits;
  if (!Number.isSafeInteger(used)) {
    return unavailable('Paid AI image suite daily quota exposure is invalid');
  }
  if (input.controls.dailyLimit > 0
    && used + input.requestedUnits > input.controls.dailyLimit) {
    return {
      kind: 'quota-exceeded',
      used,
      requested: input.requestedUnits,
      limit: input.controls.dailyLimit,
    };
  }

  try {
    const exposure = input.requestedMaximumCostCents > 0
      ? await reserveGlobalAiCostBudgetInTransaction(database, {
        limit: input.controls.globalDailyBudgetCents,
        currency: input.currency,
        requestedMaximumCostMinor: input.requestedMaximumCostCents,
      }, { alreadyLocked: true })
      : await assertGlobalAiCostBudgetInTransaction(database, {
        limit: input.controls.globalDailyBudgetCents,
        currency: input.currency,
      }, { alreadyLocked: true });
    void exposure;
    return null;
  } catch (error) {
    if (error instanceof AiGlobalCostBudgetError && error.code === 'BUDGET_EXCEEDED') {
      const summary = error.summary!;
      return {
        kind: 'budget-exceeded',
        settledCostCents: summary.settledCostMinor,
        pendingMaximumCostCents: summary.pendingMaximumCostMinor,
        requestedMaximumCostCents: summary.requestedMaximumCostMinor,
        limit: summary.limit,
      };
    }
    if (error instanceof AiGlobalCostBudgetError) return unavailable(error.message);
    throw error;
  }
}
