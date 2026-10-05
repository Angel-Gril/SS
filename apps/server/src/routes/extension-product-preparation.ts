import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { SourceWorkflowFeatureContext } from '../services/source-workflow-feature-flags.js';
import { ProductPreparationWorkbenchError, productPreparationBindingSchema, productPreparationAnalyzeInputSchema,
  productPreparationContextInputSchema, productPreparationApplyInputSchema, productPreparationByokCandidatesInputSchema,
  productPreparationImageInputSchema,
  type ProductPreparationWorkbenchService } from '../services/product-preparation-workbench.js';
export interface ExtensionProductPreparationRouteOptions {
  service: ProductPreparationWorkbenchService;
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  featureFlags: { evaluate(feature: 'SOURCE_LISTING_EXTENSION_WORKBENCH' | 'SOURCE_LISTING_WORKFLOW', context: SourceWorkflowFeatureContext): Promise<{ enabled: boolean; reason: string; listingStage?: string | null }> };
}
const capabilitySchema = z.object({ binding: productPreparationBindingSchema }).strict();
export async function extensionProductPreparationRoutes(app: FastifyInstance, options: ExtensionProductPreparationRouteOptions) {
  for (const action of ['capability', 'context', 'image', 'analyze', 'read', 'apply', 'byok-candidates'] as const) {
    app.post(`/preparation/${action}`, { preHandler: [options.authenticateDevice], bodyLimit: 64 * 1024 }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        const schema = action === 'capability' ? capabilitySchema : action === 'context' ? productPreparationContextInputSchema
          : action === 'image' ? productPreparationImageInputSchema
          : action === 'apply' ? productPreparationApplyInputSchema : action === 'byok-candidates' ? productPreparationByokCandidatesInputSchema : productPreparationAnalyzeInputSchema;
        const parsed = schema.parse(request.body);
        const binding = 'binding' in parsed ? parsed.binding : parsed.analysisInput.binding;
        const device = (request as any).device;
        if (!device || typeof device.ownerUserId !== 'string' || device.actorUserId !== device.ownerUserId
          || typeof device.sessionId !== 'string' || !Array.isArray(device.scopes) || !device.scopes.includes('listing:review')) {
          throw new ProductPreparationWorkbenchError('invalid_device_context', 401, '无效的设备身份。');
        }
        if (!Array.isArray(device.allowedShopIds) || !device.allowedShopIds.includes(binding.shopId)
          || ['analyze', 'apply', 'image', 'byok-candidates'].includes(action) && (!device.scopes.includes('listing:write') || !device.scopes.includes('media:execute'))) {
          throw new ProductPreparationWorkbenchError('command_scope_denied', 403, '设备无权对该店铺执行商品分析。');
        }
        const context = { ownerUserId: device.ownerUserId, shopId: binding.shopId, deviceSessionId: device.sessionId, platform: 'OZON' };
        const [workbench, listing] = await Promise.all([options.featureFlags.evaluate('SOURCE_LISTING_EXTENSION_WORKBENCH', context), options.featureFlags.evaluate('SOURCE_LISTING_WORKFLOW', context)]);
        if (!workbench.enabled || !listing.enabled || !['dual_read', 'v2_only'].includes(listing.listingStage || '')) throw new ProductPreparationWorkbenchError('source_listing_workflow_disabled', 409, '该店铺尚未启用扩展草稿工作台。');
        const identity = { ownerUserId: device.ownerUserId, actorUserId: device.actorUserId, allowedShopIds: device.allowedShopIds, deviceSessionId: device.sessionId };
        if (action === 'image') {
          const image = await options.service.image(identity, productPreparationImageInputSchema.parse(parsed));
          return reply.type(image.mimeType).header('Content-Length', image.buffer.length).header('x-ss-erp-media-sha256', image.sha256)
            .header('x-ss-erp-media-width', image.width).header('x-ss-erp-media-height', image.height).send(image.buffer);
        }
        const data = action === 'capability' ? await options.service.capability(identity, binding)
          : action === 'context' ? await options.service.context(identity, productPreparationContextInputSchema.parse(parsed))
          : action === 'analyze' ? await options.service.analyze(identity, productPreparationAnalyzeInputSchema.parse(parsed))
          : action === 'read' ? await options.service.read(identity, productPreparationAnalyzeInputSchema.parse(parsed))
          : action === 'byok-candidates' ? await options.service.byokCandidates(identity, productPreparationByokCandidatesInputSchema.parse(parsed))
          : await options.service.apply(identity, productPreparationApplyInputSchema.parse(parsed));
        return { code: 1, data };
      } catch (error) {
        if (error instanceof z.ZodError) return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: '商品分析参数错误。', outcome: 'NOT_SUBMITTED' });
        if (error instanceof ProductPreparationWorkbenchError) return reply.status(error.statusCode).send({ code: 0, errorCode: error.code, msg: error.message,
          outcome: error.outcome === 'NOT_SENT' ? 'NOT_SUBMITTED' : error.outcome });
        const value = error as { code?: unknown; statusCode?: unknown };
        if (typeof value.code === 'string' && [400, 403, 404, 409, 422].includes(Number(value.statusCode))) return reply.status(Number(value.statusCode)).send({ code: 0, errorCode: value.code.toLowerCase(), msg: '商品分析草稿上下文不可用。', outcome: 'NOT_SUBMITTED' });
        request.log.error({ code: 'product_preparation_unavailable' }, 'product preparation unavailable');
        return reply.status(503).send({ code: 0, errorCode: 'product_preparation_unavailable', msg: '商品分析服务暂不可用。', outcome: 'NOT_SUBMITTED' });
      }
    });
  }
}
