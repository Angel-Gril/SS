import {
  SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS,
  SOURCE_LISTING_SKU_KEY_MAX_LENGTH,
} from 'shared';
import { prisma } from '../lib/prisma.js';
import { capturedSourceSkuAliases } from './source-listing-sku-identity.js';

interface QueryClient {
  $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T>;
}

interface SourceRow {
  supplyGoodsId: string | null;
  subjectId: string;
}

interface SnapshotRow extends SourceRow {
  snapshotId: string;
  captureHash: string;
  payload: unknown;
}

export interface SourceListingWorkflowTargetInput {
  ownerUserId: string;
  shopId: string;
  supplyGoodsId?: string;
  sourceCaptureSnapshotId?: string;
  currentSourceCaptureSnapshotId?: string;
  selectedSkuKeys: string[];
}

export interface SourceListingWorkflowTargetContext {
  shopId: string;
  supplyGoodsId: string;
  sourceCaptureSnapshotId: string;
  sourceCaptureHash: string;
  selectedSkuKeys: string[];
}

export class SourceListingWorkflowContextError extends Error {
  constructor(
    public readonly code:
      | 'SOURCE_LISTING_SHOP_NOT_FOUND'
      | 'SOURCE_LISTING_SOURCE_NOT_FOUND'
      | 'SOURCE_LISTING_SNAPSHOT_NOT_FOUND'
      | 'SOURCE_LISTING_SKU_INVALID'
      | 'SOURCE_LISTING_CONTEXT_INVALID',
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'SourceListingWorkflowContextError';
  }
}

function required(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  if (!normalized) {
    throw new SourceListingWorkflowContextError(
      'SOURCE_LISTING_CONTEXT_INVALID', 400, `${field} is required`,
    );
  }
  return normalized;
}

function normalizeSkuKeys(value: unknown): string[] {
  if (!Array.isArray(value)
    || value.length < 1
    || value.length > SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS) {
    throw new SourceListingWorkflowContextError(
      'SOURCE_LISTING_SKU_INVALID', 422, 'At least one source SKU must be selected',
    );
  }
  const keys = [...new Set(value.map((item) => required(item, 'selectedSkuKey')))];
  if (keys.some((key) => key.length > SOURCE_LISTING_SKU_KEY_MAX_LENGTH)) {
    throw new SourceListingWorkflowContextError(
      'SOURCE_LISTING_SKU_INVALID', 422, 'A selected source SKU key is too long',
    );
  }
  return keys.sort();
}

async function loadSnapshot(
  client: QueryClient,
  input: { ownerUserId: string; snapshotId?: string; subjectId?: string },
): Promise<SnapshotRow | null> {
  const rows = input.snapshotId
    ? await client.$queryRawUnsafe<SnapshotRow[]>(
      `SELECT sn."id" AS "snapshotId", sn."capture_hash" AS "captureHash", sn."payload",
              s."id" AS "subjectId", s."legacy_supply_goods_id" AS "supplyGoodsId"
       FROM "source_capture_snapshots" sn
       JOIN "source_capture_subjects" s ON s."id" = sn."subject_id"
       WHERE sn."id" = $1 AND s."owner_user_id" = $2
         AND ($3::text IS NULL OR s."id" = $3)
       LIMIT 1`,
      input.snapshotId, input.ownerUserId, input.subjectId || null,
    )
    : await client.$queryRawUnsafe<SnapshotRow[]>(
      `SELECT sn."id" AS "snapshotId", sn."capture_hash" AS "captureHash", sn."payload",
              s."id" AS "subjectId", s."legacy_supply_goods_id" AS "supplyGoodsId"
       FROM "source_capture_snapshots" sn
       JOIN "source_capture_subjects" s ON s."id" = sn."subject_id"
       WHERE s."id" = $1 AND s."owner_user_id" = $2
       ORDER BY sn."version" DESC
       LIMIT 1`,
      input.subjectId, input.ownerUserId,
    );
  return rows[0] || null;
}

