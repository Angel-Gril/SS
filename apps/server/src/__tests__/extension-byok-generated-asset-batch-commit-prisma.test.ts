import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { OzonListingDraft } from 'shared';
import { describe, expect, it } from 'vitest';
import {
  createByokGeneratedAssetCreateInputFromUpload,
  prepareByokGeneratedAsset,
  type ByokGeneratedAssetCreateInput,
} from '../services/byok-generated-asset-ingest.js';
import {
  EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION,
  EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
  EXTENSION_BYOK_MEDIA_INGEST_SCOPE,
  type ExtensionByokMediaBatchIngestResolvedCommand,
  type ExtensionByokMediaIngestResolvedCommand,
} from '../services/extension-byok-media-ingest-grant.js';
import type { ExtensionCommandBinding } from '../services/extension-command-grants.js';
import {
  createPrismaExtensionByokGeneratedAssetBatchCommitter,
  deriveExtensionByokBatchItemIdempotencyKey,
  EXTENSION_BYOK_MEDIA_BATCH_INGEST_RECEIPT_VERSION,
} from '../repositories/extension-byok-generated-asset-batch-commit-prisma.js';

const NOW = new Date('2026-07-27T16:00:00.000Z');
const STORAGE_NAMESPACE = '9'.repeat(64);

