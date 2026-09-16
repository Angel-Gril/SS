import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { SourceWorkflowFeatureFlagEvaluator } from '../services/source-workflow-feature-flags.js';
import {
  ExtensionMediaWorkflowLaunchError,
  resolveStandaloneProviderConfig,
  type ExtensionMediaTranslationLaunchContext,
} from '../services/extension-media-workflow-launch.js';
import { AI_IMAGE_EDIT_MASK_SEMANTICS } from '../services/ai-image-compositor.js';
import type { CreateAiImageEditMaskInput } from '../services/ai-image-edit.js';
import {
  AI_MEDIA_EDIT_SOURCE_MAX_ASPECT_RATIO,
  AI_MEDIA_EDIT_SOURCE_MAX_EDGE,
  AI_MEDIA_EDIT_SOURCE_MAX_PIXELS,
} from '../services/ai-image-edit-source.js';
import { AiImageJobError } from '../services/ai-image-jobs.js';
import { AiMediaContextError } from '../services/ai-media-context.js';
import {
  EXTENSION_MEDIA_EDIT_MASK_MAX_BYTES,
  type ExtensionMediaWorkflowDecision,
} from './extension-media-launch.js';

const EXTENSION_MEDIA_EDIT_SOURCE_CONTRACT = 'extension-media-edit-source/v1' as const;
const EXTENSION_MEDIA_EDIT_MASK_CONTRACT = 'extension-media-edit-mask/v1' as const;
const EXTENSION_MEDIA_EDIT_BODY_MAX_BYTES = 30 * 1024 * 1024;

interface ExtensionMediaEditDevice {
  ownerUserId: string;
  actorUserId: string;
  sessionId: string;
  scopes: string[];
  allowedShopIds: string[];
}

interface ExtensionMediaEditAsset {
  id: string;
  url: string;
  mimeType: string;
  width: number;
  height: number;
}

type ExtensionMediaEditReadiness = Parameters<typeof resolveStandaloneProviderConfig>[0]['readiness'];

interface ExtensionMediaEditMaskResult {
  replayed: boolean;
  asset: ExtensionMediaEditAsset;
  diagnostics: {
    maskSemantics: typeof AI_IMAGE_EDIT_MASK_SEMANTICS;
    editPixelCount: number;
    preservedPixelCount: number;
    featheredPixelCount: number;
  };
}

export interface ExtensionMediaEditRoutesOptions {
  authenticateDevice: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  featureFlags: Pick<SourceWorkflowFeatureFlagEvaluator, 'evaluate'>;
  getMediaWorkflowDecision?: (ownerUserId: string) => Promise<ExtensionMediaWorkflowDecision>;
  getReadiness: () => Promise<ExtensionMediaEditReadiness>;
  loadContext(input: {
    ownerUserId: string;
    snapshotId: string;
    supplyGoodsId: string;
    shopId: string;
    listingWorkflowId: string;
    revision: number;
    draftVersion: number;
  }): Promise<ExtensionMediaTranslationLaunchContext | null>;
  internalizeSource(input: {
    ownerUserId: string;
    listingWorkflowId: string;
    sourceMediaKey: string;
    revision: number;
    draftVersion: number;
    role: 'EDIT';
  }): Promise<ExtensionMediaEditAsset>;
  checkMaskRequestRate(ownerUserId: string): Promise<
    { allowed: true } | { allowed: false; reason: string }
  >;
  createMask(input: CreateAiImageEditMaskInput): Promise<ExtensionMediaEditMaskResult>;
  production?: boolean;
}

const identifier = z.string().trim().min(1).max(200);
const sourceMediaKey = z.string().trim().min(1).max(500);
const editContextSchema = z.object({
  snapshotId: identifier,
  supplyGoodsId: identifier,
  shopId: identifier,
  listingWorkflowId: identifier,
  revision: z.number().int().min(1),
  draftVersion: z.number().int().min(1),
  sourceMediaKey,
}).strict();
const editMaskSchema = editContextSchema.extend({
  maskSemantics: z.literal(AI_IMAGE_EDIT_MASK_SEMANTICS),
  maskDataUrl: z.string().min(32).max(28 * 1024 * 1024),
}).strict();

