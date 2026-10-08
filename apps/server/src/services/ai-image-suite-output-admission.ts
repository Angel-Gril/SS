import { createHash } from 'node:crypto';
import { AI_IMAGE_DONOR_GPT2_COUNT_MODEL, AI_IMAGE_DONOR_GPT2_NORMALIZER_VERSION,
  validDonorGpt2SuiteConfig } from './ai-image-donor-gpt2-profile.js';
import { parseAiImageProviderRuntimeContract } from './ai-image-provider-runtime-contract.js';
import { AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION } from './ai-image-suite-output-normalizer.js';

export interface AiImageSuiteRawOutputAuthority {
  id: string;
  ownerUserId: string;
  aiImageJobId: string | null;
  kind: string;
  sourceCaptureSnapshotId: string | null;
  storageBackend: string;
  storageKey: string | null;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sha256: string | null;
  metadata: Record<string, unknown> | null;
}
const hashPattern = /^[a-f0-9]{64}$/u;
const countEndpointHash = createHash('sha256').update('https://ai.big-model-api.top/v1').digest('hex');
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 2_000 && value === value.trim()
    && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

/** Stored execution evidence, never caller metadata, admits the exact full-frame
 * count output. Old normalizer semantics remain confined to other models. */
export function admittedAiImageSuiteOutputNormalizer(input: {
  provider: unknown;
  model: unknown;
  operationConfig: unknown;
  providerJobId: unknown;
  actualCostCents: number | null;
  ownerUserId: string;
  jobId: string;
  sourceCaptureSnapshotId: string;
  outputSha256: string | null;
  metadata: Record<string, unknown>;
  rawOutput: AiImageSuiteRawOutputAuthority | null | undefined;
  allowLegacyUnversioned?: boolean;
}): string | null {
  const normalizer = input.metadata.normalizerVersion;
  if (input.model !== AI_IMAGE_DONOR_GPT2_COUNT_MODEL) {
    return normalizer === AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION
      || (input.allowLegacyUnversioned === true && normalizer === undefined)
      ? AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION : null;
  }
  if (input.provider !== 'custom' || normalizer !== AI_IMAGE_DONOR_GPT2_NORMALIZER_VERSION) return null;
  const config = record(input.operationConfig), raw = input.rawOutput, metadata = raw?.metadata;
  if (!config || config.version !== 'ai-image-suite-child-operation/v2'
    || config.outputProfile !== 'ozon-suite-3x4-900x1200/v1' || config.width !== 900 || config.height !== 1200
    || !text(config.slotPromptId) || !hashPattern.test(String(config.promptBindingHash || ''))
    || !hashPattern.test(String(config.referenceSetHash || '')) || !validDonorGpt2SuiteConfig(config)) return null;
  try {
    const runtime = parseAiImageProviderRuntimeContract(config.providerRuntime);
    if (runtime.contractVersion !== 'ai-image-provider-runtime/v3' || runtime.provider !== input.provider
      || runtime.model !== input.model || runtime.baseUrlSha256 !== countEndpointHash || runtime.currency !== 'CNY'
      || runtime.imageCount !== 1 || runtime.width !== 1008 || runtime.height !== 1344
      || runtime.maximumCostCents !== runtime.unitCostCents || runtime.unitCostCents !== input.actualCostCents) return null;
  } catch { return null; }
  if (!raw || !metadata || !text(raw.id) || raw.id !== input.metadata.providerOutputAssetId
    || raw.ownerUserId !== input.ownerUserId || raw.aiImageJobId !== input.jobId || raw.kind !== 'AI_PROVIDER_OUTPUT'
    || raw.sourceCaptureSnapshotId !== input.sourceCaptureSnapshotId || !['local', 'oss'].includes(raw.storageBackend)
    || !text(raw.storageKey) || /^https?:\/\//iu.test(raw.storageKey)
    || !['image/png', 'image/jpeg', 'image/webp'].includes(raw.mimeType)
    || !Number.isSafeInteger(raw.sizeBytes) || raw.sizeBytes < 1 || raw.sizeBytes > 20 * 1024 * 1024
    || raw.width !== 1008 || raw.height !== 1344 || !hashPattern.test(String(raw.sha256 || ''))
    || metadata.version !== 'ai-image-suite-provider-output/v1'
    || metadata.normalizerVersion !== AI_IMAGE_DONOR_GPT2_NORMALIZER_VERSION
    || metadata.sourceCaptureSnapshotId !== input.sourceCaptureSnapshotId
    || input.metadata.sourceCaptureSnapshotId !== input.sourceCaptureSnapshotId
    || metadata.normalizedSha256 !== input.outputSha256
    || !text(input.providerJobId) || metadata.providerJobId !== input.providerJobId
    || metadata.actualCostCents !== input.actualCostCents
    || typeof metadata.providerResultReceivedAt !== 'string'
    || !Number.isFinite(Date.parse(metadata.providerResultReceivedAt))) return null;
  return AI_IMAGE_DONOR_GPT2_NORMALIZER_VERSION;
}
