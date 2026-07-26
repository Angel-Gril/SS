import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AI_IMAGE_WORKBENCH_LIMITS } from 'shared';
import {
  type ByokGeneratedAssetCreateInput,
  type ByokGeneratedAssetRecord,
  ByokGeneratedAssetIngestError,
  byokGeneratedAssetMatchesCreateInput,
  byokGeneratedAssetStorageIdempotencyKey,
  byokGeneratedAssetUploadFilename,
  createByokGeneratedAssetCreateInputFromStoredAsset,
  deriveByokGeneratedAssetIdentity,
  prepareByokGeneratedAsset,
  uploadPreparedByokGeneratedAsset,
} from '../services/byok-generated-asset-ingest.js';
import {
  deriveOwnedImageStorageKey,
  type OwnedImageStorageBackend,
} from '../services/image-storage.js';
import {
  EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
  EXTENSION_BYOK_MEDIA_INGEST_SCOPE,
  type ExtensionByokMediaIngestResolvedCommand,
} from '../services/extension-byok-media-ingest-grant.js';
import {
  decodeExtensionByokMediaIngestManifestHeader,
  EXTENSION_BYOK_MEDIA_INGEST_MANIFEST_HEADER,
  ExtensionByokMediaIngestRequestError,
  type ExtensionByokMediaIngestRequestManifest,
} from '../services/extension-byok-media-ingest-request.js';
import {
  hashExtensionCommandRequest,
  type ExtensionCommandBinding,
  type ExtensionCommandInspectResult,
} from '../services/extension-command-grants.js';
import {
  ExtensionByokGeneratedAssetCommitError,
  type CommitExtensionByokGeneratedAssetInput,
  type CommitExtensionByokGeneratedAssetResult,
} from '../repositories/extension-byok-generated-asset-commit-prisma.js';
import type { ExtensionByokUploadStagingStore } from '../services/extension-byok-upload-staging.js';
import type { ExtensionByokIngestRateLimiter } from '../services/extension-byok-ingest-rate-limit.js';

interface ExtensionByokMediaDevice {
  sessionId: string;
  tokenId: string;
  ownerUserId: string;
  actorUserId: string;
  scopes: string[];
  allowedShopIds: string[];
}

type ExtensionByokMediaCommandResolution =
  | {
    kind: 'allowed';
    shopId: string | null;
    workflowId: string | null;
    draftVersion: number | null;
    command: Record<string, unknown>;
  }
  | { kind: 'unavailable' | 'stale' | 'forbidden' | 'rollout_unavailable' };

interface PreparedExtensionByokMediaRequest {
  device: ExtensionByokMediaDevice;
  manifest: ExtensionByokMediaIngestRequestManifest;
  command: ExtensionByokMediaIngestResolvedCommand;
  binding: ExtensionCommandBinding;
  tokenDigest: string;
  now: Date;
  grantInspection: Extract<ExtensionCommandInspectResult, { kind: 'allowed' | 'replay' }>;
}

export interface ExtensionByokMediaRoutesOptions {
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
  }): Promise<ExtensionByokMediaCommandResolution>;
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
  commit(
    input: CommitExtensionByokGeneratedAssetInput,
  ): Promise<CommitExtensionByokGeneratedAssetResult>;
  now?: () => Date;
  createReceiptId?: () => string;
}

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const RAW_IMAGE_BODY_LIMIT = AI_IMAGE_WORKBENCH_LIMITS.maxResultBytes;
export const EXTENSION_BYOK_MEDIA_INGEST_RATE_LIMIT_PER_MINUTE = 10;

function routeError(
  reply: FastifyReply,
  statusCode: number,
  errorCode: string,
  message: string,
) {
  reply.header('Cache-Control', 'no-store');
  return reply.status(statusCode).send({ code: 0, errorCode, msg: message });
}

function deviceContext(request: FastifyRequest): ExtensionByokMediaDevice | null {
  const value = (request as any).device as Partial<ExtensionByokMediaDevice> | undefined;
  if (!value
    || typeof value.sessionId !== 'string'
    || typeof value.tokenId !== 'string'
    || typeof value.ownerUserId !== 'string'
    || value.actorUserId !== value.ownerUserId
    || !Array.isArray(value.scopes)
    || !value.scopes.includes(EXTENSION_BYOK_MEDIA_INGEST_SCOPE)
    || !Array.isArray(value.allowedShopIds)) {
    return null;
  }
  return value as ExtensionByokMediaDevice;
}

