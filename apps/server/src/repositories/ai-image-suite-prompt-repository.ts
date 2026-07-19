import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';
import {
  AI_IMAGE_SUITE_PROMPT_COMPILER_VERSION,
  AI_IMAGE_SUITE_PROMPT_SET_VERSION,
  AI_IMAGE_SUITE_SLOT_POLICY_VERSION,
  AI_IMAGE_SUITE_SLOT_PROMPT_VERSION,
  type AiImageSuitePromptAuthority,
  type AiImageSuitePromptAuthorityResult,
  type AiImageSuitePromptCommitResult,
  type AiImageSuitePromptCommitSummary,
  type AiImageSuitePromptReplayResult,
  type AiImageSuitePromptRepository,
  type CommitAiImageSuitePromptSetInput,
  type FreezeAiImageSuitePromptsInput,
  type FrozenAiImageSuiteSlotPrompt,
} from '../services/ai-image-suite-prompts.js';
import { AI_IMAGE_SUITE_REFERENCE_SET_VERSION } from '../services/ai-image-suite-references.js';
import { hashAiMediaPlanningJson } from '../services/ai-media-planning.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CLAIM_EVENT_VERSION = 'ai-image-suite-event/v1';
const REFERENCE_EVENT_VERSION = 'ai-image-suite-references-internalized/v1';
const PROMPT_EVENT_VERSION = 'ai-image-suite-prompts-frozen/v1';
const PROMPT_COMMIT_VERSION = 'ai-image-suite-prompt-freeze-commit/v1';
const PROMPT_REQUEST_VERSION = 'ai-image-suite-prompt-freeze-request/v1';

const authorityInclude = {
  slots: { orderBy: { ordinal: 'asc' } },
  referenceAssets: { orderBy: { ordinal: 'asc' } },
  events: {
    where: { revision: { in: [1, 2] } },
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
      reviewedByUserId: true,
      reviewedAt: true,
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
      planPayload: true,
    },
  },
  sourceCaptureSnapshot: {
    select: {
      id: true,
      subjectId: true,
      captureHash: true,
      profileHash: true,
      schemaVersion: true,
      subject: { select: { ownerUserId: true } },
    },
  },
} as const;

const promptSetInclude = {
  slots: { orderBy: { ordinal: 'asc' } },
} as const;

function sha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function exact(value: unknown, max = 10_000): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim() && value.length <= max;
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

function requestFingerprint(input: FreezeAiImageSuitePromptsInput): string {
  return hashAiMediaPlanningJson({
    version: PROMPT_REQUEST_VERSION,
    suiteId: input.suiteId,
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    expectedRevision: input.expectedRevision,
    operationKey: input.operationKey,
  });
}

function eventKey(input: Pick<FreezeAiImageSuitePromptsInput, 'suiteId' | 'ownerUserId' | 'operationKey'>): string {
  return `suite-prompts:${hashAiMediaPlanningJson({
    version: PROMPT_EVENT_VERSION,
    suiteId: input.suiteId,
    ownerUserId: input.ownerUserId,
    operationKey: input.operationKey,
  })}`;
}

function commitFingerprint(input: CommitAiImageSuitePromptSetInput): string {
  return hashAiMediaPlanningJson({
    version: PROMPT_COMMIT_VERSION,
    ...input,
  });
}

function summary(row: any): AiImageSuitePromptCommitSummary {
  return {
    promptSetHash: String(row.promptSetHash),
    promptCount: Number(row.slotCount),
    templateKey: String(row.templateKey),
    templateReleaseId: String(row.templateReleaseId),
    templateSequence: Number(row.templateSequence),
    templateChecksum: String(row.templateChecksum),
  };
}

function referenceBinding(row: any) {
  return {
    ordinal: Number(row.ordinal),
    candidateId: String(row.candidateId),
    sourceMediaKey: String(row.candidateId),
    sourceUrl: String(row.frozenSourceUrl),
    expectedContentHash: row.expectedContentHash == null ? null : String(row.expectedContentHash),
    sourceSha256: String(row.rawSourceSha256),
    assetId: String(row.assetId),
    assetSha256: String(row.assetSha256),
    assetUrl: String(row.assetUrl),
    storageBackend: String(row.storageBackend),
    storageKey: String(row.storageKey),
    mimeType: String(row.mimeType),
    width: Number(row.width),
    height: Number(row.height),
  };
}

