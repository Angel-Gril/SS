import { randomUUID } from 'node:crypto';
import type {
  ImageUploadResult,
  OwnedImageStorageBackend,
} from './image-storage.js';
import {
  runExtensionCommandSerializableTransaction,
  type ExtensionCommandDatabaseClient,
  type ExtensionCommandTransactionClient,
} from './extension-command-grants-prisma.js';

export const EXTENSION_BYOK_UPLOAD_STAGING_TTL_MS = 15 * 60_000;
export const EXTENSION_BYOK_UPLOAD_CLEANUP_LEASE_MS = 60_000;
export const EXTENSION_BYOK_UPLOAD_CLEANUP_RETRY_MS = 60_000;

export type ExtensionByokUploadStagingStatus =
  | 'PENDING'
  | 'CLEANING'
  | 'COMMITTED'
  | 'CLEANED';

export interface ExtensionByokUploadStagingRecord {
  id: string;
  ownerUserId: string;
  deviceSessionId: string;
  assetId: string;
  requestHash: string;
  storageBackend: OwnedImageStorageBackend['backendType'];
  storageNamespaceId: string;
  storageKey: string;
  status: ExtensionByokUploadStagingStatus;
  expiresAt: Date;
  cleanupLeaseToken: string | null;
  cleanupLeaseUntil: Date | null;
  cleanupAttemptCount: number;
  lastError: string | null;
  committedAt: Date | null;
  cleanedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BeginExtensionByokUploadStagingInput {
  id: string;
  ownerUserId: string;
  deviceSessionId: string;
  assetId: string;
  requestHash: string;
  storageBackend: OwnedImageStorageBackend['backendType'];
  storageNamespaceId: string;
  storageKey: string;
  now: Date;
  expiresAt?: Date;
}

export type BeginExtensionByokUploadStagingResult = {
  kind: 'created' | 'reopened' | 'active';
  staging: ExtensionByokUploadStagingRecord;
};

export class ExtensionByokUploadStagingError extends Error {
  readonly code = 'BYOK_INGEST_STAGING_CONFLICT';
  readonly statusCode = 409;

