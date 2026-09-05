import { createHash, randomUUID } from 'node:crypto';

export type SourceListingAiCopyExecutionClaim =
  | { kind: 'claimed'; executionId: string }
  | { kind: 'replay'; executionId: string }
  | { kind: 'in_progress'; executionId: string }
  | { kind: 'unknown'; executionId: string }
  | { kind: 'conflict'; executionId: string };

export interface SourceListingAiCopyExecutionStore {
  claim(input: {
    ownerUserId: string;
    draftId: string;
    operationKey: string;
    clientRequestHash: string;
  }): Promise<SourceListingAiCopyExecutionClaim>;
  complete(executionId: string): Promise<void>;
  release(executionId: string): Promise<void>;
  markUnknown(executionId: string): Promise<void>;
}

interface SqlClient {
  $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T>;
  $transaction<T>(action: (tx: SqlClient) => Promise<T>, options?: { isolationLevel?: 'Serializable' }): Promise<T>;
}

function lockKey(ownerUserId: string, draftId: string, operationKey: string): string {
  return createHash('sha256')
    .update(`source-listing-ai-copy-execution/v1\0${ownerUserId}\0${draftId}\0${operationKey}`)
    .digest('hex');
}

export function createPrismaSourceListingAiCopyExecutionStore(options: {
  client: SqlClient;
}): SourceListingAiCopyExecutionStore {
  return {
    async claim(input) {
      return options.client.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended($1, 0))',
          lockKey(input.ownerUserId, input.draftId, input.operationKey),
        );
        const existing = await tx.$queryRawUnsafe<any[]>(
          `SELECT "id", "status", "client_request_hash" AS "clientRequestHash"
           FROM "source_listing_ai_copy_executions"
           WHERE "owner_user_id" = $1 AND "draft_id" = $2 AND "operation_key" = $3
           FOR UPDATE`,
          input.ownerUserId,
          input.draftId,
          input.operationKey,
        );
        if (!existing[0]) {
          const id = randomUUID();
          await tx.$queryRawUnsafe(
            `INSERT INTO "source_listing_ai_copy_executions"
              ("id", "owner_user_id", "draft_id", "operation_key", "client_request_hash", "status", "created_at", "updated_at")
             VALUES ($1, $2, $3, $4, $5, 'CLAIMED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            id,
            input.ownerUserId,
            input.draftId,
            input.operationKey,
            input.clientRequestHash,
          );
          return { kind: 'claimed', executionId: id } as const;
        }
        const row = existing[0];
        if (String(row.clientRequestHash) !== input.clientRequestHash) {
          return { kind: 'conflict', executionId: String(row.id) } as const;
        }
        if (row.status === 'SUCCEEDED') return { kind: 'replay', executionId: String(row.id) } as const;
        if (row.status === 'UNKNOWN') return { kind: 'unknown', executionId: String(row.id) } as const;
        return { kind: 'in_progress', executionId: String(row.id) } as const;
      });
    },
    async complete(executionId) {
      await options.client.$queryRawUnsafe(
        `UPDATE "source_listing_ai_copy_executions"
         SET "status" = 'SUCCEEDED', "updated_at" = CURRENT_TIMESTAMP
         WHERE "id" = $1`,
        executionId,
      );
    },
    async release(executionId) {
      await options.client.$queryRawUnsafe(
        `DELETE FROM "source_listing_ai_copy_executions" WHERE "id" = $1 AND "status" = 'CLAIMED'`,
        executionId,
      );
    },
    async markUnknown(executionId) {
      await options.client.$queryRawUnsafe(
        `UPDATE "source_listing_ai_copy_executions"
         SET "status" = 'UNKNOWN', "updated_at" = CURRENT_TIMESTAMP
         WHERE "id" = $1 AND "status" = 'CLAIMED'`,
        executionId,
      );
    },
  };
}