function sendError(reply: FastifyReply, statusCode: number, errorCode: string, message: string) {
  return reply.status(statusCode).send({ code: 0, errorCode, msg: message });
}

function deviceContext(request: FastifyRequest): ExtensionMediaEditDevice | null {
  const candidate = (request as any).device as Partial<ExtensionMediaEditDevice> | undefined;
  if (!candidate
    || typeof candidate.ownerUserId !== 'string'
    || candidate.actorUserId !== candidate.ownerUserId
    || typeof candidate.sessionId !== 'string'
    || !Array.isArray(candidate.scopes)
    || !Array.isArray(candidate.allowedShopIds)) {
    return null;
  }
  return candidate as ExtensionMediaEditDevice;
}

function decodeMaskDataUrl(value: string): Buffer {
  const matched = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (!matched) throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Edit mask must be a canonical PNG data URL');
  const buffer = Buffer.from(matched[1]!, 'base64');
  if (!buffer.length || buffer.length > EXTENSION_MEDIA_EDIT_MASK_MAX_BYTES
    || buffer.toString('base64') !== matched[1]) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Edit mask payload is invalid or too large');
  }
  return buffer;
}

function validEditSourceAsset(asset: ExtensionMediaEditAsset): boolean {
  const pixels = asset.width * asset.height;
  if (!asset.id || asset.id.length > 200
    || !['image/jpeg', 'image/png'].includes(asset.mimeType)
    || !Number.isSafeInteger(asset.width) || asset.width < 1 || asset.width > AI_MEDIA_EDIT_SOURCE_MAX_EDGE
    || !Number.isSafeInteger(asset.height) || asset.height < 1 || asset.height > AI_MEDIA_EDIT_SOURCE_MAX_EDGE
    || !Number.isSafeInteger(pixels) || pixels > AI_MEDIA_EDIT_SOURCE_MAX_PIXELS
    || Math.max(asset.width, asset.height) / Math.min(asset.width, asset.height)
      > AI_MEDIA_EDIT_SOURCE_MAX_ASPECT_RATIO
    || !asset.url || asset.url.length > 4096) {
    return false;
  }
  try {
    const parsed = new URL(asset.url);
    const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
    return !parsed.username && !parsed.password && !parsed.hash
      && (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && local));
  } catch {
    return false;
  }
}

function exactContext(
  context: ExtensionMediaTranslationLaunchContext | null,
  ownerUserId: string,
  request: z.infer<typeof editContextSchema>,
) {
  return Boolean(context
    && context.ownerUserId === ownerUserId
    && context.id === request.listingWorkflowId
    && context.shopId === request.shopId
    && context.supplyGoodsId === request.supplyGoodsId
    && context.snapshotId === request.snapshotId
    && context.revision === request.revision
    && context.draftVersion === request.draftVersion
    && context.sourceMediaKeys.includes(request.sourceMediaKey));
}

async function checkProviderAvailability(options: ExtensionMediaEditRoutesOptions, reply: FastifyReply): Promise<boolean> {
  try {
    const readiness = await options.getReadiness();
    if (!readiness.enabled || !readiness.ready) {
      sendError(reply, 503, readiness.reasonCode || 'media_edit_unavailable', readiness.reason);
      return false;
    }
    resolveStandaloneProviderConfig({
      readiness,
      operation: 'INPAINT',
      production: options.production ?? process.env.NODE_ENV === 'production',
    });
    return true;
  } catch (error) {
    if (error instanceof ExtensionMediaWorkflowLaunchError) {
      sendError(reply, 503, 'media_edit_provider_not_ready', '扩展媒体编辑供应商配置或局部重绘能力尚未就绪');
    } else {
      sendError(reply, 503, 'media_edit_capability_unavailable', '媒体编辑策略暂不可用');
    }
    return false;
  }
}

