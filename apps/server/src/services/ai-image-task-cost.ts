import { AiImageJobError } from './ai-image-job-error.js';
import type { AiImageJobRecord } from './ai-image-jobs.js';
import { parseAiImageProviderRuntimeContract, type AiImageProviderCurrency } from './ai-image-provider-runtime-contract.js';
import { parseAiImageTranslationRuntime } from './ai-image-translation-runtime-contract.js';

type FrozenTask = Pick<AiImageJobRecord, 'provider' | 'model' | 'requestedImageCount' | 'width' | 'height'
  | 'estimatedCostCents' | 'operationConfig'> & { costReservation?: { currency?: string } | null };

export interface FrozenAiImageTaskPrice {
  currency: AiImageProviderCurrency;
  unitCostCents: number;
  requestedImageCount: number;
  maximumCostCents: number;
}

function invalid(message: string): never {
  throw new AiImageJobError('INVALID_FROZEN_JOB_PRICE', message);
}

/** Legacy totals are immutable USD quotes; neither active config nor Provider money is an input. */
export function getFrozenAiImageTaskPrice(job: FrozenTask): FrozenAiImageTaskPrice {
  const requestedImageCount = job.requestedImageCount;
  const maximumCostCents = job.estimatedCostCents;
  if (!Number.isSafeInteger(requestedImageCount) || requestedImageCount < 1
    || !Number.isSafeInteger(maximumCostCents) || maximumCostCents < 0) invalid('The confirmed task price is incomplete');
  const config = job.operationConfig;
  const nestedRuntime = Boolean(config && Object.hasOwn(config, 'providerRuntime'));
  const directRuntime = Boolean(config && Object.hasOwn(config, 'contractVersion'));
  const rawRuntime = nestedRuntime ? config!.providerRuntime : config;
  let currency: AiImageProviderCurrency = 'USD';
  let unitCostCents = job.provider === 'fake' ? 0 : maximumCostCents / requestedImageCount;
  if (config && Object.hasOwn(config, 'translationRuntime')) {
    if (nestedRuntime || directRuntime) invalid('The task has conflicting frozen runtime prices');
    let runtime;
    try { runtime = parseAiImageTranslationRuntime(config.translationRuntime); }
    catch { invalid('The task has an invalid frozen translation price'); }
    if (runtime.provider !== job.provider || runtime.model !== job.model
      || runtime.imageCount !== requestedImageCount || runtime.maximumCostCents !== maximumCostCents) {
      invalid('The translation task no longer matches its frozen price');
    }
    currency = runtime.currency;
    unitCostCents = runtime.unitCostCents;
  } else if (nestedRuntime || directRuntime) {
    let runtime;
    try { runtime = parseAiImageProviderRuntimeContract(rawRuntime); }
    catch { invalid('The task has an invalid frozen runtime price'); }
    if (runtime.provider !== job.provider || runtime.model !== job.model
      || runtime.imageCount !== requestedImageCount || runtime.width !== job.width || runtime.height !== job.height
      || runtime.maximumCostCents !== maximumCostCents) invalid('The task no longer matches its frozen price');
    currency = runtime.currency ?? 'USD';
    unitCostCents = job.provider === 'fake' ? 0 : runtime.unitCostCents;
  }
  if (job.costReservation?.currency !== undefined && job.costReservation.currency !== currency) {
    invalid('The reservation currency does not match the confirmed task currency');
  }
  if (!Number.isSafeInteger(unitCostCents) || unitCostCents < 0 || (job.provider !== 'fake' && unitCostCents < 1)) {
    invalid('The confirmed total cannot be resolved to an exact per-image price');
  }
  return { currency, unitCostCents, requestedImageCount, maximumCostCents: job.provider === 'fake' ? 0 : maximumCostCents };
}

export function calculateAiImageTaskCost(job: FrozenTask, successfulImageCount: number) {
  const price = getFrozenAiImageTaskPrice(job);
  if (!Number.isSafeInteger(successfulImageCount) || successfulImageCount < 0 || successfulImageCount > price.requestedImageCount) {
    throw new AiImageJobError('INVALID_GENERATED_IMAGE_COUNT', 'Successful images must fit the confirmed task count');
  }
  const actualCostCents = price.unitCostCents * successfulImageCount;
  if (!Number.isSafeInteger(actualCostCents) || actualCostCents > price.maximumCostCents) invalid('Task cost exceeds its confirmed maximum');
  return { currency: price.currency, unitCostCents: price.unitCostCents, actualCostCents, billedUnits: successfulImageCount };
}

/** Display historical prices without making an unreadable legacy quote hide the job. */
export function getPublicAiImageTaskPrice(job: FrozenTask): FrozenAiImageTaskPrice | null {
  try { return getFrozenAiImageTaskPrice(job); }
  catch { return null; }
}
