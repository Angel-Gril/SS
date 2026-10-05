import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { canonicalizeExtensionByokProviderOrigin,
  type ExtensionByokProductAnalysisContext, type ExtensionByokProductAnalysisReadiness } from '../services/extension-byok-policy.js';

const id = z.string().trim().min(1).max(500);
const requestSchema = z.object({ binding: z.object({ snapshotId: id, supplyGoodsId: id, shopId: id,
  listingWorkflowId: id, draftRevision: z.number().int().positive(), draftVersion: z.number().int().positive() }).strict(),
  providerOrigin: z.string().min(1).max(2048), model: z.string().trim().min(1).max(200)
    .refine(value => !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) }).strict();
interface Options {
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  loadDraft(input: { workflowId: string; ownerUserId: string }): Promise<{ id: string; shopId: string;
    sourceCaptureSnapshotId: string; supplyGoodsId: string; revision: number; draftVersion: number;
    stage: string; runState: string } | null>;
  featureFlags: { evaluate(key: 'SOURCE_LISTING_EXTENSION_WORKBENCH' | 'SOURCE_LISTING_WORKFLOW',
    context: { ownerUserId: string; shopId: string; deviceSessionId: string; platform: string }):
    Promise<{ enabled: boolean; reason: string; listingStage?: string | null }> };
  getReadiness(input: ExtensionByokProductAnalysisContext): Promise<ExtensionByokProductAnalysisReadiness>;
}
export async function extensionByokProductAnalysisReadinessRoutes(app: FastifyInstance, options: Options) {
  app.post('/product-analysis-readiness', { preHandler: [options.authenticateDevice], bodyLimit: 8192 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const deny = (status: number, errorCode: string) => reply.status(status).send({ code: 0, errorCode,
      msg: '当前商品分析接口许可不可用，请核对店铺与草稿。', outcome: 'NOT_SUBMITTED' });
    try {
      const input = requestSchema.parse(request.body), device = (request as any).device;
      if (!device || device.actorUserId !== device.ownerUserId || typeof device.ownerUserId !== 'string'
        || typeof device.sessionId !== 'string' || !Array.isArray(device.allowedShopIds)
        || !device.allowedShopIds.includes(input.binding.shopId) || !Array.isArray(device.scopes)
        || !['listing:review', 'media:execute'].every(scope => device.scopes.includes(scope))) return deny(403, 'analysis_device_denied');
      const draft = await options.loadDraft({ workflowId: input.binding.listingWorkflowId, ownerUserId: device.ownerUserId });
      if (!draft || draft.id !== input.binding.listingWorkflowId || draft.shopId !== input.binding.shopId
        || draft.sourceCaptureSnapshotId !== input.binding.snapshotId || draft.supplyGoodsId !== input.binding.supplyGoodsId
        || draft.revision !== input.binding.draftRevision || draft.draftVersion !== input.binding.draftVersion
        || draft.stage === 'PUBLISHED' || ['CANCELLED', 'PERMANENT_FAILURE'].includes(draft.runState)) return deny(409, 'analysis_context_stale');
      const context = { ownerUserId: device.ownerUserId, shopId: draft.shopId, deviceSessionId: device.sessionId, platform: 'OZON' };
      const [workbench, listing] = await Promise.all([
        options.featureFlags.evaluate('SOURCE_LISTING_EXTENSION_WORKBENCH', context),
        options.featureFlags.evaluate('SOURCE_LISTING_WORKFLOW', context),
      ]);
      if (!workbench.enabled || !listing.enabled || !['dual_read', 'v2_only'].includes(listing.listingStage || '')) return deny(409, 'source_listing_workflow_disabled');
      const providerOrigin = canonicalizeExtensionByokProviderOrigin(input.providerOrigin);
      return { code: 1, data: await options.getReadiness({ ownerUserId: device.ownerUserId, shopId: draft.shopId,
        deviceSessionId: device.sessionId, providerOrigin, model: input.model }) };
    } catch (error) {
      if (error instanceof z.ZodError || (error as { code?: string })?.code === 'EXTENSION_BYOK_POLICY_INVALID') return deny(400, 'analysis_invalid_request');
      request.log.error({ code: 'analysis_readiness_unavailable' }, 'product analysis readiness unavailable');
      return deny(503, 'analysis_readiness_unavailable');
    }
  });
}
