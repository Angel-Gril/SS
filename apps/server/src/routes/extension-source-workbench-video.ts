import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SourceListingVideoError, videoReadRequestSchema, videoSaveRequestSchema,
  type SourceListingVideoActor, type SourceListingVideoService } from '../services/source-listing-video.js';
import type { SourceWorkflowFeatureFlagEvaluator } from '../services/source-workflow-feature-flags.js';

export interface ExtensionSourceWorkbenchVideoRouteOptions {
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  featureFlags: Pick<SourceWorkflowFeatureFlagEvaluator, 'evaluate'>;
  service: Pick<SourceListingVideoService, 'read' | 'save'>;
}
export async function extensionSourceWorkbenchVideoRoutes(app: FastifyInstance, options: ExtensionSourceWorkbenchVideoRouteOptions) {
  for (const action of ['read', 'save'] as const) {
    app.post(`/${action}`, { preHandler: [options.authenticateDevice], bodyLimit: 16 * 1024,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store'); reply.header('X-Content-Type-Options', 'nosniff');
      try {
        const parsed = (action === 'read' ? videoReadRequestSchema : videoSaveRequestSchema).safeParse(request.body);
        if (!parsed.success) return reply.status(400).send({ code: 0, errorCode: 'video_invalid_request', msg: '视频参数无效' });
        const actor = (request as FastifyRequest & { device?: SourceListingVideoActor }).device;
        if (!actor?.ownerUserId || actor.actorUserId !== actor.ownerUserId || !actor.sessionId
          || !Array.isArray(actor.scopes) || !Array.isArray(actor.allowedShopIds)) return reply.status(401).send({ code: 0, errorCode: 'invalid_device_context', msg: '无效的设备身份' });
        const scopes = action === 'save' ? ['listing:review', 'listing:write', 'media:execute'] : ['listing:review'];
        if (!scopes.every(scope => actor.scopes.includes(scope)) || !actor.allowedShopIds.includes(parsed.data.binding.shopId)) return reply.status(403).send({
          code: 0, errorCode: 'video_forbidden', msg: '设备没有该店铺的视频编辑权限',
        });
        const context = { ownerUserId: actor.ownerUserId, shopId: parsed.data.binding.shopId, deviceSessionId: actor.sessionId };
        const [workbench, workflow] = await Promise.all([
          options.featureFlags.evaluate('SOURCE_LISTING_EXTENSION_WORKBENCH', context),
          options.featureFlags.evaluate('SOURCE_LISTING_WORKFLOW', { ...context, platform: 'OZON' }),
        ]);
        if ([workbench.reason, workflow.reason].some(reason => ['policy_invalid', 'context_invalid', 'config_unavailable'].includes(reason))) {
          return reply.status(503).send({ code: 0, errorCode: 'source_workbench_rollout_unavailable', msg: '扩展工作台策略暂不可用' });
        }
        if (!workbench.enabled || !workflow.enabled || !['dual_read', 'v2_only'].includes(workflow.listingStage || '')
          || workbench.revision !== workflow.revision) return reply.status(409).send({ code: 0, errorCode: 'source_listing_workflow_disabled', msg: '该店铺尚未启用视频草稿功能' });
        return { code: 1, msg: 'ok', data: await options.service[action](actor, parsed.data) };
      } catch (error) {
        if (error instanceof SourceListingVideoError) return reply.status(error.statusCode).send({ code: 0, errorCode: error.code, msg: error.message });
        request.log.warn({ operation: action }, 'extension video draft unavailable');
        return reply.status(503).send({ code: 0, errorCode: 'video_unavailable', msg: '视频保存状态暂不可用，请刷新后读取状态' });
      }
    });
  }
}
