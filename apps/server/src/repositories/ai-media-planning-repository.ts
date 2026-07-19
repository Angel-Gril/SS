import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY,
  verifySourceProductCaptureV2Submission,
  type SourceProductCaptureV2Submission,
} from 'shared';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';
import { buildSourceProductProfileFromCapture } from '../services/source-product-profile.js';
import {
  hashAiMediaPlanningJson,
  type AiMediaPlanningAuthority,
  type AiMediaPlanningRepository,
  type AiMediaPlanRecord,
  type AiMediaPlanVersionRecord,
  type AiMediaPlanningCurrentTarget,
  type AiMediaPlanningSourceAuthority,
  type AiMediaPlanVersionPageInput,
  type CreateRulePlanResult,
  type CreateRuleBasedAiMediaPlanningInput,
  type ExecutionPlanResult,
  type ReviewAiMediaPlanInput,
  type ReviewRulePlanResult,
  type RuleBasedAiMediaPlanningArtifacts,
} from '../services/ai-media-planning.js';

const planDetailInclude = {
  currentVersion: true,
  approvedVersion: true,
} as const;

interface SourceAuthority {
  id: string;
  captureHash: string;
  profileHash: string;
  schemaVersion: string;
}

type StaleCheckResult =
  | { kind: 'current'; plan: null }
  | { kind: 'stale'; plan: AiMediaPlanRecord }
  | { kind: 'conflict'; plan: AiMediaPlanRecord | null };

function versionRecord(row: any): AiMediaPlanVersionRecord {
  return {
    id: String(row.id),
    planId: String(row.planId),
    ownerUserId: String(row.ownerUserId),
    version: Number(row.version),
    sourceCaptureSnapshotId: String(row.sourceCaptureSnapshotId),
    sourceCaptureHash: String(row.sourceCaptureHash),
    sourceProfileHash: String(row.sourceProfileHash),
    sourceSchemaVersion: String(row.sourceSchemaVersion),
    inputFingerprint: String(row.inputFingerprint),
    planSchemaVersion: String(row.planSchemaVersion),
    plannerVersion: String(row.plannerVersion),
    mode: row.mode,
    fallbackReason: row.fallbackReason == null ? null : String(row.fallbackReason),
    inputSnapshot: row.inputSnapshot,
    curation: row.curation,
    curationHash: String(row.curationHash),
    visionEvidence: row.visionEvidence,
    visionEvidenceHash: String(row.visionEvidenceHash),
    planHash: String(row.planHash),
    planPayload: row.planPayload,
    provenance: row.provenance,
    provenanceHash: String(row.provenanceHash),
    createdAt: row.createdAt,
  };
}

