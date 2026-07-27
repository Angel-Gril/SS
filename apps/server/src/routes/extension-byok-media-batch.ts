import { randomUUID } from 'node:crypto';
import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ByokGeneratedAssetIngestError,
  byokGeneratedAssetMatchesCreateInput,
  byokGeneratedAssetStorageIdempotencyKey,
  byokGeneratedAssetUploadFilename,
  createByokGeneratedAssetCreateInputFromStoredAsset,
  deriveByokGeneratedAssetIdentity,
  prepareByokGeneratedAsset,
  uploadPreparedByokGeneratedAsset,
  type ByokGeneratedAssetCreateInput,
  type ByokGeneratedAssetRecord,
} from '../services/byok-generated-asset-ingest.js';
import {
  deriveOwnedImageStorageKey,
  type OwnedImageStorageBackend,
} from '../services/image-storage.js';
import {
  EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION,
  EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
  EXTENSION_BYOK_MEDIA_INGEST_SCOPE,
  type ExtensionByokMediaBatchIngestResolvedCommand,
} from '../services/extension-byok-media-ingest-grant.js';
import {
  EXTENSION_BYOK_MEDIA_BATCH_INGEST_MANIFEST_MAX_BYTES,
  ExtensionByokMediaBatchIngestRequestError,
  parseExtensionByokMediaBatchIngestManifest,
  type ExtensionByokMediaBatchIngestManifest,
} from '../services/extension-byok-media-batch-ingest-request.js';
import {
  EXTENSION_BYOK_MEDIA_BATCH_INGEST_STATUS_VERSION,
  ExtensionByokMediaBatchIngestStatusRequestError,
  parseExtensionByokMediaBatchIngestStatusRequest,
  type ExtensionByokMediaBatchIngestStatusLookupInput,
} from '../services/extension-byok-media-batch-ingest-status.js';
import {
  deriveExtensionByokBatchItemIdempotencyKey,
  type CommitExtensionByokGeneratedAssetBatchInput,
  type CommitExtensionByokGeneratedAssetBatchResult,
} from '../repositories/extension-byok-generated-asset-batch-commit-prisma.js';
import {
  ExtensionByokGeneratedAssetCommitError,
} from '../repositories/extension-byok-generated-asset-commit-prisma.js';
import {
  ExtensionByokMediaBatchIngestStatusRepositoryError,
  type ExtensionByokMediaBatchIngestStatusResult,
} from '../repositories/extension-byok-media-batch-ingest-status-repository.js';
import {
  hashExtensionCommandRequest,
  type ExtensionCommandBinding,
  type ExtensionCommandInspectResult,
} from '../services/extension-command-grants.js';
import {
  ExtensionByokUploadStagingError,
  type ExtensionByokUploadStagingStore,
} from '../services/extension-byok-upload-staging.js';
import type { ExtensionByokIngestRateLimiter } from '../services/extension-byok-ingest-rate-limit.js';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_BYTES = 50 * 1024 * 1024;
const MULTIPART_BODY_LIMIT = MAX_BATCH_BYTES + 256 * 1024;
const STATUS_BODY_LIMIT = 64 * 1024;
const RATE_LIMIT_PER_MINUTE = 10;

interface BatchDevice {
  sessionId: string;
  tokenId: string;
  ownerUserId: string;
  actorUserId: string;
  scopes: string[];
  allowedShopIds: string[];
}

type BatchCommandResolution =
  | {
    kind: 'allowed';
    shopId: string | null;
    workflowId: string | null;
    draftVersion: number | null;
    command: Record<string, unknown>;
  }
  | { kind: 'unavailable' | 'stale' | 'forbidden' | 'rollout_unavailable' };

interface PreparedBatchItem {
  command: ExtensionByokMediaBatchIngestResolvedCommand['items'][number];
  identityInput: Parameters<typeof deriveByokGeneratedAssetIdentity>[0];
  existing: ByokGeneratedAssetRecord | null;
  storage: OwnedImageStorageBackend | null;
  stagingId: string | null;
  stagedStorageKey: string | null;
  leaseOwned: boolean;
  buffer: Buffer | null;
  asset: ByokGeneratedAssetCreateInput | null;
  uploaded: Awaited<ReturnType<typeof uploadPreparedByokGeneratedAsset>> | null;
  uploadPhase: 'NOT_REQUIRED' | 'NOT_STARTED' | 'IN_FLIGHT' | 'UPLOADED';
}

