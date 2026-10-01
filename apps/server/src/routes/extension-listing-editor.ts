import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS } from 'shared';
import type { SourceWorkflowFeatureContext } from '../services/source-workflow-feature-flags.js';
import type { ExtensionListingEditorIdentity, ExtensionListingEditorService } from '../services/extension-listing-editor.js';

const identifier = z.string().trim().min(1).max(200);
const binding = z.object({ snapshotId: identifier, supplyGoodsId: identifier, shopId: identifier,
  listingWorkflowId: identifier, draftRevision: z.number().int().positive(), draftVersion: z.number().int().positive() }).strict();
const readBody = z.object({ binding }).strict();
const catalogBody = z.object({ binding, query: z.string().trim().max(100) }).strict();
const dictionaryBody = z.object({ binding, schemaRevision: z.string().regex(/^[a-f0-9]{64}$/u),
  attributeId: z.number().int().positive(), query: z.string().trim().max(200), limit: z.number().int().min(1).max(100) }).strict();
const category = z.object({ categoryId: z.number().int().positive(), typeId: z.number().int().positive(), catalogRevision: identifier }).strict();
const saveBody = z.discriminatedUnion('action', [
  z.object({ binding, operationKey: z.string().trim().min(8).max(128), action: z.literal('PRICING'), value: z.record(z.unknown()) }).strict(),
  z.object({ binding, operationKey: z.string().trim().min(8).max(128), action: z.literal('CATEGORY'), value: category }).strict(),
  z.object({ binding, operationKey: z.string().trim().min(8).max(128), action: z.literal('PACKAGING'), value: z.object({
    items: z.array(z.unknown()).min(1).max(SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS),
    evidence: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  }).strict() }).strict(),
  z.object({ binding, operationKey: z.string().trim().min(8).max(128), action: z.literal('ATTRIBUTES'), value: z.object({
    schemaRevision: z.string().regex(/^[a-f0-9]{64}$/u), changes: z.array(z.unknown()).min(1).max(500),
  }).strict() }).strict(),
  z.object({ binding, operationKey: z.string().trim().min(8).max(128), action: z.literal('COPY_CANDIDATE'), value: z.object({
    titleRu: z.string().max(500).optional(), descriptionRu: z.string().max(10_000).nullable().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0) }).strict(),
  z.object({ binding, operationKey: z.string().trim().min(8).max(128), action: z.literal('COPY_APPROVE'),
    value: z.object({ candidateId: identifier }).strict() }).strict(),
  z.object({ binding, operationKey: z.string().trim().min(8).max(128), action: z.literal('VALIDATE'),
    value: z.object({ schemaRevision: z.string().regex(/^[a-f0-9]{64}$/u) }).strict() }).strict(),
]);
export interface ExtensionListingEditorRouteOptions {
  service: ExtensionListingEditorService;
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  featureFlags: { evaluate(feature: 'SOURCE_LISTING_EXTENSION_WORKBENCH' | 'SOURCE_LISTING_WORKFLOW', context: SourceWorkflowFeatureContext): Promise<{ enabled: boolean; reason: string; listingStage?: string | null }> };
}

export async function extensionListingEditorRoutes(app: FastifyInstance, options: ExtensionListingEditorRouteOptions) {
  async function authorize(request: FastifyRequest, shopId: string, write: boolean): Promise<ExtensionListingEditorIdentity> {
    const device = (request as any).device;
    if (!device || typeof device.ownerUserId !== 'string' || device.actorUserId !== device.ownerUserId
      || typeof device.sessionId !== 'string' || !Array.isArray(device.scopes) || !device.scopes.includes('listing:review')) {
      throw Object.assign(new Error('无效的设备身份'), { statusCode: 401, code: 'invalid_device_context' });
    }
    if (!Array.isArray(device.allowedShopIds) || !device.allowedShopIds.includes(shopId)
      || (write && !device.scopes.includes('listing:write'))) {
      throw Object.assign(new Error('设备没有编辑该店铺的权限'), { statusCode: 403, code: 'command_scope_denied' });
    }
    const context = { ownerUserId: device.ownerUserId, shopId, deviceSessionId: device.sessionId, platform: 'OZON' };
    const [workbench, listing] = await Promise.all([
      options.featureFlags.evaluate('SOURCE_LISTING_EXTENSION_WORKBENCH', { ownerUserId: device.ownerUserId, shopId, deviceSessionId: device.sessionId }),
      options.featureFlags.evaluate('SOURCE_LISTING_WORKFLOW', context),
    ]);
    if (!workbench.enabled || !listing.enabled || !['dual_read', 'v2_only'].includes(listing.listingStage || '')) {
      throw Object.assign(new Error('该店铺尚未启用扩展草稿编辑'), { statusCode: 409, code: 'source_listing_workflow_disabled' });
    }
    return { ownerUserId: device.ownerUserId, actorUserId: device.actorUserId, allowedShopIds: device.allowedShopIds };
  }
  for (const action of ['read', 'catalog', 'attributes', 'dictionary', 'save'] as const) {
    app.post(`/editor/${action}`, { preHandler: [options.authenticateDevice], bodyLimit: 64 * 1024 }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        if (action === 'read') {
          const parsed = readBody.parse(request.body);
          return { code: 1, data: await options.service.read(await authorize(request, parsed.binding.shopId, false), parsed.binding) };
        }
        if (action === 'catalog') {
          const parsed = catalogBody.parse(request.body);
          return { code: 1, data: await options.service.catalog(await authorize(request, parsed.binding.shopId, false), parsed.binding, parsed.query) };
        }
        if (action === 'attributes') {
          const parsed = readBody.parse(request.body);
          return { code: 1, data: await options.service.attributes(await authorize(request, parsed.binding.shopId, false), parsed.binding) };
        }
        if (action === 'dictionary') {
          const parsed = dictionaryBody.parse(request.body);
          const { binding: context, ...query } = parsed;
          return { code: 1, data: await options.service.dictionary(await authorize(request, context.shopId, false), context, query) };
        }
        const parsed = saveBody.parse(request.body);
        const result = await options.service.save(await authorize(request, parsed.binding.shopId, true), parsed);
        return { code: 1, ...result };
      } catch (error: any) {
        if (error instanceof z.ZodError) return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: '草稿编辑参数错误' });
        const statusCode = Number(error?.statusCode);
        if ([400, 401, 403, 404, 409, 422].includes(statusCode)) {
          return reply.status(statusCode).send({ code: 0, errorCode: String(error.code || 'editor_failed').toLowerCase(), msg: error.message });
        }
        request.log.error({ err: error }, 'extension listing editor failed');
        return reply.status(503).send({ code: 0, errorCode: 'editor_unavailable', msg: '扩展草稿编辑暂不可用' });
      }
    });
  }
}
