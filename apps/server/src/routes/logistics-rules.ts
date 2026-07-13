import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { buildLogisticsRuleEffectiveEtag } from '../services/logistics-rule-distribution.js';
import { ifNoneMatchIncludes } from '../services/logistics-rule-distribution.js';

const nonEmpty = z.string().trim().min(1).max(300);
const extensionVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

function compareExtensionVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}


const assignmentDiscoverySchema = z.object({
  assignmentId: nonEmpty,
  shopId: nonEmpty,
  shopName: nonEmpty,
  companyId: nonEmpty,
  warehouseId: nonEmpty,
  warehouseName: nonEmpty,
  originCountryUid: nonEmpty,
  originCityUid: nonEmpty,
  originLabel: nonEmpty,
  destinationCountryUid: nonEmpty,
  destinationLocationUid: nonEmpty,
  destinationLabel: nonEmpty,
  releaseSequence: z.number().int().nonnegative(),
}).strict();

const applyFailureCodeSchema = z.enum([
  'checksum_mismatch',
  'schema_unsupported',
  'storage_quota',
  'scope_mismatch',
  'apply_failed',
]);
const applyReceiptCommon = {
  idempotencyKey: z.string().trim().min(16).max(200),
  effectiveChecksum: z.string().regex(/^[a-f0-9]{64}$/i),
  extensionVersion: extensionVersionSchema,
};
const applyReceiptSchema = z.discriminatedUnion('status', [
  z.object({
    ...applyReceiptCommon, status: z.literal('applied'), appliedAt: z.string().datetime(),
  }).strict(),
  z.object({
    ...applyReceiptCommon, status: z.literal('failed'), failureCode: applyFailureCodeSchema,
  }).strict(),
]);

export type LogisticsRuleAssignmentDiscovery = z.infer<typeof assignmentDiscoverySchema>;

interface LogisticsRuleDeviceContext {
  sessionId: string;
  ownerUserId: string;
  allowedShopIds?: string[];
}

export interface LogisticsRuleDeviceRepository {
  listAssignmentsForDevice(input: {
    sessionId: string;
    ownerUserId: string;
    allowedShopIds: string[];
  }): Promise<LogisticsRuleAssignmentDiscovery[]>;
  getEffectiveReleaseForDevice(input: {
    sessionId: string;
    ownerUserId: string;
    allowedShopIds: string[];
    assignmentId: string;
    now: Date;
  }): Promise<
    | {
      state: 'allowed';
      assignmentId: string;
      scopeKey: string;
      releaseId: string;
      releaseSequence: number;
      contentChecksum: string;
      effectiveChecksum: string;
      minExtensionVersion: string;
      validUntil: string;
      staleUntil: string;
      bundle: Record<string, unknown>;
    }
    | { state: 'not_found' }
    | { state: 'gone'; assignmentId: string; reasonCode: string }
  >;
  authorizeEffectiveReleaseDelivery(input: {
    sessionId: string;
    ownerUserId: string;
    allowedShopIds: string[];
    assignmentId: string;
    releaseId: string;
    effectiveChecksum: string;
    scopeKey: string;
    now: Date;
  }): Promise<
    | { state: 'allowed'; authorizationValidUntil: string }
    | { state: 'not_found' }
    | { state: 'gone'; assignmentId: string; reasonCode: string }
  >;
  recordApplyReceipt(input: {
    sessionId: string;
    ownerUserId: string;
    allowedShopIds: string[];
    assignmentId: string;
    releaseId: string;
    idempotencyKey: string;
    effectiveChecksum: string;
    status: 'APPLIED' | 'FAILED';
    failureCode: z.infer<typeof applyFailureCodeSchema> | null;
    extensionVersion: string;
    appliedAt: Date | null;
    now: Date;
  }): Promise<{ state: 'accepted'; receiptId: string; duplicate: boolean }>;
}

export interface LogisticsRuleRoutesOptions {
  repository: LogisticsRuleDeviceRepository;
  authenticateDiscover: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  authenticateRead: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  authenticateReceipt: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  deploymentId: string;
  now?: () => Date;
}

function deviceContext(request: FastifyRequest): LogisticsRuleDeviceContext {
  const device = (request as any).device as Partial<LogisticsRuleDeviceContext> | undefined;
  const parsed = z.object({
    sessionId: nonEmpty,
    ownerUserId: nonEmpty,
    allowedShopIds: z.array(nonEmpty).default([]),
  }).safeParse(device);
  if (!parsed.success) throw new Error('Authenticated extension-device context is unavailable');
  return parsed.data as LogisticsRuleDeviceContext;
}

