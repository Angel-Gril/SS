import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type {
  SourceWorkflowFeatureFlagEvaluator,
  SourceWorkflowFeatureDecision,
} from '../services/source-workflow-feature-flags.js';
import type {
  ExtensionMediaTranslationLaunchContext,
} from '../services/extension-media-workflow-launch.js';
import { isExtensionMediaContextStaleError } from '../services/extension-media-workflow-launch.js';
import { AI_IMAGE_EDIT_MASK_SEMANTICS } from '../services/ai-image-compositor.js';
import type { AiImageTranslationPrice } from '../services/ai-image-translation-runtime-contract.js';

interface ExtensionMediaLaunchDevice {
  ownerUserId: string;
  actorUserId: string;
  sessionId: string;
  scopes: string[];
  allowedShopIds: string[];
}

export interface ExtensionMediaLaunchCapability {
  enabled: boolean;
  ready: boolean;
  reasonCode: string;
  reason: string;
  revision: string;
  testOnly: boolean;
  price?: AiImageTranslationPrice;
  operation: 'IMAGE_TRANSLATE';
  sourceLanguage: 'zh';
  targetLanguage: 'ru';
}

export const EXTENSION_MEDIA_LAUNCH_V2 = 'extension-media-launch/v2' as const;
export const EXTENSION_MEDIA_EDIT_MASK_MAX_BYTES = 20 * 1024 * 1024;

type ExtensionMediaStandaloneOperation =
  | 'IMAGE_TO_IMAGE' | 'IMAGE_TRANSLATE' | 'FULL_EDIT' | 'INPAINT';

export interface ExtensionMediaOperationCapability {
  enabled: boolean;
  ready: boolean;
  reasonCode: string;
  reason: string;
  revision: string;
  testOnly: boolean;
  operation: ExtensionMediaStandaloneOperation;
  maxReferences?: number;
  sourceLanguage?: 'zh';
  targetLanguage?: 'ru';
  maskSemantics?: typeof AI_IMAGE_EDIT_MASK_SEMANTICS;
  maxMaskBytes?: number;
  price?: AiImageTranslationPrice;
}

export interface ExtensionMediaWorkflowDecision {
  enabled: boolean;
  revision: string | number;
  reason: string;
}

export type ExtensionMediaOperationCapabilities = {
  [K in ExtensionMediaStandaloneOperation]: ExtensionMediaOperationCapability & { operation: K };
};

export interface ExtensionMediaLaunchRoutesOptions {
  authenticateDevice: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  featureFlags: Pick<SourceWorkflowFeatureFlagEvaluator, 'evaluate'>;
  getMediaWorkflowDecision?: (ownerUserId: string) => Promise<ExtensionMediaWorkflowDecision>;
  loadContext(input: {
    ownerUserId: string;
    snapshotId: string;
    supplyGoodsId: string;
    shopId: string;
    listingWorkflowId: string;
    revision: number;
    draftVersion: number;
  }): Promise<ExtensionMediaTranslationLaunchContext | null>;
  loadPreview(input: {
    ownerUserId: string;
    listingWorkflowId: string;
    revision: number;
    draftVersion: number;
    skuKey: string;
    sourceMediaKey: string;
    purpose: 'THUMBNAIL' | 'WORKING';
  }): Promise<{
    bytes: Buffer;
    mimeType: 'image/jpeg' | 'image/png';
    width: number;
    height: number;
    sha256: string;
  }>;
  getCapability(input: {
    ownerUserId: string;
    workflowDecision: ExtensionMediaWorkflowDecision;
  }): Promise<ExtensionMediaLaunchCapability>;
  getCapabilities?(input: {
    ownerUserId: string;
    workflowDecision: ExtensionMediaWorkflowDecision;
  }): Promise<ExtensionMediaOperationCapabilities>;
}

const CAPABILITY_REVISION_MAX_LENGTH = 200;

/**
 * Feature revisions are operator-provided strings. Keep the client contract
 * bounded without silently making long revisions collide by truncation alone.
 */
export function boundedExtensionMediaCapabilityRevision(
  values: readonly (string | number)[],
): string {
  const normalized = values.map((value) => String(value || '').trim() || 'unknown');
  const combined = normalized
    .filter((value, index) => normalized.indexOf(value) === index)
    .join('|');
  if (combined.length <= CAPABILITY_REVISION_MAX_LENGTH) return combined;
  const suffix = `|sha256:${createHash('sha256').update(combined).digest('hex')}`;
  return `${combined.slice(0, CAPABILITY_REVISION_MAX_LENGTH - suffix.length)}${suffix}`;
}