function referenceRowValid(row: any, suite: any, ordinal: number): boolean {
  if (!row
    || Number(row.ordinal) !== ordinal
    || String(row.suiteId) !== String(suite.id)
    || String(row.ownerUserId) !== String(suite.ownerUserId)
    || !exact(row.candidateId, 500)
    || !exact(row.assetId, 200)
    || !exact(row.frozenSourceUrl, 8_000)
    || !exact(row.assetUrl, 8_000)
    || !exact(row.storageBackend, 100)
    || !exact(row.storageKey, 8_000)
    || !exact(row.mimeType, 200)
    || !Number.isSafeInteger(Number(row.sizeBytes))
    || Number(row.sizeBytes) < 1
    || !Number.isSafeInteger(Number(row.width))
    || Number(row.width) < 1
    || !Number.isSafeInteger(Number(row.height))
    || Number(row.height) < 1
    || !sha256(row.assetSha256)
    || !sha256(row.rawSourceSha256)
    || !sha256(row.bindingHash)
    || (row.expectedContentHash != null && !sha256(row.expectedContentHash))) return false;
  const immutable = {
    version: AI_IMAGE_SUITE_REFERENCE_SET_VERSION,
    suiteId: String(row.suiteId),
    ownerUserId: String(row.ownerUserId),
    ordinal: Number(row.ordinal),
    candidateId: String(row.candidateId),
    assetId: String(row.assetId),
    frozenSourceUrl: String(row.frozenSourceUrl),
    expectedContentHash: row.expectedContentHash == null ? null : String(row.expectedContentHash),
    assetSha256: String(row.assetSha256),
    rawSourceSha256: String(row.rawSourceSha256),
    assetUrl: String(row.assetUrl),
    storageBackend: String(row.storageBackend),
    storageKey: String(row.storageKey),
    mimeType: String(row.mimeType),
    sizeBytes: Number(row.sizeBytes),
    width: Number(row.width),
    height: Number(row.height),
  };
  return hashAiMediaPlanningJson(immutable) === String(row.bindingHash)
    && (row.expectedContentHash == null || row.expectedContentHash === row.rawSourceSha256);
}

function claimEventValid(suite: any, slots: any[]): boolean {
  const event = suite.events?.find((item: any) => Number(item.revision) === 1 && item.eventType === 'CLAIMED');
  const payload = event?.payload;
  return Boolean(event
    && payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && String(event.suiteId) === String(suite.id)
    && String(event.ownerUserId) === String(suite.ownerUserId)
    && String(event.actorUserId) === String(suite.actorUserId)
    && String(payload.version) === CLAIM_EVENT_VERSION
    && String(payload.planId) === String(suite.planId)
    && String(payload.planVersionId) === String(suite.planVersionId)
    && String(payload.previewHash) === String(suite.previewHash)
    && Number(payload.itemCount) === Number(suite.itemCount)
    && Array.isArray(payload.slotHashes)
    && hashAiMediaPlanningJson(payload.slotHashes) === hashAiMediaPlanningJson(
      slots.map((slot) => String(slot.slotHash)),
    )
    && hashAiMediaPlanningJson(payload) === String(event.payloadHash));
}

function referenceEvent(suite: any): any | null {
  const event = suite.events?.find((item: any) => (
    Number(item.revision) === 2 && item.eventType === 'REFERENCES_INTERNALIZED'
  ));
  const payload = event?.payload;
  if (!event
    || !payload
    || typeof payload !== 'object'
    || Array.isArray(payload)
    || String(event.suiteId) !== String(suite.id)
    || String(event.ownerUserId) !== String(suite.ownerUserId)
    || String(payload.version) !== REFERENCE_EVENT_VERSION
    || String(payload.sourceSubjectId) !== String(suite.sourceSubjectId)
    || String(payload.sourceCaptureSnapshotId) !== String(suite.sourceCaptureSnapshotId)
    || String(payload.sourceCaptureHash) !== String(suite.sourceCaptureHash)
    || String(payload.sourceProfileHash) !== String(suite.sourceProfileHash)
    || String(payload.sourceSchemaVersion) !== String(suite.sourceSchemaVersion)
    || !sha256(payload.referenceSetHash)
    || hashAiMediaPlanningJson(payload) !== String(event.payloadHash)) return null;
  return event;
}

function slotsValid(suite: any, slots: any[], references: any[]): boolean {
  if (slots.length !== Number(suite.itemCount) || slots.length < 1) return false;
  const candidates = new Map(references.map((row) => [String(row.candidateId), row]));
  const keys = new Set<string>();
  return slots.every((slot, ordinal) => {
    if (!slot
      || Number(slot.ordinal) !== ordinal
      || String(slot.suiteId) !== String(suite.id)
      || String(slot.ownerUserId) !== String(suite.ownerUserId)
      || !exact(slot.id, 200)
      || !exact(slot.slotKey, 1_024)
      || keys.has(String(slot.slotKey))
      || slot.status !== 'PLANNED'
      || slot.childWorkflowId != null
      || Number(slot.attempt) !== 0
      || !sha256(slot.slotHash)
      || !sha256(slot.referencesHash)
      || !Array.isArray(slot.referencesSnapshot)
      || slot.referencesSnapshot.length < 1
      || hashAiMediaPlanningJson(slot.slotSnapshot) !== String(slot.slotHash)
      || hashAiMediaPlanningJson(slot.referencesSnapshot) !== String(slot.referencesHash)) return false;
    keys.add(String(slot.slotKey));
    const seen = new Set<string>();
    return slot.referencesSnapshot.every((raw: any) => {
      const candidateId = raw && typeof raw === 'object' ? String(raw.candidateId || '') : '';
      const row = candidates.get(candidateId);
      const source = raw?.source;
      if (!row || seen.has(candidateId) || !source || typeof source !== 'object') return false;
      seen.add(candidateId);
      return String(source.url) === String(row.frozenSourceUrl)
        && (source.contentHash == null || String(source.contentHash) === String(row.rawSourceSha256));
    });
  });
}

