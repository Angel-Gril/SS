import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { OwnedImageStorageBackend } from '../services/image-storage.js';
import {
  commitExtensionByokUploadStagingInTransaction,
  createPrismaExtensionByokUploadStagingStore,
  reconcileExpiredExtensionByokUploads,
  type ExtensionByokUploadStagingRecord,
} from '../services/extension-byok-upload-staging.js';

const NOW = new Date('2026-07-26T02:00:00.000Z');

function staging(overrides: Partial<ExtensionByokUploadStagingRecord> = {}): ExtensionByokUploadStagingRecord {
  return {
    id: 'stage-1',
    ownerUserId: 'owner-1',
    deviceSessionId: 'session-1',
    assetId: 'asset-1',
    requestHash: 'a'.repeat(64),
    storageBackend: 'local',
    storageNamespaceId: '1'.repeat(64),
    storageKey: 'attempt-one.png',
    status: 'CLEANING',
    expiresAt: new Date(NOW.getTime() - 60_000),
    cleanupLeaseToken: 'old-lease',
    cleanupLeaseUntil: new Date(NOW.getTime() - 1),
    cleanupAttemptCount: 1,
    lastError: null,
    committedAt: null,
    cleanedAt: null,
    createdAt: new Date(NOW.getTime() - 120_000),
    updatedAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  };
}

function storageBackend(deleteUploaded = vi.fn(async () => undefined)): OwnedImageStorageBackend {
  return {
    backendType: 'local',
    namespaceId: '1'.repeat(64),
    upload: vi.fn(async () => { throw new Error('unused'); }),
    uploadBuffer: vi.fn(async () => { throw new Error('unused'); }),
    deleteUploaded,
  };
}

