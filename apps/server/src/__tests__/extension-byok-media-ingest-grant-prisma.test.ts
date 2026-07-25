import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ExtensionCommandBinding } from '../services/extension-command-grants.js';
import {
  EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
  EXTENSION_BYOK_MEDIA_INGEST_SCOPE,
  consumeByokMediaIngestGrantInTransaction,
} from '../services/extension-byok-media-ingest-grant.js';

const NOW = new Date('2026-07-25T08:00:00.000Z');

function binding(overrides: Partial<ExtensionCommandBinding> = {}): ExtensionCommandBinding {
  return {
    sessionId: 'session-1',
    tokenId: 'jti-1',
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
    workflowId: 'workflow-1',
    draftVersion: 7,
    idempotencyKey: 'byok-ingest-workflow-1-v7',
    requestHash: 'a'.repeat(64),
    ...overrides,
  };
}

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant-1',
    ...binding(),
    tokenDigest: 'b'.repeat(64),
    issuedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 60_000),
    consumedAt: null,
    revokedAt: null,
    revokedReason: null,
    sessionStatus: 'ACTIVE',
    sessionExpiresAt: new Date(NOW.getTime() + 60_000),
    currentJti: 'jti-1',
    sessionOwnerUserId: 'owner-1',
    actorUserId: 'owner-1',
    scopes: [EXTENSION_BYOK_MEDIA_INGEST_SCOPE],
    ownerStatus: 'ACTIVE',
    actorStatus: 'ACTIVE',
    ownerRole: 'USER',
    actorRole: 'USER',
    actorParentId: null,
    ...overrides,
  };
}

class ScriptedTransaction {
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];

  constructor(private readonly handler: (sql: string, params: unknown[]) => unknown[]) {}

  async $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T> {
    this.calls.push({ sql, params });
    return this.handler(sql, params) as T;
  }
}

