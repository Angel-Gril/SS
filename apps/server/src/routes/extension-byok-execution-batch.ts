import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  extensionByokExecutionBindingSchema,
  extensionByokExecutionIdentifierSchema,
  getExtensionByokExecutionDevice,
  type ExtensionByokExecutionDevice,
} from './extension-byok-execution-intent.js';
import {
  EXTENSION_BYOK_EXECUTION_BATCH_ATTEMPT_REQUEST_VERSION,
  EXTENSION_BYOK_EXECUTION_BATCH_ATTEMPT_VERSION,
  EXTENSION_BYOK_EXECUTION_BATCH_CANCEL_REQUEST_VERSION,
  EXTENSION_BYOK_EXECUTION_BATCH_CANCEL_VERSION,
  EXTENSION_BYOK_EXECUTION_BATCH_REQUEST_VERSION,
  EXTENSION_BYOK_EXECUTION_BATCH_STATUS_VERSION,
  EXTENSION_BYOK_EXECUTION_BATCH_VERSION,
  ExtensionByokExecutionBatchError,
  type ExtensionByokExecutionBatchErrorCode,
  type ExtensionByokExecutionBatchLoadedItem,
  type ExtensionByokExecutionBatchRecord,
  type ExtensionByokExecutionBatchService,
} from '../services/extension-byok-execution-batch.js';
import {
  EXTENSION_BYOK_EXECUTION_INTENT_VERSION,
  type ExtensionByokExecutionIntentRecord,
} from '../services/extension-byok-execution-intent.js';
import { containsSecretBearingIdentifier } from '../services/extension-byok-media-provenance.js';

const BODY_LIMIT = 64 * 1024;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_ITEMS = 4;

const identifier = extensionByokExecutionIdentifierSchema;

const executionItemSchema = z.object({
  binding: extensionByokExecutionBindingSchema,
  requestMode: z.enum(['json', 'multipart']),
  providerIdempotencyKey: identifier().refine((value) => value.length >= 16),
  providerRequestHash: z.string().regex(HASH_PATTERN),
}).strict();

const createBodySchema = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_EXECUTION_BATCH_REQUEST_VERSION),
  idempotencyKey: identifier().refine((value) => value.length >= 16),
  items: z.array(executionItemSchema).min(1).max(MAX_ITEMS),
}).strict();

const attemptParamsSchema = z.object({
  batchId: identifier(),
  itemIndex: z.string().regex(/^(?:0|[1-3])$/u).transform(Number),
}).strict();

const attemptBodySchema = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_EXECUTION_BATCH_ATTEMPT_REQUEST_VERSION),
  currentIntentId: identifier(),
  providerChargeConfirmed: z.literal(true),
  item: executionItemSchema,
}).strict();

const cancelParamsSchema = z.object({ batchId: identifier() }).strict();
const idempotencyStatusParamsSchema = z.object({
  idempotencyKey: identifier()
    .refine((value) => value.length >= 16)
    .refine((value) => !containsSecretBearingIdentifier(value)),
}).strict();
const cancelBodySchema = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_EXECUTION_BATCH_CANCEL_REQUEST_VERSION),
}).strict();

const contextSchema = z.object({
  shopId: identifier(),
  workflowId: identifier(),
  draftRevision: z.number().int().positive(),
  draftVersion: z.number().int().positive(),
}).strict();

const statusContextSchema = contextSchema.extend({
  sourcePlatform: z.enum(['1688', 'pdd', 'taobao', 'tmall']),
  sourceProductId: identifier(),
  sourceCaptureSnapshotId: identifier(),
  supplyGoodsId: identifier(),
}).strict();

const intentProjectionSchema = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_EXECUTION_INTENT_VERSION),
  intentId: identifier(),
  attemptIndex: z.number().int().min(0).max(499),
  outcome: z.enum(['PENDING', 'SUCCEEDED', 'FAILED_FINAL', 'UNKNOWN_OUTCOME']),
  providerIdempotencyKey: identifier().refine((value) => value.length >= 16),
  providerRequestHash: z.string().regex(HASH_PATTERN),
}).strict();

const itemProjectionSchema = z.object({
  batchItemId: identifier(),
  itemIndex: z.number().int().min(0).max(MAX_ITEMS - 1),
  skuKey: identifier(500),
  slotKey: identifier(),
  assignmentOrdinal: z.number().int().min(0).max(499),
  intent: intentProjectionSchema,
}).strict();