function baseAuthorityValid(suite: any): boolean {
  const plan = suite?.plan;
  const version = suite?.planVersion;
  const snapshot = suite?.sourceCaptureSnapshot;
  return Boolean(suite
    && plan
    && version
    && snapshot?.subject
    && String(plan.id) === String(suite.planId)
    && String(plan.ownerUserId) === String(suite.ownerUserId)
    && String(plan.sourceSubjectId) === String(suite.sourceSubjectId)
    && String(plan.contextType) === String(suite.contextType)
    && String(plan.contextId) === String(suite.contextId)
    && plan.reviewStatus === 'APPROVED'
    && plan.staleAt == null
    && plan.reviewedByUserId
    && plan.reviewedAt
    && String(plan.currentVersionId) === String(suite.planVersionId)
    && String(plan.approvedVersionId) === String(suite.planVersionId)
    && String(version.id) === String(suite.planVersionId)
    && String(version.planId) === String(suite.planId)
    && String(version.ownerUserId) === String(suite.ownerUserId)
    && String(version.sourceSubjectId) === String(suite.sourceSubjectId)
    && String(version.sourceCaptureSnapshotId) === String(suite.sourceCaptureSnapshotId)
    && String(version.sourceCaptureHash) === String(suite.sourceCaptureHash)
    && String(version.sourceProfileHash) === String(suite.sourceProfileHash)
    && String(version.sourceSchemaVersion) === String(suite.sourceSchemaVersion)
    && String(snapshot.id) === String(suite.sourceCaptureSnapshotId)
    && String(snapshot.subjectId) === String(suite.sourceSubjectId)
    && String(snapshot.subject.ownerUserId) === String(suite.ownerUserId)
    && String(snapshot.captureHash) === String(suite.sourceCaptureHash)
    && String(snapshot.profileHash) === String(suite.sourceProfileHash)
    && String(snapshot.schemaVersion) === String(suite.sourceSchemaVersion)
    && sha256(version.planHash)
    && sha256(suite.providerConfigHash));
}

function latestMatches(suite: any, latest: any): boolean {
  return Boolean(latest
    && String(latest.id) === String(suite.sourceCaptureSnapshotId)
    && String(latest.captureHash) === String(suite.sourceCaptureHash)
    && String(latest.profileHash) === String(suite.sourceProfileHash)
    && String(latest.schemaVersion) === String(suite.sourceSchemaVersion));
}

async function readSuite(client: any, suiteId: string, ownerUserId: string) {
  return client.aiMediaSuite.findFirst({
    where: { id: suiteId, ownerUserId },
    include: authorityInclude,
  });
}

async function readLatest(client: any, suite: any) {
  if (suite.contextType !== 'collect') return null;
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
  return subject?.snapshots?.[0] || null;
}

function authorityFromSuite(suite: any, latest: any): AiImageSuitePromptAuthorityResult {
  if (!baseAuthorityValid(suite) || !latestMatches(suite, latest)) return { kind: 'stale' };
  if (suite.status !== 'PLANNED' || Number(suite.revision) !== 2) {
    return { kind: 'references-not-ready' };
  }
  const slots = Array.isArray(suite.slots)
    ? [...suite.slots].sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    : [];
  const references = Array.isArray(suite.referenceAssets)
    ? [...suite.referenceAssets].sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    : [];
  const frozen = referenceEvent(suite);
  if (!claimEventValid(suite, slots)
    || !frozen
    || references.length < 1
    || references.some((row, ordinal) => !referenceRowValid(row, suite, ordinal))
    || Number(frozen.payload.referenceCount) !== references.length
    || !slotsValid(suite, slots, references)) return { kind: 'references-not-ready' };
  const referenceSetHash = hashAiMediaPlanningJson({
    version: AI_IMAGE_SUITE_REFERENCE_SET_VERSION,
    suiteId: String(suite.id),
    ownerUserId: String(suite.ownerUserId),
    sourceCaptureSnapshotId: String(suite.sourceCaptureSnapshotId),
    bindings: references.map(referenceBinding),
  });
  if (referenceSetHash !== String(frozen.payload.referenceSetHash)) {
    return { kind: 'references-not-ready' };
  }
  const authority: AiImageSuitePromptAuthority = {
    suiteId: String(suite.id),
    ownerUserId: String(suite.ownerUserId),
    actorUserId: String(suite.actorUserId),
    revision: Number(suite.revision),
    status: String(suite.status),
    planId: String(suite.planId),
    planVersionId: String(suite.planVersionId),
    planHash: String(suite.planVersion.planHash),
    provider: String(suite.provider),
    model: String(suite.model),
    providerConfigHash: String(suite.providerConfigHash),
    sourceSubjectId: String(suite.sourceSubjectId),
    sourceCaptureSnapshotId: String(suite.sourceCaptureSnapshotId),
    sourceCaptureHash: String(suite.sourceCaptureHash),
    sourceProfileHash: String(suite.sourceProfileHash),
    sourceSchemaVersion: String(suite.sourceSchemaVersion),
    referenceSetHash,
    slots: slots.map((slot) => ({
      id: String(slot.id),
      ordinal: Number(slot.ordinal),
      slotKey: String(slot.slotKey),
      goal: String(slot.goal),
      ownershipLevel: String(slot.ownershipLevel) as 'sku' | 'compatibility_group',
      ownershipKey: String(slot.ownershipKey),
      compatibilityGroupKey: slot.compatibilityGroupKey == null
        ? null
        : String(slot.compatibilityGroupKey),
      slotSnapshot: slot.slotSnapshot,
      slotHash: String(slot.slotHash),
      referencesSnapshot: slot.referencesSnapshot,
      referencesHash: String(slot.referencesHash),
    })),
    referenceAssets: references.map((row) => ({
      ordinal: Number(row.ordinal),
      candidateId: String(row.candidateId),
      assetId: String(row.assetId),
      assetSha256: String(row.assetSha256),
      rawSourceSha256: String(row.rawSourceSha256),
      mimeType: String(row.mimeType),
      width: Number(row.width),
      height: Number(row.height),
      bindingHash: String(row.bindingHash),
    })),
    planPayload: suite.planVersion.planPayload,
  };
  return { kind: 'ready', authority };
}

