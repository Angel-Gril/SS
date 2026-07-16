import { readFileSync } from 'node:fs';
import type { SourceProductCaptureV2Submission } from 'shared';
import { describe, expect, it, vi } from 'vitest';
import { createPrismaSourceListingMediaImportStore } from '../services/source-listing-media-import-prisma.js';

const fixture = JSON.parse(readFileSync(new URL(
  '../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json',
  import.meta.url,
), 'utf8')) as SourceProductCaptureV2Submission;

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-1', ownerUserId: 'owner-1', kind: 'SOURCE_ORIGINAL',
    sourceCaptureSnapshotId: 'snapshot-1', sourceMediaKey: 'media-1',
    sourceUrl: 'https://source.example/media-1.png', url: 'https://cdn.example/media-1.png',
    storageBackend: 'oss', storageKey: 'owner/media-1.png', mimeType: 'image/png',
    sizeBytes: 100, width: 1, height: 1, sha256: 'a'.repeat(64), metadata: {},
    ...overrides,
  };
}

describe('source listing media import Prisma store', () => {
  it('loads media only through an owner-scoped immutable snapshot query', async () => {
    const findFirst = vi.fn(async () => ({
      id: 'snapshot-1', captureHash: fixture.captureHash, payloadBytes: fixture.payloadBytes,
      payload: fixture.capture,
    }));
    const store = createPrismaSourceListingMediaImportStore({
      sourceCaptureSnapshot: { findFirst }, mediaAsset: {},
    } as any);
    await expect(store.loadCaptureAuthority({ ownerUserId: 'owner-1', snapshotId: 'snapshot-1' }))
      .resolves.toEqual({
        snapshotId: 'snapshot-1', captureHash: fixture.captureHash, media: fixture.capture.media,
      });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'snapshot-1', subject: { ownerUserId: 'owner-1' } },
      select: { id: true, captureHash: true, payloadBytes: true, payload: true },
    });
  });

  it('fails closed when persisted capture media shape is unavailable', async () => {
    const store = createPrismaSourceListingMediaImportStore({
      sourceCaptureSnapshot: { findFirst: vi.fn(async () => ({
        id: 'snapshot-1', captureHash: 'b'.repeat(64), payloadBytes: fixture.payloadBytes,
        payload: fixture.capture,
      })) },
      mediaAsset: {},
    } as any);
    await expect(store.loadCaptureAuthority({ ownerUserId: 'owner-1', snapshotId: 'snapshot-1' }))
      .resolves.toBeNull();
  });

  it('finds and creates assets by exact owner/snapshot/media lineage', async () => {
    const findFirst = vi.fn(async () => asset());
    const create = vi.fn(async ({ data }) => asset(data));
    const store = createPrismaSourceListingMediaImportStore({
      sourceCaptureSnapshot: {}, mediaAsset: { findFirst, create },
    } as any);
    await store.findReusableAsset({
      ownerUserId: 'owner-1', sourceCaptureSnapshotId: 'snapshot-1', sourceMediaKey: 'media-1',
    });
    expect(findFirst).toHaveBeenCalledWith({ where: {
      ownerUserId: 'owner-1', sourceCaptureSnapshotId: 'snapshot-1', sourceMediaKey: 'media-1',
    }});

    await store.createAsset(asset({ id: undefined }) as any);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      ownerUserId: 'owner-1', kind: 'SOURCE_ORIGINAL',
      sourceCaptureSnapshotId: 'snapshot-1', sourceMediaKey: 'media-1',
    }) });
  });

  it('returns the winning immutable asset when a concurrent insert hits the lineage key', async () => {
    const winner = asset({ id: 'asset-winner' });
    const findFirst = vi.fn(async () => winner);
    const store = createPrismaSourceListingMediaImportStore({
      sourceCaptureSnapshot: {},
      mediaAsset: {
        create: vi.fn(async () => { throw Object.assign(new Error('unique'), { code: 'P2002' }); }),
        findFirst,
      },
    } as any);
    await expect(store.createAsset(asset({ id: undefined }) as any)).resolves.toEqual(winner);
    expect(findFirst).toHaveBeenCalledWith({ where: {
      ownerUserId: 'owner-1', sourceCaptureSnapshotId: 'snapshot-1', sourceMediaKey: 'media-1',
    }});
  });
});
