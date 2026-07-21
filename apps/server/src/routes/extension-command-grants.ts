import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  EXTENSION_COMMAND_OPERATIONS,
  EXTENSION_COMMAND_SCOPE_BY_OPERATION,
  ExtensionCommandGrantError,
  hashExtensionCommandRequest,
  type ExtensionCommandOperation,
} from '../services/extension-command-grants.js';
import {
  type SourceWorkflowFeatureFlagEvaluator,
} from '../services/source-workflow-feature-flags.js';

interface CommandDeviceContext {
  sessionId: string;
  tokenId: string;
  ownerUserId: string;
  actorUserId: string;
  scopes: string[];
  allowedShopIds: string[];
}

export interface ExtensionCommandResolutionInput {
  sessionId: string;
  ownerUserId: string;
  operation: ExtensionCommandOperation;
  shopId: string | null;
  workflowId: string | null;
  draftVersion: number | null;
  command: Record<string, unknown>;
}

export type ExtensionCommandResolution =
  | {
    kind: 'allowed';
    shopId: string | null;
    workflowId: string | null;
    draftVersion: number | null;
    command: Record<string, unknown>;
  }
  | { kind: 'unavailable' | 'stale' | 'forbidden' | 'rollout_unavailable' };

export interface SourceWorkflowCommandResolverOptions {
  featureFlags: SourceWorkflowFeatureFlagEvaluator;
  loadShop(input: {
    shopId: string;
    ownerUserId: string;
  }): Promise<{
    id: string;
    userId: string;
    platform: string;
    status: string;
  } | null>;
  loadDraft?(input: {
    workflowId: string;
    ownerUserId: string;
  }): Promise<{
    id: string;
    ownerUserId: string;
    shopId: string;
    draftVersion: number;
    revision: number;
    stage: string;
    selectedSkuKeys: string[];
    publishTaskIds: string[];
  } | null>;
  loadMediaWorkflow?(input: {
    workflowId: string;
    ownerUserId: string;
  }): Promise<{
    id: string;
    ownerUserId: string;
    contextType: string | null;
    contextId: string | null;
    contextDraftRevision: number | null;
    contextDraftVersion: number | null;
    revision: number;
    status: string;
    suiteId: string | null;
    provider: string | null;
  } | null>;
}

const sourceCaptureCommandSchema = z.object({
  schemaVersion: z.literal('source-product-capture-v2'),
  platform: z.literal('1688'),
  sourceProductId: z.string().trim().min(1).max(200),
  captureHash: z.string().regex(/^[a-f0-9]{64}$/),
  payloadBytes: z.number().int().positive().max(8 * 1024 * 1024),
}).strict();

const ozonPublishCommandSchema = z.object({
  schemaVersion: z.literal('ozon-publish-command/v1'),
  draftRevision: z.number().int().nonnegative(),
  publishIntentId: z.string().trim().min(1).max(200),
  selectedSkuKeys: z.array(z.string().trim().min(1).max(500)).min(1).max(500),
}).strict();

const mediaWorkflowCommandSchema = z.object({
  schemaVersion: z.literal('ai-media-workflow-command/v1'),
  action: z.enum(['CANCEL', 'RETRY']),
  mediaWorkflowId: z.string().trim().min(1).max(200),
  expectedRevision: z.number().int().positive(),
  draftRevision: z.number().int().positive(),
}).strict();

function rolloutUnavailableReason(reason: string) {
  return ['policy_invalid', 'context_invalid', 'config_unavailable'].includes(reason);
}

