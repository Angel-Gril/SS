import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  HostedSuiteListingDraftAssignmentError,
  type HostedSuiteListingDraftAssignmentErrorCode,
  type HostedSuiteListingDraftAssignmentService,
} from '../services/hosted-suite-listing-draft-assignment.js';

export const EXTENSION_HOSTED_AI_IMAGE_LISTING_ASSIGNMENT_VERSION =
  'extension-hosted-ai-image-listing-assignment/v2' as const;

const identifier = (maximum = 200) => z.string().min(1).max(maximum).refine((value) => (
  value === value.trim() && value === value.normalize('NFKC')
));

const assignmentBody = z.object({
  contractVersion: z.literal(EXTENSION_HOSTED_AI_IMAGE_LISTING_ASSIGNMENT_VERSION),
  shopId: identifier(),
  listingWorkflowId: identifier(),
  expectedDraftRevision: z.number().int().min(1),
  expectedDraftVersion: z.number().int().min(1),
  sourceCaptureSnapshotId: identifier(),
  assignmentStartOrdinal: z.number().int().min(0).max(499),
  planId: identifier(),
  planVersionId: identifier(),
  expectedPlanRevision: z.number().int().min(1),
  suiteId: identifier(),
  expectedSuiteRevision: z.number().int().min(1),
  idempotencyKey: identifier(200).refine((value) => value.length >= 16),
  items: z.array(z.object({
    skuKey: identifier(500),
    slotKey: identifier(1_024),
    suiteSlotId: identifier(),
    expectedSuiteSlotRevision: z.number().int().min(1),
    childWorkflowId: identifier(),
    expectedChildWorkflowRevision: z.number().int().min(1),
    outputAssetId: identifier(500),
  }).strict()).min(1).max(500),
}).strict();

interface HostedListingAssignmentDevice {
  ownerUserId: string;
  actorUserId: string;
  sessionId: string;
  scopes: string[];
  allowedShopIds: string[];
}

export interface ExtensionHostedAiImageListingAssignmentRoutesOptions {
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  service: Pick<HostedSuiteListingDraftAssignmentService, 'assign'>;
}

function noStore(reply: FastifyReply) {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
  reply.header('X-Content-Type-Options', 'nosniff');
}

async function applyNoStore(_request: FastifyRequest, reply: FastifyReply) {
  noStore(reply);
}

function routeError(reply: FastifyReply, statusCode: number, errorCode: string, msg: string) {
  return reply.status(statusCode).send({ code: 0, errorCode, msg });
}

function deviceContext(request: FastifyRequest): HostedListingAssignmentDevice | null {
  const value = (request as any).device as Partial<HostedListingAssignmentDevice> | undefined;
  if (!value
    || typeof value.ownerUserId !== 'string' || !value.ownerUserId
    || value.actorUserId !== value.ownerUserId
    || typeof value.sessionId !== 'string' || !value.sessionId
    || !Array.isArray(value.scopes) || !value.scopes.every((scope) => typeof scope === 'string')
    || !Array.isArray(value.allowedShopIds)
    || !value.allowedShopIds.every((shopId) => typeof shopId === 'string')) return null;
  return value as HostedListingAssignmentDevice;
}

function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  shopId: string,
): HostedListingAssignmentDevice | null {
  const device = deviceContext(request);
  if (!device) {
    routeError(reply, 401, 'invalid_device_context', '无效的扩展设备身份');
    return null;
  }
  if (!device.scopes.includes('listing:review') || !device.scopes.includes('listing:write')) {
    routeError(reply, 403, 'command_scope_denied', '设备缺少托管图片写入权限');
    return null;
  }
  if (!device.allowedShopIds.includes(shopId)) {
    routeError(reply, 403, 'command_shop_denied', '设备无权访问该店铺');
    return null;
  }
  return device;
}

