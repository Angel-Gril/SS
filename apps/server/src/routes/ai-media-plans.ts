import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { PrismaAiMediaPlanningRepository } from '../repositories/ai-media-planning-repository.js';
import {
  AI_MEDIA_GALLERY_GOALS,
  AI_MEDIA_MANUAL_SLOT_CHANGE_MAX,
  AI_MEDIA_PLAN_VERSION_PAGE_DEFAULT,
  AI_MEDIA_PLAN_VERSION_PAGE_MAX,
  AiMediaPlanningError,
  createAiMediaPlanningService,
  type AiMediaPlanningService,
  type AiMediaPlanRecord,
  type AiMediaPlanVersionRecord,
  type AiMediaGalleryGoal,
} from '../services/ai-media-planning.js';
import { AI_IMAGE_PROMPT_PLAN_MAX_REFERENCES } from '../services/ai-image-prompt-plan.js';
import { AI_MEDIA_PLANNING_SLOT_KEY_MAX_LENGTH } from '../services/ai-media-planning-contract.js';
import { getAiMediaRolloutDecision } from '../services/ai-media-rollout.js';
import {
  sourceWorkflowFeatureFlags,
  type SourceWorkflowFeatureFlagEvaluator,
} from '../services/source-workflow-feature-flags.js';

const contextQuerySchema = z.object({
  contextType: z.literal('collect').default('collect'),
  contextId: z.string().trim().min(1).max(200),
}).strict();

const createSchema = z.object({
  context: z.object({
    type: z.literal('collect'),
    id: z.string().trim().min(1).max(200),
  }).strict(),
  idempotencyKey: z.string().trim().min(8).max(128),
  selectedSkuKeys: z.array(z.string().trim().min(1).max(500)).min(1).max(50).optional(),
  candidateMediaKeys: z.array(z.string().trim().min(1).max(500)).max(25).optional(),
  galleryGoals: z.array(z.enum([...AI_MEDIA_GALLERY_GOALS] as [string, ...string[]])).min(1).max(7).optional(),
}).strict().superRefine((value, context) => {
  if (value.selectedSkuKeys && new Set(value.selectedSkuKeys).size !== value.selectedSkuKeys.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['selectedSkuKeys'], message: 'selectedSkuKeys must be unique' });
  }
  if (value.candidateMediaKeys && new Set(value.candidateMediaKeys).size !== value.candidateMediaKeys.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['candidateMediaKeys'], message: 'candidateMediaKeys must be unique' });
  }
  if (value.galleryGoals && new Set(value.galleryGoals).size !== value.galleryGoals.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['galleryGoals'], message: 'galleryGoals must be unique' });
  }
});

const reviewSchema = z.object({
  expectedRevision: z.number().int().min(1),
  operationKey: z.string().trim().min(8).max(128),
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(2_000).nullable().optional(),
}).strict();

const slotReferenceSchema = z.object({
  expectedRevision: z.number().int().min(1),
  baseVersionId: z.string().trim().min(1).max(200),
  operationKey: z.string().trim().min(8).max(128),
  changes: z.array(z.object({
    slotKey: z.string().trim().min(1).max(AI_MEDIA_PLANNING_SLOT_KEY_MAX_LENGTH),
    referenceCandidateIds: z.array(z.string().trim().min(1).max(500))
      .max(AI_IMAGE_PROMPT_PLAN_MAX_REFERENCES),
  }).strict().superRefine((value, context) => {
    if (new Set(value.referenceCandidateIds).size !== value.referenceCandidateIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['referenceCandidateIds'],
        message: 'referenceCandidateIds must be unique',
      });
    }
  })).min(1).max(AI_MEDIA_MANUAL_SLOT_CHANGE_MAX),
}).strict().superRefine((value, context) => {
  if (new Set(value.changes.map((change) => change.slotKey)).size !== value.changes.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['changes'],
      message: 'slotKey changes must be unique',
    });
  }
});

const versionPageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(AI_MEDIA_PLAN_VERSION_PAGE_MAX)
    .default(AI_MEDIA_PLAN_VERSION_PAGE_DEFAULT),
  beforeVersion: z.coerce.number().int().min(1).optional(),
}).strict();

interface AiMediaPlanningRouteOptions {
  service?: AiMediaPlanningService;
  authenticate?: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  getMediaWorkflowEnabled?: (ownerUserId: string) => Promise<boolean>;
  getSourceListingWebMediaEnabled?: (ownerUserId: string) => Promise<boolean>;
  sourceWorkflowFeatureFlags?: SourceWorkflowFeatureFlagEvaluator;
}

