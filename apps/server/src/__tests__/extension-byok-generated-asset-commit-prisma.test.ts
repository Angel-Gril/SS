import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { OzonListingDraft } from 'shared';
import { describe, expect, it } from 'vitest';
import {
  createByokGeneratedAssetCreateInputFromUpload,
  prepareByokGeneratedAsset,
} from '../services/byok-generated-asset-ingest.js';
import {
  EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
  EXTENSION_BYOK_MEDIA_INGEST_SCOPE,
  type ExtensionByokMediaIngestResolvedCommand,
} from '../services/extension-byok-media-ingest-grant.js';
import type { ExtensionCommandBinding } from '../services/extension-command-grants.js';
import {
  createPrismaExtensionByokGeneratedAssetCommitter,
  EXTENSION_BYOK_MEDIA_INGEST_RECEIPT_VERSION,
} from '../repositories/extension-byok-generated-asset-commit-prisma.js';

const NOW = new Date('2026-07-25T14:00:00.000Z');

function hash(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function binding(): ExtensionCommandBinding {
  return {
    sessionId: 'session-1',
    tokenId: 'jti-1',
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    operation: 'BYOK_MEDIA_INGEST',
    workflowId: 'workflow-1',
    draftVersion: 4,
    idempotencyKey: 'byok-commit-prisma-0001',
    requestHash: 'a'.repeat(64),
  };
}

async function fixture() {
  const bytes = await sharp({
    create: {
      width: 3,
      height: 2,
      channels: 4,
      background: { r: 20, g: 40, b: 60, alpha: 1 },
    },
  }).png({ compressionLevel: 1 }).toBuffer();
  const prepared = await prepareByokGeneratedAsset({
    ownerUserId: 'owner-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    idempotencyKey: binding().idempotencyKey,
    requestHash: binding().requestHash,
    expectedProviderResultSha256: hash(bytes),
    declaredMimeType: 'image/png',
    declaredSizeBytes: bytes.length,
    source: bytes,
  });
  const asset = createByokGeneratedAssetCreateInputFromUpload(prepared, {
    url: 'https://cdn.example/byok/generated.png',
    filename: 'generated.png',
    backend: 'oss',
    key: 'users/owner-1/ai-generated/generated.png',
    objectKey: 'users/owner-1/ai-generated/generated.png',
  });
  const command: ExtensionByokMediaIngestResolvedCommand = {
    schemaVersion: EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
    providerOrigin: 'https://relay.example',
    providerOperation: 'TEXT_TO_IMAGE',
    requestMode: 'json',
    model: 'image-model-v1',
    executionIntentId: 'intent-1',
    providerIdempotencyKey: 'provider-attempt-0001',
    providerRequestHash: hash('provider-request-body-1'),
    providerRequestIdSha256: hash('provider-request-1'),
    promptSha256: hash('safe prompt'),
    negativePromptSha256: null,
    draftRevision: 3,
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    assignmentOrdinal: 0,
    assignmentMode: 'APPEND',
    replaceConfirmed: false,
    resultSha256: hash(bytes),
    resultMimeType: 'image/png',
    resultSizeBytes: bytes.length,
    sourceSha256: null,
    referenceSha256s: [],
    maskSha256: null,
    readiness: { contractVersion: 'extension-byok-readiness/v1', policyRevision: 7 },
    authority: { sourceCaptureSnapshotId: 'snapshot-1' },
  };
  return { bytes, asset, command };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function listingDraft(): OzonListingDraft {
  return {
    id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
    sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: 'f'.repeat(64),
    selectedSkuKeys: ['sku-1'], draftVersion: 4, revision: 3, stage: 'MEDIA_REVIEW',
    runState: 'ACTIVE', runStateReason: null, category: null, attributes: { values: {} },
    copy: { publishTitleRu: null, publishDescriptionRu: null, candidates: [], applyAudit: [] },
    media: { assignments: [] }, pricing: { value: null },
    validation: { status: 'NOT_RUN', report: null }, completedStepHashes: {},
    blockers: [], warnings: [], publishTaskIds: [],
    freshness: {
      category: { state: 'CURRENT', reason: null }, attributes: { state: 'CURRENT', reason: null },
      content: { state: 'CURRENT', reason: null }, media: { state: 'CURRENT', reason: null },
      pricing: { state: 'CURRENT', reason: null }, validation: { state: 'CURRENT', reason: null },
    },
    grantRevocation: { required: false, reason: null, previousShopId: null },
    auditEvents: [], createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  } as OzonListingDraft;
}

class FakeDatabase {
  grant = {
    id: 'grant-1',
    ...binding(),
    tokenDigest: 'd'.repeat(64),
    issuedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 60_000),
    consumedAt: null as Date | null,
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
  };
  receipt: any = null;
  draft = listingDraft();
  pendingDraft: OzonListingDraft | null = null;
  workflowEvents: unknown[] = [];
  media = new Map<string, any>();
  provenance = new Map<string, any>();
  executionIntent: any;

  readonly tx = {
    $queryRawUnsafe: async <T>(sql: string, ...params: unknown[]): Promise<T> => {
      if (sql.includes('FROM "extension_command_grants" g')) return [this.grant] as T;
      if (sql.includes('FROM "extension_command_receipts"')) {
        return (this.receipt ? [this.receipt] : []) as T;
      }
      if (sql.includes('FROM "extension_device_shop_grants"')) {
        return [{
          shopGrantStatus: 'ACTIVE', shopOwnerUserId: 'owner-1',
          shopStatus: 'ACTIVE', platform: 'OZON',
        }] as T;
      }
      if (sql.includes('FROM "extension_byok_execution_intents" intent')) {
        return (this.executionIntent ? [this.executionIntent] : []) as T;
      }
      if (sql.includes('UPDATE "extension_command_grants"') && sql.includes('"consumed_at"')) {
        this.grant.consumedAt = params[0] as Date;
        return [{ id: this.grant.id }] as T;
      }
      if (sql.includes('INSERT INTO "extension_command_receipts"')) {
        this.receipt = {
          id: String(params[0]), grantId: this.grant.id, status: 'PENDING', result: null,
          failureCode: null, createdAt: params[2] as Date, completedAt: null,
        };
        return [this.receipt] as T;
      }
      if (sql.includes('FROM "source_listing_workflows" w')
        && sql.includes('JOIN "source_listing_draft_versions" d')) {
        return [{
          id: this.draft.id,
          ownerUserId: this.draft.ownerUserId,
          shopId: this.draft.shopId,
          supplyGoodsId: this.draft.supplyGoodsId,
          sourceSubjectId: 'subject-1',
          currentSourceCaptureSnapshotId: this.draft.sourceCaptureSnapshotId,
          selectedSkuHash: '0'.repeat(64),
          currentRevision: this.draft.revision,
          currentDraftVersion: this.draft.draftVersion,
          payload: clone(this.draft),
        }] as T;
      }
      if (sql.includes('INSERT INTO "source_listing_draft_versions"')) {
        this.pendingDraft = JSON.parse(String(params[9])) as OzonListingDraft;
        return [] as T;
      }
      if (sql.includes('UPDATE "source_listing_workflows"') && sql.includes('"current_revision"')) {
        if (!this.pendingDraft || Number(params[11]) !== this.draft.revision) return [] as T;
        this.draft = this.pendingDraft;
        this.pendingDraft = null;
        return [{ id: this.draft.id }] as T;
      }
      if (sql.includes('UPDATE "extension_command_grants"') && sql.includes('"revoked_at"')) {
        return [] as T;
      }
      if (sql.includes('INSERT INTO "source_listing_workflow_events"')) {
        this.workflowEvents.push(params);
        return [] as T;
      }
      if (sql.includes('UPDATE "extension_command_receipts"')) {
        this.receipt = {
          ...this.receipt,
          status: 'SUCCEEDED',
          result: JSON.parse(String(params[1])),
          failureCode: null,
          completedAt: params[2] as Date,
        };
        return [{ id: this.receipt.id }] as T;
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    mediaAsset: {
      findUnique: async () => undefined,
    } as any,
    extensionByokMediaProvenance: {} as any,
  };

  constructor(command: ExtensionByokMediaIngestResolvedCommand) {
    this.executionIntent = {
      id: command.executionIntentId,
      contract_version: 'extension-byok-execution-intent/v1',
      execution_mode: 'BYOK',
      owner_user_id: 'owner-1',
      actor_user_id: 'owner-1',
      device_session_id: 'session-1',
      shop_id: 'shop-1',
      listing_workflow_id: 'workflow-1',
      draft_revision: command.draftRevision,
      draft_version: binding().draftVersion,
      source_capture_snapshot_id: command.authority.sourceCaptureSnapshotId,
      sku_key: command.skuKey,
      slot_key: command.slotKey,
      assignment_mode: 'APPEND',
      assignment_ordinal: command.assignmentOrdinal,
      policy_revision: command.readiness.policyRevision,
      provider_origin_sha256: hash(command.providerOrigin),
      model: command.model,
      operation: command.providerOperation,
      request_mode: command.requestMode,
      provider_idempotency_key: command.providerIdempotencyKey,
      provider_request_hash: command.providerRequestHash,
      provider_request_id_sha256: command.providerRequestIdSha256,
      result_sha256: command.resultSha256,
      outcome: 'SUCCEEDED',
      provenanceId: null,
    };
    this.tx.mediaAsset = {
      findUnique: async ({ where }: any) => this.media.get(where.id) || null,
      create: async ({ data }: any) => {
        if (this.media.has(data.id)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        const row = { ...clone(data), createdAt: NOW };
        this.media.set(row.id, row);
        return row;
      },
    };
    this.tx.extensionByokMediaProvenance = {
      findUnique: async ({ where }: any) => {
        const key = where.extension_byok_media_provenance_owner_idempotency;
        return [...this.provenance.values()].find((row) => (
          row.ownerUserId === key.ownerUserId && row.idempotencyKey === key.idempotencyKey
        )) || null;
      },
      create: async ({ data }: any) => {
        const row = {
          ...clone(data),
          id: 'provenance-1',
          createdAt: NOW,
          updatedAt: NOW,
        };
        this.provenance.set(row.id, row);
        return row;
      },
    };
  }

  async $queryRawUnsafe<T>(): Promise<T> {
    return [] as T;
  }

  async $transaction<T>(action: (tx: any) => Promise<T>): Promise<T> {
    const snapshot = {
      grant: clone(this.grant),
      receipt: clone(this.receipt),
      media: clone([...this.media.entries()]),
      provenance: clone([...this.provenance.entries()]),
      draft: clone(this.draft),
      pendingDraft: clone(this.pendingDraft),
      workflowEvents: clone(this.workflowEvents),
    };
    try {
      return await action(this.tx);
    } catch (error) {
      this.grant = snapshot.grant;
      this.receipt = snapshot.receipt;
      this.media = new Map(snapshot.media);
      this.provenance = new Map(snapshot.provenance);
      this.draft = snapshot.draft;
      this.pendingDraft = snapshot.pendingDraft;
      this.workflowEvents = snapshot.workflowEvents;
      throw error;
    }
  }
}

describe('Prisma BYOK generated asset atomic commit', () => {
  it('consumes one exact grant and atomically creates asset, zero-charge provenance, and receipt', async () => {
    const data = await fixture();
    const database = new FakeDatabase(data.command);
    const commit = createPrismaExtensionByokGeneratedAssetCommitter(database as never);
    const result = await commit({
      binding: binding(),
      tokenDigest: 'd'.repeat(64),
      receiptId: 'receipt-1',
      actorUserId: 'owner-1',
      now: NOW,
      command: data.command,
      asset: data.asset,
      stagingId: null,
    });
    expect(result).toMatchObject({
      replayed: false,
      receiptId: 'receipt-1',
      receipt: {
        contractVersion: EXTENSION_BYOK_MEDIA_INGEST_RECEIPT_VERSION,
        assetId: data.asset.id,
        provenanceId: 'provenance-1',
        normalizedSha256: data.asset.sha256,
        draftRevision: 3,
        draftVersion: 4,
        boundDraftRevision: 4,
        boundDraftVersion: 5,
        assignmentOrdinal: 0,
        assignmentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(database.media).toHaveLength(1);
    expect(database.provenance).toHaveLength(1);
    expect(database.provenance.get('provenance-1')).toMatchObject({
      executionMode: 'BYOK',
      erpAiChargeCents: 0,
      resultSha256: data.asset.sha256,
      endpointOriginSha256: hash('https://relay.example'),
      assetId: data.asset.id,
      draftRevision: 3,
      draftVersion: 4,
      boundDraftRevision: 4,
      boundDraftVersion: 5,
      assignmentOrdinal: 0,
      assignmentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      policyRevision: 7,
      executionIntentId: 'intent-1',
    });
    expect(database.draft).toMatchObject({ revision: 4, draftVersion: 5 });
    expect(database.draft.media.assignments).toEqual([expect.objectContaining({
      scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
      assetId: data.asset.id, source: 'GENERATED',
    })]);
    expect(database.receipt).toMatchObject({ status: 'SUCCEEDED' });

    const replay = await commit({
      binding: binding(),
      tokenDigest: 'd'.repeat(64),
      receiptId: 'unused-replay-receipt',
      actorUserId: 'owner-1',
      now: NOW,
      command: data.command,
      asset: data.asset,
      stagingId: null,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.receiptId).toBe('receipt-1');
    expect(database.media).toHaveLength(1);
    expect(database.provenance).toHaveLength(1);
    expect(database.draft).toMatchObject({ revision: 4, draftVersion: 5 });
    expect(database.draft.media.assignments).toHaveLength(1);
  });

  it('rolls back the consumed grant and every row when draft authority changes', async () => {
    const data = await fixture();
    const database = new FakeDatabase(data.command);
    database.draft.revision = 4;
    const commit = createPrismaExtensionByokGeneratedAssetCommitter(database as never);
    await expect(commit({
      binding: binding(),
      tokenDigest: 'd'.repeat(64),
      receiptId: 'receipt-1',
      actorUserId: 'owner-1',
      now: NOW,
      command: data.command,
      asset: data.asset,
      stagingId: null,
    })).rejects.toMatchObject({ code: 'BYOK_INGEST_DRAFT_STALE', statusCode: 409 });
    expect(database.grant.consumedAt).toBeNull();
    expect(database.receipt).toBeNull();
    expect(database.media).toHaveLength(0);
    expect(database.provenance).toHaveLength(0);
    expect(database.draft.revision).toBe(4);
    expect(database.draft.media.assignments).toHaveLength(0);
  });

  it('rolls back before asset mutation when the exact Provider outcome is unresolved', async () => {
    const data = await fixture();
    const database = new FakeDatabase(data.command);
    database.executionIntent.outcome = 'UNKNOWN_OUTCOME';
    database.executionIntent.result_sha256 = null;
    const commit = createPrismaExtensionByokGeneratedAssetCommitter(database as never);

    await expect(commit({
      binding: binding(),
      tokenDigest: 'd'.repeat(64),
      receiptId: 'receipt-1',
      actorUserId: 'owner-1',
      now: NOW,
      command: data.command,
      asset: data.asset,
      stagingId: null,
    })).rejects.toMatchObject({
      code: 'BYOK_INGEST_EXECUTION_INTENT_OUTCOME_PENDING',
      statusCode: 409,
    });
    expect(database.grant.consumedAt).toBeNull();
    expect(database.media).toHaveLength(0);
    expect(database.provenance).toHaveLength(0);
  });

  it('rejects a replace command that does not match the pre-dispatch append intent', async () => {
    const data = await fixture();
    const command: ExtensionByokMediaIngestResolvedCommand = {
      ...data.command,
      assignmentMode: 'REPLACE',
      replaceConfirmed: true,
    };
    const database = new FakeDatabase(data.command);
    const commit = createPrismaExtensionByokGeneratedAssetCommitter(database as never);

    await expect(commit({
      binding: binding(),
      tokenDigest: 'd'.repeat(64),
      receiptId: 'receipt-1',
      actorUserId: 'owner-1',
      now: NOW,
      command,
      asset: data.asset,
      stagingId: null,
    })).rejects.toMatchObject({
      code: 'BYOK_INGEST_EXECUTION_INTENT_MISMATCH',
      statusCode: 409,
    });
    expect(database.grant.consumedAt).toBeNull();
    expect(database.media).toHaveLength(0);
    expect(database.provenance).toHaveLength(0);
  });

  it('maps the database execution-mode fence to a definite BYOK conflict', async () => {
    const data = await fixture();
    const database = {
      async $transaction() {
        throw {
          code: 'P2010',
          meta: {
            code: '23514',
            message: 'violates constraint extension_ai_image_execution_mode_exclusive',
          },
        };
      },
    };
    const commit = createPrismaExtensionByokGeneratedAssetCommitter(database as never);

    await expect(commit({
      binding: binding(),
      tokenDigest: 'd'.repeat(64),
      receiptId: 'receipt-1',
      actorUserId: 'owner-1',
      now: NOW,
      command: data.command,
      asset: data.asset,
      stagingId: null,
    })).rejects.toMatchObject({
      code: 'BYOK_INGEST_MODE_CONFLICT',
      statusCode: 409,
    });
  });
});
