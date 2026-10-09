import type { SourceListingImportedMediaAsset } from './source-listing-media-import.js';

export const SOURCE_CAPTURE_IMAGE_TRANSFER_VERSION = 'source-capture-image-transfer/v1';
export const SOURCE_CAPTURE_IMAGE_TRANSFER_MAX_ATTEMPTS = 3;
export const SOURCE_CAPTURE_IMAGE_TRANSFER_LEASE_MS = 30 * 60_000;
export const SOURCE_CAPTURE_IMAGE_TRANSFER_RETRY_MS = 60_000;

export function pendingSourceCaptureImageTransfer(snapshotId: string, captureHash: string) {
  return { version: SOURCE_CAPTURE_IMAGE_TRANSFER_VERSION, snapshotId, captureHash,
    status: 'PENDING', attempts: 0, offset: 0 };
}

export interface SourceCaptureImageTransferClaim {
  supplyGoodsId: string;
  ownerUserId: string;
  snapshotId: string;
  captureHash: string;
  leaseId: string;
  attempts: number;
  offset?: number;
}

export interface SourceCaptureImageTransferResult {
  assets: SourceListingImportedMediaAsset[];
  errors: Array<{ sourceMediaKey: string; code: string }>;
  nextOffset?: number;
  total?: number;
}

export interface SourceCaptureImageTransferStore {
  claim(input: { now: Date; leaseId: string; leaseExpiresAt: Date }): Promise<SourceCaptureImageTransferClaim | null>;
  finish(input: { claim: SourceCaptureImageTransferClaim; result: SourceCaptureImageTransferResult;
    now: Date; nextAttemptAt: Date }): Promise<boolean>;
}

export async function runSourceCaptureImageTransfer(input: {
  store: SourceCaptureImageTransferStore;
  internalizeCapture: (capture: { ownerUserId: string; snapshotId: string; captureHash: string; offset?: number }) => Promise<SourceCaptureImageTransferResult>;
  now: () => Date;
  createLeaseId: () => string;
}) {
  const now = input.now();
  const claim = await input.store.claim({ now, leaseId: input.createLeaseId(),
    leaseExpiresAt: new Date(now.getTime() + SOURCE_CAPTURE_IMAGE_TRANSFER_LEASE_MS) });
  if (!claim) return { claimed: false, applied: false };
  let result: SourceCaptureImageTransferResult;
  try {
    if (claim.attempts > SOURCE_CAPTURE_IMAGE_TRANSFER_MAX_ATTEMPTS) throw new Error('attempts exhausted');
    result = await input.internalizeCapture(claim);
  } catch {
    // Persist a bounded error code, never URLs, SDK error text, secrets, or remote response bodies.
    result = { assets: [], errors: [{ sourceMediaKey: '', code: 'SOURCE_IMAGE_TRANSFER_FAILED' }] };
  }
  const finishedAt = input.now();
  const applied = await input.store.finish({ claim, result, now: finishedAt,
    nextAttemptAt: new Date(finishedAt.getTime() + SOURCE_CAPTURE_IMAGE_TRANSFER_RETRY_MS) });
  return { claimed: true, applied, transferred: result.assets.length, failed: result.errors.length };
}
