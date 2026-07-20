import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { getConfig } from '../config/system-config-schema.js';
import { uploadLimiter } from '../lib/upload-limiter.js';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import { PrismaAiMediaWorkflowRepository } from '../repositories/ai-media-workflow-repository.js';
import { AiImageJobError, createAiImageJob, type AiImageJobRepository } from '../services/ai-image-jobs.js';
import {
  AiMediaWorkflowError,
  createAiMediaWorkflowService,
  type AiMediaWorkflowService,
} from '../services/ai-media-workflows.js';
import {
  AiMediaContextError,
  createAiMediaContextService,
  type AiMediaContextService,
} from '../services/ai-media-context.js';
import {
  AiImageApplicationError,
  applyAiImageAssets,
  type ApplyAiImageAssetsInput,
  type ApplyAiImageAssetsResult,
} from '../services/ai-image-application.js';
import { getAiMediaRolloutDecision } from '../services/ai-media-rollout.js';
import {
  sourceWorkflowFeatureFlags,
  type SourceWorkflowFeatureFlagEvaluator,
} from '../services/source-workflow-feature-flags.js';
import { getRuntimeConfigForStorage } from '../adapters/runtime-config.js';
import { getStorageBackend } from '../services/image-storage.js';
import {
  resolveAiImageTranslationStorageReadiness,
  type AiImageTranslationStorageReadiness,
} from '../services/ai-image-translation-storage.js';
import {
  resolveAiImageEditStorageReadiness,
  type AiImageEditStorageReadiness,
} from '../services/ai-image-edit-storage.js';
import { resolveAiImageProviderCapability } from '../services/ai-image-provider-capabilities.js';
import {
  AI_MEDIA_FULL_EDIT_TEMPLATE_KEY,
  AI_MEDIA_INPAINT_TEMPLATE_KEY,
  AI_MEDIA_TRANSLATION_TEMPLATE_KEY,
  resolveActiveAiPrompt,
  resolveActiveAiTemplate,
} from '../services/ai-prompt-template-registry.js';
import { AiPromptTemplateError } from '../services/ai-prompt-templates.js';
import { AI_IMAGE_EDIT_MASK_SEMANTICS } from '../services/ai-image-compositor.js';
import { createAiImageEditMask } from '../services/ai-image-edit.js';
import { isAiMediaEditReadyCandidateAsset } from '../services/ai-image-edit-source.js';

const createSchema = z.object({
  prompt: z.string().trim().min(1).max(8000),
  negativePrompt: z.string().trim().max(4000).nullable().optional(),
  count: z.number().int().min(1).max(4).default(1),
  width: z.number().int().min(256).max(4096).default(1024),
  height: z.number().int().min(256).max(4096).default(1024),
  idempotencyKey: z.string().trim().min(8).max(128).nullable().optional(),
});
const applySchema = z.object({
  mode: z.enum(['append', 'replace']),
  targetType: z.enum(['collect', 'product']),
  targetId: z.string().trim().min(1).max(128),
  expectedTargetUpdatedAt: z.string().datetime().nullable().optional(),
});
const workflowContextSchema = z.object({
  type: z.literal('collect'),
  id: z.string().trim().min(1).max(200),
  skuKey: z.string().trim().min(1).max(500).nullable().optional(),
  slotKey: z.string().trim().min(1).max(200).nullable().optional(),
});
const imageToImageWorkflowSchema = z.object({
  operation: z.literal('IMAGE_TO_IMAGE'),
  sourceAssetId: z.string().trim().min(1).max(128).optional(),
  references: z.array(z.object({
    assetId: z.string().trim().min(1).max(128),
  }).strict()).min(1).max(20).optional(),
  prompt: z.string().trim().min(1).max(8000),
  negativePrompt: z.string().trim().max(4000).nullable().optional(),
  count: z.literal(1).default(1),
  width: z.number().int().min(256).max(4096).default(1024),
  height: z.number().int().min(256).max(4096).default(1024),
  idempotencyKey: z.string().trim().min(8).max(128),
  context: workflowContextSchema,
});
const imageTranslationWorkflowSchema = z.object({
  operation: z.literal('IMAGE_TRANSLATE'),
  sourceAssetId: z.string().trim().min(1).max(128),
  sourceLanguage: z.string().trim().regex(/^[a-z]{2,12}(?:[-_][a-z0-9]{2,12})?$/iu).default('zh'),
  targetLanguage: z.string().trim().regex(/^[a-z]{2,12}(?:[-_][a-z0-9]{2,12})?$/iu).default('ru'),
  domainHint: z.string().trim().max(2_000).refine(
    (value) => Buffer.byteLength(value, 'utf8') <= 2_000,
    'Image translation domain hint exceeds 2000 bytes',
  ).optional().default(''),
  terminologies: z.array(z.object({
    src: z.string().trim().min(1).max(120),
    tgt: z.string().trim().min(1).max(120),
  }).strict()).max(50).default([]),
  idempotencyKey: z.string().trim().min(8).max(128),
  context: workflowContextSchema,
});
const fullEditWorkflowSchema = z.object({
  operation: z.literal('FULL_EDIT'),
  sourceAssetId: z.string().trim().min(1).max(128),
  userPrompt: z.string().trim().min(1).max(8000),
  userNegativePrompt: z.string().trim().max(4000).optional().default(''),
  idempotencyKey: z.string().trim().min(8).max(128),
  context: workflowContextSchema,
});
const inpaintWorkflowSchema = z.object({
  operation: z.literal('INPAINT'),
  sourceAssetId: z.string().trim().min(1).max(128),
  maskAssetId: z.string().trim().min(1).max(128),
  maskSemantics: z.literal(AI_IMAGE_EDIT_MASK_SEMANTICS),
  userPrompt: z.string().trim().min(1).max(8000),
  userNegativePrompt: z.string().trim().max(4000).optional().default(''),
  idempotencyKey: z.string().trim().min(8).max(128),
  context: workflowContextSchema,
});
const createWorkflowSchema = z.discriminatedUnion('operation', [
  imageToImageWorkflowSchema,
  imageTranslationWorkflowSchema,
  fullEditWorkflowSchema,
  inpaintWorkflowSchema,
]).superRefine((value, context) => {
  if (value.operation === 'IMAGE_TO_IMAGE') {
    if (Boolean(value.sourceAssetId) === Boolean(value.references)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['references'],
        message: 'Use either sourceAssetId or references',
      });
    }
    return;
  }
  if (value.operation === 'FULL_EDIT' || value.operation === 'INPAINT') return;
  if (value.sourceLanguage.toLowerCase() === value.targetLanguage.toLowerCase()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetLanguage'],
      message: 'Source and target languages must differ',
    });
  }
  const sources = new Set<string>();
  const targetsBySource = new Map<string, string>();
  for (const [index, term] of value.terminologies.entries()) {
    const key = term.src.toLocaleLowerCase();
    const target = term.tgt.toLocaleLowerCase();
    if (sources.has(key) && targetsBySource.get(key) !== target) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['terminologies', index, 'src'],
        message: 'Terminology source terms must not map to conflicting targets',
      });
    }
    sources.add(key);
    targetsBySource.set(key, target);
  }
});
const revisionSchema = z.object({ expectedRevision: z.number().int().min(1) });
const retrySchema = revisionSchema.extend({ idempotencyKey: z.string().trim().min(8).max(128) });
const reviewSchema = revisionSchema.extend({
  outputAssetId: z.string().trim().min(1).max(128),
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(1000).nullable().optional(),
});
const editMaskSchema = z.object({
  sourceAssetId: z.string().trim().min(1).max(128),
  skuKey: z.string().trim().min(1).max(500).nullable().optional(),
  slotKey: z.string().trim().min(1).max(200).nullable().optional(),
  maskSemantics: z.literal(AI_IMAGE_EDIT_MASK_SEMANTICS),
  maskDataUrl: z.string().min(32).max(28 * 1024 * 1024),
});

