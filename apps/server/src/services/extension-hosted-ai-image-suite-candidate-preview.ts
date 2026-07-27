import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { loadAiImageEditInputBuffer } from './ai-image-edit-input-reader.js';
import {
  AI_IMAGE_SUITE_OUTPUT_HEIGHT,
  AI_IMAGE_SUITE_OUTPUT_WIDTH,
} from './ai-image-suite-materialization.js';
import { AI_IMAGE_SUITE_OUTPUT_NORMALIZER_MAX_INPUT_BYTES } from './ai-image-suite-output-normalizer.js';

export const EXTENSION_HOSTED_AI_IMAGE_SUITE_CANDIDATE_PREVIEW_VERSION =
  'extension-hosted-ai-image-suite-candidate-preview/v1' as const;
export const EXTENSION_HOSTED_AI_IMAGE_SUITE_CANDIDATE_PREVIEW_TTL_MS = 30_000;

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_TOKEN_RECORDS = 2_048;

export interface ExtensionHostedCandidatePreviewDevice {
  deploymentId: string;
  sessionId: string;
  deviceId: string;
  ownerUserId: string;
  actorUserId: string;
}

export interface ExtensionHostedCandidatePreviewBinding {
  snapshotId: string;
  supplyGoodsId: string;
  shopId: string;
  listingWorkflowId: string;
  draftRevision: number;
  draftVersion: number;
  planId: string;
  planVersionId: string;
  planRevision: number;
  suiteId: string;
  suiteRevision: number;
  slotId: string;
  slotRevision: number;
  workflowId: string;
  workflowRevision: number;
  outputAssetId: string;
}

export interface ExtensionHostedCandidatePreviewAuthority {
  ownerUserId: string;
  binding: ExtensionHostedCandidatePreviewBinding;
  plan: {
    id: string;
    versionId: string;
    revision: number;
    reviewStatus: string;
    staleAt: Date | null;
    currentVersionId: string;
    approvedVersionId: string;
  };
  suite: {
    id: string;
    revision: number;
    status: string;
    planId: string;
    planVersionId: string;
    sourceCaptureSnapshotId: string;
    contextType: string;
    contextId: string;
  };
  slot: {
    id: string;
    revision: number;
    status: string;
    suiteId: string;
    attempt: number;
    childWorkflowId: string;
  };
  workflow: {
    id: string;
    revision: number;
    status: string;
    reviewStatus: string;
    currentAttempt: number;
    contextType: string;
    contextId: string;
    selectedOutputAssetId: string | null;
  };
  job: {
    id: string;
    workflowId: string;
    workflowAttempt: number;
    executionMode: string;
    status: string;
    actualCostCents: number | null;
    billedUnits: number;
    costReservationStatus: string | null;
  };
  output: {
    id: string;
    ownerUserId: string;
    aiImageJobId: string;
    kind: string;
    sourceCaptureSnapshotId: string;
    storageBackend: string;
    storageKey: string | null;
    mimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    sha256: string | null;
    metadata: unknown;
  };
}

export interface ExtensionHostedCandidatePreviewValidatedCandidate {
  assetId: string;
  jobId: string;
  storageBackend: 'local' | 'oss';
  storageKey: string;
  mimeType: 'image/png';
  sizeBytes: number;
  width: typeof AI_IMAGE_SUITE_OUTPUT_WIDTH;
  height: typeof AI_IMAGE_SUITE_OUTPUT_HEIGHT;
  sha256: string;
  fingerprint: string;
}

export interface ExtensionHostedCandidatePreviewTokenRecord {
  digest: string;
  device: ExtensionHostedCandidatePreviewDevice;
  binding: ExtensionHostedCandidatePreviewBinding;
  candidateFingerprint: string;
  expiresAt: Date;
}

export interface ExtensionHostedCandidatePreviewTokenStore {
  putIfAbsent(record: ExtensionHostedCandidatePreviewTokenRecord, now: Date): Promise<boolean>;
  take(
    digest: string,
    now: Date,
  ): Promise<ExtensionHostedCandidatePreviewTokenRecord | null>;
}

