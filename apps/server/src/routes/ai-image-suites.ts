import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { getConfig } from '../config/system-config-schema.js';
import { PrismaAiImageSuiteRepository } from '../repositories/ai-image-suite-repository.js';
import {
  AiImageSuiteError,
  createAiImageSuiteService,
  type AiImageSuiteProviderConfig,
  type AiImageSuitePreview,
  type AiImageSuiteRecord,
  type AiImageSuiteService,
} from '../services/ai-image-suite.js';
import {
  AiImageSuiteReferenceError,
  type AiImageSuiteReferenceService,
} from '../services/ai-image-suite-references.js';
import {
  AI_IMAGE_SUITE_MODEL,
  AI_IMAGE_SUITE_PROVIDER,
  resolveAiImageProviderCapability,
} from '../services/ai-image-provider-capabilities.js';
import { getAiMediaRolloutDecision } from '../services/ai-media-rollout.js';
import {
  sourceWorkflowFeatureFlags,
  type SourceWorkflowFeatureFlagEvaluator,
} from '../services/source-workflow-feature-flags.js';
const previewSchema = z.object({
  planId: z.string().trim().min(1).max(200),
}).strict();

const claimSchema = z.object({
  planId: z.string().trim().min(1).max(200),
  expectedPlanRevision: z.number().int().min(1),
  expectedPreviewHash: z.string().trim().regex(/^[a-f0-9]{64}$/u),
  idempotencyKey: z.string().trim().min(8).max(128),
}).strict();

const internalizeReferencesSchema = z.object({
  expectedRevision: z.number().int().min(1),
  operationKey: z.string().trim().min(8).max(128),
}).strict();

const publicDiagnosticCode = /^[A-Z][A-Z0-9_]{0,99}$/u;
const maxPublicDiagnostics = 20;

export interface AiImageSuiteRouteOptions {
  service?: AiImageSuiteService;
  referenceService?: Pick<AiImageSuiteReferenceService, 'internalize'>;
  authenticate?: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  getSuiteEnabled?: (ownerUserId: string) => Promise<boolean>;
  getMediaWorkflowEnabled?: (ownerUserId: string) => Promise<boolean>;
  getSourceListingWebMediaEnabled?: (ownerUserId: string) => Promise<boolean>;
  sourceWorkflowFeatureFlags?: SourceWorkflowFeatureFlagEvaluator;
  getProviderConfig?: (ownerUserId: string) => Promise<AiImageSuiteProviderConfig>;
  production?: boolean;
}

function actor(request: FastifyRequest) {
  const auth = (request as any).user || {};
  return {
    ownerUserId: auth.effectiveUserId || auth.userId,
    actorUserId: auth.actorUserId || auth.userId,
  };
}

function providerFreeConfig(): AiImageSuiteProviderConfig {
  const provider = AI_IMAGE_SUITE_PROVIDER;
  const model = AI_IMAGE_SUITE_MODEL;
  const pricingVersion = 'provider-free-zero/v1';
  const providerConfigHash = createHash('sha256').update(JSON.stringify({
    version: 'ai-image-suite-runtime/v1',
    provider,
    model,
    pricingVersion,
    estimatedCostPerImageCents: 0,
    maximumCostPerImageCents: 0,
    concurrencyLimit: 2,
  })).digest('hex');
  return {
    provider,
    model,
    providerConfigHash,
    pricingVersion,
    estimatedCostPerImageCents: 0,
    maximumCostPerImageCents: 0,
    concurrencyLimit: 2,
  };
}

function publicPreview(preview: AiImageSuitePreview) {
  return {
    version: preview.version,
    planId: preview.planId,
    planVersionId: preview.planVersionId,
    planRevision: preview.planRevision,
    provider: preview.provider,
    model: preview.model,
    pricingVersion: preview.pricingVersion,
    concurrencyLimit: preview.concurrencyLimit,
    itemCount: preview.itemCount,
    estimatedCostCents: preview.estimatedCostCents,
    maximumCostCents: preview.maximumCostCents,
    previewHash: preview.previewHash,
    slots: preview.slots.map((slot) => ({
      ordinal: slot.ordinal,
      slotKey: slot.slotKey,
      goal: slot.goal,
      ownership: slot.ownership,
      compatibilityGroupKey: slot.compatibilityGroupKey,
      references: slot.references.map((reference) => ({
        candidateId: reference.candidateId,
        source: {
          width: reference.source.width,
          height: reference.source.height,
          mimeType: reference.source.mimeType,
          role: reference.source.role,
          skuKeys: reference.source.skuKeys,
        },
      })),
      estimatedCostCents: slot.estimatedCostCents,
      maximumCostCents: slot.maximumCostCents,
    })),
  };
}

