import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';
import { reserveAiCostInTransaction } from '../services/ai-cost-ledger.js';
import {
  enforceAiImageSuiteCostControlsInTransaction,
  resolveAiImageSuiteCostControls,
  type AiImageSuiteCostControlResolver,
} from '../services/ai-image-suite-cost-controls.js';
import {
  AiMediaCapabilityError,
  assertAiMediaCapability,
} from '../services/ai-image-provider-capabilities.js';
import {
  AI_IMAGE_SUITE_CHILD_BINDING_VERSION,
  AI_IMAGE_SUITE_CHILD_FINGERPRINT_VERSION,
  AI_IMAGE_SUITE_CHILD_OPERATION_CONFIG_VERSION,
  AI_IMAGE_SUITE_PAID_CHILD_OPERATION_CONFIG_VERSION,
  AI_IMAGE_SUITE_MATERIALIZATION_EVENT_VERSION,
  AI_IMAGE_SUITE_OUTPUT_HEIGHT,
  AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION,
  AI_IMAGE_SUITE_OUTPUT_WIDTH,
  createAiImageSuiteMaterializationEventKey,
  createAiImageSuiteMaterializationRequestFingerprint,
  type AiImageSuiteMaterializationCommitResult,
  type AiImageSuiteMaterializationReplayResult,
  type AiImageSuiteMaterializationRepository,
  type AiImageSuiteMaterializationSummary,
  type MaterializeAiImageSuiteInput,
} from '../services/ai-image-suite-materialization.js';
import {
  aiImageSuiteQuoteCurrency,
  isWanxAiImageSuiteProvider,
  aiImageSuiteProviderRuntimeMatches,
  type AiImageSuiteProviderRuntimeSnapshot,
} from '../services/ai-image-suite-provider-runtime.js';
import { AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION } from '../services/ai-image-suite-output-normalizer.js';
import type { AiImageProviderRuntimeContract } from '../services/ai-image-provider-runtime-contract.js';
import { assertWanxImageToImageInput } from '../services/ai-image-wanx-image-to-image.js';
import {
  AI_IMAGE_SUITE_PROMPT_SET_VERSION,
  AI_IMAGE_SUITE_SLOT_PROMPT_VERSION,
  AI_IMAGE_SUITE_WANX_PROMPT_COMPILER_VERSION,
} from '../services/ai-image-suite-prompts.js';
import { hashAiMediaPlanningJson } from '../services/ai-media-planning.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PROMPT_EVENT_VERSION = 'ai-image-suite-prompts-frozen/v1';
const REFERENCE_EVENT_VERSION = 'ai-image-suite-references-internalized/v1';
const WORKFLOW_EVENT_VERSION = 'ai-image-suite-child-created/v1';

const authorityInclude = {
  slots: { orderBy: { ordinal: 'asc' } },
  referenceAssets: {
    include: { asset: true },
    orderBy: { ordinal: 'asc' },
  },
  promptSet: {
    include: { slots: { orderBy: { ordinal: 'asc' } } },
  },
  events: {
    where: { revision: { in: [1, 2, 3] } },
    orderBy: { revision: 'asc' },
  },
  plan: {
    select: {
      id: true,
      ownerUserId: true,
      sourceSubjectId: true,
      contextType: true,
      contextId: true,
      reviewStatus: true,
      currentVersionId: true,
      approvedVersionId: true,
      staleAt: true,
    },
  },
  planVersion: {
    select: {
      id: true,
      planId: true,
      ownerUserId: true,
      sourceSubjectId: true,
      sourceCaptureSnapshotId: true,
      sourceCaptureHash: true,
      sourceProfileHash: true,
      sourceSchemaVersion: true,
      planHash: true,
    },
  },
} as const;

const materializedInclude = {
  slots: {
    orderBy: { ordinal: 'asc' },
    include: {
      prompt: true,
      childWorkflow: {
        include: {
          jobs: {
            include: { costReservation: true },
            orderBy: { workflowAttempt: 'asc' },
          },
        },
      },
    },
  },
  promptSet: true,
  events: {
    where: { revision: 4 },
    orderBy: { revision: 'asc' },
  },
} as const;

interface MaterializationChildRow {
  ordinal: number;
  slotId: string;
  slotKey: string;
  slotPromptId: string;
  childWorkflowId: string;
  jobId: string;
  reservationId: string;
  requestFingerprint: string;
  promptBindingHash: string;
  bindingHash: string;
}

interface PreparedReference {
  ordinal: number;
  candidateId: string;
  assetId: string;
  assetSha256: string;
  assetUrl: string;
  mimeType: string;
  width: number;
  height: number;
  storageBackend: 'local' | 'oss';
  storageKey: string;
  sizeBytes: number;
  kind: 'SOURCE_ORIGINAL';
  sourceCaptureSnapshotId: string;
  bindingHash: string;
}

interface PreparedSlot {
  row: any;
  prompt: any;
  references: PreparedReference[];
  requestFingerprint: string;
  operationConfig: Record<string, unknown>;
}

export interface AiImageSuiteMaterializationRepositoryOptions {
  getCostControls?: AiImageSuiteCostControlResolver;
  getProviderRuntime?: (suite: {
    ownerUserId: string;
    provider: string;
    model: string;
    providerConfigHash: string;
    pricingVersion: string;
    concurrencyLimit: number;
    itemCount: number;
    estimatedCostCents: number;
    maximumCostCents: number;
  }) => Promise<AiImageSuiteProviderRuntimeSnapshot>;
}

function sha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function exact(value: unknown, max = 10_000): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && value.length <= max;
}