export type ExtensionHostedCandidatePreviewErrorCode =
  | 'HOSTED_CANDIDATE_PREVIEW_INVALID_REQUEST'
  | 'HOSTED_CANDIDATE_PREVIEW_NOT_AVAILABLE'
  | 'HOSTED_CANDIDATE_PREVIEW_TOKEN_INVALID'
  | 'HOSTED_CANDIDATE_PREVIEW_STORAGE_UNAVAILABLE'
  | 'HOSTED_CANDIDATE_PREVIEW_SERVICE_UNAVAILABLE';

export class ExtensionHostedCandidatePreviewError extends Error {
  constructor(
    public readonly code: ExtensionHostedCandidatePreviewErrorCode,
    public readonly statusCode: 400 | 409 | 410 | 503,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionHostedCandidatePreviewError';
  }
}

export class InMemoryExtensionHostedCandidatePreviewTokenStore
implements ExtensionHostedCandidatePreviewTokenStore {
  private readonly records = new Map<string, ExtensionHostedCandidatePreviewTokenRecord>();

  constructor(private readonly maximumRecords = MAX_TOKEN_RECORDS) {
    if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 1) {
      throw new Error('Hosted candidate preview token capacity must be a positive integer');
    }
  }

  async putIfAbsent(
    record: ExtensionHostedCandidatePreviewTokenRecord,
    now: Date,
  ): Promise<boolean> {
    for (const [digest, candidate] of this.records) {
      if (candidate.expiresAt.getTime() <= now.getTime()) this.records.delete(digest);
    }
    if (this.records.has(record.digest) || this.records.size >= this.maximumRecords) return false;
    this.records.set(record.digest, record);
    return true;
  }

  async take(
    digest: string,
    now: Date,
  ): Promise<ExtensionHostedCandidatePreviewTokenRecord | null> {
    const record = this.records.get(digest) || null;
    if (record) this.records.delete(digest);
    if (!record || record.expiresAt.getTime() <= now.getTime()) return null;
    return record;
  }
}

function invalidRequest(message: string): never {
  throw new ExtensionHostedCandidatePreviewError(
    'HOSTED_CANDIDATE_PREVIEW_INVALID_REQUEST',
    400,
    message,
  );
}

function notAvailable(): never {
  throw new ExtensionHostedCandidatePreviewError(
    'HOSTED_CANDIDATE_PREVIEW_NOT_AVAILABLE',
    409,
    'The current ERP-hosted candidate is not available for preview',
  );
}

