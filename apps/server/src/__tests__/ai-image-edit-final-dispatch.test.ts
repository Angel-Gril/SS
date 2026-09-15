import { describe, expect, it, vi } from 'vitest';
import type { AiImageJobRecord } from '../services/ai-image-jobs.js';
import { assertAiImageEditCostReservation, createAiImageEditDispatchFence } from '../services/ai-image-edit-dispatch.js';
import { createAiImageProviderRuntimeContract } from '../services/ai-image-provider-runtime-contract.js';

function fixture(currency?: 'CNY' | 'USD') {
  const config = {
    provider: 'dashscope-wanx', model: 'wanx2.1-imageedit',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1', apiKey: 'synthetic-final-fence-key',
    costPerImageCents: 14, ...(currency ? { currency } : {}),
    credentialRevision: { recordId: 'synthetic-image-key', revision: 1, updatedAt: '2026-09-15T00:00:00.000Z' },
  };
  const job: AiImageJobRecord = {
    id: 'job-final-fence', ownerUserId: 'owner-final-fence', actorUserId: 'owner-final-fence',
    provider: config.provider, model: config.model, operation: 'INPAINT',
    status: 'RUNNING', attemptCount: 1, workflowId: 'workflow-final-fence', workflowAttempt: 1,
    requestedImageCount: 1, width: 1024, height: 1024, estimatedCostCents: 14,
    prompt: 'Edit the selected background', negativePrompt: null,
    maxAttempts: 1, idempotencyKey: 'final-dispatch-price-test', actualCostCents: null, billedUnits: 0,
    errorCode: null, errorMessage: null,
    requestFingerprint: 'f'.repeat(64), providerJobId: null,
    operationConfig: { providerRuntime: createAiImageProviderRuntimeContract(config, { count: 1, width: 1024, height: 1024 }) },
    costReservation: { id: 'reservation-final-fence', provider: config.provider, model: config.model,
      currency: currency ?? 'USD', status: 'RESERVED', requestFingerprint: 'f'.repeat(64),
      estimatedCostMinor: 14, maximumCostMinor: 14 },
  };
  return { config, job };
}

describe('confirmed edit price at final dispatch', () => {
  it('accepts a CNY reservation matching the confirmed CNY task', () => {
    expect(() => assertAiImageEditCostReservation(fixture('CNY').job)).not.toThrow();
  });

  it.each(['CNY', undefined] as const)('keeps the confirmed price and currency after config updates: %s', async (currency) => {
    const { config, job } = fixture(currency);
    const loadJob = vi.fn(async () => job);
    const fence = createAiImageEditDispatchFence({ job, providerConfig: config, attemptNumber: 1 }, {
      loadJob, loadProviderConfig: async () => ({ ...config, costPerImageCents: 99, currency: 'USD' as const }),
      loadAuthorization: async () => ({ enabled: true, reason: 'approved' }),
      assertExecutionLease: () => undefined, renewExecutionLease: async () => true,
    });
    await expect(fence()).resolves.toBeUndefined();
    expect(loadJob).toHaveBeenCalledOnce();
    expect(job.estimatedCostCents).toBe(14);
    expect(job.costReservation?.currency).toBe(currency ?? 'USD');
  });

  it('rejects changing a reservation currency without changing the frozen task', () => {
    const { job } = fixture('CNY');
    job.costReservation!.currency = 'USD';
    expect(() => assertAiImageEditCostReservation(job)).toThrowError(
      expect.objectContaining({ code: 'AI_IMAGE_COST_RESERVATION_REQUIRED' }),
    );
  });

  it.each(['endpoint', 'credential', 'authorization'] as const)('still rejects a changed %s before dispatch', async (change) => {
    const { config, job } = fixture('CNY');
    const loadJob = vi.fn(async () => job);
    const fence = createAiImageEditDispatchFence({ job, providerConfig: config, attemptNumber: 1 }, {
      loadJob,
      loadProviderConfig: async () => ({
        ...config,
        ...(change === 'endpoint' ? { baseUrl: 'https://workspace-other.cn-beijing.maas.aliyuncs.com/api/v1' } : {}),
        ...(change === 'credential' ? { apiKey: 'synthetic-replaced-key' } : {}),
      }),
      loadAuthorization: async () => ({ enabled: change !== 'authorization', reason: 'disabled' }),
      assertExecutionLease: () => undefined, renewExecutionLease: async () => true,
    });
    await expect(fence()).rejects.toMatchObject({
      code: change === 'endpoint' ? 'PROVIDER_RUNTIME_CONTRACT_MISMATCH'
        : change === 'credential' ? 'PROVIDER_CONFIG_CHANGED' : 'AI_IMAGE_EDIT_DISPATCH_REVOKED',
    });
    expect(loadJob).not.toHaveBeenCalled();
  });
});