export function createSourceWorkflowCommandResolver(
  options: SourceWorkflowCommandResolverOptions,
) {
  return async (input: ExtensionCommandResolutionInput): Promise<ExtensionCommandResolution> => {
    if (input.operation === 'SOURCE_CAPTURE') {
      if (input.shopId || input.workflowId || input.draftVersion != null) {
        return { kind: 'forbidden' };
      }
      const parsed = sourceCaptureCommandSchema.safeParse(input.command);
      if (!parsed.success) return { kind: 'forbidden' };
      let rollout;
      try {
        rollout = await options.featureFlags.evaluate('SOURCE_CAPTURE_V2', {
          ownerUserId: input.ownerUserId,
          deviceSessionId: input.sessionId,
          platform: parsed.data.platform,
        });
      } catch {
        return { kind: 'rollout_unavailable' };
      }
      if (!rollout.enabled) {
        return rollout.legacyAllowed
          ? { kind: 'unavailable' }
          : { kind: 'rollout_unavailable' };
      }
      return {
        kind: 'allowed',
        shopId: null,
        workflowId: null,
        draftVersion: null,
        command: parsed.data,
      };
    }
    if (input.operation === 'MEDIA_EXECUTE') {
      if (!input.shopId || !input.workflowId || input.draftVersion == null
        || !options.loadDraft || !options.loadMediaWorkflow) {
        return { kind: 'forbidden' };
      }
      const parsedCommand = mediaWorkflowCommandSchema.safeParse(input.command);
      if (!parsedCommand.success) return { kind: 'forbidden' };

      let shop: Awaited<ReturnType<SourceWorkflowCommandResolverOptions['loadShop']>>;
      let draft: Awaited<ReturnType<NonNullable<SourceWorkflowCommandResolverOptions['loadDraft']>>>;
      let media: Awaited<ReturnType<NonNullable<SourceWorkflowCommandResolverOptions['loadMediaWorkflow']>>>;
      try {
        [shop, draft, media] = await Promise.all([
          options.loadShop({ shopId: input.shopId, ownerUserId: input.ownerUserId }),
          options.loadDraft({ workflowId: input.workflowId, ownerUserId: input.ownerUserId }),
          options.loadMediaWorkflow({
            workflowId: parsedCommand.data.mediaWorkflowId,
            ownerUserId: input.ownerUserId,
          }),
        ]);
      } catch {
        return { kind: 'rollout_unavailable' };
      }
      if (!shop
        || shop.id !== input.shopId
        || shop.userId !== input.ownerUserId
        || shop.platform !== 'OZON'
        || shop.status !== 'ACTIVE'
        || !draft
        || draft.id !== input.workflowId
        || draft.ownerUserId !== input.ownerUserId
        || draft.shopId !== input.shopId) {
        return { kind: 'forbidden' };
      }
      if (draft.draftVersion !== input.draftVersion
        || draft.revision !== parsedCommand.data.draftRevision) {
        return { kind: 'stale' };
      }
      if (!media
        || media.id !== parsedCommand.data.mediaWorkflowId
        || media.ownerUserId !== input.ownerUserId
        || media.contextType !== 'listing-draft'
        || media.contextId !== input.workflowId
        || media.contextDraftRevision !== parsedCommand.data.draftRevision
        || media.contextDraftVersion !== input.draftVersion
        || media.suiteId != null
        || media.provider !== 'fake') {
        return { kind: 'forbidden' };
      }
      const statusAllowed = parsedCommand.data.action === 'CANCEL'
        ? ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(media.status)
        : media.status === 'FAILED';
      if (media.revision !== parsedCommand.data.expectedRevision || !statusAllowed) {
        return { kind: 'stale' };
      }

      let rollout;
      try {
        rollout = await options.featureFlags.evaluate('SOURCE_LISTING_EXTENSION_WORKBENCH', {
          ownerUserId: input.ownerUserId,
          shopId: input.shopId,
          deviceSessionId: input.sessionId,
        });
      } catch {
        return { kind: 'rollout_unavailable' };
      }
      if (!rollout.enabled) {
        return rolloutUnavailableReason(rollout.reason)
          ? { kind: 'rollout_unavailable' }
          : { kind: 'unavailable' };
      }
      if (parsedCommand.data.action === 'RETRY') {
        let mediaWorkflowRollout;
        let webMediaRollout;
        try {
          [mediaWorkflowRollout, webMediaRollout] = await Promise.all([
            options.featureFlags.evaluate('AI_MEDIA_WORKFLOW_V2', {
              ownerUserId: input.ownerUserId,
            }),
            options.featureFlags.evaluate('SOURCE_LISTING_WEB_MEDIA', {
              ownerUserId: input.ownerUserId,
            }),
          ]);
        } catch {
          return { kind: 'rollout_unavailable' };
        }
        const unavailable = [mediaWorkflowRollout, webMediaRollout].find((item) => !item.enabled);
        if (unavailable) {
          return rolloutUnavailableReason(unavailable.reason)
            ? { kind: 'rollout_unavailable' }
            : { kind: 'unavailable' };
        }
      }
      return {
        kind: 'allowed',
        shopId: shop.id,
        workflowId: draft.id,
        draftVersion: draft.draftVersion,
        command: parsedCommand.data,
      };
    }
    if (input.operation !== 'OZON_PUBLISH') return { kind: 'unavailable' };
    if (!input.shopId || !input.workflowId || input.draftVersion == null) {
      return { kind: 'forbidden' };
    }
    const parsedCommand = ozonPublishCommandSchema.safeParse(input.command);
    if (!parsedCommand.success || !options.loadDraft) return { kind: 'forbidden' };

    let shop: Awaited<ReturnType<SourceWorkflowCommandResolverOptions['loadShop']>>;
    try {
      shop = await options.loadShop({
        shopId: input.shopId,
        ownerUserId: input.ownerUserId,
      });
    } catch {
      return { kind: 'rollout_unavailable' };
    }
    if (!shop
      || shop.id !== input.shopId
      || shop.userId !== input.ownerUserId
      || shop.platform !== 'OZON'
      || shop.status !== 'ACTIVE') {
      return { kind: 'forbidden' };
    }

    let draft: Awaited<ReturnType<NonNullable<SourceWorkflowCommandResolverOptions['loadDraft']>>>;
    try {
      draft = await options.loadDraft({
        workflowId: input.workflowId,
        ownerUserId: input.ownerUserId,
      });
    } catch {
      return { kind: 'rollout_unavailable' };
    }
    const selectedSkuKeys = [...new Set(parsedCommand.data.selectedSkuKeys)];
    if (!draft
      || draft.id !== input.workflowId
      || draft.ownerUserId !== input.ownerUserId
      || draft.shopId !== input.shopId
      || draft.draftVersion !== input.draftVersion
      || draft.revision !== parsedCommand.data.draftRevision
      || draft.stage !== 'PUBLISH_INTENT_RECORDED'
      || !draft.publishTaskIds.includes(parsedCommand.data.publishIntentId)
      || selectedSkuKeys.length !== parsedCommand.data.selectedSkuKeys.length
      || selectedSkuKeys.length !== draft.selectedSkuKeys.length
      || selectedSkuKeys.some((key, index) => key !== draft.selectedSkuKeys[index])) {
      return { kind: 'stale' };
    }

    let rollout;
    try {
      rollout = await options.featureFlags.evaluate('SOURCE_OZON_PUBLISHER_V2', {
        ownerUserId: shop.userId,
        shopId: shop.id,
        platform: shop.platform,
        deviceSessionId: input.sessionId,
      });
    } catch {
      return { kind: 'rollout_unavailable' };
    }
    if (!rollout.enabled) {
      return rollout.legacyAllowed ? { kind: 'unavailable' } : { kind: 'rollout_unavailable' };
    }

    return {
      kind: 'allowed',
      shopId: shop.id,
      workflowId: draft.id,
      draftVersion: draft.draftVersion,
      command: parsedCommand.data,
    };
  };
}