function slotPromptCore(row: any) {
  const resolvedPrompt = String(row.resolvedPrompt);
  const resolvedNegativePrompt = String(row.resolvedNegativePrompt);
  return {
    version: AI_IMAGE_SUITE_SLOT_PROMPT_VERSION,
    suiteId: String(row.suiteId),
    ownerUserId: String(row.ownerUserId),
    slotId: String(row.slotId),
    ordinal: Number(row.ordinal),
    slotKey: String(row.slotKey),
    slotHash: String(row.slotHash),
    referencesHash: String(row.referencesHash),
    referenceSetHash: String(row.referenceSetHash),
    templateKey: String(row.templateKey),
    templateReleaseId: String(row.templateReleaseId),
    templateRevisionId: String(row.templateRevisionId),
    templateSequence: Number(row.templateSequence),
    templateChecksum: String(row.templateChecksum),
    variablesSnapshot: row.variablesSnapshot,
    variablesHash: String(row.variablesHash),
    resolvedPrompt,
    resolvedNegativePrompt,
    resolvedPromptHash: textHash(resolvedPrompt),
    resolvedNegativePromptHash: textHash(resolvedNegativePrompt),
    compiledPromptHash: String(row.compiledPromptHash),
  };
}

function persistedSlotValid(row: any, set: any, payload: any, ordinal: number): boolean {
  if (!row
    || Number(row.ordinal) !== ordinal
    || String(row.promptSetId) !== String(set.id)
    || String(row.suiteId) !== String(set.suiteId)
    || String(row.ownerUserId) !== String(set.ownerUserId)
    || String(row.referenceSetHash) !== String(set.referenceSetHash)
    || String(row.templateKey) !== String(set.templateKey)
    || String(row.templateReleaseId) !== String(set.templateReleaseId)
    || String(row.templateRevisionId) !== String(set.templateRevisionId)
    || Number(row.templateSequence) !== Number(set.templateSequence)
    || String(row.templateChecksum) !== String(set.templateChecksum)
    || hashAiMediaPlanningJson(row.templateSnapshot) !== String(row.templateSnapshotHash)
    || String(row.templateSnapshotHash) !== String(set.templateSnapshotHash)
    || hashAiMediaPlanningJson(row.variablesSnapshot) !== String(row.variablesHash)
    || !exact(row.resolvedPrompt, 64_000)
    || !exact(row.resolvedNegativePrompt, 16_000)
    || hashAiMediaPlanningJson({
      resolvedPrompt: String(row.resolvedPrompt),
      resolvedNegativePrompt: String(row.resolvedNegativePrompt),
    }) !== String(row.compiledPromptHash)
    || String(row.compilerVersion) !== String(set.compilerVersion)
    || String(row.policyVersion) !== String(set.policyVersion)
    || textHash(String(row.resolvedPrompt)) !== String(row.resolvedPromptHash)
    || textHash(String(row.resolvedNegativePrompt)) !== String(row.resolvedNegativePromptHash)
    || String(row.version) !== AI_IMAGE_SUITE_SLOT_PROMPT_VERSION
    || String(row.policyHash) !== String(set.policyHash)
    || !sha256(row.bindingHash)) return false;
  return hashAiMediaPlanningJson({
    ...slotPromptCore(row),
    templateSnapshotHash: String(row.templateSnapshotHash),
    compilerVersion: String(row.compilerVersion),
    policyVersion: String(row.policyVersion),
    policyHash: String(row.policyHash),
  }) === String(row.bindingHash);
}

