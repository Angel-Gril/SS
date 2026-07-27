import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  deriveExtensionByokBatchItemIdempotencyKey,
  EXTENSION_BYOK_MEDIA_BATCH_INGEST_RECEIPT_VERSION,
  type ExtensionByokMediaBatchIngestReceiptResult,
} from './extension-byok-generated-asset-batch-commit-prisma.js';
import {
  type ExtensionByokMediaBatchIngestStatusLookupInput,
} from '../services/extension-byok-media-batch-ingest-status.js';
import { EXTENSION_BYOK_MEDIA_INGEST_OPERATION } from '../services/extension-byok-media-ingest-grant.js';
import { deriveByokGeneratedAssetId } from '../services/byok-generated-asset-ingest.js';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const identifier = z.string().min(1).max(500);
const assignmentSource = z.enum(['GENERATED', 'EDITED']);
const assignmentSchema = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('SKU'),
    skuKey: identifier,
    slotKey: identifier,
    assetId: identifier,
    source: assignmentSource,
  }).strict(),
  z.object({
    scope: z.literal('PRODUCT'),
    slotKey: identifier,
    assetId: identifier,
    source: assignmentSource,
  }).strict(),
]);
const receiptItemSchema = z.object({
  assetId: identifier,
  provenanceId: identifier,
  executionIntentId: identifier,
  providerRequestHash: sha256,
  providerResultSha256: sha256,
  normalizedSha256: sha256,
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  skuKey: identifier,
  slotKey: identifier,
  assignmentOrdinal: z.number().int().min(0).max(499),
  assignmentSha256: sha256,
  assignment: assignmentSchema,
  policyRevision: z.number().int().positive(),
}).strict();
const receiptSchema: z.ZodType<ExtensionByokMediaBatchIngestReceiptResult> = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_MEDIA_BATCH_INGEST_RECEIPT_VERSION),
  executionBatchId: identifier,
  requestHash: sha256,
  sourceDraftRevision: z.number().int().positive(),
  sourceDraftVersion: z.number().int().positive(),
  boundDraftRevision: z.number().int().positive(),
  boundDraftVersion: z.number().int().positive(),
  erpAiChargeCents: z.literal(0),
  items: z.array(receiptItemSchema).min(1).max(4),
}).strict();
const grantSchema = z.object({
  shopId: identifier.nullable(),
  workflowId: identifier.nullable(),
  draftVersion: z.number().int().positive().nullable(),
  requestHash: sha256,
  receipt: z.object({
    id: identifier,
    status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED']),
    result: z.unknown().nullable(),
    failureCode: identifier.nullable(),
  }).strict().nullable(),
}).strict();
const stagingSchema = z.object({
  id: identifier,
  assetId: identifier,
  status: z.enum(['PENDING', 'CLEANING', 'COMMITTED']),
}).strict();
const executionIntentSchema = z.object({
  id: identifier,
  outcome: z.literal('SUCCEEDED'),
  providerRequestHash: sha256,
  resultSha256: sha256,
}).strict();
const executionBatchItemSchema = z.object({
  id: identifier,
  itemIndex: z.number().int().min(0).max(3),
  skuKey: identifier,
  slotKey: identifier,
  assignmentOrdinal: z.number().int().min(0).max(499),
  status: z.enum(['ACTIVE', 'BOUND']),
  executionIntents: z.array(executionIntentSchema).length(1),
}).strict();
const executionBatchSchema = z.object({
  id: identifier,
  status: z.enum(['OPEN', 'BOUND']),
  ownerUserId: identifier,
  actorUserId: identifier,
  deviceSessionId: identifier,
  shopId: identifier,
  listingWorkflowId: identifier,
  draftRevision: z.number().int().positive(),
  draftVersion: z.number().int().positive(),
  firstAssignmentOrdinal: z.number().int().min(0).max(499),
  itemCount: z.number().int().min(1).max(4),
  boundDraftRevision: z.number().int().positive().nullable(),
  boundDraftVersion: z.number().int().positive().nullable(),
  items: z.array(executionBatchItemSchema).min(1).max(4),
}).strict();

