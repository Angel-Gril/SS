import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  EXTENSION_BYOK_EXECUTION_INTENT_REQUEST_VERSION,
  EXTENSION_BYOK_EXECUTION_INTENT_OUTCOME_REQUEST_VERSION,
  EXTENSION_BYOK_EXECUTION_INTENT_OUTCOME_VERSION,
  EXTENSION_BYOK_EXECUTION_INTENT_VERSION,
  ExtensionByokExecutionIntentError,
  type ExtensionByokExecutionIntentErrorCode,
  type ExtensionByokExecutionIntentService,
} from '../services/extension-byok-execution-intent.js';
import { EXTENSION_BYOK_OPERATIONS } from '../services/extension-byok-policy.js';
import {
  EXTENSION_BYOK_READINESS_BINDING_VERSION,
} from '../services/extension-byok-readiness-attestation.js';

const BODY_LIMIT = 16 * 1024;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export const extensionByokExecutionIdentifierSchema = (maximum = 200) => z.string().min(1).max(maximum)
  .refine((value) => value === value.normalize('NFKC').trim())
  .refine((value) => !hasControlCharacter(value))
  .refine((value) => !/(?:https?|ftp|data):/iu.test(value))
  .refine((value) => !/[?#]/u.test(value));

const identifier = extensionByokExecutionIdentifierSchema;

export const extensionByokExecutionBindingSchema = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_READINESS_BINDING_VERSION),
  ownerUserId: identifier(),
  deviceSessionId: identifier(),
  shopId: identifier(),
  workflowId: identifier(),
  draftRevision: z.number().int().positive(),
  draftVersion: z.number().int().positive(),
  sourcePlatform: z.enum(['1688', 'pdd', 'taobao', 'tmall']),
  sourceProductId: identifier(),
  sourceCaptureSnapshotId: identifier(),
  supplyGoodsId: identifier(),
  skuKey: identifier(500),
  slotKey: identifier(),
  assignmentMode: z.literal('APPEND'),
  assignmentOrdinal: z.number().int().min(0).max(499),
  providerOrigin: z.string().min(1).max(2_048),
  model: identifier(),
  operation: z.enum(EXTENSION_BYOK_OPERATIONS),
  policyRevision: z.string().min(1).max(32),
}).strict();

const bindingSchema = extensionByokExecutionBindingSchema;

const executionIntentBody = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_EXECUTION_INTENT_REQUEST_VERSION),
  binding: bindingSchema,
  requestMode: z.enum(['json', 'multipart']),
  providerIdempotencyKey: identifier().refine((value) => value.length >= 16),
  providerRequestHash: z.string().regex(HASH_PATTERN),
}).strict();

const executionIntentOutcomeParams = z.object({ intentId: identifier() }).strict();
const executionIntentOutcomeBody = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_EXECUTION_INTENT_OUTCOME_REQUEST_VERSION),
  providerIdempotencyKey: identifier().refine((value) => value.length >= 16),
  providerRequestHash: z.string().regex(HASH_PATTERN),
  outcome: z.enum(['SUCCEEDED', 'FAILED_FINAL', 'UNKNOWN_OUTCOME']),
  providerRequestIdSha256: z.string().regex(HASH_PATTERN).nullable(),
  resultSha256: z.string().regex(HASH_PATTERN).nullable(),
}).strict().superRefine((input, context) => {
  if ((input.outcome === 'SUCCEEDED') !== (input.resultSha256 !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['resultSha256'],
      message: 'resultSha256 is inconsistent with outcome',
    });
  }
});

const successProjectionSchema = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_EXECUTION_INTENT_VERSION),
  intentId: identifier(),
  replayed: z.boolean(),
  executionMode: z.literal('BYOK'),
  outcome: z.enum(['PENDING', 'SUCCEEDED', 'FAILED_FINAL', 'UNKNOWN_OUTCOME']),
  providerIdempotencyKey: identifier().refine((value) => value.length >= 16),
  providerRequestHash: z.string().regex(HASH_PATTERN),
  context: z.object({
    shopId: identifier(),
    workflowId: identifier(),
    draftRevision: z.number().int().positive(),
    draftVersion: z.number().int().positive(),
    skuKey: identifier(500),
    slotKey: identifier(),
  }).strict(),
}).strict();

const outcomeProjectionSchema = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_EXECUTION_INTENT_OUTCOME_VERSION),
  intentId: identifier(),
  replayed: z.boolean(),
  outcome: z.enum(['SUCCEEDED', 'FAILED_FINAL', 'UNKNOWN_OUTCOME']),
  providerIdempotencyKey: identifier().refine((value) => value.length >= 16),
  providerRequestHash: z.string().regex(HASH_PATTERN),
  providerRequestIdSha256: z.string().regex(HASH_PATTERN).nullable(),
  resultSha256: z.string().regex(HASH_PATTERN).nullable(),
}).strict();

export interface ExtensionByokExecutionDevice {
  ownerUserId: string;
  actorUserId: string;
  sessionId: string;
  scopes: string[];
  allowedShopIds: string[];
}

