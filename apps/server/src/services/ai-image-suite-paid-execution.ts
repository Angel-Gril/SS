import { createHash } from 'node:crypto';
import {
  normalizeAiImageSuiteProviderOutput,
  type NormalizedAiImageSuiteProviderOutput,
} from './ai-image-suite-output-normalizer.js';
import {
  prepareAiImageSuitePaidProviderExecution,
  type PrepareAiImageSuitePaidProviderInput,
  type PreparedAiImageSuitePaidProviderExecution,
} from './ai-image-suite-paid-provider.js';
import type {
  AiImageSuiteDispatchAuthorization,
} from './ai-image-suite-dispatch-authorization.js';

export type AiImageSuitePaidExecutionErrorCode =
  | 'AI_MEDIA_SUITE_DISPATCH_REVOKED'
  | 'SUITE_PROVIDER_DISPATCH_FENCE_LOST'
  | 'SUITE_PROVIDER_RESULT_INVALID'
  | 'SUITE_PROVIDER_COST_INVALID'
  | 'SUITE_PROVIDER_STORAGE_INVALID';

export class AiImageSuitePaidExecutionError extends Error {
  constructor(
    public readonly code: AiImageSuitePaidExecutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AiImageSuitePaidExecutionError';
  }
}

export interface AiImageSuitePaidStoredAsset {
  url: string;
  storageBackend: 'local' | 'oss';
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  metadata: Record<string, unknown>;
}

export interface ExecuteAiImageSuitePaidProviderInput
  extends PrepareAiImageSuitePaidProviderInput {
  ownerUserId: string;
  jobId: string;
  maximumCostCents: number;
}

export interface ExecuteAiImageSuitePaidProviderDependencies<T> {
  prepareProvider?: (
    input: PrepareAiImageSuitePaidProviderInput,
  ) => Promise<PreparedAiImageSuitePaidProviderExecution>;
  normalizeOutput?: typeof normalizeAiImageSuiteProviderOutput;
  assertClaim: () => Promise<void>;
  revalidateDispatchAuthorization?: () => Promise<AiImageSuiteDispatchAuthorization>;
  markProviderDispatchStarted: (providerDispatchedAt: Date) => Promise<boolean>;
  recordProviderAccepted: (providerJobId: string, providerAcceptedAt: Date) => Promise<void>;
  recordProviderResultEvidence: (input: {
    providerJobId: string | null;
    actualCostCents: number;
    providerResultReceivedAt: Date;
  }) => Promise<void>;
  uploadBuffer: (
    buffer: Buffer,
    filename: string,
    mimeType?: string,
    options?: { category?: 'ai-generated'; ownerId?: string; idempotencyKey?: string },
  ) => Promise<{ url: string; backend: string; filename?: string; key?: string }>;
  recordProviderOutput: (asset: AiImageSuitePaidStoredAsset) => Promise<void>;
  complete: (input: {
    providerJobId: string | null;
    providerAcceptedAt: Date | null;
    providerResultReceivedWithoutIdentity: boolean;
    actualCostCents: number;
    output: AiImageSuitePaidStoredAsset;
  }) => Promise<T>;
  now?: () => Date;
}

function exactProviderJobId(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw new AiImageSuitePaidExecutionError(
      'SUITE_PROVIDER_RESULT_INVALID',
      'Provider request identity must be a string',
    );
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 500) {
    throw new AiImageSuitePaidExecutionError(
      'SUITE_PROVIDER_RESULT_INVALID',
      'Provider request identity is invalid',
    );
  }
  return normalized;
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function dispatchAuthorizationError(reason: unknown): Error {
  const message = typeof reason === 'string' && reason.trim()
    ? reason.trim().slice(0, 2_000)
    : 'AI image suite dispatch authorization was revoked before Provider dispatch';
  return Object.assign(
    new AiImageSuitePaidExecutionError('AI_MEDIA_SUITE_DISPATCH_REVOKED', message),
    { providerSubmissionRejected: true },
  );
}

function storedAsset(
  stored: { url: string; backend: string; filename?: string; key?: string },
  value: {
    mimeType: string;
    sizeBytes: number;
    width: number;
    height: number;
    sha256: string;
    metadata: Record<string, unknown>;
  },
): AiImageSuitePaidStoredAsset {
  const url = String(stored?.url || '').trim();
  const storageKey = String(stored?.key || stored?.filename || '').trim();
  if (!url
    || url.length > 4_096
    || !storageKey
    || storageKey.length > 2_000
    || !['local', 'oss'].includes(stored?.backend)) {
    throw new AiImageSuitePaidExecutionError(
      'SUITE_PROVIDER_STORAGE_INVALID',
      'AI image suite output was not persisted in trusted storage',
    );
  }
  return {
    url,
    storageBackend: stored.backend as 'local' | 'oss',
    storageKey,
    ...value,
  };
}