  constructor(message = 'EXTENSION_BYOK_UPLOAD_STAGING_IDENTITY_CONFLICT') {
    super(message);
    this.name = 'ExtensionByokUploadStagingError';
  }
}

export interface ExtensionByokUploadStorageReference {
  assetId: string;
  ownerUserId: string;
  storageBackend: string;
  storageKey: string;
}

const STAGING_COLUMN_PROJECTIONS = [
  ['id', null],
  ['owner_user_id', 'ownerUserId'],
  ['device_session_id', 'deviceSessionId'],
  ['asset_id', 'assetId'],
  ['request_hash', 'requestHash'],
  ['storage_backend', 'storageBackend'],
  ['storage_namespace_id', 'storageNamespaceId'],
  ['storage_key', 'storageKey'],
  ['status', null],
  ['expires_at', 'expiresAt'],
  ['cleanup_lease_token', 'cleanupLeaseToken'],
  ['cleanup_lease_until', 'cleanupLeaseUntil'],
  ['cleanup_attempt_count', 'cleanupAttemptCount'],
  ['last_error', 'lastError'],
  ['committed_at', 'committedAt'],
  ['cleaned_at', 'cleanedAt'],
  ['created_at', 'createdAt'],
  ['updated_at', 'updatedAt'],
] as const;

function stagingColumns(tableAlias?: 'staging'): string {
  const qualifier = tableAlias ? `"${tableAlias}".` : '';
  return STAGING_COLUMN_PROJECTIONS.map(([column, resultName]) => (
    `  ${qualifier}"${column}"${resultName ? ` AS "${resultName}"` : ''}`
  )).join(',\n');
}

function record(row: any): ExtensionByokUploadStagingRecord {
  return {
    id: String(row.id),
    ownerUserId: String(row.ownerUserId),
    deviceSessionId: String(row.deviceSessionId),
    assetId: String(row.assetId),
    requestHash: String(row.requestHash),
    storageBackend: row.storageBackend,
    storageNamespaceId: String(row.storageNamespaceId),
    storageKey: String(row.storageKey),
    status: row.status,
    expiresAt: new Date(row.expiresAt),
    cleanupLeaseToken: row.cleanupLeaseToken == null ? null : String(row.cleanupLeaseToken),
    cleanupLeaseUntil: row.cleanupLeaseUntil == null ? null : new Date(row.cleanupLeaseUntil),
    cleanupAttemptCount: Number(row.cleanupAttemptCount),
    lastError: row.lastError == null ? null : String(row.lastError),
    committedAt: row.committedAt == null ? null : new Date(row.committedAt),
    cleanedAt: row.cleanedAt == null ? null : new Date(row.cleanedAt),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'cleanup failed');
  const printable = Array.from(message, (character) => {
    const code = character.codePointAt(0) || 0;
    return code < 32 || code === 127 ? ' ' : character;
  }).join('');
  return printable.slice(0, 500) || 'cleanup failed';
}

function exactStagingIdentity(
  staging: ExtensionByokUploadStagingRecord,
  input: BeginExtensionByokUploadStagingInput,
): boolean {
  return staging.id === input.id
    && staging.ownerUserId === input.ownerUserId
    && staging.deviceSessionId === input.deviceSessionId
    && staging.assetId === input.assetId
    && staging.requestHash === input.requestHash
    && staging.storageBackend === input.storageBackend
    && staging.storageNamespaceId === input.storageNamespaceId
    && staging.storageKey === input.storageKey;
}

function stagingConflict(): never {
  throw new ExtensionByokUploadStagingError();
}

export async function commitExtensionByokUploadStagingInTransaction(
  tx: ExtensionCommandTransactionClient,
  input: {
    stagingId: string;
    ownerUserId: string;
    deviceSessionId: string;
    assetId: string;
    requestHash: string;
    storageBackend: string;
    storageNamespaceId: string;
    storageKey: string;
    now: Date;
  },
): Promise<boolean> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE "extension_byok_upload_staging"
     SET "status" = 'COMMITTED',
         "committed_at" = $9,
         "cleanup_lease_token" = NULL,
         "cleanup_lease_until" = NULL,
         "last_error" = NULL,
         "updated_at" = $9
     WHERE "id" = $1
       AND "owner_user_id" = $2
       AND "device_session_id" = $3
       AND "asset_id" = $4
       AND "request_hash" = $5
       AND "storage_backend" = $6
       AND "storage_namespace_id" = $7
       AND "storage_key" = $8
       AND "status" = 'PENDING'
       AND "expires_at" > $9
     RETURNING "id"`,
    input.stagingId,
    input.ownerUserId,
    input.deviceSessionId,
    input.assetId,
    input.requestHash,
    input.storageBackend,
    input.storageNamespaceId,
    input.storageKey,
    input.now,
  );
  return rows.length === 1;
}

export function createPrismaExtensionByokUploadStagingStore(
  client: ExtensionCommandDatabaseClient,
) {
  return {
    async beginAttempt(
      input: BeginExtensionByokUploadStagingInput,
    ): Promise<BeginExtensionByokUploadStagingResult> {
      return runExtensionCommandSerializableTransaction(client, async (tx) => {
        const expiresAt = input.expiresAt
          || new Date(input.now.getTime() + EXTENSION_BYOK_UPLOAD_STAGING_TTL_MS);
        const inserted = await tx.$queryRawUnsafe<any[]>(
          `INSERT INTO "extension_byok_upload_staging"
            ("id", "owner_user_id", "device_session_id", "asset_id", "request_hash",
             "storage_backend", "storage_namespace_id", "storage_key", "status", "expires_at",
             "created_at", "updated_at")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', $9, $10, $10)
           ON CONFLICT DO NOTHING
           RETURNING ${stagingColumns()}`,
          input.id,
          input.ownerUserId,
          input.deviceSessionId,
          input.assetId,
          input.requestHash,
          input.storageBackend,
          input.storageNamespaceId,
          input.storageKey,
          expiresAt,
          input.now,
        );
        if (inserted[0]) return { kind: 'created', staging: record(inserted[0]) };

        const existingRows = await tx.$queryRawUnsafe<any[]>(
          `SELECT ${stagingColumns()}
           FROM "extension_byok_upload_staging"
           WHERE "id" = $1
           FOR UPDATE`,
          input.id,
        );
        if (!existingRows[0]) return stagingConflict();
        const existing = record(existingRows[0]);
        if (!exactStagingIdentity(existing, input)) return stagingConflict();
        if (existing.status !== 'CLEANED') {
          if (!['PENDING', 'CLEANING', 'COMMITTED'].includes(existing.status)) {
            return stagingConflict();
          }
          return { kind: 'active', staging: existing };
        }

        const reopened = await tx.$queryRawUnsafe<any[]>(
          `UPDATE "extension_byok_upload_staging"
           SET "status" = 'PENDING',
               "expires_at" = $2,
               "cleanup_lease_token" = NULL,
               "cleanup_lease_until" = NULL,
               "cleanup_attempt_count" = 0,
               "last_error" = NULL,
               "committed_at" = NULL,
               "cleaned_at" = NULL,
               "updated_at" = $3
           WHERE "id" = $1 AND "status" = 'CLEANED'
           RETURNING ${stagingColumns()}`,
          input.id,
          expiresAt,
          input.now,
        );
        if (!reopened[0]) return stagingConflict();
        return { kind: 'reopened', staging: record(reopened[0]) };
      });
    },

    async recordUploadedObject(input: {
      id: string;
      ownerUserId: string;
      deviceSessionId: string;
      storageBackend: OwnedImageStorageBackend['backendType'];
      storageNamespaceId: string;
      expectedStorageKey: string;
      actualStorageKey: string;
    }): Promise<boolean> {
      const rows = await client.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE "extension_byok_upload_staging"
         SET "storage_key" = $7, "updated_at" = clock_timestamp()
         WHERE "id" = $1
           AND "owner_user_id" = $2
           AND "device_session_id" = $3
           AND "storage_backend" = $4
           AND "storage_namespace_id" = $5
           AND "storage_key" = $6
           AND "status" = 'PENDING'
         RETURNING "id"`,
        input.id,
        input.ownerUserId,
        input.deviceSessionId,
        input.storageBackend,
        input.storageNamespaceId,
        input.expectedStorageKey,
        input.actualStorageKey,
      );
      return rows.length === 1;
    },

    async markImmediateCleaned(input: { id: string; now: Date }): Promise<boolean> {
      const rows = await client.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE "extension_byok_upload_staging"
         SET "status" = 'CLEANED', "cleaned_at" = $2, "last_error" = NULL,
             "cleanup_lease_token" = NULL, "cleanup_lease_until" = NULL, "updated_at" = $2
         WHERE "id" = $1 AND "status" = 'PENDING'
         RETURNING "id"`,
        input.id,
        input.now,
      );
      return rows.length === 1;
    },

    async markImmediateCleanupFailed(input: {
      id: string;
      now: Date;
      error: unknown;
    }): Promise<boolean> {
      const retryAt = new Date(input.now.getTime() + EXTENSION_BYOK_UPLOAD_CLEANUP_RETRY_MS);
      const rows = await client.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE "extension_byok_upload_staging"
         SET "expires_at" = $2, "last_error" = $3, "updated_at" = $4
         WHERE "id" = $1 AND "status" = 'PENDING'
         RETURNING "id"`,
        input.id,
        retryAt,
        boundedError(input.error),
        input.now,
      );
      return rows.length === 1;
    },

    async claimExpired(input: {
      now: Date;
      limit: number;
      leaseToken?: string;
      leaseMs?: number;
    }): Promise<{ leaseToken: string; records: ExtensionByokUploadStagingRecord[] }> {
      const leaseToken = input.leaseToken || randomUUID();
      const leaseUntil = new Date(
        input.now.getTime() + (input.leaseMs ?? EXTENSION_BYOK_UPLOAD_CLEANUP_LEASE_MS),
      );
      const rows = await client.$queryRawUnsafe<any[]>(
        `WITH candidates AS (
           SELECT "id"
           FROM "extension_byok_upload_staging"
           WHERE ("status" = 'PENDING' AND "expires_at" <= $1)
              OR ("status" = 'CLEANING' AND "cleanup_lease_until" <= $1)
           ORDER BY "expires_at" ASC, "id" ASC
           FOR UPDATE SKIP LOCKED
           LIMIT $2
         )
         UPDATE "extension_byok_upload_staging" staging
         SET "status" = 'CLEANING',
             "cleanup_lease_token" = $3,
             "cleanup_lease_until" = $4,
             "cleanup_attempt_count" = staging."cleanup_attempt_count" + 1,
             "updated_at" = $1
         FROM candidates
         WHERE staging."id" = candidates."id"
         RETURNING ${stagingColumns('staging')}`,
        input.now,
        Math.max(1, Math.min(100, Math.trunc(input.limit))),
        leaseToken,
        leaseUntil,
      );
      return { leaseToken, records: rows.map(record) };
    },

    async findStorageReference(
      staging: ExtensionByokUploadStagingRecord,
    ): Promise<ExtensionByokUploadStorageReference | null> {
      const rows = await client.$queryRawUnsafe<ExtensionByokUploadStorageReference[]>(
        `SELECT "id" AS "assetId", "owner_user_id" AS "ownerUserId",
                "storage_backend" AS "storageBackend", "storage_key" AS "storageKey"
         FROM "media_assets"
         WHERE "storage_backend" = $1 AND "storage_key" = $2
         ORDER BY ("id" = $3 AND "owner_user_id" = $4) DESC, "created_at" ASC
         LIMIT 1`,
        staging.storageBackend,
        staging.storageKey,
        staging.assetId,
        staging.ownerUserId,
      );
      return rows[0] || null;
    },

    async finishClaimAsCommitted(input: {
      id: string;
      leaseToken: string;
      now: Date;
      warning?: string;
    }): Promise<boolean> {
      const rows = await client.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE "extension_byok_upload_staging"
         SET "status" = 'COMMITTED', "committed_at" = $3, "last_error" = $4,
             "cleanup_lease_token" = NULL, "cleanup_lease_until" = NULL, "updated_at" = $3
         WHERE "id" = $1 AND "status" = 'CLEANING' AND "cleanup_lease_token" = $2
         RETURNING "id"`,
        input.id,
        input.leaseToken,
        input.now,
        input.warning ? boundedError(input.warning) : null,
      );
      return rows.length === 1;
    },

    async finishClaimAsCleaned(input: {
      id: string;
      leaseToken: string;
      now: Date;
    }): Promise<boolean> {
      const rows = await client.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE "extension_byok_upload_staging"
         SET "status" = 'CLEANED', "cleaned_at" = $3, "last_error" = NULL,
             "cleanup_lease_token" = NULL, "cleanup_lease_until" = NULL, "updated_at" = $3
         WHERE "id" = $1 AND "status" = 'CLEANING' AND "cleanup_lease_token" = $2
         RETURNING "id"`,
        input.id,
        input.leaseToken,
        input.now,
      );
      return rows.length === 1;
    },

    async retryClaim(input: {
      id: string;
      leaseToken: string;
      now: Date;
      error: unknown;
    }): Promise<boolean> {
      const retryAt = new Date(input.now.getTime() + EXTENSION_BYOK_UPLOAD_CLEANUP_RETRY_MS);
      const rows = await client.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE "extension_byok_upload_staging"
         SET "status" = 'PENDING', "expires_at" = $3, "last_error" = $4,
             "cleanup_lease_token" = NULL, "cleanup_lease_until" = NULL, "updated_at" = $5
         WHERE "id" = $1 AND "status" = 'CLEANING' AND "cleanup_lease_token" = $2
         RETURNING "id"`,
        input.id,
        input.leaseToken,
        retryAt,
        boundedError(input.error),
        input.now,
      );
      return rows.length === 1;
    },
  };
}

export type ExtensionByokUploadStagingStore = ReturnType<
  typeof createPrismaExtensionByokUploadStagingStore
>;

function cleanupResult(staging: ExtensionByokUploadStagingRecord): ImageUploadResult {
  return {
    url: 'https://staging.invalid/cleanup',
    filename: staging.storageKey,
    key: staging.storageKey,
    objectKey: staging.storageKey,
    backend: staging.storageBackend,
  };
}

export async function reconcileExpiredExtensionByokUploads(input: {
  store: ExtensionByokUploadStagingStore;
  getStorage(backend: OwnedImageStorageBackend['backendType']): Promise<OwnedImageStorageBackend>;
  now?: Date;
  limit?: number;
  leaseToken?: string;
  leaseMs?: number;
}): Promise<{ claimed: number; committed: number; cleaned: number; retried: number }> {
  const now = input.now || new Date();
  const claim = await input.store.claimExpired({
    now,
    limit: input.limit || 25,
    leaseToken: input.leaseToken,
    leaseMs: input.leaseMs,
  });
  let committed = 0;
  let cleaned = 0;
  let retried = 0;
  for (const staging of claim.records) {
    try {
      const reference = await input.store.findStorageReference(staging);
      if (reference) {
        const exact = reference.assetId === staging.assetId
          && reference.ownerUserId === staging.ownerUserId;
        if (await input.store.finishClaimAsCommitted({
          id: staging.id,
          leaseToken: claim.leaseToken,
          now,
          ...(exact ? {} : { warning: 'Storage key is referenced by a different MediaAsset' }),
        })) committed += 1;
        continue;
      }
      const storage = await input.getStorage(staging.storageBackend);
      if (storage.backendType !== staging.storageBackend) {
        throw new Error('Owned storage backend changed during orphan cleanup');
      }
      if (storage.namespaceId !== staging.storageNamespaceId) {
        throw new Error('Owned storage namespace changed during orphan cleanup');
      }
      await storage.deleteUploaded(cleanupResult(staging));
      if (await input.store.finishClaimAsCleaned({
        id: staging.id,
        leaseToken: claim.leaseToken,
        now,
      })) cleaned += 1;
    } catch (error) {
      if (await input.store.retryClaim({
        id: staging.id,
        leaseToken: claim.leaseToken,
        now,
        error,
      })) retried += 1;
    }
  }
  return { claimed: claim.records.length, committed, cleaned, retried };
}
