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
import {
  getAiMediaRolloutDecision,
  type AiMediaRolloutDecision,
} from '../services/ai-media-rollout.js';
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
import { resolveAiImageTranslationGlossary } from '../services/ai-image-translation-glossary.js';
import {
  resolveAiImageEditStorageReadiness,
  type AiImageEditStorageReadiness,
} from '../services/ai-image-edit-storage.js';
import { resolveAiImageProviderCapability } from '../services/ai-image-provider-capabilities.js';
import { buildAiImageGenerationQuote } from '../services/ai-image-generation-quote.js';
import {
  assertAiImageProviderRuntimeContract,
} from '../services/ai-image-provider-runtime-contract.js';
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
import {
  AI_MEDIA_APPLICATION_CONTRACT_VERSION,
  AiMediaApplicationMutationError,
  applyAiMediaWorkflowApplication,
  listAiMediaTargetApplications,
  listAiMediaWorkflowApplications,
  rollbackAiMediaWorkflowApplication,
  type ApplyAiMediaWorkflowApplicationInput,
  type ListAiMediaTargetApplicationsInput,
  type ListAiMediaWorkflowApplicationsInput,
  type RollbackAiMediaWorkflowApplicationInput,
} from '../services/ai-media-application-mutations.js';
import {
  applyAiMediaListingDraftApplication,
  listAiMediaListingDraftApplications,
  rollbackAiMediaListingDraftApplication,
  type ApplyAiMediaListingDraftApplicationInput,
  type ListAiMediaListingDraftApplicationsInput,
  type RollbackAiMediaListingDraftApplicationInput,
} from '../services/ai-media-listing-draft-application-mutations.js';

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
const workflowApplicationSchema = z.object({
  mode: z.enum(['append', 'replace']),
  operationKey: z.string().trim().min(8).max(128),
  expectedWorkflowRevision: z.number().int().min(1),
  expectedTargetUpdatedAt: z.string().datetime(),
  replaceConfirmed: z.literal(true).optional(),
}).strict().superRefine((value, context) => {
  if (value.mode === 'replace' && value.replaceConfirmed !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['replaceConfirmed'],
      message: 'Replacing all publish images requires explicit confirmation',
    });
  }
});
const workflowApplicationListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  beforeSequence: z.coerce.number().int().min(1).optional(),
  operationKey: z.string().trim().min(8).max(128).optional(),
}).strict();
const targetApplicationListSchema = workflowApplicationListSchema.extend({
  targetType: z.literal('collect'),
  targetId: z.string().trim().min(1).max(200),
});
const workflowApplicationRollbackSchema = z.object({
  operationKey: z.string().trim().min(8).max(128),
  expectedApplicationRevision: z.number().int().min(1),
  expectedWorkflowRevision: z.number().int().min(1),
  expectedTargetUpdatedAt: z.string().datetime(),
}).strict();
const listingDraftApplicationSchema = z.object({
  mode: z.enum(['append', 'replace']),
  operationKey: z.string().trim().min(8).max(128),
  expectedWorkflowRevision: z.number().int().min(1),
  expectedTargetRevision: z.number().int().min(1),
  expectedTargetDraftVersion: z.number().int().min(1),
  replaceConfirmed: z.literal(true).optional(),
}).strict().superRefine((value, context) => {
  if (value.mode === 'replace' && value.replaceConfirmed !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['replaceConfirmed'],
      message: 'Replacing a listing draft slot requires explicit confirmation',
    });
  }
});
const listingDraftApplicationRollbackSchema = z.object({
  operationKey: z.string().trim().min(8).max(128),
  expectedApplicationRevision: z.number().int().min(1),
  expectedWorkflowRevision: z.number().int().min(1),
  expectedTargetRevision: z.number().int().min(1),
  expectedTargetDraftVersion: z.number().int().min(1),
}).strict();
const listingDraftApplicationListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  beforeSequence: z.coerce.number().int().min(1).optional(),
  operationKey: z.string().trim().min(8).max(128).optional(),
}).strict();
const collectWorkflowContextSchema = z.object({
  type: z.literal('collect'),
  id: z.string().trim().min(1).max(200),
  skuKey: z.string().trim().min(1).max(500).nullable().optional(),
  slotKey: z.string().trim().min(1).max(200).nullable().optional(),
});
const listingDraftWorkflowContextSchema = z.object({
  type: z.literal('listing-draft'),
  id: z.string().trim().min(1).max(200),
  revision: z.number().int().min(1),
  draftVersion: z.number().int().min(1),
  skuKey: z.string().trim().min(1).max(500).nullable().optional(),
  slotKey: z.string().trim().min(1).max(1024).nullable().optional(),
});
const workflowContextSchema = z.discriminatedUnion('type', [
  collectWorkflowContextSchema,
  listingDraftWorkflowContextSchema,
]);
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
const listingDraftEditMaskSchema = editMaskSchema.extend({
  revision: z.number().int().min(1),
  draftVersion: z.number().int().min(1),
});

interface AiImageRouteSettings {
  enabled: boolean;
  provider: string;
  model: string;
  baseUrl?: string;
  dailyLimit: number;
  estimatedCostCents: number;
  globalDailyBudgetCents?: number;
}

interface AiImageTranslationRouteSettings {
  enabled: boolean;
  provider: string;
  model: string;
  dailyLimit: number;
  estimatedCostCents: number;
  globalDailyBudgetCents: number;
  categoryGlossaryJson: string;
}