function persistedPromptSetValid(set: any, event: any): boolean {
  const payload = event?.payload;
  const slots = Array.isArray(set?.slots)
    ? [...set.slots].sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    : [];
  if (!set
    || !event
    || !payload
    || typeof payload !== 'object'
    || Array.isArray(payload)
    || String(event.suiteId) !== String(set.suiteId)
    || String(event.ownerUserId) !== String(set.ownerUserId)
    || String(event.actorUserId) !== String(set.actorUserId)
    || Number(event.revision) !== 3
    || event.eventType !== 'PROMPTS_FROZEN'
    || String(payload.version) !== PROMPT_EVENT_VERSION
    || String(payload.promptSetId) !== String(set.id)
    || String(payload.promptSetHash) !== String(set.promptSetHash)
    || String(payload.referenceSetHash) !== String(set.referenceSetHash)
    || String(payload.operationKey) !== String(set.operationKey)
    || String(payload.requestFingerprint) !== String(set.requestFingerprint)
    || String(payload.promptSetVersion) !== String(set.version)
    || String(payload.compilerVersion) !== String(set.compilerVersion)
    || String(payload.policyVersion) !== String(set.policyVersion)
    || String(payload.policyHash) !== String(set.policyHash)
    || String(payload.planId) !== String(set.planId)
    || String(payload.planVersionId) !== String(set.planVersionId)
    || String(payload.planHash) !== String(set.planHash)
    || String(payload.sourceSubjectId) !== String(set.sourceSubjectId)
    || String(payload.sourceCaptureSnapshotId) !== String(set.sourceCaptureSnapshotId)
    || String(payload.sourceCaptureHash) !== String(set.sourceCaptureHash)
    || String(payload.sourceProfileHash) !== String(set.sourceProfileHash)
    || String(payload.sourceSchemaVersion) !== String(set.sourceSchemaVersion)
    || String(payload.provider) !== String(set.provider)
    || String(payload.model) !== String(set.model)
    || String(payload.providerConfigHash) !== String(set.providerConfigHash)
    || String(payload.templateKey) !== String(set.templateKey)
    || String(payload.templateReleaseId) !== String(set.templateReleaseId)
    || String(payload.templateRevisionId) !== String(set.templateRevisionId)
    || Number(payload.templateSequence) !== Number(set.templateSequence)
    || String(payload.templateChecksum) !== String(set.templateChecksum)
    || String(payload.templateSnapshotHash) !== String(set.templateSnapshotHash)
    || Number(payload.slotCount) !== Number(set.slotCount)
    || String(set.version) !== AI_IMAGE_SUITE_PROMPT_SET_VERSION
    || !sha256(set.policyHash)
    || String(payload.policyHash) !== String(set.policyHash)
    || !Array.isArray(payload.slotPromptHashes)
    || payload.slotPromptHashes.length !== slots.length
    || slots.length !== Number(set.slotCount)
    || hashAiMediaPlanningJson(payload) !== String(event.payloadHash)
    || hashAiMediaPlanningJson(set.templateSnapshot) !== String(set.templateSnapshotHash)
    || slots.some((row, ordinal) => !persistedSlotValid(row, set, payload, ordinal))
    || hashAiMediaPlanningJson(payload.slotPromptHashes) !== hashAiMediaPlanningJson(
      slots.map((row) => String(row.bindingHash)),
    )) return false;
  const setCore = {
    version: AI_IMAGE_SUITE_PROMPT_SET_VERSION,
    compilerVersion: String(set.compilerVersion),
    policyVersion: String(set.policyVersion),
    policyHash: String(set.policyHash),
    suiteId: String(set.suiteId),
    ownerUserId: String(set.ownerUserId),
    planId: String(set.planId),
    planVersionId: String(set.planVersionId),
    planHash: String(set.planHash),
    provider: String(set.provider),
    model: String(set.model),
    providerConfigHash: String(set.providerConfigHash),
    sourceSubjectId: String(set.sourceSubjectId),
    sourceCaptureSnapshotId: String(set.sourceCaptureSnapshotId),
    sourceCaptureHash: String(set.sourceCaptureHash),
    sourceProfileHash: String(set.sourceProfileHash),
    sourceSchemaVersion: String(set.sourceSchemaVersion),
    referenceSetHash: String(set.referenceSetHash),
    templateKey: String(set.templateKey),
    templateReleaseId: String(set.templateReleaseId),
    templateRevisionId: String(set.templateRevisionId),
    templateSequence: Number(set.templateSequence),
    templateChecksum: String(set.templateChecksum),
    templateSnapshotHash: String(set.templateSnapshotHash),
    promptBindingHashes: slots.map((row) => String(row.bindingHash)),
  };
  return hashAiMediaPlanningJson(setCore) === String(set.promptSetHash);
}

async function readReplay(
  client: any,
  input: FreezeAiImageSuitePromptsInput,
  expectedPromptSetHash?: string,
): Promise<AiImageSuitePromptReplayResult> {
  const key = eventKey(input);
  const event = await client.aiMediaSuiteEvent.findUnique({ where: { eventKey: key } });
  if (!event) return null;
  const set = await client.aiMediaSuitePromptSet.findFirst({
    where: { suiteId: input.suiteId, ownerUserId: input.ownerUserId },
    include: promptSetInclude,
  });
  const payload = event.payload;
  if (!set
    || !persistedPromptSetValid(set, event)
    || String(set.operationKey) !== input.operationKey
    || String(set.requestFingerprint) !== requestFingerprint(input)
    || String(set.actorUserId) !== input.actorUserId
    || String(payload?.operationKey) !== input.operationKey
    || String(payload?.requestFingerprint) !== requestFingerprint(input)
    || (expectedPromptSetHash !== undefined
      && String(set.promptSetHash) !== expectedPromptSetHash)) return { kind: 'conflict' };
  return { kind: 'existing', ...summary(set) };
}

