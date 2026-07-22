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
  testOnly: true;
  operation: 'IMAGE_TRANSLATE';
  sourceLanguage: 'zh';
  targetLanguage: 'ru';
}

export interface ExtensionMediaLaunchRoutesOptions {
  authenticateDevice: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  featureFlags: Pick<SourceWorkflowFeatureFlagEvaluator, 'evaluate'>;
  loadContext(input: {
    ownerUserId: string;
    snapshotId: string;
    supplyGoodsId: string;
    shopId: string;
    listingWorkflowId: string;
    revision: number;
    draftVersion: number;
  }): Promise<ExtensionMediaTranslationLaunchContext | null>;
  getCapability(input: {
    ownerUserId: string;
    workflowDecision: SourceWorkflowFeatureDecision;
  }): Promise<ExtensionMediaLaunchCapability>;
}

const CAPABILITY_REVISION_MAX_LENGTH = 200;

/**
 * Feature revisions are operator-provided strings. Keep the client contract
 * bounded without silently making long revisions collide by truncation alone.
 */
export function boundedExtensionMediaCapabilityRevision(values: readonly string[]): string {
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
}).strict();

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
  return {
    id: context.id,
    shopId: context.shopId,
    supplyGoodsId: context.supplyGoodsId,
    snapshotId: context.snapshotId,
    revision: context.revision,
    draftVersion: context.draftVersion,
    sourceInputs: context.sourceMediaKeys.slice(0, 50).map((sourceMediaKey) => ({
      sourceMediaKey,
    })),
    requested: {
      snapshotId: query.snapshotId,
      listingWorkflowId: query.listingWorkflowId,
      revision: query.revision,
      draftVersion: query.draftVersion,
    },
  };
}

export async function extensionMediaLaunchRoutes(
  app: FastifyInstance,
  options: ExtensionMediaLaunchRoutesOptions,
) {
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
    if (!extensionDecision.enabled) {
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

    let workflowDecision: SourceWorkflowFeatureDecision;
    let webDecision: SourceWorkflowFeatureDecision;
    try {
      [workflowDecision, webDecision] = await Promise.all([
        options.featureFlags.evaluate('AI_MEDIA_WORKFLOW_V2', { ownerUserId: device.ownerUserId }),
        options.featureFlags.evaluate('SOURCE_LISTING_WEB_MEDIA', { ownerUserId: device.ownerUserId }),
      ]);
    } catch {
      return error(reply, 503, 'source_workbench_rollout_unavailable', '媒体策略暂不可用');
    }
    if (!workflowDecision.enabled || !webDecision.enabled) {
      return reply.send({
        code: 1,
        data: {
          capability: disabledCapability(
            !workflowDecision.enabled ? 'AI 媒体工作流尚未开放' : 'Web 媒体工作台尚未开放',
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

    let capability: ExtensionMediaLaunchCapability;
    try {
      capability = await options.getCapability({
        ownerUserId: device.ownerUserId,
        workflowDecision,
      });
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

    let context: ExtensionMediaTranslationLaunchContext | null;
    try {
      context = await options.loadContext({
        ownerUserId: device.ownerUserId,
        ...parsed.data,
        listingWorkflowId: parsed.data.listingWorkflowId,
      });
    } catch (caught) {
      if (isExtensionMediaContextStaleError(caught)) {
        return error(reply, 409, 'media_create_context_stale', '来源商品上下文已变化，请刷新后重试');
      }
      return error(reply, 503, 'media_context_unavailable', '来源商品上下文暂不可用，请稍后重试');
    }
    if (!context
      || context.ownerUserId !== device.ownerUserId
      || context.id !== parsed.data.listingWorkflowId
      || context.shopId !== parsed.data.shopId
      || context.snapshotId !== parsed.data.snapshotId
      || context.revision !== parsed.data.revision
      || context.draftVersion !== parsed.data.draftVersion) {
      return error(reply, 409, 'media_create_context_stale', '来源商品上下文已变化，请刷新后重试');
    }
    return reply.send({
      code: 1,
      data: {
        capability,
        context: publicContext(context, parsed.data),
      },
    });
  });
}
