import type { PrismaClient } from '@prisma/client';
import {
  SOURCE_CAPTURE_IMAGE_TRANSFER_MAX_ATTEMPTS,
  SOURCE_CAPTURE_IMAGE_TRANSFER_VERSION,
  type SourceCaptureImageTransferClaim,
  type SourceCaptureImageTransferStore,
} from './source-capture-image-transfer.js';

type TransferClient = Pick<PrismaClient, '$queryRawUnsafe' | '$transaction'>;
type Projection = { images: unknown; variants: unknown; metadata: unknown };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function replaceImages(value: unknown, urls: Map<string, string>) {
  return Array.isArray(value) ? value.map(item => typeof item === 'string' ? urls.get(item) || item : item) : value;
}

export function createPrismaSourceCaptureImageTransferStore(client: TransferClient): SourceCaptureImageTransferStore {
  return {
    async claim(input) {
      const rows = await client.$queryRawUnsafe<SourceCaptureImageTransferClaim[]>(
        `WITH candidate AS (
           SELECT g."id"
           FROM "supply_goods" g
           JOIN "users" u ON u."id" = g."user_id" AND u."status" = 'ACTIVE'
           JOIN "source_capture_subjects" s ON s."legacy_supply_goods_id" = g."id" AND s."owner_user_id" = g."user_id"
           JOIN "source_capture_snapshots" c ON c."subject_id" = s."id"
             AND c."id" = g."metadata" #>> '{sourceCaptureV2,snapshotId}'
           WHERE g."metadata" #>> '{sourceImageTransferV2,version}' = $1
             AND g."metadata" #>> '{sourceImageTransferV2,snapshotId}' = c."id"
             AND g."metadata" #>> '{sourceImageTransferV2,captureHash}' = c."capture_hash"
             AND g."metadata" #>> '{sourceCaptureV2,captureHash}' = c."capture_hash"
             AND g."metadata" #> '{sourceImageTransferV2,attempts}' IN ('0'::jsonb, '1'::jsonb, '2'::jsonb, '3'::jsonb)
             AND ((g."metadata" #>> '{sourceImageTransferV2,status}' IN ('PENDING','RETRY')
                   AND g."metadata" #> '{sourceImageTransferV2,attempts}' IN ('0'::jsonb, '1'::jsonb, '2'::jsonb)
                   AND COALESCE(g."metadata" #>> '{sourceImageTransferV2,nextAttemptAt}', '') <= $2)
               OR (g."metadata" #>> '{sourceImageTransferV2,status}' = 'RUNNING'
                   AND g."metadata" #>> '{sourceImageTransferV2,leaseExpiresAt}' <= $2))
           ORDER BY g."updated_at", g."id" LIMIT 1 FOR UPDATE OF g SKIP LOCKED
         )
         UPDATE "supply_goods" g SET "metadata" = jsonb_set(g."metadata", '{sourceImageTransferV2}',
           (g."metadata" -> 'sourceImageTransferV2') || jsonb_build_object(
             'status', 'RUNNING', 'leaseId', $3::text, 'leaseExpiresAt', $4::text,
             'attempts', CASE g."metadata" #> '{sourceImageTransferV2,attempts}'
               WHEN '0'::jsonb THEN 1 WHEN '1'::jsonb THEN 2 WHEN '2'::jsonb THEN 3 ELSE 4 END))
         FROM candidate WHERE g."id" = candidate."id"
         RETURNING g."id" AS "supplyGoodsId", g."user_id" AS "ownerUserId",
           g."metadata" #>> '{sourceImageTransferV2,snapshotId}' AS "snapshotId",
           g."metadata" #>> '{sourceImageTransferV2,captureHash}' AS "captureHash",
           g."metadata" #>> '{sourceImageTransferV2,leaseId}' AS "leaseId",
           (g."metadata" #>> '{sourceImageTransferV2,attempts}')::integer AS "attempts",
           CASE WHEN g."metadata" #>> '{sourceImageTransferV2,offset}' ~ '^[0-9]{1,5}$'
             THEN (g."metadata" #>> '{sourceImageTransferV2,offset}')::integer ELSE 0 END AS "offset"`,
        SOURCE_CAPTURE_IMAGE_TRANSFER_VERSION, input.now.toISOString(), input.leaseId, input.leaseExpiresAt.toISOString(),
      );
      return rows[0] || null;
    },
    async finish(input) {
      const { claim, result } = input;
      return client.$transaction(async tx => {
        const rows = await tx.$queryRawUnsafe<Projection[]>(
          `SELECT "images", "variants", "metadata" FROM "supply_goods"
           WHERE "id" = $1 AND "user_id" = $2
             AND "metadata" #>> '{sourceCaptureV2,snapshotId}' = $3
             AND "metadata" #>> '{sourceCaptureV2,captureHash}' = $4
             AND "metadata" #>> '{sourceImageTransferV2,leaseId}' = $5
             AND "metadata" #>> '{sourceImageTransferV2,status}' = 'RUNNING'
             AND "metadata" #>> '{sourceImageTransferV2,leaseExpiresAt}' > $6
           FOR UPDATE`, claim.supplyGoodsId, claim.ownerUserId, claim.snapshotId,
          claim.captureHash, claim.leaseId, input.now.toISOString(),
        );
        const current = rows[0];
        if (!current) return false;
        const urls = new Map(result.assets.map(asset => [asset.sourceUrl, asset.url]));
        const metadata = record(current.metadata);
        const variants = Array.isArray(current.variants) ? current.variants.map(value => {
          const variant = record(value);
          return { ...variant, ...(Array.isArray(variant.images) ? { images: replaceImages(variant.images, urls) } : {}) };
        }) : current.variants;
        const failed = result.errors.length > 0;
        const offset = claim.offset || 0;
        const nextOffset = Number.isSafeInteger(result.nextOffset) && result.nextOffset! >= offset ? result.nextOffset! : offset;
        const more = !failed && Number.isSafeInteger(result.total) && nextOffset < result.total!;
        const state = { ...record(metadata.sourceImageTransferV2),
          status: failed ? claim.attempts >= SOURCE_CAPTURE_IMAGE_TRANSFER_MAX_ATTEMPTS ? 'FAILED' : 'RETRY' : more ? 'PENDING' : 'COMPLETE',
          offset: failed ? offset : nextOffset,
          attempts: more ? 0 : claim.attempts,
          transferred: offset + result.assets.length, errors: result.errors, completedAt: input.now.toISOString(),
          ...(failed ? { nextAttemptAt: input.nextAttemptAt.toISOString() } : { nextAttemptAt: input.now.toISOString() }) };
        const patch = { sourceImageTransferV2: state,
          ...(Array.isArray(metadata.sourceMainImages) ? { sourceMainImages: replaceImages(metadata.sourceMainImages, urls) } : {}),
          ...(Array.isArray(metadata.sourceDetailImages) ? { sourceDetailImages: replaceImages(metadata.sourceDetailImages, urls) } : {}) };
        await tx.$executeRawUnsafe(
          `UPDATE "supply_goods" SET "images" = $1::jsonb, "variants" = $2::jsonb,
            "metadata" = COALESCE("metadata", '{}'::jsonb) || $3::jsonb
           WHERE "id" = $4 AND "user_id" = $5`, JSON.stringify(replaceImages(current.images, urls)),
          JSON.stringify(variants), JSON.stringify(patch), claim.supplyGoodsId, claim.ownerUserId,
        );
        return true;
      });
    },
  };
}