describe('BYOK media ingest Prisma grant admission', () => {
  it('denies a legacy session without the dedicated scope before any mutation query', async () => {
    const tx = new ScriptedTransaction((sql) => {
      if (sql.includes('FROM "extension_command_grants" g')) {
        return [grantRow({ scopes: ['listing:write', 'media:execute'] })];
      }
      if (sql.includes('FROM "extension_command_receipts"')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(consumeByokMediaIngestGrantInTransaction(tx, {
      tokenDigest: 'b'.repeat(64), binding: binding(), receiptId: 'receipt-1', now: NOW,
    })).resolves.toEqual({ kind: 'scope_denied' });
    expect(tx.calls.some(({ sql }) => sql.includes('UPDATE "extension_command_grants"')))
      .toBe(false);
    expect(tx.calls.some(({ sql }) => sql.includes('INSERT INTO "extension_command_receipts"')))
      .toBe(false);
  });

  it('revalidates live scope before a PENDING replay can resume an ingest mutation', async () => {
    const tx = new ScriptedTransaction((sql) => {
      if (sql.includes('FROM "extension_command_grants" g')) {
        return [grantRow({ scopes: ['listing:write'], consumedAt: NOW })];
      }
      if (sql.includes('FROM "extension_command_receipts"')) {
        return [{
          id: 'receipt-1', grantId: 'grant-1', status: 'PENDING', result: null,
          failureCode: null, createdAt: NOW, completedAt: null,
        }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(consumeByokMediaIngestGrantInTransaction(tx, {
      tokenDigest: 'b'.repeat(64), binding: binding(), receiptId: 'receipt-retry', now: NOW,
    })).resolves.toEqual({ kind: 'scope_denied' });
    expect(tx.calls.some(({ sql }) => sql.includes('UPDATE "extension_command_grants"')))
      .toBe(false);
  });

  it('returns a terminal replay without requiring new authority because it cannot mutate again', async () => {
    const result = { type: 'BYOK_MEDIA_INGEST', assetId: 'asset-1' };
    const tx = new ScriptedTransaction((sql) => {
      if (sql.includes('FROM "extension_command_grants" g')) {
        return [grantRow({ scopes: [], consumedAt: NOW })];
      }
      if (sql.includes('FROM "extension_command_receipts"')) {
        return [{
          id: 'receipt-1', grantId: 'grant-1', status: 'SUCCEEDED', result,
          failureCode: null, createdAt: NOW, completedAt: NOW,
        }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(consumeByokMediaIngestGrantInTransaction(tx, {
      tokenDigest: 'b'.repeat(64), binding: binding(), receiptId: 'receipt-retry', now: NOW,
    })).resolves.toMatchObject({ kind: 'replay', receipt: { status: 'SUCCEEDED', result } });
    expect(tx.calls.some(({ sql }) => sql.includes('UPDATE "extension_command_grants"')))
      .toBe(false);
  });

  it('denies a transferred or revoked shop before consuming the grant', async () => {
    const tx = new ScriptedTransaction((sql) => {
      if (sql.includes('FROM "extension_command_grants" g')) return [grantRow()];
      if (sql.includes('FROM "extension_command_receipts"')) return [];
      if (sql.includes('FROM "extension_device_shop_grants"')) {
        return [{
          shopGrantStatus: 'REVOKED', shopOwnerUserId: 'owner-2',
          shopStatus: 'ACTIVE', platform: 'OZON',
        }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(consumeByokMediaIngestGrantInTransaction(tx, {
      tokenDigest: 'b'.repeat(64), binding: binding(), receiptId: 'receipt-1', now: NOW,
    })).resolves.toEqual({ kind: 'shop_denied' });
    expect(tx.calls.some(({ sql }) => sql.includes('UPDATE "extension_command_grants"')))
      .toBe(false);
  });

  it.each([
    ['disabled shop', { shopStatus: 'DISABLED', platform: 'OZON' }],
    ['platform transfer', { shopStatus: 'ACTIVE', platform: 'WILDBERRIES' }],
  ])('denies %s before consuming the grant', async (_label, shopContext) => {
    const tx = new ScriptedTransaction((sql) => {
      if (sql.includes('FROM "extension_command_grants" g')) return [grantRow()];
      if (sql.includes('FROM "extension_command_receipts"')) return [];
      if (sql.includes('FROM "extension_device_shop_grants"')) {
        return [{
          shopGrantStatus: 'ACTIVE', shopOwnerUserId: 'owner-1', ...shopContext,
        }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(consumeByokMediaIngestGrantInTransaction(tx, {
      tokenDigest: 'b'.repeat(64), binding: binding(), receiptId: 'receipt-1', now: NOW,
    })).resolves.toEqual({ kind: 'shop_denied' });
    expect(tx.calls.some(({ sql }) => sql.includes('UPDATE "extension_command_grants"')))
      .toBe(false);
  });

  it('accepts only an exact BYOK ingest binding and creates one pending receipt atomically', async () => {
    const tx = new ScriptedTransaction((sql) => {
      if (sql.includes('FROM "extension_command_grants" g')) return [grantRow()];
      if (sql.includes('FROM "extension_command_receipts"')) return [];
      if (sql.includes('FROM "extension_device_shop_grants"')) {
        return [{
          shopGrantStatus: 'ACTIVE', shopOwnerUserId: 'owner-1',
          shopStatus: 'ACTIVE', platform: 'OZON',
        }];
      }
      if (sql.includes('UPDATE "extension_command_grants"')) return [{ id: 'grant-1' }];
      if (sql.includes('INSERT INTO "extension_command_receipts"')) {
        return [{
          id: 'receipt-1', grantId: 'grant-1', status: 'PENDING', result: null,
          failureCode: null, createdAt: NOW, completedAt: null,
        }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(consumeByokMediaIngestGrantInTransaction(tx, {
      tokenDigest: 'b'.repeat(64), binding: binding(), receiptId: 'receipt-1', now: NOW,
    })).resolves.toMatchObject({ kind: 'execute', receipt: { id: 'receipt-1', status: 'PENDING' } });
    expect(tx.calls.find(({ sql }) => sql.includes('UPDATE "extension_command_grants"'))?.sql)
      .toContain('"expires_at" > $1');
  });

  it('persists the new operation and requires its shop/workflow/draft binding at the database layer', () => {
    const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
    const enumMigration = readFileSync(
      new URL('../../prisma/migrations/20260725103000_add_extension_byok_media_ingest_grant/migration.sql', import.meta.url),
      'utf8',
    );
    const bindingMigration = readFileSync(
      new URL('../../prisma/migrations/20260725104000_bind_extension_byok_media_ingest_grants/migration.sql', import.meta.url),
      'utf8',
    );

    expect(schema).toMatch(/enum ExtensionCommandOperation[\s\S]*BYOK_MEDIA_INGEST/u);
    expect(enumMigration).toContain("ADD VALUE IF NOT EXISTS 'BYOK_MEDIA_INGEST'");
    expect(enumMigration).not.toContain('extension_command_grant_byok_ingest_binding_check');
    expect(bindingMigration).toContain('extension_command_grant_byok_ingest_binding_check');
    expect(bindingMigration).toMatch(/"operation" <> 'BYOK_MEDIA_INGEST'[\s\S]*"shop_id" IS NOT NULL[\s\S]*"workflow_id" IS NOT NULL[\s\S]*"draft_version" IS NOT NULL/u);
  });
});
