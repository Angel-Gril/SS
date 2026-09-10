import { describe, expect, it, vi } from 'vitest';
import {
  createAiProviderReconciliationService,
  type AiProviderReconciliationClaim,
  type AiProviderReconciliationRepository,
} from '../services/ai-provider-reconciliation.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=',
  'base64',
);
const NOW = new Date('2026-07-21T08:00:00.000Z');

function claim(overrides: Partial<AiProviderReconciliationClaim> = {}): AiProviderReconciliationClaim {
  return {
    jobId: 'job-1',
    workflowId: 'workflow-1',
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    operation: 'IMAGE_TRANSLATE',
    provider: 'fake',
    model: 'fake-image-translation-v1',
    estimatedCostCents: 0,
    providerJobId: 'provider-task-1',
    jobStatus: 'FAILED',
    reconciliationStatus: 'RUNNING',
    reconciliationRevision: 2,
    reconciliationAttemptCount: 1,
    deadlineAt: new Date('2026-07-22T08:00:00.000Z'),
    leaseToken: 'lease-token-1',
    ...overrides,
  };
}

function repository(claims: AiProviderReconciliationClaim[] = [claim()]) {
  const value: AiProviderReconciliationRepository = {
    claimDue: vi.fn(async () => claims),
    defer: vi.fn(async () => undefined),
    markManualReview: vi.fn(async () => undefined),
    completeRecovered: vi.fn(async () => undefined),
    completeNoOutput: vi.fn(async () => undefined),
  };
  return value;
}

