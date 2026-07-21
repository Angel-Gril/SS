import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { SourceWorkflowFeatureFlagEvaluator } from '../services/source-workflow-feature-flags.js';
import {
  ExtensionSourceWorkbenchError,
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
  service: Pick<ExtensionSourceWorkbenchService, 'loadStatus'>;
}

const id = z.string().trim().min(1).max(200);
const statusQuery = z.object({
  snapshotId: id,
  supplyGoodsId: id,
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

export async function extensionSourceWorkbenchRoutes(
  app: FastifyInstance,
  options: ExtensionSourceWorkbenchRoutesOptions,
) {
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
}