function planRecord(row: any): AiMediaPlanRecord {
  const record: AiMediaPlanRecord = {
    id: String(row.id),
    ownerUserId: String(row.ownerUserId),
    actorUserId: String(row.actorUserId),
    sourceSubjectId: String(row.sourceSubjectId),
    contextType: String(row.contextType),
    contextId: String(row.contextId),
    revision: Number(row.revision),
    latestVersion: Number(row.latestVersion),
    currentVersionId: row.currentVersionId == null ? null : String(row.currentVersionId),
    approvedVersionId: row.approvedVersionId == null ? null : String(row.approvedVersionId),
    reviewStatus: row.reviewStatus,
    staleAt: row.staleAt,
    staleAgainstFingerprint: row.staleAgainstFingerprint == null
      ? null
      : String(row.staleAgainstFingerprint),
    staleReasons: row.staleReasons,
    reviewedByUserId: row.reviewedByUserId == null ? null : String(row.reviewedByUserId),
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (Object.prototype.hasOwnProperty.call(row, 'currentVersion')) {
    record.currentVersion = row.currentVersion ? versionRecord(row.currentVersion) : null;
  }
  if (Object.prototype.hasOwnProperty.call(row, 'approvedVersion')) {
    record.approvedVersion = row.approvedVersion ? versionRecord(row.approvedVersion) : null;
  }
  return record;
}

function isUniqueConstraintError(error: unknown): boolean {
  return String((error as { code?: unknown } | null)?.code || '') === 'P2002';
}

function eventPayload<T extends Record<string, unknown>>(payload: T) {
  return { payload, payloadHash: hashAiMediaPlanningJson(payload) };
}

async function readOwnedPlan(client: any, planId: string, ownerUserId: string) {
  return client.aiMediaPlan.findFirst({
    where: { id: planId, ownerUserId },
    include: planDetailInclude,
  });
}

async function readCreateReplay(
  client: any,
  input: RuleBasedAiMediaPlanningArtifacts,
): Promise<CreateRulePlanResult | null> {
  const existing = await client.aiMediaPlan.findFirst({
    where: { ownerUserId: input.ownerUserId, idempotencyKey: input.idempotencyKey },
    include: planDetailInclude,
  });
  if (!existing) return null;
  return {
    kind: existing.requestFingerprint === input.requestFingerprint ? 'existing' : 'conflict',
    plan: planRecord(existing),
  };
}

async function loadLatestOwnedSourceAuthority(
  client: any,
  input: {
    ownerUserId: string;
    sourceSubjectId: string;
    contextType: string;
    contextId: string;
  },
): Promise<SourceAuthority | null> {
  if (input.contextType !== 'collect') return null;
  const goods = await client.supplyGoods.findFirst({
    where: { id: input.contextId, userId: input.ownerUserId },
    select: { id: true },
  });
  if (!goods) return null;
  const subject = await client.sourceCaptureSubject.findFirst({
    where: {
      id: input.sourceSubjectId,
      ownerUserId: input.ownerUserId,
      legacySupplyGoodsId: input.contextId,
    },
    select: {
      snapshots: {
        orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
        take: 1,
        select: {
          id: true,
          captureHash: true,
          profileHash: true,
          schemaVersion: true,
        },
      },
    },
  });
  const latest = subject?.snapshots?.[0];
  return latest ? {
    id: String(latest.id),
    captureHash: String(latest.captureHash),
    profileHash: String(latest.profileHash),
    schemaVersion: String(latest.schemaVersion),
  } : null;
}

function sameSourceAuthority(
  latest: SourceAuthority | null,
  expected: {
    sourceCaptureSnapshotId: string;
    sourceCaptureHash: string;
    sourceProfileHash: string;
    sourceSchemaVersion: string;
  },
): boolean {
  return Boolean(latest
    && latest.id === expected.sourceCaptureSnapshotId
    && latest.captureHash === expected.sourceCaptureHash
    && latest.profileHash === expected.sourceProfileHash
    && latest.schemaVersion === expected.sourceSchemaVersion);
}

function sourceAuthorityView(authority: SourceAuthority | null) {
  return authority ? {
    snapshotId: authority.id,
    captureHash: authority.captureHash,
    profileHash: authority.profileHash,
    schemaVersion: authority.schemaVersion,
  } : null;
}

function staleReasons(current: any, latest: SourceAuthority | null): string[] {
  if (!current) return ['CURRENT_PLAN_VERSION_MISSING'];
  if (!latest) return ['SOURCE_CONTEXT_MISSING'];
  const reasons: string[] = [];
  if (latest.id !== current.sourceCaptureSnapshotId) reasons.push('SOURCE_CAPTURE_SNAPSHOT_CHANGED');
  if (latest.captureHash !== current.sourceCaptureHash) reasons.push('SOURCE_CAPTURE_HASH_CHANGED');
  if (latest.profileHash !== current.sourceProfileHash) reasons.push('SOURCE_PROFILE_HASH_CHANGED');
  if (latest.schemaVersion !== current.sourceSchemaVersion) reasons.push('SOURCE_SCHEMA_VERSION_CHANGED');
  return reasons;
}

async function markStaleIfChanged(
  client: any,
  plan: any,
  actorUserId: string,
): Promise<StaleCheckResult> {
  if (plan.staleAt) return { kind: 'stale', plan: planRecord(plan) };
  const latest = await loadLatestOwnedSourceAuthority(client, plan);
  const reasons = staleReasons(plan.currentVersion, latest);
  if (reasons.length === 0) return { kind: 'current', plan: null };

  const planned = plan.currentVersion ? {
    snapshotId: String(plan.currentVersion.sourceCaptureSnapshotId),
    captureHash: String(plan.currentVersion.sourceCaptureHash),
    profileHash: String(plan.currentVersion.sourceProfileHash),
    schemaVersion: String(plan.currentVersion.sourceSchemaVersion),
  } : null;
  const staleReasonsPayload = {
    version: 'ai-media-plan-stale/v1',
    reasons,
    planned,
    latest: sourceAuthorityView(latest),
  };
  const againstFingerprint = hashAiMediaPlanningJson({
    contextType: plan.contextType,
    contextId: plan.contextId,
    sourceSubjectId: plan.sourceSubjectId,
    latest: sourceAuthorityView(latest),
  });
  const nextRevision = Number(plan.revision) + 1;
  const updated = await client.aiMediaPlan.updateMany({
    where: {
      id: plan.id,
      ownerUserId: plan.ownerUserId,
      revision: plan.revision,
      staleAt: null,
    },
    data: {
      revision: { increment: 1 },
      staleAt: new Date(),
      staleAgainstFingerprint: againstFingerprint,
      staleReasons: staleReasonsPayload,
    },
  });
  if (updated.count !== 1) {
    const current = await readOwnedPlan(client, plan.id, plan.ownerUserId);
    if (current?.staleAt) return { kind: 'stale', plan: planRecord(current) };
    return { kind: 'conflict', plan: current ? planRecord(current) : null };
  }

  const payload = {
    againstFingerprint,
    ...staleReasonsPayload,
  };
  await client.aiMediaPlanEvent.create({
    data: {
      planId: plan.id,
      ownerUserId: plan.ownerUserId,
      versionId: plan.currentVersionId,
      actorUserId,
      revision: nextRevision,
      eventKey: `${plan.id}:stale:${nextRevision}:${againstFingerprint}`,
      eventType: 'SOURCE_CONTEXT_STALE',
      ...eventPayload(payload),
    },
  });
  const stale = await readOwnedPlan(client, plan.id, plan.ownerUserId);
  if (stale?.staleAt) return { kind: 'stale', plan: planRecord(stale) };
  return { kind: 'conflict', plan: stale ? planRecord(stale) : null };
}

function reviewOperation(input: ReviewAiMediaPlanInput) {
  return {
    operationKey: input.operationKey,
    expectedRevision: input.expectedRevision,
    actorUserId: input.actorUserId,
    decision: input.decision,
    note: input.note,
  };
}

function reviewEventKey(input: ReviewAiMediaPlanInput): string {
  return `${input.planId}:review:${hashAiMediaPlanningJson({ operationKey: input.operationKey })}`;
}

function isExactReviewEvent(
  event: any,
  input: ReviewAiMediaPlanInput,
  operationHash: string,
): boolean {
  return Boolean(event
    && event.planId === input.planId
    && event.ownerUserId === input.ownerUserId
    && event.payloadHash === operationHash
    && event.eventType === (input.decision === 'APPROVE' ? 'REVIEW_APPROVED' : 'REVIEW_REJECTED'));
}

function retryStaleCasConflict(): never {
  const error = new Error('AI media planning stale CAS conflicted with a concurrent update');
  (error as { code?: string }).code = 'P2034';
  throw error;
}

function candidateEvidenceId(snapshotId: string, candidateId: string): string {
  const path = `/media/${encodeURIComponent(candidateId)}`;
  const evidenceHash = createHash('sha256').update(`${path}\u0000${candidateId}`).digest('hex');
  return `capture:${snapshotId}:evidence:${evidenceHash}`;
}

function hasExecutionEvidence(plan: any): boolean {
  const version = plan?.currentVersion;
  const payload = version?.planPayload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const slots = (payload as { slots?: unknown }).slots;
  if (!Array.isArray(slots) || slots.length === 0) return false;
  const curation = version?.curation;
  const selectionTarget = curation && typeof curation === 'object' && !Array.isArray(curation)
    ? (curation as { selectionTarget?: unknown }).selectionTarget
    : null;
  if (!selectionTarget || typeof selectionTarget !== 'object' || Array.isArray(selectionTarget)
    || (selectionTarget as { met?: unknown }).met !== true) return false;
  const selectedCandidateIds = (curation as { selectedCandidateIds?: unknown }).selectedCandidateIds;
  if (!Array.isArray(selectedCandidateIds) || selectedCandidateIds.length < 1
    || selectedCandidateIds.some((candidateId) => typeof candidateId !== 'string' || !candidateId.trim())) {
    return false;
  }
  const selectedCandidates = new Set<string>(selectedCandidateIds);
  const inputSnapshot = version?.inputSnapshot;
  const inputCandidates = inputSnapshot && typeof inputSnapshot === 'object' && !Array.isArray(inputSnapshot)
    ? (inputSnapshot as { candidates?: unknown }).candidates
    : null;
  if (!Array.isArray(inputCandidates) || inputCandidates.length < 1) return false;
  const inputCandidateIds = new Set(inputCandidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const id = (candidate as { id?: unknown }).id;
    return typeof id === 'string' && id.trim() ? [id] : [];
  }));
  const vision = version?.visionEvidence;
  const visionImages = vision && typeof vision === 'object' && !Array.isArray(vision)
    ? (vision as { images?: unknown }).images
    : null;
  if (!Array.isArray(visionImages) || visionImages.length < 1) return false;
  const visionCandidateIds = new Set(visionImages.flatMap((image) => {
    if (!image || typeof image !== 'object' || Array.isArray(image)) return [];
    const candidateId = (image as { candidateId?: unknown }).candidateId;
    return typeof candidateId === 'string' && candidateId.trim() ? [candidateId] : [];
  }));
  const verifiedFacts = (payload as { verifiedFacts?: unknown }).verifiedFacts;
  if (!Array.isArray(verifiedFacts)) return false;
  const verifiedFactEvidenceIds = new Set(verifiedFacts.flatMap((fact) => {
    if (!fact || typeof fact !== 'object' || Array.isArray(fact)) return [];
    const evidenceIds = (fact as { evidenceIds?: unknown }).evidenceIds;
    return Array.isArray(evidenceIds)
      ? evidenceIds.filter((evidenceId): evidenceId is string => (
        typeof evidenceId === 'string' && Boolean(evidenceId.trim())
      ))
      : [];
  }));
  const nonEmptyStringArray = (value: unknown): value is string[] => (
    Array.isArray(value)
    && value.length > 0
    && value.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
  return slots.every((rawSlot) => {
    if (!rawSlot || typeof rawSlot !== 'object' || Array.isArray(rawSlot)) return false;
    const slot = rawSlot as {
      status?: unknown;
      goal?: unknown;
      ownership?: unknown;
      references?: unknown;
      factEvidenceIds?: unknown;
      safetyConstraints?: unknown;
      acceptanceChecks?: unknown;
    };
    if (slot.status !== 'READY' || typeof slot.goal !== 'string' || !slot.goal.trim()) return false;
    const ownership = slot.ownership;
    if (!ownership || typeof ownership !== 'object' || Array.isArray(ownership)) return false;
    const owner = ownership as { level?: unknown; key?: unknown };
    if ((owner.level !== 'sku' && owner.level !== 'compatibility_group')
      || typeof owner.key !== 'string' || !owner.key.trim()) return false;
    if (!Array.isArray(slot.references) || slot.references.length < 1) return false;
    if (slot.references.some((rawReference) => {
      if (!rawReference || typeof rawReference !== 'object' || Array.isArray(rawReference)) return true;
      const reference = rawReference as { candidateId?: unknown; evidenceIds?: unknown };
      const expectedEvidenceId = typeof reference.candidateId === 'string'
        ? candidateEvidenceId(version.sourceCaptureSnapshotId, reference.candidateId)
        : null;
      return typeof reference.candidateId !== 'string'
        || !reference.candidateId.trim()
        || !selectedCandidates.has(reference.candidateId)
        || !inputCandidateIds.has(reference.candidateId)
        || !visionCandidateIds.has(reference.candidateId)
        || !Array.isArray(reference.evidenceIds)
        || reference.evidenceIds.length < 1
        || reference.evidenceIds.some((evidenceId) => (
          typeof evidenceId !== 'string'
          || !evidenceId.trim()
          || evidenceId !== expectedEvidenceId
        ));
    })) return false;
    if (!Array.isArray(slot.factEvidenceIds)
      || slot.factEvidenceIds.some((evidenceId) => (
        typeof evidenceId !== 'string'
        || !evidenceId.trim()
        || !verifiedFactEvidenceIds.has(evidenceId)
      ))) return false;
    return nonEmptyStringArray(slot.safetyConstraints)
      && nonEmptyStringArray(slot.acceptanceChecks);
  });
}