function contentType(request: FastifyRequest): typeof IMAGE_MIME_TYPES[number] | null {
  const value = String(request.headers['content-type'] || '').split(';')[0]!.trim().toLowerCase();
  return IMAGE_MIME_TYPES.includes(value as typeof IMAGE_MIME_TYPES[number])
    ? value as typeof IMAGE_MIME_TYPES[number]
    : null;
}

function grantToken(request: FastifyRequest): string | null {
  const value = String(request.headers['x-ss-erp-command-grant'] || '').trim();
  return /^[A-Za-z0-9_-]{43,4096}$/u.test(value) ? value : null;
}

function sameStoredObject(
  asset: ByokGeneratedAssetRecord,
  upload: { backend: string; objectKey?: string; key?: string; filename: string },
): boolean {
  return asset.storageBackend === upload.backend
    && asset.storageKey === (upload.objectKey || upload.key || upload.filename);
}

async function compensateFailedCommit(input: {
  options: ExtensionByokMediaRoutesOptions;
  storage: OwnedImageStorageBackend;
  uploaded: Awaited<ReturnType<typeof uploadPreparedByokGeneratedAsset>>;
  stagingId: string;
  now: Date;
  cause: unknown;
}): Promise<never> {
  let winner: ByokGeneratedAssetRecord | null;
  try {
    winner = await input.options.findStoredAsset({
      assetId: input.uploaded.createInput.id,
      ownerUserId: input.uploaded.createInput.ownerUserId,
    });
  } catch {
    // A database error after commit has an unknown outcome. Deleting the
    // deterministic object here could corrupt a committed winner; leave it for
    // the orphan reconciler and preserve the original failure.
    throw input.cause;
  }
  if (winner && (sameStoredObject(winner, input.uploaded.upload)
    || byokGeneratedAssetMatchesCreateInput(winner, input.uploaded.createInput))) {
    throw input.cause;
  }
  try {
    await input.storage.deleteUploaded(input.uploaded.upload);
  } catch (cleanupError) {
    await input.options.stagingStore.markImmediateCleanupFailed({
      id: input.stagingId,
      now: input.now,
      error: cleanupError,
    }).catch(() => undefined);
    throw new ByokGeneratedAssetIngestError(
      'BYOK_IMAGE_STORAGE_CLEANUP_FAILED',
      'BYOK ingest failed and uploaded bytes could not be removed safely',
      503,
      { cause: { originalError: input.cause, cleanupError } },
    );
  }
  await input.options.stagingStore.markImmediateCleaned({
    id: input.stagingId,
    now: input.now,
  }).catch(() => undefined);
  throw input.cause;
}

function resolutionError(
  reply: FastifyReply,
  resolution: Exclude<ExtensionByokMediaCommandResolution, { kind: 'allowed' }>,
) {
  const values = {
    forbidden: [403, 'byok_ingest_forbidden', '无权接收该 BYOK 图片'],
    stale: [409, 'byok_ingest_draft_stale', '商品草稿已变化，请刷新后重试'],
    unavailable: [409, 'byok_ingest_unavailable', 'BYOK 图片接收尚未开放'],
    rollout_unavailable: [503, 'byok_ingest_policy_unavailable', 'BYOK 策略暂不可用'],
  } as const;
  const [status, code, message] = values[resolution.kind];
  return routeError(reply, status, code, message);
}

function grantInspectionError(
  reply: FastifyReply,
  result: Exclude<ExtensionCommandInspectResult, { kind: 'allowed' | 'replay' }>,
) {
  const values = {
    not_found: [404, 'byok_ingest_grant_not_found', 'BYOK 图片接收授权不存在'],
    mismatch: [409, 'byok_ingest_grant_mismatch', 'BYOK 图片接收授权与请求不匹配'],
    expired: [410, 'byok_ingest_grant_expired', 'BYOK 图片接收授权已过期'],
    revoked: [410, 'byok_ingest_grant_revoked', 'BYOK 图片接收授权已撤销'],
    session_invalid: [401, 'byok_ingest_session_invalid', '扩展设备会话已失效'],
    scope_denied: [403, 'byok_ingest_scope_denied', '设备缺少 BYOK 图片接收权限'],
    shop_denied: [403, 'byok_ingest_shop_denied', '设备无权访问该店铺'],
  } as const;
  const [status, code, message] = values[result.kind];
  return routeError(reply, status, code, message);
}