const id = z.string().trim().min(1).max(200);
const querySchema = z.object({
  snapshotId: id,
  supplyGoodsId: id,
  shopId: id,
  listingWorkflowId: id,
  revision: z.coerce.number().int().min(1),
  draftVersion: z.coerce.number().int().min(1),
  contractVersion: z.literal('2').optional(),
}).strict();
const previewSchema = z.object({
  snapshotId: id,
  supplyGoodsId: id,
  shopId: id,
  listingWorkflowId: id,
  revision: z.number().int().min(1),
  draftVersion: z.number().int().min(1),
  skuKey: z.string().trim().min(1).max(500),
  sourceMediaKey: z.string().trim().min(1).max(500),
  purpose: z.enum(['THUMBNAIL', 'WORKING']),
}).strict();

const SOURCE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
const SOURCE_PREVIEW_MAX_EDGE = 2048;

function disabledOperations(reason: string, revision: string): ExtensionMediaOperationCapabilities {
  const disabled = <T extends ExtensionMediaStandaloneOperation>(operation: T) => ({
    enabled: false,
    ready: false,
    reasonCode: 'MEDIA_CREATE_DISABLED',
    reason,
    revision,
    testOnly: true,
    operation,
  });
  return {
    IMAGE_TO_IMAGE: { ...disabled('IMAGE_TO_IMAGE'), maxReferences: 4 },
    IMAGE_TRANSLATE: {
      ...disabled('IMAGE_TRANSLATE'),
      sourceLanguage: 'zh',
      targetLanguage: 'ru',
    },
    FULL_EDIT: disabled('FULL_EDIT'),
    INPAINT: {
      ...disabled('INPAINT'),
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
      maxMaskBytes: EXTENSION_MEDIA_EDIT_MASK_MAX_BYTES,
    },
  };
}

function publicOperationCapability<T extends ExtensionMediaOperationCapability>(value: T): T {
  const price = value.price;
  if (price && (Object.keys(price).sort().join(',') !== 'currency,maximumCostCents,quoteFingerprint,unitCostCents'
    || !['CNY', 'USD'].includes(price.currency) || !Number.isSafeInteger(price.unitCostCents)
    || price.unitCostCents < 1 || price.maximumCostCents !== price.unitCostCents
    || !/^[a-f0-9]{64}$/u.test(price.quoteFingerprint))) {
    throw new Error('Image translation price projection is invalid');
  }
  return {
    enabled: value.enabled, ready: value.ready, reasonCode: value.reasonCode, reason: value.reason,
    revision: value.revision, testOnly: value.testOnly, operation: value.operation,
    ...(value.operation === 'IMAGE_TRANSLATE' ? { sourceLanguage: value.sourceLanguage, targetLanguage: value.targetLanguage,
      ...(price ? { price: { currency: price.currency, unitCostCents: price.unitCostCents,
        maximumCostCents: price.maximumCostCents, quoteFingerprint: price.quoteFingerprint } } : {}) } : {}),
    ...(value.operation === 'IMAGE_TO_IMAGE' ? { maxReferences: value.maxReferences } : {}),
    ...(value.operation === 'INPAINT' ? { maskSemantics: value.maskSemantics, maxMaskBytes: value.maxMaskBytes } : {}),
  } as T;
}

function v2Payload(
  operations: ExtensionMediaOperationCapabilities,
  revision: string,
  context: ReturnType<typeof publicContext> | null,
) {
  return {
    contractVersion: EXTENSION_MEDIA_LAUNCH_V2,
    revision,
    operations,
    context,
  };
}

function deviceContext(request: FastifyRequest): ExtensionMediaLaunchDevice | null {
  const candidate = (request as any).device as Partial<ExtensionMediaLaunchDevice> | undefined;
  if (!candidate
    || typeof candidate.ownerUserId !== 'string'
    || candidate.actorUserId !== candidate.ownerUserId
    || typeof candidate.sessionId !== 'string'
    || !Array.isArray(candidate.scopes)
    || !Array.isArray(candidate.allowedShopIds)) {
    return null;
  }
  return candidate as ExtensionMediaLaunchDevice;
}

function error(reply: FastifyReply, statusCode: number, errorCode: string, message: string) {
  return reply.status(statusCode).send({ code: 0, errorCode, msg: message });
}

function disabledCapability(reason: string, revision: string): ExtensionMediaLaunchCapability {
  return {
    enabled: false,
    ready: false,
    reasonCode: 'MEDIA_CREATE_DISABLED',
    reason,
    revision,
    testOnly: true,
    operation: 'IMAGE_TRANSLATE',
    sourceLanguage: 'zh',
    targetLanguage: 'ru',
  };
}