function exactIdentifier(value: unknown, label: string, maximum = 200): string {
  if (typeof value !== 'string'
    || !value
    || value !== value.trim()
    || value !== value.normalize('NFKC')
    || value.length > maximum) invalidRequest(`${label} is invalid`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalidRequest(`${label} is invalid`);
  return Number(value);
}

function normalizeDevice(value: ExtensionHostedCandidatePreviewDevice) {
  const ownerUserId = exactIdentifier(value.ownerUserId, 'ownerUserId');
  const actorUserId = exactIdentifier(value.actorUserId, 'actorUserId');
  if (actorUserId !== ownerUserId) invalidRequest('actorUserId is invalid');
  return {
    deploymentId: exactIdentifier(value.deploymentId, 'deploymentId'),
    sessionId: exactIdentifier(value.sessionId, 'sessionId'),
    deviceId: exactIdentifier(value.deviceId, 'deviceId'),
    ownerUserId,
    actorUserId,
  };
}

function normalizeBinding(value: ExtensionHostedCandidatePreviewBinding) {
  return {
    snapshotId: exactIdentifier(value.snapshotId, 'snapshotId'),
    supplyGoodsId: exactIdentifier(value.supplyGoodsId, 'supplyGoodsId'),
    shopId: exactIdentifier(value.shopId, 'shopId'),
    listingWorkflowId: exactIdentifier(value.listingWorkflowId, 'listingWorkflowId'),
    draftRevision: positiveInteger(value.draftRevision, 'draftRevision'),
    draftVersion: positiveInteger(value.draftVersion, 'draftVersion'),
    planId: exactIdentifier(value.planId, 'planId'),
    planVersionId: exactIdentifier(value.planVersionId, 'planVersionId'),
    planRevision: positiveInteger(value.planRevision, 'planRevision'),
    suiteId: exactIdentifier(value.suiteId, 'suiteId'),
    suiteRevision: positiveInteger(value.suiteRevision, 'suiteRevision'),
    slotId: exactIdentifier(value.slotId, 'slotId'),
    slotRevision: positiveInteger(value.slotRevision, 'slotRevision'),
    workflowId: exactIdentifier(value.workflowId, 'workflowId'),
    workflowRevision: positiveInteger(value.workflowRevision, 'workflowRevision'),
    outputAssetId: exactIdentifier(value.outputAssetId, 'outputAssetId'),
  };
}

function valuesMatch(left: object, right: object): boolean {
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return keys.length === Object.keys(rightRecord).length
    && keys.every((key) => leftRecord[key] === rightRecord[key]);
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validateCandidate(
  candidate: ExtensionHostedCandidatePreviewAuthority | null,
  ownerUserId: string,
  binding: ExtensionHostedCandidatePreviewBinding,
): ExtensionHostedCandidatePreviewValidatedCandidate {
  if (!candidate || candidate.ownerUserId !== ownerUserId
    || !valuesMatch(candidate.binding, binding)) notAvailable();
  const { plan, suite, slot, workflow, job, output } = candidate;
  const metadata = metadataRecord(output.metadata);
  const candidateValid = plan.id === binding.planId
    && plan.versionId === binding.planVersionId
    && plan.revision === binding.planRevision
    && plan.reviewStatus === 'APPROVED'
    && plan.staleAt === null
    && plan.currentVersionId === binding.planVersionId
    && plan.approvedVersionId === binding.planVersionId
    && suite.id === binding.suiteId
    && suite.revision === binding.suiteRevision
    && ['SUCCEEDED', 'PARTIAL_FAILURE'].includes(suite.status)
    && suite.planId === binding.planId
    && suite.planVersionId === binding.planVersionId
    && suite.sourceCaptureSnapshotId === binding.snapshotId
    && suite.contextType === 'collect'
    && suite.contextId === binding.supplyGoodsId
    && slot.id === binding.slotId
    && slot.revision === binding.slotRevision
    && slot.status === 'SUCCEEDED'
    && slot.suiteId === binding.suiteId
    && Number.isSafeInteger(slot.attempt)
    && slot.attempt > 0
    && slot.childWorkflowId === binding.workflowId
    && workflow.id === binding.workflowId
    && workflow.revision === binding.workflowRevision
    && workflow.status === 'SUCCEEDED'
    && ['PENDING', 'APPROVED'].includes(workflow.reviewStatus)
    && workflow.currentAttempt === slot.attempt
    && workflow.contextType === 'collect'
    && workflow.contextId === binding.supplyGoodsId
    && (workflow.reviewStatus !== 'APPROVED'
      || workflow.selectedOutputAssetId === binding.outputAssetId)
    && job.workflowId === binding.workflowId
    && job.workflowAttempt === workflow.currentAttempt
    && job.executionMode === 'ERP_HOSTED'
    && job.status === 'SUCCEEDED'
    && Number.isSafeInteger(job.actualCostCents)
    && Number(job.actualCostCents) >= 0
    && job.billedUnits === 1
    && job.costReservationStatus === 'SETTLED'
    && output.id === binding.outputAssetId
    && output.ownerUserId === ownerUserId
    && output.aiImageJobId === job.id
    && output.kind === 'AI_GENERATED'
    && output.sourceCaptureSnapshotId === binding.snapshotId
    && ['local', 'oss'].includes(output.storageBackend)
    && typeof output.storageKey === 'string'
    && output.storageKey.length > 0
    && output.storageKey.length <= 2_000
    && output.storageKey === output.storageKey.trim()
    && output.storageKey === output.storageKey.normalize('NFKC')
    && !output.storageKey.includes('\0')
    && output.mimeType === 'image/png'
    && Number.isSafeInteger(output.sizeBytes)
    && output.sizeBytes > 0
    && output.sizeBytes <= AI_IMAGE_SUITE_OUTPUT_NORMALIZER_MAX_INPUT_BYTES
    && output.width === AI_IMAGE_SUITE_OUTPUT_WIDTH
    && output.height === AI_IMAGE_SUITE_OUTPUT_HEIGHT
    && typeof output.sha256 === 'string'
    && SHA256_PATTERN.test(output.sha256)
    && metadata?.version === 'ai-image-suite-output/v1'
    && metadata.suiteId === binding.suiteId
    && metadata.slotId === binding.slotId
    && metadata.attempt === slot.attempt;
  if (!candidateValid
    || typeof output.storageKey !== 'string'
    || typeof output.sha256 !== 'string') notAvailable();
  const identity = {
    binding,
    jobId: job.id,
    attempt: slot.attempt,
    storageBackend: output.storageBackend,
    storageKey: output.storageKey,
    mimeType: output.mimeType,
    sizeBytes: output.sizeBytes,
    width: output.width,
    height: output.height,
    sha256: output.sha256,
  };
  return {
    assetId: output.id,
    jobId: job.id,
    storageBackend: output.storageBackend as 'local' | 'oss',
    storageKey: output.storageKey,
    mimeType: 'image/png',
    sizeBytes: output.sizeBytes,
    width: AI_IMAGE_SUITE_OUTPUT_WIDTH,
    height: AI_IMAGE_SUITE_OUTPUT_HEIGHT,
    sha256: output.sha256,
    fingerprint: createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
  };
}

function sameDevice(
  left: ExtensionHostedCandidatePreviewDevice,
  right: ExtensionHostedCandidatePreviewDevice,
): boolean {
  return valuesMatch(left, right);
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function defaultLoadStoredBytes(
  candidate: ExtensionHostedCandidatePreviewValidatedCandidate,
): Promise<Buffer> {
  return loadAiImageEditInputBuffer({
    storageBackend: candidate.storageBackend,
    storageKey: candidate.storageKey,
    sizeBytes: candidate.sizeBytes,
  } as never);
}

async function verifyCandidateBytes(
  bytes: Buffer,
  candidate: ExtensionHostedCandidatePreviewValidatedCandidate,
) {
  if (!Buffer.isBuffer(bytes)
    || bytes.length !== candidate.sizeBytes
    || bytes.length < 8
    || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    || createHash('sha256').update(bytes).digest('hex') !== candidate.sha256) notAvailable();
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(bytes, {
      animated: false,
      failOn: 'warning',
      limitInputPixels: AI_IMAGE_SUITE_OUTPUT_WIDTH * AI_IMAGE_SUITE_OUTPUT_HEIGHT,
    }).metadata();
  } catch {
    notAvailable();
  }
  if (metadata.format !== 'png'
    || metadata.width !== candidate.width
    || metadata.height !== candidate.height
    || Number(metadata.pages ?? 1) !== 1) notAvailable();
}

export function createExtensionHostedCandidatePreviewService(options: {
  loadCurrentCandidate(input: {
    ownerUserId: string;
    deviceSessionId: string;
    binding: ExtensionHostedCandidatePreviewBinding;
  }): Promise<ExtensionHostedCandidatePreviewAuthority | null>;
  tokenStore?: ExtensionHostedCandidatePreviewTokenStore;
  loadStoredBytes?: (
    candidate: Readonly<ExtensionHostedCandidatePreviewValidatedCandidate>,
  ) => Promise<Buffer>;
  now?: () => Date;
  createToken?: () => string;
}) {
  const tokenStore = options.tokenStore || new InMemoryExtensionHostedCandidatePreviewTokenStore();
  const now = options.now || (() => new Date());
  const createToken = options.createToken || (() => randomBytes(TOKEN_BYTES).toString('base64url'));
  function clockNow(): Date {
    const value = now();
    const timestamp = value instanceof Date ? value.getTime() : Number.NaN;
    if (!Number.isFinite(timestamp)) {
      throw new ExtensionHostedCandidatePreviewError(
        'HOSTED_CANDIDATE_PREVIEW_SERVICE_UNAVAILABLE',
        503,
        'Hosted candidate preview clock is temporarily unavailable',
      );
    }
    return new Date(timestamp);
  }

  async function loadValidated(
    device: ExtensionHostedCandidatePreviewDevice,
    binding: ExtensionHostedCandidatePreviewBinding,
  ) {
    let authority: ExtensionHostedCandidatePreviewAuthority | null;
    try {
      authority = await options.loadCurrentCandidate({
        ownerUserId: device.ownerUserId,
        deviceSessionId: device.sessionId,
        binding,
      });
    } catch {
      throw new ExtensionHostedCandidatePreviewError(
        'HOSTED_CANDIDATE_PREVIEW_SERVICE_UNAVAILABLE',
        503,
        'Hosted candidate preview authority is temporarily unavailable',
      );
    }
    return validateCandidate(authority, device.ownerUserId, binding);
  }

  return {
    async issue(input: {
      device: ExtensionHostedCandidatePreviewDevice;
      binding: ExtensionHostedCandidatePreviewBinding;
    }) {
      const device = normalizeDevice(input.device);
      const binding = normalizeBinding(input.binding);
      const candidate = await loadValidated(device, binding);
      const issuedAt = clockNow();
      const expiresAt = new Date(
        issuedAt.getTime() + EXTENSION_HOSTED_AI_IMAGE_SUITE_CANDIDATE_PREVIEW_TTL_MS,
      );
      if (!Number.isFinite(expiresAt.getTime())) {
        throw new ExtensionHostedCandidatePreviewError(
          'HOSTED_CANDIDATE_PREVIEW_SERVICE_UNAVAILABLE',
          503,
          'Hosted candidate preview clock is temporarily unavailable',
        );
      }
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const token = createToken();
        if (!TOKEN_PATTERN.test(token)) throw new Error('Hosted candidate preview token generator is invalid');
        const record: ExtensionHostedCandidatePreviewTokenRecord = {
          digest: tokenDigest(token),
          device: { ...device },
          binding: { ...binding },
          candidateFingerprint: candidate.fingerprint,
          expiresAt,
        };
        if (await tokenStore.putIfAbsent(record, issuedAt)) {
          return {
            contractVersion: EXTENSION_HOSTED_AI_IMAGE_SUITE_CANDIDATE_PREVIEW_VERSION,
            token,
            expiresAt: expiresAt.toISOString(),
            output: {
              assetId: candidate.assetId,
              mimeType: candidate.mimeType,
              width: candidate.width,
              height: candidate.height,
              previewAvailable: true as const,
            },
          };
        }
      }
      throw new ExtensionHostedCandidatePreviewError(
        'HOSTED_CANDIDATE_PREVIEW_SERVICE_UNAVAILABLE',
        503,
        'Hosted candidate preview token capacity is temporarily unavailable',
      );
    },

    async consume(input: {
      device: ExtensionHostedCandidatePreviewDevice;
      binding: ExtensionHostedCandidatePreviewBinding;
      token: string;
    }) {
      const device = normalizeDevice(input.device);
      const binding = normalizeBinding(input.binding);
      if (!TOKEN_PATTERN.test(input.token)) invalidRequest('preview token is invalid');
      const consumedAt = clockNow();
      const digest = tokenDigest(input.token);
      const record = await tokenStore.take(digest, consumedAt);
      if (!record
        || record.digest !== digest
        || !(record.expiresAt instanceof Date)
        || !Number.isFinite(record.expiresAt.getTime())
        || record.expiresAt.getTime() <= consumedAt.getTime()
        || !SHA256_PATTERN.test(record.candidateFingerprint)
        || !sameDevice(record.device, device)
        || !valuesMatch(record.binding, binding)) {
        throw new ExtensionHostedCandidatePreviewError(
          'HOSTED_CANDIDATE_PREVIEW_TOKEN_INVALID',
          410,
          'Hosted candidate preview token is invalid or expired',
        );
      }
      const candidate = await loadValidated(device, binding);
      if (candidate.fingerprint !== record.candidateFingerprint) notAvailable();
      let bytes: Buffer;
      try {
        bytes = await (options.loadStoredBytes || defaultLoadStoredBytes)(candidate);
      } catch (error) {
        if (error instanceof ExtensionHostedCandidatePreviewError) throw error;
        throw new ExtensionHostedCandidatePreviewError(
          'HOSTED_CANDIDATE_PREVIEW_STORAGE_UNAVAILABLE',
          503,
          'Hosted candidate preview bytes are temporarily unavailable',
        );
      }
      await verifyCandidateBytes(bytes, candidate);
      return {
        contractVersion: EXTENSION_HOSTED_AI_IMAGE_SUITE_CANDIDATE_PREVIEW_VERSION,
        bytes,
        output: {
          assetId: candidate.assetId,
          mimeType: candidate.mimeType,
          width: candidate.width,
          height: candidate.height,
          previewAvailable: true as const,
        },
      };
    },
  };
}

export type ExtensionHostedCandidatePreviewService = ReturnType<
  typeof createExtensionHostedCandidatePreviewService
>;