interface ExtensionCommandGrantRouteService {
  issue(input: {
    sessionId: string;
    tokenId: string;
    ownerUserId: string;
    shopId: string | null;
    operation: ExtensionCommandOperation;
    workflowId: string | null;
    draftVersion: number | null;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<{ grantId: string; token: string; expiresAt: Date }>;
  authorize(input: {
    sessionId: string;
    tokenId: string;
    ownerUserId: string;
    shopId: string | null;
    operation: ExtensionCommandOperation;
    workflowId: string | null;
    draftVersion: number | null;
    idempotencyKey: string;
    requestHash: string;
    token: string;
  }): Promise<{ kind: 'execute' | 'replay'; receipt: { id: string; status: string; result: unknown; failureCode: string | null } }>;
  complete(input: { receiptId: string; result: unknown }): Promise<unknown>;
  fail(input: { receiptId: string; failureCode: string; result?: unknown }): Promise<unknown>;
}

export interface ExtensionCommandGrantRoutesOptions {
  service: ExtensionCommandGrantRouteService;
  authenticateDevice: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  resolveCommand(input: ExtensionCommandResolutionInput): Promise<ExtensionCommandResolution>;
  executeOzonPublish?(input: {
    ownerUserId: string;
    actorUserId: string;
    shopId: string;
    workflowId: string;
    draftVersion: number;
    command: Record<string, unknown>;
  }): Promise<unknown>;
  executeMediaWorkflowCommand?(input: {
    ownerUserId: string;
    actorUserId: string;
    shopId: string;
    listingWorkflowId: string;
    draftVersion: number;
    idempotencyKey: string;
    command: Record<string, unknown>;
  }): Promise<{
    workflowId: string;
    action: 'CANCEL' | 'RETRY';
    status: string;
    revision: number;
  }>;
}

const requestSchema = z.object({
  operation: z.enum(EXTENSION_COMMAND_OPERATIONS),
  shopId: z.string().trim().min(1).max(200).optional(),
  workflowId: z.string().trim().min(1).max(200).optional(),
  draftVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().trim().min(16).max(200),
  command: z.record(z.string(), z.unknown()),
}).strict();
const executeSchema = z.object({
  shopId: z.string().trim().min(1).max(200),
  workflowId: z.string().trim().min(1).max(200),
  draftVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(16).max(200),
  command: z.record(z.string(), z.unknown()),
}).strict();

function error(reply: FastifyReply, statusCode: number, errorCode: string, message: string) {
  return reply.status(statusCode).send({ code: 0, errorCode, msg: message });
}

function deviceContext(request: FastifyRequest): CommandDeviceContext | null {
  const candidate = (request as any).device as Partial<CommandDeviceContext> | undefined;
  if (!candidate
    || typeof candidate.sessionId !== 'string'
    || typeof candidate.tokenId !== 'string'
    || typeof candidate.ownerUserId !== 'string'
    || candidate.actorUserId !== candidate.ownerUserId
    || !Array.isArray(candidate.scopes)
    || !Array.isArray(candidate.allowedShopIds)) {
    return null;
  }
  return candidate as CommandDeviceContext;
}

export async function extensionCommandGrantRoutes(
  app: FastifyInstance,
  options: ExtensionCommandGrantRoutesOptions,
) {
  app.post('/command-grants', { preHandler: [options.authenticateDevice] }, async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, 'invalid_request', '参数错误');
    const device = deviceContext(request);
    if (!device) return error(reply, 401, 'invalid_device_token', '无效的设备令牌');

    const requiredScope = EXTENSION_COMMAND_SCOPE_BY_OPERATION[parsed.data.operation];
    if (!device.scopes.includes(requiredScope)) {
      return error(reply, 403, 'command_scope_denied', '设备权限不足');
    }
    const requestedShopId = parsed.data.shopId || null;
    if (requestedShopId && !device.allowedShopIds.includes(requestedShopId)) {
      return error(reply, 403, 'command_shop_denied', '设备无权访问该店铺');
    }

    const resolution = await options.resolveCommand({
      sessionId: device.sessionId,
      ownerUserId: device.ownerUserId,
      operation: parsed.data.operation,
      shopId: requestedShopId,
      workflowId: parsed.data.workflowId || null,
      draftVersion: parsed.data.draftVersion ?? null,
      command: parsed.data.command,
    });
    if (resolution.kind !== 'allowed') {
      const decisions = {
        unavailable: [409, 'command_operation_unavailable', '该命令尚未开放'],
        stale: [409, 'command_context_stale', '命令上下文已过期'],
        forbidden: [403, 'command_context_forbidden', '无权访问命令上下文'],
        rollout_unavailable: [503, 'source_workflow_rollout_unavailable', '来源商品发布策略暂不可用'],
      } as const;
      const [statusCode, code, message] = decisions[resolution.kind];
      return error(reply, statusCode, code, message);
    }
    if (resolution.shopId && !device.allowedShopIds.includes(resolution.shopId)) {
      return error(reply, 403, 'command_shop_denied', '设备无权访问该店铺');
    }

    const envelope = {
      operation: parsed.data.operation,
      shopId: resolution.shopId,
      workflowId: resolution.workflowId,
      draftVersion: resolution.draftVersion,
      command: resolution.command,
    };
    try {
      const issued = await options.service.issue({
        sessionId: device.sessionId,
        tokenId: device.tokenId,
        ownerUserId: device.ownerUserId,
        shopId: resolution.shopId,
        operation: parsed.data.operation,
        workflowId: resolution.workflowId,
        draftVersion: resolution.draftVersion,
        idempotencyKey: parsed.data.idempotencyKey,
        requestHash: hashExtensionCommandRequest(envelope),
      });
      reply.header('Cache-Control', 'no-store');
      return reply.status(201).send({
        code: 1,
        msg: '命令授权已签发',
        data: {
          grantId: issued.grantId,
          grantToken: issued.token,
          expiresAt: issued.expiresAt,
        },
      });
    } catch (caught) {
      if (!(caught instanceof ExtensionCommandGrantError)) throw caught;
      return error(reply, caught.statusCode, caught.code, caught.message);
    }
  });