type BatchIngestPhase =
  | 'AUTHORIZING'
  | 'STAGING'
  | 'READING_IMAGES'
  | 'UPLOADING'
  | 'COMMITTING'
  | 'COMMITTED';

export interface ExtensionByokMediaBatchRoutesOptions {
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  resolveCommand(input: {
    sessionId: string;
    ownerUserId: string;
    operation: typeof EXTENSION_BYOK_MEDIA_INGEST_OPERATION;
    shopId: string;
    workflowId: string;
    draftVersion: number;
    purpose?: 'issue' | 'execute';
    idempotencyKey: string;
    command: Record<string, unknown>;
  }): Promise<BatchCommandResolution>;
  digestGrantToken(token: string): string;
  inspectGrant(input: {
    tokenDigest: string;
    binding: ExtensionCommandBinding;
    now: Date;
  }): Promise<ExtensionCommandInspectResult>;
  ingestRateLimiter: ExtensionByokIngestRateLimiter;
  stagingStore: ExtensionByokUploadStagingStore;
  getStorage(): Promise<OwnedImageStorageBackend>;
  findStoredAsset(input: {
    assetId: string;
    ownerUserId: string;
  }): Promise<ByokGeneratedAssetRecord | null>;
  commit(input: CommitExtensionByokGeneratedAssetBatchInput): Promise<
    CommitExtensionByokGeneratedAssetBatchResult
  >;
  findBatchStatus(input: ExtensionByokMediaBatchIngestStatusLookupInput): Promise<
    ExtensionByokMediaBatchIngestStatusResult
  >;
  now?: () => Date;
  createReceiptId?: () => string;
}

function routeError(reply: FastifyReply, status: number, errorCode: string, message: string) {
  reply.header('Cache-Control', 'no-store');
  return reply.status(status).send({ code: 0, errorCode, msg: message });
}

function deviceContext(request: FastifyRequest): BatchDevice | null {
  const value = (request as any).device as Partial<BatchDevice> | undefined;
  if (!value
    || typeof value.sessionId !== 'string'
    || typeof value.tokenId !== 'string'
    || typeof value.ownerUserId !== 'string'
    || value.actorUserId !== value.ownerUserId
    || !Array.isArray(value.scopes)
    || !value.scopes.includes(EXTENSION_BYOK_MEDIA_INGEST_SCOPE)
    || !Array.isArray(value.allowedShopIds)) return null;
  return value as BatchDevice;
}

function grantToken(request: FastifyRequest): string | null {
  const value = String(request.headers['x-ss-erp-command-grant'] || '').trim();
  return /^[A-Za-z0-9_-]{43,4096}$/u.test(value) ? value : null;
}

function sameStoredObject(
  asset: ByokGeneratedAssetRecord,
  upload: { backend: string; objectKey?: string; key?: string; filename: string },
) {
  return asset.storageBackend === upload.backend
    && asset.storageKey === (upload.objectKey || upload.key || upload.filename);
}

function resolutionError(
  reply: FastifyReply,
  resolution: Exclude<BatchCommandResolution, { kind: 'allowed' }>,
) {
  const decisions = {
    forbidden: [403, 'byok_batch_ingest_forbidden', '无权接收该 BYOK 图片批次'],
    stale: [409, 'byok_batch_ingest_draft_stale', '商品草稿已变化，请刷新后重试'],
    unavailable: [409, 'byok_batch_ingest_unavailable', 'BYOK 批量接收尚未开放'],
    rollout_unavailable: [503, 'byok_batch_ingest_policy_unavailable', 'BYOK 策略暂不可用'],
  } as const;
  const [status, code, message] = decisions[resolution.kind];
  return routeError(reply, status, code, message);
}