export type ExtensionByokMediaBatchIngestStatusResult =
  | { kind: 'not_found' }
  | { kind: 'not_committed' }
  | { kind: 'pending'; receiptId: string | null }
  | { kind: 'failed'; receiptId: string }
  | {
    kind: 'succeeded';
    receiptId: string;
    receipt: ExtensionByokMediaBatchIngestReceiptResult;
  };

export class ExtensionByokMediaBatchIngestStatusRepositoryError extends Error {
  readonly code = 'BYOK_BATCH_INGEST_STATUS_CONFLICT';
  readonly statusCode = 409;

  constructor() {
    super('BYOK batch ingest status identity conflicts');
    this.name = 'ExtensionByokMediaBatchIngestStatusRepositoryError';
  }
}

function conflict(): never {
  throw new ExtensionByokMediaBatchIngestStatusRepositoryError();
}

type StatusDatabaseClient = {
  extensionCommandGrant: { findFirst(input: unknown): Promise<unknown> };
  extensionByokExecutionBatch: { findFirst(input: unknown): Promise<unknown> };
  extensionByokUploadStaging: { findMany(input: unknown): Promise<unknown> };
};

function assignmentMatchesItem(
  assignment: ExtensionByokMediaBatchIngestReceiptResult['items'][number]['assignment'],
  item: ExtensionByokMediaBatchIngestReceiptResult['items'][number],
): boolean {
  return ['GENERATED', 'EDITED'].includes(assignment.source)
    && assignment.assetId === item.assetId
    && assignment.slotKey === item.slotKey
    && (assignment.scope === 'PRODUCT'
      ? item.slotKey.startsWith('shared:detail:')
      : assignment.skuKey === item.skuKey
        && item.slotKey === `sku:${item.skuKey}:hero`);
}