export class PrismaAiMediaPlanningRepository implements AiMediaPlanningRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async resolveCurrentRulePlanningTarget(input: {
    ownerUserId: string;
    context: { type: 'collect'; id: string };
  }): Promise<AiMediaPlanningCurrentTarget | null> {
    const goods = await (this.prisma as any).supplyGoods.findFirst({
      where: { id: input.context.id, userId: input.ownerUserId },
      select: {
        sourceCaptureSubject: {
          select: {
            id: true,
            ownerUserId: true,
            snapshots: {
              orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
              take: 1,
              select: { id: true, payload: true },
            },
          },
        },
      },
    });
    const subject = goods?.sourceCaptureSubject;
    const snapshot = subject?.snapshots?.[0];
    if (!subject || subject.ownerUserId !== input.ownerUserId || !snapshot) return null;
    const capture = snapshot.payload as { skus?: Array<{ key?: unknown }> } | null;
    const capturedSkuKeys = Array.isArray(capture?.skus)
      ? capture.skus.flatMap((sku) => {
        const key = typeof sku?.key === 'string' ? sku.key.trim() : '';
        return key && key.length <= 500 ? [key] : [];
      }).slice(0, 50)
      : [];
    const selectedSkuKeys = capturedSkuKeys.length > 0
      ? capturedSkuKeys
      : [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY];
    return {
      sourceSubjectId: String(subject.id),
      sourceCaptureSnapshotId: String(snapshot.id),
      selectedSkuKeys,
    };
  }

  async loadRulePlanningAuthority(
    input: CreateRuleBasedAiMediaPlanningInput,
  ): Promise<AiMediaPlanningAuthority | null> {
    if (input.context.type !== 'collect') return null;
    const subject = await (this.prisma as any).sourceCaptureSubject.findFirst({
      where: {
        id: input.sourceSubjectId,
        ownerUserId: input.ownerUserId,
        legacySupplyGoodsId: input.context.id,
        legacySupplyGoods: { userId: input.ownerUserId },
      },
      select: {
        snapshots: {
          where: { id: input.sourceCaptureSnapshotId },
          take: 1,
          select: {
            id: true,
            captureHash: true,
            profileHash: true,
            schemaVersion: true,
            payload: true,
            payloadBytes: true,
          },
        },
      },
    });
    const snapshot = subject?.snapshots?.[0];
    const capture = snapshot?.payload as { captureVersion?: unknown } | null | undefined;
    if (!snapshot
      || capture?.captureVersion !== 'source-product-capture-v2') {
      return null;
    }
    const submission = {
      capture: snapshot.payload,
      captureHash: String(snapshot.captureHash),
      payloadBytes: Number(snapshot.payloadBytes),
    } as SourceProductCaptureV2Submission;
    const verified = await verifySourceProductCaptureV2Submission(submission);
    if (!verified.valid) return null;
    const profile = buildSourceProductProfileFromCapture(submission.capture, {
      itemId: String(snapshot.captureHash),
      captureHash: String(snapshot.captureHash),
    });
    if (profile.hash !== String(snapshot.profileHash)) return null;
    return {
      sourceCaptureHash: String(snapshot.captureHash),
      sourceProfileHash: String(snapshot.profileHash),
      sourceSchemaVersion: String(snapshot.schemaVersion),
      capture: submission.capture,
    };
  }

  async createRulePlan(input: RuleBasedAiMediaPlanningArtifacts): Promise<CreateRulePlanResult> {
    try {
      return await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
        const replay = await readCreateReplay(tx, input);
        if (replay) return replay;

        const latest = await loadLatestOwnedSourceAuthority(tx, input);
        if (!sameSourceAuthority(latest, input)) {
          return { kind: 'context-changed' as const, plan: null };
        }

        const now = new Date();
        const plan = await tx.aiMediaPlan.create({
          data: {
            ownerUserId: input.ownerUserId,
            actorUserId: input.actorUserId,
            sourceSubjectId: input.sourceSubjectId,
            contextType: input.contextType,
            contextId: input.contextId,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: input.requestFingerprint,
          },
        });
        const run = await tx.aiMediaPlanningRun.create({
          data: {
            planId: plan.id,
            ownerUserId: input.ownerUserId,
            sourceSubjectId: input.sourceSubjectId,
            actorUserId: input.actorUserId,
            sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
            attempt: 1,
            mode: 'RULE_BASED',
            engineVersion: input.engineVersion,
            status: 'SUCCEEDED',
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: input.requestFingerprint,
            sourceCaptureHash: input.sourceCaptureHash,
            sourceProfileHash: input.sourceProfileHash,
            inputFingerprint: input.inputFingerprint,
            inputSnapshot: input.inputSnapshot,
            inputHash: input.inputHash,
            inputBytes: input.inputBytes,
            startedAt: now,
            completedAt: now,
          },
        });
        const version = await tx.aiMediaPlanVersion.create({
          data: {
            planId: plan.id,
            ownerUserId: input.ownerUserId,
            sourceSubjectId: input.sourceSubjectId,
            version: 1,
            planningRunId: run.id,
            sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
            sourceCaptureHash: input.sourceCaptureHash,
            sourceProfileHash: input.sourceProfileHash,
            sourceSchemaVersion: input.sourceSchemaVersion,
            selectedSkuHash: input.selectedSkuHash,
            inputAssetSetHash: input.inputAssetSetHash,
            inputFingerprint: input.inputFingerprint,
            planSchemaVersion: input.planSchemaVersion,
            plannerVersion: input.engineVersion,
            mode: 'RULE_BASED',
            fallbackReason: input.visionEvidence.fallbackReason,
            inputSnapshot: input.inputSnapshot,
            inputHash: input.inputHash,
            curation: input.curation,
            curationHash: input.curationHash,
            visionEvidence: input.visionEvidence,
            visionEvidenceHash: input.visionEvidenceHash,
            planPayload: input.plan,
            planHash: input.planHash,
            planBytes: input.planBytes,
            provenance: input.provenance,
            provenanceHash: input.provenanceHash,
            actorUserId: input.actorUserId,
          },
        });
        await tx.aiMediaPlan.update({
          where: { id: plan.id },
          data: {
            latestVersion: 1,
            currentVersionId: version.id,
            reviewStatus: 'PENDING',
          },
        });
        const payload = {
          mode: 'RULE_BASED',
          plannerVersion: input.engineVersion,
          sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
          inputFingerprint: input.inputFingerprint,
          planHash: input.planHash,
          version: 1,
        };
        await tx.aiMediaPlanEvent.create({
          data: {
            planId: plan.id,
            ownerUserId: input.ownerUserId,
            versionId: version.id,
            runId: run.id,
            revision: 1,
            actorUserId: input.actorUserId,
            eventKey: `${plan.id}:created`,
            eventType: 'PLAN_CREATED',
            ...eventPayload(payload),
          },
        });
        const created = await readOwnedPlan(tx, plan.id, input.ownerUserId);
        return { kind: 'created' as const, plan: created ? planRecord(created) : null };
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const replay = await readCreateReplay(this.prisma as any, input);
      if (replay) return replay;
      throw error;
    }
  }

  async getOwned(planId: string, ownerUserId: string): Promise<AiMediaPlanRecord | null> {
    const row = await readOwnedPlan(this.prisma as any, planId, ownerUserId);
    return row ? planRecord(row) : null;
  }

  async getLatestOwnedByContext(input: {
    ownerUserId: string;
    contextType: 'collect';
    contextId: string;
  }): Promise<AiMediaPlanRecord | null> {
    const row = await (this.prisma as any).aiMediaPlan.findFirst({
      where: {
        ownerUserId: input.ownerUserId,
        contextType: input.contextType,
        contextId: input.contextId,
      },
      // Review/stale transitions update `updatedAt`; context lookup must select
      // the newest immutable plan creation rather than the most recently touched
      // historical plan.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: planDetailInclude,
    });
    return row ? planRecord(row) : null;
  }

  async loadLatestSourceAuthority(input: {
    ownerUserId: string;
    sourceSubjectId: string;
    contextType: string;
    contextId: string;
  }): Promise<AiMediaPlanningSourceAuthority | null> {
    const authority = await loadLatestOwnedSourceAuthority(this.prisma as any, input);
    return authority ? sourceAuthorityView(authority) : null;
  }

  async listVersionsOwned(
    planId: string,
    ownerUserId: string,
    page: AiMediaPlanVersionPageInput,
  ): Promise<AiMediaPlanVersionRecord[]> {
    const rows = await (this.prisma as any).aiMediaPlanVersion.findMany({
      where: {
        planId,
        ownerUserId,
        ...(page.beforeVersion === undefined ? {} : { version: { lt: page.beforeVersion } }),
      },
      orderBy: { version: 'desc' },
      take: page.limit,
    });
    return rows.map(versionRecord);
  }

  async reviewCurrent(input: ReviewAiMediaPlanInput): Promise<ReviewRulePlanResult> {
    const operation = reviewOperation(input);
    const operationHash = hashAiMediaPlanningJson(operation);
    const eventKey = reviewEventKey(input);
    try {
      return await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
        const plan = await readOwnedPlan(tx, input.planId, input.ownerUserId);
        if (!plan) return { kind: 'not-found' as const, plan: null };

        const existingEvent = await tx.aiMediaPlanEvent.findUnique({ where: { eventKey } });
        if (existingEvent) {
          if (!isExactReviewEvent(existingEvent, input, operationHash)) {
            return { kind: 'operation-conflict' as const, plan: planRecord(plan) };
          }
          if (plan.staleAt) return { kind: 'replayed' as const, plan: planRecord(plan) };
          const staleCheck = await markStaleIfChanged(tx, plan, input.actorUserId);
          if (staleCheck.kind === 'conflict') retryStaleCasConflict();
          return {
            kind: 'replayed' as const,
            plan: staleCheck.kind === 'stale' ? staleCheck.plan : planRecord(plan),
          };
        }
        if (plan.staleAt) return { kind: 'stale' as const, plan: planRecord(plan) };
        const staleCheck = await markStaleIfChanged(tx, plan, input.actorUserId);
        if (staleCheck.kind === 'stale') return { kind: 'stale' as const, plan: staleCheck.plan };
        if (staleCheck.kind === 'conflict') {
          if (!staleCheck.plan) return { kind: 'not-found' as const, plan: null };
          if (Number(staleCheck.plan.revision) !== input.expectedRevision) {
            return { kind: 'revision-conflict' as const, plan: staleCheck.plan };
          }
          return { kind: 'state-conflict' as const, plan: staleCheck.plan };
        }
        if (Number(plan.revision) !== input.expectedRevision) {
          return { kind: 'revision-conflict' as const, plan: planRecord(plan) };
        }
        if (plan.reviewStatus !== 'PENDING' || !plan.currentVersionId || !plan.currentVersion) {
          return { kind: 'state-conflict' as const, plan: planRecord(plan) };
        }
        if (input.decision === 'APPROVE' && !hasExecutionEvidence(plan)) {
          return { kind: 'not-ready' as const, plan: planRecord(plan) };
        }

        const reviewStatus = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        const updated = await tx.aiMediaPlan.updateMany({
          where: {
            id: input.planId,
            ownerUserId: input.ownerUserId,
            revision: input.expectedRevision,
            reviewStatus: 'PENDING',
            staleAt: null,
          },
          data: {
            revision: { increment: 1 },
            reviewStatus,
            approvedVersionId: input.decision === 'APPROVE' ? plan.currentVersionId : null,
            reviewedByUserId: input.actorUserId,
            reviewedAt: new Date(),
          },
        });
        if (updated.count !== 1) {
          const current = await readOwnedPlan(tx, input.planId, input.ownerUserId);
          if (!current) return { kind: 'not-found' as const, plan: null };
          if (current.staleAt) return { kind: 'stale' as const, plan: planRecord(current) };
          if (Number(current.revision) !== input.expectedRevision) {
            return { kind: 'revision-conflict' as const, plan: planRecord(current) };
          }
          return { kind: 'state-conflict' as const, plan: planRecord(current) };
        }
        await tx.aiMediaPlanEvent.create({
          data: {
            planId: input.planId,
            ownerUserId: input.ownerUserId,
            versionId: plan.currentVersionId,
            revision: input.expectedRevision + 1,
            actorUserId: input.actorUserId,
            eventKey,
            eventType: input.decision === 'APPROVE' ? 'REVIEW_APPROVED' : 'REVIEW_REJECTED',
            payload: operation,
            payloadHash: operationHash,
          },
        });
        const reviewed = await readOwnedPlan(tx, input.planId, input.ownerUserId);
        return { kind: 'updated' as const, plan: reviewed ? planRecord(reviewed) : null };
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      // A competing event may have won the first transaction. Re-run the
      // complete decision inside Serializable so replay and stale marking use
      // one atomic snapshot; never mutate stale state in autocommit fallback.
      return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
        const plan = await readOwnedPlan(tx, input.planId, input.ownerUserId);
        if (!plan) return { kind: 'not-found' as const, plan: null };
        const existingEvent = await tx.aiMediaPlanEvent.findUnique({ where: { eventKey } });
        if (existingEvent) {
          if (!isExactReviewEvent(existingEvent, input, operationHash)) {
            return { kind: 'operation-conflict' as const, plan: planRecord(plan) };
          }
          if (plan.staleAt) return { kind: 'replayed' as const, plan: planRecord(plan) };
          const staleCheck = await markStaleIfChanged(tx, plan, input.actorUserId);
          if (staleCheck.kind === 'conflict') retryStaleCasConflict();
          return {
            kind: 'replayed' as const,
            plan: staleCheck.kind === 'stale' ? staleCheck.plan : planRecord(plan),
          };
        }
        if (plan.staleAt) return { kind: 'stale' as const, plan: planRecord(plan) };
        const staleCheck = await markStaleIfChanged(tx, plan, input.actorUserId);
        if (staleCheck.kind === 'stale') return { kind: 'stale' as const, plan: staleCheck.plan };
        if (staleCheck.kind === 'conflict') {
          if (!staleCheck.plan) return { kind: 'not-found' as const, plan: null };
          if (Number(staleCheck.plan.revision) !== input.expectedRevision) {
            return { kind: 'revision-conflict' as const, plan: staleCheck.plan };
          }
          return { kind: 'state-conflict' as const, plan: staleCheck.plan };
        }
        if (Number(plan.revision) !== input.expectedRevision) {
          return { kind: 'revision-conflict' as const, plan: planRecord(plan) };
        }
        if (plan.reviewStatus !== 'PENDING') {
          return { kind: 'state-conflict' as const, plan: planRecord(plan) };
        }
        if (input.decision === 'APPROVE' && !hasExecutionEvidence(plan)) {
          return { kind: 'not-ready' as const, plan: planRecord(plan) };
        }
        throw error;
      });
    }
  }

  async requireApprovedForExecution(input: {
    planId: string;
    ownerUserId: string;
    actorUserId: string;
  }): Promise<ExecutionPlanResult> {
    try {
      return await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
        const plan = await readOwnedPlan(tx, input.planId, input.ownerUserId);
        if (!plan) return { kind: 'not-found' as const, plan: null };
        if (plan.staleAt) return { kind: 'stale' as const, plan: planRecord(plan) };

        const staleCheck = await markStaleIfChanged(tx, plan, input.actorUserId);
        if (staleCheck.kind === 'stale') return { kind: 'stale' as const, plan: staleCheck.plan };
        if (staleCheck.kind === 'conflict') {
          return {
            kind: staleCheck.plan ? 'not-approved' as const : 'not-found' as const,
            plan: staleCheck.plan,
          };
        }
        const approved = plan.reviewStatus === 'APPROVED'
          && Boolean(plan.currentVersionId)
          && plan.approvedVersionId === plan.currentVersionId
          && plan.currentVersion?.id === plan.currentVersionId
          && plan.approvedVersion?.id === plan.approvedVersionId
          && Boolean(plan.reviewedByUserId)
          && plan.reviewedAt instanceof Date;
        if (approved && !hasExecutionEvidence(plan)) {
          return { kind: 'not-ready' as const, plan: planRecord(plan) };
        }
        return {
          kind: approved ? 'ready' as const : 'not-approved' as const,
          plan: planRecord(plan),
        };
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const plan = await readOwnedPlan(this.prisma as any, input.planId, input.ownerUserId);
      if (!plan) return { kind: 'not-found', plan: null };
      if (plan.staleAt) return { kind: 'stale', plan: planRecord(plan) };
      throw error;
    }
  }
}