function grantInspectionError(
  reply: FastifyReply,
  result: Exclude<ExtensionCommandInspectResult, { kind: 'allowed' | 'replay' }>,
) {
  const decisions = {
    not_found: [404, 'byok_batch_ingest_grant_not_found', 'BYOK 接收授权不存在'],
    mismatch: [409, 'byok_batch_ingest_grant_mismatch', 'BYOK 接收授权与批次不匹配'],
    expired: [410, 'byok_batch_ingest_grant_expired', 'BYOK 接收授权已过期'],
    revoked: [410, 'byok_batch_ingest_grant_revoked', 'BYOK 接收授权已撤销'],
    session_invalid: [401, 'byok_batch_ingest_session_invalid', '扩展设备会话已失效'],
    scope_denied: [403, 'byok_batch_ingest_scope_denied', '设备缺少 BYOK 接收权限'],
    shop_denied: [403, 'byok_batch_ingest_shop_denied', '设备无权访问该店铺'],
  } as const;
  const [status, code, message] = decisions[result.kind];
  return routeError(reply, status, code, message);
}

function statusInput(
  manifest: ExtensionByokMediaBatchIngestManifest,
  command: ExtensionByokMediaBatchIngestResolvedCommand,
  binding: ExtensionCommandBinding,
  device: BatchDevice,
): ExtensionByokMediaBatchIngestStatusLookupInput {
  return {
    contractVersion: EXTENSION_BYOK_MEDIA_BATCH_INGEST_STATUS_VERSION,
    sessionId: device.sessionId,
    ownerUserId: device.ownerUserId,
    executionBatchId: manifest.executionBatchId,
    shopId: manifest.shopId,
    workflowId: manifest.workflowId,
    draftRevision: command.items[0]!.draftRevision,
    draftVersion: manifest.draftVersion,
    idempotencyKey: manifest.idempotencyKey,
    requestHash: binding.requestHash,
    items: command.items.map((item) => ({
      executionIntentId: item.executionIntentId,
      providerRequestHash: item.providerRequestHash,
      providerResultSha256: item.resultSha256,
      skuKey: item.skuKey,
      slotKey: item.slotKey,
      assignmentOrdinal: item.assignmentOrdinal,
    })),
  };
}

function publicReceipt(result: CommitExtensionByokGeneratedAssetBatchResult) {
  return {
    contractVersion: result.receipt.contractVersion,
    executionBatchId: result.receipt.executionBatchId,
    replayed: result.replayed,
    receiptId: result.receiptId,
    requestHash: result.receipt.requestHash,
    sourceDraftRevision: result.receipt.sourceDraftRevision,
    sourceDraftVersion: result.receipt.sourceDraftVersion,
    boundDraftRevision: result.receipt.boundDraftRevision,
    boundDraftVersion: result.receipt.boundDraftVersion,
    erpAiChargeCents: result.receipt.erpAiChargeCents,
    items: result.receipt.items,
  };
}

async function releaseDefinitelyEmptyLeases(
  items: PreparedBatchItem[],
  store: ExtensionByokUploadStagingStore,
  now: Date,
) {
  await Promise.all(items
    .filter((item) => item.leaseOwned
      && item.stagingId
      && item.uploadPhase === 'NOT_STARTED')
    .map(async (item) => {
      await store.markImmediateCleaned({ id: item.stagingId!, now }).catch(() => undefined);
    }));
}

async function cleanupUploadedItems(input: {
  items: PreparedBatchItem[];
  options: ExtensionByokMediaBatchRoutesOptions;
  now: Date;
  cause?: unknown;
}) {
  let cleanupFailure: unknown = null;
  for (const item of input.items) {
    if (!item.storage || !item.uploaded || !item.stagingId) continue;
    let winner: ByokGeneratedAssetRecord | null;
    try {
      winner = await input.options.findStoredAsset({
        assetId: item.uploaded.createInput.id,
        ownerUserId: item.uploaded.createInput.ownerUserId,
      });
    } catch {
      continue;
    }
    if (winner && (sameStoredObject(winner, item.uploaded.upload)
      || byokGeneratedAssetMatchesCreateInput(winner, item.uploaded.createInput))) continue;
    try {
      await item.storage.deleteUploaded(item.uploaded.upload);
      await input.options.stagingStore.markImmediateCleaned({
        id: item.stagingId,
        now: input.now,
      }).catch(() => undefined);
    } catch (error) {
      cleanupFailure ||= error;
      await input.options.stagingStore.markImmediateCleanupFailed({
        id: item.stagingId,
        now: input.now,
        error,
      }).catch(() => undefined);
    }
  }
  if (cleanupFailure) {
    throw new ByokGeneratedAssetIngestError(
      'BYOK_IMAGE_STORAGE_CLEANUP_FAILED',
      'BYOK batch ingest failed and uploaded bytes could not be removed safely',
      503,
      { cause: { originalError: input.cause, cleanupFailure } },
    );
  }
  if (input.cause) throw input.cause;
}

