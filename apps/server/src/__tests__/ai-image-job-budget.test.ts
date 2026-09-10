import { describe, expect, it, vi } from 'vitest';
import { SystemConfigSchema } from '../config/system-config-schema.js';
import { createAiImageJob, type CreateAiImageJobInput } from '../services/ai-image-jobs.js';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';

const paidInput = (overrides: Partial<CreateAiImageJobInput> = {}): CreateAiImageJobInput => ({
  ownerUserId: 'owner-1',
  actorUserId: 'owner-1',
  idempotencyKey: 'request-1',
  prompt: 'Ozon-ready product photo',
  requestFingerprint: 'a'.repeat(64),
  provider: 'openai-images',
  model: 'gpt-image-1',
  count: 1,
  width: 1024,
  height: 1024,
  estimatedCostCents: 20,
  ...overrides,
});

function persistedJob(input: CreateAiImageJobInput, overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    ...input,
    status: 'QUEUED',
    operation: 'TEXT_TO_IMAGE',
    requestedImageCount: input.count,
    negativePrompt: input.negativePrompt || null,
    attemptCount: 0,
    maxAttempts: 3,
    actualCostCents: null,
    billedUnits: 0,
    providerJobId: null,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

function budgetHarness(options: {
  settledCostCents?: number;
  pendingMaximumCostCents?: number;
  existing?: Record<string, unknown> | null;
} = {}) {
  const events: string[] = [];
  const input = paidInput();
  const created = persistedJob(input);
  const costReservation = {
    id: 'reservation-1',
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    jobId: created.id,
    idempotencyKey: `${created.id}:cost:reserve`,
    requestFingerprint: input.requestFingerprint,
    provider: input.provider,
    model: input.model,
    operation: 'TEXT_TO_IMAGE',
    currency: 'USD',
    roundingMode: 'HALF_UP',
    estimatedCostMinor: input.estimatedCostCents,
    maximumCostMinor: input.estimatedCostCents,
    status: 'RESERVED',
  };
  const findJob = vi.fn(async () => {
    events.push('find-job');
    return options.existing ?? null;
  });
  const quotaAggregate = vi.fn()
    .mockResolvedValueOnce({ _sum: { requestedImageCount: 0 } })
    .mockResolvedValueOnce({ _sum: { billedUnits: 0 } });
  const createJob = vi.fn(async () => {
    events.push('create-job');
    return created;
  });
  const settledAggregate = vi.fn(async (_query: unknown) => ({
    _sum: { actualCostMinor: options.settledCostCents || 0 },
  }));
  const pendingAggregate = vi.fn(async (_query: unknown) => ({
    _sum: { maximumCostMinor: options.pendingMaximumCostCents || 0 },
  }));
  const findReservation = vi.fn(async () => null);
  const createReservation = vi.fn(async () => {
    events.push('create-reservation');
    return costReservation;
  });
  const tx = {
    $queryRawUnsafe: vi.fn(async () => {
      events.push('budget-lock');
      return [{ locked: 1 }];
    }),
    aiImageJob: { findUnique: findJob, aggregate: quotaAggregate, create: createJob },
    aiCostSettlement: { aggregate: settledAggregate },
    aiCostReservation: {
      aggregate: pendingAggregate,
      findUnique: findReservation,
      create: createReservation,
    },
  };
  const client = {
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    aiImageJob: { findUnique: findJob },
  };
  return {
    input,
    repository: new PrismaAiImageJobRepository(client as never),
    client,
    tx,
    events,
    createJob,
    createReservation,
    settledAggregate,
    pendingAggregate,
    quotaAggregate,
    costReservation,
  };
}

describe('AI image generation cost safety', () => {
  it('defines a bounded per-image generation cost that is disabled by default', () => {
    expect(SystemConfigSchema.ai_image_generation_cost_cents.parse(undefined)).toBe(0);
    expect(SystemConfigSchema.ai_image_generation_cost_cents.parse(25)).toBe(25);
    expect(() => SystemConfigSchema.ai_image_generation_cost_cents.parse(-1)).toThrow();
    expect(() => SystemConfigSchema.ai_image_generation_cost_cents.parse(100_001)).toThrow();
  });

  it('rejects a paid provider without a positive frozen task cost before persistence', async () => {
    const createWithQuota = vi.fn();

    await expect(createAiImageJob(
      paidInput({ estimatedCostCents: 0 }),
      { createWithQuota },
      5,
      100,
    )).rejects.toMatchObject({ code: 'PROVIDER_NOT_READY' });
    expect(createWithQuota).not.toHaveBeenCalled();
  });

  it('maps an atomic global budget rejection to an AI image job error', async () => {
    const createWithQuota = vi.fn(async () => ({
      kind: 'budget-exceeded' as const,
      settledCostCents: 30,
      pendingMaximumCostCents: 60,
      requestedMaximumCostCents: 20,
      limit: 100,
    }));

    await expect(createAiImageJob(
      paidInput(),
      { createWithQuota },
      5,
      100,
    )).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    expect(createWithQuota).toHaveBeenCalledWith(paidInput(), 5, 100);
  });

  it('fails closed when a new paid task has a zero global daily budget', async () => {
    const state = budgetHarness();

    await expect(state.repository.createWithQuota(state.input, 5, 0)).resolves.toEqual({
      kind: 'budget-exceeded',
      settledCostCents: 0,
      pendingMaximumCostCents: 0,
      requestedMaximumCostCents: 20,
      limit: 0,
    });
    expect(state.createJob).not.toHaveBeenCalled();
    expect(state.createReservation).not.toHaveBeenCalled();
  });

  it('counts UTC-day charges and all historical unresolved maximum exposure', async () => {
    const state = budgetHarness({ settledCostCents: 30, pendingMaximumCostCents: 60 });

    await expect(state.repository.createWithQuota(state.input, 5, 100)).resolves.toEqual({
      kind: 'budget-exceeded',
      settledCostCents: 30,
      pendingMaximumCostCents: 60,
      requestedMaximumCostCents: 20,
      limit: 100,
    });
    expect(state.settledAggregate).toHaveBeenCalledWith({
      where: {
        kind: { in: ['CHARGE', 'RECONCILED_CHARGE'] },
        createdAt: { gte: expect.any(Date) },
        actualCostMinor: { not: null },
      },
      _sum: { actualCostMinor: true },
    });
    const settledQuery = state.settledAggregate.mock.calls[0]?.[0] as {
      where: { createdAt: { gte: Date } };
    };
    const utcStart = settledQuery.where.createdAt.gte;
    expect(utcStart.toISOString()).toMatch(/T00:00:00\.000Z$/u);
    expect(state.pendingAggregate).toHaveBeenCalledWith({
      where: { status: { in: ['RESERVED', 'SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED'] } },
      _sum: { maximumCostMinor: true },
    });
  });

  it('creates the job and matching maximum-cost reservation in one Serializable transaction', async () => {
    const state = budgetHarness({ settledCostCents: 30, pendingMaximumCostCents: 40 });

    const result = await state.repository.createWithQuota(state.input, 5, 100);

    expect(result).toMatchObject({
      kind: 'created',
      job: { id: 'job-1', costReservation: {
        id: 'reservation-1',
        status: 'RESERVED',
        estimatedCostMinor: 20,
        maximumCostMinor: 20,
        provider: 'openai-images',
        model: 'gpt-image-1',
        requestFingerprint: 'a'.repeat(64),
      } },
    });
    expect(state.client.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
    expect(state.createReservation).toHaveBeenCalledWith({ data: expect.objectContaining({
      jobId: 'job-1',
      idempotencyKey: 'job-1:cost:reserve',
      operation: 'TEXT_TO_IMAGE',
      estimatedCostMinor: 20,
      maximumCostMinor: 20,
    }) });
    expect(state.events).toEqual([
      'budget-lock',
      'find-job',
      'create-job',
      'create-reservation',
    ]);
  });

  it('returns a paid idempotency replay under the budget lock without reserving twice', async () => {
    const input = paidInput();
    const existing = persistedJob(input, {
      costReservation: {
        id: 'reservation-existing',
        status: 'RESERVED',
        estimatedCostMinor: 20,
        maximumCostMinor: 20,
        provider: input.provider,
        model: input.model,
        requestFingerprint: input.requestFingerprint,
      },
    });
    const state = budgetHarness({ existing });

    await expect(state.repository.createWithQuota(state.input, 5, 0)).resolves.toMatchObject({
      kind: 'existing',
      job: { id: 'job-1', costReservation: { id: 'reservation-existing' } },
    });
    expect(state.events).toEqual(['budget-lock', 'find-job']);
    expect(state.quotaAggregate).not.toHaveBeenCalled();
    expect(state.createReservation).not.toHaveBeenCalled();
  });

  it('serializes concurrent tenants against one global maximum exposure', async () => {
    const jobs: any[] = [];
    const reservations: any[] = [];
    let transactionSequence = 0;
    let lockTail = Promise.resolve();
    let activeBudgetLocks = 0;
    let maximumActiveBudgetLocks = 0;
    const client: any = {
      aiImageJob: {
        findUnique: async ({ where }: any) => jobs.find((row) => {
          const key = where.ai_image_job_owner_idempotency;
          return row.ownerUserId === key.ownerUserId && row.idempotencyKey === key.idempotencyKey;
        }) || null,
      },
      async $transaction(callback: (tx: any) => Promise<unknown>) {
        let unlock: (() => void) | undefined;
        const tx = {
          async $queryRawUnsafe() {
            const previous = lockTail;
            let release!: () => void;
            lockTail = new Promise<void>((resolve) => { release = resolve; });
            await previous;
            activeBudgetLocks += 1;
            maximumActiveBudgetLocks = Math.max(maximumActiveBudgetLocks, activeBudgetLocks);
            unlock = () => {
              activeBudgetLocks -= 1;
              release();
            };
            return [{ locked: 1 }];
          },
          aiImageJob: {
            findUnique: client.aiImageJob.findUnique,
            aggregate: vi.fn()
              .mockResolvedValueOnce({ _sum: { requestedImageCount: 0 } })
              .mockResolvedValueOnce({ _sum: { billedUnits: 0 } }),
            async create({ data }: any) {
              const row = persistedJob({
                ...data,
                count: data.requestedImageCount,
              }, { id: `job-${++transactionSequence}` });
              jobs.push(row);
              return row;
            },
          },
          aiCostSettlement: {
            aggregate: async () => ({ _sum: { actualCostMinor: 0 } }),
          },
          aiCostReservation: {
            aggregate: async () => ({
              _sum: {
                maximumCostMinor: reservations
                  .filter((row) => ['RESERVED', 'SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED'].includes(row.status))
                  .reduce((total, row) => total + row.maximumCostMinor, 0),
              },
            }),
            findUnique: async ({ where }: any) => {
              const key = where.ai_cost_reservation_owner_idempotency;
              return reservations.find((row) => row.ownerUserId === key.ownerUserId
                && row.idempotencyKey === key.idempotencyKey) || null;
            },
            async create({ data }: any) {
              const row = { id: `reservation-${reservations.length + 1}`, status: 'RESERVED', ...data };
              reservations.push(row);
              return row;
            },
          },
        };
        try {
          return await callback(tx);
        } finally {
          unlock?.();
        }
      },
    };
    const repository = new PrismaAiImageJobRepository(client);
    const results = await Promise.all([
      repository.createWithQuota(paidInput({
        ownerUserId: 'owner-a', actorUserId: 'owner-a', idempotencyKey: 'request-a',
        estimatedCostCents: 60,
      }), 5, 100),
      repository.createWithQuota(paidInput({
        ownerUserId: 'owner-b', actorUserId: 'owner-b', idempotencyKey: 'request-b',
        estimatedCostCents: 60,
      }), 5, 100),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual(['budget-exceeded', 'created']);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({ maximumCostMinor: 60, status: 'RESERVED' });
    expect(maximumActiveBudgetLocks).toBe(1);
  });

  it('loads only the dispatch-relevant reservation projection with a job', async () => {
    const input = paidInput();
    const findUnique = vi.fn(async () => persistedJob(input, {
      costReservation: {
        id: 'reservation-1', status: 'RESERVED', currency: 'USD', estimatedCostMinor: 20, maximumCostMinor: 20,
        provider: input.provider, model: input.model, requestFingerprint: input.requestFingerprint,
        ownerUserId: input.ownerUserId, actorUserId: input.actorUserId, secretInternalField: 'hidden',
      },
    }));
    const repository = new PrismaAiImageJobRepository({ aiImageJob: { findUnique } } as never);

    const loaded = await repository.getById('job-1');

    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        costReservation: { select: {
          id: true, status: true, currency: true, estimatedCostMinor: true, maximumCostMinor: true,
          provider: true, model: true, requestFingerprint: true,
        } },
      }),
    }));
    expect(loaded?.costReservation).toEqual({
      id: 'reservation-1', status: 'RESERVED', currency: 'USD', estimatedCostMinor: 20, maximumCostMinor: 20,
      provider: input.provider, model: input.model, requestFingerprint: input.requestFingerprint,
    });
  });
});
