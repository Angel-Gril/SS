import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ExtensionListingLogisticsIdentity, ExtensionListingLogisticsPricingService } from '../services/extension-listing-logistics-pricing.js';
import type { SourceWorkflowFeatureContext } from '../services/source-workflow-feature-flags.js';
import { SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS, SOURCE_LISTING_SKU_KEY_MAX_LENGTH } from 'shared';

const identifier = z.string().trim().min(1).max(200);
const binding = z.object({ snapshotId: identifier, supplyGoodsId: identifier, shopId: identifier, listingWorkflowId: identifier,
  draftRevision: z.number().int().positive(), draftVersion: z.number().int().positive() }).strict();
const selection = z.object({ assignmentId: identifier, companyId: identifier, warehouseId: identifier,
  originCountryUid: identifier, originCityUid: identifier, destinationCountryUid: identifier, destinationLocationUid: identifier }).strict();
const scopesBody = z.object({ binding }).strict();
const servicesBody = z.object({ binding, selection }).strict();
const quoteBody = z.object({ binding, selection, releaseId: identifier, effectiveChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
  stableServiceKey: z.string().min(1).max(1000), items: z.array(z.object({ skuKey: z.string().min(1).max(SOURCE_LISTING_SKU_KEY_MAX_LENGTH),
    declaredPriceMinor: z.number().int().positive().max(1_000_000_000), hasBattery: z.boolean() }).strict()).min(1).max(SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS),
}).strict();
const deviceIdentity = z.object({ ownerUserId: identifier, actorUserId: identifier, sessionId: identifier,
  allowedShopIds: z.array(identifier).max(1000), scopes: z.array(z.string().min(1).max(100)).max(100) }).strip();

export interface ExtensionListingLogisticsPricingRouteOptions {
  service: ExtensionListingLogisticsPricingService;
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  featureFlags: { evaluate(feature: 'SOURCE_LISTING_EXTENSION_WORKBENCH' | 'SOURCE_LISTING_WORKFLOW', context: SourceWorkflowFeatureContext): Promise<{ enabled: boolean; reason: string; listingStage?: string | null }> };
}
export async function extensionListingLogisticsPricingRoutes(app: FastifyInstance, options: ExtensionListingLogisticsPricingRouteOptions) {
  async function authorize(request: FastifyRequest, shopId: string): Promise<ExtensionListingLogisticsIdentity> {
    const parsed = deviceIdentity.safeParse((request as FastifyRequest & { device?: unknown }).device);
    if (!parsed.success || parsed.data.ownerUserId !== parsed.data.actorUserId || !parsed.data.scopes.includes('listing:review')) {
      throw Object.assign(new Error('无效的设备身份'), { code: 'invalid_device_context', statusCode: 401 });
    }
    const identity = parsed.data;
    if (!identity.allowedShopIds.includes(shopId)) throw Object.assign(new Error('设备没有读取该店铺的权限'), { code: 'command_scope_denied', statusCode: 403 });
    const context = { ownerUserId: identity.ownerUserId, shopId, deviceSessionId: identity.sessionId, platform: 'OZON' };
    const [workbench, listing] = await Promise.all([
      options.featureFlags.evaluate('SOURCE_LISTING_EXTENSION_WORKBENCH', context),
      options.featureFlags.evaluate('SOURCE_LISTING_WORKFLOW', context),
    ]);
    if (!workbench.enabled || !listing.enabled || !['dual_read', 'v2_only'].includes(listing.listingStage || '')) {
      throw Object.assign(new Error('当前店铺尚未启用扩展草稿工作台'), { code: 'source_listing_workflow_disabled', statusCode: 409 });
    }
    return identity;
  }
  for (const action of ['scopes', 'services', 'quote'] as const) {
    app.post(`/editor/logistics-${action}`, { preHandler: [options.authenticateDevice], bodyLimit: 64 * 1024 }, async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      reply.header('Vary', 'Authorization');
      try {
        if (action === 'scopes') {
          const input = scopesBody.parse(request.body);
          return { code: 1, data: await options.service.scopes(await authorize(request, input.binding.shopId), input.binding) };
        }
        const version = request.headers['x-ss-erp-extension-version'];
        if (action === 'services') {
          const input = servicesBody.parse(request.body);
          return { code: 1, data: await options.service.services(await authorize(request, input.binding.shopId), input.binding, input.selection, typeof version === 'string' ? version : undefined) };
        }
        const input = quoteBody.parse(request.body);
        return { code: 1, data: await options.service.quote(await authorize(request, input.binding.shopId), input, typeof version === 'string' ? version : undefined) };
      } catch (error) {
        if (error instanceof z.ZodError) return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: '物流定价参数错误' });
        const known = error as { statusCode?: unknown; code?: unknown; message?: unknown };
        const statusCode = Number(known?.statusCode);
        if ([400, 401, 403, 404, 409, 410, 422, 426].includes(statusCode)) {
          return reply.status(statusCode).send({ code: 0, errorCode: typeof known.code === 'string' ? known.code.toLowerCase() : 'logistics_pricing_failed', msg: typeof known.message === 'string' ? known.message : '物流定价暂不可用' });
        }
        // Provider/rule payloads and customer context are not logged on this quote-only surface.
        return reply.status(503).send({ code: 0, errorCode: 'logistics_pricing_unavailable', msg: '物流自动定价暂不可用，仍可手工填写费用' });
      }
    });
  }
}
