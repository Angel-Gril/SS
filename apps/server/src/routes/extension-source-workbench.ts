import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { SourceWorkflowFeatureFlagEvaluator } from '../services/source-workflow-feature-flags.js';
import {
  SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS,
  SOURCE_LISTING_SKU_KEY_MAX_LENGTH,
} from 'shared';
import {
  ExtensionSourceWorkbenchError,
  type ExtensionSourceMediaHistoryInput,
  type ExtensionSourceWorkbenchService,
} from '../services/extension-source-workbench.js';

interface ExtensionSourceWorkbenchDevice {
  ownerUserId: string;
  actorUserId: string;
  sessionId: string;
  scopes: string[];
  allowedShopIds: string[];
}

export interface ExtensionSourceWorkbenchRoutesOptions {
  authenticateDevice: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  featureFlags: Pick<SourceWorkflowFeatureFlagEvaluator, 'evaluate'>;
  service: Pick<ExtensionSourceWorkbenchService, 'loadStatus' | 'loadMediaHistory' | 'createDraft'>;
}

const id = z.string().trim().min(1).max(200);
const statusQuery = z.object({
  snapshotId: id,
  supplyGoodsId: id,
}).strict();
const createDraftBody = z.object({
  snapshotId: id,
  supplyGoodsId: id,
  shopId: id,
  selectedSkuKeys: z.array(z.string().trim().min(1).max(SOURCE_LISTING_SKU_KEY_MAX_LENGTH))
    .min(1).max(SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS),
}).strict();
const mediaHistoryQuery = z.object({
  snapshotId: id,
  supplyGoodsId: id,
  shopId: id,
  listingWorkflowId: id,
  revision: z.coerce.number().int().min(1),
  draftVersion: z.coerce.number().int().min(1),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  beforeCursor: z.string().trim().min(1).max(1_000).optional(),
}).strict();

function deviceContext(request: FastifyRequest): ExtensionSourceWorkbenchDevice | null {
  const candidate = (request as any).device as Partial<ExtensionSourceWorkbenchDevice> | undefined;
  if (!candidate
    || typeof candidate.ownerUserId !== 'string'
    || candidate.actorUserId !== candidate.ownerUserId
    || typeof candidate.sessionId !== 'string'
    || !Array.isArray(candidate.scopes)
    || !candidate.scopes.includes('listing:review')
    || !Array.isArray(candidate.allowedShopIds)) {
    return null;
  }
  return candidate as ExtensionSourceWorkbenchDevice;
}

function routeError(reply: FastifyReply, statusCode: number, errorCode: string, msg: string) {
  return reply.status(statusCode).send({ code: 0, errorCode, msg });
}

function mapWorkbenchError(error: ExtensionSourceWorkbenchError): [number, string, string] {
  return [error.statusCode, error.code.toLowerCase(), error.message];
}