const statusItemProjectionSchema = itemProjectionSchema.extend({
  status: z.enum(['ACTIVE', 'BOUND', 'RELEASED']),
}).strict();

const createProjectionSchema = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_EXECUTION_BATCH_VERSION),
  batchId: identifier(),
  status: z.enum(['OPEN', 'BOUND', 'CANCELLED']),
  replayed: z.boolean(),
  context: contextSchema,
  items: z.array(itemProjectionSchema).min(1).max(MAX_ITEMS),
}).strict();

const attemptProjectionSchema = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_EXECUTION_BATCH_ATTEMPT_VERSION),
  batchId: identifier(),
  status: z.enum(['OPEN', 'BOUND', 'CANCELLED']),
  replayed: z.boolean(),
  context: contextSchema,
  item: itemProjectionSchema,
}).strict();

const cancelProjectionSchema = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_EXECUTION_BATCH_CANCEL_VERSION),
  batchId: identifier(),
  status: z.literal('CANCELLED'),
  replayed: z.boolean(),
}).strict();

const statusProjectionSchema = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_EXECUTION_BATCH_STATUS_VERSION),
  batchId: identifier(),
  status: z.enum(['OPEN', 'BOUND', 'CANCELLED']),
  context: statusContextSchema,
  boundDraftRevision: z.number().int().positive().nullable(),
  boundDraftVersion: z.number().int().positive().nullable(),
  items: z.array(statusItemProjectionSchema).min(1).max(MAX_ITEMS),
}).strict();

export interface ExtensionByokExecutionBatchRoutesOptions {
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  service: Pick<
  ExtensionByokExecutionBatchService,
  'getStatusByIdempotencyKey' | 'getStatus' | 'claim' | 'claimSuccessor' | 'cancel'
  >;
}

interface PublicError {
  statusCode: 400 | 403 | 404 | 409 | 503;
  errorCode: string;
  msg: string;
}

const PUBLIC_ERRORS = {
  BYOK_EXECUTION_BATCH_INVALID_REQUEST: {
    statusCode: 400,
    errorCode: 'byok_execution_batch_invalid_request',
    msg: 'BYOK 执行批次请求无效',
  },
  BYOK_EXECUTION_BATCH_FORBIDDEN: {
    statusCode: 403,
    errorCode: 'byok_execution_batch_forbidden',
    msg: '设备无权操作该 BYOK 执行批次',
  },
  BYOK_EXECUTION_BATCH_CONTEXT_STALE: {
    statusCode: 409,
    errorCode: 'byok_execution_batch_context_stale',
    msg: '商品草稿或图片槽位已变化，请刷新后重试',
  },
  BYOK_EXECUTION_BATCH_POLICY_UNAVAILABLE: {
    statusCode: 503,
    errorCode: 'byok_execution_batch_policy_unavailable',
    msg: 'BYOK 执行策略暂不可用',
  },
  BYOK_EXECUTION_BATCH_POLICY_DISABLED: {
    statusCode: 409,
    errorCode: 'byok_execution_batch_policy_disabled',
    msg: 'BYOK 执行策略已关闭或变化',
  },
  BYOK_EXECUTION_BATCH_MODE_CONFLICT: {
    statusCode: 409,
    errorCode: 'byok_execution_batch_mode_conflict',
    msg: '该商品草稿已锁定为 ERP 托管执行方式',
  },
  BYOK_EXECUTION_BATCH_IDEMPOTENCY_CONFLICT: {
    statusCode: 409,
    errorCode: 'byok_execution_batch_idempotency_conflict',
    msg: 'BYOK 执行批次标识已被其他请求使用',
  },
  BYOK_EXECUTION_BATCH_RESERVATION_CONFLICT: {
    statusCode: 409,
    errorCode: 'byok_execution_batch_reservation_conflict',
    msg: '图片槽位或顺序已被其他批次保留',
  },
  BYOK_EXECUTION_BATCH_NOT_FOUND: {
    statusCode: 404,
    errorCode: 'byok_execution_batch_not_found',
    msg: 'BYOK 执行批次不存在或已失效',
  },
  BYOK_EXECUTION_BATCH_STATE_CONFLICT: {
    statusCode: 409,
    errorCode: 'byok_execution_batch_state_conflict',
    msg: 'BYOK 执行批次当前状态不允许该操作',
  },
  BYOK_EXECUTION_BATCH_ATTEMPT_BLOCKED: {
    statusCode: 409,
    errorCode: 'byok_execution_batch_attempt_blocked',
    msg: '当前 Provider 尝试尚未进入可重试或可取消状态',
  },
  BYOK_EXECUTION_BATCH_CAPACITY_EXCEEDED: {
    statusCode: 409,
    errorCode: 'byok_execution_batch_capacity_exceeded',
    msg: '当前商品草稿保留的 BYOK 执行记录已达上限',
  },
  BYOK_EXECUTION_BATCH_UNAVAILABLE: {
    statusCode: 503,
    errorCode: 'byok_execution_batch_unavailable',
    msg: 'BYOK 执行批次暂不可用',
  },
} satisfies Record<ExtensionByokExecutionBatchErrorCode, PublicError>;