function actor(request: FastifyRequest) {
  const auth = (request as any).user || {};
  return {
    ownerUserId: auth.effectiveUserId || auth.userId,
    actorUserId: auth.actorUserId || auth.userId,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, max = 500): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function boundedStringArray(value: unknown, maxItems = 500, maxLength = 500): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => boundedString(item, maxLength))
    .filter((item): item is string => Boolean(item)))]
    .slice(0, maxItems);
}

const sensitivePublicKey = /(?:prompt|secret|token|api.?key|credential|authorization)/iu;

function safePublicJson(value: unknown, depth = 0, budget = { nodes: 0 }): unknown {
  budget.nodes += 1;
  if (budget.nodes > 2_000 || depth > 8) return null;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, 2_000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safePublicJson(item, depth + 1, budget));
  const object = record(value);
  if (!object) return null;
  return Object.fromEntries(Object.entries(object)
    .filter(([key]) => !sensitivePublicKey.test(key))
    .slice(0, 100)
    .map(([key, item]) => [key.slice(0, 200), safePublicJson(item, depth + 1, budget)]));
}

function publicCuration(value: unknown): unknown {
  const source = record(value);
  if (!source) return null;
  const decisions = Array.isArray(source.decisions) ? source.decisions.flatMap((entry) => {
    const item = record(entry);
    const candidateId = boundedString(item?.candidateId);
    if (!item || !candidateId) return [];
    const continuity = record(item.continuity);
    return [{
      candidateId,
      disposition: ['keep', 'reject', 'manual'].includes(String(item.disposition)) ? item.disposition : 'manual',
      reasonCodes: boundedStringArray(item.reasonCodes, 20, 100),
      translation: ['translate', 'skip', 'unknown'].includes(String(item.translation)) ? item.translation : 'unknown',
      contentRole: ['identity', 'context', 'detail', 'unknown'].includes(String(item.contentRole)) ? item.contentRole : 'unknown',
      score: typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : null,
      duplicateOfCandidateId: boundedString(item.duplicateOfCandidateId),
      continuity: continuity ? {
        groupKey: boundedString(continuity.groupKey) || '',
        index: Number.isSafeInteger(continuity.index) ? continuity.index : 0,
        total: Number.isSafeInteger(continuity.total) ? continuity.total : 0,
      } : null,
    }];
  }) : [];
  const target = record(source.selectionTarget);
  return {
    version: boundedString(source.version, 20),
    mode: ['deterministic', 'model', 'fallback'].includes(String(source.mode)) ? source.mode : 'fallback',
    consideredCandidateIds: boundedStringArray(source.consideredCandidateIds, 25),
    selectedCandidateIds: boundedStringArray(source.selectedCandidateIds, 25),
    decisions,
    selectionTarget: {
      minimum: Number.isSafeInteger(target?.minimum) ? target?.minimum : 0,
      maximum: Number.isSafeInteger(target?.maximum) ? target?.maximum : 0,
      eligibleCount: Number.isSafeInteger(target?.eligibleCount) ? target?.eligibleCount : 0,
      selectedCount: Number.isSafeInteger(target?.selectedCount) ? target?.selectedCount : decisions.length,
      met: target?.met === true,
    },
    discardedModelCandidateIds: boundedStringArray(source.discardedModelCandidateIds, 25),
    diagnostics: Array.isArray(source.diagnostics) ? source.diagnostics.flatMap((entry) => {
      const item = record(entry);
      const code = boundedString(item?.code, 100);
      const candidateId = boundedString(item?.candidateId);
      return code && candidateId ? [{ code, candidateId }] : [];
    }).slice(0, 50) : [],
    fallbackReason: boundedString(source.fallbackReason, 100),
  };
}

