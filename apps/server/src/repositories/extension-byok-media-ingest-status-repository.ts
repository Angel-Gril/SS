import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import {
  EXTENSION_BYOK_MEDIA_INGEST_RECEIPT_VERSION,
  type ExtensionByokMediaIngestReceiptResult,
} from './extension-byok-generated-asset-commit-prisma.js';
import {
  type ExtensionByokMediaIngestStatusLookupInput,
} from '../services/extension-byok-media-ingest-status.js';
import { EXTENSION_BYOK_MEDIA_INGEST_OPERATION } from '../services/extension-byok-media-ingest-grant.js';
import { deriveByokGeneratedAssetId } from '../services/byok-generated-asset-ingest.js';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const identifier = z.string().min(1).max(500);

const receiptResultSchema: z.ZodType<ExtensionByokMediaIngestReceiptResult> = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_MEDIA_INGEST_RECEIPT_VERSION),
  requestHash: sha256,
  assetId: identifier,
  provenanceId: identifier,
  normalizedSha256: sha256,
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  workflowId: identifier,
  draftRevision: z.number().int().positive(),
  draftVersion: z.number().int().positive(),
  boundDraftRevision: z.number().int().positive(),
  boundDraftVersion: z.number().int().positive(),
  skuKey: identifier,
  slotKey: identifier,
  assignmentOrdinal: z.number().int().min(0).max(499),
  assignmentSha256: sha256,
  policyRevision: z.number().int().nonnegative(),
}).strict();

const grantRowSchema = z.object({
  shopId: identifier.nullable(),
  workflowId: identifier.nullable(),
  draftVersion: z.number().int().positive().nullable(),
  requestHash: sha256,
  receipt: z.object({
    id: identifier,
    status: z.string().min(1).max(30),
    result: z.unknown().nullable(),
    failureCode: z.string().min(1).max(200).nullable(),
  }).strict().nullable(),
}).strict();

const activeStagingSchema = z.object({
  id: identifier,
  status: z.enum(['PENDING', 'CLEANING', 'COMMITTED']),
}).strict();

export interface ExtensionByokMediaIngestPublicReceipt {
  assetId: string;
  provenanceId: string;
  normalizedSha256: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  sourceDraftRevision: number;
  sourceDraftVersion: number;
  boundDraftRevision: number;
  boundDraftVersion: number;
  skuKey: string;
  slotKey: string;
  assignmentOrdinal: number;
  assignmentSha256: string;
}

export type ExtensionByokMediaIngestStatusResult =
  | { kind: 'not_found' }
  | { kind: 'not_committed' }
  | { kind: 'pending'; receiptId: string | null }
  | { kind: 'failed'; receiptId: string }
  | {
    kind: 'succeeded';
    receiptId: string;
    receipt: ExtensionByokMediaIngestPublicReceipt;
  };

export class ExtensionByokMediaIngestStatusRepositoryError extends Error {
  constructor(
    public readonly code: 'BYOK_INGEST_STATUS_CONFLICT',
    public readonly statusCode: 409,
    message = 'BYOK ingest status identity conflicts',
  ) {
    super(message);
    this.name = 'ExtensionByokMediaIngestStatusRepositoryError';
  }
}

function conflict(): never {
  throw new ExtensionByokMediaIngestStatusRepositoryError(
    'BYOK_INGEST_STATUS_CONFLICT',
    409,
  );
}

type StatusDatabaseClient = {
  extensionCommandGrant: {
    findFirst(input: unknown): Promise<unknown>;
  };
  extensionByokUploadStaging: {
    findFirst(input: unknown): Promise<unknown>;
  };
};

export interface ExtensionByokMediaIngestStatusRepository {
  findStatus(
    input: ExtensionByokMediaIngestStatusLookupInput,
  ): Promise<ExtensionByokMediaIngestStatusResult>;
}

export function createPrismaExtensionByokMediaIngestStatusRepository(
  client: PrismaClient | StatusDatabaseClient = prisma,
): ExtensionByokMediaIngestStatusRepository {
  const database = client as unknown as StatusDatabaseClient;
  return {
    async findStatus(input) {
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
            select: {
              id: true,
              status: true,
              result: true,
              failureCode: true,
            },
          },
        },
      });
      if (value == null) return { kind: 'not_found' };
      const parsedGrant = grantRowSchema.safeParse(value);
      if (!parsedGrant.success) return conflict();
      const grant = parsedGrant.data;
      if (grant.requestHash !== input.requestHash
        || grant.shopId !== input.shopId
        || grant.workflowId !== input.workflowId
        || grant.draftVersion !== input.draftVersion) {
        return conflict();
      }
      if (!grant.receipt) {
        const assetId = deriveByokGeneratedAssetId({
          ownerUserId: input.ownerUserId,
          idempotencyKey: input.idempotencyKey,
        });
        const stagingValue = await database.extensionByokUploadStaging.findFirst({
          where: {
            id: assetId,
            assetId,
            deviceSessionId: input.sessionId,
            ownerUserId: input.ownerUserId,
            requestHash: input.requestHash,
            status: { in: ['PENDING', 'CLEANING', 'COMMITTED'] },
          },
          select: { id: true, status: true },
        });
        if (stagingValue == null) return { kind: 'not_committed' };
        if (!activeStagingSchema.safeParse(stagingValue).success) return conflict();
        return { kind: 'pending', receiptId: null };
      }

      const { receipt } = grant;
      if (receipt.status === 'PENDING') {
        if (receipt.result !== null || receipt.failureCode !== null) return conflict();
        return { kind: 'pending', receiptId: receipt.id };
      }
      if (receipt.status === 'FAILED') {
        if (receipt.failureCode === null) return conflict();
        return { kind: 'failed', receiptId: receipt.id };
      }
      if (receipt.status !== 'SUCCEEDED'
        || receipt.failureCode !== null
        || receipt.result === null) {
        return conflict();
      }

      const parsedReceipt = receiptResultSchema.safeParse(receipt.result);
      if (!parsedReceipt.success) return conflict();
      const result = parsedReceipt.data;
      if (result.requestHash !== grant.requestHash
        || result.workflowId !== input.workflowId
        || result.draftRevision !== input.draftRevision
        || result.draftVersion !== input.draftVersion
        || result.boundDraftRevision !== input.draftRevision + 1
        || result.boundDraftVersion !== input.draftVersion + 1
        || result.skuKey !== input.skuKey
        || result.slotKey !== input.slotKey
        || result.assignmentOrdinal !== input.assignmentOrdinal) {
        return conflict();
      }

      return {
        kind: 'succeeded',
        receiptId: receipt.id,
        receipt: {
          assetId: result.assetId,
          provenanceId: result.provenanceId,
          normalizedSha256: result.normalizedSha256,
          mimeType: result.mimeType,
          width: result.width,
          height: result.height,
          sourceDraftRevision: result.draftRevision,
          sourceDraftVersion: result.draftVersion,
          boundDraftRevision: result.boundDraftRevision,
          boundDraftVersion: result.boundDraftVersion,
          skuKey: result.skuKey,
          slotKey: result.slotKey,
          assignmentOrdinal: result.assignmentOrdinal,
          assignmentSha256: result.assignmentSha256,
        },
      };
    },
  };
}