function noStore(reply: FastifyReply) {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
  reply.header('X-Content-Type-Options', 'nosniff');
}

async function applyNoStore(_request: FastifyRequest, reply: FastifyReply) {
  noStore(reply);
}

function routeError(reply: FastifyReply, statusCode: number, errorCode: string, msg: string) {
  noStore(reply);
  return reply.status(statusCode).send({ code: 0, errorCode, msg });
}

function authorizedDevice(
  request: FastifyRequest,
  reply: FastifyReply,
): ExtensionByokExecutionDevice | null {
  const device = getExtensionByokExecutionDevice(request);
  if (!device) {
    routeError(reply, 401, 'invalid_device_context', '无效的扩展设备身份');
    return null;
  }
  if (!device.scopes.includes('byok:media:ingest')) {
    routeError(reply, 403, 'byok_execution_batch_scope_denied', '设备缺少 BYOK 图片接收权限');
    return null;
  }
  return device;
}

function authorizeBindings(
  device: ExtensionByokExecutionDevice,
  bindings: z.infer<typeof extensionByokExecutionBindingSchema>[],
): 'allowed' | 'forbidden' | 'shop_denied' {
  if (bindings.some((binding) => binding.ownerUserId !== device.ownerUserId
    || binding.deviceSessionId !== device.sessionId)) return 'forbidden';
  if (bindings.some((binding) => !device.allowedShopIds.includes(binding.shopId))) {
    return 'shop_denied';
  }
  return 'allowed';
}

function rejectBindingAuthority(
  reply: FastifyReply,
  authority: 'allowed' | 'forbidden' | 'shop_denied',
) {
  if (authority === 'forbidden') {
    return routeError(
      reply,
      403,
      'byok_execution_batch_forbidden',
      '设备无权创建该 BYOK 执行批次',
    );
  }
  if (authority === 'shop_denied') {
    return routeError(reply, 403, 'byok_execution_batch_shop_denied', '设备无权访问该店铺');
  }
  return null;
}

function batchContext(batch: ExtensionByokExecutionBatchRecord) {
  return {
    shopId: batch.shopId,
    workflowId: batch.listingWorkflowId,
    draftRevision: batch.draftRevision,
    draftVersion: batch.draftVersion,
  };
}

function batchStatusContext(batch: ExtensionByokExecutionBatchRecord) {
  return {
    ...batchContext(batch),
    sourcePlatform: batch.sourcePlatform,
    sourceProductId: batch.sourceProductId,
    sourceCaptureSnapshotId: batch.sourceCaptureSnapshotId,
    supplyGoodsId: batch.supplyGoodsId,
  };
}

function assertIntentContext(
  batch: ExtensionByokExecutionBatchRecord,
  intent: ExtensionByokExecutionIntentRecord,
) {
  if (intent.ownerUserId !== batch.ownerUserId
    || intent.actorUserId !== batch.actorUserId
    || intent.deviceSessionId !== batch.deviceSessionId
    || intent.shopId !== batch.shopId
    || intent.listingWorkflowId !== batch.listingWorkflowId
    || intent.draftRevision !== batch.draftRevision
    || intent.draftVersion !== batch.draftVersion) {
    throw new TypeError('BYOK execution batch intent context is invalid');
  }
}

function itemProjection(
  batch: ExtensionByokExecutionBatchRecord,
  intent: ExtensionByokExecutionIntentRecord,
  itemIndex: number,
) {
  assertIntentContext(batch, intent);
  const batchItemId = intent.executionBatchItemId;
  const attemptIndex = intent.executionBatchAttemptIndex;
  if (typeof batchItemId !== 'string' || !batchItemId
    || !Number.isSafeInteger(attemptIndex) || Number(attemptIndex) < 0) {
    throw new TypeError('BYOK execution batch item identity is invalid');
  }
  return {
    batchItemId,
    itemIndex,
    skuKey: intent.skuKey,
    slotKey: intent.slotKey,
    assignmentOrdinal: intent.assignmentOrdinal,
    intent: {
      contractVersion: EXTENSION_BYOK_EXECUTION_INTENT_VERSION,
      intentId: intent.id,
      attemptIndex,
      outcome: intent.outcome,
      providerIdempotencyKey: intent.providerIdempotencyKey,
      providerRequestHash: intent.providerRequestHash,
    },
  };
}