function publicVision(value: unknown): unknown {
  const source = record(value);
  if (!source) return null;
  const images = Array.isArray(source.images) ? source.images.flatMap((entry) => {
    const image = record(entry);
    const candidateId = boundedString(image?.candidateId);
    if (!image || !candidateId) return [];
    const observations = record(image.observations);
    const visibleText = Array.isArray(observations?.visibleText) ? observations.visibleText.flatMap((entry) => {
      const text = record(entry);
      const content = boundedString(text?.text, 500);
      const language = boundedString(text?.language, 50);
      return content && language ? [{ text: content, language }] : [];
    }).slice(0, 20) : [];
    return [{
      candidateId,
      productIdentity: boundedString(image.productIdentity, 50) || 'uncertain',
      identityConfidence: typeof image.identityConfidence === 'number' && Number.isFinite(image.identityConfidence)
        ? image.identityConfidence : 0,
      contentRoles: boundedStringArray(image.contentRoles, 3, 50),
      observations: {
        colors: boundedStringArray(observations?.colors, 30, 100),
        shapes: boundedStringArray(observations?.shapes, 30, 100),
        visibleComponents: boundedStringArray(observations?.visibleComponents, 30, 100),
        visibleText,
      },
    }];
  }) : [];
  const unsupportedClaims = Array.isArray(source.unsupportedClaims) ? source.unsupportedClaims.flatMap((entry) => {
    const claim = record(entry);
    const candidateId = boundedString(claim?.candidateId);
    const field = boundedString(claim?.field, 100);
    if (!claim || !candidateId || !field) return [];
    return [{ candidateId, field, value: safePublicJson(claim.value ?? null) }];
  }).slice(0, 100) : [];
  const verifiedFacts = Array.isArray(source.verifiedFacts) ? source.verifiedFacts.flatMap((entry) => {
    const fact = record(entry);
    const path = boundedString(fact?.path, 2_048);
    if (!fact || !path) return [];
    return [{ path, value: safePublicJson(fact.value ?? null), evidenceIds: boundedStringArray(fact.evidenceIds, 20) }];
  }).slice(0, 100) : [];
  return {
    version: boundedString(source.version, 20),
    mode: ['model', 'fallback'].includes(String(source.mode)) ? source.mode : 'fallback',
    fallbackReason: boundedString(source.fallbackReason, 100),
    verifiedFacts,
    images,
    unsupportedClaims,
    discardedCandidateIds: boundedStringArray(source.discardedCandidateIds, 25),
    diagnostics: Array.isArray(source.diagnostics) ? source.diagnostics.flatMap((entry) => {
      const item = record(entry);
      const code = boundedString(item?.code, 100);
      const candidateId = boundedString(item?.candidateId);
      return code ? [{ code, ...(candidateId ? { candidateId } : {}) }] : [];
    }).slice(0, 100) : [],
  };
}

function publicSlotPlan(value: unknown): unknown {
  const source = record(value);
  if (!source) return null;
  const groups = Array.isArray(source.compatibilityGroups) ? source.compatibilityGroups.flatMap((entry) => {
    const group = record(entry);
    const groupKey = boundedString(group?.groupKey);
    if (!group || !groupKey) return [];
    return [{
      groupKey,
      identitySignature: boundedString(group.identitySignature, 2_000) || '',
      skuKeys: boundedStringArray(group.skuKeys, 50),
    }];
  }).slice(0, 50) : [];
  const slots = Array.isArray(source.slots) ? source.slots.flatMap((entry) => {
    const slot = record(entry);
    const slotKey = boundedString(slot?.slotKey, AI_MEDIA_PLANNING_SLOT_KEY_MAX_LENGTH);
    const ownership = record(slot?.ownership);
    const ownershipKey = boundedString(ownership?.key, 500);
    if (!slot || !slotKey || !ownership || !ownershipKey) return [];
    const references = Array.isArray(slot.references) ? slot.references.flatMap((entry) => {
      const reference = record(entry);
      const candidateId = boundedString(reference?.candidateId);
      if (!reference || !candidateId) return [];
      return [{ candidateId, evidenceIds: boundedStringArray(reference.evidenceIds, 20) }];
    }).slice(0, 5) : [];
    return [{
      slotKey,
      goal: boundedString(slot.goal, 100) || 'unknown',
      status: slot.status === 'READY' ? 'READY' : 'MANUAL_REQUIRED',
      aspectRatio: slot.aspectRatio === '3:4' ? '3:4' : '3:4',
      ownership: {
        level: ownership.level === 'sku' ? 'sku' : 'compatibility_group',
        key: ownershipKey,
      },
      references,
      factEvidenceIds: boundedStringArray(slot.factEvidenceIds, 100),
      safetyConstraints: boundedStringArray(slot.safetyConstraints, 50, 200),
      acceptanceChecks: boundedStringArray(slot.acceptanceChecks, 50, 200),
    }];
  }).slice(0, 500) : [];
  const facts = Array.isArray(source.verifiedFacts) ? source.verifiedFacts.flatMap((entry) => {
    const fact = record(entry);
    const path = boundedString(fact?.path, 2_048);
    if (!fact || !path) return [];
    return [{
      path,
      value: safePublicJson(fact.value ?? null),
      evidenceIds: boundedStringArray(fact.evidenceIds, 20),
      ...(Array.isArray(fact.skuKeys) ? { skuKeys: boundedStringArray(fact.skuKeys, 50) } : {}),
    }];
  }).slice(0, 500) : [];
  return {
    version: boundedString(source.version, 20),
    mode: ['rule_based', 'model', 'fallback'].includes(String(source.mode)) ? source.mode : 'fallback',
    compatibilityGroups: groups,
    slots,
    verifiedFacts: facts,
    manualSelectionAllowed: source.manualSelectionAllowed === true,
    recoverable: source.recoverable === true,
    diagnostics: Array.isArray(source.diagnostics) ? source.diagnostics.flatMap((entry) => {
      const item = record(entry);
      const code = boundedString(item?.code, 100);
      const slotKey = boundedString(item?.slotKey, AI_MEDIA_PLANNING_SLOT_KEY_MAX_LENGTH);
      return code && slotKey ? [{ code, slotKey, ...(boundedString(item?.candidateId) ? { candidateId: boundedString(item?.candidateId) } : {}) }] : [];
    }).slice(0, 100) : [],
    fallbackReason: boundedString(source.fallbackReason, 100),
  };
}