async function checkAvailability(
  options: ExtensionMediaEditRoutesOptions,
  device: ExtensionMediaEditDevice,
  shopId: string,
  reply: FastifyReply,
): Promise<boolean> {
  try {
    const [extensionDecision, workflowDecision, webDecision] = await Promise.all([
      options.featureFlags.evaluate('SOURCE_LISTING_EXTENSION_WORKBENCH', {
        ownerUserId: device.ownerUserId,
        shopId,
        deviceSessionId: device.sessionId,
      }),
      options.getMediaWorkflowDecision
        ? options.getMediaWorkflowDecision(device.ownerUserId)
        : options.featureFlags.evaluate('AI_MEDIA_WORKFLOW_V2', {
          ownerUserId: device.ownerUserId,
        }),
      options.featureFlags.evaluate('SOURCE_LISTING_WEB_MEDIA', { ownerUserId: device.ownerUserId }),
    ]);
    if (!extensionDecision.enabled || !workflowDecision.enabled || !webDecision.enabled) {
      sendError(reply, 503, 'media_edit_disabled', '扩展媒体编辑尚未开放');
      return false;
    }
    return true;
  } catch {
    sendError(reply, 503, 'media_edit_capability_unavailable', '媒体编辑策略暂不可用');
    return false;
  }
}

async function loadExactContext(
  options: ExtensionMediaEditRoutesOptions,
  device: ExtensionMediaEditDevice,
  request: z.infer<typeof editContextSchema>,
  reply: FastifyReply,
) {
  let context: ExtensionMediaTranslationLaunchContext | null;
  try {
    context = await options.loadContext({ ownerUserId: device.ownerUserId, ...request });
  } catch {
    sendError(reply, 503, 'media_context_unavailable', '来源商品上下文暂不可用，请稍后重试');
    return null;
  }
  if (!exactContext(context, device.ownerUserId, request)) {
    sendError(reply, 409, 'media_edit_context_stale', '来源商品上下文已变化，请刷新后重试');
    return null;
  }
  return context;
}

function sendKnownError(reply: FastifyReply, caught: unknown) {
  if (caught instanceof AiMediaContextError) {
    return sendError(reply, caught.statusCode, caught.code, caught.message);
  }
  if (caught instanceof AiImageJobError) {
    const statusCode = caught.code === 'SOURCE_ASSET_NOT_FOUND'
      ? 404
      : caught.code === 'STALE_MEDIA_WORKFLOW'
        ? 409
        : caught.code === 'EDIT_RESOURCE_QUOTA_EXCEEDED'
          ? 429
          : ['EDIT_STORAGE_NOT_READY', 'EDIT_PERSISTENCE_NOT_READY'].includes(caught.code)
            ? 503
            : 400;
    return sendError(reply, statusCode, caught.code, caught.message);
  }
  throw caught;
}

