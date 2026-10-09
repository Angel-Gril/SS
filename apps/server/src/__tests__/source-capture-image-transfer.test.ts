import { describe, expect, it, vi } from 'vitest';
import {
  SOURCE_CAPTURE_IMAGE_TRANSFER_MAX_ATTEMPTS,
  runSourceCaptureImageTransfer,
} from '../services/source-capture-image-transfer.js';

const claim = { supplyGoodsId: 'goods-1', ownerUserId: 'owner-1', snapshotId: 'snapshot-1',
  captureHash: 'a'.repeat(64), leaseId: 'lease-1', attempts: 1 };

function store(overrides: Record<string, unknown> = {}) {
  return {
    claim: vi.fn(async () => claim),
    finish: vi.fn(async () => true),
    ...overrides,
  } as any;
}

describe('source capture image transfer runner', () => {
  it('claims one exact snapshot, records successful assets, and never exposes source error text', async () => {
    const persistence = store();
    const internalizeCapture = vi.fn(async () => ({
      assets: [{ id: 'asset-1', ownerUserId: 'owner-1', sourceCaptureSnapshotId: 'snapshot-1',
        sourceMediaKey: 'media-1', sourceUrl: 'https://img.example/source.jpg', url: 'https://cdn.example/source.jpg',
        storageBackend: 'oss', storageKey: 'raw/source.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }],
      errors: [],
    }));
    const result = await runSourceCaptureImageTransfer({ store: persistence, internalizeCapture,
      now: () => new Date('2026-10-10T00:00:00.000Z'), createLeaseId: () => 'lease-1' });
    expect(internalizeCapture).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', snapshotId: 'snapshot-1', captureHash: 'a'.repeat(64),
    }));
    expect(persistence.finish).toHaveBeenCalledWith(expect.objectContaining({
      claim, result: expect.objectContaining({ assets: expect.any(Array), errors: [] }),
    }));
    expect(result).toMatchObject({ claimed: true, applied: true, transferred: 1, failed: 0 });
  });

  it('turns a transfer failure into a bounded retry result without returning the remote error', async () => {
    const persistence = store();
    const internalizeCapture = vi.fn(async () => { throw new Error('secret provider body and token'); });
    const result = await runSourceCaptureImageTransfer({ store: persistence, internalizeCapture,
      now: () => new Date('2026-10-10T00:00:00.000Z'), createLeaseId: () => 'lease-1' });
    expect(result).toMatchObject({ claimed: true, applied: true, transferred: 0, failed: 1 });
    expect(JSON.stringify(persistence.finish.mock.calls[0]?.[0])).not.toContain('secret provider');
    expect(persistence.finish.mock.calls[0]?.[0].result).toEqual({ assets: [],
      errors: [{ sourceMediaKey: '', code: 'SOURCE_IMAGE_TRANSFER_FAILED' }] });
  });

  it('does not claim work when the store has no eligible pending snapshot', async () => {
    const persistence = store({ claim: vi.fn(async () => null) });
    const internalizeCapture = vi.fn();
    await expect(runSourceCaptureImageTransfer({ store: persistence, internalizeCapture,
      now: () => new Date(), createLeaseId: () => 'lease-1' })).resolves.toEqual({ claimed: false, applied: false });
    expect(internalizeCapture).not.toHaveBeenCalled();
  });

  it('keeps attempts bounded at the store-owned terminal threshold', async () => {
    const persistence = store({ claim: vi.fn(async () => ({ ...claim, attempts: SOURCE_CAPTURE_IMAGE_TRANSFER_MAX_ATTEMPTS })) });
    const internalizeCapture = vi.fn(async () => { throw new Error('untrusted'); });
    await runSourceCaptureImageTransfer({ store: persistence, internalizeCapture,
      now: () => new Date(), createLeaseId: () => 'lease-1' });
    expect(persistence.finish.mock.calls[0]?.[0].result.errors[0]).toEqual({
      sourceMediaKey: '', code: 'SOURCE_IMAGE_TRANSFER_FAILED',
    });
  });
});