function createProjection(
  batch: ExtensionByokExecutionBatchRecord,
  intents: ExtensionByokExecutionIntentRecord[],
  replayed: boolean,
) {
  if (intents.length !== batch.itemCount) {
    throw new TypeError('BYOK execution batch item count is invalid');
  }
  const items = intents.map((intent) => {
    const itemIndex = intent.assignmentOrdinal - batch.firstAssignmentOrdinal;
    return itemProjection(batch, intent, itemIndex);
  }).sort((left, right) => left.itemIndex - right.itemIndex);
  if (items.some((item, index) => item.itemIndex !== index)
    || new Set(items.map((item) => item.batchItemId)).size !== items.length) {
    throw new TypeError('BYOK execution batch item order is invalid');
  }
  const projection = createProjectionSchema.safeParse({
    contractVersion: EXTENSION_BYOK_EXECUTION_BATCH_VERSION,
    batchId: batch.id,
    status: batch.status,
    replayed,
    context: batchContext(batch),
    items,
  });
  if (!projection.success) throw new TypeError('BYOK execution batch projection is invalid');
  return projection.data;
}

function attemptProjection(
  batch: ExtensionByokExecutionBatchRecord,
  intent: ExtensionByokExecutionIntentRecord,
  itemIndex: number,
  replayed: boolean,
) {
  const item = itemProjection(batch, intent, itemIndex);
  if (item.assignmentOrdinal !== batch.firstAssignmentOrdinal + itemIndex) {
    throw new TypeError('BYOK execution batch attempt order is invalid');
  }
  const projection = attemptProjectionSchema.safeParse({
    contractVersion: EXTENSION_BYOK_EXECUTION_BATCH_ATTEMPT_VERSION,
    batchId: batch.id,
    status: batch.status,
    replayed,
    context: batchContext(batch),
    item,
  });
  if (!projection.success) throw new TypeError('BYOK execution batch attempt projection is invalid');
  return projection.data;
}

function statusProjection(
  batch: ExtensionByokExecutionBatchRecord,
  loadedItems: ExtensionByokExecutionBatchLoadedItem[],
) {
  const bound = batch.status === 'BOUND';
  const lifecycleMatches = batch.status === 'OPEN'
    ? batch.boundAt === null && batch.cancelledAt === null
    : batch.status === 'BOUND'
      ? batch.boundAt !== null && batch.cancelledAt === null
      : batch.boundAt === null && batch.cancelledAt !== null;
  if (!lifecycleMatches
    || (bound && (batch.boundDraftRevision !== batch.draftRevision + 1
      || batch.boundDraftVersion !== batch.draftVersion + 1))
    || (!bound && (batch.boundDraftRevision !== null || batch.boundDraftVersion !== null))
    || loadedItems.length !== batch.itemCount) {
    throw new TypeError('BYOK execution batch recovery state is invalid');
  }
  const expectedItemStatus = batch.status === 'OPEN'
    ? 'ACTIVE'
    : batch.status === 'BOUND' ? 'BOUND' : 'RELEASED';
  const items = loadedItems.map(({ item, intent }) => {
    const projection = itemProjection(batch, intent, item.itemIndex);
    if (item.batchId !== batch.id
      || item.ownerUserId !== batch.ownerUserId
      || item.listingWorkflowId !== batch.listingWorkflowId
      || item.draftRevision !== batch.draftRevision
      || item.draftVersion !== batch.draftVersion
      || item.id !== projection.batchItemId
      || item.skuKey !== projection.skuKey
      || item.slotKey !== projection.slotKey
      || item.assignmentOrdinal !== projection.assignmentOrdinal
      || item.status !== expectedItemStatus
      || (item.status === 'ACTIVE' && (item.boundAt !== null || item.releasedAt !== null))
      || (item.status === 'BOUND' && (item.boundAt === null || item.releasedAt !== null))
      || (item.status === 'RELEASED' && (item.boundAt !== null || item.releasedAt === null))
      || (batch.status === 'BOUND' && intent.outcome !== 'SUCCEEDED')
      || (batch.status === 'CANCELLED'
        && ['PENDING', 'UNKNOWN_OUTCOME'].includes(intent.outcome))) {
      throw new TypeError('BYOK execution batch recovery item is invalid');
    }
    return { ...projection, status: item.status };
  }).sort((left, right) => left.itemIndex - right.itemIndex);
  if (items.some((item, index) => item.itemIndex !== index)
    || new Set(items.map((item) => item.batchItemId)).size !== items.length) {
    throw new TypeError('BYOK execution batch recovery item order is invalid');
  }
  const projection = statusProjectionSchema.safeParse({
    contractVersion: EXTENSION_BYOK_EXECUTION_BATCH_STATUS_VERSION,
    batchId: batch.id,
    status: batch.status,
    context: batchStatusContext(batch),
    boundDraftRevision: batch.boundDraftRevision,
    boundDraftVersion: batch.boundDraftVersion,
    items,
  });
  if (!projection.success) throw new TypeError('BYOK execution batch recovery is invalid');
  return projection.data;
}