export async function extensionMediaEditRoutes(
  app: FastifyInstance,
  options: ExtensionMediaEditRoutesOptions,
) {
  const authorize = async (request: FastifyRequest, reply: FastifyReply, checkRate: boolean) => {
    await options.authenticateDevice(request, reply);
    if (reply.sent) return;
    const device = deviceContext(request);
    if (!device) return sendError(reply, 401, 'invalid_device_context', '无效的设备工作台身份');
    if (!device.scopes.includes('media:execute')) {
      return sendError(reply, 403, 'command_scope_denied', '设备无权创建媒体任务');
    }
    // Reject unavailable or test-only Providers before processing a potentially large mask body.
    if (!await checkProviderAvailability(options, reply)) return;
    if (!checkRate) return;
    let rateCheck: Awaited<ReturnType<typeof options.checkMaskRequestRate>>;
    try {
      rateCheck = await options.checkMaskRequestRate(device.ownerUserId);
    } catch {
      return sendError(reply, 503, 'media_edit_rate_limit_unavailable', '蒙版上传限流策略暂不可用');
    }
    if (!rateCheck.allowed) {
      return sendError(reply, 429, 'media_edit_rate_limited', rateCheck.reason);
    }
  };

  app.post('/media-edit-source', {
    onRequest: (request, reply) => authorize(request, reply, false),
  }, async (request, reply) => {
    const parsed = editContextSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'invalid_request', '参数错误');
    const device = deviceContext(request)!;
    if (!device.allowedShopIds.includes(parsed.data.shopId)) {
      return sendError(reply, 403, 'command_shop_denied', '设备无权访问该店铺');
    }
    if (!await checkAvailability(options, device, parsed.data.shopId, reply)) return;
    if (!await loadExactContext(options, device, parsed.data, reply)) return;
    try {
      const sourceAsset = await options.internalizeSource({
        ownerUserId: device.ownerUserId,
        listingWorkflowId: parsed.data.listingWorkflowId,
        sourceMediaKey: parsed.data.sourceMediaKey,
        revision: parsed.data.revision,
        draftVersion: parsed.data.draftVersion,
        role: 'EDIT',
      });
      if (!validEditSourceAsset(sourceAsset)) {
        return sendError(reply, 503, 'media_edit_source_invalid', '编辑源图不符合安全限制');
      }
      reply.header('Cache-Control', 'no-store');
      return reply.send({
        code: 1,
        data: {
          contractVersion: EXTENSION_MEDIA_EDIT_SOURCE_CONTRACT,
          sourceMediaKey: parsed.data.sourceMediaKey,
          sourceAsset,
          maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
          maxMaskBytes: EXTENSION_MEDIA_EDIT_MASK_MAX_BYTES,
        },
      });
    } catch (caught) {
      return sendKnownError(reply, caught);
    }
  });

  app.post('/media-edit-mask', {
    bodyLimit: EXTENSION_MEDIA_EDIT_BODY_MAX_BYTES,
    onRequest: (request, reply) => authorize(request, reply, true),
  }, async (request, reply) => {
    const parsed = editMaskSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'invalid_request', '参数错误');
    const device = deviceContext(request)!;
    if (!device.allowedShopIds.includes(parsed.data.shopId)) {
      return sendError(reply, 403, 'command_shop_denied', '设备无权访问该店铺');
    }
    if (!await checkAvailability(options, device, parsed.data.shopId, reply)) return;
    const { maskSemantics: _maskSemantics, maskDataUrl: _maskDataUrl, ...contextRequest } = parsed.data;
    if (!await loadExactContext(options, device, contextRequest, reply)) return;
    let maskBuffer: Buffer;
    try {
      maskBuffer = decodeMaskDataUrl(parsed.data.maskDataUrl);
    } catch (caught) {
      return sendKnownError(reply, caught);
    }
    try {
      const sourceAsset = await options.internalizeSource({
        ownerUserId: device.ownerUserId,
        listingWorkflowId: parsed.data.listingWorkflowId,
        sourceMediaKey: parsed.data.sourceMediaKey,
        revision: parsed.data.revision,
        draftVersion: parsed.data.draftVersion,
        role: 'EDIT',
      });
      if (!validEditSourceAsset(sourceAsset)) {
        return sendError(reply, 503, 'media_edit_source_invalid', '编辑源图不符合安全限制');
      }
      const result = await options.createMask({
        ownerUserId: device.ownerUserId,
        actorUserId: device.actorUserId,
        contextType: 'listing-draft',
        contextId: parsed.data.listingWorkflowId,
        contextDraftRevision: parsed.data.revision,
        contextDraftVersion: parsed.data.draftVersion,
        sourceAssetId: sourceAsset.id,
        maskBuffer,
        maskSemantics: parsed.data.maskSemantics,
      });
      reply.header('Cache-Control', 'no-store');
      return reply.status(result.replayed ? 200 : 201).send({
        code: 1,
        replayed: result.replayed,
        data: {
          contractVersion: EXTENSION_MEDIA_EDIT_MASK_CONTRACT,
          sourceMediaKey: parsed.data.sourceMediaKey,
          sourceAssetId: sourceAsset.id,
          maskAssetId: result.asset.id,
          url: result.asset.url,
          mimeType: result.asset.mimeType,
          width: result.asset.width,
          height: result.asset.height,
          maskSemantics: result.diagnostics.maskSemantics,
          editPixelCount: result.diagnostics.editPixelCount,
          preservedPixelCount: result.diagnostics.preservedPixelCount,
          featheredPixelCount: result.diagnostics.featheredPixelCount,
        },
      });
    } catch (caught) {
      return sendKnownError(reply, caught);
    }
  });
}