export interface ExtensionByokExecutionIntentRoutesOptions {
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  service: Pick<ExtensionByokExecutionIntentService, 'claim' | 'recordOutcome'>;
}

interface PublicError {
  statusCode: 400 | 403 | 409 | 503;
  errorCode: string;
  msg: string;
}

const PUBLIC_ERRORS = {
  BYOK_EXECUTION_INTENT_INVALID_REQUEST: {
    statusCode: 400,
    errorCode: 'byok_execution_intent_invalid_request',
    msg: 'BYOK 执行请求无效',
  },
  BYOK_EXECUTION_INTENT_FORBIDDEN: {
    statusCode: 403,
    errorCode: 'byok_execution_intent_forbidden',
    msg: '设备无权创建该 BYOK 执行请求',
  },
  BYOK_EXECUTION_INTENT_CONTEXT_STALE: {
    statusCode: 409,
    errorCode: 'byok_execution_intent_context_stale',
    msg: '商品草稿或图片槽位已变化，请刷新后重试',
  },
  BYOK_EXECUTION_INTENT_POLICY_UNAVAILABLE: {
    statusCode: 503,
    errorCode: 'byok_execution_intent_policy_unavailable',
    msg: 'BYOK 执行策略暂不可用',
  },
  BYOK_EXECUTION_INTENT_POLICY_DISABLED: {
    statusCode: 409,
    errorCode: 'byok_execution_intent_policy_disabled',
    msg: 'BYOK 执行策略已关闭或变化',
  },
  BYOK_EXECUTION_INTENT_MODE_CONFLICT: {
    statusCode: 409,
    errorCode: 'byok_execution_intent_mode_conflict',
    msg: '该商品草稿已锁定为 ERP 托管执行方式',
  },
  BYOK_EXECUTION_INTENT_IDEMPOTENCY_CONFLICT: {
    statusCode: 409,
    errorCode: 'byok_execution_intent_idempotency_conflict',
    msg: 'Provider 执行标识已被其他请求使用',
  },
  BYOK_EXECUTION_INTENT_NOT_FOUND: {
    statusCode: 409,
    errorCode: 'byok_execution_intent_not_found',
    msg: 'BYOK 执行请求不存在或已失效',
  },
  BYOK_EXECUTION_INTENT_OUTCOME_CONFLICT: {
    statusCode: 409,
    errorCode: 'byok_execution_intent_outcome_conflict',
    msg: 'BYOK 执行结果已进入不可变终态',
  },
  BYOK_EXECUTION_INTENT_CAPACITY_EXCEEDED: {
    statusCode: 409,
    errorCode: 'byok_execution_intent_capacity_exceeded',
    msg: '当前商品草稿保留的 BYOK 执行记录已达上限',
  },
  BYOK_EXECUTION_INTENT_UNAVAILABLE: {
    statusCode: 503,
    errorCode: 'byok_execution_intent_unavailable',
    msg: 'BYOK 执行请求暂不可用',
  },
} satisfies Record<ExtensionByokExecutionIntentErrorCode, PublicError>;

function noStore(reply: FastifyReply) {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
  reply.header('X-Content-Type-Options', 'nosniff');
}

async function applyNoStore(_request: FastifyRequest, reply: FastifyReply) {
  noStore(reply);
}

function routeError(
  reply: FastifyReply,
  statusCode: number,
  errorCode: string,
  msg: string,
) {
  noStore(reply);
  return reply.status(statusCode).send({ code: 0, errorCode, msg });
}

export function getExtensionByokExecutionDevice(
  request: FastifyRequest,
): ExtensionByokExecutionDevice | null {
  const value = (request as FastifyRequest & {
    device?: Partial<ExtensionByokExecutionDevice>;
  }).device;
  if (!value
    || typeof value.ownerUserId !== 'string' || !value.ownerUserId
    || value.actorUserId !== value.ownerUserId
    || typeof value.sessionId !== 'string' || !value.sessionId
    || !Array.isArray(value.scopes)
    || !value.scopes.every((scope) => typeof scope === 'string')
    || !Array.isArray(value.allowedShopIds)
    || !value.allowedShopIds.every((shopId) => typeof shopId === 'string')) return null;
  return value as ExtensionByokExecutionDevice;
}

function knownError(reply: FastifyReply, error: ExtensionByokExecutionIntentError) {
  const response = PUBLIC_ERRORS[error.code];
  return routeError(reply, response.statusCode, response.errorCode, response.msg);
}

