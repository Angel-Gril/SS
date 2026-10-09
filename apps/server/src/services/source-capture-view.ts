import {
  verifySourceProductCaptureV2Submission,
  type SourceProductCaptureV2,
} from 'shared';
import { prisma } from '../lib/prisma.js';
import { createSourceCaptureMediaDisplayService, type SourceCaptureMediaDisplayClient } from './source-capture-media-display.js';

export const SOURCE_CAPTURE_VIEW_SKU_OFFSET_MAX = 10_000;
export const SOURCE_CAPTURE_VIEW_MEDIA_OFFSET_MAX = 20_000;
export const SOURCE_CAPTURE_VIEW_PAGE_LIMIT_MAX = 100;

export interface SourceCaptureViewPersistenceRow {
  id: string;
  version: number;
  schemaVersion: string;
  captureHash: string;
  payloadBytes: number;
  payload: unknown;
  stageCounts: unknown;
  completeness: unknown;
  truncations: unknown;
  capturedAt: Date;
  subject: { legacySupplyGoodsId: string | null };
}

interface SourceCaptureViewPersistenceClient {
  sourceCaptureSnapshot: {
    findFirst(args: any): Promise<SourceCaptureViewPersistenceRow | null>;
  };
  mediaAsset?: SourceCaptureMediaDisplayClient['mediaAsset'];
}

export class SourceCaptureViewError extends Error {
  constructor(
    public readonly code: 'SOURCE_CAPTURE_VIEW_NOT_FOUND' | 'SOURCE_CAPTURE_VIEW_INVALID',
    public readonly statusCode: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'SourceCaptureViewError';
  }
}

function identifier(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  if (!text || text.length > 200) {
    throw new SourceCaptureViewError(
      'SOURCE_CAPTURE_VIEW_INVALID',
      409,
      `${field} is invalid`,
    );
  }
  return text;
}

function invalidSnapshot(message = 'Persisted Capture V2 is invalid'): never {
  throw new SourceCaptureViewError('SOURCE_CAPTURE_VIEW_INVALID', 409, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertPage(value: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    invalidSnapshot(`${field} is invalid`);
  }
  return value;
}

function validAuthority(row: SourceCaptureViewPersistenceRow, capture: SourceProductCaptureV2): void {
  if (row.id !== row.id.normalize('NFKC').trim()
    || !row.id
    || !Number.isSafeInteger(row.version)
    || row.version <= 0
    || row.schemaVersion !== 'source-product-capture-v2'
    || capture.captureVersion !== row.schemaVersion
    || !/^[a-f0-9]{64}$/.test(row.captureHash)
    || !Number.isSafeInteger(row.payloadBytes)
    || row.payloadBytes <= 0
    || row.payloadBytes > 8 * 1024 * 1024
    || !(row.capturedAt instanceof Date)
    || !Number.isFinite(row.capturedAt.getTime())
    || !isRecord(row.stageCounts)
    || !isRecord((row.stageCounts as Record<string, unknown>).fields)
    || !isRecord(row.completeness)
    || !Array.isArray(row.truncations)) {
    invalidSnapshot();
  }
}

export function createSourceCaptureViewService(options: {
  client?: SourceCaptureViewPersistenceClient;
} = {}) {
  const client = options.client || prisma as unknown as SourceCaptureViewPersistenceClient;

  return {
    async getView(input: {
      snapshotId: string;
      supplyGoodsId: string;
      ownerUserId: string;
      skuOffset: number;
      skuLimit: number;
      mediaOffset: number;
      mediaLimit: number;
    }) {
      const snapshotId = identifier(input.snapshotId, 'snapshotId');
      const supplyGoodsId = identifier(input.supplyGoodsId, 'supplyGoodsId');
      const ownerUserId = identifier(input.ownerUserId, 'ownerUserId');
      const skuOffset = assertPage(
        input.skuOffset,
        SOURCE_CAPTURE_VIEW_SKU_OFFSET_MAX,
        'skuOffset',
      );
      const mediaOffset = assertPage(
        input.mediaOffset,
        SOURCE_CAPTURE_VIEW_MEDIA_OFFSET_MAX,
        'mediaOffset',
      );
      const skuLimit = assertPage(input.skuLimit, SOURCE_CAPTURE_VIEW_PAGE_LIMIT_MAX, 'skuLimit');
      const mediaLimit = assertPage(
        input.mediaLimit,
        SOURCE_CAPTURE_VIEW_PAGE_LIMIT_MAX,
        'mediaLimit',
      );
      if (skuLimit < 1 || mediaLimit < 1) invalidSnapshot('Page limit is invalid');

      const row = await client.sourceCaptureSnapshot.findFirst({
        where: {
          id: snapshotId,
          subject: { ownerUserId, legacySupplyGoodsId: supplyGoodsId },
        },
        select: {
          id: true,
          version: true,
          schemaVersion: true,
          captureHash: true,
          payloadBytes: true,
          payload: true,
          stageCounts: true,
          completeness: true,
          truncations: true,
          capturedAt: true,
          subject: { select: { legacySupplyGoodsId: true } },
        },
      });
      if (!row) {
        throw new SourceCaptureViewError(
          'SOURCE_CAPTURE_VIEW_NOT_FOUND',
          404,
          'Owned source capture snapshot was not found',
        );
      }
      if (row.subject.legacySupplyGoodsId !== supplyGoodsId) invalidSnapshot();

      const verification = await verifySourceProductCaptureV2Submission({
        capture: row.payload,
        captureHash: row.captureHash,
        payloadBytes: row.payloadBytes,
      });
      if (!verification.valid) invalidSnapshot();
      const capture = row.payload as SourceProductCaptureV2;
      validAuthority(row, capture);
      const media = capture.media.slice(mediaOffset, mediaOffset + mediaLimit);
      const displayUrls = client.mediaAsset ? await createSourceCaptureMediaDisplayService({
        client: { mediaAsset: client.mediaAsset },
      }).loadDisplayUrls({ ownerUserId, snapshotId: row.id, media }) : [];
      const displayByKey = new Map(displayUrls.map(item => [item.key, item.displayUrl]));

      return {
        snapshotId: row.id,
        supplyGoodsId,
        version: row.version,
        capturedAt: row.capturedAt.toISOString(),
        captureHash: row.captureHash,
        captureVersion: capture.captureVersion,
        sourceIdentity: structuredClone(capture.sourceIdentity),
        facts: structuredClone(capture.facts),
        completeness: structuredClone(row.completeness),
        truncations: structuredClone(row.truncations),
        counts: structuredClone(row.stageCounts),
        skus: {
          items: structuredClone(capture.skus.slice(skuOffset, skuOffset + skuLimit)),
          total: capture.skus.length,
          offset: skuOffset,
          limit: skuLimit,
        },
        media: {
          items: media.map(item => ({ ...structuredClone(item),
            ...(displayByKey.has(item.key) ? { displayUrl: displayByKey.get(item.key)! } : {}) })),
          total: capture.media.length,
          offset: mediaOffset,
          limit: mediaLimit,
        },
      };
    },
  };
}

export type SourceCaptureViewService = ReturnType<typeof createSourceCaptureViewService>;