export async function extensionByokMediaRoutes(
  app: FastifyInstance,
  options: ExtensionByokMediaRoutesOptions,
) {
  for (const mime of IMAGE_MIME_TYPES) {
    if (app.hasContentTypeParser(mime)) continue;
    app.addContentTypeParser(
      mime,
      { parseAs: 'buffer', bodyLimit: RAW_IMAGE_BODY_LIMIT },
      (_request, body, done) => done(null, body),
    );
  }

  const preparedRequests = new WeakMap<FastifyRequest, PreparedExtensionByokMediaRequest>();

  app.post('/ingest', {
    bodyLimit: RAW_IMAGE_BODY_LIMIT,
    onRequest: [options.authenticateDevice],
    preParsing: [async (request, reply, payload) => {
      const stop = (statusCode: number, errorCode: string, message: string) => {
        routeError(reply, statusCode, errorCode, message);
        return payload;
      };
      const device = deviceContext(request);
      if (!device) return stop(403, 'byok_ingest_scope_denied', '设备缺少 BYOK 图片接收权限');
      const mimeType = contentType(request);
      if (!mimeType) return stop(415, 'byok_ingest_mime_mismatch', '图片 Content-Type 与授权不一致');
      const contentLengthHeader = request.headers['content-length'];
      if (contentLengthHeader !== undefined) {
        if (!/^\d+$/u.test(contentLengthHeader)) {
          return stop(400, 'byok_ingest_content_length_invalid', '图片 Content-Length 无效');
        }
        const declaredLength = Number(contentLengthHeader);
        if (!Number.isSafeInteger(declaredLength) || declaredLength < 1) {
          return stop(400, 'byok_ingest_image_required', '缺少图片字节');
        }
        if (declaredLength > RAW_IMAGE_BODY_LIMIT) {
          return stop(413, 'byok_ingest_image_too_large', 'BYOK 图片超过大小限制');
        }
      }
      const token = grantToken(request);
      if (!token) return stop(401, 'byok_ingest_grant_required', '缺少 BYOK 图片接收授权');
      let manifest: ExtensionByokMediaIngestRequestManifest;
      try {
        manifest = decodeExtensionByokMediaIngestManifestHeader(
          request.headers[EXTENSION_BYOK_MEDIA_INGEST_MANIFEST_HEADER],
        );
      } catch (error) {
        if (error instanceof ExtensionByokMediaIngestRequestError) {
          return stop(error.statusCode, error.code.toLowerCase(), 'BYOK 图片清单无效');
        }
        throw error;
      }
      if (!device.allowedShopIds.includes(manifest.shopId)) {
        return stop(403, 'byok_ingest_shop_denied', '设备无权访问该店铺');
      }
      if (mimeType !== manifest.command.resultMimeType) {
        return stop(415, 'byok_ingest_mime_mismatch', '图片 Content-Type 与授权不一致');
      }

      let resolution: ExtensionByokMediaCommandResolution;
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
        return stop(503, 'byok_ingest_policy_unavailable', 'BYOK 策略暂不可用');
      }
      if (resolution.kind !== 'allowed') {
        resolutionError(reply, resolution);
        return payload;
      }
      if (resolution.shopId !== manifest.shopId
        || resolution.workflowId !== manifest.workflowId
        || resolution.draftVersion !== manifest.draftVersion) {
        return stop(409, 'byok_ingest_draft_stale', '商品草稿已变化，请刷新后重试');
      }
      const command = resolution.command as ExtensionByokMediaIngestResolvedCommand;
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
      const now = (options.now || (() => new Date()))();
      let tokenDigest: string;
      let grantInspection: ExtensionCommandInspectResult;
      try {
        tokenDigest = options.digestGrantToken(token);
        grantInspection = await options.inspectGrant({ tokenDigest, binding, now });
      } catch {
        return stop(503, 'byok_ingest_grant_unavailable', 'BYOK 图片接收授权暂不可用');
      }
      if (grantInspection.kind !== 'allowed' && grantInspection.kind !== 'replay') {
        grantInspectionError(reply, grantInspection);
        return payload;
      }
      let rateDecision;
      try {
        rateDecision = await options.ingestRateLimiter.consume({
          id: randomUUID(),
          ownerUserId: device.ownerUserId,
          deviceSessionId: device.sessionId,
          limit: EXTENSION_BYOK_MEDIA_INGEST_RATE_LIMIT_PER_MINUTE,
        });
      } catch {
        return stop(503, 'byok_ingest_rate_unavailable', 'BYOK 图片接收限流暂不可用');
      }
      if (rateDecision.kind === 'rate_limited') {
        return stop(429, 'byok_ingest_rate_limited', 'BYOK 图片接收请求过于频繁');
      }
      if (grantInspection.kind === 'replay' && grantInspection.receipt.status === 'PENDING') {
        return stop(409, 'byok_ingest_receipt_pending', 'BYOK 图片接收正在处理中');
      }
      if (grantInspection.kind === 'replay' && grantInspection.receipt.status !== 'SUCCEEDED') {
        return stop(409, 'byok_ingest_receipt_failed', '此前的 BYOK 图片接收已失败');
      }
      preparedRequests.set(request, {
        device, manifest, command, binding, tokenDigest, now, grantInspection,
      });
      return payload;
    }],
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const preparedRequest = preparedRequests.get(request);
    preparedRequests.delete(request);
    if (!preparedRequest) {
      return routeError(reply, 500, 'byok_ingest_authorization_missing', 'BYOK 图片接收授权上下文缺失');
    }
    const {
      device, manifest, command, binding, tokenDigest, now, grantInspection,
    } = preparedRequest;
    if (!Buffer.isBuffer(request.body) || request.body.length < 1) {
      return routeError(reply, 400, 'byok_ingest_image_required', '缺少图片字节');
    }
    const currentTime = options.now || (() => new Date());

    try {
      const ingestIdentityInput = {
        ownerUserId: device.ownerUserId,
        sourceCaptureSnapshotId: command.authority.sourceCaptureSnapshotId,
        idempotencyKey: manifest.idempotencyKey,
        requestHash: binding.requestHash,
        expectedProviderResultSha256: command.resultSha256,
        declaredMimeType: command.resultMimeType,
        declaredSizeBytes: command.resultSizeBytes,
      };
      const identity = deriveByokGeneratedAssetIdentity(ingestIdentityInput);
      const existing = await options.findStoredAsset({
        assetId: identity.assetId,
        ownerUserId: identity.ownerUserId,
      });
      if (grantInspection.kind === 'replay' && !existing) {
        return routeError(
          reply,
          409,
          'byok_ingest_replay_asset_missing',
          'BYOK 图片接收记录与已存储资源不一致',
        );
      }
      const receiptId = (options.createReceiptId || randomUUID)();
      let storage: OwnedImageStorageBackend | null = null;
      let uploaded: Awaited<ReturnType<typeof uploadPreparedByokGeneratedAsset>> | null = null;
      let stagingId: string | null = null;
      let stagedStorageKey: string | null = null;
      if (!existing) {
        storage = await options.getStorage();
        stagingId = receiptId;
        const filename = byokGeneratedAssetUploadFilename(identity.assetId, command.resultMimeType);
        const storageKey = deriveOwnedImageStorageKey(storage.backendType, filename, {
          category: 'ai-generated',
          ownerId: identity.ownerUserId,
          idempotencyKey: byokGeneratedAssetStorageIdempotencyKey(stagingId),
        });
        await options.stagingStore.beginAttempt({
          id: stagingId,
          ownerUserId: identity.ownerUserId,
          deviceSessionId: device.sessionId,
          assetId: identity.assetId,
          requestHash: binding.requestHash,
          storageBackend: storage.backendType,
          storageNamespaceId: storage.namespaceId,
          storageKey,
          now,
        });
        stagedStorageKey = storageKey;
      }
      let prepared;
      try {
        prepared = await prepareByokGeneratedAsset({
          ...ingestIdentityInput,
          source: request.body,
        });
      } catch (error) {
        if (stagingId) {
          await options.stagingStore.markImmediateCleaned({
            id: stagingId,
            now: currentTime(),
          }).catch(() => undefined);
        }
        throw error;
      }
      let asset: ByokGeneratedAssetCreateInput;
      if (existing) {
        asset = createByokGeneratedAssetCreateInputFromStoredAsset(prepared, existing);
      } else {
        uploaded = await uploadPreparedByokGeneratedAsset(prepared, storage!, stagingId!);
        const recorded = await options.stagingStore.recordUploadedObject({
          id: stagingId!,
          ownerUserId: identity.ownerUserId,
          deviceSessionId: device.sessionId,
          storageBackend: storage!.backendType,
          storageNamespaceId: storage!.namespaceId,
          expectedStorageKey: stagedStorageKey!,
          actualStorageKey: uploaded.createInput.storageKey,
        });
        if (!recorded) {
          throw new ByokGeneratedAssetIngestError(
            'BYOK_IMAGE_STORAGE_RESULT_INVALID',
            'Generated image upload could not be bound to its cleanup record',
            503,
          );
        }
        if (uploaded.createInput.storageKey !== stagedStorageKey) {
          const cleanupNow = currentTime();
          try {
            await storage!.deleteUploaded(uploaded.upload);
            await options.stagingStore.markImmediateCleaned({ id: stagingId!, now: cleanupNow });
          } catch (cleanupError) {
            await options.stagingStore.markImmediateCleanupFailed({
              id: stagingId!, now: cleanupNow, error: cleanupError,
            }).catch(() => undefined);
            throw new ByokGeneratedAssetIngestError(
              'BYOK_IMAGE_STORAGE_CLEANUP_FAILED',
              'Unexpected generated image object could not be removed',
              503,
              { cause: cleanupError },
            );
          }
          throw new ByokGeneratedAssetIngestError(
            'BYOK_IMAGE_STORAGE_RESULT_INVALID',
            'Generated image storage returned an unexpected staging key',
            503,
          );
        }
        asset = uploaded.createInput;
      }
      let committed: CommitExtensionByokGeneratedAssetResult;
      try {
        const commitNow = currentTime();
        committed = await options.commit({
          binding,
          tokenDigest,
          receiptId,
          actorUserId: device.actorUserId,
          now: commitNow,
          command,
          asset,
          stagingId,
          stagingStorageNamespaceId: storage?.namespaceId || null,
        });
      } catch (error) {
        if (!storage || !uploaded || !stagingId) throw error;
        return compensateFailedCommit({
          options,
          storage,
          uploaded,
          stagingId,
          now: currentTime(),
          cause: error,
        });
      }
      if (storage && uploaded && stagingId && !sameStoredObject(committed.asset, uploaded.upload)) {
        const cleanupNow = currentTime();
        try {
          await storage.deleteUploaded(uploaded.upload);
          await options.stagingStore.markImmediateCleaned({ id: stagingId, now: cleanupNow });
        } catch (cleanupError) {
          await options.stagingStore.markImmediateCleanupFailed({
            id: stagingId,
            now: cleanupNow,
            error: cleanupError,
          }).catch(() => undefined);
          throw new ByokGeneratedAssetIngestError(
            'BYOK_IMAGE_STORAGE_CLEANUP_FAILED',
            'Concurrent replay bytes could not be removed',
            503,
            { cause: cleanupError },
          );
        }
      }
      return reply.send({
        code: 1,
        msg: 'BYOK 图片已安全接收',
        data: {
          replayed: committed.replayed,
          receiptId: committed.receiptId,
          assetId: committed.receipt.assetId,
          provenanceId: committed.receipt.provenanceId,
          normalizedSha256: committed.receipt.normalizedSha256,
          mimeType: committed.receipt.mimeType,
          width: committed.receipt.width,
          height: committed.receipt.height,
          sourceDraftRevision: committed.receipt.draftRevision,
          sourceDraftVersion: committed.receipt.draftVersion,
          boundDraftRevision: committed.receipt.boundDraftRevision,
          boundDraftVersion: committed.receipt.boundDraftVersion,
          skuKey: committed.receipt.skuKey,
          slotKey: committed.receipt.slotKey,
          assignmentOrdinal: committed.receipt.assignmentOrdinal,
          assignmentSha256: committed.receipt.assignmentSha256,
        },
      });
    } catch (error) {
      if (error instanceof ByokGeneratedAssetIngestError
        || error instanceof ExtensionByokGeneratedAssetCommitError) {
        return routeError(reply, error.statusCode, error.code.toLowerCase(), error.message);
      }
      request.log.error({ err: error }, 'extension BYOK media ingest failed');
      return routeError(reply, 500, 'byok_ingest_failed', 'BYOK 图片接收失败');
    }
  });
}
