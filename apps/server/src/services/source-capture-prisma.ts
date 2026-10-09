import { randomUUID } from 'node:crypto';
import { pendingSourceCaptureImageTransfer } from './source-capture-image-transfer.js';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import {
  ExtensionCommandGrantError,
  digestExtensionCommandGrantToken,
  type ExtensionCommandConsumeResult,
} from './extension-command-grants.js';
import {
  consumeExtensionCommandGrantInTransaction,
  runExtensionCommandSerializableTransaction,
  type ExtensionCommandDatabaseClient,
  type ExtensionCommandTransactionClient,
} from './extension-command-grants-prisma.js';
import {
  SourceCaptureError,
  type PreparedLegacySourceCapture,
  type PreparedLegacyProjection,
  type PreparedNativeSourceCapture,
  type PreparedSourceCapture,
  type SourceCapturePersistenceResult,
  type SourceCaptureRepository,
} from './source-capture.js';

interface SubjectRow {
  id: string;
  legacySupplyGoodsId: string | null;
}

interface SnapshotRow {
  id: string;
  version: number;
  captureHash: string;
}

interface ReceiptResult {
  type: 'SOURCE_CAPTURE';
  subjectId: string;
  snapshotId: string;
  snapshotVersion: number;
  supplyGoodsId: string;
  captureHash: string;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function parseReceiptResult(value: unknown): ReceiptResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Partial<ReceiptResult>;
  if (row.type !== 'SOURCE_CAPTURE'
    || typeof row.subjectId !== 'string'
    || typeof row.snapshotId !== 'string'
    || !Number.isSafeInteger(row.snapshotVersion)
    || Number(row.snapshotVersion) <= 0
    || typeof row.supplyGoodsId !== 'string'
    || !/^[a-f0-9]{64}$/.test(String(row.captureHash || ''))) {
    return null;
  }
  return row as ReceiptResult;
}

function grantFailure(result: Exclude<ExtensionCommandConsumeResult, { kind: 'execute' | 'replay' }>): never {
  const errors: Record<typeof result.kind, [string, number, string]> = {
    not_found: ['COMMAND_GRANT_NOT_FOUND', 404, 'Command grant not found'],
    mismatch: ['COMMAND_GRANT_MISMATCH', 409, 'Command grant does not match this request'],
    expired: ['COMMAND_GRANT_EXPIRED', 410, 'Command grant expired'],
    revoked: ['COMMAND_GRANT_REVOKED', 410, 'Command grant was revoked'],
    session_invalid: ['COMMAND_SESSION_INVALID', 401, 'Extension device session is invalid'],
    scope_denied: ['COMMAND_SCOPE_DENIED', 403, 'Extension device scope is not allowed'],
    shop_denied: ['COMMAND_SHOP_DENIED', 403, 'Extension device shop is not allowed'],
  };
  const [code, statusCode, message] = errors[result.kind];
  throw new ExtensionCommandGrantError(code, statusCode, message);
}

async function lockSubject(
  tx: ExtensionCommandTransactionClient,
  input: PreparedSourceCapture,
  now: Date,
  createId: () => string,
): Promise<SubjectRow> {
  await tx.$queryRawUnsafe(
    `INSERT INTO "source_capture_subjects"
      ("id", "owner_user_id", "source_platform", "source_product_id",
       "legacy_supply_goods_id", "created_at", "updated_at")
     VALUES ($1, $2, $3, $4, NULL, $5, $5)
     ON CONFLICT ("owner_user_id", "source_platform", "source_product_id")
     DO UPDATE SET "updated_at" = EXCLUDED."updated_at"`,
    createId(),
    input.ownerUserId,
    input.capture.platform,
    input.capture.sourceIdentity.productId,
    now,
  );
  const rows = await tx.$queryRawUnsafe<SubjectRow[]>(
    `SELECT "id", "legacy_supply_goods_id" AS "legacySupplyGoodsId"
     FROM "source_capture_subjects"
     WHERE "owner_user_id" = $1
       AND "source_platform" = $2
       AND "source_product_id" = $3
     FOR UPDATE`,
    input.ownerUserId,
    input.capture.platform,
    input.capture.sourceIdentity.productId,
  );
  if (!rows[0]) throw new Error('SOURCE_CAPTURE_SUBJECT_UPSERT_FAILED');
  return {
    id: String(rows[0].id),
    legacySupplyGoodsId: rows[0].legacySupplyGoodsId == null
      ? null
      : String(rows[0].legacySupplyGoodsId),
  };
}