export async function logisticsRuleRoutes(
  app: FastifyInstance,
  options: LogisticsRuleRoutesOptions,
) {
  const now = options.now || (() => new Date());

  app.get('/assignments', { preHandler: [options.authenticateDiscover] }, async (request, reply) => {
    const device = deviceContext(request);
    const assignments = await options.repository.listAssignmentsForDevice({
      sessionId: device.sessionId,
      ownerUserId: device.ownerUserId,
      allowedShopIds: device.allowedShopIds || [],
    });
    const publicAssignments = z.array(assignmentDiscoverySchema).parse(assignments);
    return reply.send({ code: 1, msg: 'ok', data: { assignments: publicAssignments } });
  });

  app.get('/assignments/:assignmentId/effective', {
    preHandler: [options.authenticateRead],
  }, async (request, reply) => {
    const params = z.object({ assignmentId: nonEmpty }).safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: '参数错误' });
    }
    const device = deviceContext(request);
    const serverNow = now();
    const result = await options.repository.getEffectiveReleaseForDevice({
      sessionId: device.sessionId,
      ownerUserId: device.ownerUserId,
      allowedShopIds: device.allowedShopIds || [],
      assignmentId: params.data.assignmentId,
      now: serverNow,
    });
    if (result.state === 'not_found') {
      return reply.status(404).send({ code: 0, errorCode: 'assignment_not_found', msg: '配置不存在' });
    }
    if (result.state === 'gone') {
      return reply.status(410).send({
        code: 0,
        errorCode: 'assignment_revoked',
        reasonCode: result.reasonCode,
        msg: '配置授权已撤销',
      });
    }

    const checksum = z.string().regex(/^[a-f0-9]{64}$/i);
    const parsed = z.object({
      state: z.literal('allowed'),
      assignmentId: nonEmpty,
      scopeKey: nonEmpty,
      releaseId: nonEmpty,
      releaseSequence: z.number().int().positive(),
      contentChecksum: checksum,
      effectiveChecksum: checksum,
      minExtensionVersion: nonEmpty,
      validUntil: z.string().datetime(),
      staleUntil: z.string().datetime(),
      bundle: z.record(z.unknown()),
    }).strict().parse(result);
    const clientVersion = extensionVersionSchema.safeParse(
      request.headers['x-ss-erp-extension-version'],
    );
    if (!clientVersion.success
      || compareExtensionVersions(clientVersion.data, parsed.minExtensionVersion) < 0) {
      return reply.status(426).send({
        code: 0,
        errorCode: 'upgrade_required',
        msg: '扩展版本过低，请先更新',
        data: { minExtensionVersion: parsed.minExtensionVersion },
      });
    }
    const delivery = await options.repository.authorizeEffectiveReleaseDelivery({
      sessionId: device.sessionId,
      ownerUserId: device.ownerUserId,
      allowedShopIds: device.allowedShopIds || [],
      assignmentId: parsed.assignmentId,
      releaseId: parsed.releaseId,
      effectiveChecksum: parsed.effectiveChecksum,
      scopeKey: parsed.scopeKey,
      now: serverNow,
    });
    if (delivery.state === 'not_found') {
      return reply.status(404).send({
        code: 0,
        errorCode: 'assignment_not_found',
        msg: '配置不存在',
      });
    }
    if (delivery.state === 'gone') {
      return reply.status(410).send({
        code: 0,
        errorCode: 'assignment_revoked',
        reasonCode: delivery.reasonCode,
        msg: '配置授权已撤销',
      });
    }
    const authorizationValidUntil = z.string().datetime().parse(
      delivery.authorizationValidUntil,
    );
    const etag = buildLogisticsRuleEffectiveEtag({
      deploymentId: options.deploymentId,
      assignmentId: parsed.assignmentId,
      scopeKey: parsed.scopeKey,
      releaseSequence: parsed.releaseSequence,
      effectiveChecksum: parsed.effectiveChecksum,
      minExtensionVersion: parsed.minExtensionVersion,
    });
    reply.header('ETag', etag);
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Vary', 'Authorization');
    reply.header('X-SS-ERP-Server-Time', serverNow.toISOString());
    reply.header('X-SS-ERP-Authorization-Valid-Until', authorizationValidUntil);
    if (ifNoneMatchIncludes(request.headers['if-none-match'], etag)) {
      return reply.status(304).send();
    }
    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        deploymentId: options.deploymentId,
        assignmentId: parsed.assignmentId,
        releaseId: parsed.releaseId,
        releaseSequence: parsed.releaseSequence,
        contentChecksum: parsed.contentChecksum,
        effectiveChecksum: parsed.effectiveChecksum,
        minExtensionVersion: parsed.minExtensionVersion,
        validUntil: parsed.validUntil,
        staleUntil: parsed.staleUntil,
        authorizationValidUntil,
        serverTime: serverNow.toISOString(),
        bundle: parsed.bundle,
      },
    });
  });

  app.post('/assignments/:assignmentId/releases/:releaseId/receipts', {
    preHandler: [options.authenticateReceipt],
  }, async (request, reply) => {
    const params = z.object({ assignmentId: nonEmpty, releaseId: nonEmpty }).safeParse(request.params);
    const body = applyReceiptSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: '参数错误' });
    }
    const device = deviceContext(request);
    let result: { state: 'accepted'; receiptId: string; duplicate: boolean };
    try {
      result = await options.repository.recordApplyReceipt({
        sessionId: device.sessionId,
        ownerUserId: device.ownerUserId,
        allowedShopIds: device.allowedShopIds || [],
        assignmentId: params.data.assignmentId,
        releaseId: params.data.releaseId,
        idempotencyKey: body.data.idempotencyKey,
        effectiveChecksum: body.data.effectiveChecksum.toLowerCase(),
        status: body.data.status === 'applied' ? 'APPLIED' : 'FAILED',
        failureCode: body.data.status === 'failed' ? body.data.failureCode : null,
        extensionVersion: body.data.extensionVersion,
        appliedAt: body.data.status === 'applied' ? new Date(body.data.appliedAt) : null,
        now: now(),
      });
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'RECEIPT_CONFLICT') {
        return reply.status(409).send({
          code: 0,
          errorCode: 'receipt_conflict',
          msg: '应用回执与已有记录冲突',
        });
      }
      throw error;
    }
    return reply.status(result.duplicate ? 200 : 201).send({
      code: 1,
      msg: '应用回执已记录',
      data: { receiptId: result.receiptId, duplicate: result.duplicate },
    });
  });
}