function withProviderEvidence(
  error: unknown,
  evidence: {
    providerJobId: string | null;
    providerAcceptedAt: Date | null;
    providerResultReceived: boolean;
    actualCostCents: number | null;
    providerResultReceivedAt: Date | null;
  },
): Error {
  const result = error instanceof Error ? error : new Error(String(error));
  return Object.assign(result, {
    ...(evidence.providerJobId ? { providerJobId: evidence.providerJobId } : {}),
    ...(evidence.providerAcceptedAt ? { providerAcceptedAt: evidence.providerAcceptedAt } : {}),
    ...(evidence.providerResultReceived ? { providerResultReceived: true } : {}),
    ...(evidence.actualCostCents !== null ? { actualCostCents: evidence.actualCostCents } : {}),
    ...(evidence.providerResultReceivedAt
      ? { providerResultReceivedAt: evidence.providerResultReceivedAt }
      : {}),
  });
}

async function persistOutputs(
  input: ExecuteAiImageSuitePaidProviderInput,
  raw: { buffer: Buffer; mimeType: string },
  normalized: NormalizedAiImageSuiteProviderOutput,
  providerEvidence: {
    providerJobId: string | null;
    actualCostCents: number;
    providerResultReceivedAt: Date;
  },
  dependencies: Pick<
    ExecuteAiImageSuitePaidProviderDependencies<unknown>,
    'assertClaim' | 'uploadBuffer' | 'recordProviderOutput'
  >,
) {
  const rawSha256 = createHash('sha256').update(raw.buffer).digest('hex');
  await dependencies.assertClaim();
  const rawStored = await dependencies.uploadBuffer(
    raw.buffer,
    `ai-suite-provider-${rawSha256.slice(0, 32)}.${extensionForMime(raw.mimeType)}`,
    raw.mimeType,
    {
      category: 'ai-generated',
      ownerId: input.ownerUserId,
      idempotencyKey: `${input.jobId}:provider-output:${rawSha256}`,
    },
  );
  await dependencies.assertClaim();
  const rawAsset = storedAsset(rawStored, {
    mimeType: raw.mimeType,
    sizeBytes: raw.buffer.length,
    width: 1024,
    height: 1536,
    sha256: rawSha256,
    metadata: {
      version: 'ai-image-suite-provider-output/v1',
      sourceCaptureSnapshotId: input.suite.sourceCaptureSnapshotId,
      providerJobId: providerEvidence.providerJobId,
      actualCostCents: providerEvidence.actualCostCents,
      providerResultReceivedAt: providerEvidence.providerResultReceivedAt.toISOString(),
      normalizerVersion: normalized.normalizerVersion,
      normalizedSha256: normalized.sha256,
    },
  });
  await dependencies.recordProviderOutput(rawAsset);

  await dependencies.assertClaim();
  const finalStored = await dependencies.uploadBuffer(
    normalized.buffer,
    `ai-suite-final-${normalized.sha256.slice(0, 32)}.png`,
    normalized.mimeType,
    {
      category: 'ai-generated',
      ownerId: input.ownerUserId,
      idempotencyKey: `${input.jobId}:final-output:${normalized.sha256}`,
    },
  );
  return storedAsset(finalStored, {
    mimeType: normalized.mimeType,
    sizeBytes: normalized.buffer.length,
    width: normalized.width,
    height: normalized.height,
    sha256: normalized.sha256,
    metadata: {
      version: 'ai-image-suite-output/v1',
      normalizerVersion: normalized.normalizerVersion,
      sourceCaptureSnapshotId: input.suite.sourceCaptureSnapshotId,
    },
  });
}