interface AiImageEditRouteSettings {
  imageToImageEnabled: boolean;
  fullEditEnabled: boolean;
  inpaintEnabled: boolean;
  dailyLimit: number;
  provider: string;
  model: string;
  baseUrl: string;
  estimatedCostCents: number;
  globalDailyBudgetCents: number;
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
  getTranslationCategory?: (input: {
    ownerUserId: string;
    context: z.infer<typeof workflowContextSchema>;
  }) => Promise<{ categoryId: number; typeId: number } | null>;
  getTranslationStorageReadiness?: () => Promise<AiImageTranslationStorageReadiness>;
  getEditSettings?: () => Promise<AiImageEditRouteSettings>;
  getGlobalDailyBudgetCents?: () => Promise<number>;
  getEditStorageReadiness?: () => Promise<AiImageEditStorageReadiness>;
  getOwnedAssetDimensions?: (
    ownerUserId: string,
    assetId: string,
  ) => Promise<{ width: number; height: number } | null>;
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
  getMediaWorkflowDecision?: (ownerUserId: string) => Promise<AiMediaRolloutDecision>;
  getMediaWorkflowEnabled?: (ownerUserId: string) => Promise<boolean>;
  applyAssets?: (input: ApplyAiImageAssetsInput) => Promise<ApplyAiImageAssetsResult>;
  applyWorkflowApplication?: (input: ApplyAiMediaWorkflowApplicationInput) => Promise<any>;
  listTargetApplications?: (input: ListAiMediaTargetApplicationsInput) => Promise<any>;
  listWorkflowApplications?: (input: ListAiMediaWorkflowApplicationsInput) => Promise<any>;
  rollbackWorkflowApplication?: (input: RollbackAiMediaWorkflowApplicationInput) => Promise<any>;
  applyListingDraftApplication?: (input: ApplyAiMediaListingDraftApplicationInput) => Promise<any>;
  listListingDraftApplications?: (input: ListAiMediaListingDraftApplicationsInput) => Promise<any>;
  rollbackListingDraftApplication?: (input: RollbackAiMediaListingDraftApplicationInput) => Promise<any>;
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
          || error.code === 'AI_IMAGE_GENERATION_QUOTA_EXCEEDED'
          || error.code === 'BUDGET_EXCEEDED'
          ? 429
        : error.code === 'AI_MEDIA_OPERATION_DISABLED'
          || error.code === 'AI_MEDIA_WORKFLOW_DISABLED'
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
  if (error instanceof AiMediaApplicationMutationError) {
    const status = error.code === 'NOT_FOUND' || error.code === 'TARGET_NOT_FOUND'
      ? 404
      : error.code === 'PROVIDER_NOT_READY'
        ? 503
      : [
        'IDEMPOTENCY_KEY_CONFLICT',
        'WORKFLOW_CONFLICT',
        'TARGET_CONFLICT',
        'APPLICATION_CONFLICT',
        'APPLICATION_NO_CHANGE',
        'LEGACY_APPLICATION',
        'ALREADY_ROLLED_BACK',
        'ROLLBACK_ORDER_CONFLICT',
        'ROLLBACK_TARGET_CHANGED',
        'STALE_MEDIA_WORKFLOW',
      ].includes(error.code)
        ? 409
        : 400;
    return reply.status(status).send({ code: error.code, msg: error.message, data: error.data });
  }
  if (error instanceof AiImageJobError) {
    const status = error.code === 'NOT_FOUND' || error.code === 'SOURCE_ASSET_NOT_FOUND'
      ? 404
      : error.code === 'IDEMPOTENCY_KEY_CONFLICT'
        || error.code === 'STALE_MEDIA_WORKFLOW'
        || error.code === 'APPLICATION_MUTATION_REQUIRED'
        ? 409
      : error.code === 'QUOTA_EXCEEDED'
          || error.code === 'BUDGET_EXCEEDED'
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
  options: {
    enabled?: boolean;
    workflowEnabled?: boolean;
    production?: boolean;
    provider?: string;
    model?: string;
    estimatedCostCents?: number;
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
  if (options.enabled !== true) {
    return {
      enabled: false,
      ready: false,
      reasonCode: 'AI_MEDIA_OPERATION_DISABLED',
      reason: 'AI image-to-image is disabled',
    };
  }
  const provider = options.provider || 'fake';
  const model = provider === 'fake'
    ? 'fake-image-to-image-v1'
    : options.model || '';
  const capability = resolveAiImageProviderCapability(provider, model);
  if (!capability?.operations.includes('IMAGE_TO_IMAGE')) {
    return {
      enabled: true,
      ready: false,
      reasonCode: 'PROVIDER_NOT_READY',
      reason: 'AI image-to-image Provider/model is not supported',
    };
  }
  if (provider === 'fake') {
    if (options.production ?? process.env.NODE_ENV === 'production') {
      return {
        enabled: true,
        ready: false,
        reasonCode: 'PROVIDER_NOT_READY',
        reason: 'The fake image-to-image Provider is test-only',
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
    return {
      enabled: true,
      ready: true,
      reasonCode: 'READY',
      reason: 'AI image-to-image workflow is ready',
      testOnly: true,
    };
  }
  if (capability.evidenceLevel !== 'sandbox-verified') {
    return {
      enabled: true,
      ready: false,
      reasonCode: 'PROVIDER_NOT_READY',
      reason: 'AI image-to-image Provider has not passed its sandbox capability gate',
    };
  }
  if (!Number.isSafeInteger(options.estimatedCostCents) || Number(options.estimatedCostCents) < 1) {
    return {
      enabled: true,
      ready: false,
      reasonCode: 'PROVIDER_NOT_READY',
      reason: 'A verified positive image-to-image cost is required before paid dispatch',
    };
  }
  if (!options.storageReadiness?.ready) {
    return {
      enabled: true,
      ready: false,
      reasonCode: 'STORAGE_NOT_READY',
      reason: options.storageReadiness?.reason || 'AI image-to-image requires owned local or OSS storage',
    };
  }
  return {
    enabled: true,
    ready: true,
    reasonCode: 'READY',
    reason: 'AI image-to-image workflow is ready',
  };
}

export function resolveAiImageEditReadiness(
  operation: 'FULL_EDIT' | 'INPAINT',
  settings: {
    fullEditEnabled: boolean;
    inpaintEnabled: boolean;
    provider?: string;
    model?: string;
    estimatedCostCents?: number;
  },
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
  const provider = settings.provider || 'fake';
  const model = provider === 'fake'
    ? 'fake-image-edit-v1'
    : settings.model || '';
  const capability = resolveAiImageProviderCapability(provider, model);
  if (!capability?.operations.includes(operation)) {
    return {
      enabled: true,
      ready: false,
      reasonCode: 'PROVIDER_NOT_READY',
      reason: 'AI image edit Provider/model is not supported',
    };
  }
  if (provider === 'fake' && (options.production ?? process.env.NODE_ENV === 'production')) {
    return {
      enabled: true,
      ready: false,
      reasonCode: 'PROVIDER_NOT_READY',
      reason: 'The fake image edit Provider is test-only',
      testOnly: true,
    };
  }
  if (provider !== 'fake' && capability.evidenceLevel !== 'sandbox-verified') {
    return {
      enabled: true,
      ready: false,
      reasonCode: 'PROVIDER_NOT_READY',
      reason: 'AI image edit Provider has not passed its sandbox capability gate',
    };
  }
  if (provider !== 'fake' && (
    !Number.isSafeInteger(settings.estimatedCostCents)
    || Number(settings.estimatedCostCents) < 1
  )) {
    return {
      enabled: true,
      ready: false,
      reasonCode: 'PROVIDER_NOT_READY',
      reason: 'A verified positive image edit cost is required before paid dispatch',
    };
  }
  if (options.storageReadiness && !options.storageReadiness.ready) {
    return {
      enabled: true,
      ready: false,
      reasonCode: 'STORAGE_NOT_READY',
      reason: options.storageReadiness.reason,
      ...(provider === 'fake' ? { testOnly: true } : {}),
    };
  }
  return {
    enabled: true,
    ready: true,
    reasonCode: 'READY',
    reason: operation === 'FULL_EDIT' ? 'Full-image edit is ready' : 'Masked inpaint is ready',
    ...(provider === 'fake' ? { testOnly: true } : {}),
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

function publicWorkflowApplication(workflow: any) {
  const listingDraftMutation = Array.isArray(workflow.listingDraftApplicationMutations)
    ? workflow.listingDraftApplicationMutations[0]
    : null;
  if (listingDraftMutation?.id) {
    const rollback = listingDraftMutation.rolledBackBy || null;
    return {
      id: String(listingDraftMutation.id),
      revision: rollback ? 2 : 1,
      state: rollback ? 'ROLLED_BACK' : 'APPLIED',
      mode: listingDraftMutation.mode === 'REPLACE' ? 'replace' : 'append',
      workflowId: String(listingDraftMutation.workflowId),
      jobId: String(listingDraftMutation.jobId),
      outputAssetId: String(listingDraftMutation.assetId),
      targetType: 'listing-draft',
      targetId: String(listingDraftMutation.targetId),
      contextSkuKey: listingDraftMutation.contextSkuKey || null,
      contextSlotKey: listingDraftMutation.contextSlotKey || null,
      appliedAt: listingDraftMutation.createdAt,
      rolledBackAt: rollback?.createdAt || null,
      targetUpdatedAt: rollback?.createdAt || listingDraftMutation.createdAt,
      legacy: false,
    };
  }
  const mutation = Array.isArray(workflow.applicationMutations)
    ? workflow.applicationMutations[0]
    : null;
  if (mutation?.id) {
    const rollback = mutation.rolledBackBy || null;
    return {
      id: String(mutation.id),
      revision: rollback ? 2 : 1,
      state: rollback ? 'ROLLED_BACK' : 'APPLIED',
      mode: mutation.mode === 'REPLACE' ? 'replace' : 'append',
      workflowId: String(mutation.workflowId),
      jobId: String(mutation.jobId),
      outputAssetId: String(mutation.assetId),
      targetType: 'collect',
      targetId: String(mutation.targetId),
      contextSkuKey: mutation.contextSkuKey || null,
      contextSlotKey: mutation.contextSlotKey || null,
      appliedAt: mutation.createdAt,
      rolledBackAt: rollback?.createdAt || null,
      targetUpdatedAt: rollback?.targetVersionAfter || mutation.targetVersionAfter,
      legacy: false,
    };
  }
  const currentJob = Array.isArray(workflow.jobs) ? workflow.jobs.at(-1) : null;
  if (!currentJob?.appliedAt || !currentJob.applyTargetId || !currentJob.appliedMode) return null;
  return {
    id: null,
    revision: 1,
    state: 'APPLIED',
    mode: currentJob.appliedMode === 'replace' ? 'replace' : 'append',
    workflowId: String(workflow.id),
    jobId: String(currentJob.id),
    outputAssetId: workflow.selectedOutputAssetId || '',
    targetType: currentJob.applyTargetType === 'collect' ? 'collect' : currentJob.applyTargetType,
    targetId: String(currentJob.applyTargetId),
    contextSkuKey: workflow.contextSkuKey || null,
    contextSlotKey: workflow.contextSlotKey || null,
    appliedAt: currentJob.appliedAt,
    rolledBackAt: null,
    targetUpdatedAt: currentJob.appliedAt,
    legacy: true,
    rollbackEligible: false,
    rollbackIneligibilityReason: 'LEGACY_NO_LEDGER',
  };
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
    contextDraftRevision: workflow.contextDraftRevision ?? null,
    contextDraftVersion: workflow.contextDraftVersion ?? null,
    selectedOutputAssetId: workflow.selectedOutputAssetId,
    reviewedAt: workflow.reviewedAt,
    completedAt: workflow.completedAt,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    application: publicWorkflowApplication(workflow),
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

function retryProviderConfigMatches(
  job: Record<string, unknown> | undefined,
  operation: 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT',
  settings: AiImageEditRouteSettings,
): boolean {
  if (!job) return false;
  const provider = String(job.provider || '');
  const model = String(job.model || '');
  const count = Number(job.requestedImageCount || 0);
  const width = Number(job.width || 0);
  const height = Number(job.height || 0);
  const estimatedCostCents = Number(job.estimatedCostCents || 0);
  const activeModel = settings.provider === 'fake'
    ? operation === 'IMAGE_TO_IMAGE' ? 'fake-image-to-image-v1' : 'fake-image-edit-v1'
    : settings.model;
  if (provider !== settings.provider || model !== activeModel) return false;
  if (provider === 'fake') {
    return estimatedCostCents === 0 && count === 1 && width > 0 && height > 0;
  }
  const operationConfig = job.operationConfig;
  const runtime = operation === 'IMAGE_TO_IMAGE'
    ? operationConfig
    : operationConfig && typeof operationConfig === 'object' && !Array.isArray(operationConfig)
      ? (operationConfig as Record<string, unknown>).providerRuntime
      : null;
  try {
    assertAiImageProviderRuntimeContract(runtime, {
      provider: settings.provider,
      model: settings.model,
      baseUrl: settings.baseUrl,
      costPerImageCents: settings.estimatedCostCents,
    }, {
      count,
      width,
      height,
      estimatedCostCents,
    });
    return true;
  } catch {
    return false;
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
    providerReconciliationStatus,
    providerReconciliationRevision,
    providerReconciliationAttemptCount,
    providerReconciliationNextAt,
    providerReconciliationDeadlineAt,
    providerReconciliationLeaseOwner: _providerReconciliationLeaseOwner,
    providerReconciliationLeaseTokenHash: _providerReconciliationLeaseTokenHash,
    providerReconciliationLeaseExpiresAt: _providerReconciliationLeaseExpiresAt,
    providerReconciliationLastProviderStatus,
    providerReconciliationLastErrorCode,
    providerReconciliationLastErrorMessage,
    providerReconciledAt,
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
  const costStatus = typeof (costReservation as { status?: unknown } | null)?.status === 'string'
    ? (costReservation as { status: string }).status
    : null;
  const reconciliationStatus = typeof providerReconciliationStatus === 'string'
    ? providerReconciliationStatus
    : 'NOT_REQUIRED';
  const providerResultTerminalWithoutOutput = ['NO_OUTPUT', 'NOT_SUBMITTED']
    .includes(reconciliationStatus);
  const providerResultNeedsReconciliation = Boolean(visible.providerJobId)
    || visible.errorCode === 'PROVIDER_SUBMISSION_UNCERTAIN'
    || reconciliationStatus !== 'NOT_REQUIRED';
  const costAllowsRetry = costStatus == null || ['SETTLED', 'RELEASED'].includes(costStatus);
  const retryAllowed = workflow?.status === 'FAILED'
    && costAllowsRetry
    && (!providerResultNeedsReconciliation || providerResultTerminalWithoutOutput);
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
    costStatus,
    retryAllowed,
    providerReconciliation: {
      status: reconciliationStatus,
      revision: Number(providerReconciliationRevision || 0),
      attemptCount: Number(providerReconciliationAttemptCount || 0),
      nextAt: providerReconciliationNextAt || null,
      deadlineAt: providerReconciliationDeadlineAt || null,
      lastProviderStatus: providerReconciliationLastProviderStatus || null,
      lastErrorCode: providerReconciliationLastErrorCode || null,
      lastErrorMessage: providerReconciliationLastErrorMessage || null,
      reconciledAt: providerReconciledAt || null,
      actionRequired: reconciliationStatus === 'MANUAL_REVIEW',
    },
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
    baseUrl: await getConfig('ai_image_base_url'),
    model: await getConfig('ai_image_model'),
    dailyLimit: await getConfig('ai_user_daily_image_generation_limit'),
    estimatedCostCents: await getConfig('ai_image_generation_cost_cents'),
    globalDailyBudgetCents: await getConfig('ai_daily_budget_cents'),
  }));
  const getTranslationSettings = options.getTranslationSettings || (async () => ({
    enabled: await getConfig('feature_image_translate'),
    provider: await getConfig('ai_image_translation_provider'),
    model: await getConfig('ai_image_translation_model'),
    dailyLimit: await getConfig('ai_user_daily_image_translation_limit'),
    estimatedCostCents: await getConfig('ai_image_translation_cost_cents'),
    globalDailyBudgetCents: await getConfig('ai_daily_budget_cents'),
    categoryGlossaryJson: await getConfig('ai_image_translation_category_glossary_json'),
  }));
  const getTranslationCategory = options.getTranslationCategory || (async () => null);
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
    imageToImageEnabled: await getConfig('feature_ai_media_image_to_image'),
    fullEditEnabled: await getConfig('feature_ai_media_full_edit'),
    inpaintEnabled: await getConfig('feature_ai_media_inpaint'),
    dailyLimit: await getConfig('ai_user_daily_image_generation_limit'),
    provider: await getConfig('ai_image_provider'),
    model: await getConfig('ai_image_model'),
    baseUrl: await getConfig('ai_image_base_url'),
    estimatedCostCents: await getConfig('ai_image_generation_cost_cents'),
    globalDailyBudgetCents: await getConfig('ai_daily_budget_cents'),
  }));
  const getGlobalDailyBudgetCents = options.getGlobalDailyBudgetCents
    || (async () => getConfig('ai_daily_budget_cents'));
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
  const getOwnedAssetDimensions = options.getOwnedAssetDimensions || (async (
    ownerUserId: string,
    assetId: string,
  ) => {
    const asset = await (prisma as any).mediaAsset.findFirst({
      where: { id: assetId, ownerUserId },
      select: { width: true, height: true },
    });
    return Number.isSafeInteger(asset?.width)
      && Number(asset.width) > 0
      && Number.isSafeInteger(asset?.height)
      && Number(asset.height) > 0
      ? { width: Number(asset.width), height: Number(asset.height) }
      : null;
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
  const getMediaWorkflowDecision = options.getMediaWorkflowDecision
    || (options.getMediaWorkflowEnabled
      ? async (ownerUserId: string): Promise<AiMediaRolloutDecision> => {
        const enabled = await options.getMediaWorkflowEnabled!(ownerUserId);
        return {
          enabled,
          revision: 0,
          reason: enabled ? 'tenant_allowed' : 'master_off',
        };
      }
      : getAiMediaRolloutDecision);
  const getMediaWorkflowEnabled = async (ownerUserId: string) => (
    await getMediaWorkflowDecision(ownerUserId)
  ).enabled;
  const applyAssets = options.applyAssets
    || ((input: ApplyAiImageAssetsInput) => applyAiImageAssets(prisma as any, input));
  const applyWorkflowApplication = options.applyWorkflowApplication
    || ((input: ApplyAiMediaWorkflowApplicationInput) => applyAiMediaWorkflowApplication(prisma, input));
  const listTargetApplications = options.listTargetApplications
    || ((input: ListAiMediaTargetApplicationsInput) => listAiMediaTargetApplications(prisma, input));
  const listWorkflowApplications = options.listWorkflowApplications
    || ((input: ListAiMediaWorkflowApplicationsInput) => listAiMediaWorkflowApplications(prisma, input));
  const rollbackWorkflowApplication = options.rollbackWorkflowApplication
    || ((input: RollbackAiMediaWorkflowApplicationInput) => rollbackAiMediaWorkflowApplication(prisma, input));
  const applyListingDraftApplication = options.applyListingDraftApplication
    || ((input: ApplyAiMediaListingDraftApplicationInput) => (
      applyAiMediaListingDraftApplication(prisma, input)
    ));
  const listListingDraftApplications = options.listListingDraftApplications
    || ((input: ListAiMediaListingDraftApplicationsInput) => (
      listAiMediaListingDraftApplications(prisma, input)
    ));
  const rollbackListingDraftApplication = options.rollbackListingDraftApplication
    || ((input: RollbackAiMediaListingDraftApplicationInput) => (
      rollbackAiMediaListingDraftApplication(prisma, input)
    ));
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
    if (!workflow.contextId) return;
    let currentContext;
    try {
      currentContext = workflow.contextType === 'listing-draft'
        ? await mediaContextService.loadListingDraft(ownerUserId, workflow.contextId, {
          expectedRevision: workflow.contextDraftRevision,
          expectedDraftVersion: workflow.contextDraftVersion,
          skuKey: workflow.contextSkuKey,
          slotKey: workflow.contextSlotKey,
        })
        : workflow.contextType === 'collect'
          ? await mediaContextService.loadCollect(ownerUserId, workflow.contextId)
          : null;
    } catch (error) {
      if (workflow.contextType === 'listing-draft' && error instanceof AiMediaContextError) {
        throw new AiMediaWorkflowError(
          'STALE_MEDIA_WORKFLOW',
          'The listing draft changed; review and generate a new candidate',
        );
      }
      throw error;
    }
    if (!currentContext) return;
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
      workflowDecision,
      webMediaDecision,
      translationSettings,
      translationStorageReadiness,
      editSettings,
      editStorageReadiness,
    ] = await Promise.all([
      getMediaWorkflowDecision(ids.ownerUserId),
      getSourceListingWebMediaDecision(ids.ownerUserId),
      getTranslationSettings(),
      getTranslationStorageReadiness(),
      getEditSettings(),
      getEditStorageReadiness(),
    ]);
    const workflowEnabled = workflowDecision.enabled;
    const translation = resolveAiImageTranslationReadiness(translationSettings, {
      workflowEnabled,
      production,
      storageReadiness: translationStorageReadiness,
    });
    const imageToImage = resolveAiImageToImageReadiness({
      enabled: editSettings.imageToImageEnabled,
      workflowEnabled,
      production,
      provider: editSettings.provider,
      model: editSettings.model,
      estimatedCostCents: editSettings.estimatedCostCents,
      storageReadiness: editStorageReadiness,
    });
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
        workflowReason: workflowDecision.reason,
        workflowRevision: workflowDecision.revision,
        applications: {
          contractVersion: AI_MEDIA_APPLICATION_CONTRACT_VERSION,
          readEnabled: true,
          applyEnabled: workflowEnabled && webMediaDecision.enabled,
          listingDraftApplyEnabled: !production && workflowEnabled && webMediaDecision.enabled,
          rollbackEnabled: true,
          defaultMode: 'append',
          replaceOperations: ['IMAGE_TO_IMAGE'],
        },
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
    const generationCapability = resolveAiImageProviderCapability(settings.provider, settings.model);
    if (settings.provider !== 'fake' && (
      generationCapability?.evidenceLevel !== 'sandbox-verified'
      || settings.estimatedCostCents <= 0
    )) {
      return reply.status(503).send({
        code: 'PROVIDER_NOT_READY',
        msg: 'AI image provider has not passed its paid dispatch and cost gates',
      });
    }
    const ids = actor(request);
    try {
      const workflowDecision = await getMediaWorkflowDecision(ids.ownerUserId);
      if (!workflowDecision.enabled) {
        return reply.status(503).send({
          code: 'AI_MEDIA_WORKFLOW_DISABLED',
          msg: 'AI media workflow is disabled',
        });
      }
      const quote = buildAiImageGenerationQuote({
        provider: settings.provider,
        model: settings.model,
        baseUrl: settings.baseUrl || '',
        costPerImageCents: settings.estimatedCostCents,
      }, {
        count: parsed.data.count,
        width: parsed.data.width,
        height: parsed.data.height,
      });
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
        operationConfig: quote.operationConfig,
        provider: settings.provider,
        model: settings.model,
        count: parsed.data.count,
        width: parsed.data.width,
        height: parsed.data.height,
        estimatedCostCents: quote.estimatedCostCents,
      }, repository, settings.dailyLimit, settings.provider === 'fake'
        ? undefined
        : settings.globalDailyBudgetCents ?? 0);
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
      if (ownedJob.workflowId) {
        throw new AiImageJobError(
          'APPLICATION_MUTATION_REQUIRED',
          'Workflow-backed candidates must use the versioned application mutation endpoint',
        );
      }
      if (ownedJob.operation === 'IMAGE_TRANSLATE' && parsed.data.mode !== 'append') {
        throw new AiImageJobError(
          'UNSAFE_APPLY_MODE',
          'Image translation candidates can only be appended to existing product images',
        );
      }
      const application = await applyAssets({
        jobId: id,
        ownerUserId: actor(request).ownerUserId,
        actorUserId: actor(request).actorUserId,
        ...parsed.data,
        selectedAssetId: null,
      });
      return { code: 1, data: application };
    } catch (error) { return sendError(reply, error); }
  });

  app.get('/applications', async (request, reply) => {
    const parsed = targetApplicationListSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    try {
      const result = await listTargetApplications({
        ownerUserId: actor(request).ownerUserId,
        targetId: parsed.data.targetId,
        limit: parsed.data.limit,
        beforeSequence: parsed.data.beforeSequence,
        operationKey: parsed.data.operationKey,
      });
      return { code: 1, data: result };
    } catch (error) { return sendError(reply, error); }
  });

  app.get('/contexts/listing-draft/:id/applications', async (request, reply) => {
    const parsed = listingDraftApplicationListSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const { id } = request.params as { id: string };
    try {
      const result = await listListingDraftApplications({
        targetId: id,
        ownerUserId: actor(request).ownerUserId,
        ...parsed.data,
      });
      return { code: 1, data: result };
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/workflows/:id/listing-draft-application', async (request, reply) => {
    const parsed = listingDraftApplicationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const ids = actor(request);
    const { id } = request.params as { id: string };
    try {
      if (!await getMediaWorkflowEnabled(ids.ownerUserId)) {
        throw new AiMediaWorkflowError(
          'AI_MEDIA_WORKFLOW_DISABLED',
          'AI media workflow is disabled',
        );
      }
      await requireSourceListingWebMedia(ids.ownerUserId);
      const result = await applyListingDraftApplication({
        workflowId: id,
        ownerUserId: ids.ownerUserId,
        actorUserId: ids.actorUserId,
        production,
        ...parsed.data,
      });
      return reply.status(result.replayed ? 200 : 201).send({ code: 1, data: result });
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/listing-draft-applications/:id/rollback', async (request, reply) => {
    const parsed = listingDraftApplicationRollbackSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const ids = actor(request);
    const { id } = request.params as { id: string };
    try {
      const result = await rollbackListingDraftApplication({
        applicationId: id,
        ownerUserId: ids.ownerUserId,
        actorUserId: ids.actorUserId,
        ...parsed.data,
      });
      return reply.status(result.replayed ? 200 : 201).send({ code: 1, data: result });
    } catch (error) { return sendError(reply, error); }
  });

  app.get('/workflows/:id/applications', async (request, reply) => {
    const parsed = workflowApplicationListSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const { id } = request.params as { id: string };
    try {
      const result = await listWorkflowApplications({
        workflowId: id,
        ownerUserId: actor(request).ownerUserId,
        ...parsed.data,
      });
      return { code: 1, data: result };
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/workflows/:id/applications', async (request, reply) => {
    const parsed = workflowApplicationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const ids = actor(request);
    const { id } = request.params as { id: string };
    try {
      if (!await getMediaWorkflowEnabled(ids.ownerUserId)) {
        throw new AiMediaWorkflowError(
          'AI_MEDIA_WORKFLOW_DISABLED',
          'AI media workflow is disabled',
        );
      }
      await requireSourceListingWebMedia(ids.ownerUserId);
      const existing = await mediaWorkflowService.get(id, ids.ownerUserId);
      const currentJob = Array.isArray(existing.jobs)
        ? existing.jobs.find((job: any) => Array.isArray(job.assets)
          && job.assets.some((asset: any) => asset.id === existing.selectedOutputAssetId))
        : null;
      if (production && currentJob?.provider === 'fake') {
        throw new AiMediaWorkflowError(
          'PROVIDER_NOT_READY',
          'Test-only AI media candidates cannot be applied in production',
        );
      }
      const result = await applyWorkflowApplication({
        workflowId: id,
        ownerUserId: ids.ownerUserId,
        actorUserId: ids.actorUserId,
        production,
        ...parsed.data,
      });
      return reply.status(result.replayed ? 200 : 201).send({ code: 1, data: result });
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/applications/:id/rollback', async (request, reply) => {
    const parsed = workflowApplicationRollbackSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const ids = actor(request);
    const { id } = request.params as { id: string };
    try {
      const result = await rollbackWorkflowApplication({
        applicationId: id,
        ownerUserId: ids.ownerUserId,
        actorUserId: ids.actorUserId,
        ...parsed.data,
      });
      return reply.status(result.replayed ? 200 : 201).send({ code: 1, data: result });
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
        const category = parsed.data.context.type === 'listing-draft'
          ? await getTranslationCategory({ ownerUserId: ids.ownerUserId, context: parsed.data.context })
          : null;
        let glossary;
        try {
          glossary = resolveAiImageTranslationGlossary({
            config: translationSettings.categoryGlossaryJson,
            sourceLanguage,
            targetLanguage,
            ...(category || {}),
            explicitTerms: parsed.data.terminologies,
          });
        } catch {
          return reply.status(503).send({
            code: 'IMAGE_TRANSLATION_GLOSSARY_INVALID',
            msg: 'AI image translation glossary configuration is invalid',
          });
        }
        const terminologies = glossary.terms;
        if (translationSettings.provider !== 'fake' && terminologies.length === 0) {
          return reply.status(503).send({
            code: 'IMAGE_TRANSLATION_GLOSSARY_NOT_READY',
            msg: 'A trusted image translation glossary is required before paid dispatch',
          });
        }
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
          globalDailyBudgetCents: translationSettings.globalDailyBudgetCents,
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
        const dimensions = await getOwnedAssetDimensions(
          ids.ownerUserId,
          parsed.data.sourceAssetId,
        );
        if (!dimensions) {
          return reply.status(404).send({
            code: 'SOURCE_ASSET_NOT_FOUND',
            msg: 'Owned source image dimensions were not found',
          });
        }
        let providerExecution: Record<string, unknown> = {};
        if (editSettings.provider !== 'fake') {
          const quote = buildAiImageGenerationQuote({
            provider: editSettings.provider,
            model: editSettings.model,
            baseUrl: editSettings.baseUrl,
            costPerImageCents: editSettings.estimatedCostCents,
          }, { count: 1, ...dimensions });
          providerExecution = {
            provider: editSettings.provider,
            model: editSettings.model,
            estimatedCostCents: quote.estimatedCostCents,
            globalDailyBudgetCents: editSettings.globalDailyBudgetCents,
            providerRuntimeContract: quote.operationConfig,
          };
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
          width: dimensions.width,
          height: dimensions.height,
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
          ...providerExecution,
          idempotencyKey: parsed.data.idempotencyKey,
          context: parsed.data.context,
        });
        enqueueOperation = enqueueEdit;
      } else {
        const [editSettings, editStorageReadiness] = await Promise.all([
          getEditSettings(),
          getEditStorageReadiness(),
        ]);
        const readiness = resolveAiImageToImageReadiness({
          enabled: editSettings.imageToImageEnabled,
          production,
          provider: editSettings.provider,
          model: editSettings.model,
          estimatedCostCents: editSettings.estimatedCostCents,
          storageReadiness: editStorageReadiness,
        });
        if (!readiness.ready) {
          return reply.status(503).send({ code: readiness.reasonCode, msg: readiness.reason });
        }
        let providerExecution: Record<string, unknown> = {};
        if (editSettings.provider !== 'fake') {
          const quote = buildAiImageGenerationQuote({
            provider: editSettings.provider,
            model: editSettings.model,
            baseUrl: editSettings.baseUrl,
            costPerImageCents: editSettings.estimatedCostCents,
          }, {
            count: parsed.data.count,
            width: parsed.data.width,
            height: parsed.data.height,
          });
          providerExecution = {
            provider: editSettings.provider,
            model: editSettings.model,
            estimatedCostCents: quote.estimatedCostCents,
            globalDailyBudgetCents: editSettings.globalDailyBudgetCents,
            providerRuntimeContract: quote.operationConfig,
          };
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
          dailyLimit: editSettings.dailyLimit,
          ...providerExecution,
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
      cursor: z.string().trim().min(1).max(1000).optional(),
      pageVersion: z.literal('1').optional(),
    }).refine(
      (value) => !value.cursor || value.pageVersion === '1',
      { message: 'Workflow cursor requires pageVersion=1' },
    ).refine(
      (value) => value.pageVersion !== '1' || Boolean(value.contextType && value.contextId),
      { message: 'Paginated workflow history requires an explicit context' },
    ).safeParse(request.query);
    if (!query.success) return reply.status(400).send({ code: 'INVALID_REQUEST', msg: query.error.issues[0]?.message });
    try {
      const result = await mediaWorkflowService.list({
        ownerUserId: actor(request).ownerUserId,
        contextType: query.data.contextType,
        contextId: query.data.contextId,
        limit: query.data.limit,
        cursor: query.data.cursor,
        includePriority: query.data.pageVersion === '1' && !query.data.cursor,
      });
      const page = Array.isArray(result)
        ? {
          items: result,
          priorityItems: [],
          priorityItemsTruncated: false,
          priorityNextCursor: null,
          nextCursor: null,
        }
        : result;
      if (query.data.pageVersion !== '1') {
        return { code: 1, data: page.items.map(publicWorkflow) };
      }
      return {
        code: 1,
        data: {
          items: page.items.map(publicWorkflow),
          priorityItems: (page.priorityItems || []).map(publicWorkflow),
          priorityItemsTruncated: page.priorityItemsTruncated === true,
          priorityNextCursor: page.priorityNextCursor || null,
          nextCursor: page.nextCursor,
        },
      };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/workflows/priority', async (request, reply) => {
    const query = z.object({
      contextType: z.enum(['collect', 'listing-draft']),
      contextId: z.string().trim().min(1).max(200),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      cursor: z.string().trim().min(1).max(1000).optional(),
    }).safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: query.error.issues[0]?.message });
    }
    try {
      const page = await mediaWorkflowService.listPriority({
        ownerUserId: actor(request).ownerUserId,
        contextType: query.data.contextType,
        contextId: query.data.contextId,
        limit: query.data.limit,
        cursor: query.data.cursor,
      });
      return {
        code: 1,
        data: {
          items: page.items.map(publicWorkflow),
          nextCursor: page.nextCursor,
        },
      };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/workflows/:id', async (request, reply) => {
    const query = z.object({
      contextType: z.enum(['collect', 'listing-draft']).optional(),
      contextId: z.string().trim().min(1).max(200).optional(),
    }).refine(
      (value) => Boolean(value.contextType) === Boolean(value.contextId),
      { message: 'Workflow context type and id must be provided together' },
    ).safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: query.error.issues[0]?.message });
    }
    try {
      const workflow = await mediaWorkflowService.get((request.params as any).id, actor(request).ownerUserId);
      assertStandaloneWorkflow(workflow);
      if (query.data.contextType && (
        workflow.contextType !== query.data.contextType
        || workflow.contextId !== query.data.contextId
      )) {
        throw new AiMediaWorkflowError('NOT_FOUND', 'AI media workflow not found');
      }
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
      let retryGlobalDailyBudgetCents: number | undefined;
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
        if (frozenProvider !== 'fake') {
          retryGlobalDailyBudgetCents = await getGlobalDailyBudgetCents();
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
        const latestJob = Array.isArray(existingWorkflow.jobs)
          ? existingWorkflow.jobs.at(-1) as unknown as Record<string, unknown> | undefined
          : undefined;
        if (!retryProviderConfigMatches(latestJob, operation, editSettings)) {
          return reply.status(409).send({
            code: 'PROVIDER_CONFIG_CHANGED',
            msg: 'AI image edit Provider endpoint, model, price, or request shape changed; create a new workflow',
          });
        }
        if (editSettings.provider !== 'fake') {
          retryGlobalDailyBudgetCents = editSettings.globalDailyBudgetCents;
        }
        retryEnqueue = enqueueEdit;
      } else {
        const [editSettings, editStorageReadiness] = await Promise.all([
          getEditSettings(),
          getEditStorageReadiness(),
        ]);
        const readiness = resolveAiImageToImageReadiness({
          enabled: editSettings.imageToImageEnabled,
          production,
          provider: editSettings.provider,
          model: editSettings.model,
          estimatedCostCents: editSettings.estimatedCostCents,
          storageReadiness: editStorageReadiness,
        });
        if (!readiness.ready) {
          return reply.status(503).send({ code: readiness.reasonCode, msg: readiness.reason });
        }
        editRetryDailyLimit = editSettings.dailyLimit;
        const latestJob = Array.isArray(existingWorkflow.jobs)
          ? existingWorkflow.jobs.at(-1) as unknown as Record<string, unknown> | undefined
          : undefined;
        if (!retryProviderConfigMatches(latestJob, 'IMAGE_TO_IMAGE', editSettings)) {
          return reply.status(409).send({
            code: 'PROVIDER_CONFIG_CHANGED',
            msg: 'AI image Provider endpoint, model, price, or request shape changed; create a new workflow',
          });
        }
        if (editSettings.provider !== 'fake') {
          retryGlobalDailyBudgetCents = editSettings.globalDailyBudgetCents;
        }
      }
      const result = await mediaWorkflowService.retry({
        id: (request.params as any).id,
        ...ids,
        ...parsed.data,
        ...((existingWorkflow as { operation?: string }).operation === 'IMAGE_TRANSLATE'
          ? { dailyLimit: translationRetryDailyLimit }
          : ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(String(existingWorkflow.operation))
            ? { dailyLimit: editRetryDailyLimit }
          : {}),
        ...(retryGlobalDailyBudgetCents == null
          ? {}
          : { globalDailyBudgetCents: retryGlobalDailyBudgetCents }),
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

  app.get('/contexts/listing-draft/:id', async (request, reply) => {
    const parsed = z.object({
      revision: z.coerce.number().int().min(1),
      draftVersion: z.coerce.number().int().min(1),
      skuKey: z.string().trim().min(1).max(500).nullable().optional(),
      slotKey: z.string().trim().min(1).max(1024).nullable().optional(),
    }).safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    if (!await getMediaWorkflowEnabled(actor(request).ownerUserId)) {
      return reply.send({ code: 0, msg: 'AI media workflow is disabled' });
    }
    try {
      const context = await mediaContextService.loadListingDraft(
        actor(request).ownerUserId,
        (request.params as any).id,
        {
          expectedRevision: parsed.data.revision,
          expectedDraftVersion: parsed.data.draftVersion,
          skuKey: parsed.data.skuKey,
          slotKey: parsed.data.slotKey,
        },
      );
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
        contextType: 'collect',
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

  app.post('/contexts/listing-draft/:id/edit-masks', {
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
    const parsed = listingDraftEditMaskSchema.safeParse(request.body);
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
        contextType: 'listing-draft',
        contextId: (request.params as any).id,
        contextSkuKey: parsed.data.skuKey,
        contextSlotKey: parsed.data.slotKey,
        contextDraftRevision: parsed.data.revision,
        contextDraftVersion: parsed.data.draftVersion,
        sourceAssetId: parsed.data.sourceAssetId,
        maskBuffer,
        maskSemantics: parsed.data.maskSemantics,
      }, {
        database: prisma as any,
        getStorage: getStorageBackend,
        checkUploadQuota: checkEditMaskUploadQuota,
        loadListingDraftContext: (ownerUserId, draftId, scope) => (
          mediaContextService.loadListingDraft(ownerUserId, draftId, scope)
        ),
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

  app.post('/contexts/listing-draft/:id/internalize', async (request, reply) => {
    const parsed = z.object({
      sourceMediaKey: z.string().trim().min(1).max(500),
      purpose: z.enum(['GENERAL', 'EDIT']).default('GENERAL'),
      revision: z.number().int().min(1),
      draftVersion: z.number().int().min(1),
      skuKey: z.string().trim().min(1).max(500).nullable().optional(),
      slotKey: z.string().trim().min(1).max(1024).nullable().optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    if (!await getMediaWorkflowEnabled(actor(request).ownerUserId)) {
      return reply.status(503).send({ code: 'AI_MEDIA_WORKFLOW_DISABLED', msg: 'AI media workflow is disabled' });
    }
    try {
      await requireSourceListingWebMedia(actor(request).ownerUserId);
      const asset = await mediaContextService.internalizeListingDraft(
        actor(request).ownerUserId,
        (request.params as any).id,
        parsed.data.sourceMediaKey,
        {
          expectedRevision: parsed.data.revision,
          expectedDraftVersion: parsed.data.draftVersion,
          skuKey: parsed.data.skuKey,
          slotKey: parsed.data.slotKey,
        },
        parsed.data.purpose,
      );
      return { code: 1, data: {
        id: asset.id, url: asset.url, mimeType: asset.mimeType,
        width: asset.width, height: asset.height, editReady: asset.editReady,
      } };
    } catch (error) { return sendError(reply, error); }
  });
}