async function readAnyFrozen(client: any, input: FreezeAiImageSuitePromptsInput) {
  const reusedOperation = await client.aiMediaSuitePromptSet.findFirst({
    where: { ownerUserId: input.ownerUserId, operationKey: input.operationKey },
    include: promptSetInclude,
  });
  if (reusedOperation && String(reusedOperation.suiteId) !== input.suiteId) return { kind: 'conflict' as const };
  const set = reusedOperation || await client.aiMediaSuitePromptSet.findFirst({
    where: { suiteId: input.suiteId, ownerUserId: input.ownerUserId },
    include: promptSetInclude,
  });
  if (!set) return null;
  const event = await client.aiMediaSuiteEvent.findFirst({
    where: {
      suiteId: input.suiteId,
      ownerUserId: input.ownerUserId,
      eventType: 'PROMPTS_FROZEN',
    },
    orderBy: { revision: 'asc' },
  });
  return persistedPromptSetValid(set, event)
    ? { kind: 'already-frozen' as const }
    : { kind: 'conflict' as const };
}

function promptCore(prompt: FrozenAiImageSuiteSlotPrompt) {
  const {
    bindingHash: _bindingHash,
    ...core
  } = prompt;
  return core;
}

function commitInputValid(input: CommitAiImageSuitePromptSetInput): boolean {
  if (input.promptSetVersion !== AI_IMAGE_SUITE_PROMPT_SET_VERSION
    || input.compilerVersion !== AI_IMAGE_SUITE_PROMPT_COMPILER_VERSION
    || input.policyVersion !== AI_IMAGE_SUITE_SLOT_POLICY_VERSION
    || input.expectedRevision !== 2
    || !exact(input.operationKey, 128)
    || input.operationKey.length < 8
    || input.requestFingerprint !== requestFingerprint(input)
    || !sha256(input.policyHash)
    || !sha256(input.planHash)
    || !sha256(input.providerConfigHash)
    || !sha256(input.sourceCaptureHash)
    || !sha256(input.sourceProfileHash)
    || !sha256(input.referenceSetHash)
    || !sha256(input.templateChecksum)
    || !sha256(input.templateSnapshotHash)
    || !sha256(input.promptSetHash)
    || !exact(input.templateKey)
    || !exact(input.templateReleaseId, 200)
    || !exact(input.templateRevisionId, 200)
    || !Number.isSafeInteger(input.templateSequence)
    || input.templateSequence < 1
    || !input.templateSnapshot
    || typeof input.templateSnapshot !== 'object'
    || Array.isArray(input.templateSnapshot)
    || hashAiMediaPlanningJson(input.templateSnapshot) !== input.templateSnapshotHash
    || !Array.isArray(input.prompts)
    || input.prompts.length < 1
    || input.prompts.length > 500) return false;
  const snapshot = input.templateSnapshot as Record<string, unknown>;
  if (String(snapshot.templateKey) !== input.templateKey
    || String(snapshot.releaseId) !== input.templateReleaseId
    || String(snapshot.revisionId) !== input.templateRevisionId
    || Number(snapshot.sequence) !== input.templateSequence
    || String(snapshot.checksum) !== input.templateChecksum) return false;
  const slots = new Set<string>();
  const promptHashes: string[] = [];
  for (const [ordinal, prompt] of input.prompts.entries()) {
    if (prompt.version !== AI_IMAGE_SUITE_SLOT_PROMPT_VERSION
      || prompt.suiteId !== input.suiteId
      || prompt.ownerUserId !== input.ownerUserId
      || prompt.ordinal !== ordinal
      || slots.has(prompt.slotId)
      || prompt.referenceSetHash !== input.referenceSetHash
      || prompt.templateKey !== input.templateKey
      || prompt.templateReleaseId !== input.templateReleaseId
      || prompt.templateRevisionId !== input.templateRevisionId
      || prompt.templateSequence !== input.templateSequence
      || prompt.templateChecksum !== input.templateChecksum
      || !sha256(prompt.slotHash)
      || !sha256(prompt.referencesHash)
      || hashAiMediaPlanningJson(prompt.variablesSnapshot) !== prompt.variablesHash
      || textHash(prompt.resolvedPrompt) !== prompt.resolvedPromptHash
      || textHash(prompt.resolvedNegativePrompt) !== prompt.resolvedNegativePromptHash
      || hashAiMediaPlanningJson({
        resolvedPrompt: prompt.resolvedPrompt,
        resolvedNegativePrompt: prompt.resolvedNegativePrompt,
      }) !== prompt.compiledPromptHash
      || hashAiMediaPlanningJson({
        ...promptCore(prompt),
        templateSnapshotHash: input.templateSnapshotHash,
        compilerVersion: input.compilerVersion,
        policyVersion: input.policyVersion,
        policyHash: input.policyHash,
      }) !== prompt.bindingHash) return false;
    slots.add(prompt.slotId);
    promptHashes.push(prompt.bindingHash);
  }
  return hashAiMediaPlanningJson({
    version: input.promptSetVersion,
    compilerVersion: input.compilerVersion,
    policyVersion: input.policyVersion,
    policyHash: input.policyHash,
    suiteId: input.suiteId,
    ownerUserId: input.ownerUserId,
    planId: input.planId,
    planVersionId: input.planVersionId,
    planHash: input.planHash,
    provider: input.provider,
    model: input.model,
    providerConfigHash: input.providerConfigHash,
    sourceSubjectId: input.sourceSubjectId,
    sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
    sourceCaptureHash: input.sourceCaptureHash,
    sourceProfileHash: input.sourceProfileHash,
    sourceSchemaVersion: input.sourceSchemaVersion,
    referenceSetHash: input.referenceSetHash,
    templateKey: input.templateKey,
    templateReleaseId: input.templateReleaseId,
    templateRevisionId: input.templateRevisionId,
    templateSequence: input.templateSequence,
    templateChecksum: input.templateChecksum,
    templateSnapshotHash: input.templateSnapshotHash,
    promptBindingHashes: promptHashes,
  }) === input.promptSetHash;
}

