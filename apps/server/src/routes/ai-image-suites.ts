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
  normalizeAiImageSuiteProviderConfig,
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
  AiImageSuitePromptError,
  type AiImageSuitePromptService,
} from '../services/ai-image-suite-prompts.js';
import {
  AiImageSuiteMaterializationError,
  type AiImageSuiteMaterializationService,
} from '../services/ai-image-suite-materialization.js';
import {
  AiImageSuiteExecutionError,
  type AiImageSuiteExecutionService,
  type AiImageSuiteExecutionSummary,
} from '../services/ai-image-suite-execution.js';
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

const currentSuiteSchema = z.object({
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

const freezePromptsSchema = z.object({
  expectedRevision: z.literal(2),
  operationKey: z.string().trim().min(8).max(128),
}).strict();

const materializeChildrenSchema = z.object({
  expectedRevision: z.literal(3),
  operationKey: z.string().trim().min(8).max(128),
}).strict();

const dispatchSchema = z.object({
  expectedRevision: z.literal(4),
  operationKey: z.string().trim().min(8).max(128),
}).strict();

const cancelSchema = z.object({
  expectedRevision: z.number().int().min(4),
  operationKey: z.string().trim().min(8).max(128),
}).strict();

const retrySlotSchema = z.object({
  expectedSlotRevision: z.number().int().min(2),
  operationKey: z.string().trim().min(8).max(128),
}).strict();

const prepareSchema = z.object({
  operationKey: z.string().trim().min(8).max(128),
}).strict();

const publicDiagnosticCode = /^[A-Z][A-Z0-9_]{0,99}$/u;
const maxPublicDiagnostics = 20;

export interface AiImageSuiteRouteOptions {
  service?: AiImageSuiteService;
  referenceService?: Pick<AiImageSuiteReferenceService, 'internalize'>;
  promptService?: Pick<AiImageSuitePromptService, 'freeze'>;
  materializationService?: Pick<AiImageSuiteMaterializationService, 'materialize'>;
  executionService?: Pick<
    AiImageSuiteExecutionService,
    'dispatch' | 'cancel' | 'retryFailedSlot'
  >;
  enqueueSuiteFrontier?: (suiteId: string) => Promise<void>;
  authenticate?: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  getSuiteEnabled?: (ownerUserId: string) => Promise<boolean>;
  getMediaWorkflowEnabled?: (ownerUserId: string) => Promise<boolean>;
  getSourceListingWebMediaEnabled?: (ownerUserId: string) => Promise<boolean>;
  sourceWorkflowFeatureFlags?: SourceWorkflowFeatureFlagEvaluator;
  getProviderConfig?: (ownerUserId: string) => Promise<AiImageSuiteProviderConfig>;
  getSuiteRuntimeReadiness?: (
    ownerUserId: string,
    providerConfig: AiImageSuiteProviderConfig,
  ) => Promise<{ queueReady: boolean; runtimeReady: boolean }>;
  getReferenceStorageReadiness?: (
    ownerUserId: string,
    providerConfig: AiImageSuiteProviderConfig,
  ) => Promise<{
    ready: boolean;
    backend: 'local' | 'oss' | 'ozon-cdn' | null;
    publicHttps: boolean;
    reason: string;
  }>;
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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function publicSlotOutputAssets(slot: Record<string, unknown>, ownerUserId: string) {
  const workflow = record(slot.childWorkflow);
  const currentJob = Array.isArray(workflow?.jobs) ? record(workflow.jobs[0]) : null;
  if (!Array.isArray(currentJob?.assets)) return [];
  return currentJob.assets.slice(0, 1).flatMap((entry) => {
    const asset = record(entry);
    if (!asset) return [];
    const id = typeof asset?.id === 'string' ? asset.id.trim() : '';
    const assetOwnerUserId = typeof asset.ownerUserId === 'string' ? asset.ownerUserId : '';
    const url = typeof asset?.url === 'string' ? asset.url.trim() : '';
    if (assetOwnerUserId !== ownerUserId
      || !id || id.length > 200 || !url || url.length > 4_096) return [];
    return [{
      id,
      url,
      mimeType: typeof asset.mimeType === 'string' && asset.mimeType.length <= 100
        ? asset.mimeType
        : null,
      width: Number.isSafeInteger(asset.width) && Number(asset.width) > 0 ? Number(asset.width) : null,
      height: Number.isSafeInteger(asset.height) && Number(asset.height) > 0 ? Number(asset.height) : null,
    }];
  });
}

function publicSuite(
  suite: AiImageSuiteRecord,
  options: { includePreviewHash?: boolean } = {},
) {
  const counts = {
    planned: 0,
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelRequested: 0,
    cancelled: 0,
  };
  for (const rawSlot of suite.slots) {
    if (rawSlot.status === 'PLANNED') counts.planned += 1;
    else if (rawSlot.status === 'QUEUED') counts.queued += 1;
    else if (rawSlot.status === 'RUNNING') counts.running += 1;
    else if (rawSlot.status === 'SUCCEEDED') counts.succeeded += 1;
    else if (rawSlot.status === 'FAILED') counts.failed += 1;
    else if (rawSlot.status === 'CANCEL_REQUESTED') counts.cancelRequested += 1;
    else if (rawSlot.status === 'CANCELLED') counts.cancelled += 1;
  }
  return {
    id: suite.id,
    planId: suite.planId,
    planVersionId: suite.planVersionId,
    status: suite.status,
    revision: suite.revision,
    ...(options.includePreviewHash === false ? {} : { previewHash: suite.previewHash }),
    provider: suite.provider,
    model: suite.model,
    pricingVersion: suite.pricingVersion,
    itemCount: suite.itemCount,
    estimatedCostCents: suite.estimatedCostCents,
    maximumCostCents: suite.maximumCostCents,
    concurrencyLimit: suite.concurrencyLimit ?? null,
    cancelRequestedAt: suite.cancelRequestedAt || null,
    completedAt: suite.completedAt || null,
    counts,
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
        revision: typeof slot.revision === 'number' ? slot.revision : null,
        childWorkflowId: typeof slot.childWorkflowId === 'string' ? slot.childWorkflowId : null,
        outputAssets: publicSlotOutputAssets(slot, suite.ownerUserId),
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

function publicExecutionSummary(summary: AiImageSuiteExecutionSummary) {
  return {
    suiteId: summary.suiteId,
    revision: summary.revision,
    status: summary.status,
    itemCount: summary.itemCount,
    concurrencyLimit: summary.concurrencyLimit,
    counts: {
      planned: summary.counts.planned,
      queued: summary.counts.queued,
      running: summary.counts.running,
      succeeded: summary.counts.succeeded,
      failed: summary.counts.failed,
      cancelRequested: summary.counts.cancelRequested,
      cancelled: summary.counts.cancelled,
    },
    slots: summary.slots.map((slot) => ({
      slotId: slot.slotId,
      ordinal: slot.ordinal,
      slotKey: slot.slotKey,
      status: slot.status,
      attempt: slot.attempt,
      revision: slot.revision,
      childWorkflowId: slot.childWorkflowId,
      errorCode: slot.error && publicDiagnosticCode.test(slot.error.code)
        ? slot.error.code
        : null,
    })),
  };
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AiImageSuiteError
    || error instanceof AiImageSuiteReferenceError
    || error instanceof AiImageSuitePromptError
    || error instanceof AiImageSuiteMaterializationError
    || error instanceof AiImageSuiteExecutionError) {
    return reply.status(error.statusCode).send({ code: error.code, msg: error.message });
  }
  throw error;
}

type GateFailure = { statusCode: 503; code: string; msg: string };

interface SuiteFeatureState {
  suiteEnabled: boolean;
  workflowEnabled: boolean;
  webMediaEnabled: boolean;
}

async function readFeatureState(
  ownerUserId: string,
  options: AiImageSuiteRouteOptions,
): Promise<SuiteFeatureState> {
  let suiteEnabled = false;
  try {
    suiteEnabled = await (options.getSuiteEnabled || (async () => getConfig('feature_ai_media_suite')))(ownerUserId);
  } catch {
    suiteEnabled = false;
  }

  let workflowEnabled = false;
  try {
    workflowEnabled = await (options.getMediaWorkflowEnabled
      || (async (ownerId: string) => (await getAiMediaRolloutDecision(ownerId)).enabled))(ownerUserId);
  } catch {
    workflowEnabled = false;
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

  return { suiteEnabled, workflowEnabled, webMediaEnabled };
}

async function writeGate(
  ownerUserId: string,
  options: AiImageSuiteRouteOptions,
): Promise<GateFailure | null> {
  const { suiteEnabled, workflowEnabled, webMediaEnabled } = await readFeatureState(ownerUserId, options);
  if (!suiteEnabled) {
    return {
      statusCode: 503,
      code: 'AI_MEDIA_SUITE_DISABLED',
      msg: 'AI image suite generation is disabled',
    };
  }

  if (!workflowEnabled) {
    return {
      statusCode: 503,
      code: 'AI_MEDIA_WORKFLOW_DISABLED',
      msg: 'AI media workflow is disabled',
    };
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

function preparationOperationKey(
  suiteId: string,
  operationKey: string,
  stage: 'references' | 'prompts' | 'children',
) {
  const digest = createHash('sha256').update(JSON.stringify({
    version: 'ai-image-suite-prepare/v1',
    suiteId,
    operationKey,
    stage,
  })).digest('hex');
  return `suite-prepare-${stage}-${digest}`;
}

function isPreparationAdvanceConflict(error: unknown, expectedRevision: 1 | 2 | 3): boolean {
  if (expectedRevision === 1 && error instanceof AiImageSuiteReferenceError) {
    return error.code === 'AI_MEDIA_SUITE_REFERENCE_ALREADY_INTERNALIZED'
      || error.code === 'AI_MEDIA_SUITE_REFERENCE_COMMIT_CONFLICT';
  }
  if (expectedRevision === 2 && error instanceof AiImageSuitePromptError) {
    return error.code === 'AI_MEDIA_SUITE_PROMPTS_ALREADY_FROZEN'
      || error.code === 'AI_MEDIA_SUITE_PROMPT_COMMIT_CONFLICT';
  }
  if (expectedRevision === 3 && error instanceof AiImageSuiteMaterializationError) {
    return error.code === 'AI_MEDIA_SUITE_CHILDREN_ALREADY_MATERIALIZED'
      || error.code === 'AI_MEDIA_SUITE_MATERIALIZATION_CONFLICT';
  }
  return false;
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
  const getOperationalReadiness = async (
    ownerUserId: string,
    providerConfig: AiImageSuiteProviderConfig,
  ) => {
    let runtime = { queueReady: false, runtimeReady: false };
    let storage: {
      ready: boolean;
      backend: 'local' | 'oss' | 'ozon-cdn' | null;
      publicHttps: boolean;
      reason: string;
    } = {
      ready: false,
      backend: null,
      publicHttps: false,
      reason: 'AI image suite reference storage readiness is not installed',
    };
    if (options.getSuiteRuntimeReadiness) {
      try {
        const value = await options.getSuiteRuntimeReadiness(ownerUserId, providerConfig);
        runtime = {
          queueReady: value.queueReady === true,
          runtimeReady: value.runtimeReady === true,
        };
      } catch {
        runtime = { queueReady: false, runtimeReady: false };
      }
    }
    if (options.getReferenceStorageReadiness) {
      try {
        const value = await options.getReferenceStorageReadiness(ownerUserId, providerConfig);
        storage = {
          ready: value.ready === true,
          backend: ['local', 'oss', 'ozon-cdn'].includes(String(value.backend))
            ? value.backend
            : null,
          publicHttps: value.publicHttps === true,
          reason: String(value.reason || 'AI image suite reference storage is not ready').slice(0, 500),
        };
      } catch {
        storage = {
          ready: false,
          backend: null,
          publicHttps: false,
          reason: 'AI image suite reference storage readiness is unavailable',
        };
      }
    }
    return { ...runtime, storage };
  };

  app.addHook('preHandler', authHook as any);

  app.get('/suites/readiness', async (request) => {
    const ids = actor(request);
    const features = await readFeatureState(ids.ownerUserId, options);
    const installedServices = {
      references: Boolean(options.referenceService),
      prompts: Boolean(options.promptService),
      materialization: Boolean(options.materializationService),
      execution: Boolean(options.executionService),
    };
    let providerConfig: AiImageSuiteProviderConfig | null = null;
    try {
      providerConfig = normalizeAiImageSuiteProviderConfig(
        await getProviderConfig(ids.ownerUserId),
      );
    } catch {
      providerConfig = null;
    }
    const providerName = typeof providerConfig?.provider === 'string'
      ? providerConfig.provider.trim()
      : '';
    const providerModel = typeof providerConfig?.model === 'string'
      ? providerConfig.model.trim()
      : '';
    const capability = providerName && providerModel
      ? resolveAiImageProviderCapability(providerName, providerModel)
      : null;
    const providerConfigReady = Boolean(
      providerConfig
      && capability?.operations.includes('IMAGE_TO_IMAGE')
    );
    const testOnly = Boolean(capability && capability.evidenceLevel !== 'sandbox-verified');
    const providerReady = providerConfigReady && (!production || !testOnly);
    const operational = providerConfig
      ? await getOperationalReadiness(ids.ownerUserId, providerConfig)
      : {
        queueReady: false,
        runtimeReady: false,
        storage: {
          ready: false,
          backend: null,
          publicHttps: false,
          reason: 'AI image suite reference storage is not ready',
        },
      };
    const services = {
      ...installedServices,
      queue: Boolean(options.enqueueSuiteFrontier) && operational.queueReady,
      runtime: operational.runtimeReady,
    };
    const installedServicesReady = Object.values(installedServices).every(Boolean);

    let reasonCode = 'READY';
    let reason = 'AI image suite generation is ready';
    if (!features.suiteEnabled) {
      reasonCode = 'AI_MEDIA_SUITE_DISABLED';
      reason = 'AI image suite generation is disabled';
    } else if (!features.workflowEnabled) {
      reasonCode = 'AI_MEDIA_WORKFLOW_DISABLED';
      reason = 'AI media workflow is disabled';
    } else if (!features.webMediaEnabled) {
      reasonCode = 'SOURCE_LISTING_WEB_MEDIA_DISABLED';
      reason = 'Web AI media tools are not enabled for this account';
    } else if (!installedServicesReady) {
      reasonCode = 'AI_MEDIA_SUITE_SERVICE_NOT_READY';
      reason = 'AI image suite services are not fully installed';
    } else if (!providerReady) {
      reasonCode = 'AI_MEDIA_SUITE_PROVIDER_NOT_READY';
      reason = production && testOnly
        ? 'The AI image suite provider is not sandbox verified'
        : 'The AI image suite provider configuration is not ready';
    } else if (!operational.storage.ready) {
      reasonCode = 'AI_MEDIA_SUITE_REFERENCE_STORAGE_NOT_READY';
      reason = operational.storage.reason;
    } else if (!services.queue) {
      reasonCode = 'AI_MEDIA_SUITE_QUEUE_NOT_READY';
      reason = 'AI image suite generation queue is not available';
    } else if (!operational.runtimeReady) {
      reasonCode = 'AI_MEDIA_SUITE_RUNTIME_NOT_READY';
      reason = 'AI image suite generation runtime is not available';
    }

    return {
      code: 1,
      data: {
        ...features,
        provider: {
          provider: providerName || null,
          model: providerModel || null,
          evidenceLevel: capability?.evidenceLevel || null,
          ready: providerReady,
        },
        services,
        storage: {
          ready: operational.storage.ready,
          backend: operational.storage.backend,
          publicHttps: operational.storage.publicHttps,
        },
        ready: features.suiteEnabled
          && features.workflowEnabled
          && features.webMediaEnabled
          && installedServicesReady
          && providerReady
          && operational.storage.ready
          && services.queue
          && operational.runtimeReady,
        testOnly,
        reasonCode,
        reason,
      },
    };
  });

  app.get('/suites/current', async (request, reply) => {
    const parsed = currentSuiteSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    try {
      const suite = await service.getCurrentByPlan(parsed.data.planId, actor(request).ownerUserId);
      return { code: 1, data: suite ? publicSuite(suite, { includePreviewHash: false }) : null };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/suites/active', async (request, reply) => {
    const parsed = currentSuiteSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    try {
      const suite = await service.getActiveByPlan(parsed.data.planId, actor(request).ownerUserId);
      return { code: 1, data: suite ? publicSuite(suite, { includePreviewHash: false }) : null };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/suites/preview', async (request, reply) => {
    const parsed = previewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const ids = actor(request);
    const gate = await writeGate(ids.ownerUserId, options);
    if (gate) return reply.status(gate.statusCode).send({ code: gate.code, msg: gate.msg });
    try {
      const providerConfig = normalizeAiImageSuiteProviderConfig(
        await getProviderConfig(ids.ownerUserId),
      );
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
      const providerConfig = normalizeAiImageSuiteProviderConfig(
        await getProviderConfig(ids.ownerUserId),
      );
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
      const storageReadiness = (await getOperationalReadiness(ids.ownerUserId, providerConfig)).storage;
      if (!storageReadiness.ready) {
        return reply.status(503).send({
          code: 'AI_MEDIA_SUITE_REFERENCE_STORAGE_NOT_READY',
          msg: storageReadiness.reason,
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

  app.post('/suites/:id/prepare', async (request, reply) => {
    const suiteId = String((request.params as { id?: unknown }).id || '').trim();
    if (!suiteId || suiteId.length > 200) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: 'suite id is invalid' });
    }
    const parsed = prepareSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const ids = actor(request);
    const gate = await writeGate(ids.ownerUserId, options);
    if (gate) return reply.status(gate.statusCode).send({ code: gate.code, msg: gate.msg });
    try {
      let suite = await service.get(suiteId, ids.ownerUserId);
      const replayed = suite.revision >= 4;
      const referenceService = options.referenceService;
      const promptService = options.promptService;
      const materializationService = options.materializationService;
      if (suite.revision <= 1 && !referenceService) {
        return reply.status(503).send({
          code: 'AI_MEDIA_SUITE_REFERENCE_SERVICE_NOT_READY',
          msg: 'AI image suite reference preparation is not available',
        });
      }
      if (suite.revision <= 2 && !promptService) {
        return reply.status(503).send({
          code: 'AI_MEDIA_SUITE_PROMPT_SERVICE_NOT_READY',
          msg: 'AI image suite Prompt preparation is not available',
        });
      }
      if (suite.revision <= 3 && !materializationService) {
        return reply.status(503).send({
          code: 'AI_MEDIA_SUITE_MATERIALIZATION_SERVICE_NOT_READY',
          msg: 'AI image suite child materialization is not available',
        });
      }
      const advance = async (
        expectedRevision: 1 | 2 | 3,
        action: () => Promise<unknown>,
      ) => {
        try {
          await action();
        } catch (error) {
          if (!isPreparationAdvanceConflict(error, expectedRevision)) throw error;
          const refreshed = await service.get(suiteId, ids.ownerUserId);
          if (refreshed.revision <= expectedRevision) throw error;
          return refreshed;
        }
        return service.get(suiteId, ids.ownerUserId);
      };
      if (suite.revision === 1) {
        suite = await advance(1, () => referenceService!.internalize({
          suiteId,
          ...ids,
          expectedRevision: 1,
          operationKey: preparationOperationKey(suiteId, parsed.data.operationKey, 'references'),
        }));
      }
      if (suite.revision === 2) {
        suite = await advance(2, () => promptService!.freeze({
          suiteId,
          ...ids,
          expectedRevision: 2,
          operationKey: preparationOperationKey(suiteId, parsed.data.operationKey, 'prompts'),
        }));
      }
      if (suite.revision === 3) {
        suite = await advance(3, () => materializationService!.materialize({
          suiteId,
          ...ids,
          expectedRevision: 3,
          operationKey: preparationOperationKey(suiteId, parsed.data.operationKey, 'children'),
        }));
      }
      if (suite.revision < 4) {
        throw new AiImageSuiteError(
          'AI_MEDIA_SUITE_NOT_READY',
          'AI media suite could not reach the materialized preparation barrier',
          409,
        );
      }
      return reply.status(replayed ? 200 : 202).send({
        code: 1,
        data: publicSuite(suite, { includePreviewHash: false }),
        replayed,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/suites/:id/prompts/freeze', async (request, reply) => {
    const suiteId = String((request.params as { id?: unknown }).id || '').trim();
    if (!suiteId || suiteId.length > 200) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: 'suite id is invalid' });
    }
    const parsed = freezePromptsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const ids = actor(request);
    const gate = await writeGate(ids.ownerUserId, options);
    if (gate) return reply.status(gate.statusCode).send({ code: gate.code, msg: gate.msg });
    if (!options.promptService) {
      return reply.status(503).send({
        code: 'AI_MEDIA_SUITE_PROMPT_SERVICE_NOT_READY',
        msg: 'AI image suite Prompt preparation is not available',
      });
    }
    try {
      const result = await options.promptService.freeze({
        suiteId,
        ...ids,
        ...parsed.data,
      });
      return reply.status(result.replayed ? 200 : 202).send({
        code: 1,
        data: {
          suiteId: result.suiteId,
          promptSetHash: result.promptSetHash,
          promptCount: result.promptCount,
          templateKey: result.templateKey,
          templateReleaseId: result.templateReleaseId,
          templateSequence: result.templateSequence,
          templateChecksum: result.templateChecksum,
        },
        replayed: result.replayed,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/suites/:id/children/materialize', async (request, reply) => {
    const suiteId = String((request.params as { id?: unknown }).id || '').trim();
    if (!suiteId || suiteId.length > 200) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: 'suite id is invalid' });
    }
    const parsed = materializeChildrenSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const ids = actor(request);
    const gate = await writeGate(ids.ownerUserId, options);
    if (gate) return reply.status(gate.statusCode).send({ code: gate.code, msg: gate.msg });
    if (!options.materializationService) {
      return reply.status(503).send({
        code: 'AI_MEDIA_SUITE_MATERIALIZATION_SERVICE_NOT_READY',
        msg: 'AI image suite child materialization is not available',
      });
    }
    try {
      const result = await options.materializationService.materialize({
        suiteId,
        ...ids,
        ...parsed.data,
      });
      return reply.status(result.replayed ? 200 : 202).send({
        code: 1,
        data: {
          suiteId: result.suiteId,
          revision: result.revision,
          status: result.status,
          childCount: result.childCount,
          estimatedCostCents: result.estimatedCostCents,
          maximumCostCents: result.maximumCostCents,
          materializationHash: result.materializationHash,
          children: result.children,
        },
        replayed: result.replayed,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/suites/:id/dispatch', async (request, reply) => {
    const suiteId = String((request.params as { id?: unknown }).id || '').trim();
    if (!suiteId || suiteId.length > 200) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: 'suite id is invalid' });
    }
    const parsed = dispatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const ids = actor(request);
    const gate = await writeGate(ids.ownerUserId, options);
    if (gate) return reply.status(gate.statusCode).send({ code: gate.code, msg: gate.msg });
    if (!options.executionService) {
      return reply.status(503).send({
        code: 'AI_MEDIA_SUITE_EXECUTION_SERVICE_NOT_READY',
        msg: 'AI image suite execution is not available',
      });
    }
    if (!options.enqueueSuiteFrontier) {
      return reply.status(503).send({
        code: 'AI_MEDIA_SUITE_QUEUE_NOT_READY',
        msg: 'AI image suite generation queue is not available',
      });
    }
    try {
      const result = await options.executionService.dispatch({
        suiteId,
        ...ids,
        ...parsed.data,
      });
      let enqueuePending = false;
      try {
        await options.enqueueSuiteFrontier(suiteId);
      } catch {
        enqueuePending = true;
        request.log.error({ suiteId }, 'AI image suite frontier enqueue deferred to recovery');
      }
      return reply.status(result.replayed && !enqueuePending ? 200 : 202).send({
        code: 1,
        data: publicExecutionSummary(result),
        replayed: result.replayed,
        enqueuePending,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/suites/:id/cancel', async (request, reply) => {
    const suiteId = String((request.params as { id?: unknown }).id || '').trim();
    if (!suiteId || suiteId.length > 200) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: 'suite id is invalid' });
    }
    const parsed = cancelSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const ids = actor(request);
    if (!options.executionService) {
      return reply.status(503).send({
        code: 'AI_MEDIA_SUITE_EXECUTION_SERVICE_NOT_READY',
        msg: 'AI image suite execution is not available',
      });
    }
    if (!options.enqueueSuiteFrontier) {
      return reply.status(503).send({
        code: 'AI_MEDIA_SUITE_QUEUE_NOT_READY',
        msg: 'AI image suite generation queue is not available',
      });
    }
    try {
      const result = await options.executionService.cancel({
        suiteId,
        ...ids,
        ...parsed.data,
      });
      let enqueuePending = false;
      try {
        await options.enqueueSuiteFrontier(suiteId);
      } catch {
        enqueuePending = true;
        request.log.error({ suiteId }, 'AI image suite cancellation enqueue deferred to recovery');
      }
      return reply.status(result.replayed && !enqueuePending ? 200 : 202).send({
        code: 1,
        data: publicExecutionSummary(result),
        replayed: result.replayed,
        enqueuePending,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/suites/:id/slots/:slotId/retry', async (request, reply) => {
    const params = request.params as { id?: unknown; slotId?: unknown };
    const suiteId = String(params.id || '').trim();
    const slotId = String(params.slotId || '').trim();
    if (!suiteId || suiteId.length > 200 || !slotId || slotId.length > 200) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: 'suite or slot id is invalid' });
    }
    const parsed = retrySlotSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const ids = actor(request);
    const gate = await writeGate(ids.ownerUserId, options);
    if (gate) return reply.status(gate.statusCode).send({ code: gate.code, msg: gate.msg });
    if (!options.executionService) {
      return reply.status(503).send({
        code: 'AI_MEDIA_SUITE_EXECUTION_SERVICE_NOT_READY',
        msg: 'AI image suite execution is not available',
      });
    }
    if (!options.enqueueSuiteFrontier) {
      return reply.status(503).send({
        code: 'AI_MEDIA_SUITE_QUEUE_NOT_READY',
        msg: 'AI image suite generation queue is not available',
      });
    }
    try {
      const result = await options.executionService.retryFailedSlot({
        suiteId,
        slotId,
        ...ids,
        ...parsed.data,
      });
      let enqueuePending = false;
      try {
        await options.enqueueSuiteFrontier(suiteId);
      } catch {
        enqueuePending = true;
        request.log.error({ suiteId }, 'AI image suite frontier enqueue deferred to recovery');
      }
      return reply.status(result.replayed && !enqueuePending ? 200 : 202).send({
        code: 1,
        data: publicExecutionSummary(result),
        replayed: result.replayed,
        enqueuePending,
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
      return { code: 1, data: publicSuite(suite, { includePreviewHash: false }) };
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
