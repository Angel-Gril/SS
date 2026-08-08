import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ExtensionByokReadinessDecision } from '../services/extension-byok-policy.js';
import {
  createExtensionByokReadinessAttestation,
  ExtensionByokReadinessAttestationError,
  parseExtensionByokReadinessRequest,
} from '../services/extension-byok-readiness-attestation.js';
import {
  EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
  EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2,
  EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V3,
  ExtensionByokWorkbenchLaunchError,
  parseExtensionByokWorkbenchLaunchRequest,
  resolveExtensionByokWorkbenchBatchLaunchContext,
  resolveExtensionByokWorkbenchBoundSlotCandidate,
  resolveExtensionByokWorkbenchBoundSlotLaunchDecision,
  resolveExtensionByokWorkbenchLaunchContext,
  resolveExtensionByokWorkbenchLaunchDecision,
  resolveExtensionByokWorkbenchSlotTarget,
  type ExtensionByokWorkbenchBoundSlotAuthorizationInput,
  type ExtensionByokWorkbenchBoundSlotAuthorizationDecision,
  type ExtensionByokWorkbenchDraft,
} from '../services/extension-byok-workbench-launch.js';

interface ReadinessDevice {
  sessionId: string;
  ownerUserId: string;
  actorUserId: string;
  scopes: string[];
  allowedShopIds: string[];
}

export interface ExtensionByokReadinessRoutesOptions {
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  authenticateLaunchDevice?(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  loadShop(input: { shopId: string; ownerUserId: string }): Promise<{
    id: string;
    userId: string;
    platform: string;
    status: string;
  } | null>;
  loadDraft(input: { workflowId: string; ownerUserId: string }): Promise<
    ExtensionByokWorkbenchDraft | null
  >;
  authorizeBoundSlotLaunch?(
    input: ExtensionByokWorkbenchBoundSlotAuthorizationInput,
  ): Promise<ExtensionByokWorkbenchBoundSlotAuthorizationDecision>;
  getReadiness(input: {
    ownerUserId: string;
    shopId: string;
    deviceSessionId: string;
    providerOrigin: string;
    operation: 'TEXT_TO_IMAGE' | 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT';
  }): Promise<ExtensionByokReadinessDecision>;
  now?: () => Date;
}

function routeError(reply: FastifyReply, status: number, code: string, message: string) {
  reply.header('Cache-Control', 'no-store');
  return reply.status(status).send({ code: 0, errorCode: code, msg: message });
}

function deviceContext(
  request: FastifyRequest,
  requiredScope: 'listing:review' | 'byok:media:ingest',
): ReadinessDevice | null {
  const value = (request as any).device as Partial<ReadinessDevice> | undefined;
  if (!value
    || typeof value.sessionId !== 'string'
    || typeof value.ownerUserId !== 'string'
    || value.actorUserId !== value.ownerUserId
    || !Array.isArray(value.scopes)
    || !value.scopes.includes(requiredScope)
    || !Array.isArray(value.allowedShopIds)) return null;
  return value as ReadinessDevice;
}

export async function extensionByokReadinessRoutes(
  app: FastifyInstance,
  options: ExtensionByokReadinessRoutesOptions,
) {
  const authenticateLaunchDevice = options.authenticateLaunchDevice || options.authenticateDevice;
  app.post('/workbench-launch', { preHandler: [authenticateLaunchDevice] }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const device = deviceContext(request, 'listing:review');
    if (!device) return routeError(reply, 403, 'byok_readiness_scope_denied', '设备缺少商品审核权限');
    let parsed;
    try {
      parsed = parseExtensionByokWorkbenchLaunchRequest(request.body);
    } catch (error) {
      if (error instanceof ExtensionByokWorkbenchLaunchError) {
        return routeError(reply, error.statusCode, error.code.toLowerCase(), 'AI 图片工作台启动请求无效');
      }
      throw error;
    }
    if (!device.allowedShopIds.includes(parsed.shopId)) {
      return routeError(reply, 403, 'byok_readiness_shop_denied', '设备无权访问该店铺');
    }
    try {
      const [shop, draft] = await Promise.all([
        options.loadShop({ shopId: parsed.shopId, ownerUserId: device.ownerUserId }),
        options.loadDraft({ workflowId: parsed.workflowId, ownerUserId: device.ownerUserId }),
      ]);
      if (!shop
        || shop.id !== parsed.shopId
        || shop.userId !== device.ownerUserId
        || shop.platform !== 'OZON'
        || shop.status !== 'ACTIVE') {
        return routeError(reply, 403, 'byok_readiness_shop_denied', '店铺不可用于 AI 图片工作台');
      }
      if (!draft) {
        return routeError(reply, 409, 'byok_workbench_launch_context_stale', '商品草稿已变化');
      }
      let data;
      if (parsed.contractVersion === EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V3) {
        const boundCandidate = resolveExtensionByokWorkbenchBoundSlotCandidate({
          ownerUserId: device.ownerUserId,
          request: parsed,
          draft,
        });
        if (boundCandidate) {
          let authorization: ExtensionByokWorkbenchBoundSlotAuthorizationDecision | null = null;
          try {
            authorization = options.authorizeBoundSlotLaunch
              ? await options.authorizeBoundSlotLaunch({
                ownerUserId: device.ownerUserId,
                requestingDeviceSessionId: device.sessionId,
                sourcePlatform: parsed.sourcePlatform,
                sourceProductId: parsed.sourceProductId,
                sourceCaptureSnapshotId: parsed.sourceCaptureSnapshotId,
                supplyGoodsId: parsed.supplyGoodsId,
                shopId: parsed.shopId,
                workflowId: parsed.workflowId,
                draftRevision: parsed.draftRevision,
                draftVersion: parsed.draftVersion,
                ...boundCandidate,
              })
              : null;
          } catch {
            authorization = null;
          }
          if (authorization?.authorized !== true
            || authorization.assetId !== boundCandidate.assetId) {
            throw new ExtensionByokWorkbenchLaunchError(
              'BYOK_WORKBENCH_LAUNCH_SLOT_UNAVAILABLE',
              409,
              'The generated SKU hero is not authorized for review-only launch',
            );
          }
          data = resolveExtensionByokWorkbenchBoundSlotLaunchDecision({
            ownerUserId: device.ownerUserId,
            request: parsed,
            draft,
            authorizedCandidate: boundCandidate,
          });
        } else {
          data = resolveExtensionByokWorkbenchLaunchDecision({
            ownerUserId: device.ownerUserId,
            request: parsed,
            draft,
          });
        }
      } else if (parsed.contractVersion === EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2) {
        data = resolveExtensionByokWorkbenchLaunchDecision({
          ownerUserId: device.ownerUserId,
          request: parsed,
          draft,
        });
      } else {
        data = resolveExtensionByokWorkbenchLaunchContext({
          ownerUserId: device.ownerUserId,
          request: parsed,
          draft,
        });
      }
      return reply.send({ code: 1, data });
    } catch (error) {
      if (error instanceof ExtensionByokWorkbenchLaunchError) {
        return routeError(reply, error.statusCode, error.code.toLowerCase(), 'AI 图片工作台上下文已变化');
      }
      request.log.error({ err: error }, 'extension BYOK workbench launch failed');
      return routeError(reply, 503, 'byok_workbench_launch_unavailable', 'AI 图片工作台暂不可用');
    }
  });