export async function extensionByokExecutionIntentRoutes(
  app: FastifyInstance,
  options: ExtensionByokExecutionIntentRoutesOptions,
) {
  app.addHook('onRequest', applyNoStore);

  app.post('/execution-intents', {
    bodyLimit: BODY_LIMIT,
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const parsed = executionIntentBody.safeParse(request.body);
    if (!parsed.success) {
      return routeError(
        reply,
        400,
        'byok_execution_intent_invalid_request',
        'BYOK 执行请求无效',
      );
    }

    const device = getExtensionByokExecutionDevice(request);
    if (!device) {
      return routeError(reply, 401, 'invalid_device_context', '无效的扩展设备身份');
    }
    if (!device.scopes.includes('byok:media:ingest')) {
      return routeError(
        reply,
        403,
        'byok_execution_intent_scope_denied',
        '设备缺少 BYOK 图片接收权限',
      );
    }
    if (parsed.data.binding.ownerUserId !== device.ownerUserId
      || parsed.data.binding.deviceSessionId !== device.sessionId) {
      return routeError(
        reply,
        403,
        'byok_execution_intent_forbidden',
        '设备无权创建该 BYOK 执行请求',
      );
    }
    if (!device.allowedShopIds.includes(parsed.data.binding.shopId)) {
      return routeError(
        reply,
        403,
        'byok_execution_intent_shop_denied',
        '设备无权访问该店铺',
      );
    }

    try {
      const result = await options.service.claim({
        identity: {
          ownerUserId: device.ownerUserId,
          actorUserId: device.actorUserId,
          deviceSessionId: device.sessionId,
        },
        binding: parsed.data.binding,
        requestMode: parsed.data.requestMode,
        providerIdempotencyKey: parsed.data.providerIdempotencyKey,
        providerRequestHash: parsed.data.providerRequestHash,
      });
      const projection = successProjectionSchema.safeParse({
        contractVersion: EXTENSION_BYOK_EXECUTION_INTENT_VERSION,
        intentId: result.intent.id,
        replayed: result.replayed,
        executionMode: result.intent.executionMode,
        outcome: result.intent.outcome,
        providerIdempotencyKey: result.intent.providerIdempotencyKey,
        providerRequestHash: result.intent.providerRequestHash,
        context: {
          shopId: result.intent.shopId,
          workflowId: result.intent.listingWorkflowId,
          draftRevision: result.intent.draftRevision,
          draftVersion: result.intent.draftVersion,
          skuKey: result.intent.skuKey,
          slotKey: result.intent.slotKey,
        },
      });
      if (!projection.success) throw new TypeError('BYOK execution intent projection is invalid');
      return reply.status(result.replayed ? 200 : 201).send({ code: 1, data: projection.data });
    } catch (error) {
      if (error instanceof ExtensionByokExecutionIntentError) return knownError(reply, error);
      request.log.error({ err: error }, 'extension BYOK execution intent route failed');
      return routeError(
        reply,
        503,
        'byok_execution_intent_unavailable',
        'BYOK 执行请求暂不可用',
      );
    }
  });

  app.post('/execution-intents/:intentId/outcome', {
    bodyLimit: BODY_LIMIT,
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const params = executionIntentOutcomeParams.safeParse(request.params);
    const parsed = executionIntentOutcomeBody.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return routeError(
        reply,
        400,
        'byok_execution_intent_invalid_request',
        'BYOK 执行结果请求无效',
      );
    }
    const device = getExtensionByokExecutionDevice(request);
    if (!device) {
      return routeError(reply, 401, 'invalid_device_context', '无效的扩展设备身份');
    }
    if (!device.scopes.includes('byok:media:ingest')) {
      return routeError(
        reply,
        403,
        'byok_execution_intent_scope_denied',
        '设备缺少 BYOK 图片接收权限',
      );
    }
    try {
      const result = await options.service.recordOutcome({
        identity: {
          ownerUserId: device.ownerUserId,
          actorUserId: device.actorUserId,
          deviceSessionId: device.sessionId,
        },
        intentId: params.data.intentId,
        providerIdempotencyKey: parsed.data.providerIdempotencyKey,
        providerRequestHash: parsed.data.providerRequestHash,
        outcome: parsed.data.outcome,
        providerRequestIdSha256: parsed.data.providerRequestIdSha256,
        resultSha256: parsed.data.resultSha256,
      });
      const projection = outcomeProjectionSchema.safeParse({
        contractVersion: EXTENSION_BYOK_EXECUTION_INTENT_OUTCOME_VERSION,
        intentId: result.intent.id,
        replayed: result.replayed,
        outcome: result.intent.outcome,
        providerIdempotencyKey: result.intent.providerIdempotencyKey,
        providerRequestHash: result.intent.providerRequestHash,
        providerRequestIdSha256: result.intent.providerRequestIdSha256,
        resultSha256: result.intent.resultSha256,
      });
      if (!projection.success) throw new TypeError('BYOK execution outcome projection is invalid');
      return reply.status(result.replayed ? 200 : 201).send({ code: 1, data: projection.data });
    } catch (error) {
      if (error instanceof ExtensionByokExecutionIntentError) return knownError(reply, error);
      request.log.error({ err: error }, 'extension BYOK execution outcome route failed');
      return routeError(
        reply,
        503,
        'byok_execution_intent_unavailable',
        'BYOK 执行结果暂不可用',
      );
    }
  });
}