async function requireLegacyProjection(
  tx: ExtensionCommandTransactionClient,
  ownerUserId: string,
  supplyGoodsId: string,
) {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id"
     FROM "supply_goods"
     WHERE "id" = $1 AND "user_id" = $2
     FOR UPDATE`,
    supplyGoodsId,
    ownerUserId,
  );
  if (!rows[0]) {
    throw new SourceCaptureError(
      'SOURCE_CAPTURE_LEGACY_PROJECTION_NOT_FOUND',
      404,
      'Legacy supply goods projection not found',
    );
  }
}

async function createNativeProjection(
  tx: ExtensionCommandTransactionClient,
  input: PreparedSourceCapture,
  supplyGoodsId: string,
  now: Date,
) {
  await tx.$queryRawUnsafe(
    `INSERT INTO "supply_goods"
      ("id", "user_id", "title", "source_url", "source_platform", "source_product_id",
       "supplier", "purchase_price", "currency", "sku", "images", "variants",
       "metadata", "status", "created_at", "updated_at")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             $11::jsonb, $12::jsonb, $13::jsonb, 'collected', $14, $14)`,
    supplyGoodsId,
    input.ownerUserId,
    input.projection.title,
    input.projection.sourceUrl,
    input.projection.sourcePlatform,
    input.projection.sourceProductId,
    input.capture.facts.shopName,
    input.projection.purchasePrice,
    input.projection.currency,
    input.projection.sku,
    json(input.projection.images),
    json(input.projection.variants),
    json(input.projection.metadata),
    now,
  );
}

async function bindProjection(
  tx: ExtensionCommandTransactionClient,
  subject: SubjectRow,
  requestedSupplyGoodsId: string,
  now: Date,
): Promise<string> {
  if (subject.legacySupplyGoodsId) {
    if (subject.legacySupplyGoodsId !== requestedSupplyGoodsId) {
      throw new SourceCaptureError(
        'SOURCE_CAPTURE_PROJECTION_CONFLICT',
        409,
        'Source capture subject is already bound to another legacy projection',
      );
    }
    return subject.legacySupplyGoodsId;
  }
  const rows = await tx.$queryRawUnsafe<Array<{ legacySupplyGoodsId: string }>>(
    `UPDATE "source_capture_subjects"
     SET "legacy_supply_goods_id" = $1, "updated_at" = $2
     WHERE "id" = $3 AND "legacy_supply_goods_id" IS NULL
     RETURNING "legacy_supply_goods_id" AS "legacySupplyGoodsId"`,
    requestedSupplyGoodsId,
    now,
    subject.id,
  );
  return String(rows[0]?.legacySupplyGoodsId || requestedSupplyGoodsId);
}

async function ensureLegacyProjectionInTransaction(
  tx: ExtensionCommandTransactionClient,
  input: PreparedLegacyProjection,
  now: Date,
  createId: () => string,
) {
  await tx.$queryRawUnsafe(
    `INSERT INTO "source_capture_subjects"
      ("id", "owner_user_id", "source_platform", "source_product_id",
       "legacy_supply_goods_id", "created_at", "updated_at")
     VALUES ($1, $2, $3, $4, NULL, $5, $5)
     ON CONFLICT ("owner_user_id", "source_platform", "source_product_id")
     DO UPDATE SET "updated_at" = EXCLUDED."updated_at"`,
    createId(),
    input.ownerUserId,
    input.sourcePlatform,
    input.sourceProductId,
    now,
  );
  const subjects = await tx.$queryRawUnsafe<SubjectRow[]>(
    `SELECT "id", "legacy_supply_goods_id" AS "legacySupplyGoodsId"
     FROM "source_capture_subjects"
     WHERE "owner_user_id" = $1
       AND "source_platform" = $2
       AND "source_product_id" = $3
     FOR UPDATE`,
    input.ownerUserId,
    input.sourcePlatform,
    input.sourceProductId,
  );
  const subject = subjects[0];
  if (!subject) throw new Error('SOURCE_CAPTURE_SUBJECT_UPSERT_FAILED');

  if (subject.legacySupplyGoodsId) {
    const goods = await tx.$queryRawUnsafe<Array<{ id: string; createdAt: Date }>>(
      `SELECT "id", "created_at" AS "createdAt"
       FROM "supply_goods"
       WHERE "id" = $1 AND "user_id" = $2
       FOR UPDATE`,
      subject.legacySupplyGoodsId,
      input.ownerUserId,
    );
    if (!goods[0]) throw new Error('SOURCE_CAPTURE_BOUND_PROJECTION_MISSING');
    const { sourceCaptureV2: _pendingCapture, ...metadataWithoutCapturePointer } = input.projection.metadata;
    await tx.$queryRawUnsafe(
      `UPDATE "supply_goods"
       SET "title" = $1, "source_url" = $2, "source_platform" = $3,
           "source_product_id" = $4, "supplier" = $5, "purchase_price" = $6,
           "currency" = $7, "sku" = $8, "images" = $9::jsonb,
           "variants" = $10::jsonb,
           "metadata" = COALESCE("metadata", '{}'::jsonb) || $11::jsonb,
           "updated_at" = $12
       WHERE "id" = $13 AND "user_id" = $14`,
      input.projection.title,
      input.projection.sourceUrl,
      input.projection.sourcePlatform,
      input.projection.sourceProductId,
      input.supplier,
      input.projection.purchasePrice,
      input.projection.currency,
      input.projection.sku,
      json(input.projection.images),
      json(input.projection.variants),
      json(metadataWithoutCapturePointer),
      now,
      subject.legacySupplyGoodsId,
      input.ownerUserId,
    );
    return {
      kind: 'reused' as const,
      subjectId: String(subject.id),
      supplyGoodsId: String(subject.legacySupplyGoodsId),
      createdAt: new Date(goods[0].createdAt),
    };
  }

  const supplyGoodsId = createId();
  await tx.$queryRawUnsafe(
    `INSERT INTO "supply_goods"
      ("id", "user_id", "title", "source_url", "source_platform", "source_product_id",
       "supplier", "purchase_price", "currency", "sku", "images", "variants",
       "metadata", "status", "created_at", "updated_at")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             $11::jsonb, $12::jsonb, $13::jsonb, 'collected', $14, $14)`,
    supplyGoodsId,
    input.ownerUserId,
    input.projection.title,
    input.projection.sourceUrl,
    input.projection.sourcePlatform,
    input.projection.sourceProductId,
    input.supplier,
    input.projection.purchasePrice,
    input.projection.currency,
    input.projection.sku,
    json(input.projection.images),
    json(input.projection.variants),
    json(input.projection.metadata),
    now,
  );
  await bindProjection(tx, {
    id: String(subject.id),
    legacySupplyGoodsId: null,
  }, supplyGoodsId, now);
  return {
    kind: 'created' as const,
    subjectId: String(subject.id),
    supplyGoodsId,
    createdAt: now,
  };
}

async function updateProjectionPointer(
  tx: ExtensionCommandTransactionClient,
  input: PreparedSourceCapture,
  supplyGoodsId: string,
  result: ReceiptResult,
  now: Date,
  updatePreview: boolean,
) {
  const pointer = {
    sourceCaptureV2: {
      subjectId: result.subjectId,
      snapshotId: result.snapshotId,
      snapshotVersion: result.snapshotVersion,
      captureHash: result.captureHash,
      schemaVersion: input.capture.captureVersion,
      provenanceMode: input.capture.provenanceMode,
      provenanceComplete: input.provenance.complete,
      completenessStatus: input.completeness.status,
    },
  };
  if (updatePreview) {
    await tx.$queryRawUnsafe(
      `UPDATE "supply_goods"
       SET "title" = $1,
           "source_url" = $2,
           "source_platform" = $3,
           "source_product_id" = $4,
           "supplier" = $5,
           "purchase_price" = $6,
           "currency" = $7,
           "sku" = $8,
           "images" = $9::jsonb,
           "variants" = $10::jsonb,
           "metadata" = COALESCE("metadata", '{}'::jsonb) || $11::jsonb,
           "updated_at" = $12
       WHERE "id" = $13 AND "user_id" = $14`,
      input.projection.title,
      input.projection.sourceUrl,
      input.projection.sourcePlatform,
      input.projection.sourceProductId,
      input.capture.facts.shopName,
      input.projection.purchasePrice,
      input.projection.currency,
      input.projection.sku,
      json(input.projection.images),
      json(input.projection.variants),
      json({ ...input.projection.metadata, ...pointer,
        sourceImageTransferV2: pendingSourceCaptureImageTransfer(result.snapshotId, input.captureHash) }),
      now,
      supplyGoodsId,
      input.ownerUserId,
    );
    return;
  }
  await tx.$queryRawUnsafe(
    `UPDATE "supply_goods"
     SET "metadata" = COALESCE("metadata", '{}'::jsonb) || $1::jsonb,
         "updated_at" = $2
     WHERE "id" = $3 AND "user_id" = $4`,
    json({ ...pointer, sourceImageTransferV2: pendingSourceCaptureImageTransfer(result.snapshotId, input.captureHash) }),
    now,
    supplyGoodsId,
    input.ownerUserId,
  );
}

async function persistCapture(
  tx: ExtensionCommandTransactionClient,
  input: PreparedSourceCapture,
  options: {
    requestedSupplyGoodsId?: string;
    now: Date;
    createId: () => string;
  },
): Promise<SourceCapturePersistenceResult> {
  const subject = await lockSubject(tx, input, options.now, options.createId);
  const existingRows = await tx.$queryRawUnsafe<SnapshotRow[]>(
    `SELECT "id", "version", "capture_hash" AS "captureHash"
     FROM "source_capture_snapshots"
     WHERE "subject_id" = $1 AND "capture_hash" = $2
     FOR UPDATE`,
    subject.id,
    input.captureHash,
  );
  const existing = existingRows[0]
    ? {
      id: String(existingRows[0].id),
      version: Number(existingRows[0].version),
      captureHash: String(existingRows[0].captureHash),
    }
    : null;

  const projectionWasMissing = subject.legacySupplyGoodsId == null;
  let supplyGoodsId = subject.legacySupplyGoodsId;
  if (options.requestedSupplyGoodsId) {
    await requireLegacyProjection(tx, input.ownerUserId, options.requestedSupplyGoodsId);
    supplyGoodsId = await bindProjection(tx, subject, options.requestedSupplyGoodsId, options.now);
  } else if (!supplyGoodsId) {
    const projectionId = options.createId();
    await createNativeProjection(tx, input, projectionId, options.now);
    supplyGoodsId = await bindProjection(tx, subject, projectionId, options.now);
  }
  if (!supplyGoodsId) throw new Error('SOURCE_CAPTURE_PROJECTION_BIND_FAILED');

  let snapshotId: string;
  let snapshotVersion: number;
  let kind: SourceCapturePersistenceResult['kind'];
  if (existing) {
    snapshotId = existing.id;
    snapshotVersion = existing.version;
    kind = 'replay';
  } else {
    const versions = await tx.$queryRawUnsafe<Array<{ nextVersion: number }>>(
      `SELECT COALESCE(MAX("version"), 0) + 1 AS "nextVersion"
       FROM "source_capture_snapshots"
       WHERE "subject_id" = $1`,
      subject.id,
    );
    snapshotVersion = Number(versions[0]?.nextVersion || 1);
    snapshotId = options.createId();
    const inserted = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "source_capture_snapshots"
        ("id", "subject_id", "version", "schema_version", "capture_hash", "payload_bytes",
         "payload", "stage_counts", "provenance", "provenance_complete",
         "parser_version", "extension_version", "completeness", "truncations",
         "has_estimated_values", "profile_json", "profile_hash", "actor_user_id",
         "device_session_id", "ingest_channel", "rollout_revision", "rollout_stage", "captured_at", "created_at")
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10,
               $11, $12, $13::jsonb, $14::jsonb, $15, $16::jsonb, $17, $18,
               $19, $20::"SourceCaptureIngestChannel", $21, $22, $23, $24)
       RETURNING "id"`,
      snapshotId,
      subject.id,
      snapshotVersion,
      input.capture.captureVersion,
      input.captureHash,
      input.payloadBytes,
      json(input.capture),
      json(input.stageCounts),
      json(input.provenance),
      input.provenance.complete,
      input.parserVersion,
      input.extensionVersion,
      json(input.completeness),
      json(input.truncations),
      input.hasEstimatedValues,
      json(input.profile),
      input.profile.hash,
      input.actorUserId,
      input.deviceSessionId,
      input.ingestChannel,
      input.rolloutRevision,
      input.rolloutStage,
      input.capturedAt,
      options.now,
    );
    if (!inserted[0]) throw new Error('SOURCE_CAPTURE_SNAPSHOT_INSERT_FAILED');
    kind = 'created';
  }

  const receiptResult: ReceiptResult = {
    type: 'SOURCE_CAPTURE',
    subjectId: subject.id,
    snapshotId,
    snapshotVersion,
    supplyGoodsId,
    captureHash: input.captureHash,
  };
  if (kind === 'created' || projectionWasMissing) {
    await updateProjectionPointer(
      tx,
      input,
      supplyGoodsId,
      receiptResult,
      options.now,
      input.ingestChannel === 'EXTENSION_DEVICE',
    );
  }
  return {
    kind,
    subjectId: receiptResult.subjectId,
    snapshotId: receiptResult.snapshotId,
    snapshotVersion: receiptResult.snapshotVersion,
    supplyGoodsId: receiptResult.supplyGoodsId,
    captureHash: receiptResult.captureHash,
  };
}

