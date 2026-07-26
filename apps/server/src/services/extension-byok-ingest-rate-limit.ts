import {
  runExtensionCommandSerializableTransaction,
  type ExtensionCommandDatabaseClient,
} from './extension-command-grants-prisma.js';

export const EXTENSION_BYOK_INGEST_RATE_WINDOW_MS = 60_000;
export const EXTENSION_BYOK_INGEST_RATE_EVENT_RETENTION_MS = 24 * 60 * 60_000;

export type ExtensionByokIngestRateDecision =
  | {
    kind: 'allowed';
    limit: number;
    remaining: number;
    occurredAt: Date;
  }
  | {
    kind: 'rate_limited';
    limit: number;
    retryAt: Date;
    occurredAt: Date;
  };

export function createPrismaExtensionByokIngestRateLimiter(
  client: ExtensionCommandDatabaseClient,
) {
  return {
    async consume(input: {
      id: string;
      ownerUserId: string;
      deviceSessionId: string;
      limit: number;
    }): Promise<ExtensionByokIngestRateDecision> {
      const limit = Math.max(1, Math.min(100, Math.trunc(input.limit)));
      return runExtensionCommandSerializableTransaction(client, async (tx) => {
        const sessions = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT "id"
           FROM "extension_device_sessions"
           WHERE "id" = $1 AND "owner_user_id" = $2
           FOR UPDATE`,
          input.deviceSessionId,
          input.ownerUserId,
        );
        if (!sessions[0]) throw new Error('EXTENSION_BYOK_INGEST_RATE_SESSION_NOT_FOUND');

        const rows = await tx.$queryRawUnsafe<Array<{
          priorCount: bigint;
          earliest: Date | null;
          occurredAt: Date;
        }>>(
          `WITH db_clock AS (
             SELECT clock_timestamp() AS "now"
           ), prior_window AS (
             SELECT COUNT(*) AS "priorCount", MIN("occurred_at") AS "earliest"
             FROM "extension_byok_ingest_rate_events", db_clock
             WHERE "device_session_id" = $3
               AND "occurred_at" >= db_clock."now" - ($4 * INTERVAL '1 millisecond')
               AND "occurred_at" <= db_clock."now"
           ), pruned AS (
             DELETE FROM "extension_byok_ingest_rate_events"
             USING db_clock
             WHERE "device_session_id" = $3
               AND "occurred_at" < db_clock."now" - ($5 * INTERVAL '1 millisecond')
           ), inserted AS (
             INSERT INTO "extension_byok_ingest_rate_events"
               ("id", "owner_user_id", "device_session_id", "occurred_at")
             SELECT $1, $2, $3, db_clock."now" FROM db_clock
             RETURNING "occurred_at" AS "occurredAt"
           )
           SELECT prior_window."priorCount", prior_window."earliest", inserted."occurredAt"
           FROM prior_window CROSS JOIN inserted`,
          input.id,
          input.ownerUserId,
          input.deviceSessionId,
          EXTENSION_BYOK_INGEST_RATE_WINDOW_MS,
          EXTENSION_BYOK_INGEST_RATE_EVENT_RETENTION_MS,
        );
        if (!rows[0]) throw new Error('EXTENSION_BYOK_INGEST_RATE_EVENT_INSERT_FAILED');
        const priorCount = Number(rows[0].priorCount || 0);
        const occurredAt = new Date(rows[0].occurredAt);
        if (priorCount >= limit) {
          const earliest = rows[0].earliest ? new Date(rows[0].earliest) : occurredAt;
          return {
            kind: 'rate_limited',
            limit,
            retryAt: new Date(earliest.getTime() + EXTENSION_BYOK_INGEST_RATE_WINDOW_MS),
            occurredAt,
          };
        }
        return {
          kind: 'allowed',
          limit,
          remaining: Math.max(0, limit - priorCount - 1),
          occurredAt,
        };
      });
    },
  };
}

export type ExtensionByokIngestRateLimiter = ReturnType<
  typeof createPrismaExtensionByokIngestRateLimiter
>;