describe('AI Provider result reconciliation', () => {
  it.each(['FULL_EDIT', 'INPAINT'] as const)('routes Wanx %s to the edit artifact owner, never the translation persistence path', async (operation) => {
    const accepted = claim({ operation, provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', estimatedCostCents: 7 });
    const repo = repository([accepted]);
    const recovered = {
      status: 'SUCCEEDED' as const, providerJobId: accepted.providerJobId, providerStatus: 'SUCCEEDED',
      image: { buffer: PNG, mimeType: 'image/png' }, actualCostCents: 7,
    };
    const recoverEditOutput = vi.fn(async () => undefined);
    const uploadBuffer = vi.fn();
    const service = createAiProviderReconciliationService({
      repository: repo, lookupProviderTask: async () => recovered, recoverEditOutput,
      uploadBuffer, now: () => NOW,
    });
    expect(await service.runTick({ workerId: 'edit-recovery' })).toMatchObject({ claimed: 1, recovered: 1, manualReview: 0 });
    expect(recoverEditOutput).toHaveBeenCalledWith(accepted, recovered);
    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(repo.completeRecovered).not.toHaveBeenCalled();
  });

  it('recovers one accepted task without exposing a submission callback', async () => {
    const repo = repository();
    const lookupProviderTask = vi.fn(async (accepted: AiProviderReconciliationClaim) => ({
      status: 'SUCCEEDED' as const,
      providerJobId: accepted.providerJobId,
      providerStatus: 'SUCCEEDED',
      image: { buffer: PNG, mimeType: 'image/png' },
      actualCostCents: 12,
    }));
    const uploadBuffer = vi.fn(async () => ({
      url: 'https://cdn.example/recovered.png',
      backend: 'oss',
      key: 'ai/recovered.png',
    }));
    const service = createAiProviderReconciliationService({
      repository: repo,
      lookupProviderTask,
      uploadBuffer,
      now: () => NOW,
    });

    await expect(service.runTick({ workerId: 'worker-1', limit: 10 })).resolves.toEqual({
      claimed: 1,
      recovered: 1,
      pending: 0,
      noOutput: 0,
      manualReview: 0,
    });

    expect(lookupProviderTask).toHaveBeenCalledWith(expect.objectContaining({
      providerJobId: 'provider-task-1',
    }));
    expect(uploadBuffer).toHaveBeenCalledWith(
      PNG,
      expect.stringMatching(/^provider-reconciled-job-1-/u),
      'image/png',
      expect.objectContaining({
        category: 'ai-generated',
        ownerId: 'owner-1',
        idempotencyKey: expect.stringMatching(/^job-1:provider-reconciliation:/u),
      }),
    );
    expect(repo.completeRecovered).toHaveBeenCalledWith(expect.objectContaining({
      claim: expect.objectContaining({ leaseToken: 'lease-token-1' }),
      providerStatus: 'SUCCEEDED',
      actualCostCents: 12,
      asset: expect.objectContaining({
        ownerUserId: 'owner-1',
        jobId: 'job-1',
        url: 'https://cdn.example/recovered.png',
        storageBackend: 'oss',
        storageKey: 'ai/recovered.png',
        mimeType: 'image/png',
        sizeBytes: PNG.length,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    }));
  });

  it('backs off a pending task and never stores an output', async () => {
    const repo = repository();
    const uploadBuffer = vi.fn();
    const service = createAiProviderReconciliationService({
      repository: repo,
      lookupProviderTask: vi.fn(async (accepted) => ({
        status: 'PENDING' as const,
        providerJobId: accepted.providerJobId,
        providerStatus: 'RUNNING',
      })),
      uploadBuffer,
      now: () => NOW,
    });

    const result = await service.runTick({ workerId: 'worker-1', limit: 10 });

    expect(result).toMatchObject({ claimed: 1, pending: 1 });
    expect(repo.defer).toHaveBeenCalledWith(expect.objectContaining({
      providerStatus: 'RUNNING',
      nextAttemptAt: expect.any(Date),
    }));
    expect((repo.defer as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].nextAttemptAt.getTime())
      .toBeGreaterThan(NOW.getTime());
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('backs off a transient lookup failure with bounded evidence', async () => {
    const repo = repository();
    const service = createAiProviderReconciliationService({
      repository: repo,
      lookupProviderTask: vi.fn(async () => {
        throw Object.assign(new Error(`temporary ${'x'.repeat(2_000)}`), {
          code: 'PROVIDER_TIMEOUT',
          transient: true,
        });
      }),
      uploadBuffer: vi.fn(),
      now: () => NOW,
    });

    await service.runTick({ workerId: 'worker-1', limit: 10 });

    expect(repo.defer).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'PROVIDER_TIMEOUT',
      errorMessage: expect.any(String),
    }));
    expect((repo.defer as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].errorMessage.length)
      .toBeLessThanOrEqual(500);
  });

  it('backs off a raw object-storage failure instead of opening manual review', async () => {
    const repo = repository();
    const service = createAiProviderReconciliationService({
      repository: repo,
      lookupProviderTask: vi.fn(async (accepted) => ({
        status: 'SUCCEEDED' as const,
        providerJobId: accepted.providerJobId,
        providerStatus: 'SUCCEEDED',
        image: { buffer: PNG, mimeType: 'image/png' },
        actualCostCents: 12,
      })),
      uploadBuffer: vi.fn(async () => {
        throw new Error('temporary OSS connection reset');
      }),
      now: () => NOW,
    });

    await expect(service.runTick({ workerId: 'worker-1', limit: 1 })).resolves.toMatchObject({
      claimed: 1, pending: 1, manualReview: 0,
    });
    expect(repo.defer).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'OUTPUT_PERSISTENCE_FAILED',
      errorMessage: 'temporary OSS connection reset',
      nextAttemptAt: expect.any(Date),
    }));
    expect(repo.markManualReview).not.toHaveBeenCalled();
    expect(repo.completeRecovered).not.toHaveBeenCalled();
  });

  it('quarantines a cost-ledger Provider identity conflict after lookup succeeds', async () => {
    const repo = repository();
    (repo.completeRecovered as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('Cost ledger belongs to another Provider task'), {
        code: 'PROVIDER_COST_TASK_ID_MISMATCH',
      }),
    );
    const service = createAiProviderReconciliationService({
      repository: repo,
      lookupProviderTask: vi.fn(async (accepted) => ({
        status: 'SUCCEEDED' as const,
        providerJobId: accepted.providerJobId,
        providerStatus: 'SUCCEEDED',
        image: { buffer: PNG, mimeType: 'image/png' },
        actualCostCents: 12,
      })),
      uploadBuffer: vi.fn(async () => ({
        url: 'https://cdn.example/recovered.png',
        backend: 'oss',
        key: 'ai/recovered.png',
      })),
      now: () => NOW,
    });

    await expect(service.runTick({ workerId: 'worker-1', limit: 1 })).resolves.toMatchObject({
      claimed: 1, recovered: 0, manualReview: 1,
    });
    expect(repo.markManualReview).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'PROVIDER_COST_TASK_ID_MISMATCH',
    }));
  });

  it('moves an expired task to manual review without calling Provider lookup', async () => {
    const repo = repository([claim({ deadlineAt: new Date('2026-07-21T07:59:59.000Z') })]);
    const lookupProviderTask = vi.fn();
    const service = createAiProviderReconciliationService({
      repository: repo,
      lookupProviderTask,
      uploadBuffer: vi.fn(),
      now: () => NOW,
    });

    const result = await service.runTick({ workerId: 'worker-1', limit: 10 });

    expect(result).toMatchObject({ claimed: 1, manualReview: 1 });
    expect(lookupProviderTask).not.toHaveBeenCalled();
    expect(repo.markManualReview).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'PROVIDER_RECONCILIATION_DEADLINE_EXCEEDED',
    }));
  });

  it('rejects a mismatched task identity instead of accepting another result', async () => {
    const repo = repository();
    const service = createAiProviderReconciliationService({
      repository: repo,
      lookupProviderTask: vi.fn(async () => ({
        status: 'PENDING' as const,
        providerJobId: 'attacker-task',
        providerStatus: 'RUNNING',
      })),
      uploadBuffer: vi.fn(),
      now: () => NOW,
    });

    await service.runTick({ workerId: 'worker-1', limit: 10 });

    expect(repo.markManualReview).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'PROVIDER_JOB_ID_MISMATCH',
    }));
    expect(repo.defer).not.toHaveBeenCalled();
  });

  it('records a proven terminal Provider failure as no output while leaving billing separate', async () => {
    const repo = repository();
    const service = createAiProviderReconciliationService({
      repository: repo,
      lookupProviderTask: vi.fn(async (accepted) => ({
        status: 'NO_OUTPUT' as const,
        providerJobId: accepted.providerJobId,
        providerStatus: 'FAILED',
        errorCode: 'PROVIDER_TASK_FAILED',
        errorMessage: 'Provider task failed',
        billingDisposition: 'UNKNOWN' as const,
      })),
      uploadBuffer: vi.fn(),
      now: () => NOW,
    });

    const result = await service.runTick({ workerId: 'worker-1', limit: 10 });

    expect(result).toMatchObject({ claimed: 1, noOutput: 1 });
    expect(repo.completeNoOutput).toHaveBeenCalledWith(expect.objectContaining({
      providerStatus: 'FAILED',
      billingDisposition: 'UNKNOWN',
    }));
  });

  it('ignores a stale lease result without aborting the remaining claimed work', async () => {
    const first = claim({ jobId: 'job-stale', leaseToken: 'stale-lease' });
    const second = claim({ jobId: 'job-current', providerJobId: 'provider-task-2', leaseToken: 'current-lease' });
    const repo = repository([first, second]);
    (repo.defer as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(Object.assign(new Error('lease changed'), {
        code: 'PROVIDER_RECONCILIATION_LEASE_LOST',
      }))
      .mockResolvedValueOnce(undefined);
    const service = createAiProviderReconciliationService({
      repository: repo,
      lookupProviderTask: vi.fn(async (accepted) => ({
        status: 'PENDING' as const,
        providerJobId: accepted.providerJobId,
        providerStatus: 'RUNNING',
      })),
      uploadBuffer: vi.fn(),
      now: () => NOW,
    });

    await expect(service.runTick({ workerId: 'worker-1', limit: 2 })).resolves.toMatchObject({
      claimed: 2,
      pending: 1,
    });
    expect(repo.defer).toHaveBeenCalledTimes(2);
    expect(repo.markManualReview).not.toHaveBeenCalled();
  });
});