export async function readExtensionByokMediaBatchFilePart(
  part: any,
  expectedName: string,
  expectedMime: string,
  remainingBatchBytes: number,
) {
  if (!part || part.type !== 'file'
    || part.fieldname !== expectedName
    || part.mimetype !== expectedMime
    || !Number.isSafeInteger(remainingBatchBytes)
    || remainingBatchBytes < 0) {
    throw new ExtensionByokMediaBatchIngestRequestError();
  }
  const chunks: Buffer[] = [];
  let size = 0;
  const maximumBytes = Math.min(MAX_IMAGE_BYTES, remainingBatchBytes);
  for await (const value of part.file) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (chunk.length > maximumBytes - size) {
      throw new ByokGeneratedAssetIngestError(
        'BYOK_IMAGE_BYTE_LIMIT_EXCEEDED',
        'BYOK batch image exceeds the byte limit',
        413,
      );
    }
    size += chunk.length;
    chunks.push(chunk);
  }
  if (part.file.truncated || size < 1) {
    throw new ExtensionByokMediaBatchIngestRequestError();
  }
  return Buffer.concat(chunks, size);
}

function multipartError(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code || '');
  return code.startsWith('FST_') && (
    code.includes('FILE_TOO_LARGE')
    || code.includes('FILES_LIMIT')
    || code.includes('FIELDS_LIMIT')
    || code.includes('PARTS_LIMIT')
  );
}