function jsonObject(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function textHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isRace(error: unknown): boolean {
  const candidate = error && typeof error === 'object'
    ? error as { code?: unknown; meta?: { code?: unknown }; cause?: { code?: unknown }; message?: unknown }
    : {};
  const codes = [candidate.code, candidate.meta?.code, candidate.cause?.code]
    .map((value) => String(value || ''))
    .concat(String(candidate.message || '').match(/P2002|P2034|40001|40P01/gu) || []);
  return codes.some((code) => ['P2002', 'P2034', '40001', '40P01'].includes(code));
}

function isSlotConflict(error: unknown): boolean {
  return Boolean(error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'AI_MEDIA_SUITE_SLOT_CONFLICT');
}

function workflowIdempotencyKey(suiteId: string, slotId: string): string {
  return `suite-child:${hashAiMediaPlanningJson({ suiteId, slotId })}`;
}

function jobIdempotencyKey(suiteId: string, slotId: string): string {
  return `suite-child-job:${hashAiMediaPlanningJson({ suiteId, slotId })}`;
}

function reservationIdempotencyKey(suiteId: string, slotId: string): string {
  return `suite-child-cost:${hashAiMediaPlanningJson({ suiteId, slotId })}`;
}

function materializationCore(
  suite: any,
  children: MaterializationChildRow[],
  actorUserId = suite.actorUserId,
) {
  return {
    version: AI_IMAGE_SUITE_MATERIALIZATION_EVENT_VERSION,
    suiteId: String(suite.id),
    ownerUserId: String(suite.ownerUserId),
    actorUserId: String(actorUserId),
    promptSetHash: String(suite.promptSet.promptSetHash),
    referenceSetHash: String(suite.promptSet.referenceSetHash),
    operation: 'IMAGE_TO_IMAGE',
    provider: String(suite.provider),
    model: String(suite.model),
    providerConfigHash: String(suite.providerConfigHash),
    pricingVersion: String(suite.pricingVersion),
    outputProfile: AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION,
    width: AI_IMAGE_SUITE_OUTPUT_WIDTH,
    height: AI_IMAGE_SUITE_OUTPUT_HEIGHT,
    slotCount: children.length,
    childCount: children.length,
    estimatedCostCents: Number(suite.estimatedCostCents),
    maximumCostCents: Number(suite.maximumCostCents),
    children,
  };
}

function eventPayload(
  suite: any,
  input: MaterializeAiImageSuiteInput,
  children: MaterializationChildRow[],
) {
  const core = materializationCore(suite, children, input.actorUserId);
  return {
    ...core,
    operationKey: input.operationKey,
    requestFingerprint: createAiImageSuiteMaterializationRequestFingerprint(input),
    materializationHash: hashAiMediaPlanningJson(core),
  };
}

function childRequestFingerprint(
  suite: any,
  slot: any,
  prompt: any,
  references: PreparedReference[],
  operationConfig: Record<string, unknown>,
): string {
  return hashAiMediaPlanningJson({
    version: AI_IMAGE_SUITE_CHILD_FINGERPRINT_VERSION,
    suiteId: String(suite.id),
    ownerUserId: String(suite.ownerUserId),
    planId: String(suite.planId),
    planVersionId: String(suite.planVersionId),
    sourceCaptureSnapshotId: String(suite.sourceCaptureSnapshotId),
    provider: String(suite.provider),
    model: String(suite.model),
    providerConfigHash: String(suite.providerConfigHash),
    pricingVersion: String(suite.pricingVersion),
    outputProfile: AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION,
    width: AI_IMAGE_SUITE_OUTPUT_WIDTH,
    height: AI_IMAGE_SUITE_OUTPUT_HEIGHT,
    operationConfig,
    slotId: String(slot.id),
    ordinal: Number(slot.ordinal),
    slotKey: String(slot.slotKey),
    slotHash: String(slot.slotHash),
    promptBindingHash: String(prompt.bindingHash),
    references: references.map((reference) => ({
      ordinal: reference.ordinal,
      assetId: reference.assetId,
      assetSha256: reference.assetSha256,
      bindingHash: reference.bindingHash,
    })),
    estimatedCostCents: Number(slot.estimatedCostCents),
    maximumCostCents: Number(slot.maximumCostCents),
  });
}

function childBindingHash(input: Omit<MaterializationChildRow, 'bindingHash'>): string {
  return hashAiMediaPlanningJson({
    version: AI_IMAGE_SUITE_CHILD_BINDING_VERSION,
    ...input,
  });
}

function promptRowValid(prompt: any, promptSet: any, slot: any, ordinal: number): boolean {
  if (!prompt
    || prompt.version !== AI_IMAGE_SUITE_SLOT_PROMPT_VERSION
    || String(prompt.promptSetId) !== String(promptSet.id)
    || String(prompt.suiteId) !== String(slot.suiteId)
    || String(prompt.ownerUserId) !== String(slot.ownerUserId)
    || String(prompt.slotId) !== String(slot.id)
    || Number(prompt.ordinal) !== ordinal
    || String(prompt.slotKey) !== String(slot.slotKey)
    || String(prompt.slotHash) !== String(slot.slotHash)
    || String(prompt.referencesHash) !== String(slot.referencesHash)
    || String(prompt.referenceSetHash) !== String(promptSet.referenceSetHash)
    || String(prompt.templateKey) !== String(promptSet.templateKey)
    || String(prompt.templateReleaseId) !== String(promptSet.templateReleaseId)
    || String(prompt.templateRevisionId) !== String(promptSet.templateRevisionId)
    || Number(prompt.templateSequence) !== Number(promptSet.templateSequence)
    || String(prompt.templateChecksum) !== String(promptSet.templateChecksum)
    || String(prompt.templateSnapshotHash) !== String(promptSet.templateSnapshotHash)
    || String(prompt.compilerVersion) !== String(promptSet.compilerVersion)
    || String(prompt.policyVersion) !== String(promptSet.policyVersion)
    || String(prompt.policyHash) !== String(promptSet.policyHash)
    || !exact(prompt.resolvedPrompt, 64_000)
    || !(exact(prompt.resolvedNegativePrompt, 16_000)
      || (prompt.compilerVersion === AI_IMAGE_SUITE_WANX_PROMPT_COMPILER_VERSION && prompt.resolvedNegativePrompt === ''))
    || !sha256(prompt.bindingHash)
    || !sha256(prompt.variablesHash)
    || !sha256(prompt.compiledPromptHash)
    || !sha256(prompt.resolvedPromptHash)
    || !sha256(prompt.resolvedNegativePromptHash)
    || hashAiMediaPlanningJson(prompt.variablesSnapshot) !== String(prompt.variablesHash)
    || hashAiMediaPlanningJson({
      resolvedPrompt: String(prompt.resolvedPrompt),
      resolvedNegativePrompt: String(prompt.resolvedNegativePrompt),
    }) !== String(prompt.compiledPromptHash)
    || textHash(String(prompt.resolvedPrompt)) !== String(prompt.resolvedPromptHash)
    || textHash(String(prompt.resolvedNegativePrompt)) !== String(prompt.resolvedNegativePromptHash)) {
    return false;
  }
  return true;
}

function frozenPromptAuthorityValid(suite: any): boolean {
  const promptSet = suite.promptSet;
  const slots = Array.isArray(suite.slots) ? suite.slots : [];
  const prompts = Array.isArray(promptSet?.slots) ? promptSet.slots : [];
  const promptEvent = Array.isArray(suite.events)
    ? suite.events.find((event: any) => Number(event.revision) === 3 && event.eventType === 'PROMPTS_FROZEN')
    : null;
  const referenceEvent = Array.isArray(suite.events)
    ? suite.events.find((event: any) => Number(event.revision) === 2 && event.eventType === 'REFERENCES_INTERNALIZED')
    : null;
  const promptPayload = jsonObject(promptEvent?.payload);
  const referencePayload = jsonObject(referenceEvent?.payload);
  if (!promptSet
    || promptSet.version !== AI_IMAGE_SUITE_PROMPT_SET_VERSION
    || String(promptSet.suiteId) !== String(suite.id)
    || String(promptSet.ownerUserId) !== String(suite.ownerUserId)
    || String(promptSet.planId) !== String(suite.planId)
    || String(promptSet.planVersionId) !== String(suite.planVersionId)
    || String(promptSet.provider) !== String(suite.provider)
    || String(promptSet.model) !== String(suite.model)
    || String(promptSet.providerConfigHash) !== String(suite.providerConfigHash)
    || String(promptSet.sourceCaptureSnapshotId) !== String(suite.sourceCaptureSnapshotId)
    || Number(promptSet.slotCount) !== Number(suite.itemCount)
    || slots.length !== Number(suite.itemCount)
    || prompts.length !== slots.length
    || !sha256(promptSet.promptSetHash)
    || !sha256(promptSet.referenceSetHash)
    || !promptPayload
    || promptPayload.version !== PROMPT_EVENT_VERSION
    || String(promptPayload.promptSetId) !== String(promptSet.id)
    || String(promptPayload.promptSetHash) !== String(promptSet.promptSetHash)
    || String(promptPayload.referenceSetHash) !== String(promptSet.referenceSetHash)
    || !referencePayload
    || referencePayload.version !== REFERENCE_EVENT_VERSION
    || String(referencePayload.referenceSetHash) !== String(promptSet.referenceSetHash)) return false;
  return slots.every((slot: any, ordinal: number) => (
    Number(slot.ordinal) === ordinal
    && slot.status === 'PLANNED'
    && slot.childWorkflowId == null
    && Number(slot.attempt) === 0
    && Number(slot.revision) === 1
    && promptRowValid(prompts[ordinal], promptSet, slot, ordinal)
  ));
}

async function latestSourceMatches(client: any, suite: any): Promise<boolean> {
  if (suite.contextType !== 'collect') return false;
  const subject = await client.sourceCaptureSubject.findFirst({
    where: {
      id: suite.sourceSubjectId,
      ownerUserId: suite.ownerUserId,
      legacySupplyGoodsId: suite.contextId,
      legacySupplyGoods: { userId: suite.ownerUserId },
    },
    select: {
      snapshots: {
        orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
        take: 1,
        select: { id: true, captureHash: true, profileHash: true, schemaVersion: true },
      },
    },
  });
  const latest = subject?.snapshots?.[0];
  return Boolean(latest
    && String(latest.id) === String(suite.sourceCaptureSnapshotId)
    && String(latest.captureHash) === String(suite.sourceCaptureHash)
    && String(latest.profileHash) === String(suite.sourceProfileHash)
    && String(latest.schemaVersion) === String(suite.sourceSchemaVersion));
}

function planAuthorityValid(suite: any): boolean {
  const plan = suite.plan;
  const version = suite.planVersion;
  return Boolean(plan
    && version
    && !plan.staleAt
    && plan.reviewStatus === 'APPROVED'
    && String(plan.currentVersionId) === String(suite.planVersionId)
    && String(plan.approvedVersionId) === String(suite.planVersionId)
    && String(plan.id) === String(suite.planId)
    && String(plan.ownerUserId) === String(suite.ownerUserId)
    && String(plan.sourceSubjectId) === String(suite.sourceSubjectId)
    && String(plan.contextType) === String(suite.contextType)
    && String(plan.contextId) === String(suite.contextId)
    && String(version.id) === String(suite.planVersionId)
    && String(version.planId) === String(suite.planId)
    && String(version.ownerUserId) === String(suite.ownerUserId)
    && String(version.sourceSubjectId) === String(suite.sourceSubjectId)
    && String(version.sourceCaptureSnapshotId) === String(suite.sourceCaptureSnapshotId)
    && String(version.sourceCaptureHash) === String(suite.sourceCaptureHash)
    && String(version.sourceProfileHash) === String(suite.sourceProfileHash)
    && String(version.sourceSchemaVersion) === String(suite.sourceSchemaVersion));
}

function prepareSlots(
  suite: any,
  providerRuntime: AiImageProviderRuntimeContract | null,
): PreparedSlot[] | null {
  const referenceRows = Array.isArray(suite.referenceAssets) ? suite.referenceAssets : [];
  const byCandidate = new Map<string, PreparedReference>();
  for (const [ordinal, row] of referenceRows.entries()) {
    const asset = row.asset;
    if (Number(row.ordinal) !== ordinal
      || !exact(row.candidateId, 500)
      || byCandidate.has(String(row.candidateId))
      || !exact(row.assetId, 200)
      || !sha256(row.assetSha256)
      || !sha256(row.bindingHash)
      || !exact(row.assetUrl, 8_000)
      || !exact(row.mimeType, 200)
      || !Number.isSafeInteger(row.width)
      || Number(row.width) < 1
      || !Number.isSafeInteger(row.height)
      || Number(row.height) < 1
      || !asset
      || String(asset.id) !== String(row.assetId)
      || String(asset.ownerUserId) !== String(suite.ownerUserId)
      || asset.kind !== 'SOURCE_ORIGINAL'
      || String(asset.sha256) !== String(row.assetSha256)
      || String(asset.url) !== String(row.assetUrl)
      || String(asset.mimeType) !== String(row.mimeType)
      || Number(asset.width) !== Number(row.width)
      || Number(asset.height) !== Number(row.height)
      || !['local', 'oss'].includes(String(asset.storageBackend))
      || !exact(asset.storageKey, 2_000)
      || !Number.isSafeInteger(asset.sizeBytes)
      || Number(asset.sizeBytes) < 1
      || Number(asset.sizeBytes) > 20 * 1024 * 1024
      || String(asset.sourceCaptureSnapshotId) !== String(suite.sourceCaptureSnapshotId)) return null;
    byCandidate.set(String(row.candidateId), {
      ordinal,
      candidateId: String(row.candidateId),
      assetId: String(row.assetId),
      assetSha256: String(row.assetSha256),
      assetUrl: String(row.assetUrl),
      mimeType: String(row.mimeType),
      width: Number(row.width),
      height: Number(row.height),
      storageBackend: asset.storageBackend as 'local' | 'oss',
      storageKey: String(asset.storageKey),
      sizeBytes: Number(asset.sizeBytes),
      kind: 'SOURCE_ORIGINAL',
      sourceCaptureSnapshotId: String(asset.sourceCaptureSnapshotId),
      bindingHash: String(row.bindingHash),
    });
  }
  const promptBySlot = new Map<string, any>(
    (suite.promptSet?.slots || []).map((prompt: any) => [String(prompt.slotId), prompt] as [string, any]),
  );
  const usedCandidates = new Set<string>();
  const prepared: PreparedSlot[] = [];
  for (const slot of suite.slots) {
    const snapshots = Array.isArray(slot.referencesSnapshot) ? slot.referencesSnapshot : [];
    if (!snapshots.length) return null;
    const references: PreparedReference[] = [];
    const seen = new Set<string>();
    for (const [ordinal, item] of snapshots.entries()) {
      const reference = jsonObject(item);
      const candidateId = String(reference?.candidateId || '');
      const binding = byCandidate.get(candidateId);
      if (!binding || seen.has(candidateId)) return null;
      seen.add(candidateId);
      usedCandidates.add(candidateId);
      references.push({ ...binding, ordinal });
    }
    try {
      assertAiMediaCapability({
        provider: String(suite.provider),
        model: String(suite.model),
        operation: 'IMAGE_TO_IMAGE',
        inputCount: references.length,
      });
    } catch (error) {
      if (error instanceof AiMediaCapabilityError) return null;
      throw error;
    }
    const prompt = promptBySlot.get(String(slot.id));
    if (!prompt) return null;
    if (isWanxAiImageSuiteProvider(String(suite.provider), String(suite.model))) {
      try {
        assertWanxImageToImageInput({ count: 1, width: providerRuntime?.width || 0, height: providerRuntime?.height || 0,
          referenceCount: references.length, prompt: prompt.resolvedPrompt, negativePrompt: prompt.resolvedNegativePrompt });
      } catch { return null; }
    }
    const commonOperationConfig = {
      outputProfile: AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION,
      width: AI_IMAGE_SUITE_OUTPUT_WIDTH,
      height: AI_IMAGE_SUITE_OUTPUT_HEIGHT,
      slotPromptId: String(prompt.id),
      promptBindingHash: String(prompt.bindingHash),
      referenceSetHash: String(suite.promptSet.referenceSetHash),
    };
    const operationConfig = suite.provider === 'fake'
      ? {
        version: AI_IMAGE_SUITE_CHILD_OPERATION_CONFIG_VERSION,
        ...commonOperationConfig,
      }
      : providerRuntime
        ? {
          version: AI_IMAGE_SUITE_PAID_CHILD_OPERATION_CONFIG_VERSION,
          ...commonOperationConfig,
          providerRuntime,
          providerRequest: {
            count: 1,
            width: providerRuntime.width,
            height: providerRuntime.height,
          },
          finalOutput: {
            profile: AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION,
            width: AI_IMAGE_SUITE_OUTPUT_WIDTH,
            height: AI_IMAGE_SUITE_OUTPUT_HEIGHT,
            fit: 'contain',
            background: '#ffffff',
            format: 'png',
            normalizerVersion: AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION,
          },
        }
        : null;
    if (!operationConfig) return null;
    prepared.push({
      row: slot,
      prompt,
      references,
      operationConfig,
      requestFingerprint: childRequestFingerprint(
        suite,
        slot,
        prompt,
        references,
        operationConfig,
      ),
    });
  }
  if (usedCandidates.size !== byCandidate.size) return null;
  return prepared;
}

function costAuthorityValid(suite: any): boolean {
  const slots = Array.isArray(suite.slots) ? suite.slots : [];
  const estimated = slots.reduce((sum: number, slot: any) => sum + Number(slot.estimatedCostCents), 0);
  const maximum = slots.reduce((sum: number, slot: any) => sum + Number(slot.maximumCostCents), 0);
  return Number.isSafeInteger(estimated)
    && Number.isSafeInteger(maximum)
    && slots.every((slot: any) => (
      Number.isSafeInteger(slot.estimatedCostCents)
      && Number(slot.estimatedCostCents) >= 0
      && Number.isSafeInteger(slot.maximumCostCents)
      && Number(slot.maximumCostCents) >= Number(slot.estimatedCostCents)
    ))
    && estimated === Number(suite.estimatedCostCents)
    && maximum === Number(suite.maximumCostCents);
}

async function loadAuthority(client: any, input: MaterializeAiImageSuiteInput) {
  const suite = await client.aiMediaSuite.findFirst({
    where: { id: input.suiteId, ownerUserId: input.ownerUserId },
    include: authorityInclude,
  });
  if (!suite) return { kind: 'not-found' as const };
  if (Number(suite.revision) !== 3 || suite.status !== 'PLANNED') {
    return Number(suite.revision) > 3
      ? { kind: 'already-materialized' as const }
      : { kind: 'prompts-not-ready' as const };
  }
  if (!planAuthorityValid(suite) || !await latestSourceMatches(client, suite)) {
    return { kind: 'stale' as const };
  }
  if (!frozenPromptAuthorityValid(suite) || !costAuthorityValid(suite)) {
    return { kind: 'prompts-not-ready' as const };
  }
  return { kind: 'ready' as const, suite };
}

function persistedChildFromEvent(value: unknown, expectedOrdinal: number): MaterializationChildRow | null {
  const row = jsonObject(value);
  if (!row
    || row.ordinal !== expectedOrdinal
    || !exact(row.slotId, 200)
    || !exact(row.slotKey, 1_024)
    || !exact(row.slotPromptId, 200)
    || !exact(row.childWorkflowId, 200)
    || !exact(row.jobId, 200)
    || !exact(row.reservationId, 200)
    || !sha256(row.requestFingerprint)
    || !sha256(row.promptBindingHash)
    || !sha256(row.bindingHash)) return null;
  const core = {
    ordinal: expectedOrdinal,
    slotId: row.slotId,
    slotKey: row.slotKey,
    slotPromptId: row.slotPromptId,
    childWorkflowId: row.childWorkflowId,
    jobId: row.jobId,
    reservationId: row.reservationId,
    requestFingerprint: row.requestFingerprint,
    promptBindingHash: row.promptBindingHash,
  };
  return childBindingHash(core) === row.bindingHash
    ? { ...core, bindingHash: row.bindingHash }
    : null;
}

function persistedSummary(suite: any, event: any): AiImageSuiteMaterializationSummary | null {
  const payload = jsonObject(event?.payload);
  const slots = Array.isArray(suite?.slots) ? suite.slots : [];
  if (!suite
    || !payload
    || Number(suite.revision) < 4
    || !suite.promptSet
    || event.eventType !== 'CHILDREN_MATERIALIZED'
    || Number(event.revision) !== 4
    || String(event.suiteId) !== String(suite.id)
    || String(event.ownerUserId) !== String(suite.ownerUserId)
    || payload.version !== AI_IMAGE_SUITE_MATERIALIZATION_EVENT_VERSION
    || String(payload.suiteId) !== String(suite.id)
    || String(payload.ownerUserId) !== String(suite.ownerUserId)
    || String(payload.actorUserId) !== String(event.actorUserId)
    || String(payload.promptSetHash) !== String(suite.promptSet.promptSetHash)
    || String(payload.referenceSetHash) !== String(suite.promptSet.referenceSetHash)
    || payload.operation !== 'IMAGE_TO_IMAGE'
    || String(payload.provider) !== String(suite.provider)
    || String(payload.model) !== String(suite.model)
    || String(payload.providerConfigHash) !== String(suite.providerConfigHash)
    || String(payload.pricingVersion) !== String(suite.pricingVersion)
    || payload.outputProfile !== AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION
    || payload.width !== AI_IMAGE_SUITE_OUTPUT_WIDTH
    || payload.height !== AI_IMAGE_SUITE_OUTPUT_HEIGHT
    || payload.slotCount !== Number(suite.itemCount)
    || payload.childCount !== Number(suite.itemCount)
    || payload.estimatedCostCents !== Number(suite.estimatedCostCents)
    || payload.maximumCostCents !== Number(suite.maximumCostCents)
    || !exact(payload.operationKey, 128)
    || !sha256(payload.requestFingerprint)
    || !sha256(payload.materializationHash)
    || !Array.isArray(payload.children)
    || slots.length !== Number(suite.itemCount)
    || payload.children.length !== slots.length
    || hashAiMediaPlanningJson(payload) !== String(event.payloadHash)) return null;
  const children: MaterializationChildRow[] = [];
  for (const [ordinal, slot] of slots.entries()) {
    const child = persistedChildFromEvent(payload.children[ordinal], ordinal);
    const workflow = slot.childWorkflow;
    const job = Array.isArray(workflow?.jobs)
      ? workflow.jobs.find((candidate: any) => String(candidate.id) === child?.jobId)
      : null;
    const reservation = job?.costReservation;
    if (!child
      || Number(slot.ordinal) !== ordinal
      || String(slot.id) !== child.slotId
      || String(slot.slotKey) !== child.slotKey
      || String(slot.childWorkflowId) !== child.childWorkflowId
      || String(slot.prompt?.id) !== child.slotPromptId
      || String(slot.prompt?.bindingHash) !== child.promptBindingHash
      || !workflow
      || String(workflow.id) !== child.childWorkflowId
      || String(workflow.ownerUserId) !== String(suite.ownerUserId)
      || String(workflow.actorUserId) !== String(event.actorUserId)
      || workflow.operation !== 'IMAGE_TO_IMAGE'
      || String(workflow.contextType) !== String(suite.contextType)
      || String(workflow.contextId) !== String(suite.contextId)
      || String(workflow.contextSlotKey) !== child.slotKey
      || (slot.ownershipLevel === 'sku'
        ? String(workflow.contextSkuKey) !== String(slot.ownershipKey)
        : workflow.contextSkuKey != null)
      || String(workflow.requestFingerprint) !== child.requestFingerprint
      || !job
      || String(job.workflowId) !== child.childWorkflowId
      || Number(job.workflowAttempt) !== 1
      || String(job.ownerUserId) !== String(suite.ownerUserId)
      || String(job.actorUserId) !== String(event.actorUserId)
      || job.operation !== 'IMAGE_TO_IMAGE'
      || String(job.provider) !== String(suite.provider)
      || String(job.model) !== String(suite.model)
      || String(job.requestFingerprint) !== child.requestFingerprint
      || String(job.prompt) !== String(slot.prompt.resolvedPrompt)
      || String(job.negativePrompt) !== String(slot.prompt.resolvedNegativePrompt)
      || String(job.resolvedPrompt) !== String(slot.prompt.resolvedPrompt)
      || String(job.resolvedNegativePrompt) !== String(slot.prompt.resolvedNegativePrompt)
      || String(job.templateKey) !== String(slot.prompt.templateKey)
      || String(job.templateReleaseId) !== String(slot.prompt.templateReleaseId)
      || String(job.templateChecksum) !== String(slot.prompt.templateChecksum)
      || !reservation
      || String(reservation.id) !== child.reservationId
      || String(reservation.ownerUserId) !== String(suite.ownerUserId)
      || String(reservation.workflowId) !== child.childWorkflowId
      || String(reservation.jobId) !== child.jobId
      || String(reservation.actorUserId) !== String(event.actorUserId)
      || String(reservation.requestFingerprint) !== child.requestFingerprint
      || String(reservation.provider) !== String(suite.provider)
      || String(reservation.model) !== String(suite.model)
      || reservation.operation !== 'IMAGE_TO_IMAGE'
      || Number(reservation.estimatedCostMinor) !== Number(slot.estimatedCostCents)
      || Number(reservation.maximumCostMinor) !== Number(slot.maximumCostCents)) return null;
    children.push(child);
  }
  const core = materializationCore(suite, children, event.actorUserId);
  if (hashAiMediaPlanningJson(core) !== String(payload.materializationHash)
    || hashAiMediaPlanningJson(children) !== hashAiMediaPlanningJson(payload.children)
    || payload.childCount !== children.length) return null;
  return {
    suiteId: String(suite.id),
    revision: 4,
    status: 'PLANNED',
    childCount: children.length,
    estimatedCostCents: Number(suite.estimatedCostCents),
    maximumCostCents: Number(suite.maximumCostCents),
    materializationHash: String(payload.materializationHash),
    children: children.map((child) => ({
      ordinal: child.ordinal,
      slotKey: child.slotKey,
      childWorkflowId: child.childWorkflowId,
    })),
  };
}

async function readEventReplay(
  client: any,
  input: MaterializeAiImageSuiteInput,
): Promise<AiImageSuiteMaterializationReplayResult> {
  const eventKey = createAiImageSuiteMaterializationEventKey(input);
  const event = await client.aiMediaSuiteEvent.findUnique({ where: { eventKey } });
  if (!event) return null;
  if (String(event.suiteId) !== input.suiteId || String(event.ownerUserId) !== input.ownerUserId) {
    return { kind: 'conflict' };
  }
  const suite = await client.aiMediaSuite.findFirst({
    where: { id: input.suiteId, ownerUserId: input.ownerUserId },
    include: materializedInclude,
  });
  const summary = persistedSummary(suite, event);
  const payload = jsonObject(event.payload);
  if (!summary
    || String(event.actorUserId) !== input.actorUserId
    || String(payload?.operationKey) !== input.operationKey
    || String(payload?.requestFingerprint)
      !== createAiImageSuiteMaterializationRequestFingerprint(input)) {
    return { kind: 'conflict' };
  }
  return { kind: 'existing', ...summary };
}

async function readAnyMaterialized(
  client: any,
  input: MaterializeAiImageSuiteInput,
): Promise<Exclude<AiImageSuiteMaterializationReplayResult, null | { kind: 'existing' }> | null> {
  const event = await client.aiMediaSuiteEvent.findFirst({
    where: {
      suiteId: input.suiteId,
      ownerUserId: input.ownerUserId,
      revision: 4,
      eventType: 'CHILDREN_MATERIALIZED',
    },
  });
  if (event) return { kind: 'already-materialized' };
  const suite = await client.aiMediaSuite.findFirst({
    where: { id: input.suiteId, ownerUserId: input.ownerUserId },
    select: { revision: true, slots: { select: { childWorkflowId: true } } },
  });
  if (suite && (Number(suite.revision) > 3
    || suite.slots.some((slot: any) => slot.childWorkflowId != null))) {
    return { kind: 'conflict' };
  }
  return null;
}

async function anotherPlanVersionIsActionable(
  client: any,
  input: MaterializeAiImageSuiteInput,
): Promise<boolean> {
  const suite = await client.aiMediaSuite.findFirst({
    where: { id: input.suiteId, ownerUserId: input.ownerUserId },
    select: { planId: true, planVersionId: true },
  });
  if (!suite) return false;
  const active = await client.aiMediaSuite.findFirst({
    where: {
      ownerUserId: input.ownerUserId,
      planId: suite.planId,
      id: { not: input.suiteId },
      planVersionId: { not: suite.planVersionId },
      OR: [
        { status: { in: ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'] } },
        { status: 'PLANNED', revision: { gte: 4 } },
      ],
    },
    select: { id: true },
  });
  return Boolean(active);
}

async function createChildGraph(
  tx: any,
  suite: any,
  input: MaterializeAiImageSuiteInput,
  prepared: PreparedSlot,
): Promise<MaterializationChildRow> {
  const slot = prepared.row;
  const prompt = prepared.prompt;
  const workflow = await tx.aiMediaWorkflow.create({ data: {
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    operation: 'IMAGE_TO_IMAGE',
    status: 'QUEUED',
    reviewStatus: 'NOT_READY',
    revision: 1,
    currentAttempt: 1,
    contextType: suite.contextType,
    contextId: suite.contextId,
    contextSkuKey: slot.ownershipLevel === 'sku' ? slot.ownershipKey : null,
    contextSlotKey: slot.slotKey,
    idempotencyKey: workflowIdempotencyKey(String(suite.id), String(slot.id)),
    requestFingerprint: prepared.requestFingerprint,
  } });
  await tx.aiMediaWorkflowInput.createMany({
    data: prepared.references.map((reference) => ({
      workflowId: workflow.id,
      ownerUserId: input.ownerUserId,
      assetId: reference.assetId,
      role: 'REFERENCE',
      ordinal: reference.ordinal,
      assetSha256: reference.assetSha256,
      assetUrl: reference.assetUrl,
      mimeType: reference.mimeType,
      width: reference.width,
      height: reference.height,
    })),
  });
  const inputAssets = prepared.references.map((reference) => ({
    assetId: reference.assetId,
    role: 'REFERENCE',
    ordinal: reference.ordinal,
    sha256: reference.assetSha256,
    mimeType: reference.mimeType,
    width: reference.width,
    height: reference.height,
    storageBackend: reference.storageBackend,
    storageKey: reference.storageKey,
    sizeBytes: reference.sizeBytes,
    kind: reference.kind,
    sourceCaptureSnapshotId: reference.sourceCaptureSnapshotId,
  }));
  const job = await tx.aiImageJob.create({ data: {
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    operation: 'IMAGE_TO_IMAGE',
    workflowId: workflow.id,
    workflowAttempt: 1,
    status: 'PENDING',
    provider: suite.provider,
    model: suite.model,
    prompt: prompt.resolvedPrompt,
    negativePrompt: prompt.resolvedNegativePrompt,
    resolvedPrompt: prompt.resolvedPrompt,
    resolvedNegativePrompt: prompt.resolvedNegativePrompt,
    templateKey: prompt.templateKey,
    templateReleaseId: prompt.templateReleaseId,
    templateChecksum: prompt.templateChecksum,
    templateSnapshot: prompt.templateSnapshot,
    requestFingerprint: prepared.requestFingerprint,
    inputAssets,
    operationConfig: prepared.operationConfig,
    requestedImageCount: 1,
    width: AI_IMAGE_SUITE_OUTPUT_WIDTH,
    height: AI_IMAGE_SUITE_OUTPUT_HEIGHT,
    maxAttempts: 1,
    idempotencyKey: jobIdempotencyKey(String(suite.id), String(slot.id)),
    estimatedCostCents: slot.estimatedCostCents,
  } });
  const reserved = await reserveAiCostInTransaction(tx, {
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    workflowId: workflow.id,
    jobId: job.id,
    idempotencyKey: reservationIdempotencyKey(String(suite.id), String(slot.id)),
    requestFingerprint: prepared.requestFingerprint,
    provider: String(suite.provider),
    model: String(suite.model),
    operation: 'IMAGE_TO_IMAGE',
    currency: aiImageSuiteQuoteCurrency(String(suite.pricingVersion)),
    roundingMode: 'HALF_UP',
    estimatedCostMinor: Number(slot.estimatedCostCents),
    maximumCostMinor: Number(slot.maximumCostCents),
  });
  const workflowPayload = {
    version: WORKFLOW_EVENT_VERSION,
    suiteId: String(suite.id),
    slotId: String(slot.id),
    slotKey: String(slot.slotKey),
    ordinal: Number(slot.ordinal),
    promptBindingHash: String(prompt.bindingHash),
    referenceSetHash: String(suite.promptSet.referenceSetHash),
    outputProfile: AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION,
  };
  await tx.aiMediaWorkflowEvent.create({ data: {
    workflowId: workflow.id,
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    jobId: job.id,
    eventKey: `${workflow.id}:created`,
    eventType: 'CREATED',
    payload: workflowPayload,
    payloadHash: hashAiMediaPlanningJson(workflowPayload),
  } });
  const bound = await tx.aiMediaSuiteSlot.updateMany({
    where: {
      id: slot.id,
      suiteId: suite.id,
      ownerUserId: input.ownerUserId,
      status: 'PLANNED',
      childWorkflowId: null,
      attempt: 0,
      revision: 1,
    },
    data: {
      childWorkflowId: workflow.id,
      attempt: 1,
      revision: { increment: 1 },
    },
  });
  if (bound.count !== 1) {
    throw Object.assign(new Error('AI media suite slot changed during materialization'), {
      code: 'AI_MEDIA_SUITE_SLOT_CONFLICT',
    });
  }
  const core = {
    ordinal: Number(slot.ordinal),
    slotId: String(slot.id),
    slotKey: String(slot.slotKey),
    slotPromptId: String(prompt.id),
    childWorkflowId: String(workflow.id),
    jobId: String(job.id),
    reservationId: String(reserved.reservation.id),
    requestFingerprint: prepared.requestFingerprint,
    promptBindingHash: String(prompt.bindingHash),
  };
  return { ...core, bindingHash: childBindingHash(core) };
}

export class PrismaAiImageSuiteMaterializationRepository
implements AiImageSuiteMaterializationRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: AiImageSuiteMaterializationRepositoryOptions = {},
  ) {}

  async findReplay(
    input: MaterializeAiImageSuiteInput,
  ): Promise<AiImageSuiteMaterializationReplayResult> {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const exactReplay = await readEventReplay(tx, input);
      if (exactReplay) return exactReplay;
      return readAnyMaterialized(tx, input);
    });
  }

  async materialize(
    input: MaterializeAiImageSuiteInput,
  ): Promise<AiImageSuiteMaterializationCommitResult> {
    const commit = () => runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const exactReplay = await readEventReplay(tx, input);
      if (exactReplay) return exactReplay;
      const anyMaterialized = await readAnyMaterialized(tx, input);
      if (anyMaterialized) return anyMaterialized;

      const loaded = await loadAuthority(tx, input);
      if (loaded.kind !== 'ready') return loaded;
      const { suite } = loaded;
      let providerRuntime: AiImageProviderRuntimeContract | null = null;
      if (suite.provider !== 'fake') {
        const runtime = await this.options.getProviderRuntime?.({
          ownerUserId: String(suite.ownerUserId),
          provider: String(suite.provider),
          model: String(suite.model),
          providerConfigHash: String(suite.providerConfigHash),
          pricingVersion: String(suite.pricingVersion),
          concurrencyLimit: Number(suite.concurrencyLimit),
          itemCount: Number(suite.itemCount),
          estimatedCostCents: Number(suite.estimatedCostCents),
          maximumCostCents: Number(suite.maximumCostCents),
        });
        if (!runtime?.executionReady
          || !runtime.providerRuntime
          || !aiImageSuiteProviderRuntimeMatches(suite, runtime)) {
          return { kind: 'provider-runtime-unavailable' as const };
        }
        providerRuntime = runtime.providerRuntime;
        const controls = await resolveAiImageSuiteCostControls(
          this.options.getCostControls,
          input.ownerUserId,
        );
        if ('kind' in controls) return controls;
        const costControlFailure = await enforceAiImageSuiteCostControlsInTransaction(tx, {
          ownerUserId: input.ownerUserId,
          controls,
          requestedUnits: Number(suite.itemCount),
          requestedMaximumCostCents: Number(suite.maximumCostCents),
          currency: aiImageSuiteQuoteCurrency(String(suite.pricingVersion)),
        });
        if (costControlFailure) return costControlFailure;
      }
      const prepared = prepareSlots(suite, providerRuntime);
      if (!prepared) return { kind: 'prompts-not-ready' as const };
      const advanced = await tx.aiMediaSuite.updateMany({
        where: {
          id: input.suiteId,
          ownerUserId: input.ownerUserId,
          status: 'PLANNED',
          revision: input.expectedRevision,
          planId: suite.planId,
          planVersionId: suite.planVersionId,
          sourceCaptureSnapshotId: suite.sourceCaptureSnapshotId,
          providerConfigHash: suite.providerConfigHash,
        },
        data: { revision: { increment: 1 } },
      });
      if (advanced.count !== 1) return { kind: 'revision-conflict' as const };

      const children: MaterializationChildRow[] = [];
      for (const slot of prepared) {
        children.push(await createChildGraph(tx, suite, input, slot));
      }
      const payload = eventPayload(suite, input, children);
      await tx.aiMediaSuiteEvent.create({ data: {
        suiteId: input.suiteId,
        ownerUserId: input.ownerUserId,
        revision: 4,
        actorUserId: input.actorUserId,
        eventKey: createAiImageSuiteMaterializationEventKey(input),
        eventType: 'CHILDREN_MATERIALIZED',
        payload,
        payloadHash: hashAiMediaPlanningJson(payload),
      } });
      return {
        kind: 'committed' as const,
        suiteId: input.suiteId,
        revision: 4 as const,
        status: 'PLANNED' as const,
        childCount: children.length,
        estimatedCostCents: Number(suite.estimatedCostCents),
        maximumCostCents: Number(suite.maximumCostCents),
        materializationHash: payload.materializationHash,
        children: children.map((child) => ({
          ordinal: child.ordinal,
          slotKey: child.slotKey,
          childWorkflowId: child.childWorkflowId,
        })),
      };
    });

    try {
      return await commit();
    } catch (error) {
      if (isSlotConflict(error)) return { kind: 'conflict' };
      if (!isRace(error)) throw error;
      const replay = await this.findReplay(input);
      if (replay?.kind === 'existing'
        || replay?.kind === 'already-materialized'
        || replay?.kind === 'conflict') return replay;
      if (await anotherPlanVersionIsActionable(this.prisma as any, input)) {
        return { kind: 'active-suite-conflict' };
      }
      throw error;
    }
  }
}
