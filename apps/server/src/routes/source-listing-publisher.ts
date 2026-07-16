import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import type {
  OzonPublishAttemptListPage,
  OzonPublishAttemptSummary,
} from '../services/ozon-publish-attempts.js';
import type { SourceListingWorkflowService } from '../services/source-listing-workflow.js';
import type {
  SourceWorkflowFeatureFlagEvaluator,
} from '../services/source-workflow-feature-flags.js';
import { evaluateSourceListingPublisherCapability } from '../services/source-workflow-feature-flags.js';

export interface SourceListingPublisherRouteOptions {
  authenticate?: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  featureFlags: SourceWorkflowFeatureFlagEvaluator;
  loadShop(input: { shopId: string; ownerUserId: string }): Promise<{
    id: string;
    userId: string;
    platform: string;
    status: string;
  } | null>;
  workflow: Pick<SourceListingWorkflowService, 'getDraft'>;
  publisher: {
    listAttempts(input: {
      workflowId: string;
      ownerUserId: string;
      limit?: unknown;
      cursor?: string | null;
    }): Promise<OzonPublishAttemptListPage>;
  };
}

const id = z.string().trim().min(1).max(200);
const capabilityQuerySchema = z.object({ shopId: id }).strict();
const workflowParamsSchema = z.object({ draftId: id }).strict();
const attemptListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().trim().min(1).max(500).optional(),
}).strict();

function authIds(request: FastifyRequest) {
  const user = (request as any).user || {};
  const ownerUserId = String(user.userId || '').trim();
  return {
    ownerUserId,
    actorUserId: String(user.actorUserId || ownerUserId).trim(),
    isSubAccount: user.isSubAccount === true,
    role: String(user.role || ''),
  };
}

function ownerOnly(request: FastifyRequest, reply: FastifyReply): string | null {
  const auth = authIds(request);
  if (!auth.ownerUserId
    || auth.actorUserId !== auth.ownerUserId
    || auth.isSubAccount
    || auth.role === 'STAFF') {
    void reply.status(403).send({
      code: 0,
      errorCode: 'source_publish_owner_required',
      msg: '仅店铺所有者可查看 Ozon 发布能力和任务',
    });
    return null;
  }
  return auth.ownerUserId;
}

function publicAttemptSummary(attempt: OzonPublishAttemptSummary): OzonPublishAttemptSummary {
  return {
    id: attempt.id,
    workflowId: attempt.workflowId,
    shopId: attempt.shopId,
    draftVersion: attempt.draftVersion,
    revision: attempt.revision,
    catalogSnapshotHash: attempt.catalogSnapshotHash,
    attributeSchemaHash: attempt.attributeSchemaHash,
    publisherContractVersion: attempt.publisherContractVersion,
    endpoint: attempt.endpoint,
    draftPayloadHash: attempt.draftPayloadHash,
    draftStateHash: attempt.draftStateHash,
    requestPayloadHash: attempt.requestPayloadHash,
    itemCount: attempt.itemCount,
    state: attempt.state,
    reconciliationState: attempt.reconciliationState,
    stateVersion: attempt.stateVersion,
    ozonTaskId: attempt.ozonTaskId,
    acceptanceSource: attempt.acceptanceSource,
    responseHash: attempt.responseHash,
    itemResults: attempt.itemResults,
    itemResultCount: attempt.itemResultCount,
    itemResultsTruncated: attempt.itemResultsTruncated,
    itemErrors: attempt.itemErrors,
    itemErrorCount: attempt.itemErrorCount,
    itemErrorsTruncated: attempt.itemErrorsTruncated,
    lastErrorCode: attempt.lastErrorCode,
    lastErrorMessage: attempt.lastErrorMessage,
    submitStartedAt: attempt.submitStartedAt,
    submittedAt: attempt.submittedAt,
    unknownAt: attempt.unknownAt,
    rejectedAt: attempt.rejectedAt,
    nextReconcileAt: attempt.nextReconcileAt,
    reconcileAttemptCount: attempt.reconcileAttemptCount,
    lastReconciledAt: attempt.lastReconciledAt,
    completedAt: attempt.completedAt,
    resolutionEvidenceHash: attempt.resolutionEvidenceHash,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
  };
}