function publicContext(context: ExtensionMediaTranslationLaunchContext, query: z.infer<typeof querySchema>) {
  const detailsByKey = new Map((context.sourceInputs || []).map((item) => [
    item.sourceMediaKey,
    item,
  ]));
  return {
    id: context.id,
    shopId: context.shopId,
    supplyGoodsId: context.supplyGoodsId,
    snapshotId: context.snapshotId,
    revision: context.revision,
    draftVersion: context.draftVersion,
    sourceInputs: context.sourceMediaKeys.slice(0, 50).map((sourceMediaKey) => {
      const detail = detailsByKey.get(sourceMediaKey);
      return detail ? {
        sourceMediaKey,
        role: detail.role,
        scope: detail.scope,
        skuKeys: [...detail.skuKeys],
      } : { sourceMediaKey };
    }),
    requested: {
      snapshotId: query.snapshotId,
      listingWorkflowId: query.listingWorkflowId,
      revision: query.revision,
      draftVersion: query.draftVersion,
    },
  };
}

type ExactContextResult =
  | { kind: 'ready'; context: ExtensionMediaTranslationLaunchContext }
  | { kind: 'error'; statusCode: 409 | 503; errorCode: string; message: string };

async function loadExactContext(
  options: ExtensionMediaLaunchRoutesOptions,
  device: ExtensionMediaLaunchDevice,
  query: z.infer<typeof querySchema>,
): Promise<ExactContextResult> {
  let context: ExtensionMediaTranslationLaunchContext | null;
  try {
    context = await options.loadContext({
      ownerUserId: device.ownerUserId,
      snapshotId: query.snapshotId,
      supplyGoodsId: query.supplyGoodsId,
      shopId: query.shopId,
      listingWorkflowId: query.listingWorkflowId,
      revision: query.revision,
      draftVersion: query.draftVersion,
    });
  } catch (caught) {
    if (isExtensionMediaContextStaleError(caught)) {
      return {
        kind: 'error',
        statusCode: 409,
        errorCode: 'media_create_context_stale',
        message: '来源商品上下文已变化，请刷新后重试',
      };
    }
    return {
      kind: 'error',
      statusCode: 503,
      errorCode: 'media_context_unavailable',
      message: '来源商品上下文暂不可用，请稍后重试',
    };
  }
  if (!context
    || context.ownerUserId !== device.ownerUserId
    || context.id !== query.listingWorkflowId
    || context.shopId !== query.shopId
    || context.supplyGoodsId !== query.supplyGoodsId
    || context.snapshotId !== query.snapshotId
    || context.revision !== query.revision
    || context.draftVersion !== query.draftVersion) {
    return {
      kind: 'error',
      statusCode: 409,
      errorCode: 'media_create_context_stale',
      message: '来源商品上下文已变化，请刷新后重试',
    };
  }
  return { kind: 'ready', context };
}