interface AiImageRouteSettings {
  enabled: boolean;
  provider: string;
  model: string;
  dailyLimit: number;
  estimatedCostCents: number;
}

interface AiImageTranslationRouteSettings {
  enabled: boolean;
  provider: string;
  model: string;
  dailyLimit: number;
  estimatedCostCents: number;
}

interface AiImageEditRouteSettings {
  fullEditEnabled: boolean;
  inpaintEnabled: boolean;
  dailyLimit: number;
}

type EditMaskUploadLimitCheck = { allowed: true } | { allowed: false; reason: string };

export interface AiImageOperationReadiness {
  enabled: boolean;
  ready: boolean;
  reasonCode: 'READY' | 'AI_MEDIA_WORKFLOW_DISABLED' | 'AI_MEDIA_OPERATION_DISABLED'
    | 'SOURCE_LISTING_WEB_MEDIA_DISABLED' | 'PROVIDER_NOT_READY' | 'STORAGE_NOT_READY';
  reason: string;
  testOnly?: boolean;
}

interface AiImageRouteOptions {
  repository?: AiImageJobRepository;
  enqueue?: (jobId: string) => Promise<void>;
  enqueueTranslation?: (jobId: string) => Promise<void>;
  enqueueEdit?: (jobId: string) => Promise<void>;
  authenticate?: (request: FastifyRequest, reply: any) => Promise<unknown>;
  getSettings?: () => Promise<AiImageRouteSettings>;
  getTranslationSettings?: () => Promise<AiImageTranslationRouteSettings>;
  getTranslationStorageReadiness?: () => Promise<AiImageTranslationStorageReadiness>;
  getEditSettings?: () => Promise<AiImageEditRouteSettings>;
  getEditStorageReadiness?: () => Promise<AiImageEditStorageReadiness>;
  getSourceListingWebMediaEnabled?: () => Promise<boolean>;
  sourceWorkflowFeatureFlags?: SourceWorkflowFeatureFlagEvaluator;
  production?: boolean;
  resolvePrompt?: (input: {
    templateKey: string;
    userPrompt: string;
    userNegativePrompt: string;
  }) => Promise<{
    templateKey: string;
    release: { id: string; revisionId: string; sequence: number };
    checksum: string;
    snapshot: Record<string, unknown>;
    resolvedPrompt: string;
    resolvedNegativePrompt: string;
  }>;
  resolveTranslationPrompt?: typeof resolveActiveAiTemplate;
  resolveEditPrompt?: typeof resolveActiveAiTemplate;
  mediaWorkflowService?: AiMediaWorkflowService;
  mediaContextService?: AiMediaContextService;
  getMediaWorkflowEnabled?: (ownerUserId: string) => Promise<boolean>;
  applyAssets?: (input: ApplyAiImageAssetsInput) => Promise<ApplyAiImageAssetsResult>;
  createEditMask?: typeof createAiImageEditMask;
  checkEditMaskRequestRate?: (ownerUserId: string) => Promise<EditMaskUploadLimitCheck>;
  checkEditMaskUploadQuota?: (ownerUserId: string, bytes: number) => Promise<EditMaskUploadLimitCheck>;
}

const DEFAULT_TEMPLATE_KEY = 'text-to-image.base';

function actor(request: FastifyRequest) {
  const auth = (request as any).user || {};
  return {
    ownerUserId: auth.effectiveUserId || auth.userId,
    actorUserId: auth.actorUserId || auth.userId,
  };
}

function sendError(reply: any, error: unknown) {
  if (error instanceof AiMediaWorkflowError) {
    const status = error.code === 'NOT_FOUND'
      ? 404
      : error.code === 'IDEMPOTENCY_KEY_CONFLICT'
        || error.code === 'WORKFLOW_CONFLICT'
        || error.code === 'RECOVERY_REQUIRED'
        || error.code === 'PROVIDER_CONFIG_CHANGED'
        || error.code === 'STALE_MEDIA_WORKFLOW'
        ? 409
        : error.code === 'IMAGE_TRANSLATION_QUOTA_EXCEEDED'
          || error.code === 'AI_IMAGE_EDIT_QUOTA_EXCEEDED'
          ? 429
        : error.code === 'AI_MEDIA_OPERATION_DISABLED'
          || error.code === 'SOURCE_LISTING_WEB_MEDIA_DISABLED'
          || error.code === 'PROVIDER_NOT_READY'
          || error.code === 'STORAGE_NOT_READY'
          ? 503
          : 400;
    return reply.status(status).send({ code: error.code, msg: error.message });
  }
  if (error instanceof AiMediaContextError) {
    return reply.status(error.statusCode).send({ code: error.code, msg: error.message });
  }
  if (error instanceof AiImageApplicationError) {
    const status = error.code === 'NOT_FOUND' || error.code === 'TARGET_NOT_FOUND'
      ? 404
      : error.code === 'PROVIDER_NOT_READY'
        ? 503
      : error.code === 'ALREADY_APPLIED'
        || error.code === 'TARGET_CONFLICT'
        || error.code === 'STALE_MEDIA_WORKFLOW'
        ? 409
        : 400;
    return reply.status(status).send({ code: error.code, msg: error.message, data: error.data });
  }
  if (error instanceof AiImageJobError) {
    const status = error.code === 'NOT_FOUND' || error.code === 'SOURCE_ASSET_NOT_FOUND'
      ? 404
      : error.code === 'IDEMPOTENCY_KEY_CONFLICT'
        || error.code === 'STALE_MEDIA_WORKFLOW'
        ? 409
      : error.code === 'QUOTA_EXCEEDED'
          || error.code === 'EDIT_RESOURCE_QUOTA_EXCEEDED'
          ? 429
          : error.code === 'PROVIDER_DISABLED'
            || error.code === 'PROVIDER_NOT_READY'
            || error.code === 'EDIT_STORAGE_NOT_READY'
            || error.code === 'EDIT_PERSISTENCE_NOT_READY'
            ? 503
            : 400;
    return reply.status(status).send({ code: error.code, msg: error.message });
  }
  if (error instanceof AiPromptTemplateError) {
    return reply.status(503).send({
      code: 'PROMPT_TEMPLATE_UNAVAILABLE',
      msg: 'AI image prompt template is temporarily unavailable',
    });
  }
  throw error;
}

function decodePngDataUrl(value: string) {
  const matched = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (!matched) throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Edit mask must be a canonical PNG data URL');
  const buffer = Buffer.from(matched[1]!, 'base64');
  if (!buffer.length || buffer.toString('base64') !== matched[1]) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Edit mask base64 payload is invalid');
  }
  return buffer;
}

function canonicalTranslationTerminologies(terms: Array<{ src: string; tgt: string }>) {
  const bySource = new Map<string, { src: string; tgt: string }>();
  for (const term of terms) {
    const key = term.src.toLocaleLowerCase();
    if (!bySource.has(key)) bySource.set(key, { src: term.src.trim(), tgt: term.tgt.trim() });
  }
  return [...bySource.values()];
}

