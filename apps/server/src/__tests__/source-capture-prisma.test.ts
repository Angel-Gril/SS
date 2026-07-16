import { readFileSync } from 'node:fs';
import type { SourceProductCaptureV2Submission } from 'shared';
import { describe, expect, it } from 'vitest';
import { digestExtensionCommandGrantToken } from '../services/extension-command-grants.js';
import { createPrismaSourceCaptureRepository } from '../services/source-capture-prisma.js';
import {
  buildSourceCaptureCommandEnvelope,
  createSourceCaptureService,
  type PreparedNativeSourceCapture,
  type SourceCaptureRepository,
} from '../services/source-capture.js';

const NOW = new Date('2026-07-14T10:00:00.000Z');
const SECRET = 'source-capture-command-secret-0123456789';
const TOKEN = 'g'.repeat(43);
const fixture = JSON.parse(readFileSync(new URL(
  '../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json',
  import.meta.url,
), 'utf8')) as SourceProductCaptureV2Submission;

type QueryHandler = (sql: string, params: unknown[]) => unknown[] | Promise<unknown[]>;

class ScriptedClient {
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];
  readonly transactionOptions: Array<{ isolationLevel?: 'Serializable' } | undefined> = [];

  constructor(private readonly handler: QueryHandler) {}

  async $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T> {
    this.calls.push({ sql, params });
    return await this.handler(sql, params) as T;
  }

  async $transaction<T>(
    action: (tx: ScriptedClient) => Promise<T>,
    options?: { isolationLevel?: 'Serializable' },
  ): Promise<T> {
    this.transactionOptions.push(options);
    return action(this);
  }
}

async function preparedNative(): Promise<PreparedNativeSourceCapture> {
  let prepared: PreparedNativeSourceCapture | null = null;
  const captureRepository: SourceCaptureRepository = {
    async ingestNative(input) {
      prepared = input;
      return {
        kind: 'created', subjectId: 'unused', snapshotId: 'unused', snapshotVersion: 1,
        supplyGoodsId: 'unused', captureHash: input.captureHash,
      };
    },
    async ingestLegacy() { throw new Error('unused'); },
    async loadLegacyProjection() { return null; },
    async ensureLegacyProjection() { throw new Error('unused'); },
  };
  await createSourceCaptureService({ repository: captureRepository }).ingest({
    trusted: {
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      deviceSessionId: 'session-1',
      tokenId: 'jti-1',
      rolloutRevision: 'pilot-1',
      rolloutStage: 'shadow_write',
      ingestChannel: 'EXTENSION_DEVICE',
    },
    submission: fixture,
    grant: {
      token: TOKEN,
      idempotencyKey: 'capture-1000000000003-v1',
      requestHash: buildSourceCaptureCommandEnvelope(fixture).requestHash,
    },
  });
  if (!prepared) throw new Error('capture was not prepared');
  return prepared;
}

function grantRow(input: PreparedNativeSourceCapture, overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant-1',
    sessionId: input.deviceSessionId,
    tokenId: input.tokenId,
    ownerUserId: input.ownerUserId,
    shopId: null,
    operation: 'SOURCE_CAPTURE',
    workflowId: null,
    draftVersion: null,
    idempotencyKey: input.grant.idempotencyKey,
    requestHash: input.grant.requestHash,
    tokenDigest: digestExtensionCommandGrantToken(SECRET, TOKEN),
    issuedAt: new Date(NOW.getTime() - 1_000),
    expiresAt: new Date(NOW.getTime() + 60_000),
    consumedAt: null,
    revokedAt: null,
    revokedReason: null,
    sessionStatus: 'ACTIVE',
    sessionExpiresAt: new Date(NOW.getTime() + 86_400_000),
    currentJti: input.tokenId,
    sessionOwnerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    scopes: ['capture:write'],
    ownerStatus: 'ACTIVE',
    actorStatus: 'ACTIVE',
    ownerRole: 'USER',
    actorRole: 'USER',
    actorParentId: null,
    ...overrides,
  };
}