function assignmentError(reply: FastifyReply, error: HostedSuiteListingDraftAssignmentError) {
  const responses: Partial<Record<HostedSuiteListingDraftAssignmentErrorCode, {
    statusCode: number;
    errorCode: string;
    msg: string;
  }>> = {
    HOSTED_LISTING_ASSIGNMENT_INVALID_REQUEST: {
      statusCode: 400,
      errorCode: 'hosted_listing_assignment_invalid_request',
      msg: '托管图片写入请求无效',
    },
    HOSTED_LISTING_ASSIGNMENT_NOT_FOUND: {
      statusCode: 404,
      errorCode: 'hosted_listing_assignment_not_found',
      msg: '托管图片写入上下文不存在',
    },
    HOSTED_LISTING_ASSIGNMENT_FORBIDDEN: {
      statusCode: 403,
      errorCode: 'hosted_listing_assignment_forbidden',
      msg: '设备无权写入该托管图片',
    },
    HOSTED_LISTING_ASSIGNMENT_BILLING_INCOMPLETE: {
      statusCode: 409,
      errorCode: 'hosted_listing_assignment_billing_incomplete',
      msg: '托管任务费用尚未完成结算',
    },
    HOSTED_LISTING_ASSIGNMENT_CANDIDATE_SET_MISMATCH: {
      statusCode: 409,
      errorCode: 'hosted_listing_assignment_candidate_set_mismatch',
      msg: '已批准图片集合或顺序已变化，请刷新后重试',
    },
    HOSTED_LISTING_ASSIGNMENT_SLOT_CONFLICT: {
      statusCode: 409,
      errorCode: 'hosted_listing_assignment_slot_conflict',
      msg: '目标图片槽位已变化，请刷新后重试',
    },
    HOSTED_LISTING_ASSIGNMENT_ORDER_CONFLICT: {
      statusCode: 409,
      errorCode: 'hosted_listing_assignment_order_conflict',
      msg: '商品图片顺序已变化，请刷新后重试',
    },
    HOSTED_LISTING_ASSIGNMENT_IDEMPOTENCY_CONFLICT: {
      statusCode: 409,
      errorCode: 'hosted_listing_assignment_idempotency_conflict',
      msg: '托管图片写入操作标识已被其他请求使用',
    },
  };
  const response = responses[error.code] || {
    statusCode: 409,
    errorCode: 'hosted_listing_assignment_stale',
    msg: '商品草稿或托管任务已变化，请刷新后重试',
  };
  return routeError(reply, response.statusCode, response.errorCode, response.msg);
}

export async function extensionHostedAiImageListingAssignmentRoutes(
  app: FastifyInstance,
  options: ExtensionHostedAiImageListingAssignmentRoutesOptions,
) {
  app.post('/ai-image-suite/listing-assignments', {
    preHandler: [applyNoStore, options.authenticateDevice],
  }, async (request, reply) => {
    const parsed = assignmentBody.safeParse(request.body);
    if (!parsed.success) return routeError(reply, 400, 'invalid_request', '参数错误');
    const device = authorize(request, reply, parsed.data.shopId);
    if (!device) return reply;
    const { contractVersion: _contractVersion, ...binding } = parsed.data;
    try {
      const result = await options.service.assign({
        ...binding,
        ownerUserId: device.ownerUserId,
        actorUserId: device.actorUserId,
        deviceSessionId: device.sessionId,
      });
      return reply.send({
        code: 1,
        data: {
          contractVersion: EXTENSION_HOSTED_AI_IMAGE_LISTING_ASSIGNMENT_VERSION,
          batchId: result.batchId,
          replayed: result.replayed,
          shopId: result.shopId,
          listingWorkflowId: result.listingWorkflowId,
          sourceDraftRevision: result.sourceDraftRevision,
          sourceDraftVersion: result.sourceDraftVersion,
          boundDraftRevision: result.boundDraftRevision,
          boundDraftVersion: result.boundDraftVersion,
          assignments: result.assignments,
          validationStatus: result.validationStatus,
          publishReadiness: result.publishReadiness,
        },
      });
    } catch (error) {
      if (error instanceof HostedSuiteListingDraftAssignmentError) {
        return assignmentError(reply, error);
      }
      request.log.error({ err: error }, 'hosted AI image listing assignment failed');
      return routeError(
        reply,
        503,
        'hosted_listing_assignment_unavailable',
        '托管图片写入暂不可用',
      );
    }
  });
}
