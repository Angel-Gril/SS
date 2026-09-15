import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { createAiImageEditRecovery } from '../services/ai-image-edit-recovery.js';
import { AI_IMAGE_EDIT_POLICY_VERSION } from '../services/ai-image-edit-artifacts.js';
import { createAiImageProviderRuntimeContract } from '../services/ai-image-provider-runtime-contract.js';
import { AiPromptTemplateRegistryService } from '../services/ai-prompt-template-registry.js';
import { InMemoryAiPromptTemplateStore } from '../services/ai-prompt-templates.js';
import { AI_IMAGE_WANX21_EDIT_PROMPT_PROFILE } from '../services/ai-image-edit-prompt-contract.js';
import type { AiImageJobRecord } from '../services/ai-image-jobs.js';
import type { AiProviderReconciliationClaim } from '../services/ai-provider-reconciliation.js';

async function fixture() {
  const image = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#eceff1' } }).png().toBuffer();
  const config = { provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    apiKey: 'synthetic-recovery-secret', costPerImageCents: 14, currency: 'CNY' as const,
    credentialRevision: { recordId: 'synthetic-key', revision: 1, updatedAt: '2026-09-15T00:00:00.000Z' } };
  const registry = new AiPromptTemplateRegistryService(new InMemoryAiPromptTemplateStore(), { getLegacyPrompt: async () => '' });
  const prompt = 'Preserve the synthetic item and recolor the background.';
  const negativePrompt = 'No new text or objects.';
  const frozen = await registry.resolveTemplate({ templateKey: 'full-image-edit.base', renderingProfile: AI_IMAGE_WANX21_EDIT_PROMPT_PROFILE,
    variables: { userPrompt: prompt, userNegativePrompt: negativePrompt } });
  const job: AiImageJobRecord = { id: 'edit-job', ownerUserId: 'owner', actorUserId: 'actor', provider: config.provider, model: config.model,
    status: 'FAILED', operation: 'FULL_EDIT', requestedImageCount: 1, width: 1024, height: 1024, estimatedCostCents: 14,
    actualCostCents: null, billedUnits: 0, attemptCount: 1, maxAttempts: 1, idempotencyKey: null, providerJobId: 'task', errorCode: null, errorMessage: null,
    prompt, negativePrompt, resolvedPrompt: frozen.resolvedPrompt, resolvedNegativePrompt: frozen.resolvedNegativePrompt,
    templateKey: 'full-image-edit.base', templateReleaseId: frozen.release.id, templateChecksum: frozen.checksum, templateSnapshot: frozen.snapshot,
    operationConfig: { policyVersion: AI_IMAGE_EDIT_POLICY_VERSION,
      providerRuntime: createAiImageProviderRuntimeContract(config, { count: 1, width: 1024, height: 1024 }) },
    inputAssets: [{ assetId: 'source', role: 'REFERENCE', ordinal: 0, url: '/synthetic.png', mimeType: 'image/png',
      sha256: createHash('sha256').update(image).digest('hex'), sizeBytes: image.length, width: 1024, height: 1024,
      storageBackend: 'local', storageKey: 'source.png', kind: 'SOURCE_ORIGINAL' }] };
  const claim: AiProviderReconciliationClaim = { jobId: job.id, workflowId: null, ownerUserId: job.ownerUserId, actorUserId: job.actorUserId,
    provider: job.provider, model: job.model, operation: 'FULL_EDIT', providerJobId: 'task', estimatedCostCents: 14,
    jobStatus: 'FAILED', reconciliationStatus: 'RUNNING', reconciliationRevision: 1, reconciliationAttemptCount: 1,
    deadlineAt: new Date(Date.now() + 60_000), leaseToken: 'synthetic-lease' };
  const repository = { claimDue: vi.fn(), defer: vi.fn(), markManualReview: vi.fn(), completeRecovered: vi.fn(), completeNoOutput: vi.fn(),
    getClaimedEditJob: vi.fn(async () => job), recordRecoveredEditRaw: vi.fn(async () => ({ id: 'raw' })), completeRecoveredEdit: vi.fn() };
  const output = (actualCostCents: number) => ({ status: 'SUCCEEDED' as const, providerStatus: 'SUCCEEDED', providerJobId: 'task',
    actualCostCents, image: { buffer: image, mimeType: 'image/png' } });
  const storage = { loadInputBuffer: async () => image,
    uploadBuffer: async (_buffer: Buffer, filename: string) => ({ url: `/synthetic/${filename}`, backend: 'local', key: filename }) };
  return { image, config, job, claim, repository, output, storage };
}

describe('edit recovery uses the confirmed task price', () => {
  it.each([0, 99])('recovers a valid image at the frozen unit price despite Provider amount %s', async amount => {
    const value = await fixture();
    const recovery = createAiImageEditRecovery({ repository: value.repository, getProviderConfig: async () => value.config, ...value.storage });
    await recovery.recover(value.claim, value.output(amount));
    expect(value.repository.completeRecoveredEdit).toHaveBeenCalledWith(expect.objectContaining({ actualCostCents: 14 }));
  });

  it('keeps the confirmed CNY price during lookup after current price/currency changes', async () => {
    const value = await fixture();
    const poll = vi.fn(async () => value.output(0));
    const createProvider = vi.fn(() => ({ poll })) as any;
    const recovery = createAiImageEditRecovery({ repository: value.repository, ...value.storage,
      getProviderConfig: async () => ({ ...value.config, costPerImageCents: 99, currency: 'USD' }), createProvider });
    const result = await recovery.lookup(value.claim);
    expect(poll).toHaveBeenCalledOnce();
    expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({ costPerImageCents: 14 }));
    expect(result).toMatchObject({ status: 'SUCCEEDED', providerJobId: 'task', actualCostCents: 14 });
  });

  it('still rejects changed credential revisions before lookup', async () => {
    const value = await fixture();
    const createProvider = vi.fn() as any;
    const recovery = createAiImageEditRecovery({ repository: value.repository, ...value.storage, createProvider,
      getProviderConfig: async () => ({ ...value.config, credentialRevision: { ...value.config.credentialRevision, revision: 2 } }) });
    await expect(recovery.lookup(value.claim)).rejects.toMatchObject({ code: 'PROVIDER_RUNTIME_CONTRACT_MISMATCH' });
    expect(createProvider).not.toHaveBeenCalled();
  });
});