  app.post('/workbench-batch-launch', {
    preHandler: [authenticateLaunchDevice],
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const device = deviceContext(request, 'listing:review');
    if (!device) return routeError(reply, 403, 'byok_readiness_scope_denied', '设备缺少商品审核权限');
    let parsed;
    try {
      parsed = parseExtensionByokWorkbenchLaunchRequest(request.body);
    } catch (error) {
      if (error instanceof ExtensionByokWorkbenchLaunchError) {
        return routeError(reply, error.statusCode, error.code.toLowerCase(), 'AI 图片工作台请求无效');
      }
      throw error;
    }
    if (!device.allowedShopIds.includes(parsed.shopId)) {
      return routeError(reply, 403, 'byok_readiness_shop_denied', '设备无权访问该店铺');
    }
    if (parsed.contractVersion === EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V3) {
      return routeError(reply, 400, 'byok_workbench_launch_request_invalid', '批量工作台请求无效');
    }
    try {
      const [shop, draft] = await Promise.all([
        options.loadShop({ shopId: parsed.shopId, ownerUserId: device.ownerUserId }),
        options.loadDraft({ workflowId: parsed.workflowId, ownerUserId: device.ownerUserId }),
      ]);
      if (!shop || shop.id !== parsed.shopId || shop.userId !== device.ownerUserId
        || shop.platform !== 'OZON' || shop.status !== 'ACTIVE') {
        return routeError(reply, 403, 'byok_readiness_shop_denied', '店铺不可用于 AI 图片工作台');
      }
      if (!draft) {
        return routeError(reply, 409, 'byok_workbench_launch_context_stale', '商品草稿已变化');
      }
      const context = resolveExtensionByokWorkbenchBatchLaunchContext({
        ownerUserId: device.ownerUserId,
        request: parsed,
        draft,
      });
      return reply.send({ code: 1, data: context });
    } catch (error) {
      if (error instanceof ExtensionByokWorkbenchLaunchError) {
        return routeError(reply, error.statusCode, error.code.toLowerCase(), 'AI 图片工作台上下文已变化');
      }
      request.log.error({ err: error }, 'extension BYOK workbench batch launch failed');
      return routeError(reply, 503, 'byok_workbench_launch_unavailable', 'AI 图片工作台暂不可用');
    }
  });