function hash(value: Buffer | string): string {
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
    idempotencyKey: 'byok-batch-commit-prisma-0001',
    requestHash: 'a'.repeat(64),
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function listingDraft(): OzonListingDraft {
  return {
    id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
    sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: 'f'.repeat(64),
    selectedSkuKeys: ['sku-1', 'sku-2'], draftVersion: 4, revision: 3, stage: 'MEDIA_REVIEW',
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

const TARGETS = [
  { skuKey: 'sku-1', slotKey: 'sku:sku-1:hero' },
  { skuKey: 'sku-2', slotKey: 'sku:sku-2:hero' },
  { skuKey: 'sku-1', slotKey: 'shared:detail:SCENE' },
  { skuKey: 'sku-1', slotKey: 'shared:detail:DETAIL' },
] as const;

interface BatchFixtureItem {
  command: ExtensionByokMediaIngestResolvedCommand;
  asset: ByokGeneratedAssetCreateInput;
  stagingId: string;
  stagingStorageNamespaceId: string;
}

async function fixture(count = 4): Promise<{
  command: ExtensionByokMediaBatchIngestResolvedCommand;
  items: BatchFixtureItem[];
}> {
  const items: BatchFixtureItem[] = [];
  for (let index = 0; index < count; index += 1) {
    const target = TARGETS[index]!;
    const bytes = await sharp({
      create: {
        width: 3 + index,
        height: 2 + index,
        channels: 4,
        background: { r: 20 + index, g: 40, b: 60, alpha: 1 },
      },
    }).png({ compressionLevel: 1 }).toBuffer();
    const executionIntentId = `intent-${index + 1}`;
    const itemIdempotencyKey = deriveExtensionByokBatchItemIdempotencyKey(
      binding().idempotencyKey,
      executionIntentId,
    );
    const prepared = await prepareByokGeneratedAsset({
      ownerUserId: 'owner-1',
      sourceCaptureSnapshotId: 'snapshot-1',
      idempotencyKey: itemIdempotencyKey,
      requestHash: binding().requestHash,
      expectedProviderResultSha256: hash(bytes),
      declaredMimeType: 'image/png',
      declaredSizeBytes: bytes.length,
      source: bytes,
    });
    const asset = createByokGeneratedAssetCreateInputFromUpload(prepared, {
      url: `https://cdn.example/byok/generated-${index + 1}.png`,
      filename: `generated-${index + 1}.png`,
      backend: 'oss',
      key: `users/owner-1/ai-generated/generated-${index + 1}.png`,
      objectKey: `users/owner-1/ai-generated/generated-${index + 1}.png`,
    });
    const command: ExtensionByokMediaIngestResolvedCommand = {
      schemaVersion: EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
      providerOrigin: 'https://relay.example',
      providerOperation: 'TEXT_TO_IMAGE',
      requestMode: 'json',
      model: 'image-model-v1',
      executionIntentId,
      providerIdempotencyKey: `provider-attempt-${String(index + 1).padStart(4, '0')}`,
      providerRequestHash: hash(`provider-request-body-${index + 1}`),
      providerRequestIdSha256: hash(`provider-request-${index + 1}`),
      promptSha256: hash(`safe prompt ${index + 1}`),
      negativePromptSha256: null,
      draftRevision: 3,
      skuKey: target.skuKey,
      slotKey: target.slotKey,
      assignmentOrdinal: index,
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
    items.push({
      command,
      asset,
      stagingId: asset.id,
      stagingStorageNamespaceId: STORAGE_NAMESPACE,
    });
  }
  return {
    command: {
      schemaVersion: EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION,
      executionBatchId: 'execution-batch-1',
      items: items.map((item) => item.command),
    },
    items,
  };
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
  media = new Map<string, any>();
  provenance = new Map<string, any>();
  staging = new Map<string, { status: 'PENDING' | 'COMMITTED' }>();
  executionIntents = new Map<string, any>();
  executionBatch: any;
  executionBatchItems = new Map<string, any>();
  draftCasCount = 0;

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
      if (sql.includes('FROM "extension_byok_execution_batches"')) {
        return (this.executionBatch?.id === String(params[0])
          ? [clone(this.executionBatch)] : []) as T;
      }
      if (sql.includes('FROM "extension_byok_execution_batch_items" item')
        && sql.includes('JOIN "extension_byok_execution_intents" intent')) {
        const intentIds = new Set((params[1] as string[]) || []);
        return [...this.executionBatchItems.values()]
          .filter((item) => item.batchId === String(params[0]))
          .sort((left, right) => left.itemIndex - right.itemIndex)
          .flatMap((item) => {
            const intent = [...this.executionIntents.values()].find((candidate) => (
              candidate.execution_batch_item_id === item.id && intentIds.has(candidate.id)
            ));
            return intent ? [{
              itemId: item.id,
              batchId: item.batchId,
              ownerUserId: item.ownerUserId,
              listingWorkflowId: item.listingWorkflowId,
              draftRevision: item.draftRevision,
              draftVersion: item.draftVersion,
              itemIndex: item.itemIndex,
              skuKey: item.skuKey,
              slotKey: item.slotKey,
              assignmentOrdinal: item.assignmentOrdinal,
              itemStatus: item.status,
              executionIntentId: intent.id,
              intentOutcome: intent.outcome,
              providerRequestHash: intent.provider_request_hash,
              resultSha256: intent.result_sha256,
            }] : [];
          }) as T;
      }
      if (sql.includes('FROM "extension_byok_execution_intents" intent')) {
        const intent = this.executionIntents.get(String(params[0]));
        const provenance = [...this.provenance.values()].find((row) => (
          row.executionIntentId === String(params[0])
        ));
        return (intent ? [{ ...intent, provenanceId: provenance?.id || null }] : []) as T;
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
      if (sql.includes('UPDATE "extension_byok_upload_staging"')) {
        const staging = this.staging.get(String(params[0]));
        const matches = staging?.status === 'PENDING'
          && params[1] === 'owner-1'
          && params[2] === 'session-1'
          && params[3] === params[0]
          && params[4] === binding().requestHash
          && params[6] === STORAGE_NAMESPACE;
        if (!matches) return [] as T;
        staging.status = 'COMMITTED';
        return [{ id: params[0] }] as T;
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
        this.draftCasCount += 1;
        if (!this.pendingDraft || Number(params[11]) !== this.draft.revision) return [] as T;
        this.draft = this.pendingDraft;
        this.pendingDraft = null;
        return [{ id: this.draft.id }] as T;
      }
      if (sql.includes('UPDATE "extension_command_grants"') && sql.includes('"revoked_at"')) {
        return [] as T;
      }
      if (sql.includes('UPDATE "extension_byok_execution_batch_items"')) {
        const updated = [...this.executionBatchItems.values()]
          .filter((item) => item.batchId === String(params[0]) && item.status === 'ACTIVE');
        updated.forEach((item) => {
          item.status = 'BOUND';
          item.boundAt = params[1] as Date;
        });
        return updated.map((item) => ({ id: item.id })) as T;
      }
      if (sql.includes('UPDATE "extension_byok_execution_batches"')) {
        if (this.executionBatch.id !== String(params[0])
          || this.executionBatch.status !== 'OPEN') return [] as T;
        this.executionBatch.status = 'BOUND';
        this.executionBatch.boundDraftRevision = Number(params[1]);
        this.executionBatch.boundDraftVersion = Number(params[2]);
        this.executionBatch.boundAt = params[3] as Date;
        return [{ id: this.executionBatch.id }] as T;
      }
      if (sql.includes('INSERT INTO "source_listing_workflow_events"')) return [] as T;
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

  constructor(items: BatchFixtureItem[]) {
    this.executionBatch = {
      id: 'execution-batch-1', status: 'OPEN', ownerUserId: 'owner-1',
      actorUserId: 'owner-1', deviceSessionId: 'session-1', shopId: 'shop-1',
      listingWorkflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
      sourceCaptureSnapshotId: 'snapshot-1', firstAssignmentOrdinal: 0,
      itemCount: items.length, boundDraftRevision: null, boundDraftVersion: null,
      boundAt: null,
    };
    for (const item of items) {
      const command = item.command;
      const itemIndex = this.executionBatchItems.size;
      const batchItemId = `execution-batch-item-${itemIndex + 1}`;
      this.executionBatchItems.set(batchItemId, {
        id: batchItemId,
        batchId: this.executionBatch.id,
        ownerUserId: 'owner-1',
        listingWorkflowId: 'workflow-1',
        draftRevision: 3,
        draftVersion: 4,
        itemIndex,
        skuKey: command.skuKey,
        slotKey: command.slotKey,
        assignmentOrdinal: command.assignmentOrdinal,
        status: 'ACTIVE',
        boundAt: null,
      });
      this.executionIntents.set(command.executionIntentId, {
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
        execution_batch_item_id: batchItemId,
        execution_batch_attempt_index: 0,
      });
      this.staging.set(item.stagingId, { status: 'PENDING' });
    }
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
          id: `provenance-${this.provenance.size + 1}`,
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
      staging: clone([...this.staging.entries()]),
      draft: clone(this.draft),
      pendingDraft: clone(this.pendingDraft),
      executionBatch: clone(this.executionBatch),
      executionBatchItems: clone([...this.executionBatchItems.entries()]),
      draftCasCount: this.draftCasCount,
    };
    try {
      return await action(this.tx);
    } catch (error) {
      this.grant = snapshot.grant;
      this.receipt = snapshot.receipt;
      this.media = new Map(snapshot.media);
      this.provenance = new Map(snapshot.provenance);
      this.staging = new Map(snapshot.staging);
      this.draft = snapshot.draft;
      this.pendingDraft = snapshot.pendingDraft;
      this.executionBatch = snapshot.executionBatch;
      this.executionBatchItems = new Map(snapshot.executionBatchItems);
      this.draftCasCount = snapshot.draftCasCount;
      throw error;
    }
  }
}

function commitInput(data: Awaited<ReturnType<typeof fixture>>) {
  return {
    binding: binding(),
    tokenDigest: 'd'.repeat(64),
    receiptId: 'receipt-batch-1',
    actorUserId: 'owner-1',
    now: NOW,
    command: data.command,
    items: data.items.map(({ asset, stagingId, stagingStorageNamespaceId }) => ({
      asset,
      stagingId,
      stagingStorageNamespaceId,
    })),
  };
}

describe('Prisma BYOK generated asset atomic batch commit', () => {
  it('binds four reviewed results with one grant, one receipt, and one draft CAS', async () => {
    const data = await fixture();
    const database = new FakeDatabase(data.items);
    const commit = createPrismaExtensionByokGeneratedAssetBatchCommitter(database as never);

    const result = await commit(commitInput(data));

    expect(result).toMatchObject({
      replayed: false,
      receiptId: 'receipt-batch-1',
      receipt: {
        contractVersion: EXTENSION_BYOK_MEDIA_BATCH_INGEST_RECEIPT_VERSION,
        executionBatchId: 'execution-batch-1',
        requestHash: binding().requestHash,
        sourceDraftRevision: 3,
        sourceDraftVersion: 4,
        boundDraftRevision: 4,
        boundDraftVersion: 5,
        erpAiChargeCents: 0,
      },
    });
    expect(result.receipt.items).toHaveLength(4);
    expect(result.receipt.items.map((item) => item.assignment)).toEqual([
      expect.objectContaining({ scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero' }),
      expect.objectContaining({ scope: 'SKU', skuKey: 'sku-2', slotKey: 'sku:sku-2:hero' }),
      expect.objectContaining({ scope: 'PRODUCT', slotKey: 'shared:detail:SCENE' }),
      expect.objectContaining({ scope: 'PRODUCT', slotKey: 'shared:detail:DETAIL' }),
    ]);
    expect(result.receipt.items).toEqual(data.items.map((item, index) => expect.objectContaining({
      assetId: item.asset.id,
      provenanceId: `provenance-${index + 1}`,
      executionIntentId: item.command.executionIntentId,
      providerRequestHash: item.command.providerRequestHash,
      providerResultSha256: item.command.resultSha256,
      normalizedSha256: item.asset.sha256,
      skuKey: item.command.skuKey,
      slotKey: item.command.slotKey,
      assignmentOrdinal: index,
      assignmentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      policyRevision: 7,
    })));
    expect(database.draftCasCount).toBe(1);
    expect(database.draft).toMatchObject({ revision: 4, draftVersion: 5 });
    expect(database.draft.media.assignments).toHaveLength(4);
    expect(database.draft.auditEvents).toHaveLength(4);
    expect(new Set(database.draft.auditEvents.map((event) => event.id))).toHaveLength(4);
    expect(database.media).toHaveLength(4);
    expect(database.provenance).toHaveLength(4);
    expect([...database.provenance.values()]).toEqual(data.items.map((item) => (
      expect.objectContaining({
        executionMode: 'BYOK',
        erpAiChargeCents: 0,
        executionIntentId: item.command.executionIntentId,
        resultSha256: item.asset.sha256,
        draftRevision: 3,
        draftVersion: 4,
        boundDraftRevision: 4,
        boundDraftVersion: 5,
      })
    )));
    expect([...database.staging.values()].every((row) => row.status === 'COMMITTED')).toBe(true);
    expect(database.receipt).toMatchObject({ status: 'SUCCEEDED' });
    expect(database.executionBatch).toMatchObject({
      id: 'execution-batch-1', status: 'BOUND',
      boundDraftRevision: 4, boundDraftVersion: 5, boundAt: NOW,
    });
    expect([...database.executionBatchItems.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'BOUND', boundAt: NOW }),
      ]),
    );
    expect([...database.executionBatchItems.values()].every((row) => (
      row.status === 'BOUND' && row.boundAt?.getTime() === NOW.getTime()
    ))).toBe(true);
    expect(Object.hasOwn(database.receipt.result, 'receiptId')).toBe(false);

    const storedReceipt = clone(result.receipt);
    const replay = await commit({ ...commitInput(data), receiptId: 'unused-replay-id' });
    expect(replay).toMatchObject({ replayed: true, receiptId: 'receipt-batch-1' });
    expect(replay.receipt).toEqual(storedReceipt);
    expect(database.draftCasCount).toBe(1);
    expect(database.media).toHaveLength(4);
    expect(database.provenance).toHaveLength(4);
  });

  it('accepts the one-item lower bound', async () => {
    const data = await fixture(1);
    const database = new FakeDatabase(data.items);
    const result = await createPrismaExtensionByokGeneratedAssetBatchCommitter(database as never)(
      commitInput(data),
    );
    expect(result.receipt.items).toHaveLength(1);
    expect(database.draftCasCount).toBe(1);
  });

  it('rolls back every item when one Provider outcome is unresolved', async () => {
    const data = await fixture(3);
    const database = new FakeDatabase(data.items);
    database.executionIntents.get('intent-2').outcome = 'UNKNOWN_OUTCOME';
    database.executionIntents.get('intent-2').result_sha256 = null;
    const commit = createPrismaExtensionByokGeneratedAssetBatchCommitter(database as never);

    await expect(commit(commitInput(data))).rejects.toMatchObject({
      code: 'BYOK_INGEST_EXECUTION_INTENT_OUTCOME_PENDING',
      statusCode: 409,
    });
    expect(database.grant.consumedAt).toBeNull();
    expect(database.receipt).toBeNull();
    expect(database.media).toHaveLength(0);
    expect(database.provenance).toHaveLength(0);
    expect(database.draftCasCount).toBe(0);
    expect(database.executionBatch.status).toBe('OPEN');
    expect([...database.executionBatchItems.values()].every((row) => row.status === 'ACTIVE'))
      .toBe(true);
    expect([...database.staging.values()].every((row) => row.status === 'PENDING')).toBe(true);
  });

  it('rolls back prior asset and staging writes when a later staging identity conflicts', async () => {
    const data = await fixture(3);
    const database = new FakeDatabase(data.items);
    database.staging.get(data.items[1]!.stagingId)!.status = 'COMMITTED';
    const commit = createPrismaExtensionByokGeneratedAssetBatchCommitter(database as never);

    await expect(commit(commitInput(data))).rejects.toMatchObject({
      code: 'BYOK_INGEST_STAGING_CONFLICT',
      statusCode: 409,
    });
    expect(database.grant.consumedAt).toBeNull();
    expect(database.receipt).toBeNull();
    expect(database.media).toHaveLength(0);
    expect(database.provenance).toHaveLength(0);
    expect(database.draftCasCount).toBe(0);
    expect(database.staging.get(data.items[0]!.stagingId)?.status).toBe('PENDING');
  });

  it('rejects a Provider request hash mismatch before any asset mutation', async () => {
    const data = await fixture(3);
    const database = new FakeDatabase(data.items);
    database.executionIntents.get('intent-2').provider_request_hash = hash('different request');
    const commit = createPrismaExtensionByokGeneratedAssetBatchCommitter(database as never);

    await expect(commit(commitInput(data))).rejects.toMatchObject({
      code: 'BYOK_INGEST_EXECUTION_INTENT_MISMATCH',
      statusCode: 409,
    });
    expect(database.media).toHaveLength(0);
    expect(database.provenance).toHaveLength(0);
    expect(database.draftCasCount).toBe(0);
  });

  it('rejects a successful intent that belongs to another reservation item', async () => {
    const data = await fixture(3);
    const database = new FakeDatabase(data.items);
    database.executionIntents.get('intent-2').execution_batch_item_id =
      'execution-batch-item-1';

    await expect(createPrismaExtensionByokGeneratedAssetBatchCommitter(database as never)(
      commitInput(data),
    )).rejects.toMatchObject({
      code: 'BYOK_INGEST_EXECUTION_INTENT_MISMATCH',
      statusCode: 409,
    });
    expect(database.executionBatch.status).toBe('OPEN');
    expect(database.draftCasCount).toBe(0);
    expect(database.media).toHaveLength(0);
  });
});