function publicProvenance(value: unknown): unknown {
  const source = record(value);
  if (!source) return null;
  const rules = record(source.rules);
  return {
    version: boundedString(source.version, 100),
    mode: boundedString(source.mode, 50),
    engineVersion: boundedString(source.engineVersion, 100),
    rules: rules ? Object.fromEntries(Object.entries(rules).flatMap(([key, item]) => {
      const safeKey = boundedString(key, 100);
      const safeValue = boundedString(item, 200);
      return safeKey && safeValue ? [[safeKey, safeValue]] : [];
    })) : {},
    provider: null,
  };
}

function publicVersion(version: AiMediaPlanVersionRecord | null | undefined): unknown {
  if (!version) return null;
  return {
    id: version.id,
    planId: version.planId,
    version: version.version,
    sourceCaptureSnapshotId: version.sourceCaptureSnapshotId,
    sourceSchemaVersion: version.sourceSchemaVersion,
    planSchemaVersion: version.planSchemaVersion,
    plannerVersion: version.plannerVersion,
    mode: version.mode,
    fallbackReason: version.fallbackReason,
    curation: publicCuration(version.curation),
    visionEvidence: publicVision(version.visionEvidence),
    planPayload: publicSlotPlan(version.planPayload),
    provenance: publicProvenance(version.provenance),
    createdAt: version.createdAt,
  };
}

function publicPlan(plan: AiMediaPlanRecord, sourceCurrent?: boolean | null): unknown {
  const stale = record(plan.staleReasons);
  const staleReasons = Array.isArray(stale?.reasons)
    ? boundedStringArray(stale.reasons, 20, 100)
    : Array.isArray(plan.staleReasons)
      ? boundedStringArray(plan.staleReasons, 20, 100)
      : null;
  return {
    id: plan.id,
    sourceSubjectId: plan.sourceSubjectId,
    contextType: plan.contextType,
    contextId: plan.contextId,
    revision: plan.revision,
    latestVersion: plan.latestVersion,
    currentVersionId: plan.currentVersionId,
    approvedVersionId: plan.approvedVersionId,
    reviewStatus: plan.reviewStatus,
    staleAt: plan.staleAt,
    staleReasons,
    reviewedAt: plan.reviewedAt,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    ...(sourceCurrent === undefined ? {} : { sourceCurrent }),
    currentVersion: publicVersion(plan.currentVersion),
    approvedVersion: publicVersion(plan.approvedVersion),
  };
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AiMediaPlanningError) {
    return reply.status(error.statusCode).send({ code: error.code, msg: error.message });
  }
  throw error;
}

