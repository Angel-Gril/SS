import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const identifier = z.string().min(1).max(500)
  .refine((value) => value === value.normalize('NFKC').trim());
const requestHash = z.string().regex(/^[a-f0-9]{64}$/u);
const failureCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/u);

const rowSchema = z.object({
  sessionId: identifier,
  ownerUserId: identifier,
  operation: z.literal('OZON_PUBLISH'),
  shopId: identifier.nullable(),
  workflowId: identifier.nullable(),
  draftVersion: z.number().int().positive().nullable(),
  idempotencyKey: identifier,
  requestHash,
  consumedAt: z.date().nullable(),
  receipt: z.object({
    id: identifier,
    status: z.string().min(1).max(30),
    result: z.unknown().nullable(),
    failureCode: z.string().min(1).max(100).nullable(),
  }).strict().nullable(),
}).strict();

export interface ExtensionByokListingPublishStatusLookupInput {
  sessionId: string;
  ownerUserId: string;
  shopId: string;
  workflowId: string;
  draftVersion: number;
  idempotencyKey: string;
  requestHash: string;
}

export type ExtensionByokListingPublishStatusResult =
  | { kind: 'not_committed' }
  | { kind: 'pending'; receiptId: string }
  | { kind: 'succeeded'; receiptId: string }
  | { kind: 'failed'; receiptId: string; failureCode: string };

export class ExtensionByokPublishStatusRepositoryError extends Error {
  constructor(
    public readonly code: 'EXTENSION_BYOK_PUBLISH_STATUS_CONFLICT',
    public readonly statusCode: 409,
    message = 'Extension BYOK publish status identity conflicts',
  ) {
    super(message);
    this.name = 'ExtensionByokPublishStatusRepositoryError';
  }
}

function conflict(): never {
  throw new ExtensionByokPublishStatusRepositoryError(
    'EXTENSION_BYOK_PUBLISH_STATUS_CONFLICT',
    409,
  );
}

type StatusDatabaseClient = {
  extensionCommandGrant: {
    findFirst(input: unknown): Promise<unknown>;
  };
};

export interface ExtensionByokListingPublishStatusRepository {
  findStatus(
    input: ExtensionByokListingPublishStatusLookupInput,
  ): Promise<ExtensionByokListingPublishStatusResult>;
}

export function createPrismaExtensionByokPublishStatusRepository(
  client: PrismaClient | StatusDatabaseClient = prisma,
): ExtensionByokListingPublishStatusRepository {
  const database = client as unknown as StatusDatabaseClient;
  return {
    async findStatus(input) {
      // sessionId + idempotencyKey is globally unique. Query that identity
      // without narrowing the remaining fields so reuse across another
      // operation, owner, shop, or draft is reported as a conflict.
      const value = await database.extensionCommandGrant.findFirst({
        where: {
          sessionId: input.sessionId,
          idempotencyKey: input.idempotencyKey,
        },
        select: {
          sessionId: true,
          ownerUserId: true,
          operation: true,
          shopId: true,
          workflowId: true,
          draftVersion: true,
          idempotencyKey: true,
          requestHash: true,
          consumedAt: true,
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
      if (value == null) return { kind: 'not_committed' };
      const parsed = rowSchema.safeParse(value);
      if (!parsed.success) return conflict();
      const row = parsed.data;
      if (row.sessionId !== input.sessionId
        || row.ownerUserId !== input.ownerUserId
        || row.shopId !== input.shopId
        || row.workflowId !== input.workflowId
        || row.draftVersion !== input.draftVersion
        || row.idempotencyKey !== input.idempotencyKey
        || row.requestHash !== input.requestHash) {
        return conflict();
      }
      if (!row.receipt) {
        if (row.consumedAt !== null) return conflict();
        return { kind: 'not_committed' };
      }
      if (row.consumedAt === null) return conflict();
      const receipt = row.receipt;
      if (receipt.status === 'PENDING') {
        if (receipt.result !== null || receipt.failureCode !== null) return conflict();
        return { kind: 'pending', receiptId: receipt.id };
      }
      if (receipt.status === 'SUCCEEDED') {
        if (receipt.result === null || receipt.failureCode !== null) return conflict();
        return { kind: 'succeeded', receiptId: receipt.id };
      }
      if (receipt.status === 'FAILED') {
        const parsedFailure = failureCode.safeParse(receipt.failureCode);
        if (!parsedFailure.success) return conflict();
        return {
          kind: 'failed',
          receiptId: receipt.id,
          failureCode: parsedFailure.data,
        };
      }
      return conflict();
    },
  };
}