export function createPrismaSourceCaptureRepository(options: {
  client?: PrismaClient | ExtensionCommandDatabaseClient;
  commandGrantSecret: string;
  now?: () => Date;
  createId?: () => string;
}): SourceCaptureRepository {
  const client = (options.client || prisma) as unknown as ExtensionCommandDatabaseClient;
  const commandGrantSecret = String(options.commandGrantSecret || '');
  if (commandGrantSecret.length < 32) {
    throw new Error('Source capture command grant secret must be at least 32 characters');
  }
  const now = options.now || (() => new Date());
  const createId = options.createId || randomUUID;

  return {
    async ensureLegacyProjection(input: PreparedLegacyProjection) {
      return runExtensionCommandSerializableTransaction(
        client,
        (tx) => ensureLegacyProjectionInTransaction(tx, input, now(), createId),
      );
    },

    async loadLegacyProjection(input) {
      const rows = await client.$queryRawUnsafe<Array<{ id: string; createdAt: Date }>>(
        `SELECT "id", "created_at" AS "createdAt"
         FROM "supply_goods"
         WHERE "id" = $1 AND "user_id" = $2`,
        input.supplyGoodsId,
        input.ownerUserId,
      );
      return rows[0]
        ? { id: String(rows[0].id), createdAt: new Date(rows[0].createdAt) }
        : null;
    },

    async ingestLegacy(input: PreparedLegacySourceCapture) {
      return runExtensionCommandSerializableTransaction(client, (tx) => persistCapture(tx, input, {
        requestedSupplyGoodsId: input.supplyGoodsId,
        now: now(),
        createId,
      }));
    },

    async ingestNative(input: PreparedNativeSourceCapture) {
      const acceptedAt = now();
      const binding = {
        sessionId: input.deviceSessionId,
        tokenId: input.tokenId,
        ownerUserId: input.ownerUserId,
        shopId: null,
        operation: 'SOURCE_CAPTURE' as const,
        workflowId: null,
        draftVersion: null,
        idempotencyKey: input.grant.idempotencyKey,
        requestHash: input.grant.requestHash,
      };
      const tokenDigest = digestExtensionCommandGrantToken(commandGrantSecret, input.grant.token);
      return runExtensionCommandSerializableTransaction(client, async (tx) => {
        const admission = await consumeExtensionCommandGrantInTransaction(tx, {
          tokenDigest,
          binding,
          receiptId: createId(),
          now: acceptedAt,
        });
        if (admission.kind === 'replay') {
          const replay = parseReceiptResult(admission.receipt.result);
          if (admission.receipt.status !== 'SUCCEEDED' || !replay) {
            throw new SourceCaptureError(
              'SOURCE_CAPTURE_RECEIPT_INCOMPLETE',
              409,
              'Source capture receipt is not replayable',
            );
          }
          return { kind: 'replay' as const, ...replay };
        }
        if (admission.kind !== 'execute') return grantFailure(admission);

        const persisted = await persistCapture(tx, input, { now: acceptedAt, createId });
        const result: ReceiptResult = {
          type: 'SOURCE_CAPTURE',
          subjectId: persisted.subjectId,
          snapshotId: persisted.snapshotId,
          snapshotVersion: persisted.snapshotVersion,
          supplyGoodsId: persisted.supplyGoodsId,
          captureHash: persisted.captureHash,
        };
        const completed = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `UPDATE "extension_command_receipts"
           SET "status" = 'SUCCEEDED',
               "result" = $1::jsonb,
               "failure_code" = NULL,
               "completed_at" = $2
           WHERE "id" = $3 AND "status" = 'PENDING'
           RETURNING "id"`,
          json(result),
          acceptedAt,
          admission.receipt.id,
        );
        if (!completed[0]) throw new Error('SOURCE_CAPTURE_RECEIPT_COMPLETE_FAILED');
        return persisted;
      });
    },
  };
}