export function resolveAiImageTranslationReadiness(
  settings: AiImageTranslationRouteSettings,
  options: {
    workflowEnabled?: boolean;
    production?: boolean;
    storageReadiness?: AiImageTranslationStorageReadiness;
  } = {},
): AiImageOperationReadiness {
  if (options.workflowEnabled === false) {
    return {
      enabled: false,
      ready: false,
      reasonCode: 'AI_MEDIA_WORKFLOW_DISABLED',
      reason: 'AI media workflow is not enabled for this account',
    };
  }
  if (!settings.enabled || settings.provider === 'disabled') {
    return {
      enabled: false,
      ready: false,
      reasonCode: 'AI_MEDIA_OPERATION_DISABLED',
      reason: 'AI image translation is disabled',
    };
  }
  if (!['fake', 'dashscope-qwen-mt-image'].includes(settings.provider)) {
    return {
      enabled: true,
      ready: false,
      reasonCode: 'PROVIDER_NOT_READY',
      reason: 'AI image translation provider adapter is not enabled yet',
    };
  }
  if (settings.provider === 'fake' && (options.production ?? process.env.NODE_ENV === 'production')) {
    return {
      enabled: true,
      ready: false,
      reasonCode: 'PROVIDER_NOT_READY',
      reason: 'The fake image translation provider is test-only',
      testOnly: true,
    };
  }
  const storage = options.storageReadiness;
  if (settings.provider !== 'fake' && (
    !storage
    || !storage.ready
    || storage.backend !== 'oss'
    || storage.publicHttps !== true
  )) {
    return {
      enabled: true,
      ready: false,
      reasonCode: 'STORAGE_NOT_READY',
      reason: storage?.reason || 'Paid image translation requires an owned OSS/CDN URL reachable over public HTTPS',
    };
  }
  const capability = resolveAiImageProviderCapability(settings.provider, settings.model);
  if (settings.provider !== 'fake' && capability?.evidenceLevel !== 'sandbox-verified') {
    return {
      enabled: true,
      ready: false,
      reasonCode: 'PROVIDER_NOT_READY',
      reason: 'AI image translation provider has not passed its sandbox capability gate',
    };
  }
  if (settings.provider !== 'fake' && settings.estimatedCostCents <= 0) {
    return {
      enabled: true,
      ready: false,
      reasonCode: 'PROVIDER_NOT_READY',
      reason: 'A verified positive image translation cost is required before paid dispatch',
    };
  }
  if (options.storageReadiness && !options.storageReadiness.ready) {
    return {
      enabled: true,
      ready: false,
      reasonCode: 'STORAGE_NOT_READY',
      reason: options.storageReadiness.reason,
      ...(settings.provider === 'fake' ? { testOnly: true } : {}),
    };
  }
  return {
    enabled: true,
    ready: true,
    reasonCode: 'READY',
    reason: 'AI image translation is ready',
    ...(settings.provider === 'fake' ? { testOnly: true } : {}),
  };
}

export function resolveAiImageToImageReadiness(
  options: { workflowEnabled?: boolean; production?: boolean } = {},
): AiImageOperationReadiness {
  if (options.workflowEnabled === false) {
    return {
      enabled: false,
      ready: false,
      reasonCode: 'AI_MEDIA_WORKFLOW_DISABLED',
      reason: 'AI media workflow is not enabled for this account',
    };
  }
  if (options.production ?? process.env.NODE_ENV === 'production') {
    return {
      enabled: true,
      ready: false,
      reasonCode: 'PROVIDER_NOT_READY',
      reason: 'AI image-to-image provider is not available in production yet',
      testOnly: true,
    };
  }
  return {
    enabled: true,
    ready: true,
    reasonCode: 'READY',
    reason: 'AI image-to-image workflow is ready',
    testOnly: true,
  };
}

export function resolveAiImageEditReadiness(
  operation: 'FULL_EDIT' | 'INPAINT',
  settings: { fullEditEnabled: boolean; inpaintEnabled: boolean },
  options: {
    workflowEnabled?: boolean;
    production?: boolean;
    storageReadiness?: AiImageEditStorageReadiness;
  } = {},
): AiImageOperationReadiness {
  if (options.workflowEnabled === false) {
    return {
      enabled: false,
      ready: false,
      reasonCode: 'AI_MEDIA_WORKFLOW_DISABLED',
      reason: 'AI media workflow is not enabled for this account',
    };
  }
  const enabled = operation === 'FULL_EDIT'
    ? settings.fullEditEnabled
    : settings.inpaintEnabled;
  if (!enabled) {
    return {
      enabled: false,
      ready: false,
      reasonCode: 'AI_MEDIA_OPERATION_DISABLED',
      reason: operation === 'FULL_EDIT' ? 'Full-image edit is disabled' : 'Masked inpaint is disabled',
      testOnly: true,
    };
  }
  if (options.storageReadiness && !options.storageReadiness.ready) {
    return {
      enabled: true,
      ready: false,
      reasonCode: 'STORAGE_NOT_READY',
      reason: options.storageReadiness.reason,
      testOnly: true,
    };
  }
  if (options.production ?? process.env.NODE_ENV === 'production') {
    return {
      enabled: true,
      ready: false,
      reasonCode: 'PROVIDER_NOT_READY',
      reason: 'Manual image edit has not passed its production Provider gate',
      testOnly: true,
    };
  }
  return {
    enabled: true,
    ready: true,
    reasonCode: 'READY',
    reason: operation === 'FULL_EDIT' ? 'Full-image edit is ready' : 'Masked inpaint is ready',
    testOnly: true,
  };
}

function gateReadinessByWebMedia(
  readiness: AiImageOperationReadiness,
  webMediaEnabled: boolean,
): AiImageOperationReadiness {
  if (webMediaEnabled) return readiness;
  return {
    enabled: false,
    ready: false,
    reasonCode: 'SOURCE_LISTING_WEB_MEDIA_DISABLED',
    reason: 'Web AI media tools are not enabled for this account',
    ...(readiness.testOnly ? { testOnly: readiness.testOnly } : {}),
  };
}

function compileTranslationProviderPolicy(resolvedPrompt: string, resolvedNegativePrompt: string) {
  return [
    resolvedPrompt.trim(),
    resolvedNegativePrompt.trim()
      ? `Frozen terminology and platform constraints:\n${resolvedNegativePrompt.trim()}`
      : '',
  ].filter(Boolean).join('\n\n');
}