function publicSuite(suite: AiImageSuiteRecord) {
  return {
    id: suite.id,
    planId: suite.planId,
    planVersionId: suite.planVersionId,
    status: suite.status,
    revision: suite.revision,
    previewHash: suite.previewHash,
    itemCount: suite.itemCount,
    estimatedCostCents: suite.estimatedCostCents,
    maximumCostCents: suite.maximumCostCents,
    createdAt: suite.createdAt,
    updatedAt: suite.updatedAt,
    slots: suite.slots.map((rawSlot) => {
      const slot = rawSlot as Record<string, unknown>;
      const references = Array.isArray(slot.referencesSnapshot)
        ? slot.referencesSnapshot.flatMap((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
          const candidateId = (entry as Record<string, unknown>).candidateId;
          return typeof candidateId === 'string' && candidateId.trim()
            ? [candidateId]
            : [];
        })
        : [];
      const diagnostics = Array.isArray(slot.diagnostics)
        ? [...new Set(slot.diagnostics.flatMap((entry) => (
          typeof entry === 'string' && publicDiagnosticCode.test(entry) ? [entry] : []
        )))].slice(0, maxPublicDiagnostics)
        : [];
      const errorCode = typeof slot.errorCode === 'string' && publicDiagnosticCode.test(slot.errorCode)
        ? slot.errorCode
        : null;
      return {
        id: typeof slot.id === 'string' ? slot.id : null,
        ordinal: typeof slot.ordinal === 'number' ? slot.ordinal : null,
        slotKey: typeof slot.slotKey === 'string' ? slot.slotKey : null,
        goal: typeof slot.goal === 'string' ? slot.goal : null,
        ownership: {
          level: typeof slot.ownershipLevel === 'string' ? slot.ownershipLevel : null,
          key: typeof slot.ownershipKey === 'string' ? slot.ownershipKey : null,
        },
        compatibilityGroupKey: typeof slot.compatibilityGroupKey === 'string'
          ? slot.compatibilityGroupKey
          : null,
        status: typeof slot.status === 'string' ? slot.status : null,
        attempt: typeof slot.attempt === 'number' ? slot.attempt : null,
        childWorkflowId: typeof slot.childWorkflowId === 'string' ? slot.childWorkflowId : null,
        referenceCandidateIds: [...new Set(references)],
        diagnostics,
        estimatedCostCents: typeof slot.estimatedCostCents === 'number'
          ? slot.estimatedCostCents
          : null,
        maximumCostCents: typeof slot.maximumCostCents === 'number'
          ? slot.maximumCostCents
          : null,
        errorCode,
      };
    }),
  };
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AiImageSuiteError || error instanceof AiImageSuiteReferenceError) {
    return reply.status(error.statusCode).send({ code: error.code, msg: error.message });
  }
  throw error;
}

type GateFailure = { statusCode: 503; code: string; msg: string };

