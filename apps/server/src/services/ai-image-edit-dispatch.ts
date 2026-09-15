import { AiImageJobError, type AiImageJobRecord } from './ai-image-jobs.js';
import {
  AiImageProviderRuntimeContractError,
  bindAiImageProviderExecutionConfig,
  type AiImageProviderRuntimeIdentity,
} from './ai-image-provider-runtime-contract.js';
import { getFrozenAiImageTaskPrice } from './ai-image-task-cost.js';

type ProviderConfig = AiImageProviderRuntimeIdentity & { apiKey: string };

export function assertAiImageEditCostReservation(job: AiImageJobRecord): void {
  const reservation = job.costReservation;
  let currency: string;
  try {
    currency = getFrozenAiImageTaskPrice(job).currency;
  } catch {
    throw new AiImageJobError('AI_IMAGE_COST_RESERVATION_REQUIRED', 'Paid AI image edit dispatch requires its confirmed price and currency');
  }
  if (
    !reservation?.id
    || reservation.currency !== currency
    || reservation.status !== 'RESERVED'
    || reservation.provider !== job.provider
    || reservation.model !== job.model
    || reservation.requestFingerprint !== job.requestFingerprint
    || Number(reservation.estimatedCostMinor) !== job.estimatedCostCents
    || Number(reservation.maximumCostMinor) !== job.estimatedCostCents
  ) {
    throw new AiImageJobError(
      'AI_IMAGE_COST_RESERVATION_REQUIRED',
      'Paid AI image edit dispatch requires an exact RESERVED cost reservation',
    );
  }
}

/** Revalidate the frozen invocation after media preparation and DNS, before fetch. */
export function createAiImageEditDispatchFence(input: {
  job: AiImageJobRecord;
  attemptNumber: number;
  providerConfig: ProviderConfig;
}, dependencies: {
  loadJob: () => Promise<AiImageJobRecord | null>;
  loadProviderConfig: () => Promise<ProviderConfig>;
  loadAuthorization: () => Promise<{ enabled: boolean; reason: string }>;
  assertExecutionLease: () => void;
  renewExecutionLease: () => Promise<boolean>;
}) {
  const { job, attemptNumber } = input;
  const providerConfig = { ...input.providerConfig };
  return async () => {
    dependencies.assertExecutionLease();
    let renewed: boolean;
    try {
      renewed = await dependencies.renewExecutionLease();
    } catch {
      throw new AiImageJobError('EDIT_EXECUTION_LEASE_LOST', 'AI image edit execution lease could not be verified');
    }
    if (!renewed) {
      throw new AiImageJobError('EDIT_EXECUTION_LEASE_LOST', 'AI image edit execution lease was lost');
    }
    // Read authorization, configuration and the final job snapshot after the network lease renewal.
    let authorization: { enabled: boolean; reason: string };
    try {
      authorization = await dependencies.loadAuthorization();
    } catch {
      throw new AiImageJobError(
        'AI_IMAGE_EDIT_DISPATCH_REVOKED',
        'AI image edit authorization could not be verified before dispatch',
      );
    }
    if (!authorization.enabled) {
      throw new AiImageJobError('AI_IMAGE_EDIT_DISPATCH_REVOKED', authorization.reason);
    }
    const activeConfig = await dependencies.loadProviderConfig();
    try {
      bindAiImageProviderExecutionConfig(job.operationConfig?.providerRuntime, activeConfig, {
        count: 1, width: job.width, height: job.height, estimatedCostCents: job.estimatedCostCents,
      });
    } catch (error) {
      if (error instanceof AiImageProviderRuntimeContractError) {
        throw new AiImageJobError(error.code, error.message);
      }
      throw error;
    }
    if (activeConfig.apiKey !== providerConfig.apiKey) {
      throw new AiImageJobError('PROVIDER_CONFIG_CHANGED', 'AI image edit credentials changed before dispatch');
    }
    const current = await dependencies.loadJob();
    if (
      !current || current.status !== 'RUNNING' || current.providerJobId
      || current.id !== job.id || current.ownerUserId !== job.ownerUserId
      || current.operation !== job.operation || current.provider !== job.provider || current.model !== job.model
      || current.requestFingerprint !== job.requestFingerprint || current.attemptCount !== attemptNumber
      || current.workflowId !== job.workflowId || current.workflowAttempt !== job.workflowAttempt
      || current.width !== job.width || current.height !== job.height || current.requestedImageCount !== 1
    ) {
      throw new AiImageJobError(
        'AI_IMAGE_EDIT_DISPATCH_REVOKED',
        'AI image edit invocation changed or was cancelled before dispatch',
      );
    }
    assertAiImageEditCostReservation(current);
    dependencies.assertExecutionLease();
  };
}
