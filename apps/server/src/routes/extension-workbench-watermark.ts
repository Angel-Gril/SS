import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SourceListingWatermarkError, watermarkApplyRequestSchema, watermarkPreviewRequestSchema,
  type SourceListingWatermarkActor, type SourceListingWatermarkService } from '../services/source-listing-watermark.js';
import type { SourceWorkflowFeatureFlagEvaluator } from '../services/source-workflow-feature-flags.js';

export interface ExtensionWorkbenchWatermarkRouteOptions {
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  service: Pick<SourceListingWatermarkService, 'preview' | 'apply'>;
  featureFlags: SourceWorkflowFeatureFlagEvaluator;
}
export async function extensionWorkbenchWatermarkRoutes(app: FastifyInstance, options: ExtensionWorkbenchWatermarkRouteOptions) {
  for (const action of ['preview', 'apply'] as const) {
    app.post(`/${action}`, { preHandler: [options.authenticateDevice], bodyLimit: 16 * 1024,
      config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); reply.header('X-Content-Type-Options', 'nosniff');
      try {
        const parsed = (action === 'preview' ? watermarkPreviewRequestSchema : watermarkApplyRequestSchema).safeParse(request.body);
        if (!parsed.success) return reply.status(400).send({ code: 0, errorCode: 'watermark_invalid_request', msg: '水印配置或图片选择无效' });
        const actor = (request as FastifyRequest & { device?: SourceListingWatermarkActor }).device;
        if (!actor || typeof actor.ownerUserId !== 'string' || !actor.ownerUserId || actor.actorUserId !== actor.ownerUserId
          || typeof actor.sessionId !== 'string' || !actor.sessionId || !Array.isArray(actor.scopes) || !Array.isArray(actor.allowedShopIds)) {
          return reply.status(401).send({ code: 0, errorCode: 'invalid_device_context', msg: '无效的扩展设备身份' });
        }
        if (!['listing:write', 'media:execute'].every(scope => actor.scopes.includes(scope)) || !actor.allowedShopIds.includes(parsed.data.shopId)) {
          return reply.status(403).send({ code: 0, errorCode: 'watermark_forbidden', msg: '设备没有该店铺的图片处理权限' });
        }
        const context = { ownerUserId: actor.ownerUserId, shopId: parsed.data.shopId, deviceSessionId: actor.sessionId };
        const [workbench, workflow] = await Promise.all([
          options.featureFlags.evaluate('SOURCE_LISTING_EXTENSION_WORKBENCH', context),
          options.featureFlags.evaluate('SOURCE_LISTING_WORKFLOW', { ...context, platform: 'OZON' }),
        ]);
        if (!workbench.enabled || !workflow.enabled || !['dual_read', 'v2_only'].includes(workflow.listingStage || '')
          || workbench.revision !== workflow.revision) return reply.status(409).send({
          code: 0, errorCode: 'source_listing_workflow_disabled', msg: '该店铺尚未启用扩展图片处理',
        });
        return { code: 1, msg: 'ok', data: await options.service[action](actor, parsed.data) };
      } catch (error) {
        if (error instanceof SourceListingWatermarkError) return reply.status(error.statusCode).send({
          code: 0, errorCode: error.code, msg: error.message,
        });
        // External media errors may contain private URLs; never log their payload.
        request.log.warn({ operation: action }, 'extension watermark unavailable');
        return reply.status(503).send({ code: 0, errorCode: 'watermark_unavailable', msg: '水印处理暂未完成，请读取状态后重试' });
      }
    });
  }
}