  app.post('/readiness', { preHandler: [options.authenticateDevice] }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const device = deviceContext(request, 'byok:media:ingest');
    if (!device) return routeError(reply, 403, 'byok_readiness_scope_denied', '设备缺少 BYOK 权限');
    let parsed;
    try {
      parsed = parseExtensionByokReadinessRequest(request.body);
    } catch (error) {
      if (error instanceof ExtensionByokReadinessAttestationError) {
        return routeError(reply, error.statusCode, error.code.toLowerCase(), 'BYOK readiness 请求无效');
      }
      throw error;
    }
    if (!device.allowedShopIds.includes(parsed.shopId)) {
      return routeError(reply, 403, 'byok_readiness_shop_denied', '设备无权访问该店铺');
    }
    try {
      const [shop, draft, decision] = await Promise.all([
        options.loadShop({ shopId: parsed.shopId, ownerUserId: device.ownerUserId }),
        parsed.workflowId
          ? options.loadDraft({ workflowId: parsed.workflowId, ownerUserId: device.ownerUserId })
          : Promise.resolve(null),
        options.getReadiness({
          ownerUserId: device.ownerUserId,
          shopId: parsed.shopId,
          deviceSessionId: device.sessionId,
          providerOrigin: parsed.providerOrigin,
          operation: parsed.operation,
        }),
      ]);
      if (!shop
        || shop.id !== parsed.shopId
        || shop.userId !== device.ownerUserId
        || shop.platform !== 'OZON'
        || shop.status !== 'ACTIVE') {
        return routeError(reply, 403, 'byok_readiness_shop_denied', '店铺不可用于 BYOK');
      }
      if (parsed.workflowId && (!draft
        || draft.id !== parsed.workflowId
        || draft.ownerUserId !== device.ownerUserId
        || draft.shopId !== parsed.shopId
        || draft.revision !== parsed.draftRevision
        || draft.draftVersion !== parsed.draftVersion)) {
        return routeError(reply, 409, 'byok_readiness_draft_stale', '商品草稿已变化');
      }
      if (parsed.workflowId) {
        try {
          resolveExtensionByokWorkbenchSlotTarget({
            ownerUserId: device.ownerUserId,
            request: {
              contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
              sourcePlatform: parsed.sourcePlatform!,
              sourceProductId: parsed.sourceProductId!,
              sourceCaptureSnapshotId: parsed.sourceCaptureSnapshotId!,
              supplyGoodsId: parsed.supplyGoodsId!,
              shopId: parsed.shopId,
              workflowId: parsed.workflowId,
              draftRevision: parsed.draftRevision!,
              draftVersion: parsed.draftVersion!,
            },
            draft: draft!,
            target: {
              skuKey: parsed.skuKey!,
              slotKey: parsed.slotKey!,
              assignmentMode: parsed.assignmentMode!,
              assignmentOrdinal: parsed.assignmentOrdinal!,
            },
          });
        } catch (error) {
          if (error instanceof ExtensionByokWorkbenchLaunchError) {
            return routeError(reply, 409, 'byok_readiness_target_stale', '商品图片槽位已变化');
          }
          throw error;
        }
      }
      const attestation = createExtensionByokReadinessAttestation({
        ownerUserId: device.ownerUserId,
        deviceSessionId: device.sessionId,
        request: parsed,
        decision,
        now: (options.now || (() => new Date()))(),
      });
      return reply.send({ code: 1, data: attestation });
    } catch (error) {
      if (error instanceof ExtensionByokReadinessAttestationError) {
        return routeError(reply, error.statusCode, error.code.toLowerCase(), 'BYOK Provider 尚未就绪');
      }
      request.log.error({ err: error }, 'extension BYOK readiness failed');
      return routeError(reply, 503, 'byok_readiness_unavailable', 'BYOK readiness 暂不可用');
    }
  });
}
