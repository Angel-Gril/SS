import { describe, expect, it, vi } from 'vitest';
import { PrismaAiMediaWorkflowRepository } from '../repositories/ai-media-workflow-repository.js';

const OPTIONS = {
  sourceLanguage: 'zh',
  targetLanguage: 'ru',
  domainHint: 'Frozen translation policy',
  terminologies: [],
  imageSegment: false as const,
  policyVersion: 'ai-image-translation-policy/1.0' as const,
};

function paidTranslationInput(
  ownerUserId: string,
  idempotencyKey: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    ownerUserId,
    actorUserId: ownerUserId,
    sourceAssetId: `asset-${ownerUserId}`,
    sourceLanguage: 'zh',
    targetLanguage: 'ru',
    domainHint: 'Translate product copy',
    terminologies: [],
    imageSegment: false as const,
    provider: 'dashscope-qwen-mt-image',
    model: 'qwen-mt-image',
    dailyLimit: 0,
    estimatedCostCents: 60,
    globalDailyBudgetCents: 100,
    idempotencyKey,
    context: { type: 'collect' as const, id: `goods-${ownerUserId}` },
    options: OPTIONS,
    ...overrides,
  };
}

function translationBudgetHarness(input: {
  pendingMaximumCostCents?: number;
  settledCostCents?: number;
} = {}) {
  const workflows: any[] = [];
  const workflowInputs: any[] = [];
  const jobs: any[] = [];
  const events: any[] = [];
  const reservations: any[] = input.pendingMaximumCostCents
    ? [{
      id: 'existing-reservation',
      ownerUserId: 'existing-owner',
      idempotencyKey: 'existing-reservation-key',
      status: 'RESERVED',
      maximumCostMinor: input.pendingMaximumCostCents,
    }]
    : [];
  const callOrder: string[] = [];
  let lockTail = Promise.resolve();
  let activeBudgetLocks = 0;
  let maximumActiveBudgetLocks = 0;

  const hydrateWorkflow = (workflow: any) => workflow && ({
    ...workflow,
    inputs: workflowInputs.filter((row) => row.workflowId === workflow.id),
    jobs: jobs.filter((row) => row.workflowId === workflow.id),
    events: events.filter((row) => row.workflowId === workflow.id),
    suiteSlot: null,
  });
  const findWorkflow = vi.fn(async ({ where }: any) => {
    callOrder.push('find-workflow');
    if (where.id) return hydrateWorkflow(workflows.find((row) => row.id === where.id) || null);
    const key = where.ai_media_workflow_owner_idempotency;
    return hydrateWorkflow(workflows.find((row) => (
      row.ownerUserId === key.ownerUserId && row.idempotencyKey === key.idempotencyKey
    )) || null);
  });
  const createWorkflow = vi.fn(async ({ data }: any) => {
    callOrder.push('create-workflow');
    const row = { id: `workflow-${workflows.length + 1}`, ...data };
    workflows.push(row);
    return row;
  });
  const aggregateReservations = vi.fn(async () => {
    callOrder.push('aggregate-global-reservations');
    return {
      _sum: {
        maximumCostMinor: reservations
          .filter((row) => ['RESERVED', 'SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED'].includes(row.status))
          .reduce((total, row) => total + row.maximumCostMinor, 0),
      },
    };
  });

  const client: any = {
    aiMediaWorkflow: { findUnique: findWorkflow },
    mediaAsset: {
      findMany: vi.fn(async ({ where }: any) => [{
        id: where.id,
        ownerUserId: where.ownerUserId,
        kind: 'SOURCE_ORIGINAL',
        sha256: 'a'.repeat(64),
        sourceCaptureSnapshotId: `snapshot-${where.ownerUserId}`,
        url: `https://cdn.example/${where.id}.png`,
        mimeType: 'image/png',
        width: 1200,
        height: 800,
      }]),
    },
    async $transaction(callback: (tx: any) => Promise<unknown>) {
      let unlock: (() => void) | undefined;
      const tx = {
        async $queryRawUnsafe() {
          callOrder.push('budget-lock');
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
        mediaAsset: client.mediaAsset,
        supplyGoods: {
          findFirst: vi.fn(async ({ where }: any) => ({
            id: where.id,
            sourceCaptureSubject: { snapshots: [{ id: `snapshot-${where.userId}` }] },
          })),
        },
        aiMediaWorkflow: { findUnique: findWorkflow, create: createWorkflow },
        aiMediaWorkflowInput: {
          create: vi.fn(async ({ data }: any) => {
            workflowInputs.push(data);
            return data;
          }),
        },
        aiImageJob: {
          create: vi.fn(async ({ data }: any) => {
            const row = { id: `job-${jobs.length + 1}`, ...data };
            jobs.push(row);
            return row;
          }),
        },
        aiCostSettlement: {
          aggregate: vi.fn(async () => ({ _sum: { actualCostMinor: input.settledCostCents || 0 } })),
        },
        aiCostReservation: {
          aggregate: aggregateReservations,
          findUnique: vi.fn(async ({ where }: any) => {
            const key = where.ai_cost_reservation_owner_idempotency;
            return reservations.find((row) => (
              row.ownerUserId === key.ownerUserId && row.idempotencyKey === key.idempotencyKey
            )) || null;
          }),
          create: vi.fn(async ({ data }: any) => {
            const row = { id: `reservation-${reservations.length + 1}`, status: 'RESERVED', ...data };
            reservations.push(row);
            return row;
          }),
        },
        aiMediaWorkflowEvent: {
          create: vi.fn(async ({ data }: any) => {
            events.push(data);
            return data;
          }),
        },
      };
      try {
        return await callback(tx);
      } finally {
        unlock?.();
      }
    },
  };

  return {
    repository: new PrismaAiMediaWorkflowRepository(client),
    workflows,
    jobs,
    reservations,
    callOrder,
    aggregateReservations,
    get maximumActiveBudgetLocks() { return maximumActiveBudgetLocks; },
  };
}

describe('paid image translation global budget', () => {
  it('treats a zero global budget as a hard stop before creating business state', async () => {
    const state = translationBudgetHarness();

    await expect(state.repository.createImageTranslation(paidTranslationInput(
      'owner-zero',
      'translation-zero-budget',
      { globalDailyBudgetCents: 0 },
    ))).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });

    expect(state.workflows).toHaveLength(0);
    expect(state.jobs).toHaveLength(0);
    expect(state.reservations).toHaveLength(0);
    expect(state.callOrder[0]).toBe('budget-lock');
  });

  it('rejects exposure above the configured global limit before workflow creation', async () => {
    const state = translationBudgetHarness({ pendingMaximumCostCents: 50 });

    await expect(state.repository.createImageTranslation(paidTranslationInput(
      'owner-over',
      'translation-over-budget',
    ))).rejects.toMatchObject({
      code: 'BUDGET_EXCEEDED',
      summary: expect.objectContaining({
        pendingMaximumCostMinor: 50,
        requestedMaximumCostMinor: 60,
        totalExposureMinor: 110,
        limit: 100,
      }),
    });

    expect(state.workflows).toHaveLength(0);
    expect(state.jobs).toHaveLength(0);
    expect(state.reservations).toHaveLength(1);
    expect(state.callOrder).toContain('aggregate-global-reservations');
    expect(state.callOrder).not.toContain('create-workflow');
  });

  it('serializes concurrent tenants so only one can consume the remaining budget', async () => {
    const state = translationBudgetHarness();

    const results = await Promise.allSettled([
      state.repository.createImageTranslation(paidTranslationInput(
        'owner-a',
        'translation-concurrent-a',
      )),
      state.repository.createImageTranslation(paidTranslationInput(
        'owner-b',
        'translation-concurrent-b',
      )),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: { code: 'BUDGET_EXCEEDED' },
    });
    expect(state.workflows).toHaveLength(1);
    expect(state.jobs).toHaveLength(1);
    expect(state.reservations).toHaveLength(1);
    expect(state.maximumActiveBudgetLocks).toBe(1);
  });

  it('replays the same paid translation under the lock without reserving budget twice', async () => {
    const state = translationBudgetHarness();
    const input = paidTranslationInput('owner-replay', 'translation-budget-replay');

    const created = await state.repository.createImageTranslation(input);
    const replayed = await state.repository.createImageTranslation({
      ...input,
      globalDailyBudgetCents: 0,
    });

    expect(created).toMatchObject({ kind: 'created', jobId: 'job-1' });
    expect(replayed).toMatchObject({ kind: 'existing', jobId: 'job-1' });
    expect(state.workflows).toHaveLength(1);
    expect(state.jobs).toHaveLength(1);
    expect(state.reservations).toHaveLength(1);
    expect(state.aggregateReservations).toHaveBeenCalledTimes(1);
    expect(state.callOrder.filter((item) => item === 'budget-lock')).toHaveLength(2);
  });
});