function knownError(reply: FastifyReply, error: ExtensionByokExecutionBatchError) {
  const response = PUBLIC_ERRORS[error.code];
  return routeError(reply, response.statusCode, response.errorCode, response.msg);
}

function knownIdempotencyRecoveryError(
  reply: FastifyReply,
  error: ExtensionByokExecutionBatchError,
) {
  if (error.code === 'BYOK_EXECUTION_BATCH_FORBIDDEN') {
    const response = PUBLIC_ERRORS.BYOK_EXECUTION_BATCH_NOT_FOUND;
    return routeError(reply, response.statusCode, response.errorCode, response.msg);
  }
  return knownError(reply, error);
}

export async function extensionByokExecutionBatchRoutes(
  app: FastifyInstance,
  options: ExtensionByokExecutionBatchRoutesOptions,
) {
  app.addHook('onRequest', applyNoStore);

  app.get('/execution-batches/by-idempotency/:idempotencyKey', {
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const params = idempotencyStatusParamsSchema.safeParse(request.params);
    if (!params.success) {
      return routeError(
        reply,
        400,
        'byok_execution_batch_invalid_request',
        'BYOK 执行批次幂等恢复请求无效',
      );
    }
    const device = authorizedDevice(request, reply);
    if (!device) return reply;
    try {
      const result = await options.service.getStatusByIdempotencyKey({
        identity: {
          ownerUserId: device.ownerUserId,
          actorUserId: device.actorUserId,
          deviceSessionId: device.sessionId,
        },
        idempotencyKey: params.data.idempotencyKey,
      });
      if (!device.allowedShopIds.includes(result.batch.shopId)) {
        return routeError(reply, 403, 'byok_execution_batch_shop_denied', '设备无权访问该店铺');
      }
      return reply.status(200).send({
        code: 1,
        data: statusProjection(result.batch, result.items),
      });
    } catch (error) {
      if (error instanceof ExtensionByokExecutionBatchError) {
        return knownIdempotencyRecoveryError(reply, error);
      }
      request.log.error(
        { err: error },
        'extension BYOK execution batch idempotency recovery route failed',
      );
      return routeError(
        reply,
        503,
        'byok_execution_batch_unavailable',
        'BYOK 执行批次幂等恢复暂不可用',
      );
    }
  });

  app.get('/execution-batches/:batchId', {
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const params = cancelParamsSchema.safeParse(request.params);
    if (!params.success) {
      return routeError(
        reply,
        400,
        'byok_execution_batch_invalid_request',
        'BYOK 执行批次状态请求无效',
      );
    }
    const device = authorizedDevice(request, reply);
    if (!device) return reply;
    try {
      const result = await options.service.getStatus({
        identity: {
          ownerUserId: device.ownerUserId,
          actorUserId: device.actorUserId,
          deviceSessionId: device.sessionId,
        },
        batchId: params.data.batchId,
      });
      if (!device.allowedShopIds.includes(result.batch.shopId)) {
        return routeError(reply, 403, 'byok_execution_batch_shop_denied', '设备无权访问该店铺');
      }
      return reply.status(200).send({
        code: 1,
        data: statusProjection(result.batch, result.items),
      });
    } catch (error) {
      if (error instanceof ExtensionByokExecutionBatchError) return knownError(reply, error);
      request.log.error({ err: error }, 'extension BYOK execution batch recovery route failed');
      return routeError(
        reply,
        503,
        'byok_execution_batch_unavailable',
        'BYOK 执行批次状态暂不可用',
      );
    }
  });

  app.post('/execution-batches', {
    bodyLimit: BODY_LIMIT,
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return routeError(
        reply,
        400,
        'byok_execution_batch_invalid_request',
        'BYOK 执行批次请求无效',
      );
    }
    const device = authorizedDevice(request, reply);
    if (!device) return reply;
    const authority = authorizeBindings(device, parsed.data.items.map((item) => item.binding));
    const rejected = rejectBindingAuthority(reply, authority);
    if (rejected) return rejected;
    try {
      const result = await options.service.claim({
        identity: {
          ownerUserId: device.ownerUserId,
          actorUserId: device.actorUserId,
          deviceSessionId: device.sessionId,
        },
        idempotencyKey: parsed.data.idempotencyKey,
        items: parsed.data.items,
      });
      const projection = createProjection(result.batch, result.intents, result.replayed);
      return reply.status(result.replayed ? 200 : 201).send({ code: 1, data: projection });
    } catch (error) {
      if (error instanceof ExtensionByokExecutionBatchError) return knownError(reply, error);
      request.log.error({ err: error }, 'extension BYOK execution batch route failed');
      return routeError(
        reply,
        503,
        'byok_execution_batch_unavailable',
        'BYOK 执行批次暂不可用',
      );
    }
  });

  app.post('/execution-batches/:batchId/items/:itemIndex/attempts', {
    bodyLimit: BODY_LIMIT,
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const params = attemptParamsSchema.safeParse(request.params);
    const parsed = attemptBodySchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return routeError(
        reply,
        400,
        'byok_execution_batch_invalid_request',
        'BYOK 执行批次重试请求无效',
      );
    }
    const device = authorizedDevice(request, reply);
    if (!device) return reply;
    const authority = authorizeBindings(device, [parsed.data.item.binding]);
    const rejected = rejectBindingAuthority(reply, authority);
    if (rejected) return rejected;
    try {
      const result = await options.service.claimSuccessor({
        identity: {
          ownerUserId: device.ownerUserId,
          actorUserId: device.actorUserId,
          deviceSessionId: device.sessionId,
        },
        batchId: params.data.batchId,
        itemIndex: params.data.itemIndex,
        currentIntentId: parsed.data.currentIntentId,
        providerChargeConfirmed: parsed.data.providerChargeConfirmed,
        item: parsed.data.item,
      });
      const projection = attemptProjection(
        result.batch,
        result.intent,
        params.data.itemIndex,
        result.replayed,
      );
      return reply.status(result.replayed ? 200 : 201).send({ code: 1, data: projection });
    } catch (error) {
      if (error instanceof ExtensionByokExecutionBatchError) return knownError(reply, error);
      request.log.error({ err: error }, 'extension BYOK execution batch attempt route failed');
      return routeError(
        reply,
        503,
        'byok_execution_batch_unavailable',
        'BYOK 执行批次重试暂不可用',
      );
    }
  });

  app.post('/execution-batches/:batchId/cancel', {
    bodyLimit: BODY_LIMIT,
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const params = cancelParamsSchema.safeParse(request.params);
    const parsed = cancelBodySchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return routeError(
        reply,
        400,
        'byok_execution_batch_invalid_request',
        'BYOK 执行批次取消请求无效',
      );
    }
    const device = authorizedDevice(request, reply);
    if (!device) return reply;
    try {
      const result = await options.service.cancel({
        identity: {
          ownerUserId: device.ownerUserId,
          actorUserId: device.actorUserId,
          deviceSessionId: device.sessionId,
        },
        batchId: params.data.batchId,
      });
      const projection = cancelProjectionSchema.safeParse({
        contractVersion: EXTENSION_BYOK_EXECUTION_BATCH_CANCEL_VERSION,
        batchId: result.batch.id,
        status: result.batch.status,
        replayed: result.replayed,
      });
      if (!projection.success) {
        throw new TypeError('BYOK execution batch cancellation projection is invalid');
      }
      return reply.status(200).send({ code: 1, data: projection.data });
    } catch (error) {
      if (error instanceof ExtensionByokExecutionBatchError) return knownError(reply, error);
      request.log.error({ err: error }, 'extension BYOK execution batch cancel route failed');
      return routeError(
        reply,
        503,
        'byok_execution_batch_unavailable',
        'BYOK 执行批次取消暂不可用',
      );
    }
  });
}