function inputMatchesAuthority(input: CommitAiImageSuitePromptSetInput, authority: AiImageSuitePromptAuthority): boolean {
  if (input.suiteId !== authority.suiteId
    || input.ownerUserId !== authority.ownerUserId
    || input.planId !== authority.planId
    || input.planVersionId !== authority.planVersionId
    || input.planHash !== authority.planHash
    || input.provider !== authority.provider
    || input.model !== authority.model
    || input.providerConfigHash !== authority.providerConfigHash
    || input.sourceSubjectId !== authority.sourceSubjectId
    || input.sourceCaptureSnapshotId !== authority.sourceCaptureSnapshotId
    || input.sourceCaptureHash !== authority.sourceCaptureHash
    || input.sourceProfileHash !== authority.sourceProfileHash
    || input.sourceSchemaVersion !== authority.sourceSchemaVersion
    || input.referenceSetHash !== authority.referenceSetHash
    || input.prompts.length !== authority.slots.length) return false;
  return input.prompts.every((prompt, ordinal) => {
    const slot = authority.slots[ordinal];
    return Boolean(slot
      && prompt.slotId === slot.id
      && prompt.ordinal === slot.ordinal
      && prompt.slotKey === slot.slotKey
      && prompt.slotHash === slot.slotHash
      && prompt.referencesHash === slot.referencesHash);
  });
}

function promptSetData(input: CommitAiImageSuitePromptSetInput) {
  return {
    suiteId: input.suiteId,
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    version: input.promptSetVersion,
    operationKey: input.operationKey,
    requestFingerprint: input.requestFingerprint,
    planId: input.planId,
    planVersionId: input.planVersionId,
    sourceSubjectId: input.sourceSubjectId,
    sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
    sourceCaptureHash: input.sourceCaptureHash,
    sourceProfileHash: input.sourceProfileHash,
    sourceSchemaVersion: input.sourceSchemaVersion,
    templateKey: input.templateKey,
    templateReleaseId: input.templateReleaseId,
    templateRevisionId: input.templateRevisionId,
    templateSequence: input.templateSequence,
    templateChecksum: input.templateChecksum,
    templateSnapshot: input.templateSnapshot,
    templateSnapshotHash: input.templateSnapshotHash,
    compilerVersion: input.compilerVersion,
    policyVersion: input.policyVersion,
    policyHash: input.policyHash,
    planHash: input.planHash,
    provider: input.provider,
    model: input.model,
    providerConfigHash: input.providerConfigHash,
    referenceSetHash: input.referenceSetHash,
    slotCount: input.prompts.length,
    promptSetHash: input.promptSetHash,
  };
}

function slotPromptData(input: CommitAiImageSuitePromptSetInput, promptSetId: string, prompt: FrozenAiImageSuiteSlotPrompt) {
  return {
    promptSetId,
    suiteId: input.suiteId,
    slotId: prompt.slotId,
    ownerUserId: input.ownerUserId,
    version: prompt.version,
    ordinal: prompt.ordinal,
    slotKey: prompt.slotKey,
    slotHash: prompt.slotHash,
    referencesHash: prompt.referencesHash,
    referenceSetHash: prompt.referenceSetHash,
    templateKey: input.templateKey,
    templateReleaseId: input.templateReleaseId,
    templateRevisionId: input.templateRevisionId,
    templateSequence: input.templateSequence,
    templateChecksum: input.templateChecksum,
    templateSnapshot: input.templateSnapshot,
    templateSnapshotHash: input.templateSnapshotHash,
    variablesSnapshot: prompt.variablesSnapshot,
    variablesHash: prompt.variablesHash,
    resolvedPrompt: prompt.resolvedPrompt,
    resolvedNegativePrompt: prompt.resolvedNegativePrompt,
    compiledPromptHash: prompt.compiledPromptHash,
    compilerVersion: input.compilerVersion,
    policyVersion: input.policyVersion,
    policyHash: input.policyHash,
    resolvedPromptHash: prompt.resolvedPromptHash,
    resolvedNegativePromptHash: prompt.resolvedNegativePromptHash,
    bindingHash: prompt.bindingHash,
  };
}