export function createPrismaExtensionByokMediaBatchIngestStatusRepository(
  client: PrismaClient | StatusDatabaseClient,
) {
  const database = client as unknown as StatusDatabaseClient;
  return {
    async findStatus(
      input: ExtensionByokMediaBatchIngestStatusLookupInput,
    ): Promise<ExtensionByokMediaBatchIngestStatusResult> {
      const value = await database.extensionCommandGrant.findFirst({
        where: {
          sessionId: input.sessionId,
          ownerUserId: input.ownerUserId,
          operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
          idempotencyKey: input.idempotencyKey,
        },
        select: {
          shopId: true,
          workflowId: true,
          draftVersion: true,
          requestHash: true,
          receipt: {
            select: { id: true, status: true, result: true, failureCode: true },
          },
        },
      });
      if (value == null) return { kind: 'not_found' };
      const parsedGrant = grantSchema.safeParse(value);
      if (!parsedGrant.success) return conflict();
      const grant = parsedGrant.data;
      if (grant.shopId !== input.shopId
        || grant.workflowId !== input.workflowId
        || grant.draftVersion !== input.draftVersion
        || grant.requestHash !== input.requestHash) {
        return conflict();
      }
      const batchValue = await database.extensionByokExecutionBatch.findFirst({
        where: { id: input.executionBatchId },
        select: {
          id: true,
          status: true,
          ownerUserId: true,
          actorUserId: true,
          deviceSessionId: true,
          shopId: true,
          listingWorkflowId: true,
          draftRevision: true,
          draftVersion: true,
          firstAssignmentOrdinal: true,
          itemCount: true,
          boundDraftRevision: true,
          boundDraftVersion: true,
          items: {
            orderBy: { itemIndex: 'asc' },
            select: {
              id: true,
              itemIndex: true,
              skuKey: true,
              slotKey: true,
              assignmentOrdinal: true,
              status: true,
              executionIntents: {
                where: { id: { in: input.items.map((item) => item.executionIntentId) } },
                select: {
                  id: true,
                  outcome: true,
                  providerRequestHash: true,
                  resultSha256: true,
                },
              },
            },
          },
        },
      });
      const parsedBatch = executionBatchSchema.safeParse(batchValue);
      if (!parsedBatch.success) return conflict();
      const batch = parsedBatch.data;
      const succeeded = grant.receipt?.status === 'SUCCEEDED';
      if (batch.id !== input.executionBatchId
        || batch.ownerUserId !== input.ownerUserId
        || batch.actorUserId !== input.ownerUserId
        || batch.deviceSessionId !== input.sessionId
        || batch.shopId !== input.shopId
        || batch.listingWorkflowId !== input.workflowId
        || batch.draftRevision !== input.draftRevision
        || batch.draftVersion !== input.draftVersion
        || batch.firstAssignmentOrdinal !== input.items[0]!.assignmentOrdinal
        || batch.itemCount !== input.items.length
        || batch.items.length !== input.items.length
        || batch.status !== (succeeded ? 'BOUND' : 'OPEN')
        || batch.boundDraftRevision !== (succeeded ? input.draftRevision + 1 : null)
        || batch.boundDraftVersion !== (succeeded ? input.draftVersion + 1 : null)
        || batch.items.some((item, index) => {
          const expected = input.items[index]!;
          const intent = item.executionIntents[0]!;
          return item.itemIndex !== index
            || item.skuKey !== expected.skuKey
            || item.slotKey !== expected.slotKey
            || item.assignmentOrdinal !== expected.assignmentOrdinal
            || item.status !== (succeeded ? 'BOUND' : 'ACTIVE')
            || intent.id !== expected.executionIntentId
            || intent.providerRequestHash !== expected.providerRequestHash
            || intent.resultSha256 !== expected.providerResultSha256;
        })) {
        return conflict();
      }
      if (!grant.receipt) {
        const assetIds = input.items.map((item) => deriveByokGeneratedAssetId({
          ownerUserId: input.ownerUserId,
          idempotencyKey: deriveExtensionByokBatchItemIdempotencyKey(
            input.idempotencyKey,
            item.executionIntentId,
          ),
        }));
        const stagingValue = await database.extensionByokUploadStaging.findMany({
          where: {
            id: { in: assetIds },
            assetId: { in: assetIds },
            deviceSessionId: input.sessionId,
            ownerUserId: input.ownerUserId,
            requestHash: input.requestHash,
            status: { in: ['PENDING', 'CLEANING', 'COMMITTED'] },
          },
          select: { id: true, assetId: true, status: true },
        });
        if (!Array.isArray(stagingValue)) return conflict();
        if (stagingValue.length === 0) return { kind: 'not_committed' };
        const parsedStaging = z.array(stagingSchema).max(input.items.length).safeParse(stagingValue);
        if (!parsedStaging.success
          || new Set(parsedStaging.data.map((item) => item.id)).size !== parsedStaging.data.length
          || parsedStaging.data.some((item) => item.id !== item.assetId
            || !assetIds.includes(item.id))) {
          return conflict();
        }
        return { kind: 'pending', receiptId: null };
      }
      const { receipt } = grant;
      if (receipt.status === 'PENDING') {
        if (receipt.result !== null || receipt.failureCode !== null) return conflict();
        return { kind: 'pending', receiptId: receipt.id };
      }
      if (receipt.status === 'FAILED') {
        if (!receipt.failureCode) return conflict();
        return { kind: 'failed', receiptId: receipt.id };
      }
      if (receipt.failureCode !== null || receipt.result === null) return conflict();
      const parsedReceipt = receiptSchema.safeParse(receipt.result);
      if (!parsedReceipt.success) return conflict();
      const result = parsedReceipt.data;
      if (result.executionBatchId !== input.executionBatchId
        || result.requestHash !== input.requestHash
        || result.sourceDraftRevision !== input.draftRevision
        || result.sourceDraftVersion !== input.draftVersion
        || result.boundDraftRevision !== input.draftRevision + 1
        || result.boundDraftVersion !== input.draftVersion + 1
        || result.erpAiChargeCents !== 0
        || result.items.length !== input.items.length
        || result.items.some((item, index) => {
          const expected = input.items[index]!;
          return item.executionIntentId !== expected.executionIntentId
            || item.providerRequestHash !== expected.providerRequestHash
            || item.providerResultSha256 !== expected.providerResultSha256
            || item.skuKey !== expected.skuKey
            || item.slotKey !== expected.slotKey
            || item.assignmentOrdinal !== expected.assignmentOrdinal
            || !assignmentMatchesItem(item.assignment, item);
        })) {
        return conflict();
      }
      return { kind: 'succeeded', receiptId: receipt.id, receipt: result };
    },
  };
}

export type ExtensionByokMediaBatchIngestStatusRepository = ReturnType<
  typeof createPrismaExtensionByokMediaBatchIngestStatusRepository
>;