export async function extensionSourceWorkbenchRoutes(
  app: FastifyInstance,
  options: ExtensionSourceWorkbenchRoutesOptions,
) {
  app.post('/drafts', { preHandler: [options.authenticateDevice] }, async (request, reply) => {
    const parsed = createDraftBody.safeParse(request.body);
    if (!parsed.success) return routeError(reply, 400, 'invalid_request', '参数错误');
    const device = deviceContext(request);
    if (!device) {
      return routeError(reply, 401, 'invalid_device_context', '无效的设备工作台身份');
    }
    if (!device.scopes.includes('listing:write')) {
      return routeError(reply, 403, 'command_scope_denied', '设备没有创建店铺草稿的权限');
    }
    if (!device.allowedShopIds.includes(parsed.data.shopId)) {
      return routeError(reply, 403, 'command_shop_denied', '设备无权访问该店铺');
    }

    let workbenchCapability;
    let listingCapability;
    try {
      [workbenchCapability, listingCapability] = await Promise.all([
        options.featureFlags.evaluate('SOURCE_LISTING_EXTENSION_WORKBENCH', {
          ownerUserId: device.ownerUserId,
          shopId: parsed.data.shopId,
          deviceSessionId: device.sessionId,
        }),
        options.featureFlags.evaluate('SOURCE_LISTING_WORKFLOW', {
          ownerUserId: device.ownerUserId,
          shopId: parsed.data.shopId,
          platform: 'OZON',
        }),
      ]);
    } catch {
      return routeError(reply, 503, 'source_workbench_rollout_unavailable', '扩展工作台策略暂不可用');
    }
    const unavailable = [workbenchCapability.reason, listingCapability.reason]
      .some((reason) => ['policy_invalid', 'context_invalid', 'config_unavailable'].includes(reason));
    if (unavailable) {
      return routeError(reply, 503, 'source_workbench_rollout_unavailable', '扩展工作台策略暂不可用');
    }
    if (!workbenchCapability.enabled
      || !listingCapability.enabled
      || !['dual_read', 'v2_only'].includes(String(listingCapability.listingStage || ''))) {
      return routeError(reply, 409, 'source_listing_workflow_disabled', '该店铺尚未启用扩展草稿工作台');
    }

    reply.header('Cache-Control', 'no-store');
    try {
      const draft = await options.service.createDraft({
        ownerUserId: device.ownerUserId,
        actorUserId: device.actorUserId,
        shopId: parsed.data.shopId,
        snapshotId: parsed.data.snapshotId,
        supplyGoodsId: parsed.data.supplyGoodsId,
        selectedSkuKeys: parsed.data.selectedSkuKeys,
      });
      return reply.status(201).send({ code: 1, data: draft });
    } catch (error) {
      if (error instanceof ExtensionSourceWorkbenchError) {
        const [statusCode, errorCode, message] = mapWorkbenchError(error);
        return routeError(reply, statusCode, errorCode, message);
      }
      request.log.error({ err: error }, 'extension source draft creation failed');
      return routeError(reply, 500, 'source_workbench_failed', '创建扩展店铺草稿失败');
    }
  });

  app.get('/status', { preHandler: [options.authenticateDevice] }, async (request, reply) => {
    const parsed = statusQuery.safeParse(request.query);
    if (!parsed.success) return routeError(reply, 400, 'invalid_request', '参数错误');
    const device = deviceContext(request);
    if (!device) {
      return routeError(reply, 401, 'invalid_device_context', '无效的设备工作台身份');
    }

    let capability;
    try {
      capability = await options.featureFlags.evaluate('SOURCE_LISTING_EXTENSION_WORKBENCH', {
        ownerUserId: device.ownerUserId,
        deviceSessionId: device.sessionId,
      });
    } catch {
      return routeError(reply, 503, 'source_workbench_rollout_unavailable', '扩展工作台策略暂不可用');
    }

    reply.header('Cache-Control', 'no-store');
    const publicCapability = {
      enabled: capability.enabled,
      reason: capability.reason,
      revision: capability.revision,
    };
    if (!capability.enabled) {
      return reply.send({ code: 1, data: { capability: publicCapability, status: null } });
    }

    try {
      const status = await options.service.loadStatus({
        ownerUserId: device.ownerUserId,
        allowedShopIds: device.allowedShopIds,
        canExecuteMedia: device.scopes.includes('media:execute'),
        snapshotId: parsed.data.snapshotId,
        supplyGoodsId: parsed.data.supplyGoodsId,
      });
      return reply.send({ code: 1, data: { capability: publicCapability, status } });
    } catch (error) {
      if (error instanceof ExtensionSourceWorkbenchError) {
        return routeError(
          reply,
          error.statusCode,
          error.code,
          error.code === 'SOURCE_WORKBENCH_NOT_FOUND'
            ? '来源商品工作台不存在'
            : '来源商品工作台请求无效',
        );
      }
      request.log.error({ err: error }, 'extension source workbench status failed');
      return routeError(reply, 500, 'source_workbench_failed', '读取扩展工作台失败');
    }
  });

  app.get('/media-history', { preHandler: [options.authenticateDevice] }, async (request, reply) => {
    const parsed = mediaHistoryQuery.safeParse(request.query);
    if (!parsed.success) return routeError(reply, 400, 'invalid_request', '参数错误');
    const device = deviceContext(request);
    if (!device) {
      return routeError(reply, 401, 'invalid_device_context', '无效的设备工作台身份');
    }
    if (!device.allowedShopIds.includes(parsed.data.shopId)) {
      return routeError(reply, 403, 'command_shop_denied', '设备无权访问该店铺');
    }

    let capability;
    try {
      capability = await options.featureFlags.evaluate('SOURCE_LISTING_EXTENSION_WORKBENCH', {
        ownerUserId: device.ownerUserId,
        shopId: parsed.data.shopId,
        deviceSessionId: device.sessionId,
      });
    } catch {
      return routeError(reply, 503, 'source_workbench_rollout_unavailable', '扩展工作台策略暂不可用');
    }
    reply.header('Cache-Control', 'no-store');
    const publicCapability = {
      enabled: capability.enabled,
      reason: capability.reason,
      revision: capability.revision,
    };
    if (!capability.enabled) {
      return reply.send({ code: 1, data: { capability: publicCapability, history: null } });
    }
    try {
      const history = await options.service.loadMediaHistory({
        ownerUserId: device.ownerUserId,
        allowedShopIds: device.allowedShopIds,
        ...parsed.data,
      } as ExtensionSourceMediaHistoryInput);
      return reply.send({ code: 1, data: { capability: publicCapability, history } });
    } catch (error) {
      if (error instanceof ExtensionSourceWorkbenchError) {
        const [statusCode, errorCode, message] = mapWorkbenchError(error);
        return routeError(reply, statusCode, errorCode, message);
      }
      request.log.error({ err: error }, 'extension source media history failed');
      return routeError(reply, 500, 'source_workbench_failed', '读取扩展媒体历史失败');
    }
  });
}