  app.post('/ozon-publish/execute', { preHandler: [options.authenticateDevice] }, async (request, reply) => {
    const parsed = executeSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, 'invalid_request', '参数错误');
    const device = deviceContext(request);
    if (!device) return error(reply, 401, 'invalid_device_token', '无效的设备令牌');
    if (!device.scopes.includes(EXTENSION_COMMAND_SCOPE_BY_OPERATION.OZON_PUBLISH)
      || !device.allowedShopIds.includes(parsed.data.shopId)) {
      return error(reply, 403, 'command_scope_denied', '设备无权执行 Ozon 发布');
    }
    const token = String(request.headers['x-ss-erp-command-grant'] || '').trim();
    if (!token) return error(reply, 401, 'command_grant_required', '缺少命令授权');
    const envelope = {
      operation: 'OZON_PUBLISH' as const,
      shopId: parsed.data.shopId,
      workflowId: parsed.data.workflowId,
      draftVersion: parsed.data.draftVersion,
      command: parsed.data.command,
    };
    try {
      const resolution = await options.resolveCommand({
        sessionId: device.sessionId,
        ownerUserId: device.ownerUserId,
        operation: 'OZON_PUBLISH',
        shopId: parsed.data.shopId,
        workflowId: parsed.data.workflowId,
        draftVersion: parsed.data.draftVersion,
        command: parsed.data.command,
      });
      if (resolution.kind !== 'allowed'
        || resolution.shopId !== parsed.data.shopId
        || resolution.workflowId !== parsed.data.workflowId
        || resolution.draftVersion !== parsed.data.draftVersion) {
        const decisions = {
          unavailable: [409, 'command_operation_unavailable', '该命令尚未开放'],
          stale: [409, 'command_context_stale', '命令上下文已过期'],
          forbidden: [403, 'command_context_forbidden', '无权访问命令上下文'],
          rollout_unavailable: [503, 'source_workflow_rollout_unavailable', '来源商品发布策略暂不可用'],
        } as const;
        if (resolution.kind === 'allowed') {
          return error(reply, 409, 'command_context_stale', '命令上下文已过期');
        }
        const [statusCode, code, message] = decisions[resolution.kind];
        return error(reply, statusCode, code, message);
      }
      const authorized = await options.service.authorize({
        sessionId: device.sessionId,
        tokenId: device.tokenId,
        ownerUserId: device.ownerUserId,
        shopId: parsed.data.shopId,
        operation: 'OZON_PUBLISH',
        workflowId: parsed.data.workflowId,
        draftVersion: parsed.data.draftVersion,
        idempotencyKey: parsed.data.idempotencyKey,
        requestHash: hashExtensionCommandRequest(envelope),
        token,
      });
      if (authorized.kind === 'replay') {
        return reply.send({ code: 1, data: { receipt: authorized.receipt, replay: true } });
      }
      try {
        const result = await options.executeOzonPublish?.({
          ownerUserId: device.ownerUserId,
          actorUserId: device.actorUserId,
          shopId: parsed.data.shopId,
          workflowId: parsed.data.workflowId,
          draftVersion: parsed.data.draftVersion,
          command: parsed.data.command,
        });
        if (result === undefined) {
          await options.service.fail({ receiptId: authorized.receipt.id, failureCode: 'PUBLISH_EXECUTOR_UNAVAILABLE' });
          return error(reply, 503, 'publish_executor_unavailable', 'Ozon 发布执行器暂不可用');
        }
        const receipt = await options.service.complete({ receiptId: authorized.receipt.id, result });
        return reply.status(202).send({ code: 1, data: { receipt, replay: false } });
      } catch (caught) {
        const candidateCode = caught && typeof caught === 'object'
          ? String((caught as { code?: unknown }).code || '')
          : '';
        const failureCode = /^[A-Z][A-Z0-9_]{0,99}$/u.test(candidateCode)
          ? candidateCode
          : 'PUBLISH_FAILED';
        const receipt = await options.service.fail({
          receiptId: authorized.receipt.id,
          failureCode,
          result: null,
        });
        return reply.status(409).send({ code: 0, errorCode: 'publish_failed', msg: 'Ozon 发布执行失败', data: { receipt } });
      }
    } catch (caught) {
      if (!(caught instanceof ExtensionCommandGrantError)) throw caught;
      return error(reply, caught.statusCode, caught.code, caught.message);
    }
  });

  app.post('/media-workflows/execute', { preHandler: [options.authenticateDevice] }, async (request, reply) => {
    const parsed = executeSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, 'invalid_request', '参数错误');
    const device = deviceContext(request);
    if (!device) return error(reply, 401, 'invalid_device_token', '无效的设备令牌');
    if (!device.scopes.includes(EXTENSION_COMMAND_SCOPE_BY_OPERATION.MEDIA_EXECUTE)
      || !device.allowedShopIds.includes(parsed.data.shopId)) {
      return error(reply, 403, 'command_scope_denied', '设备无权执行媒体任务命令');
    }
    const token = String(request.headers['x-ss-erp-command-grant'] || '').trim();
    if (!token) return error(reply, 401, 'command_grant_required', '缺少命令授权');
    const envelope = {
      operation: 'MEDIA_EXECUTE' as const,
      shopId: parsed.data.shopId,
      workflowId: parsed.data.workflowId,
      draftVersion: parsed.data.draftVersion,
      command: parsed.data.command,
    };
    try {
      const resolution = await options.resolveCommand({
        sessionId: device.sessionId,
        ownerUserId: device.ownerUserId,
        operation: 'MEDIA_EXECUTE',
        shopId: parsed.data.shopId,
        workflowId: parsed.data.workflowId,
        draftVersion: parsed.data.draftVersion,
        command: parsed.data.command,
      });
      if (resolution.kind !== 'allowed'
        || resolution.shopId !== parsed.data.shopId
        || resolution.workflowId !== parsed.data.workflowId
        || resolution.draftVersion !== parsed.data.draftVersion) {
        const decisions = {
          unavailable: [409, 'command_operation_unavailable', '该命令尚未开放'],
          stale: [409, 'command_context_stale', '命令上下文已过期'],
          forbidden: [403, 'command_context_forbidden', '无权访问命令上下文'],
          rollout_unavailable: [503, 'source_workflow_rollout_unavailable', '来源商品工作台策略暂不可用'],
        } as const;
        if (resolution.kind === 'allowed') {
          return error(reply, 409, 'command_context_stale', '命令上下文已过期');
        }
        const [statusCode, code, message] = decisions[resolution.kind];
        return error(reply, statusCode, code, message);
      }
      const authorized = await options.service.authorize({
        sessionId: device.sessionId,
        tokenId: device.tokenId,
        ownerUserId: device.ownerUserId,
        shopId: parsed.data.shopId,
        operation: 'MEDIA_EXECUTE',
        workflowId: parsed.data.workflowId,
        draftVersion: parsed.data.draftVersion,
        idempotencyKey: parsed.data.idempotencyKey,
        requestHash: hashExtensionCommandRequest(envelope),
        token,
      });
      if (authorized.kind === 'replay') {
        return reply.send({ code: 1, data: { receipt: authorized.receipt, replay: true } });
      }
      try {
        const result = await options.executeMediaWorkflowCommand?.({
          ownerUserId: device.ownerUserId,
          actorUserId: device.actorUserId,
          shopId: parsed.data.shopId,
          listingWorkflowId: parsed.data.workflowId,
          draftVersion: parsed.data.draftVersion,
          idempotencyKey: parsed.data.idempotencyKey,
          command: resolution.command,
        });
        if (result === undefined) {
          await options.service.fail({
            receiptId: authorized.receipt.id,
            failureCode: 'MEDIA_COMMAND_EXECUTOR_UNAVAILABLE',
          });
          return error(reply, 503, 'media_command_executor_unavailable', '媒体任务执行器暂不可用');
        }
        const receipt = await options.service.complete({
          receiptId: authorized.receipt.id,
          result,
        });
        return reply.status(202).send({ code: 1, data: { receipt, replay: false } });
      } catch (caught) {
        const candidateCode = caught && typeof caught === 'object'
          ? String((caught as { code?: unknown }).code || '')
          : '';
        const failureCode = /^[A-Z][A-Z0-9_]{0,99}$/u.test(candidateCode)
          ? candidateCode
          : 'MEDIA_COMMAND_FAILED';
        const receipt = await options.service.fail({
          receiptId: authorized.receipt.id,
          failureCode,
          result: null,
        });
        return reply.status(409).send({
          code: 0,
          errorCode: 'media_command_failed',
          msg: '媒体任务命令执行失败',
          data: { receipt },
        });
      }
    } catch (caught) {
      if (!(caught instanceof ExtensionCommandGrantError)) throw caught;
      return error(reply, caught.statusCode, caught.code, caught.message);
    }
  });
}