function publicWorkflow(workflow: any) {
  return {
    id: workflow.id,
    operation: workflow.operation,
    status: workflow.status,
    reviewStatus: workflow.reviewStatus,
    revision: workflow.revision,
    currentAttempt: workflow.currentAttempt,
    contextType: workflow.contextType,
    contextId: workflow.contextId,
    contextSkuKey: workflow.contextSkuKey,
    contextSlotKey: workflow.contextSlotKey,
    selectedOutputAssetId: workflow.selectedOutputAssetId,
    reviewedAt: workflow.reviewedAt,
    completedAt: workflow.completedAt,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    inputs: Array.isArray(workflow.inputs) ? workflow.inputs.map((input: any) => ({
      id: input.id,
      assetId: input.assetId,
      role: input.role,
      ordinal: input.ordinal,
      url: input.assetUrl || input.asset?.url,
      mimeType: input.mimeType || input.asset?.mimeType,
      width: input.width ?? input.asset?.width,
      height: input.height ?? input.asset?.height,
      kind: input.kind || input.asset?.kind,
      sourceCaptureSnapshotId: input.sourceCaptureSnapshotId || input.asset?.sourceCaptureSnapshotId,
    })) : [],
    jobs: Array.isArray(workflow.jobs) ? workflow.jobs.map((job: any) => publicJob(job, workflow)) : [],
    events: Array.isArray(workflow.events) ? workflow.events.map((event: any) => ({
      id: event.id,
      eventType: event.eventType,
      jobId: event.jobId,
      assetId: event.assetId,
      createdAt: event.createdAt,
    })) : [],
  };
}

function assertStandaloneWorkflow(workflow: { suiteId?: string | null }): void {
  if (workflow.suiteId) {
    throw new AiMediaWorkflowError(
      'WORKFLOW_CONFLICT',
      'Suite child workflows are controlled by the suite operation',
    );
  }
}

function publicJob(job: Record<string, unknown>, workflow?: Record<string, unknown>) {
  const {
    resolvedPrompt: _resolvedPrompt,
    resolvedNegativePrompt: _resolvedNegativePrompt,
    templateSnapshot: _templateSnapshot,
    operationConfig,
    requestFingerprint: _requestFingerprint,
    inputAssets: _inputAssets,
    workflow: _workflow,
    costReservation,
    assets,
    ...visible
  } = job;
  const translationConfig = operationConfig && typeof operationConfig === 'object'
    ? operationConfig as Record<string, unknown>
    : null;
  const translationTerminologies = Array.isArray(translationConfig?.terminologies)
    ? translationConfig.terminologies.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const term = entry as Record<string, unknown>;
      const src = String(term.src || '').trim().slice(0, 120);
      const tgt = String(term.tgt || '').trim().slice(0, 120);
      return src && tgt ? [{ src, tgt }] : [];
    }).slice(0, 50)
    : [];
  return {
    ...visible,
    ...(visible.operation === 'IMAGE_TRANSLATE' && translationConfig ? {
      translation: {
        sourceLanguage: String(translationConfig.sourceLanguage || ''),
        targetLanguage: String(translationConfig.targetLanguage || ''),
        policyVersion: String(translationConfig.policyVersion || ''),
        terminologies: translationTerminologies,
      },
    } : {}),
    costStatus: typeof (costReservation as { status?: unknown } | null)?.status === 'string'
      ? (costReservation as { status: string }).status
      : null,
    assets: Array.isArray(assets) ? assets
      .filter((asset: any) => asset?.kind === 'AI_GENERATED')
      .map((asset: any) => ({
      id: asset.id,
      kind: asset.kind,
      url: asset.url,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      sourceCaptureSnapshotId: asset.sourceCaptureSnapshotId,
      editReady: Boolean(
        workflow
        && workflow.status === 'SUCCEEDED'
        && workflow.completedAt != null
        && ['FULL_EDIT', 'INPAINT'].includes(String(workflow.operation || ''))
        && !workflow.suiteId
        && job.ownerUserId === workflow.ownerUserId
        && job.workflowId === workflow.id
        && job.status === 'SUCCEEDED'
        && job.operation === workflow.operation
        && job.workflowAttempt === workflow.currentAttempt
        && asset.ownerUserId === job.ownerUserId
        && asset.aiImageJobId === job.id
        && isAiMediaEditReadyCandidateAsset(asset)
      ),
      })) : [],
  };
}