describe('Prisma source capture repository', () => {
  it('serializes legacy projection ensure on subject identity and reuses the bound row', async () => {
    const createdAt = new Date('2026-07-13T10:00:00.000Z');
    const client = new ScriptedClient((sql) => {
      if (sql.includes('INSERT INTO "source_capture_subjects"')) return [];
      if (sql.includes('FROM "source_capture_subjects"')) {
        return [{ id: 'subject-1', legacySupplyGoodsId: 'goods-stable' }];
      }
      if (sql.includes('SELECT "id", "created_at"') && sql.includes('FOR UPDATE')) {
        return [{ id: 'goods-stable', createdAt }];
      }
      if (sql.includes('UPDATE "supply_goods"')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaSourceCaptureRepository({
      client: client as never,
      commandGrantSecret: SECRET,
      now: () => NOW,
    });

    await expect(repository.ensureLegacyProjection({
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      rolloutRevision: 'pilot-1',
      rolloutStage: 'shadow_write',
      sourcePlatform: '1688',
      sourceProductId: '1000000000003',
      supplier: null,
      projection: {
        title: 'Legacy product',
        sourceUrl: 'https://detail.1688.com/offer/1000000000003.html',
        sourcePlatform: '1688',
        sourceProductId: '1000000000003',
        sku: 'legacy-1',
        images: [],
        variants: [],
        purchasePrice: null,
        currency: 'CNY',
        metadata: { sourceCaptureV2: { pending: true } },
      },
    })).resolves.toEqual({
      kind: 'reused', subjectId: 'subject-1', supplyGoodsId: 'goods-stable', createdAt,
    });
    expect(client.transactionOptions).toEqual([{ isolationLevel: 'Serializable' }]);
    expect(client.calls.filter(({ sql }) => sql.includes('INSERT INTO "supply_goods"'))).toHaveLength(0);
    const update = client.calls.find(({ sql }) => sql.includes('UPDATE "supply_goods"'));
    expect(JSON.parse(String(update?.params[10]))).not.toHaveProperty('sourceCaptureV2');
  });

  it('consumes the grant, persists the snapshot/projection, and completes one receipt in one transaction', async () => {
    const input = await preparedNative();
    const ids = ['receipt-1', 'subject-new', 'goods-1', 'snapshot-1'];
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "extension_command_grants" g')) return [grantRow(input)];
      if (sql.includes('FROM "extension_command_receipts"')) return [];
      if (sql.includes('UPDATE "extension_command_grants"')) return [{ id: 'grant-1' }];
      if (sql.includes('INSERT INTO "extension_command_receipts"')) {
        return [{
          id: 'receipt-1', grantId: 'grant-1', status: 'PENDING', result: null,
          failureCode: null, createdAt: NOW, completedAt: null,
        }];
      }
      if (sql.includes('INSERT INTO "source_capture_subjects"')) return [];
      if (sql.includes('FROM "source_capture_subjects"')) {
        return [{ id: 'subject-1', legacySupplyGoodsId: null }];
      }
      if (sql.includes('FROM "source_capture_snapshots"') && sql.includes('"capture_hash"')) return [];
      if (sql.includes('INSERT INTO "supply_goods"')) return [];
      if (sql.includes('UPDATE "source_capture_subjects"')) return [{ legacySupplyGoodsId: 'goods-1' }];
      if (sql.includes('MAX("version")')) return [{ nextVersion: 1 }];
      if (sql.includes('INSERT INTO "source_capture_snapshots"')) return [{ id: 'snapshot-1' }];
      if (sql.includes('UPDATE "supply_goods"')) return [];
      if (sql.includes('UPDATE "extension_command_receipts"')) return [{ id: 'receipt-1' }];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaSourceCaptureRepository({
      client: client as never,
      commandGrantSecret: SECRET,
      now: () => NOW,
      createId: () => ids.shift() || 'unexpected-id',
    });

    await expect(repository.ingestNative(input)).resolves.toEqual({
      kind: 'created',
      subjectId: 'subject-1',
      snapshotId: 'snapshot-1',
      snapshotVersion: 1,
      supplyGoodsId: 'goods-1',
      captureHash: fixture.captureHash,
    });
    expect(client.transactionOptions).toEqual([{ isolationLevel: 'Serializable' }]);
    const statements = client.calls.map(({ sql }) => sql);
    expect(statements.findIndex((sql) => sql.includes('UPDATE "extension_command_grants"')))
      .toBeLessThan(statements.findIndex((sql) => sql.includes('INSERT INTO "source_capture_snapshots"')));
    expect(statements.findIndex((sql) => sql.includes('INSERT INTO "source_capture_snapshots"')))
      .toBeLessThan(statements.findIndex((sql) => sql.includes('UPDATE "extension_command_receipts"')));
    expect(statements.at(-1)).toContain('UPDATE "extension_command_receipts"');
  });

  it('returns a completed receipt replay without touching snapshots or projections', async () => {
    const input = await preparedNative();
    const receiptResult = {
      type: 'SOURCE_CAPTURE', subjectId: 'subject-1', snapshotId: 'snapshot-1', snapshotVersion: 1,
      supplyGoodsId: 'goods-1', captureHash: fixture.captureHash,
    };
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "extension_command_grants" g')) return [grantRow(input, { consumedAt: NOW })];
      if (sql.includes('FROM "extension_command_receipts"')) {
        return [{
          id: 'receipt-1', grantId: 'grant-1', status: 'SUCCEEDED', result: receiptResult,
          failureCode: null, createdAt: NOW, completedAt: NOW,
        }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaSourceCaptureRepository({
      client: client as never,
      commandGrantSecret: SECRET,
      now: () => NOW,
    });

    await expect(repository.ingestNative(input)).resolves.toMatchObject({
      kind: 'replay', snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    });
    expect(client.calls).toHaveLength(2);
  });

  it('does not roll a bound projection backward when an older capture hash is replayed', async () => {
    const input = await preparedNative();
    const ids = ['receipt-old', 'subject-unused'];
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "extension_command_grants" g')) return [grantRow(input)];
      if (sql.includes('FROM "extension_command_receipts"')) return [];
      if (sql.includes('UPDATE "extension_command_grants"')) return [{ id: 'grant-1' }];
      if (sql.includes('INSERT INTO "extension_command_receipts"')) {
        return [{
          id: 'receipt-old', grantId: 'grant-1', status: 'PENDING', result: null,
          failureCode: null, createdAt: NOW, completedAt: null,
        }];
      }
      if (sql.includes('INSERT INTO "source_capture_subjects"')) return [];
      if (sql.includes('FROM "source_capture_subjects"')) {
        return [{ id: 'subject-1', legacySupplyGoodsId: 'goods-current-v2' }];
      }
      if (sql.includes('FROM "source_capture_snapshots"') && sql.includes('"capture_hash"')) {
        return [{ id: 'snapshot-old-v1', version: 1, captureHash: fixture.captureHash }];
      }
      if (sql.includes('UPDATE "extension_command_receipts"')) return [{ id: 'receipt-old' }];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaSourceCaptureRepository({
      client: client as never,
      commandGrantSecret: SECRET,
      now: () => NOW,
      createId: () => ids.shift() || 'unused',
    });

    await expect(repository.ingestNative(input)).resolves.toMatchObject({
      kind: 'replay', snapshotId: 'snapshot-old-v1', snapshotVersion: 1,
      supplyGoodsId: 'goods-current-v2',
    });
    expect(client.calls.some(({ sql }) => sql.includes('UPDATE "supply_goods"'))).toBe(false);
  });

  it('rejects a legacy supplied projection id that conflicts with the subject binding', async () => {
    const native = await preparedNative();
    const input = {
      ...native,
      ingestChannel: 'LEGACY_ADAPTER' as const,
      deviceSessionId: null,
      tokenId: null,
      supplyGoodsId: 'goods-requested',
    };
    const client = new ScriptedClient((sql) => {
      if (sql.includes('INSERT INTO "source_capture_subjects"')) return [];
      if (sql.includes('FROM "source_capture_subjects"')) {
        return [{ id: 'subject-1', legacySupplyGoodsId: 'goods-bound' }];
      }
      if (sql.includes('FROM "source_capture_snapshots"')) return [];
      if (sql.includes('FROM "supply_goods"') && sql.includes('FOR UPDATE')) {
        return [{ id: 'goods-requested' }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaSourceCaptureRepository({
      client: client as never,
      commandGrantSecret: SECRET,
      now: () => NOW,
    });

    await expect(repository.ingestLegacy(input)).rejects.toMatchObject({
      code: 'SOURCE_CAPTURE_PROJECTION_CONFLICT',
      statusCode: 409,
    });
    expect(client.calls.some(({ sql }) => sql.includes('INSERT INTO "source_capture_snapshots"'))).toBe(false);
  });
});