function invalidRequest(reply: FastifyReply, message = '参数错误') {
  return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: message });
}

function internalError(reply: FastifyReply) {
  return reply.status(500).send({
    code: 0,
    errorCode: 'source_listing_publisher_discovery_failed',
    msg: '来源商品发布状态读取失败',
  });
}

function attemptListError(reply: FastifyReply, error: unknown) {
  const candidate = error && typeof error === 'object'
    ? error as { code?: unknown; statusCode?: unknown }
    : {};
  const code = String(candidate.code || '');
  if (code === 'OZON_LISTING_DRAFT_NOT_FOUND' || candidate.statusCode === 404) {
    return reply.status(404).send({
      code: 0,
      errorCode: 'source_listing_workflow_not_found',
      msg: '工作流不存在',
    });
  }
  if (code === 'INVALID_INPUT') return invalidRequest(reply, '发布任务分页参数无效');
  return internalError(reply);
}

export async function sourceListingPublisherRoutes(
  app: FastifyInstance,
  options: SourceListingPublisherRouteOptions,
) {
  app.addHook('preHandler', options.authenticate || authenticate);

  app.get('/publisher-capability', async (request, reply) => {
    const ownerUserId = ownerOnly(request, reply);
    if (!ownerUserId) return;
    const query = capabilityQuerySchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply, query.error.issues[0]?.message);

    let shop: Awaited<ReturnType<SourceListingPublisherRouteOptions['loadShop']>>;
    try {
      shop = await options.loadShop({ ownerUserId, shopId: query.data.shopId });
    } catch {
      return reply.status(503).send({
        code: 0,
        errorCode: 'source_publisher_capability_unavailable',
        msg: 'Ozon 发布能力暂不可用',
      });
    }
    if (!shop
      || shop.id !== query.data.shopId
      || shop.userId !== ownerUserId
      || shop.platform !== 'OZON'
      || shop.status !== 'ACTIVE') {
      return reply.status(404).send({
        code: 0,
        errorCode: 'source_publisher_shop_not_found',
        msg: 'Ozon 店铺不存在或不可用',
      });
    }

    try {
      const capability = await evaluateSourceListingPublisherCapability(options.featureFlags, {
        ownerUserId, shopId: shop.id, platform: 'OZON',
      });
      return reply.send({ code: 1, data: capability });
    } catch {
      return reply.send({
        code: 1,
        data: {
          enabled: false,
          legacyAllowed: false,
          reason: 'config_unavailable',
          revision: 'unavailable',
        },
      });
    }
  });

  app.get('/:draftId/publish-attempts', async (request, reply) => {
    const ownerUserId = ownerOnly(request, reply);
    if (!ownerUserId) return;
    const params = workflowParamsSchema.safeParse(request.params);
    const query = attemptListQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return invalidRequest(reply, '发布任务分页参数无效');

    try {
      const draft = await options.workflow.getDraft({
        draftId: params.data.draftId,
        ownerUserId,
      });
      if (!draft
        || draft.id !== params.data.draftId
        || draft.ownerUserId !== ownerUserId) {
        return reply.status(404).send({
          code: 0,
          errorCode: 'source_listing_workflow_not_found',
          msg: '工作流不存在',
        });
      }
      const page = await options.publisher.listAttempts({
        workflowId: params.data.draftId,
        ownerUserId,
        limit: query.data.limit,
        cursor: query.data.cursor || null,
      });
      if (page.items.some((attempt) => attempt.workflowId !== params.data.draftId)) {
        return internalError(reply);
      }
      return reply.send({
        code: 1,
        data: {
          items: page.items.map(publicAttemptSummary),
          nextCursor: page.nextCursor,
        },
      });
    } catch (error) {
      return attemptListError(reply, error);
    }
  });
}
