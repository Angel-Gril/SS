import type { PrismaClient } from '@prisma/client';
import type { SourceProductCaptureV2 } from 'shared';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';
import {
  createAiImageSuitePreview,
  type AiImageSuitePlanAuthority,
  type AiImageSuiteRecord,
  type AiImageSuiteRepository,
  type ClaimAiImageSuiteInput,
} from '../services/ai-image-suite.js';
import { hashAiMediaPlanningJson } from '../services/ai-media-planning.js';
import {
  hasAiMediaPlanExecutionEvidence,
  markAiMediaPlanStaleIfChanged,
  readOwnedAiMediaPlan,
} from './ai-media-planning-repository.js';

const suiteInclude = {
  slots: {
    orderBy: { ordinal: 'asc' },
    include: {
      childWorkflow: {
        select: {
          jobs: {
            orderBy: { workflowAttempt: 'desc' },
            take: 1,
            select: {
              assets: {
                orderBy: { createdAt: 'asc' },
                take: 1,
                select: {
                  id: true,
                  ownerUserId: true,
                  url: true,
                  mimeType: true,
                  width: true,
                  height: true,
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

const actionableSuiteWhere = [
  { status: { in: ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'] } },
  { status: 'PLANNED', revision: { gte: 4 } },
] as const;

function suiteRecord(row: any): AiImageSuiteRecord {
  return {
    id: String(row.id),
    ownerUserId: String(row.ownerUserId),
    actorUserId: String(row.actorUserId),
    planId: String(row.planId),
    planVersionId: String(row.planVersionId),
    status: String(row.status),
    revision: Number(row.revision),
    previewHash: String(row.previewHash),
    provider: String(row.provider),
    model: String(row.model),
    pricingVersion: String(row.pricingVersion),
    itemCount: Number(row.itemCount),
    estimatedCostCents: Number(row.estimatedCostCents),
    maximumCostCents: Number(row.maximumCostCents),
    concurrencyLimit: Number(row.concurrencyLimit),
    cancelRequestedAt: row.cancelRequestedAt || null,
    completedAt: row.completedAt || null,
    slots: Array.isArray(row.slots) ? row.slots : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function approved(plan: any): boolean {
  return Boolean(plan
    && !plan.staleAt
    && plan.reviewStatus === 'APPROVED'
    && plan.currentVersionId
    && plan.currentVersionId === plan.approvedVersionId
    && plan.currentVersion?.id === plan.currentVersionId
    && plan.approvedVersion?.id === plan.approvedVersionId
    && plan.reviewedByUserId
    && plan.reviewedAt instanceof Date);
}

function sourceMatches(plan: any, latest: any): boolean {
  const version = plan?.approvedVersion;
  return Boolean(version
    && latest
    && String(latest.id) === String(version.sourceCaptureSnapshotId)
    && String(latest.captureHash) === String(version.sourceCaptureHash)
    && String(latest.profileHash) === String(version.sourceProfileHash)
    && String(latest.schemaVersion) === String(version.sourceSchemaVersion));
}

function authority(plan: any): AiImageSuitePlanAuthority | null {
  const version = plan?.approvedVersion;
  if (!approved(plan) || !version) return null;
  return {
    planId: String(plan.id),
    planVersionId: String(version.id),
    planRevision: Number(plan.revision),
    planHash: String(version.planHash),
    sourceSubjectId: String(plan.sourceSubjectId),
    sourceCaptureSnapshotId: String(version.sourceCaptureSnapshotId),
    sourceCaptureHash: String(version.sourceCaptureHash),
    sourceProfileHash: String(version.sourceProfileHash),
    sourceSchemaVersion: String(version.sourceSchemaVersion),
    contextType: String(plan.contextType),
    contextId: String(plan.contextId),
    inputSnapshot: version.inputSnapshot,
    planPayload: version.planPayload,
  };
}

async function loadLatestSource(client: any, plan: any) {
  const subject = await client.sourceCaptureSubject.findFirst({
    where: {
      id: plan.sourceSubjectId,
      ownerUserId: plan.ownerUserId,
      legacySupplyGoodsId: plan.contextId,
      legacySupplyGoods: { userId: plan.ownerUserId },
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
          payload: true,
        },
      },
    },
  });
  return subject?.snapshots?.[0] || null;
}

function validateCandidateAuthority(authorityInput: AiImageSuitePlanAuthority, snapshot: any): boolean {
  const capture = snapshot?.payload as SourceProductCaptureV2 | undefined;
  if (!capture || capture.captureVersion !== 'source-product-capture-v2') return false;
  const media = new Map(capture.media
    .filter((entry) => entry.kind === 'image' && entry.disposition === 'accepted' && Boolean(entry.url))
    .map((entry) => [entry.key, entry]));
  const input = authorityInput.inputSnapshot as { candidates?: unknown } | null;
  if (!input || !Array.isArray(input.candidates) || input.candidates.length < 1) return false;
  return input.candidates.every((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const candidate = raw as { id?: unknown; url?: unknown; skuKeys?: unknown };
    const source = typeof candidate.id === 'string' ? media.get(candidate.id) : null;
    return Boolean(source
      && source.url === candidate.url
      && Array.isArray(candidate.skuKeys)
      && candidate.skuKeys.every((skuKey) => source.skuKeys.includes(String(skuKey))));
  });
}

function requestFingerprint(input: ClaimAiImageSuiteInput, previewHash: string): string {
  return hashAiMediaPlanningJson({
    ownerUserId: input.ownerUserId,
    planId: input.planId,
    expectedPlanRevision: input.expectedPlanRevision,
    previewHash,
    providerConfig: input.providerConfig,
  });
}

async function readIdempotencyReplay(client: any, input: ClaimAiImageSuiteInput, fingerprint: string) {
  const existing = await client.aiMediaSuite.findFirst({
    where: { ownerUserId: input.ownerUserId, idempotencyKey: input.idempotencyKey },
    include: suiteInclude,
  });
  if (!existing) return null;
  return {
    kind: existing.requestFingerprint === fingerprint ? 'existing' as const : 'conflict' as const,
    suite: suiteRecord(existing),
  };
}

export class PrismaAiImageSuiteRepository implements AiImageSuiteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async loadApprovedAuthority(input: {
    ownerUserId: string;
    actorUserId: string;
    planId: string;
  }): Promise<AiImageSuitePlanAuthority | null> {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const plan = await readOwnedAiMediaPlan(tx, input.planId, input.ownerUserId);
      const planAuthority = authority(plan);
      if (!planAuthority) return null;
      const staleCheck = await markAiMediaPlanStaleIfChanged(tx, plan, input.actorUserId);
      if (staleCheck.kind !== 'current') return null;
      if (!hasAiMediaPlanExecutionEvidence(plan)) return null;
      const latest = await loadLatestSource(tx, plan);
      return sourceMatches(plan, latest) && validateCandidateAuthority(planAuthority, latest)
        ? planAuthority
        : null;
    });
  }

  async claimApproved(input: ClaimAiImageSuiteInput) {
    try {
      return await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
        const submittedFingerprint = requestFingerprint(input, input.expectedPreviewHash);
        const persistedReplay = await readIdempotencyReplay(tx, input, submittedFingerprint);
        if (persistedReplay) return persistedReplay;
        const plan = await readOwnedAiMediaPlan(tx, input.planId, input.ownerUserId);
        if (!plan) return { kind: 'not-found' as const, suite: null };
        if (plan.staleAt) return { kind: 'stale' as const, suite: null };
        const staleCheck = await markAiMediaPlanStaleIfChanged(tx, plan, input.actorUserId);
        if (staleCheck.kind === 'stale') return { kind: 'stale' as const, suite: null };
        if (staleCheck.kind !== 'current') return { kind: 'not-approved' as const, suite: null };
        if (!hasAiMediaPlanExecutionEvidence(plan)) return { kind: 'not-approved' as const, suite: null };
        const planAuthority = authority(plan);
        if (!planAuthority || plan.revision !== input.expectedPlanRevision) {
          return { kind: 'not-approved' as const, suite: null };
        }
        const latest = await loadLatestSource(tx, plan);
        if (!sourceMatches(plan, latest) || !validateCandidateAuthority(planAuthority, latest)) {
          return { kind: 'stale' as const, suite: null };
        }
        const preview = createAiImageSuitePreview(planAuthority, input.providerConfig);
        if (preview.previewHash !== input.expectedPreviewHash) {
          return { kind: 'preview-changed' as const, suite: null };
        }
        const fingerprint = submittedFingerprint;
        const existingClaim = await tx.aiMediaSuite.findUnique({
          where: { planVersionId: planAuthority.planVersionId },
          include: suiteInclude,
        });
        if (existingClaim) return { kind: 'claimed' as const, suite: suiteRecord(existingClaim) };
        const activeOtherVersion = await tx.aiMediaSuite.findFirst({
          where: {
            ownerUserId: input.ownerUserId,
            planId: planAuthority.planId,
            planVersionId: { not: planAuthority.planVersionId },
            OR: actionableSuiteWhere,
          },
          select: { id: true },
        });
        if (activeOtherVersion) {
          return { kind: 'active-suite-conflict' as const, suite: null };
        }

        const suite = await tx.aiMediaSuite.create({ data: {
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          planId: planAuthority.planId,
          planVersionId: planAuthority.planVersionId,
          sourceSubjectId: planAuthority.sourceSubjectId,
          sourceCaptureSnapshotId: planAuthority.sourceCaptureSnapshotId,
          sourceCaptureHash: planAuthority.sourceCaptureHash,
          sourceProfileHash: planAuthority.sourceProfileHash,
          sourceSchemaVersion: planAuthority.sourceSchemaVersion,
          contextType: planAuthority.contextType,
          contextId: planAuthority.contextId,
          status: 'PLANNED',
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: fingerprint,
          previewHash: preview.previewHash,
          provider: preview.provider,
          model: preview.model,
          providerConfigHash: preview.providerConfigHash,
          pricingVersion: preview.pricingVersion,
          itemCount: preview.itemCount,
          estimatedCostCents: preview.estimatedCostCents,
          maximumCostCents: preview.maximumCostCents,
          concurrencyLimit: preview.concurrencyLimit,
        } });
        await tx.aiMediaSuiteSlot.createMany({
          data: preview.slots.map((slot) => ({
            suiteId: suite.id,
            ownerUserId: input.ownerUserId,
            ordinal: slot.ordinal,
            slotKey: slot.slotKey,
            goal: slot.goal,
            ownershipLevel: slot.ownership.level,
            ownershipKey: slot.ownership.key,
            compatibilityGroupKey: slot.compatibilityGroupKey,
            slotSnapshot: slot.slotSnapshot,
            slotHash: slot.slotHash,
            referencesSnapshot: slot.references,
            referencesHash: slot.referencesHash,
            diagnostics: [],
            status: 'PLANNED',
            estimatedCostCents: slot.estimatedCostCents,
            maximumCostCents: slot.maximumCostCents,
          })),
        });
        const eventPayload = {
          version: 'ai-image-suite-event/v1',
          planId: planAuthority.planId,
          planVersionId: planAuthority.planVersionId,
          previewHash: preview.previewHash,
          itemCount: preview.itemCount,
          maximumCostCents: preview.maximumCostCents,
          slotHashes: preview.slots.map((slot) => slot.slotHash),
        };
        await tx.aiMediaSuiteEvent.create({ data: {
          suiteId: suite.id,
          ownerUserId: input.ownerUserId,
          revision: 1,
          actorUserId: input.actorUserId,
          eventKey: `${suite.id}:claimed:1`,
          eventType: 'CLAIMED',
          payload: eventPayload,
          payloadHash: hashAiMediaPlanningJson(eventPayload),
        } });
        const created = await tx.aiMediaSuite.findUnique({
          where: { id: suite.id },
          include: suiteInclude,
        });
        return { kind: 'created' as const, suite: suiteRecord(created) };
      });
    } catch (error: any) {
      if (String(error?.code || '') !== 'P2002') throw error;
      const submittedFingerprint = requestFingerprint(input, input.expectedPreviewHash);
      const persistedReplay = await readIdempotencyReplay(this.prisma as any, input, submittedFingerprint);
      if (persistedReplay) return persistedReplay;
      const plan = await readOwnedAiMediaPlan(this.prisma as any, input.planId, input.ownerUserId);
      const planAuthority = authority(plan);
      if (!planAuthority) return { kind: 'not-approved' as const, suite: null };
      const claimed = await (this.prisma as any).aiMediaSuite.findUnique({
        where: { planVersionId: planAuthority.planVersionId },
        include: suiteInclude,
      });
      return claimed
        ? { kind: 'claimed' as const, suite: suiteRecord(claimed) }
        : Promise.reject(error);
    }
  }

  async getOwned(id: string, ownerUserId: string) {
    const row = await (this.prisma as any).aiMediaSuite.findFirst({
      where: { id, ownerUserId },
      include: suiteInclude,
    });
    return row ? suiteRecord(row) : null;
  }

  async getCurrentOwnedByPlan(planId: string, ownerUserId: string) {
    const plan = await (this.prisma as any).aiMediaPlan.findFirst({
      where: { id: planId, ownerUserId },
      select: { currentVersionId: true },
    });
    if (!plan?.currentVersionId) return null;
    const row = await (this.prisma as any).aiMediaSuite.findFirst({
      where: {
        planId,
        ownerUserId,
        planVersionId: plan.currentVersionId,
        plan: { currentVersionId: plan.currentVersionId },
      },
      include: suiteInclude,
    });
    return row ? suiteRecord(row) : null;
  }

  async getActiveOwnedByPlan(planId: string, ownerUserId: string) {
    const plan = await (this.prisma as any).aiMediaPlan.findFirst({
      where: { id: planId, ownerUserId },
      select: { currentVersionId: true },
    });
    if (!plan) return null;
    const row = await (this.prisma as any).aiMediaSuite.findFirst({
      where: {
        planId,
        ownerUserId,
        ...(plan.currentVersionId ? { planVersionId: { not: plan.currentVersionId } } : {}),
        plan: { currentVersionId: plan.currentVersionId },
        OR: actionableSuiteWhere,
      },
      include: suiteInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return row ? suiteRecord(row) : null;
  }
}