export async function extensionMediaLaunchRoutes(
  app: FastifyInstance,
  options: ExtensionMediaLaunchRoutesOptions,
) {
  app.post('/media-preview', { preHandler: [options.authenticateDevice] }, async (request, reply) => {
    const parsed = previewSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, 'invalid_request', '参数错误');
    const device = deviceContext(request);
    if (!device) return error(reply, 401, 'invalid_device_context', '无效的设备工作台身份');
    if (!device.scopes.includes('media:execute')) {
      return error(reply, 403, 'command_scope_denied', '设备无权读取媒体预览');
    }
    if (!device.allowedShopIds.includes(parsed.data.shopId)) {
      return error(reply, 403, 'command_shop_denied', '设备无权访问该店铺');
    }
    reply.header('Cache-Control', 'no-store');
    reply.header('Pragma', 'no-cache');
    reply.header('X-Content-Type-Options', 'nosniff');
    let extensionDecision: SourceWorkflowFeatureDecision;
    let workflowDecision: ExtensionMediaWorkflowDecision;
    let webDecision: SourceWorkflowFeatureDecision;
    try {
      [extensionDecision, workflowDecision, webDecision] = await Promise.all([
        options.featureFlags.evaluate('SOURCE_LISTING_EXTENSION_WORKBENCH', {
          ownerUserId: device.ownerUserId,
          shopId: parsed.data.shopId,
          deviceSessionId: device.sessionId,
        }),
        options.getMediaWorkflowDecision
          ? options.getMediaWorkflowDecision(device.ownerUserId)
          : options.featureFlags.evaluate('AI_MEDIA_WORKFLOW_V2', {
            ownerUserId: device.ownerUserId,
          }),
        options.featureFlags.evaluate('SOURCE_LISTING_WEB_MEDIA', {
          ownerUserId: device.ownerUserId,
        }),
      ]);
    } catch {
      return error(reply, 503, 'media_preview_unavailable', '来源图片预览策略暂不可用');
    }
    if (!extensionDecision.enabled || !workflowDecision.enabled || !webDecision.enabled) {
      return error(reply, 503, 'media_preview_disabled', '来源图片预览尚未开放');
    }
    const exactContext = await loadExactContext(options, device, parsed.data);
    if (exactContext.kind === 'error'
      || !exactContext.context.sourceMediaKeys.includes(parsed.data.sourceMediaKey)) {
      return error(reply, 409, 'media_preview_context_stale', '来源图片或草稿已变化，请刷新后重试');
    }
    let preview: Awaited<ReturnType<typeof options.loadPreview>>;
    try {
      preview = await options.loadPreview({
        ownerUserId: device.ownerUserId,
        listingWorkflowId: parsed.data.listingWorkflowId,
        revision: parsed.data.revision,
        draftVersion: parsed.data.draftVersion,
        skuKey: parsed.data.skuKey,
        sourceMediaKey: parsed.data.sourceMediaKey,
        purpose: parsed.data.purpose,
      });
    } catch (caught) {
      const code = String((caught as { code?: unknown } | null)?.code || '');
      const statusCode = Number((caught as { statusCode?: unknown } | null)?.statusCode);
      if (statusCode === 404 || statusCode === 409
        || ['SOURCE_MEDIA_NOT_FOUND', 'STALE_MEDIA_CONTEXT'].includes(code)) {
        return error(reply, 409, 'media_preview_context_stale', '来源图片或草稿已变化，请刷新后重试');
      }
      request.log.error({ err: caught }, 'source media preview failed');
      return error(reply, 503, 'media_preview_unavailable', '来源图片预览暂不可用');
    }
    const actualSha256 = Buffer.isBuffer(preview?.bytes)
      ? createHash('sha256').update(preview.bytes).digest('hex') : '';
    if (!Buffer.isBuffer(preview?.bytes)
      || preview.bytes.length < 1 || preview.bytes.length > SOURCE_PREVIEW_MAX_BYTES
      || !['image/jpeg', 'image/png'].includes(preview.mimeType)
      || !Number.isSafeInteger(preview.width) || preview.width < 1
      || preview.width > SOURCE_PREVIEW_MAX_EDGE
      || !Number.isSafeInteger(preview.height) || preview.height < 1
      || preview.height > SOURCE_PREVIEW_MAX_EDGE
      || !/^[a-f0-9]{64}$/u.test(preview.sha256)
      || actualSha256 !== preview.sha256) {
      return error(reply, 503, 'media_preview_unavailable', '来源图片预览暂不可用');
    }
    reply.header('Content-Type', preview.mimeType);
    reply.header('Content-Length', String(preview.bytes.length));
    reply.header('X-SS-ERP-Content-Sha256', preview.sha256);
    reply.header('X-SS-ERP-Image-Width', String(preview.width));
    reply.header('X-SS-ERP-Image-Height', String(preview.height));
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    return reply.send(preview.bytes);
  });

  app.get('/media-launch', { preHandler: [options.authenticateDevice] }, async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return error(reply, 400, 'invalid_request', '参数错误');
    const device = deviceContext(request);
    if (!device) return error(reply, 401, 'invalid_device_context', '无效的设备工作台身份');
    if (!device.scopes.includes('media:execute')) {
      return error(reply, 403, 'command_scope_denied', '设备无权创建媒体任务');
    }
    if (!device.allowedShopIds.includes(parsed.data.shopId)) {
      return error(reply, 403, 'command_shop_denied', '设备无权访问该店铺');
    }

    let extensionDecision: SourceWorkflowFeatureDecision;
    try {
      extensionDecision = await options.featureFlags.evaluate('SOURCE_LISTING_EXTENSION_WORKBENCH', {
        ownerUserId: device.ownerUserId,
        shopId: parsed.data.shopId,
        deviceSessionId: device.sessionId,
      });
    } catch {
      return error(reply, 503, 'source_workbench_rollout_unavailable', '扩展工作台策略暂不可用');
    }
    reply.header('Cache-Control', 'no-store');
    const wantsV2 = parsed.data.contractVersion === '2';
    if (!extensionDecision.enabled) {
      const revision = boundedExtensionMediaCapabilityRevision([extensionDecision.revision]);
      if (wantsV2) {
        return reply.send({
          code: 1,
          data: v2Payload(disabledOperations('扩展工作台尚未开放', revision), revision, null),
        });
      }
      return reply.send({
        code: 1,
        data: {
          capability: disabledCapability(
            '扩展工作台尚未开放',
            boundedExtensionMediaCapabilityRevision([extensionDecision.revision]),
          ),
          context: null,
        },
      });
    }

    let workflowDecision: ExtensionMediaWorkflowDecision;
    let webDecision: SourceWorkflowFeatureDecision;
    try {
      [workflowDecision, webDecision] = await Promise.all([
        options.getMediaWorkflowDecision
          ? options.getMediaWorkflowDecision(device.ownerUserId)
          : options.featureFlags.evaluate('AI_MEDIA_WORKFLOW_V2', {
            ownerUserId: device.ownerUserId,
          }),
        options.featureFlags.evaluate('SOURCE_LISTING_WEB_MEDIA', { ownerUserId: device.ownerUserId }),
      ]);
    } catch {
      return error(reply, 503, 'source_workbench_rollout_unavailable', '媒体策略暂不可用');
    }
    if (!workflowDecision.enabled || !webDecision.enabled) {
      const reason = !workflowDecision.enabled ? 'AI 媒体工作流尚未开放' : 'Web 媒体工作台尚未开放';
      const revision = boundedExtensionMediaCapabilityRevision([
        extensionDecision.revision,
        workflowDecision.revision,
        webDecision.revision,
      ]);
      if (wantsV2) {
        return reply.send({
          code: 1,
          data: v2Payload(disabledOperations(reason, revision), revision, null),
        });
      }
      return reply.send({
        code: 1,
        data: {
          capability: disabledCapability(
            reason,
            boundedExtensionMediaCapabilityRevision([
              extensionDecision.revision,
              workflowDecision.revision,
              webDecision.revision,
            ]),
          ),
          context: null,
        },
      });
    }

    if (wantsV2) {
      let operations: ExtensionMediaOperationCapabilities;
      try {
        if (options.getCapabilities) {
          operations = await options.getCapabilities({
            ownerUserId: device.ownerUserId,
            workflowDecision,
          });
        } else {
          const legacy = await options.getCapability({
            ownerUserId: device.ownerUserId,
            workflowDecision,
          });
          operations = disabledOperations('该媒体操作尚未开放', legacy.revision);
          operations.IMAGE_TRANSLATE = legacy;
        }
        operations = {
          IMAGE_TO_IMAGE: publicOperationCapability(operations.IMAGE_TO_IMAGE),
          IMAGE_TRANSLATE: publicOperationCapability(operations.IMAGE_TRANSLATE),
          FULL_EDIT: publicOperationCapability(operations.FULL_EDIT),
          INPAINT: publicOperationCapability(operations.INPAINT),
        };
      } catch {
        return error(reply, 503, 'media_capability_unavailable', '媒体 Provider 配置暂不可用');
      }
      const revision = boundedExtensionMediaCapabilityRevision([
        extensionDecision.revision,
        workflowDecision.revision,
        webDecision.revision,
        ...Object.values(operations).map((capability) => capability.revision),
      ]);
      if (!Object.values(operations).some((capability) => capability.enabled && capability.ready)) {
        return reply.send({ code: 1, data: v2Payload(operations, revision, null) });
      }

      const exactContext = await loadExactContext(options, device, parsed.data);
      if (exactContext.kind === 'error') {
        return error(
          reply,
          exactContext.statusCode,
          exactContext.errorCode,
          exactContext.message,
        );
      }
      return reply.send({
        code: 1,
        data: v2Payload(operations, revision, publicContext(exactContext.context, parsed.data)),
      });
    }

    let capability: ExtensionMediaLaunchCapability;
    try {
      capability = publicOperationCapability(await options.getCapability({
        ownerUserId: device.ownerUserId,
        workflowDecision,
      }));
    } catch {
      return error(reply, 503, 'media_capability_unavailable', '媒体 Provider 配置暂不可用');
    }
    capability = {
      ...capability,
      revision: boundedExtensionMediaCapabilityRevision([
        extensionDecision.revision,
        workflowDecision.revision,
        webDecision.revision,
        capability.revision,
      ]),
    };
    if (!capability.enabled || !capability.ready) {
      return reply.send({ code: 1, data: { capability, context: null } });
    }

    const exactContext = await loadExactContext(options, device, parsed.data);
    if (exactContext.kind === 'error') {
      return error(
        reply,
        exactContext.statusCode,
        exactContext.errorCode,
        exactContext.message,
      );
    }
    return reply.send({
      code: 1,
      data: {
        capability,
        context: publicContext(exactContext.context, parsed.data),
      },
    });
  });
}
