import { canonicalTimestamp, exactKeys, isRecord, isSha256, requireThat, sha256, sortedJson } from './qa04-final-evidence.mjs';

// This is an additional exact observed release profile, never a generic custom
// Provider/price waiver. Historical schema 1/2/3 remains Wanx/CNY14-only.
export const COUNT_SUITE_PROFILE = 'BIG_MODEL_GPT_IMAGE_2_COUNT_SUITE_CNY10_V1';
const CODE = 'QA04_SUITE_INVALID';
const check = condition => requireThat(condition, CODE);
const equal = (left, right) => sortedJson(left) === sortedJson(right);
const positive = value => Number.isSafeInteger(value) && value > 0;
const boundedText = value => typeof value === 'string' && value.length > 0 && value.length <= 500;
const time = value => canonicalTimestamp(value, CODE);
const NORMALIZER = 'ai-image-donor-gpt2-output-normalizer/v1';
const FINAL_OUTPUT = Object.freeze({ profile: 'ozon-suite-3x4-900x1200/v1', width: 900, height: 1200,
  fit: 'full-frame', background: '#ffffff', format: 'png', normalizerVersion: NORMALIZER });
const PRICING_VERSION = 'ai-image-suite-price-cny/v1:' + sha256(sortedJson({ version: 'ai-image-suite-price-cny/v1',
  provider: 'custom', model: 'gpt-image-2-count', unitCostCents: 10, currency: 'CNY' })).slice(0, 32);

export function verifiedCountSuiteOutputSize(width, height, observedPortrait = false) {
  return (width === 1008 && height === 1344) || (observedPortrait && width === 1086 && height === 1448);
}

export function verifyCountSuiteRecord(row, database, { rawImages, binding, suiteId, slot, quote, observedPortrait = false }) {
  const config = row.job.operationConfig;
  exactKeys(config, ['version', 'outputProfile', 'width', 'height', 'slotPromptId', 'promptBindingHash', 'referenceSetHash',
    'providerRuntime', 'providerRequest', 'requestProfile', 'finalOutput'], CODE);
  check(config.version === 'ai-image-suite-child-operation/v2' && config.outputProfile === FINAL_OUTPUT.profile
    && config.width === 900 && config.height === 1200 && boundedText(config.slotPromptId)
    && isSha256(config.promptBindingHash) && isSha256(config.referenceSetHash)
    && config.requestProfile === 'DONOR_GPT_IMAGE_2_PORTRAIT_EDIT_V1'
    && equal(config.providerRequest, { count: 1, width: 1008, height: 1344, quality: 'high' })
    && equal(config.finalOutput, FINAL_OUTPUT));
  const runtime = config.providerRuntime;
  exactKeys(runtime, ['contractVersion', 'provider', 'model', 'baseUrlSha256', 'unitCostCents', 'imageCount', 'width', 'height',
    'maximumCostCents', 'currency', 'credentialRevision'], CODE);
  check(runtime.contractVersion === 'ai-image-provider-runtime/v3' && runtime.provider === 'custom'
    && runtime.model === 'gpt-image-2-count' && runtime.baseUrlSha256 === sha256('https://ai.big-model-api.top/v1')
    && runtime.currency === 'CNY' && runtime.unitCostCents === 10 && runtime.maximumCostCents === 10
    && runtime.imageCount === 1 && runtime.width === 1008 && runtime.height === 1344);
  const credential = runtime.credentialRevision;
  exactKeys(credential, ['recordId', 'revision', 'updatedAt'], CODE);
  check(typeof credential.recordId === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(credential.recordId)
    && Number.isSafeInteger(credential.revision) && credential.revision >= 0
    && time(credential.updatedAt) <= time(row.job.startedAt));
  const suite = database.suiteRuntime;
  exactKeys(suite, ['provider', 'model', 'providerConfigHash', 'pricingVersion', 'estimatedCostPerImageCents',
    'maximumCostPerImageCents', 'concurrencyLimit', 'itemCount', 'estimatedCostCents', 'maximumCostCents'], CODE);
  check(suite.provider === runtime.provider && suite.model === runtime.model && suite.pricingVersion === PRICING_VERSION
    && quote.pricingVersion === PRICING_VERSION && suite.itemCount === 2 && suite.estimatedCostCents === 20
    && suite.maximumCostCents === 20 && suite.estimatedCostPerImageCents === 10 && suite.maximumCostPerImageCents === 10
    && positive(suite.concurrencyLimit) && suite.concurrencyLimit <= 16
    && suite.providerConfigHash === sha256(sortedJson({ version: 'ai-image-suite-provider-runtime/v1',
      providerRuntime: runtime, finalOutput: FINAL_OUTPUT, concurrencyLimit: suite.concurrencyLimit })));
  const raw = row.rawOutput, output = row.outputs[0], image = rawImages.find(value => value.sha256 === raw?.sha256);
  check(isRecord(raw) && image && boundedText(raw.id) && raw.idSha256 === sha256(raw.id)
    && raw.id !== output.id && raw.jobIdSha256 === row.job.idSha256 && raw.kind === 'AI_PROVIDER_OUTPUT'
    && raw.ownerSha256 === binding.ownerSha256 && output.ownerSha256 === binding.ownerSha256
    && row.workflow.inputAssets[0].ownerSha256 === binding.ownerSha256
    && verifiedCountSuiteOutputSize(raw.width, raw.height, observedPortrait) && raw.width === image.width && raw.height === image.height
    && raw.mimeType === image.mimeType && raw.sizeBytes === image.bytes && raw.storageBackend === 'oss');
  const metadata = raw.metadata;
  exactKeys(metadata, ['version', 'sourceCaptureSnapshotId', 'providerJobId', 'actualCostCents',
    'providerResultReceivedAt', 'normalizerVersion', 'normalizedSha256'], CODE);
  check(metadata.version === 'ai-image-suite-provider-output/v1' && metadata.sourceCaptureSnapshotId === binding.snapshotId
    && boundedText(metadata.providerJobId) && sha256(metadata.providerJobId) === row.job.providerJobIdSha256
    && metadata.actualCostCents === 10 && metadata.normalizerVersion === NORMALIZER && metadata.normalizedSha256 === output.sha256
    && time(metadata.providerResultReceivedAt) >= time(row.job.startedAt)
    && time(metadata.providerResultReceivedAt) <= time(row.job.completedAt));
  const final = output.metadata;
  exactKeys(final, ['version', 'normalizerVersion', 'sourceCaptureSnapshotId', 'suiteId', 'slotId', 'attempt', 'providerOutputAssetId'], CODE);
  check(final.version === 'ai-image-suite-output/v1' && final.normalizerVersion === NORMALIZER
    && final.sourceCaptureSnapshotId === binding.snapshotId && final.suiteId === suiteId && final.slotId === slot.id
    && final.attempt === 1 && final.providerOutputAssetId === raw.id);
  return { runtime, referenceSetHash: config.referenceSetHash, slotPromptId: config.slotPromptId, raw };
}