describe('extension BYOK upload staging', () => {
  it('installs a transactional durable staging ledger with cleanup lease indexes', () => {
    const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
    const migration = readFileSync(new URL(
      '../../prisma/migrations/20260725112000_add_extension_byok_upload_staging/migration.sql',
      import.meta.url,
    ), 'utf8');
    expect(schema).toMatch(/model ExtensionByokUploadStaging \{[\s\S]*cleanupLeaseToken[\s\S]*cleanupAttemptCount/u);
    expect(schema).toMatch(/model ExtensionByokUploadStaging \{[\s\S]*storageNamespaceId/u);
    expect(schema).toMatch(/model ExtensionByokIngestRateEvent \{/u);
    expect(schema).toMatch(/model ExtensionDeviceSession \{[\s\S]*byokUploadStaging\s+ExtensionByokUploadStaging\[\][\s\S]*byokIngestRateEvents\s+ExtensionByokIngestRateEvent\[\]/u);
    expect(schema).toMatch(/model ExtensionByokUploadStaging \{[\s\S]*deviceSession\s+ExtensionDeviceSession\s+@relation\(fields: \[deviceSessionId, ownerUserId\], references: \[id, ownerUserId\], onDelete: Restrict, onUpdate: NoAction\)/u);
    expect(schema).toMatch(/model ExtensionByokIngestRateEvent \{[\s\S]*deviceSession\s+ExtensionDeviceSession\s+@relation\(fields: \[deviceSessionId, ownerUserId\], references: \[id, ownerUserId\], onDelete: Cascade, onUpdate: NoAction\)/u);
    expect(migration.trimStart()).toMatch(/^BEGIN;/u);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u);
    expect(migration).toContain("SET LOCAL lock_timeout = '5s'");
    expect(migration).toContain('extension_byok_upload_staging_cleanup_idx');
    expect(migration).toContain("'CLEANING'");
    expect(migration).toMatch(/extension_byok_upload_staging_session_owner_fkey[\s\S]*ON DELETE RESTRICT ON UPDATE NO ACTION/u);
    expect(migration).toMatch(/extension_byok_ingest_rate_event_session_owner_fkey[\s\S]*ON DELETE CASCADE ON UPDATE NO ACTION/u);
  });

  it('persists the physical storage namespace when creating a staging row', async () => {
    const calls: string[] = [];
    const tx = {
      async $queryRawUnsafe<T>(sql: string): Promise<T> {
        calls.push(sql);
        return [{ ...staging({ status: 'PENDING', storageNamespaceId: '2'.repeat(64) }) }] as T;
      },
    };
    const client = {
      ...tx,
      async $transaction<T>(action: (value: typeof tx) => Promise<T>, options: unknown) {
        expect(options).toEqual({ isolationLevel: 'Serializable' });
        return action(tx);
      },
    };
    const store = createPrismaExtensionByokUploadStagingStore(client as never);
    await expect(store.beginAttempt({
      id: 'stage-1', ownerUserId: 'owner-1', deviceSessionId: 'session-1',
      assetId: 'asset-1', requestHash: 'a'.repeat(64), storageBackend: 'local',
      storageNamespaceId: '2'.repeat(64), storageKey: 'attempt-one.png', now: NOW,
    })).resolves.toMatchObject({ kind: 'created' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('"storage_namespace_id"');
  });

  it('returns an exact active lease instead of inserting a second PENDING attempt', async () => {
    let current: ExtensionByokUploadStagingRecord | null = null;
    let insertCount = 0;
    const tx = {
      async $queryRawUnsafe<T>(sql: string, ...values: unknown[]): Promise<T> {
        if (sql.includes('INSERT INTO "extension_byok_upload_staging"')) {
          insertCount += 1;
          if (current) return [] as T;
          current = staging({
            id: String(values[0]),
            status: 'PENDING',
            expiresAt: values[8] as Date,
            createdAt: values[9] as Date,
            updatedAt: values[9] as Date,
          });
          return [current] as T;
        }
        if (sql.includes('FROM "extension_byok_upload_staging"')) return [current] as T;
        throw new Error(`unexpected SQL: ${sql}`);
      },
    };
    const client = {
      ...tx,
      async $transaction<T>(action: (value: typeof tx) => Promise<T>) { return action(tx); },
    };
    const store = createPrismaExtensionByokUploadStagingStore(client as never);
    const attempt = {
      id: 'byok_deterministic_asset', ownerUserId: 'owner-1', deviceSessionId: 'session-1',
      assetId: 'asset-1', requestHash: 'a'.repeat(64), storageBackend: 'local' as const,
      storageNamespaceId: '1'.repeat(64), storageKey: 'attempt-one.png', now: NOW,
    };

    await expect(store.beginAttempt(attempt)).resolves.toMatchObject({ kind: 'created' });
    await expect(store.beginAttempt(attempt)).resolves.toMatchObject({
      kind: 'active',
      staging: { id: 'byok_deterministic_asset', status: 'PENDING' },
    });
    expect(insertCount).toBe(2);
  });

  it('reopens only an exact CLEANED lease with a fresh expiry', async () => {
    const cleaned = staging({
      id: 'byok_deterministic_asset',
      status: 'CLEANED',
      cleanedAt: new Date(NOW.getTime() - 60_000),
    });
    const calls: string[] = [];
    const tx = {
      async $queryRawUnsafe<T>(sql: string, ...values: unknown[]): Promise<T> {
        calls.push(sql);
        if (sql.includes('INSERT INTO "extension_byok_upload_staging"')) return [] as T;
        if (sql.includes('FROM "extension_byok_upload_staging"')) return [cleaned] as T;
        if (sql.includes('SET "status" = \'PENDING\'')) {
          return [{
            ...cleaned,
            status: 'PENDING',
            expiresAt: values[1] as Date,
            cleanedAt: null,
            updatedAt: values[2] as Date,
          }] as T;
        }
        throw new Error(`unexpected SQL: ${sql}`);
      },
    };
    const client = {
      ...tx,
      async $transaction<T>(action: (value: typeof tx) => Promise<T>) { return action(tx); },
    };
    const store = createPrismaExtensionByokUploadStagingStore(client as never);

    await expect(store.beginAttempt({
      id: cleaned.id, ownerUserId: cleaned.ownerUserId, deviceSessionId: cleaned.deviceSessionId,
      assetId: cleaned.assetId, requestHash: cleaned.requestHash,
      storageBackend: cleaned.storageBackend, storageNamespaceId: cleaned.storageNamespaceId,
      storageKey: cleaned.storageKey, now: NOW,
    })).resolves.toMatchObject({
      kind: 'reopened',
      staging: { status: 'PENDING', cleanedAt: null },
    });
    expect(calls.some((sql) => sql.includes('AND "status" = \'CLEANED\''))).toBe(true);
  });

  it('fails closed when a deterministic lease collides with changed identity or storage', async () => {
    const existing = staging({ id: 'byok_deterministic_asset', status: 'PENDING' });
    const tx = {
      async $queryRawUnsafe<T>(sql: string): Promise<T> {
        if (sql.includes('INSERT INTO "extension_byok_upload_staging"')) return [] as T;
        return [existing] as T;
      },
    };
    const client = {
      ...tx,
      async $transaction<T>(action: (value: typeof tx) => Promise<T>) { return action(tx); },
    };
    const store = createPrismaExtensionByokUploadStagingStore(client as never);

    await expect(store.beginAttempt({
      id: existing.id, ownerUserId: existing.ownerUserId, deviceSessionId: existing.deviceSessionId,
      assetId: existing.assetId, requestHash: existing.requestHash,
      storageBackend: existing.storageBackend, storageNamespaceId: existing.storageNamespaceId,
      storageKey: 'changed.png', now: NOW,
    })).rejects.toThrow('EXTENSION_BYOK_UPLOAD_STAGING_IDENTITY_CONFLICT');
  });

  it('retargets a pending cleanup row to the actual uploaded key before compensation', async () => {
    let observedSql = '';
    const client = {
      async $queryRawUnsafe<T>(sql: string): Promise<T> {
        observedSql = sql;
        return [{ id: 'stage-1' }] as T;
      },
      async $transaction<T>(): Promise<T> { throw new Error('unused'); },
    };
    const store = createPrismaExtensionByokUploadStagingStore(client as never);
    await expect(store.recordUploadedObject({
      id: 'stage-1', ownerUserId: 'owner-1', deviceSessionId: 'session-1',
      storageBackend: 'local', storageNamespaceId: '1'.repeat(64),
      expectedStorageKey: 'attempt-one.png', actualStorageKey: 'provider-returned.png',
    })).resolves.toBe(true);
    expect(observedSql).toContain('SET "storage_key" = $7');
    expect(observedSql).toContain('AND "storage_namespace_id" = $5');
    expect(observedSql).toContain('AND "storage_key" = $6');
  });

  it('requires an exact live PENDING staging identity inside the final commit transaction', async () => {
    let observedSql = '';
    const tx = {
      async $queryRawUnsafe<T>(sql: string): Promise<T> {
        observedSql = sql;
        return [{ id: 'stage-1' }] as T;
      },
    };
    await expect(commitExtensionByokUploadStagingInTransaction(tx, {
      stagingId: 'stage-1', ownerUserId: 'owner-1', deviceSessionId: 'session-1',
      assetId: 'asset-1', requestHash: 'a'.repeat(64), storageBackend: 'local',
      storageNamespaceId: '1'.repeat(64), storageKey: 'attempt-one.png', now: NOW,
    })).resolves.toBe(true);
    expect(observedSql).toContain('"status" = \'PENDING\'');
    expect(observedSql).toContain('"expires_at" > $9');
    expect(observedSql).toContain('"status" = \'COMMITTED\'');
  });

  it('reclaims abandoned CLEANING rows only after their lease expires', async () => {
    let observedSql = '';
    const claimed = staging({
      cleanupLeaseToken: 'new-lease',
      cleanupLeaseUntil: new Date(NOW.getTime() + 60_000),
      cleanupAttemptCount: 2,
      updatedAt: NOW,
    });
    const client = {
      async $queryRawUnsafe<T>(sql: string): Promise<T> {
        observedSql = sql;
        return [claimed] as T;
      },
      async $transaction<T>(): Promise<T> {
        throw new Error('unused');
      },
    };
    const store = createPrismaExtensionByokUploadStagingStore(client as never);
    await expect(store.claimExpired({
      now: NOW,
      limit: 25,
      leaseToken: 'new-lease',
    })).resolves.toMatchObject({
      leaseToken: 'new-lease',
      records: [{ id: 'stage-1', cleanupAttemptCount: 2 }],
    });
    expect(observedSql).toContain('"status" = \'CLEANING\' AND "cleanup_lease_until" <= $1');
    expect(observedSql).toContain('FOR UPDATE SKIP LOCKED');
    expect(observedSql).toContain('"cleanup_lease_token" = $3');
    expect(observedSql).toMatch(/RETURNING\s+"staging"\."id"/u);
    expect(observedSql).toContain('"staging"."cleanup_lease_token" AS "cleanupLeaseToken"');
  });

  it('reclaims an expired cleanup lease and idempotently removes a crash orphan', async () => {
    const expiredClaim = staging();
    const deleteUploaded = vi.fn(async () => undefined);
    const store = {
      claimExpired: vi.fn(async () => ({ leaseToken: 'new-lease', records: [expiredClaim] })),
      findStorageReference: vi.fn(async () => null),
      finishClaimAsCommitted: vi.fn(async () => true),
      finishClaimAsCleaned: vi.fn(async () => true),
      retryClaim: vi.fn(async () => true),
    } as any;
    const result = await reconcileExpiredExtensionByokUploads({
      store,
      getStorage: async () => storageBackend(deleteUploaded),
      now: NOW,
      leaseToken: 'new-lease',
    });
    expect(result).toEqual({ claimed: 1, committed: 0, cleaned: 1, retried: 0 });
    expect(deleteUploaded).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'local', filename: 'attempt-one.png', objectKey: 'attempt-one.png',
    }));
    expect(store.finishClaimAsCleaned).toHaveBeenCalledWith({
      id: 'stage-1', leaseToken: 'new-lease', now: NOW,
    });
    expect(store.retryClaim).not.toHaveBeenCalled();
  });

  it('recovers the actual provider-returned key after immediate deletion failed', async () => {
    const actual = staging({ storageKey: 'provider-returned.png' });
    const deleteUploaded = vi.fn(async () => undefined);
    const store = {
      claimExpired: vi.fn(async () => ({ leaseToken: 'lease-actual', records: [actual] })),
      findStorageReference: vi.fn(async () => null),
      finishClaimAsCommitted: vi.fn(async () => true),
      finishClaimAsCleaned: vi.fn(async () => true),
      retryClaim: vi.fn(async () => true),
    } as any;
    await expect(reconcileExpiredExtensionByokUploads({
      store,
      getStorage: async () => storageBackend(deleteUploaded),
      now: NOW,
    })).resolves.toEqual({ claimed: 1, committed: 0, cleaned: 1, retried: 0 });
    expect(deleteUploaded).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'provider-returned.png', objectKey: 'provider-returned.png',
    }));
  });

  it('fails closed when the current backend resolves to another physical namespace', async () => {
    const claimed = staging();
    const deleteUploaded = vi.fn(async () => undefined);
    const store = {
      claimExpired: vi.fn(async () => ({ leaseToken: 'lease-1', records: [claimed] })),
      findStorageReference: vi.fn(async () => null),
      finishClaimAsCommitted: vi.fn(async () => true),
      finishClaimAsCleaned: vi.fn(async () => true),
      retryClaim: vi.fn(async () => true),
    } as any;
    const changedStorage = storageBackend(deleteUploaded);
    Object.defineProperty(changedStorage, 'namespaceId', { value: '9'.repeat(64) });
    await expect(reconcileExpiredExtensionByokUploads({
      store,
      getStorage: async () => changedStorage,
      now: NOW,
    })).resolves.toEqual({ claimed: 1, committed: 0, cleaned: 0, retried: 1 });
    expect(deleteUploaded).not.toHaveBeenCalled();
    expect(store.retryClaim).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ message: 'Owned storage namespace changed during orphan cleanup' }),
    }));
  });

  it('never deletes a staged object that a committed MediaAsset references', async () => {
    const claimed = staging({ cleanupLeaseToken: 'lease-1' });
    const deleteUploaded = vi.fn(async () => undefined);
    const store = {
      claimExpired: vi.fn(async () => ({ leaseToken: 'lease-1', records: [claimed] })),
      findStorageReference: vi.fn(async () => ({
        assetId: claimed.assetId,
        ownerUserId: claimed.ownerUserId,
        storageBackend: claimed.storageBackend,
        storageKey: claimed.storageKey,
      })),
      finishClaimAsCommitted: vi.fn(async () => true),
      finishClaimAsCleaned: vi.fn(async () => true),
      retryClaim: vi.fn(async () => true),
    } as any;
    const result = await reconcileExpiredExtensionByokUploads({
      store,
      getStorage: async () => storageBackend(deleteUploaded),
      now: NOW,
    });
    expect(result).toEqual({ claimed: 1, committed: 1, cleaned: 0, retried: 0 });
    expect(deleteUploaded).not.toHaveBeenCalled();
    expect(store.finishClaimAsCommitted).toHaveBeenCalledOnce();
  });

  it('releases a failed cleanup claim for retry instead of stranding CLEANING state', async () => {
    const claimed = staging({ cleanupLeaseToken: 'lease-1' });
    const store = {
      claimExpired: vi.fn(async () => ({ leaseToken: 'lease-1', records: [claimed] })),
      findStorageReference: vi.fn(async () => null),
      finishClaimAsCommitted: vi.fn(async () => true),
      finishClaimAsCleaned: vi.fn(async () => true),
      retryClaim: vi.fn(async () => true),
    } as any;
    const result = await reconcileExpiredExtensionByokUploads({
      store,
      getStorage: async () => storageBackend(vi.fn(async () => { throw new Error('temporary delete failure'); })),
      now: NOW,
    });
    expect(result).toEqual({ claimed: 1, committed: 0, cleaned: 0, retried: 1 });
    expect(store.retryClaim).toHaveBeenCalledWith(expect.objectContaining({
      id: 'stage-1', leaseToken: 'lease-1', now: NOW,
      error: expect.objectContaining({ message: 'temporary delete failure' }),
    }));
  });
});
