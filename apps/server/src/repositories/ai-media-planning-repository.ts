import type { PrismaClient } from '@prisma/client';
import {
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

function versionRecord(row: any): AiMediaPlanVersionRecord {
  return {
    id: String(row.id),
    planId: String(row.planId),
    ownerUserId: String(row.ownerUserId),
    version: Number(row.version),
    sourceCaptureSnapshotId: String(row.sourceCaptureSnapshotId),
    sourceCaptureHash: String(row.sourceCaptureHash),
    sourceProfileHash: String(row.sourceProfileHash),
    inputFingerprint: String(row.inputFingerprint),
    planHash: String(row.planHash),
    planPayload: row.planPayload,
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
): Promise<AiMediaPlanRecord | null> {
  if (plan.staleAt) return planRecord(plan);
  const latest = await loadLatestOwnedSourceAuthority(client, plan);
  const reasons = staleReasons(plan.currentVersion, latest);
  if (reasons.length === 0) return null;

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
  if (updated.count !== 1) return null;

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
  return stale ? planRecord(stale) : null;
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

export class PrismaAiMediaPlanningRepository implements AiMediaPlanningRepository {
  constructor(private readonly prisma: PrismaClient) {}

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

  async listVersionsOwned(
    planId: string,
    ownerUserId: string,
  ): Promise<AiMediaPlanVersionRecord[]> {
    const rows = await (this.prisma as any).aiMediaPlanVersion.findMany({
      where: { planId, ownerUserId },
      orderBy: { version: 'desc' },
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
          const exact = existingEvent.planId === input.planId
            && existingEvent.ownerUserId === input.ownerUserId
            && existingEvent.payloadHash === operationHash
            && existingEvent.eventType === (input.decision === 'APPROVE'
              ? 'REVIEW_APPROVED'
              : 'REVIEW_REJECTED');
          return {
            kind: exact ? 'replayed' as const : 'operation-conflict' as const,
            plan: planRecord(plan),
          };
        }
        if (Number(plan.revision) !== input.expectedRevision) {
          return { kind: 'revision-conflict' as const, plan: planRecord(plan) };
        }
        if (plan.staleAt) return { kind: 'stale' as const, plan: planRecord(plan) };

        const stale = await markStaleIfChanged(tx, plan, input.actorUserId);
        if (stale) return { kind: 'stale' as const, plan: stale };
        if (plan.reviewStatus !== 'PENDING' || !plan.currentVersionId || !plan.currentVersion) {
          return { kind: 'state-conflict' as const, plan: planRecord(plan) };
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
      const plan = await readOwnedPlan(this.prisma as any, input.planId, input.ownerUserId);
      if (!plan) return { kind: 'not-found', plan: null };
      const existingEvent = await (this.prisma as any).aiMediaPlanEvent.findUnique({
        where: { eventKey },
      });
      if (existingEvent) {
        const exact = existingEvent.planId === input.planId
          && existingEvent.ownerUserId === input.ownerUserId
          && existingEvent.payloadHash === operationHash
          && existingEvent.eventType === (input.decision === 'APPROVE'
            ? 'REVIEW_APPROVED'
            : 'REVIEW_REJECTED');
        return {
          kind: exact ? 'replayed' : 'operation-conflict',
          plan: planRecord(plan),
        };
      }
      if (plan.staleAt) return { kind: 'stale', plan: planRecord(plan) };
      if (Number(plan.revision) !== input.expectedRevision) {
        return { kind: 'revision-conflict', plan: planRecord(plan) };
      }
      if (plan.reviewStatus !== 'PENDING') {
        return { kind: 'state-conflict', plan: planRecord(plan) };
      }
      throw error;
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

        const stale = await markStaleIfChanged(tx, plan, input.actorUserId);
        if (stale) return { kind: 'stale' as const, plan: stale };
        const approved = plan.reviewStatus === 'APPROVED'
          && Boolean(plan.currentVersionId)
          && plan.approvedVersionId === plan.currentVersionId
          && plan.currentVersion?.id === plan.currentVersionId
          && plan.approvedVersion?.id === plan.approvedVersionId
          && Boolean(plan.reviewedByUserId)
          && plan.reviewedAt instanceof Date;
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