export function createAiImageRequestFingerprint(input: {
  prompt: string;
  negativePrompt: string;
  count: number;
  width: number;
  height: number;
  templateKey: string;
}) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export async function aiImageRoutes(app: FastifyInstance, options: AiImageRouteOptions = {}) {
  const repository = options.repository || new PrismaAiImageJobRepository(prisma);
  const mediaWorkflowService = options.mediaWorkflowService
    || createAiMediaWorkflowService(new PrismaAiMediaWorkflowRepository(prisma));
  const mediaContextService = options.mediaContextService || createAiMediaContextService(prisma);
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const authHook = options.authenticate || authenticate;
  const getSettings = options.getSettings || (async () => ({
    enabled: await getConfig('ai_image_generation_enabled'),
    provider: await getConfig('ai_image_provider'),
    model: await getConfig('ai_image_model'),
    dailyLimit: await getConfig('ai_user_daily_image_generation_limit'),
    estimatedCostCents: 0,
  }));
  const getTranslationSettings = options.getTranslationSettings || (async () => ({
    enabled: await getConfig('feature_image_translate'),
    provider: await getConfig('ai_image_translation_provider'),
    model: await getConfig('ai_image_translation_model'),
    dailyLimit: await getConfig('ai_user_daily_image_translation_limit'),
    estimatedCostCents: await getConfig('ai_image_translation_cost_cents'),
  }));
  const getTranslationStorageReadiness = options.getTranslationStorageReadiness || (async () => {
    try {
      const storage = await getRuntimeConfigForStorage();
      return resolveAiImageTranslationStorageReadiness(storage);
    } catch {
      return {
        ready: false,
        reason: 'Image translation storage readiness could not be verified',
      };
    }
  });
  const getEditSettings = options.getEditSettings || (async () => ({
    fullEditEnabled: await getConfig('feature_ai_media_full_edit'),
    inpaintEnabled: await getConfig('feature_ai_media_inpaint'),
    dailyLimit: await getConfig('ai_user_daily_image_generation_limit'),
  }));
  const getEditStorageReadiness = options.getEditStorageReadiness || (async () => {
    try {
      return resolveAiImageEditStorageReadiness(await getRuntimeConfigForStorage());
    } catch {
      return {
        ready: false,
        reason: 'AI image edit storage readiness could not be verified',
      };
    }
  });
  const featureFlags = options.sourceWorkflowFeatureFlags || sourceWorkflowFeatureFlags;
  const getSourceListingWebMediaDecision = async (ownerUserId: string) => {
    if (options.getSourceListingWebMediaEnabled) {
      const enabled = await options.getSourceListingWebMediaEnabled();
      return {
        enabled,
        reason: enabled ? 'global' as const : 'master_off' as const,
        revision: 'test-hook',
      };
    }
    return featureFlags.evaluate('SOURCE_LISTING_WEB_MEDIA', { ownerUserId });
  };
  const requireSourceListingWebMedia = async (ownerUserId: string) => {
    const decision = await getSourceListingWebMediaDecision(ownerUserId);
    if (!decision.enabled) {
      throw new AiMediaWorkflowError(
        'SOURCE_LISTING_WEB_MEDIA_DISABLED',
        'Web AI media tools are not enabled for this account',
      );
    }
    return decision;
  };
  const enqueue = options.enqueue || (async (jobId: string) => {
    const worker = await import('../workers/ai-image-generation.js');
    await worker.enqueueAiImageJob(jobId);
  });
  const enqueueTranslation = options.enqueueTranslation || (async (jobId: string) => {
    const worker = await import('../workers/ai-image-translation.js');
    await worker.enqueueAiImageTranslationJob(jobId);
  });
  const enqueueEdit = options.enqueueEdit || (async (jobId: string) => {
    const worker = await import('../workers/ai-image-edit.js');
    await worker.enqueueAiImageEditJob(jobId);
  });
  const resolvePrompt = options.resolvePrompt || resolveActiveAiPrompt;
  const resolveTranslationPrompt = options.resolveTranslationPrompt || resolveActiveAiTemplate;
  const resolveEditPrompt = options.resolveEditPrompt || resolveActiveAiTemplate;
  const getMediaWorkflowEnabled = options.getMediaWorkflowEnabled
    || (async (ownerUserId: string) => (await getAiMediaRolloutDecision(ownerUserId)).enabled);
  const applyAssets = options.applyAssets
    || ((input: ApplyAiImageAssetsInput) => applyAiImageAssets(prisma as any, input));
  const checkEditMaskRequestRate = options.checkEditMaskRequestRate || (async (
    ownerUserId: string,
  ): Promise<EditMaskUploadLimitCheck> => {
    if (await getConfig('upload_rate_limit_enabled')) {
      const maxPerMinute = await getConfig('upload_rate_limit_per_minute');
      if (!uploadLimiter.checkRateLimit(ownerUserId, maxPerMinute)) {
        return { allowed: false, reason: `Edit mask upload exceeds ${maxPerMinute} requests per minute` };
      }
    }
    return { allowed: true };
  });
  const checkEditMaskUploadQuota = options.checkEditMaskUploadQuota || (async (
    ownerUserId: string,
    bytes: number,
  ): Promise<EditMaskUploadLimitCheck> => {
    if (await getConfig('upload_daily_quota_enabled')) {
      const maxMegabytes = await getConfig('upload_daily_quota_mb');
      if (!uploadLimiter.checkDailyQuota(ownerUserId, bytes, maxMegabytes * 1024 * 1024)) {
        return { allowed: false, reason: `Edit mask upload exceeds the ${maxMegabytes} MB daily quota` };
      }
    }
    return { allowed: true };
  });
  const createEditMaskAsset = options.createEditMask || createAiImageEditMask;
  const assertWorkflowSourceCurrent = async (workflow: any, ownerUserId: string) => {
    if (workflow.contextType !== 'collect' || !workflow.contextId) return;
    const currentContext = await mediaContextService.loadCollect(ownerUserId, workflow.contextId);
    const currentAssetIds = new Set(
      currentContext.inputs.flatMap((input) => [
        input.assetId,
        ...(Array.isArray(input.compatibleAssetIds) ? input.compatibleAssetIds : []),
      ]).filter((id): id is string => Boolean(id)),
    );
    const currentSnapshotId = String(currentContext.snapshot?.id || '').trim();
    const workflowInputAssets = Array.isArray(workflow.inputs)
      ? workflow.inputs
        .filter((input: any) => input?.role !== 'MASK')
        .map((input: any) => ({
          assetId: String(input.assetId || '').trim(),
          kind: String(input.kind || input.asset?.kind || '').trim(),
          sourceCaptureSnapshotId: String(
            input.sourceCaptureSnapshotId || input.asset?.sourceCaptureSnapshotId || '',
          ).trim(),
        }))
        .filter((input: { assetId: string }) => Boolean(input.assetId))
      : [];
    if (!workflowInputAssets.length || workflowInputAssets.some((input: {
      assetId: string;
      kind: string;
      sourceCaptureSnapshotId: string;
    }) => !currentAssetIds.has(input.assetId) && !(
      input.kind === 'AI_GENERATED'
      && ['FULL_EDIT', 'INPAINT'].includes(String(workflow.operation || ''))
      && currentSnapshotId
      && input.sourceCaptureSnapshotId === currentSnapshotId
    ))) {
      throw new AiMediaWorkflowError(
        'STALE_MEDIA_WORKFLOW',
        'The source image snapshot changed; review and generate a new candidate',
      );
    }
  };

  app.addHook('onRequest', authHook as any);

  app.get('/capabilities', async (request) => {
    const ids = actor(request);
    const [
      workflowEnabled,
      webMediaDecision,
      translationSettings,
      translationStorageReadiness,
      editSettings,
      editStorageReadiness,
    ] = await Promise.all([
      getMediaWorkflowEnabled(ids.ownerUserId),
      getSourceListingWebMediaDecision(ids.ownerUserId),
      getTranslationSettings(),
      getTranslationStorageReadiness(),
      getEditSettings(),
      getEditStorageReadiness(),
    ]);
    const translation = resolveAiImageTranslationReadiness(translationSettings, {
      workflowEnabled,
      production,
      storageReadiness: translationStorageReadiness,
    });
    const imageToImage = resolveAiImageToImageReadiness({ workflowEnabled, production });
    const fullEdit = resolveAiImageEditReadiness('FULL_EDIT', editSettings, {
      workflowEnabled,
      production,
      storageReadiness: editStorageReadiness,
    });
    const inpaint = resolveAiImageEditReadiness('INPAINT', editSettings, {
      workflowEnabled,
      production,
      storageReadiness: editStorageReadiness,
    });
    return {
      code: 1,
      data: {
        webMediaEnabled: webMediaDecision.enabled,
        webMediaReason: webMediaDecision.reason,
        webMediaRevision: webMediaDecision.revision,
        workflowEnabled,
        operations: {
          IMAGE_TO_IMAGE: gateReadinessByWebMedia(imageToImage, webMediaDecision.enabled),
          IMAGE_TRANSLATE: gateReadinessByWebMedia(translation, webMediaDecision.enabled),
          FULL_EDIT: gateReadinessByWebMedia(fullEdit, webMediaDecision.enabled),
          INPAINT: gateReadinessByWebMedia(inpaint, webMediaDecision.enabled),
        },
      },
    };
  });

  app.post('/jobs', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    const settings = await getSettings();
    if (!settings.enabled || settings.provider === 'disabled') return reply.status(503).send({ code: 'PROVIDER_DISABLED', msg: 'AI image generation is disabled' });
    if (!['fake', 'dashscope-wanx', 'openai-images'].includes(settings.provider)) {
      return reply.status(503).send({ code: 'PROVIDER_NOT_READY', msg: 'AI image provider adapter is not enabled yet' });
    }
    const ids = actor(request);
    try {
      const resolved = await resolvePrompt({
        templateKey: DEFAULT_TEMPLATE_KEY,
        userPrompt: parsed.data.prompt,
        userNegativePrompt: parsed.data.negativePrompt || '',
      });
      const fingerprint = createAiImageRequestFingerprint({
        prompt: parsed.data.prompt,
        negativePrompt: parsed.data.negativePrompt || '',
        count: parsed.data.count,
        width: parsed.data.width,
        height: parsed.data.height,
        templateKey: resolved.templateKey,
      });
      const result = await createAiImageJob({
        ...ids,
        idempotencyKey: parsed.data.idempotencyKey || null,
        prompt: parsed.data.prompt,
        negativePrompt: parsed.data.negativePrompt || null,
        resolvedPrompt: resolved.resolvedPrompt,
        resolvedNegativePrompt: resolved.resolvedNegativePrompt,
        templateKey: resolved.templateKey,
        templateReleaseId: resolved.release.id,
        templateChecksum: resolved.checksum,
        templateSnapshot: resolved.snapshot,
        requestFingerprint: fingerprint,
        provider: settings.provider,
        model: settings.model,
        count: parsed.data.count,
        width: parsed.data.width,
        height: parsed.data.height,
        estimatedCostCents: settings.estimatedCostCents,
      }, repository, settings.dailyLimit);
      if (!result.replayed) {
        try {
          await enqueue(result.job.id);
        } catch {
          const failed = repository.markEnqueueFailed
            ? await repository.markEnqueueFailed(result.job.id, {
              attemptCount: 0, errorCode: 'QUEUE_UNAVAILABLE', errorMessage: 'AI image queue is temporarily unavailable',
            })
            : (await repository.markFailed(result.job.id, {
              attemptCount: 0, errorCode: 'QUEUE_UNAVAILABLE', errorMessage: 'AI image queue is temporarily unavailable',
            }), true);
          if (failed) {
            return reply.status(503).send({ code: 'QUEUE_UNAVAILABLE', msg: 'AI image queue is temporarily unavailable' });
          }
        }
      }
      return reply.status(result.replayed ? 200 : 202).send({
        code: 1,
        data: publicJob(result.job as unknown as Record<string, unknown>),
        replayed: result.replayed,
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.get('/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await repository.getById(id);
    if (!job || job.ownerUserId !== actor(request).ownerUserId) return reply.status(404).send({ code: 'NOT_FOUND', msg: 'AI image job not found' });
    if ((job as any).workflow?.suiteSlot?.suiteId) {
      return reply.status(409).send({
        code: 'INVALID_STATE',
        msg: 'Suite child jobs are available only through the suite workflow',
      });
    }
    return { code: 1, data: publicJob(job as unknown as Record<string, unknown>) };
  });

  app.post('/jobs/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ids = actor(request);
    const existing = await repository.getById(id);
    if (!existing || existing.ownerUserId !== ids.ownerUserId) {
      return reply.status(404).send({ code: 'NOT_FOUND', msg: 'AI image job not found or cannot be cancelled' });
    }
    if (existing?.workflowId) {
      return reply.status(409).send({
        code: 'WORKFLOW_CANCEL_REQUIRED',
        msg: 'Workflow-backed jobs must be cancelled through the workflow endpoint',
      });
    }
    const job = await repository.requestCancellation(id, ids.ownerUserId);
    if (!job) return reply.status(404).send({ code: 'NOT_FOUND', msg: 'AI image job not found or cannot be cancelled' });
    return { code: 1, data: publicJob(job as unknown as Record<string, unknown>) };
  });

  app.post('/jobs/:id/apply', async (request, reply) => {
    const parsed = applySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    const { id } = request.params as { id: string };
    try {
      const ownedJob = await repository.getById(id);
      if (!ownedJob || ownedJob.ownerUserId !== actor(request).ownerUserId) {
        throw new AiImageJobError('NOT_FOUND', 'AI image job not found');
      }
      if (ownedJob.workflowId && ownedJob.provider === 'fake' && production) {
        throw new AiImageJobError('PROVIDER_NOT_READY', 'Test-only AI media candidates cannot be applied in production');
      }
      if (ownedJob.operation === 'IMAGE_TRANSLATE' && parsed.data.mode !== 'append') {
        throw new AiImageJobError(
          'UNSAFE_APPLY_MODE',
          'Image translation candidates can only be appended to existing product images',
        );
      }
      let selectedAssetId: string | null = null;
      if (ownedJob.workflowId) {
        const workflow = await mediaWorkflowService.get(ownedJob.workflowId, actor(request).ownerUserId);
        if (workflow.suiteId) {
          throw new AiImageJobError(
            'INVALID_STATE',
            'Suite child outputs must be reviewed and applied through the suite workflow',
          );
        }
        if (parsed.data.targetType !== workflow.contextType || parsed.data.targetId !== workflow.contextId) {
          throw new AiImageJobError('INVALID_STATE', 'Workflow output can only be applied to its reviewed context');
        }
        const selectedBelongsToJob = Array.isArray((ownedJob as any).assets)
          && (ownedJob as any).assets.some((asset: any) => asset.id === workflow.selectedOutputAssetId);
        if (workflow.reviewStatus !== 'APPROVED' || !selectedBelongsToJob) {
          throw new AiImageJobError('INVALID_STATE', 'Workflow output must be approved before it can be applied');
        }
        await assertWorkflowSourceCurrent(workflow, actor(request).ownerUserId);
        selectedAssetId = workflow.selectedOutputAssetId;
      }
      const application = await applyAssets({
        jobId: id,
        ownerUserId: actor(request).ownerUserId,
        actorUserId: actor(request).actorUserId,
        ...parsed.data,
        selectedAssetId,
      });
      return { code: 1, data: application };
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/workflows', async (request, reply) => {
    const parsed = createWorkflowSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    const ids = actor(request);
    if (!await getMediaWorkflowEnabled(ids.ownerUserId)) {
      return reply.status(503).send({ code: 'AI_MEDIA_WORKFLOW_DISABLED', msg: 'AI media workflow is disabled' });
    }
    try {
      await requireSourceListingWebMedia(ids.ownerUserId);
      let created: any;
      let enqueueOperation: (jobId: string) => Promise<void> = enqueue;
      if (parsed.data.operation === 'IMAGE_TRANSLATE') {
        const [translationSettings, translationStorageReadiness] = await Promise.all([
          getTranslationSettings(),
          getTranslationStorageReadiness(),
        ]);
        const readiness = resolveAiImageTranslationReadiness(translationSettings, {
          production,
          storageReadiness: translationStorageReadiness,
        });
        if (!readiness.ready) return reply.status(503).send({ code: readiness.reasonCode, msg: readiness.reason });
        const createTranslation = (mediaWorkflowService as AiMediaWorkflowService & {
          createImageTranslation?: (input: Record<string, unknown>) => Promise<unknown>;
        }).createImageTranslation;
        if (!createTranslation) {
          throw new AiMediaWorkflowError('PROVIDER_NOT_READY', 'AI image translation workflow is not installed');
        }
        const sourceLanguage = parsed.data.sourceLanguage.toLowerCase();
        const targetLanguage = parsed.data.targetLanguage.toLowerCase();
        const terminologies = canonicalTranslationTerminologies(parsed.data.terminologies);
        const resolved = await resolveTranslationPrompt({
          templateKey: AI_MEDIA_TRANSLATION_TEMPLATE_KEY,
          variables: {
            sourceLanguage,
            targetLanguage,
            userInstructions: parsed.data.domainHint,
            terminologyJson: JSON.stringify({ terms: terminologies }),
            platformConstraints: '',
          },
        });
        const providerPolicy = compileTranslationProviderPolicy(
          resolved.resolvedPrompt,
          resolved.resolvedNegativePrompt,
        );
        created = await createTranslation.call(mediaWorkflowService, {
          ...ids,
          sourceAssetId: parsed.data.sourceAssetId,
          sourceLanguage,
          targetLanguage,
          domainHint: providerPolicy,
          terminologies,
          prompt: parsed.data.domainHint,
          resolvedPrompt: resolved.resolvedPrompt,
          resolvedNegativePrompt: resolved.resolvedNegativePrompt,
          templateKey: resolved.templateKey,
          templateReleaseId: resolved.release.id,
          templateChecksum: resolved.checksum,
          templateSnapshot: resolved.snapshot,
          provider: translationSettings.provider,
          model: translationSettings.model,
          dailyLimit: translationSettings.dailyLimit,
          estimatedCostCents: translationSettings.estimatedCostCents,
          idempotencyKey: parsed.data.idempotencyKey,
          context: parsed.data.context,
        });
        enqueueOperation = enqueueTranslation;
      } else if (parsed.data.operation === 'FULL_EDIT' || parsed.data.operation === 'INPAINT') {
        const [editSettings, editStorageReadiness] = await Promise.all([
          getEditSettings(),
          getEditStorageReadiness(),
        ]);
        const readiness = resolveAiImageEditReadiness(parsed.data.operation, editSettings, {
          workflowEnabled: true,
          production,
          storageReadiness: editStorageReadiness,
        });
        if (!readiness.ready) {
          return reply.status(503).send({ code: readiness.reasonCode, msg: readiness.reason });
        }
        const templateKey = parsed.data.operation === 'FULL_EDIT'
          ? AI_MEDIA_FULL_EDIT_TEMPLATE_KEY
          : AI_MEDIA_INPAINT_TEMPLATE_KEY;
        const resolved = await resolveEditPrompt({
          templateKey,
          variables: {
            userPrompt: parsed.data.userPrompt,
            userNegativePrompt: parsed.data.userNegativePrompt,
          },
        });
        created = await mediaWorkflowService.createImageEdit({
          ...ids,
          operation: parsed.data.operation,
          sourceAssetId: parsed.data.sourceAssetId,
          ...(parsed.data.operation === 'INPAINT' ? {
            maskAssetId: parsed.data.maskAssetId,
            maskSemantics: parsed.data.maskSemantics,
          } : {}),
          prompt: parsed.data.userPrompt,
          negativePrompt: parsed.data.userNegativePrompt || null,
          resolvedPrompt: resolved.resolvedPrompt,
          resolvedNegativePrompt: resolved.resolvedNegativePrompt,
          templateKey: resolved.templateKey,
          templateReleaseId: resolved.release.id,
          templateChecksum: resolved.checksum,
          templateSnapshot: resolved.snapshot,
          dailyLimit: editSettings.dailyLimit,
          idempotencyKey: parsed.data.idempotencyKey,
          context: parsed.data.context,
        });
        enqueueOperation = enqueueEdit;
      } else {
        const readiness = resolveAiImageToImageReadiness({ production });
        if (!readiness.ready) {
          return reply.status(503).send({ code: readiness.reasonCode, msg: readiness.reason });
        }
        created = await mediaWorkflowService.createImageToImage({
          ...ids,
          sourceAssetId: parsed.data.sourceAssetId,
          references: parsed.data.references,
          prompt: parsed.data.prompt,
          negativePrompt: parsed.data.negativePrompt || null,
          count: parsed.data.count,
          width: parsed.data.width,
          height: parsed.data.height,
          idempotencyKey: parsed.data.idempotencyKey,
          context: parsed.data.context,
        });
      }
      if (!created.replayed) {
        try {
          await enqueueOperation(created.jobId);
        } catch {
          const failed = repository.markEnqueueFailed
            ? await repository.markEnqueueFailed(created.jobId, {
              attemptCount: 0, errorCode: 'QUEUE_UNAVAILABLE', errorMessage: 'AI media queue is temporarily unavailable',
            })
            : (await repository.markFailed(created.jobId, {
              attemptCount: 0, errorCode: 'QUEUE_UNAVAILABLE', errorMessage: 'AI media queue is temporarily unavailable',
            }), true);
          if (failed) {
            return reply.status(503).send({ code: 'QUEUE_UNAVAILABLE', msg: 'AI media queue is temporarily unavailable' });
          }
        }
      }
      return reply.status(created.replayed ? 200 : 202).send({
        code: 1, data: publicWorkflow(created.workflow), replayed: created.replayed,
      });
    } catch (error: any) {
      if (error?.code === 'SOURCE_ASSET_NOT_FOUND') {
        return reply.status(404).send({ code: 'SOURCE_ASSET_NOT_FOUND', msg: 'Owned source image was not found' });
      }
      if (error?.code === 'MASK_ASSET_NOT_FOUND') {
        return reply.status(404).send({ code: 'MASK_ASSET_NOT_FOUND', msg: 'Owned edit mask was not found' });
      }
      if (error?.code === 'SOURCE_ASSET_INVALID'
        || error?.code === 'SOURCE_ASSET_DUPLICATE'
        || error?.code === 'MASK_ASSET_INVALID'
        || error?.code === 'AI_MEDIA_CONTEXT_MISMATCH') {
        return reply.status(409).send({ code: error.code, msg: error.message });
      }
      return sendError(reply, error);
    }
  });

  app.get('/workflows', async (request, reply) => {
    const query = z.object({
      contextType: z.enum(['collect', 'listing-draft']).optional(),
      contextId: z.string().trim().min(1).max(200).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }).safeParse(request.query);
    if (!query.success) return reply.status(400).send({ code: 'INVALID_REQUEST', msg: query.error.issues[0]?.message });
    const rows = await mediaWorkflowService.list({ ownerUserId: actor(request).ownerUserId, ...query.data });
    return { code: 1, data: rows.map(publicWorkflow) };
  });

  app.get('/workflows/:id', async (request, reply) => {
    try {
      const workflow = await mediaWorkflowService.get((request.params as any).id, actor(request).ownerUserId);
      assertStandaloneWorkflow(workflow);
      return { code: 1, data: publicWorkflow(workflow) };
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/workflows/:id/cancel', async (request, reply) => {
    const parsed = revisionSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    try {
      const ids = actor(request);
      const current = await mediaWorkflowService.get((request.params as any).id, ids.ownerUserId);
      assertStandaloneWorkflow(current);
      const workflow = await mediaWorkflowService.cancel((request.params as any).id, ids.ownerUserId, ids.actorUserId, parsed.data.expectedRevision);
      return { code: 1, data: publicWorkflow(workflow) };
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/workflows/:id/retry', async (request, reply) => {
    const parsed = retrySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    try {
      const ids = actor(request);
      if (!await getMediaWorkflowEnabled(ids.ownerUserId)) {
        return reply.status(503).send({ code: 'AI_MEDIA_WORKFLOW_DISABLED', msg: 'AI media workflow is disabled' });
      }
      await requireSourceListingWebMedia(ids.ownerUserId);
      const existingWorkflow = await mediaWorkflowService.get(
        (request.params as any).id,
        ids.ownerUserId,
      );
      assertStandaloneWorkflow(existingWorkflow);
      let retryEnqueue: (jobId: string) => Promise<void> = enqueue;
      let translationRetryDailyLimit: number | undefined;
      let editRetryDailyLimit: number | undefined;
      if ((existingWorkflow as { operation?: string }).operation === 'IMAGE_TRANSLATE') {
        const [translationSettings, translationStorageReadiness] = await Promise.all([
          getTranslationSettings(),
          getTranslationStorageReadiness(),
        ]);
        translationRetryDailyLimit = translationSettings.dailyLimit;
        const readiness = resolveAiImageTranslationReadiness(translationSettings, {
          production,
          storageReadiness: translationStorageReadiness,
        });
        if (!readiness.ready) return reply.status(503).send({ code: readiness.reasonCode, msg: readiness.reason });
        const latestJob = Array.isArray(existingWorkflow.jobs)
          ? existingWorkflow.jobs.at(-1) as { provider?: unknown; model?: unknown; estimatedCostCents?: unknown } | undefined
          : undefined;
        const frozenProvider = String(latestJob?.provider || '');
        const frozenModel = String(latestJob?.model || '');
        if (
          !frozenProvider
          || !frozenModel
          || frozenProvider !== translationSettings.provider
          || frozenModel !== translationSettings.model
        ) {
          return reply.status(409).send({
            code: 'PROVIDER_CONFIG_CHANGED',
            msg: 'AI image translation provider configuration changed; create a new workflow',
          });
        }
        const frozenCostCents = Number(latestJob?.estimatedCostCents || 0);
        if (frozenProvider !== 'fake' && (
          translationSettings.estimatedCostCents <= 0
          || frozenCostCents !== translationSettings.estimatedCostCents
        )) {
          return reply.status(409).send({
            code: 'PROVIDER_CONFIG_CHANGED',
            msg: 'AI image translation cost configuration changed; create a new workflow',
          });
        }
        retryEnqueue = enqueueTranslation;
      } else if (['FULL_EDIT', 'INPAINT'].includes(String(existingWorkflow.operation))) {
        const operation = existingWorkflow.operation as 'FULL_EDIT' | 'INPAINT';
        const [editSettings, editStorageReadiness] = await Promise.all([
          getEditSettings(),
          getEditStorageReadiness(),
        ]);
        editRetryDailyLimit = editSettings.dailyLimit;
        const readiness = resolveAiImageEditReadiness(operation, editSettings, {
          workflowEnabled: true,
          production,
          storageReadiness: editStorageReadiness,
        });
        if (!readiness.ready) {
          return reply.status(503).send({ code: readiness.reasonCode, msg: readiness.reason });
        }
        retryEnqueue = enqueueEdit;
      } else {
        const readiness = resolveAiImageToImageReadiness({ production });
        if (!readiness.ready) {
          return reply.status(503).send({ code: readiness.reasonCode, msg: readiness.reason });
        }
      }
      const result = await mediaWorkflowService.retry({
        id: (request.params as any).id,
        ...ids,
        ...parsed.data,
        ...((existingWorkflow as { operation?: string }).operation === 'IMAGE_TRANSLATE'
          ? { dailyLimit: translationRetryDailyLimit }
          : ['FULL_EDIT', 'INPAINT'].includes(String(existingWorkflow.operation))
            ? { dailyLimit: editRetryDailyLimit }
          : {}),
      });
      if (!result.replayed) {
        try {
          await retryEnqueue(result.jobId);
        } catch {
          const failed = repository.markEnqueueFailed
            ? await repository.markEnqueueFailed(result.jobId, {
              attemptCount: 0, errorCode: 'QUEUE_UNAVAILABLE', errorMessage: 'AI media queue is temporarily unavailable',
            })
            : (await repository.markFailed(result.jobId, {
              attemptCount: 0, errorCode: 'QUEUE_UNAVAILABLE', errorMessage: 'AI media queue is temporarily unavailable',
            }), true);
          if (failed) {
            return reply.status(503).send({ code: 'QUEUE_UNAVAILABLE', msg: 'AI media queue is temporarily unavailable' });
          }
        }
      }
      return reply.status(result.replayed ? 200 : 202).send({
        code: 1, data: publicWorkflow(result.workflow), replayed: result.replayed,
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/workflows/:id/review', async (request, reply) => {
    const parsed = reviewSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    try {
      const ids = actor(request);
      const current = await mediaWorkflowService.get((request.params as any).id, ids.ownerUserId);
      assertStandaloneWorkflow(current);
      const currentJob = Array.isArray(current.jobs) ? current.jobs.at(-1) as { provider?: unknown } | undefined : undefined;
      if (String(currentJob?.provider || '') === 'fake' && production) {
        throw new AiMediaWorkflowError('PROVIDER_NOT_READY', 'Test-only AI media candidates cannot be reviewed in production');
      }
      await assertWorkflowSourceCurrent(current, ids.ownerUserId);
      const workflow = await mediaWorkflowService.review({
        id: (request.params as any).id, ...ids, ...parsed.data, note: parsed.data.note || null,
      });
      return { code: 1, data: publicWorkflow(workflow) };
    } catch (error) { return sendError(reply, error); }
  });

  app.get('/contexts/collect/:id', async (request, reply) => {
    if (!await getMediaWorkflowEnabled(actor(request).ownerUserId)) {
      return reply.send({ code: 0, msg: 'AI media workflow is disabled' });
    }
    try {
      const context = await mediaContextService.loadCollect(actor(request).ownerUserId, (request.params as any).id);
      return { code: 1, data: context };
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/contexts/collect/:id/edit-masks', {
    bodyLimit: 30 * 1024 * 1024,
    onRequest: async (request, reply) => {
      const rateCheck = await checkEditMaskRequestRate(actor(request).ownerUserId);
      if (!rateCheck.allowed) {
        return reply.status(429).send({
          code: 'EDIT_RESOURCE_RATE_LIMITED',
          msg: rateCheck.reason,
        });
      }
    },
  }, async (request, reply) => {
    const parsed = editMaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const ids = actor(request);
    try {
      if (!await getMediaWorkflowEnabled(ids.ownerUserId)) {
        return reply.status(503).send({ code: 'AI_MEDIA_WORKFLOW_DISABLED', msg: 'AI media workflow is disabled' });
      }
      await requireSourceListingWebMedia(ids.ownerUserId);
      const [editSettings, editStorageReadiness] = await Promise.all([
        getEditSettings(),
        getEditStorageReadiness(),
      ]);
      const readiness = resolveAiImageEditReadiness('INPAINT', editSettings, {
        workflowEnabled: true,
        production,
        storageReadiness: editStorageReadiness,
      });
      if (!readiness.ready) {
        return reply.status(503).send({ code: readiness.reasonCode, msg: readiness.reason });
      }
      const maskBuffer = decodePngDataUrl(parsed.data.maskDataUrl);
      const result = await createEditMaskAsset({
        ...ids,
        contextId: (request.params as any).id,
        contextSkuKey: parsed.data.skuKey,
        contextSlotKey: parsed.data.slotKey,
        sourceAssetId: parsed.data.sourceAssetId,
        maskBuffer,
        maskSemantics: parsed.data.maskSemantics,
      }, {
        database: prisma as any,
        getStorage: getStorageBackend,
        checkUploadQuota: checkEditMaskUploadQuota,
      });
      return reply.status(result.replayed ? 200 : 201).send({
        code: 1,
        replayed: result.replayed,
        data: {
          id: result.asset.id,
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
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/contexts/collect/:id/internalize', async (request, reply) => {
    const parsed = z.object({
      sourceMediaKey: z.string().trim().min(1).max(500),
      purpose: z.enum(['GENERAL', 'EDIT']).default('GENERAL'),
    }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    if (!await getMediaWorkflowEnabled(actor(request).ownerUserId)) {
      return reply.status(503).send({ code: 'AI_MEDIA_WORKFLOW_DISABLED', msg: 'AI media workflow is disabled' });
    }
    try {
      await requireSourceListingWebMedia(actor(request).ownerUserId);
      const asset = await mediaContextService.internalizeCollect(
        actor(request).ownerUserId,
        (request.params as any).id,
        parsed.data.sourceMediaKey,
        parsed.data.purpose,
      );
      return { code: 1, data: {
        id: asset.id, url: asset.url, mimeType: asset.mimeType,
        width: asset.width, height: asset.height, editReady: asset.editReady,
      } };
    } catch (error) { return sendError(reply, error); }
  });
}