function eventPayload(input: CommitAiImageSuitePromptSetInput, promptSetId: string) {
  return {
    version: PROMPT_EVENT_VERSION,
    operationKey: input.operationKey,
    requestFingerprint: input.requestFingerprint,
    commitFingerprint: commitFingerprint(input),
    promptSetId,
    promptSetHash: input.promptSetHash,
    promptSetVersion: input.promptSetVersion,
    compilerVersion: input.compilerVersion,
    policyVersion: input.policyVersion,
    policyHash: input.policyHash,
    planId: input.planId,
    planVersionId: input.planVersionId,
    planHash: input.planHash,
    sourceSubjectId: input.sourceSubjectId,
    sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
    sourceCaptureHash: input.sourceCaptureHash,
    sourceProfileHash: input.sourceProfileHash,
    sourceSchemaVersion: input.sourceSchemaVersion,
    provider: input.provider,
    model: input.model,
    providerConfigHash: input.providerConfigHash,
    referenceSetHash: input.referenceSetHash,
    templateKey: input.templateKey,
    templateReleaseId: input.templateReleaseId,
    templateRevisionId: input.templateRevisionId,
    templateSequence: input.templateSequence,
    templateChecksum: input.templateChecksum,
    templateSnapshotHash: input.templateSnapshotHash,
    slotCount: input.prompts.length,
    slotPromptHashes: input.prompts.map((prompt) => prompt.bindingHash),
  };
}

export class PrismaAiImageSuitePromptRepository implements AiImageSuitePromptRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findCommitReplay(input: FreezeAiImageSuitePromptsInput): Promise<AiImageSuitePromptReplayResult> {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const exactReplay = await readReplay(tx, input);
      if (exactReplay) return exactReplay;
      return readAnyFrozen(tx, input);
    });
  }

  async loadAuthority(input: {
    suiteId: string;
    ownerUserId: string;
  }): Promise<AiImageSuitePromptAuthorityResult> {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const suite = await readSuite(tx, input.suiteId, input.ownerUserId);
      if (!suite) return { kind: 'not-found' as const };
      const latest = await readLatest(tx, suite);
      return authorityFromSuite(suite, latest);
    });
  }

  async commitPromptSet(
    input: CommitAiImageSuitePromptSetInput,
  ): Promise<AiImageSuitePromptCommitResult> {
    const replayInput: FreezeAiImageSuitePromptsInput = {
      suiteId: input.suiteId,
      ownerUserId: input.ownerUserId,
      actorUserId: input.actorUserId,
      expectedRevision: input.expectedRevision,
      operationKey: input.operationKey,
    };
    const commit = async () => runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const replay = await readReplay(tx, replayInput, input.promptSetHash);
      if (replay) return replay;
      const frozen = await readAnyFrozen(tx, replayInput);
      if (frozen) return frozen;
      if (!commitInputValid(input)) return { kind: 'conflict' as const };

      const suite = await readSuite(tx, input.suiteId, input.ownerUserId);
      if (!suite) return { kind: 'not-found' as const };
      if (Number(suite.revision) < 2 || !referenceEvent(suite)) {
        return { kind: 'references-not-ready' as const };
      }
      const latest = await readLatest(tx, suite);
      const loaded = authorityFromSuite(suite, latest);
      if (loaded.kind !== 'ready') return loaded;
      if (Number(suite.revision) !== input.expectedRevision) {
        return { kind: 'revision-conflict' as const };
      }
      if (!inputMatchesAuthority(input, loaded.authority)) return { kind: 'conflict' as const };

      const [release, revision] = await Promise.all([
        tx.aiPromptRelease.findFirst({
          where: {
            id: input.templateReleaseId,
            templateKey: input.templateKey,
            revisionId: input.templateRevisionId,
            sequence: input.templateSequence,
          },
        }),
        tx.aiPromptRevision.findFirst({
          where: {
            id: input.templateRevisionId,
            templateKey: input.templateKey,
            status: 'PUBLISHED',
            checksum: input.templateChecksum,
          },
        }),
      ]);
      if (!release
        || !revision
        || String(release.revisionId) !== input.templateRevisionId
        || Number(release.sequence) !== input.templateSequence
        || String(revision.checksum) !== input.templateChecksum) {
        return { kind: 'conflict' as const };
      }

      const advanced = await tx.aiMediaSuite.updateMany({
        where: {
          id: input.suiteId,
          ownerUserId: input.ownerUserId,
          revision: input.expectedRevision,
          status: 'PLANNED',
          planId: input.planId,
          planVersionId: input.planVersionId,
          sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
          providerConfigHash: input.providerConfigHash,
        },
        data: { revision: { increment: 1 } },
      });
      if (advanced.count !== 1) return { kind: 'revision-conflict' as const };

      const set = await tx.aiMediaSuitePromptSet.create({ data: promptSetData(input) });
      await tx.aiMediaSuiteSlotPrompt.createMany({
        data: input.prompts.map((prompt) => slotPromptData(input, String(set.id), prompt)),
      });
      const payload = eventPayload(input, String(set.id));
      await tx.aiMediaSuiteEvent.create({
        data: {
          suiteId: input.suiteId,
          ownerUserId: input.ownerUserId,
          revision: input.expectedRevision + 1,
          actorUserId: input.actorUserId,
          eventKey: eventKey(replayInput),
          eventType: 'PROMPTS_FROZEN',
          payload,
          payloadHash: hashAiMediaPlanningJson(payload),
        },
      });
      return { kind: 'committed' as const, ...summary(set) };
    });

    try {
      return await commit();
    } catch (error) {
      if (!isRace(error)) throw error;
      const replay = await this.findCommitReplay(replayInput);
      if (replay?.kind === 'existing' || replay?.kind === 'already-frozen' || replay?.kind === 'conflict') {
        return replay;
      }
      throw error;
    }
  }
}