export async function aiMediaPlanningRoutes(
  app: FastifyInstance,
  options: AiMediaPlanningRouteOptions = {},
) {
  const service = options.service || createAiMediaPlanningService(
    new PrismaAiMediaPlanningRepository(prisma),
  );
  const authHook = options.authenticate || authenticate;
  const featureFlags = options.sourceWorkflowFeatureFlags || sourceWorkflowFeatureFlags;
  const getMediaWorkflowEnabled = options.getMediaWorkflowEnabled
    || (async (ownerUserId: string) => (await getAiMediaRolloutDecision(ownerUserId)).enabled);
  const getSourceListingWebMediaEnabled = options.getSourceListingWebMediaEnabled
    || (async (ownerUserId: string) => (
      await featureFlags.evaluate('SOURCE_LISTING_WEB_MEDIA', { ownerUserId })
    ).enabled);
  const requirePlanningRollout = async (ownerUserId: string) => {
    let workflowEnabled = false;
    try {
      workflowEnabled = await getMediaWorkflowEnabled(ownerUserId);
    } catch {
      workflowEnabled = false;
    }
    if (!workflowEnabled) {
      throw new AiMediaPlanningError(
        'AI_MEDIA_WORKFLOW_DISABLED',
        'AI media planning is not enabled for this account',
        503,
      );
    }
    let webEnabled = false;
    try {
      webEnabled = await getSourceListingWebMediaEnabled(ownerUserId);
    } catch {
      webEnabled = false;
    }
    if (!webEnabled) {
      throw new AiMediaPlanningError(
        'SOURCE_LISTING_WEB_MEDIA_DISABLED',
        'Web AI media tools are not enabled for this account',
        503,
      );
    }
  };
  app.addHook('preHandler', authHook as any);

  app.post('/plans', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const ids = actor(request);
    try {
      await requirePlanningRollout(ids.ownerUserId);
      const result = await service.createCurrentRuleBased({
        ...ids,
        ...parsed.data,
        galleryGoals: parsed.data.galleryGoals as AiMediaGalleryGoal[] | undefined,
      });
      return reply.status(result.replayed ? 200 : 202).send({
        code: 1,
        data: publicPlan(result.plan, result.sourceCurrent),
        replayed: result.replayed,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/plans/current', async (request, reply) => {
    const parsed = contextQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    try {
      const result = await service.getCurrentByContext(actor(request).ownerUserId, {
        type: parsed.data.contextType,
        id: parsed.data.contextId,
      });
      return { code: 1, data: result.plan ? publicPlan(result.plan, result.sourceCurrent) : null };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/plans/:id', async (request, reply) => {
    const id = String((request.params as { id?: unknown }).id || '').trim();
    if (!id || id.length > 200) return reply.status(400).send({ code: 'INVALID_REQUEST', msg: 'plan id is invalid' });
    try {
      const result = await service.getWithSourceStatus(id, actor(request).ownerUserId);
      return { code: 1, data: publicPlan(result.plan, result.sourceCurrent) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/plans/:id/versions', async (request, reply) => {
    const id = String((request.params as { id?: unknown }).id || '').trim();
    if (!id || id.length > 200) return reply.status(400).send({ code: 'INVALID_REQUEST', msg: 'plan id is invalid' });
    const page = versionPageSchema.safeParse(request.query);
    if (!page.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: page.error.issues[0]?.message });
    }
    try {
      const versions = await service.listVersions(id, actor(request).ownerUserId, page.data);
      if (versions.length === page.data.limit) {
        const nextBeforeVersion = versions[versions.length - 1]?.version;
        if (nextBeforeVersion) reply.header('x-ai-media-next-before-version', String(nextBeforeVersion));
      }
      return { code: 1, data: versions.map((version) => publicVersion(version)) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/plans/:id/slot-references', async (request, reply) => {
    const parsed = slotReferenceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const id = String((request.params as { id?: unknown }).id || '').trim();
    if (!id || id.length > 200) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: 'plan id is invalid' });
    }
    const ids = actor(request);
    try {
      await requirePlanningRollout(ids.ownerUserId);
      const result = await service.updateSlotReferences({
        planId: id,
        ...ids,
        ...parsed.data,
      });
      return reply.status(result.replayed ? 200 : 202).send({
        code: 1,
        data: publicPlan(result.plan, result.sourceCurrent),
        replayed: result.replayed,
        createdVersionId: result.createdVersionId,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/plans/:id/review', async (request, reply) => {
    const parsed = reviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    }
    const id = String((request.params as { id?: unknown }).id || '').trim();
    if (!id || id.length > 200) return reply.status(400).send({ code: 'INVALID_REQUEST', msg: 'plan id is invalid' });
    const ids = actor(request);
    try {
      await requirePlanningRollout(ids.ownerUserId);
      const result = await service.review({
        planId: id,
        ...ids,
        ...parsed.data,
        note: parsed.data.note || null,
      });
      return {
        code: 1,
        data: publicPlan(result.plan, result.sourceCurrent),
        replayed: result.replayed,
      };
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