export async function extensionByokMediaBatchRoutes(
  app: FastifyInstance,
  options: ExtensionByokMediaBatchRoutesOptions,
) {
  await app.register(multipart, {
    limits: {
      fieldNameSize: 100,
      fieldSize: EXTENSION_BYOK_MEDIA_BATCH_INGEST_MANIFEST_MAX_BYTES,
      fields: 1,
      fileSize: MAX_IMAGE_BYTES,
      files: 4,
      parts: 5,
      headerPairs: 50,
    },
  });

  app.post('/batch-ingest-status', {
    bodyLimit: STATUS_BODY_LIMIT,
    onRequest: [options.authenticateDevice],
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const device = deviceContext(request);
    if (!device) return routeError(reply, 403, 'byok_batch_ingest_status_scope_denied', '设备缺少 BYOK 权限');
    try {
      const parsed = parseExtensionByokMediaBatchIngestStatusRequest(request.body);
      if (!device.allowedShopIds.includes(parsed.shopId)) {
        return routeError(reply, 403, 'byok_batch_ingest_status_shop_denied', '设备无权访问该店铺');
      }
      const result = await options.findBatchStatus({
        ...parsed,
        sessionId: device.sessionId,
        ownerUserId: device.ownerUserId,
      });
      if (result.kind === 'not_found') {
        return routeError(reply, 404, 'byok_batch_ingest_status_not_found', 'BYOK 批量接收记录不存在');
      }
      if (result.kind === 'failed') {
        return routeError(reply, 409, 'byok_batch_ingest_status_failed', '此前的 BYOK 批量接收已失败');
      }
      if (result.kind === 'not_committed') {
        return reply.status(202).send({ code: 1, data: { state: 'NOT_COMMITTED' } });
      }
      if (result.kind === 'pending') {
        return reply.status(202).send({ code: 1, data: { state: 'PENDING' } });
      }
      return reply.send({
        code: 1,
        data: {
          contractVersion: result.receipt.contractVersion,
          executionBatchId: result.receipt.executionBatchId,
          replayed: true,
          receiptId: result.receiptId,
          requestHash: result.receipt.requestHash,
          sourceDraftRevision: result.receipt.sourceDraftRevision,
          sourceDraftVersion: result.receipt.sourceDraftVersion,
          boundDraftRevision: result.receipt.boundDraftRevision,
          boundDraftVersion: result.receipt.boundDraftVersion,
          erpAiChargeCents: result.receipt.erpAiChargeCents,
          items: result.receipt.items,
        },
      });
    } catch (error) {
      if (error instanceof ExtensionByokMediaBatchIngestStatusRequestError) {
        return routeError(reply, error.statusCode, error.code.toLowerCase(), error.message);
      }
      if (error instanceof ExtensionByokMediaBatchIngestStatusRepositoryError) {
        return routeError(reply, error.statusCode, error.code.toLowerCase(), error.message);
      }
      request.log.error({ err: error }, 'extension BYOK batch ingest status failed');
      return routeError(reply, 503, 'byok_batch_ingest_status_unavailable', 'BYOK 批量接收状态暂不可用');
    }
  });

  app.post('/batch-ingest', {
    bodyLimit: MULTIPART_BODY_LIMIT,
    onRequest: [options.authenticateDevice],
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const device = deviceContext(request);
    if (!device) return routeError(reply, 403, 'byok_batch_ingest_scope_denied', '设备缺少 BYOK 权限');
    const token = grantToken(request);
    if (!token) return routeError(reply, 401, 'byok_batch_ingest_grant_required', '缺少 BYOK 接收授权');
    const currentTime = options.now || (() => new Date());
    const preparedItems: PreparedBatchItem[] = [];
    let phase: BatchIngestPhase = 'AUTHORIZING';
    try {
      const iterator = request.parts()[Symbol.asyncIterator]();
      const firstPart = await iterator.next();
      if (firstPart.done
        || firstPart.value.type !== 'field'
        || firstPart.value.fieldname !== 'manifest'
        || typeof firstPart.value.value !== 'string') {
        throw new ExtensionByokMediaBatchIngestRequestError();
      }
      const manifest = parseExtensionByokMediaBatchIngestManifest(firstPart.value.value);
      if (!device.allowedShopIds.includes(manifest.shopId)) {
        return routeError(reply, 403, 'byok_batch_ingest_shop_denied', '设备无权访问该店铺');
      }
      let resolution: BatchCommandResolution;
      try {
        resolution = await options.resolveCommand({
          sessionId: device.sessionId,
          ownerUserId: device.ownerUserId,
          operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
          shopId: manifest.shopId,
          workflowId: manifest.workflowId,
          draftVersion: manifest.draftVersion,
          purpose: 'execute',
          idempotencyKey: manifest.idempotencyKey,
          command: manifest.command,
        });
      } catch {
        return routeError(reply, 503, 'byok_batch_ingest_policy_unavailable', 'BYOK 策略暂不可用');
      }
      if (resolution.kind !== 'allowed') return resolutionError(reply, resolution);
      if (resolution.shopId !== manifest.shopId
        || resolution.workflowId !== manifest.workflowId
        || resolution.draftVersion !== manifest.draftVersion
        || resolution.command.schemaVersion !== EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION
        || resolution.command.executionBatchId !== manifest.executionBatchId) {
        return routeError(reply, 409, 'byok_batch_ingest_draft_stale', '商品草稿已变化，请刷新后重试');
      }
      const command = resolution.command as ExtensionByokMediaBatchIngestResolvedCommand;
      const binding: ExtensionCommandBinding = {
        sessionId: device.sessionId,
        tokenId: device.tokenId,
        ownerUserId: device.ownerUserId,
        shopId: manifest.shopId,
        operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
        workflowId: manifest.workflowId,
        draftVersion: manifest.draftVersion,
        idempotencyKey: manifest.idempotencyKey,
        requestHash: hashExtensionCommandRequest({
          operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
          shopId: manifest.shopId,
          workflowId: manifest.workflowId,
          draftVersion: manifest.draftVersion,
          command,
        }),
      };
      const tokenDigest = options.digestGrantToken(token);
      const inspected = await options.inspectGrant({
        tokenDigest,
        binding,
        now: currentTime(),
      });
      if (inspected.kind !== 'allowed' && inspected.kind !== 'replay') {
        return grantInspectionError(reply, inspected);
      }
      const rate = await options.ingestRateLimiter.consume({
        id: randomUUID(),
        ownerUserId: device.ownerUserId,
        deviceSessionId: device.sessionId,
        limit: RATE_LIMIT_PER_MINUTE,
      });
      if (rate.kind === 'rate_limited') {
        return routeError(reply, 429, 'byok_batch_ingest_rate_limited', 'BYOK 批量接收请求过于频繁');
      }
      if (inspected.kind === 'replay') {
        const status = await options.findBatchStatus(statusInput(manifest, command, binding, device));
        if (status.kind === 'succeeded') {
          return reply.send({
            code: 1,
            data: publicReceipt({
              replayed: true,
              receiptId: status.receiptId,
              receipt: status.receipt,
              assets: [],
            }),
          });
        }
        if (status.kind === 'pending') {
          return routeError(reply, 409, 'byok_batch_ingest_receipt_pending', 'BYOK 批量接收正在处理中');
        }
        return routeError(reply, 409, 'byok_batch_ingest_receipt_failed', '此前的 BYOK 批量接收未成功');
      }

      phase = 'STAGING';
      let storage: OwnedImageStorageBackend | null = null;
      for (const item of command.items) {
        const identityInput = {
          ownerUserId: device.ownerUserId,
          sourceCaptureSnapshotId: item.authority.sourceCaptureSnapshotId,
          idempotencyKey: deriveExtensionByokBatchItemIdempotencyKey(
            manifest.idempotencyKey,
            item.executionIntentId,
          ),
          requestHash: binding.requestHash,
          expectedProviderResultSha256: item.resultSha256,
          declaredMimeType: item.resultMimeType,
          declaredSizeBytes: item.resultSizeBytes,
        };
        const identity = deriveByokGeneratedAssetIdentity(identityInput);
        const existing = await options.findStoredAsset({
          assetId: identity.assetId,
          ownerUserId: identity.ownerUserId,
        });
        let stagingId: string | null = null;
        let stagedStorageKey: string | null = null;
        let leaseOwned = false;
        if (!existing) {
          storage ||= await options.getStorage();
          stagingId = identity.assetId;
          const filename = byokGeneratedAssetUploadFilename(identity.assetId, item.resultMimeType);
          stagedStorageKey = deriveOwnedImageStorageKey(storage.backendType, filename, {
            category: 'ai-generated',
            ownerId: identity.ownerUserId,
            idempotencyKey: byokGeneratedAssetStorageIdempotencyKey(stagingId),
          });
          const lease = await options.stagingStore.beginAttempt({
            id: stagingId,
            ownerUserId: identity.ownerUserId,
            deviceSessionId: device.sessionId,
            assetId: identity.assetId,
            requestHash: binding.requestHash,
            storageBackend: storage.backendType,
            storageNamespaceId: storage.namespaceId,
            storageKey: stagedStorageKey,
            now: currentTime(),
          });
          if (lease.kind === 'active') {
            throw new ExtensionByokUploadStagingError('BYOK batch upload staging is active');
          }
          leaseOwned = true;
        }
        preparedItems.push({
          command: item,
          identityInput,
          existing,
          storage: existing ? null : storage,
          stagingId,
          stagedStorageKey,
          leaseOwned,
          buffer: null,
          asset: null,
          uploaded: null,
          uploadPhase: existing ? 'NOT_REQUIRED' : 'NOT_STARTED',
        });
      }

      phase = 'READING_IMAGES';
      let totalBytes = 0;
      for (let index = 0; index < preparedItems.length; index += 1) {
        const next = await iterator.next();
        if (next.done) throw new ExtensionByokMediaBatchIngestRequestError();
        const item = preparedItems[index]!;
        item.buffer = await readExtensionByokMediaBatchFilePart(
          next.value,
          `image-${index}`,
          item.command.resultMimeType,
          MAX_BATCH_BYTES - totalBytes,
        );
        totalBytes += item.buffer.length;
        if (item.buffer.length !== item.command.resultSizeBytes
          || totalBytes > MAX_BATCH_BYTES) {
          throw new ByokGeneratedAssetIngestError(
            'BYOK_IMAGE_BYTE_LIMIT_EXCEEDED',
            'BYOK batch image bytes do not match the granted manifest',
            413,
          );
        }
      }
      if (!(await iterator.next()).done) throw new ExtensionByokMediaBatchIngestRequestError();

      phase = 'UPLOADING';
      for (const item of preparedItems) {
        const prepared = await prepareByokGeneratedAsset({
          ...item.identityInput,
          source: item.buffer!,
        });
        if (item.existing) {
          item.asset = createByokGeneratedAssetCreateInputFromStoredAsset(prepared, item.existing);
          continue;
        }
        item.uploadPhase = 'IN_FLIGHT';
        item.uploaded = await uploadPreparedByokGeneratedAsset(
          prepared,
          item.storage!,
          item.stagingId!,
        );
        item.uploadPhase = 'UPLOADED';
        const recorded = await options.stagingStore.recordUploadedObject({
          id: item.stagingId!,
          ownerUserId: item.identityInput.ownerUserId,
          deviceSessionId: device.sessionId,
          storageBackend: item.storage!.backendType,
          storageNamespaceId: item.storage!.namespaceId,
          expectedStorageKey: item.stagedStorageKey!,
          actualStorageKey: item.uploaded.createInput.storageKey,
        });
        if (!recorded || item.uploaded.createInput.storageKey !== item.stagedStorageKey) {
          throw new ByokGeneratedAssetIngestError(
            'BYOK_IMAGE_STORAGE_RESULT_INVALID',
            'Generated image upload could not be bound to its cleanup record',
            503,
          );
        }
        item.asset = item.uploaded.createInput;
      }

      phase = 'COMMITTING';
      const committed = await options.commit({
        binding,
        tokenDigest,
        receiptId: (options.createReceiptId || randomUUID)(),
        actorUserId: device.actorUserId,
        now: currentTime(),
        command,
        items: preparedItems.map((item) => ({
          asset: item.asset!,
          stagingId: item.stagingId,
          stagingStorageNamespaceId: item.storage?.namespaceId || null,
        })),
      });
      phase = 'COMMITTED';
      for (let index = 0; index < preparedItems.length; index += 1) {
        const item = preparedItems[index]!;
        const asset = committed.assets[index];
        if (item.uploaded && asset && !sameStoredObject(asset, item.uploaded.upload)) {
          await cleanupUploadedItems({ items: [item], options, now: currentTime() });
        }
      }
      return reply.send({ code: 1, data: publicReceipt(committed) });
    } catch (error) {
      let failure = error;
      const beforeCommit = phase !== 'COMMITTING' && phase !== 'COMMITTED';
      const confirmedRollback = phase === 'COMMITTING'
        && error instanceof ExtensionByokGeneratedAssetCommitError;
      // Generic commit failures may be observed after the transaction committed.
      // Preserve their staging rows for receipt lookup and orphan reconciliation.
      if (beforeCommit || confirmedRollback) {
        try {
          await cleanupUploadedItems({ items: preparedItems, options, now: currentTime() });
        } catch (cleanupError) {
          failure = cleanupError;
        }
        await releaseDefinitelyEmptyLeases(preparedItems, options.stagingStore, currentTime());
      }
      if (failure instanceof ExtensionByokMediaBatchIngestRequestError) {
        return routeError(reply, failure.statusCode, failure.code.toLowerCase(), failure.message);
      }
      if (failure instanceof ByokGeneratedAssetIngestError
        || failure instanceof ExtensionByokGeneratedAssetCommitError
        || failure instanceof ExtensionByokUploadStagingError) {
        return routeError(reply, failure.statusCode, failure.code.toLowerCase(), failure.message);
      }
      if (multipartError(failure)) {
        return routeError(reply, 413, 'byok_batch_ingest_multipart_limit', 'BYOK 批量图片超过限制');
      }
      request.log.error({ err: failure }, 'extension BYOK batch ingest failed');
      return routeError(reply, 500, 'byok_batch_ingest_failed', 'BYOK 批量接收失败');
    }
  });
}
