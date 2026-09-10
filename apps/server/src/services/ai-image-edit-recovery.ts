import { AiImageJobError } from './ai-image-job-error.js';
import {
  assertAiImageEditInputPolicy,
  loadAiImageEditInputs,
  storeAiImageEditFinal,
  storeAiImageEditRaw,
  type AiImageEditUploadBuffer,
} from './ai-image-edit-artifacts.js';
import { loadAiImageEditInputBuffer } from './ai-image-edit-input-reader.js';
import { resolveAiImageEditProviderContract } from './ai-image-edit-provider-contract.js';
import { assertAiImageProviderRuntimeContract } from './ai-image-provider-runtime-contract.js';
import { getAiImageEditProviderRuntimeConfig } from './ai-image-edit-runtime-config.js';
import { createDashScopeWanx21ImageEditProvider } from './ai-image-wanx-edit-provider.js';
import {
  isWanxEditReconciliationOperation,
  type AiProviderReconciliationClaim,
  type AiProviderReconciliationRepository,
  type AiProviderTaskLookupResult,
} from './ai-provider-reconciliation.js';

export interface AiImageEditRecoveryOptions {
  repository: AiProviderReconciliationRepository;
  uploadBuffer: AiImageEditUploadBuffer;
  getProviderConfig?: typeof getAiImageEditProviderRuntimeConfig;
  createProvider?: typeof createDashScopeWanx21ImageEditProvider;
  loadInputBuffer?: typeof loadAiImageEditInputBuffer;
}

/** Recovery can query the accepted identity, but has no call path to edit()/POST. */
export function createAiImageEditRecovery(options: AiImageEditRecoveryOptions) {
  const repository = options.repository;
  const getProviderConfig = options.getProviderConfig || getAiImageEditProviderRuntimeConfig;
  async function context(claim: AiProviderReconciliationClaim) {
    if (!isWanxEditReconciliationOperation(claim) || !repository.getClaimedEditJob
      || !repository.recordRecoveredEditRaw || !repository.completeRecoveredEdit) {
      throw new AiImageJobError('PROVIDER_LOOKUP_UNSUPPORTED', 'Revision-bound edit recovery is not installed');
    }
    const config = await getProviderConfig();
    const job = await repository.getClaimedEditJob(claim);
    assertAiImageProviderRuntimeContract(job.operationConfig?.providerRuntime, config, {
      count: job.requestedImageCount, width: job.width, height: job.height,
      estimatedCostCents: job.estimatedCostCents,
    });
    assertAiImageEditInputPolicy(job);
    const contract = resolveAiImageEditProviderContract(job.provider, job.model, config.baseUrl);
    if (contract?.kind !== 'wanx21' || !config.apiKey.trim()) {
      throw new AiImageJobError('PROVIDER_RECONCILIATION_CONFIG_UNAVAILABLE', 'Original edit Provider configuration is unavailable');
    }
    return { job, config, contract };
  }
  const upload: AiImageEditUploadBuffer = async (...args) => {
    try {
      return await options.uploadBuffer(...args);
    } catch {
      throw Object.assign(new AiImageJobError('OUTPUT_PERSISTENCE_FAILED', 'Recovered edit output storage is temporarily unavailable'), {
        transient: true,
      });
    }
  };
  return {
    async lookup(claim: AiProviderReconciliationClaim): Promise<AiProviderTaskLookupResult> {
      const { config, contract } = await context(claim);
      const provider = (options.createProvider || createDashScopeWanx21ImageEditProvider)({
        baseUrl: contract.baseUrl, apiKey: config.apiKey, model: config.model,
        costPerImageCents: claim.estimatedCostCents,
        beforeTaskLookup: async () => {
          const current = await context(claim);
          if (current.config.apiKey !== config.apiKey) {
            throw new AiImageJobError('PROVIDER_CONFIG_CHANGED', 'Edit credentials changed before task lookup');
          }
        },
      });
      const result = await provider.poll(claim.providerJobId);
      await context(claim);
      return result;
    },
    async recover(claim: AiProviderReconciliationClaim, result: Extract<AiProviderTaskLookupResult, { status: 'SUCCEEDED' }>) {
      const { job } = await context(claim);
      if (result.providerJobId !== claim.providerJobId || result.actualCostCents !== job.estimatedCostCents) {
        throw new AiImageJobError('PROVIDER_COST_EVIDENCE_MISMATCH', 'Recovered output does not match the frozen task and cost');
      }
      const inputs = await loadAiImageEditInputs(job, options.loadInputBuffer || loadAiImageEditInputBuffer);
      await context(claim);
      const raw = await storeAiImageEditRaw(job, result.image.buffer, upload);
      const persistedRaw = await repository.recordRecoveredEditRaw!({ claim, asset: raw });
      const current = await context(claim);
      const finalAsset = current.job.status === 'CANCELLED' ? null
        : await storeAiImageEditFinal(job, inputs, result.image.buffer, persistedRaw.id, upload);
      await context(claim);
      await repository.completeRecoveredEdit!({
        claim, providerStatus: result.providerStatus, actualCostCents: result.actualCostCents,
        rawAssetId: persistedRaw.id, finalAsset,
      });
    },
  };
}