async function writeGate(
  ownerUserId: string,
  options: AiImageSuiteRouteOptions,
): Promise<GateFailure | null> {
  let suiteEnabled = false;
  try {
    suiteEnabled = await (options.getSuiteEnabled || (async () => getConfig('feature_ai_media_suite')))(ownerUserId);
  } catch {
    suiteEnabled = false;
  }
  if (!suiteEnabled) {
    return {
      statusCode: 503,
      code: 'AI_MEDIA_SUITE_DISABLED',
      msg: 'AI image suite generation is disabled',
    };
  }

  let workflowEnabled = false;
  try {
    workflowEnabled = await (options.getMediaWorkflowEnabled
      || (async (ownerId: string) => (await getAiMediaRolloutDecision(ownerId)).enabled))(ownerUserId);
  } catch {
    workflowEnabled = false;
  }
  if (!workflowEnabled) {
    return {
      statusCode: 503,
      code: 'AI_MEDIA_WORKFLOW_DISABLED',
      msg: 'AI media workflow is disabled',
    };
  }

  let webMediaEnabled = false;
  try {
    if (options.getSourceListingWebMediaEnabled) {
      webMediaEnabled = await options.getSourceListingWebMediaEnabled(ownerUserId);
    } else {
      const evaluator = options.sourceWorkflowFeatureFlags || sourceWorkflowFeatureFlags;
      webMediaEnabled = (await evaluator.evaluate('SOURCE_LISTING_WEB_MEDIA', { ownerUserId })).enabled;
    }
  } catch {
    webMediaEnabled = false;
  }
  if (!webMediaEnabled) {
    return {
      statusCode: 503,
      code: 'SOURCE_LISTING_WEB_MEDIA_DISABLED',
      msg: 'Web AI media tools are not enabled for this account',
    };
  }
  return null;
}

export async function aiImageSuiteRoutes(
  app: FastifyInstance,
  options: AiImageSuiteRouteOptions = {},
) {
  const service = options.service || createAiImageSuiteService(
    new PrismaAiImageSuiteRepository(prisma),
  );
  const authHook = options.authenticate || authenticate;
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const getProviderConfig = options.getProviderConfig || (async () => providerFreeConfig());

  app.addHook('preHandler', authHook as any);

  app.post('/suites/preview', async (request, reply) => {
    const parsed = previewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const ids = actor(request);
    const gate = await writeGate(ids.ownerUserId, options);
    if (gate) return reply.status(gate.statusCode).send({ code: gate.code, msg: gate.msg });
    try {
      const providerConfig = await getProviderConfig(ids.ownerUserId);
      const preview = await service.preview({ ...ids, planId: parsed.data.planId, providerConfig });
      return { code: 1, data: publicPreview(preview) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/suites/claim', async (request, reply) => {
    const parsed = claimSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const ids = actor(request);
    const gate = await writeGate(ids.ownerUserId, options);
    if (gate) return reply.status(gate.statusCode).send({ code: gate.code, msg: gate.msg });
    try {
      const providerConfig = await getProviderConfig(ids.ownerUserId);
      const capability = resolveAiImageProviderCapability(
        providerConfig.provider,
        providerConfig.model,
      );
      if (production && capability?.evidenceLevel !== 'sandbox-verified') {
        return reply.status(503).send({
          code: 'AI_MEDIA_SUITE_PROVIDER_NOT_READY',
          msg: 'The AI image suite provider is not sandbox verified',
        });
      }
      const result = await service.claim({
        ...ids,
        ...parsed.data,
        providerConfig,
      });
      return reply.status(result.replayed ? 200 : 202).send({
        code: 1,
        data: publicSuite(result.suite),
        replayed: result.replayed,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/suites/:id/references/internalize', async (request, reply) => {
    const suiteId = String((request.params as { id?: unknown }).id || '').trim();
    if (!suiteId || suiteId.length > 200) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: 'suite id is invalid' });
    }
    const parsed = internalizeReferencesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const ids = actor(request);
    const gate = await writeGate(ids.ownerUserId, options);
    if (gate) return reply.status(gate.statusCode).send({ code: gate.code, msg: gate.msg });
    if (!options.referenceService) {
      return reply.status(503).send({
        code: 'AI_MEDIA_SUITE_REFERENCE_SERVICE_NOT_READY',
        msg: 'AI image suite reference preparation is not available',
      });
    }
    try {
      const result = await options.referenceService.internalize({
        suiteId,
        ...ids,
        ...parsed.data,
      });
      return reply.send({
        code: 1,
        data: {
          suiteId: result.suiteId,
          referenceCount: result.referenceCount,
          referenceSetHash: result.referenceSetHash,
        },
        replayed: result.replayed,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/suites/:id', async (request, reply) => {
    const id = String((request.params as { id?: unknown }).id || '').trim();
    if (!id || id.length > 200) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: 'suite id is invalid' });
    }
    try {
      const suite = await service.get(id, actor(request).ownerUserId);
      return { code: 1, data: publicSuite(suite) };
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
