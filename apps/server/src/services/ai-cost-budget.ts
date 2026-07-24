export const AI_GLOBAL_COST_BUDGET_LOCK_KEY = 'ai-global-cost-budget/v1';
export const AI_GLOBAL_COST_BUDGET_MAX_MINOR = 10_000_000;

const PENDING_RESERVATION_STATUSES = [
  'RESERVED',
  'SUBMISSION_UNCERTAIN',
  'RECONCILIATION_REQUIRED',
] as const;
const CHARGE_SETTLEMENT_KINDS = ['CHARGE', 'RECONCILED_CHARGE'] as const;

export interface AiGlobalCostBudgetSummary {
  settledCostMinor: number;
  pendingMaximumCostMinor: number;
  requestedMaximumCostMinor: number;
  totalExposureMinor: number;
  limit: number;
}

export class AiGlobalCostBudgetError extends Error {
  constructor(
    public readonly code: 'INVALID_BUDGET' | 'BUDGET_EXCEEDED',
    message: string,
    public readonly summary?: AiGlobalCostBudgetSummary,
  ) {
    super(message);
    this.name = 'AiGlobalCostBudgetError';
  }
}

function configuredLimit(value: unknown): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized)
    || normalized < 0
    || normalized > AI_GLOBAL_COST_BUDGET_MAX_MINOR) {
    throw new AiGlobalCostBudgetError(
      'INVALID_BUDGET',
      'Global daily AI budget must be a bounded non-negative integer',
    );
  }
  return normalized;
}

function requestedCost(value: unknown): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized)
    || normalized < 1
    || normalized > AI_GLOBAL_COST_BUDGET_MAX_MINOR) {
    throw new AiGlobalCostBudgetError(
      'INVALID_BUDGET',
      'Requested AI maximum cost must be a bounded positive integer',
    );
  }
  return normalized;
}

async function summarizeGlobalAiCostBudgetInTransaction(
  database: {
    aiCostSettlement: {
      aggregate(input: Record<string, unknown>): Promise<{ _sum?: { actualCostMinor?: unknown } }>;
    };
    aiCostReservation: {
      aggregate(input: Record<string, unknown>): Promise<{ _sum?: { maximumCostMinor?: unknown } }>;
    };
  },
  input: { limit: number; requestedMaximumCostMinor: number },
): Promise<AiGlobalCostBudgetSummary> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [settled, pending] = await Promise.all([
    database.aiCostSettlement.aggregate({
      where: {
        kind: { in: [...CHARGE_SETTLEMENT_KINDS] },
        createdAt: { gte: dayStart },
        actualCostMinor: { not: null },
      },
      _sum: { actualCostMinor: true },
    }),
    database.aiCostReservation.aggregate({
      where: { status: { in: [...PENDING_RESERVATION_STATUSES] } },
      _sum: { maximumCostMinor: true },
    }),
  ]);
  const settledCostMinor = aggregatedCost(
    settled._sum?.actualCostMinor,
    'Settled AI cost exposure',
  );
  const pendingMaximumCostMinor = aggregatedCost(
    pending._sum?.maximumCostMinor,
    'Pending AI maximum cost exposure',
  );
  const totalExposureMinor = settledCostMinor
    + pendingMaximumCostMinor
    + input.requestedMaximumCostMinor;
  const summary = {
    settledCostMinor,
    pendingMaximumCostMinor,
    requestedMaximumCostMinor: input.requestedMaximumCostMinor,
    totalExposureMinor,
    limit: input.limit,
  };
  if (!Number.isSafeInteger(totalExposureMinor) || totalExposureMinor > input.limit) {
    throw new AiGlobalCostBudgetError(
      'BUDGET_EXCEEDED',
      `Global daily AI budget exceeded (${totalExposureMinor}/${input.limit})`,
      summary,
    );
  }
  return summary;
}

export async function assertGlobalAiCostBudgetInTransaction(
  database: {
    $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
    aiCostSettlement: {
      aggregate(input: Record<string, unknown>): Promise<{ _sum?: { actualCostMinor?: unknown } }>;
    };
    aiCostReservation: {
      aggregate(input: Record<string, unknown>): Promise<{ _sum?: { maximumCostMinor?: unknown } }>;
    };
  },
  input: { limit: number },
  options: { alreadyLocked?: boolean } = {},
): Promise<AiGlobalCostBudgetSummary> {
  const limit = configuredLimit(input.limit);
  if (!options.alreadyLocked) await lockGlobalAiCostBudgetInTransaction(database);
  return summarizeGlobalAiCostBudgetInTransaction(database, {
    limit,
    requestedMaximumCostMinor: 0,
  });
}

function aggregatedCost(value: unknown, label: string): number {
  const normalized = Number(value || 0);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new AiGlobalCostBudgetError('INVALID_BUDGET', `${label} is invalid`);
  }
  return normalized;
}

export async function lockGlobalAiCostBudgetInTransaction(database: {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
}): Promise<void> {
  await database.$queryRawUnsafe(
    'SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended($1, 7390421))',
    AI_GLOBAL_COST_BUDGET_LOCK_KEY,
  );
}

export async function reserveGlobalAiCostBudgetInTransaction(
  database: {
    $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
    aiCostSettlement: {
      aggregate(input: Record<string, unknown>): Promise<{ _sum?: { actualCostMinor?: unknown } }>;
    };
    aiCostReservation: {
      aggregate(input: Record<string, unknown>): Promise<{ _sum?: { maximumCostMinor?: unknown } }>;
    };
  },
  input: { limit: number; requestedMaximumCostMinor: number },
  options: { alreadyLocked?: boolean } = {},
): Promise<AiGlobalCostBudgetSummary> {
  const limit = configuredLimit(input.limit);
  const requestedMaximumCostMinor = requestedCost(input.requestedMaximumCostMinor);
  if (!options.alreadyLocked) await lockGlobalAiCostBudgetInTransaction(database);
  return summarizeGlobalAiCostBudgetInTransaction(database, {
    limit,
    requestedMaximumCostMinor,
  });
}