export function createPrismaSourceListingWorkflowContextResolver(options: {
  client?: QueryClient;
} = {}) {
  const client = options.client || prisma as unknown as QueryClient;

  return {
    async assertOwnedTarget(
      raw: SourceListingWorkflowTargetInput,
    ): Promise<SourceListingWorkflowTargetContext> {
      const ownerUserId = required(raw.ownerUserId, 'ownerUserId');
      const shopId = required(raw.shopId, 'shopId');
      const selectedSkuKeys = normalizeSkuKeys(raw.selectedSkuKeys);
      const shops = await client.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "shops"
         WHERE "id" = $1 AND "user_id" = $2
           AND "platform" = 'OZON'::"Platform"
           AND "status" = 'ACTIVE'::"ShopStatus"
         LIMIT 1`,
        shopId, ownerUserId,
      );
      if (!shops[0]) {
        throw new SourceListingWorkflowContextError(
          'SOURCE_LISTING_SHOP_NOT_FOUND', 404, 'Owned active Ozon shop was not found',
        );
      }

      let source: SourceRow | null = null;
      if (raw.supplyGoodsId) {
        const supplyGoodsId = required(raw.supplyGoodsId, 'supplyGoodsId');
        const rows = await client.$queryRawUnsafe<SourceRow[]>(
          `SELECT g."id" AS "supplyGoodsId", s."id" AS "subjectId"
           FROM "supply_goods" g
           JOIN "source_capture_subjects" s
             ON s."legacy_supply_goods_id" = g."id" AND s."owner_user_id" = g."user_id"
           WHERE g."id" = $1 AND g."user_id" = $2
           LIMIT 1`,
          supplyGoodsId, ownerUserId,
        );
        source = rows[0] || null;
      } else {
        const anchorSnapshotId = raw.currentSourceCaptureSnapshotId || raw.sourceCaptureSnapshotId;
        if (anchorSnapshotId) {
          source = await loadSnapshot(client, {
            ownerUserId,
            snapshotId: required(anchorSnapshotId, 'sourceCaptureSnapshotId'),
          });
        }
      }
      if (!source?.subjectId || !source.supplyGoodsId) {
        throw new SourceListingWorkflowContextError(
          'SOURCE_LISTING_SOURCE_NOT_FOUND', 404, 'Owned source product was not found',
        );
      }

      const snapshotId = raw.sourceCaptureSnapshotId
        ? required(raw.sourceCaptureSnapshotId, 'sourceCaptureSnapshotId')
        : undefined;
      const snapshot = await loadSnapshot(client, {
        ownerUserId,
        subjectId: source.subjectId,
        ...(snapshotId ? { snapshotId } : {}),
      });
      if (!snapshot) {
        throw new SourceListingWorkflowContextError(
          'SOURCE_LISTING_SNAPSHOT_NOT_FOUND', 404, 'Owned source capture snapshot was not found',
        );
      }

      const availableSkuKeys = capturedSourceSkuAliases(snapshot.payload);
      const missing = selectedSkuKeys.filter((key) => !availableSkuKeys.get(key));
      if (missing.length) {
        throw new SourceListingWorkflowContextError(
          'SOURCE_LISTING_SKU_INVALID', 422,
          `Selected SKU keys are not present in the source snapshot: ${missing.slice(0, 10).join(', ')}`,
        );
      }
      return {
        shopId,
        supplyGoodsId: String(source.supplyGoodsId),
        sourceCaptureSnapshotId: String(snapshot.snapshotId),
        sourceCaptureHash: String(snapshot.captureHash),
        selectedSkuKeys: [...new Set(selectedSkuKeys.map((key) => availableSkuKeys.get(key)!))].sort(),
      };
    },
  };
}

export type SourceListingWorkflowContextResolver = ReturnType<
  typeof createPrismaSourceListingWorkflowContextResolver
>;
