import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAiImageProviderBillingFinalize } from './ai-image-provider-billing-finalize.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AI image Provider billing finalizer command', () => {
  it.each([
    ['AI_IMAGE_SANDBOX_API_KEY', 'provider-secret'],
    ['AI_IMAGE_SANDBOX_CONFIRM', 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST'],
    ['AI_IMAGE_TRANSLATION_SANDBOX_API_KEY', 'provider-secret'],
    ['AI_IMAGE_SANDBOX_TOKEN', 'provider-secret'],
    ['AUTHORIZATION', 'Bearer provider-secret'],
    ['OPENAI_API_KEY', 'provider-secret'],
    ['PACKY_API_KEY', 'provider-secret'],
    ['PACKY_TOKEN', 'provider-secret'],
    ['XIAOYI_API_KEY', 'provider-secret'],
    ['XIAOYI_TOKEN', 'provider-secret'],
  ])('rejects unsafe %s before code or evidence inspection', async (name, value) => {
    const resolveRevision = vi.fn();
    const finalizeBilling = vi.fn();

    await expect(runAiImageProviderBillingFinalize({
      environment: { NODE_ENV: 'sandbox', [name]: value },
      resolveRevision,
      finalizeBilling: finalizeBilling as any,
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_UNSAFE_ENV' });

    expect(resolveRevision).not.toHaveBeenCalled();
    expect(finalizeBilling).not.toHaveBeenCalled();
  });

  it('runs the offline finalizer with only exact non-secret evidence inputs', async () => {
    const revision = 'a'.repeat(40);
    const resolveRevision = vi.fn(async () => revision);
    const finalizeBilling = vi.fn(async () => ({
      receipt: {
        schemaVersion: 3,
        event: 'AI_IMAGE_SANDBOX_BILLING_SETTLED',
        operationId: 'sandbox-billing-command-0001',
        actualCost: { currency: 'CNY', amount: 119, scale: 4 },
      },
      receiptPath: 'C:\\private\\must-not-be-printed.billing.json',
      replayed: false,
    }));
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fetch = vi.spyOn(globalThis, 'fetch');

    const result = await runAiImageProviderBillingFinalize({
      environment: {
        NODE_ENV: 'sandbox',
        AI_IMAGE_SANDBOX_OPERATION_ID: 'sandbox-billing-command-0001',
        AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
        AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_PATH: 'private/settlement.json',
        AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_SHA256: 'b'.repeat(64),
      },
      repositoryRoot: 'C:\\reviewed-repository',
      evidenceRoot: 'C:\\private\\evidence-root',
      now: new Date('2030-01-01T00:10:00.000Z'),
      resolveRevision,
      finalizeBilling: finalizeBilling as any,
    });

    expect(result.replayed).toBe(false);
    expect(resolveRevision).toHaveBeenCalledWith(
      'C:\\reviewed-repository',
      undefined,
      [
        'apps/server/scripts/ai-image-provider-billing-finalize.ts',
        'apps/server/src/services/ai-image-sandbox-billing-settlement.ts',
        'apps/server/src/services/ai-image-sandbox-money.ts',
        'apps/server/src/services/ai-image-sandbox-code-revision.ts',
        'apps/server/src/services/ai-image-sandbox-guard.ts',
        'apps/server/src/services/ai-image-packy-edit-profile.ts',
        'apps/server/src/services/ai-image-xiaoyi-provider.ts',
      ],
      undefined,
    );
    expect(finalizeBilling).toHaveBeenCalledWith(expect.objectContaining({
      evidenceRoot: 'C:\\private\\evidence-root',
      operationId: 'sandbox-billing-command-0001',
      settlementPath: 'private/settlement.json',
      settlementSha256: 'b'.repeat(64),
      finalizationAdapterRevision: revision,
    }));
    expect(fetch).not.toHaveBeenCalled();
    const output = stdout.mock.calls.map((call) => String(call[0])).join('');
    expect(output).toContain('AI_IMAGE_SANDBOX_BILLING_SETTLED');
    expect(output).not.toContain('must-not-be-printed');
    expect(output).not.toContain('private/settlement.json');
  });

  it('rejects a finalizer revision that differs from deployed code', async () => {
    const finalizeBilling = vi.fn();
    await expect(runAiImageProviderBillingFinalize({
      environment: {
        NODE_ENV: 'sandbox',
        AI_IMAGE_SANDBOX_OPERATION_ID: 'sandbox-billing-command-0001',
        AI_IMAGE_SANDBOX_ADAPTER_REVISION: 'a'.repeat(40),
        AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_PATH: 'private/settlement.json',
        AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_SHA256: 'b'.repeat(64),
      },
      repositoryRoot: 'C:\\reviewed-repository',
      resolveRevision: async () => 'c'.repeat(40),
      finalizeBilling: finalizeBilling as any,
    })).rejects.toMatchObject({ code: 'SANDBOX_ADAPTER_REVISION_MISMATCH' });
    expect(finalizeBilling).not.toHaveBeenCalled();
  });
});