export async function executeAiImageSuitePaidProvider<T>(
  input: ExecuteAiImageSuitePaidProviderInput,
  dependencies: ExecuteAiImageSuitePaidProviderDependencies<T>,
): Promise<T> {
  const now = dependencies.now || (() => new Date());
  const prepared = await (
    dependencies.prepareProvider || prepareAiImageSuitePaidProviderExecution
  )({ suite: input.suite, job: input.job });
  await dependencies.assertClaim();

  let providerJobId: string | null = null;
  let providerAcceptedAt: Date | null = null;
  let providerResultReceived = false;
  let knownActualCostCents: number | null = null;
  let knownProviderResultReceivedAt: Date | null = null;
  const recordAccepted = async (rawId: string, acceptedAt: Date) => {
    const normalized = exactProviderJobId(rawId);
    if (!normalized) {
      throw new AiImageSuitePaidExecutionError(
        'SUITE_PROVIDER_RESULT_INVALID',
        'Provider request identity is missing',
      );
    }
    if (providerJobId && providerJobId !== normalized) {
      throw new AiImageSuitePaidExecutionError(
        'SUITE_PROVIDER_RESULT_INVALID',
        'Provider request identity changed during execution',
      );
    }
    providerJobId = normalized;
    providerAcceptedAt = acceptedAt instanceof Date && !Number.isNaN(acceptedAt.getTime())
      ? acceptedAt
      : now();
    await dependencies.recordProviderAccepted(providerJobId, providerAcceptedAt);
  };
  const beforeProviderDispatch = async () => {
    await dependencies.assertClaim();
    if (dependencies.revalidateDispatchAuthorization) {
      let authorization: AiImageSuiteDispatchAuthorization;
      try {
        authorization = await dependencies.revalidateDispatchAuthorization();
      } catch {
        throw dispatchAuthorizationError(
          'AI image suite dispatch authorization is unavailable before Provider dispatch',
        );
      }
      if (!authorization.enabled) throw dispatchAuthorizationError(authorization.reason);
    }
    const dispatchedAt = now();
    if (!await dependencies.markProviderDispatchStarted(dispatchedAt)) {
      throw new AiImageSuitePaidExecutionError(
        'SUITE_PROVIDER_DISPATCH_FENCE_LOST',
        'AI image suite execution claim was lost before Provider dispatch',
      );
    }
  };

  try {
    const result = await prepared.execute(recordAccepted, beforeProviderDispatch);
    providerResultReceived = true;
    const resultProviderJobId = exactProviderJobId(result.providerJobId);
    if (resultProviderJobId) {
      if (providerJobId && providerJobId !== resultProviderJobId) {
        throw new AiImageSuitePaidExecutionError(
          'SUITE_PROVIDER_RESULT_INVALID',
          'Provider response identity conflicts with its accepted request identity',
        );
      }
      if (!providerJobId) await recordAccepted(resultProviderJobId, now());
    }
    if (!Array.isArray(result.images) || result.images.length !== 1 || !result.images[0]) {
      throw new AiImageSuitePaidExecutionError(
        'SUITE_PROVIDER_RESULT_INVALID',
        'AI image suite Provider must return exactly one image',
      );
    }
    const actualCostCents = result.actualCostCents ?? input.job.estimatedCostCents;
    if (!Number.isSafeInteger(actualCostCents)
      || actualCostCents !== input.job.estimatedCostCents
      || actualCostCents > input.maximumCostCents) {
      throw new AiImageSuitePaidExecutionError(
        'SUITE_PROVIDER_COST_INVALID',
        'AI image suite Provider cost exceeds the frozen reservation',
      );
    }
    knownActualCostCents = actualCostCents;
    const providerResultReceivedAt = now();
    knownProviderResultReceivedAt = providerResultReceivedAt;
    await dependencies.recordProviderResultEvidence({
      providerJobId,
      actualCostCents,
      providerResultReceivedAt,
    });
    const raw = result.images[0];
    await dependencies.assertClaim();
    const normalized = await (
      dependencies.normalizeOutput || normalizeAiImageSuiteProviderOutput
    )({ buffer: raw.buffer, mimeType: raw.mimeType });
    const output = await persistOutputs(input, raw, normalized, {
      providerJobId,
      actualCostCents,
      providerResultReceivedAt,
    }, dependencies);
    await dependencies.assertClaim();
    return await dependencies.complete({
      providerJobId,
      providerAcceptedAt,
      providerResultReceivedWithoutIdentity: !providerJobId,
      actualCostCents,
      output,
    });
  } catch (error) {
    throw withProviderEvidence(error, {
      providerJobId,
      providerAcceptedAt,
      providerResultReceived,
      actualCostCents: knownActualCostCents,
      providerResultReceivedAt: knownProviderResultReceivedAt,
    });
  }
}
