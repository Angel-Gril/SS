import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ProductVisionWorkbenchService } from '../services/product-vision-workbench.js';
import type { SourceWorkflowFeatureContext } from '../services/source-workflow-feature-flags.js';
import { z } from 'zod';
import { ProductVisionWorkbenchError } from '../services/product-vision-workbench.js';

const id = z.string().trim().min(1).max(500);
const binding = z.object({ snapshotId: id, supplyGoodsId: id, shopId: id, listingWorkflowId: id,
  draftRevision: z.number().int().positive(), draftVersion: z.number().int().positive() }).strict();
const capabilitySchema = z.object({ binding }).strict();
const analyzeSchema = z.object({ binding, skuKey: id, sourceMediaKeys: z.array(id).min(1).max(5)
  .refine((values) => new Set(values).size === values.length), operationKey: z.string().trim().min(8).max(128) }).strict();

export interface ExtensionProductVisionRouteOptions {
  service: ProductVisionWorkbenchService;
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  featureFlags: { evaluate(feature: 'SOURCE_LISTING_EXTENSION_WORKBENCH' | 'SOURCE_LISTING_WORKFLOW', context: SourceWorkflowFeatureContext): Promise<{ enabled: boolean; reason: string; listingStage?: string | null }> };
}
export async function extensionProductVisionRoutes(app: FastifyInstance, options: ExtensionProductVisionRouteOptions) {
  for (const action of ['capability', 'analyze'] as const) {
    app.post(`/vision/${action}`, { preHandler: [options.authenticateDevice], bodyLimit: 16 * 1024 }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        const input = action === 'capability' ? capabilitySchema.parse(request.body) : analyzeSchema.parse(request.body);
        const device = (request as any).device;
        if (!device || typeof device.ownerUserId !== 'string' || device.actorUserId !== device.ownerUserId
          || typeof device.sessionId !== 'string' || !Array.isArray(device.scopes) || !device.scopes.includes('listing:review')) {
          throw new ProductVisionWorkbenchError('invalid_device_context', 401, '无效的设备身份。');
        }
        if (!Array.isArray(device.allowedShopIds) || !device.allowedShopIds.includes(input.binding.shopId)
          || action === 'analyze' && (!device.scopes.includes('listing:write') || !device.scopes.includes('media:execute'))) {
          throw new ProductVisionWorkbenchError('command_scope_denied', 403, '设备无权对该店铺执行视觉分析。');
        }
        const context = { ownerUserId: device.ownerUserId, shopId: input.binding.shopId, deviceSessionId: device.sessionId, platform: 'OZON' };
        const [workbench, listing] = await Promise.all([
          options.featureFlags.evaluate('SOURCE_LISTING_EXTENSION_WORKBENCH', context),
          options.featureFlags.evaluate('SOURCE_LISTING_WORKFLOW', context),
        ]);
        if (!workbench.enabled || !listing.enabled || !['dual_read', 'v2_only'].includes(listing.listingStage || '')) {
          throw new ProductVisionWorkbenchError('source_listing_workflow_disabled', 409, '该店铺尚未启用扩展草稿工作台。');
        }
        const identity = { ownerUserId: device.ownerUserId, actorUserId: device.actorUserId, allowedShopIds: device.allowedShopIds };
        const data = action === 'capability' ? await options.service.capability(identity, input.binding)
          : await options.service.analyze(identity, analyzeSchema.parse(input));
        return { code: 1, data };
      } catch (error) {
        if (error instanceof z.ZodError) return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: '视觉分析参数错误。' });
        if (error instanceof ProductVisionWorkbenchError) return reply.status(error.statusCode)
          .send({ code: 0, errorCode: error.code, msg: error.message,
            outcome: error.outcome === 'NOT_SENT' ? 'NOT_SUBMITTED' : error.outcome });
        const code = (error as { code?: unknown })?.code;
        const status = Number((error as { statusCode?: unknown })?.statusCode);
        if ([400, 403, 404, 409, 422].includes(status) && typeof code === 'string') {
          return reply.status(status).send({ code: 0, errorCode: code.toLowerCase(), msg: '视觉分析草稿上下文不可用。', outcome: 'NOT_SUBMITTED' });
        }
        request.log.error({ code: 'product_vision_unavailable' }, 'product vision workbench unavailable');
        return reply.status(503).send({ code: 0, errorCode: 'product_vision_unavailable', msg: '视觉分析服务暂不可用。', outcome: 'NOT_SUBMITTED' });
      }
    });
  }
}
