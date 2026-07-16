import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hashExtensionCommandRequest } from '../services/extension-command-grants.js';
import type {
  SourceCaptureRolloutStage,
  SourceWorkflowFeatureFlagEvaluator,
} from '../services/source-workflow-feature-flags.js';

interface CaptureDeviceContext {
  sessionId: string;
  tokenId: string;
  ownerUserId: string;
  actorUserId: string;
  scopes: string[];
}

interface SourceCaptureRouteService {
  ingest(input: {
    trusted: {
      ownerUserId: string;
      actorUserId: string;
      deviceSessionId: string;
      tokenId: string;
      rolloutRevision: string;
      rolloutStage: Exclude<SourceCaptureRolloutStage, 'off'>;
      ingestChannel: 'EXTENSION_DEVICE';
    };
    submission: unknown;
    grant: {
      token: string;
      idempotencyKey: string;
      requestHash: string;
    };
  }): Promise<{
    kind: 'created' | 'replay';
    subjectId: string;
    snapshotId: string;
    snapshotVersion: number;
    supplyGoodsId: string | null;
    captureHash: string;
    profile: unknown;
  }>;
}

export interface ExtensionSourceCaptureRoutesOptions {
  authenticateDevice: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  featureFlags: SourceWorkflowFeatureFlagEvaluator;
  service: SourceCaptureRouteService;
}

const submissionIdentitySchema = z.object({
  capture: z.object({
    captureVersion: z.literal('source-product-capture-v2'),
    platform: z.literal('1688'),
    sourceIdentity: z.object({
      productId: z.string().trim().min(1).max(200),
    }).passthrough(),
  }).passthrough(),
  captureHash: z.string().regex(/^[a-f0-9]{64}$/),
  payloadBytes: z.number().int().positive().max(8 * 1024 * 1024),
}).passthrough();

function error(reply: FastifyReply, statusCode: number, errorCode: string, message: string) {
  return reply.status(statusCode).send({ code: 0, errorCode, msg: message });
}

function deviceContext(request: FastifyRequest): CaptureDeviceContext | null {
  const candidate = (request as any).device as Partial<CaptureDeviceContext> | undefined;
  if (!candidate
    || typeof candidate.sessionId !== 'string'
    || typeof candidate.tokenId !== 'string'
    || typeof candidate.ownerUserId !== 'string'
    || candidate.actorUserId !== candidate.ownerUserId
    || !Array.isArray(candidate.scopes)) {
    return null;
  }
  return candidate as CaptureDeviceContext;
}

function header(request: FastifyRequest, name: string): string {
  const value = request.headers[name];
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function isEnabledCaptureStage(
  value: SourceCaptureRolloutStage | null,
): value is Exclude<SourceCaptureRolloutStage, 'off'> {
  return value === 'shadow_write' || value === 'dual_read' || value === 'v2_only';
}

export async function extensionSourceCaptureRoutes(
  app: FastifyInstance,
  options: ExtensionSourceCaptureRoutesOptions,
) {
  app.post('/source-captures/v2', {
    bodyLimit: 10 * 1024 * 1024,
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const device = deviceContext(request);
    if (!device) return error(reply, 401, 'invalid_device_token', '无效的设备令牌');
    if (!device.scopes.includes('capture:write')) {
      return error(reply, 403, 'insufficient_scope', '设备权限不足');
    }

    const grantToken = header(request, 'x-ss-erp-command-grant');
    const idempotencyKey = header(request, 'x-ss-erp-idempotency-key');
    if (!grantToken || !idempotencyKey) {
      return error(reply, 401, 'command_grant_required', '缺少采集命令授权');
    }
    if (!/^[A-Za-z0-9_-]{43,}$/.test(grantToken)
      || idempotencyKey.length < 16
      || idempotencyKey.length > 200) {
      return error(reply, 400, 'command_grant_invalid', '采集命令授权格式无效');
    }

    const parsed = submissionIdentitySchema.safeParse(request.body);
    if (!parsed.success) {
      return error(reply, 400, 'SOURCE_CAPTURE_INVALID', '采集快照格式无效');
    }
    const command = {
      schemaVersion: parsed.data.capture.captureVersion,
      platform: parsed.data.capture.platform,
      sourceProductId: parsed.data.capture.sourceIdentity.productId,
      captureHash: parsed.data.captureHash,
      payloadBytes: parsed.data.payloadBytes,
    };

    let rollout;
    try {
      rollout = await options.featureFlags.evaluate('SOURCE_CAPTURE_V2', {
        ownerUserId: device.ownerUserId,
        deviceSessionId: device.sessionId,
        platform: command.platform,
      });
    } catch {
      return error(reply, 503, 'source_workflow_rollout_unavailable', '来源商品采集策略暂不可用');
    }
    if (!rollout.enabled || !isEnabledCaptureStage(rollout.captureStage)) {
      return rollout.legacyAllowed
        ? error(reply, 409, 'source_capture_v2_disabled', '来源商品采集 V2 尚未启用')
        : error(reply, 503, 'source_workflow_rollout_unavailable', '来源商品采集策略暂不可用');
    }

    try {
      const result = await options.service.ingest({
        trusted: {
          ownerUserId: device.ownerUserId,
          actorUserId: device.actorUserId,
          deviceSessionId: device.sessionId,
          tokenId: device.tokenId,
          rolloutRevision: rollout.revision,
          rolloutStage: rollout.captureStage,
          ingestChannel: 'EXTENSION_DEVICE',
        },
        submission: request.body,
        grant: {
          token: grantToken,
          idempotencyKey,
          requestHash: hashExtensionCommandRequest({
            operation: 'SOURCE_CAPTURE',
            shopId: null,
            workflowId: null,
            draftVersion: null,
            command,
          }),
        },
      });
      reply.header('Cache-Control', 'no-store');
      return reply.status(result.kind === 'created' ? 201 : 200).send({
        code: 1,
        msg: result.kind === 'created' ? '采集快照已保存' : '采集快照已存在',
        data: {
          subjectId: result.subjectId,
          snapshotId: result.snapshotId,
          snapshotVersion: result.snapshotVersion,
          supplyGoodsId: result.supplyGoodsId,
          captureHash: result.captureHash,
          profile: result.profile,
          replay: result.kind === 'replay',
        },
      });
    } catch (caught) {
      const failure = caught as { statusCode?: unknown; code?: unknown; message?: unknown };
      const statusCode = Number(failure?.statusCode);
      const errorCode = String(failure?.code || '');
      if (Number.isInteger(statusCode)
        && statusCode >= 400
        && statusCode < 600
        && /^(?:SOURCE_CAPTURE_|COMMAND_)/.test(errorCode)) {
        return error(
          reply,
          statusCode,
          errorCode,
          String(failure.message || '采集快照保存失败'),
        );
      }
      throw caught;
    }
  });
}
