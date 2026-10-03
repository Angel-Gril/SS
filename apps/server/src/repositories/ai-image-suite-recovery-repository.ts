import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';
import { appendAiCostSettlementInTransaction } from '../services/ai-cost-ledger.js';
import { aiMediaPayloadHash } from '../services/ai-media-workflows.js';
import { hashAiMediaPlanningJson } from '../services/ai-media-planning.js';
import { appendAiProviderReconciliationEvent } from '../services/ai-provider-reconciliation-events.js';
import { aiImageSuiteRecoveryAuthorization, type AiImageSuiteRecoveryRepository } from '../services/ai-image-suite-recovery.js';
import type { AiProviderReconciliationClaim } from '../services/ai-provider-reconciliation.js';
import { createAiImageSuiteOutputAssetData } from './ai-image-suite-execution-repository.js';

const include = { assets: true, costReservation: { include: { settlements: true } }, workflow: {
  include: { inputs: { orderBy: { ordinal: 'asc' as const }, include: { asset: true } },
    suiteSlot: { include: { suite: { include: { slots: { orderBy: { ordinal: 'asc' as const } } } } } } } } };
function lost(): never { throw Object.assign(new Error('Original suite recovery authority changed'), { code: 'PROVIDER_RECONCILIATION_LEASE_LOST' }); }
function hash(token: string) { return createHash('sha256').update(token).digest('hex'); }

async function loadClaimed(tx: any, claim: AiProviderReconciliationClaim) {
  const job = await tx.aiImageJob.findUnique({ where: { id: claim.jobId }, include });
  const authorization = aiImageSuiteRecoveryAuthorization(job);
  const resume = await tx.aiProviderReconciliationEvent.findFirst({ where: { jobId: claim.jobId, ownerUserId: claim.ownerUserId,
    eventType: 'PROVIDER_RECONCILIATION_RESUME' }, orderBy: { reconciliationRevision: 'desc' } });
  if (!job || !authorization || job.ownerUserId !== claim.ownerUserId || job.actorUserId !== claim.actorUserId
    || job.operation !== claim.operation || job.provider !== claim.provider || job.model !== claim.model
    || job.estimatedCostCents !== claim.estimatedCostCents
    || job.workflowId !== claim.workflowId || job.workflowAttempt !== claim.workflowAttempt
    || job.attemptCount !== claim.attemptCount || job.requestFingerprint !== claim.requestFingerprint
    || job.providerJobId !== claim.providerJobId || job.providerReconciliationStatus !== 'RUNNING'
    || job.providerReconciliationRevision !== claim.reconciliationRevision
    || job.providerReconciliationLeaseTokenHash !== hash(claim.leaseToken)
    || !(job.providerReconciliationLeaseExpiresAt instanceof Date) || job.providerReconciliationLeaseExpiresAt <= new Date()
    || !(job.providerReconciliationDeadlineAt instanceof Date) || job.providerReconciliationDeadlineAt.getTime() !== claim.deadlineAt.getTime()
    || !resume || resume.workflowId !== claim.workflowId || resume.payload?.suiteRecovery?.jobId !== job.id
    || resume.payload.suiteRecovery.providerJobId !== claim.providerJobId
    || hashAiMediaPlanningJson(resume.payload.suiteRecovery) !== hashAiMediaPlanningJson(authorization)) lost();
  return { job, suite: job.workflow.suiteSlot.suite, slot: job.workflow.suiteSlot, authorization };
}

export class PrismaAiImageSuiteRecoveryRepository implements AiImageSuiteRecoveryRepository {
  constructor(private readonly database: PrismaClient) {}
  async isSuiteClaim(claim: AiProviderReconciliationClaim) {
    const row = await this.database.aiMediaSuiteSlot.findFirst({ where: { childWorkflowId: claim.workflowId || '', ownerUserId: claim.ownerUserId }, select: { id: true } });
    return Boolean(row);
  }
  async getClaimedGraph(claim: AiProviderReconciliationClaim) { return loadClaimed(this.database, claim); }
  async complete(input: Parameters<AiImageSuiteRecoveryRepository['complete']>[0]) {
    await runAiMediaSerializableTransaction(this.database, async (tx: any) => {
      const association = await tx.aiMediaSuiteSlot.findFirst({ where: { childWorkflowId: input.claim.workflowId, ownerUserId: input.claim.ownerUserId }, select: { suiteId: true } });
      if (!association) lost();
      await tx.$queryRawUnsafe('SELECT "id" FROM "ai_media_suites" WHERE "id"=$1 FOR UPDATE', association.suiteId);
      await tx.$queryRawUnsafe('SELECT "id" FROM "ai_image_jobs" WHERE "id"=$1 FOR UPDATE', input.claim.jobId);
      const { job, suite, slot, authorization } = await loadClaimed(tx, input.claim);
      if (input.providerJobId !== job.providerJobId || input.actualCostCents !== job.estimatedCostCents
        || input.raw.metadata.providerJobId !== job.providerJobId || input.raw.metadata.normalizedSha256 !== input.output.sha256
        || input.raw.metadata.sourceCaptureSnapshotId !== suite.sourceCaptureSnapshotId
        || input.output.mimeType !== 'image/png' || input.output.width !== 900 || input.output.height !== 1200) lost();
      const now = new Date();
      const revision = input.claim.reconciliationRevision + 1;
      const [{ transactionId }] = await tx.$queryRawUnsafe('SELECT txid_current()::text AS "transactionId"');
      await appendAiProviderReconciliationEvent(tx, { jobId: job.id, ownerUserId: job.ownerUserId, actorUserId: job.actorUserId,
        workflowId: job.workflowId, reconciliationRevision: revision, eventType: 'PROVIDER_RECONCILIATION_SUITE_RECOVERED', status: 'RECOVERED',
        payload: { suiteRecovery: authorization, rawSha256: input.raw.sha256, outputSha256: input.output.sha256,
          providerJobId: job.providerJobId, leaseTokenHash: hash(input.claim.leaseToken), claimedRevision: input.claim.reconciliationRevision,
          transactionId, beforeSuiteRevision: suite.revision } });
      await tx.aiImageJob.update({ where: { id: job.id }, data: { actualCostCents: input.actualCostCents, billedUnits: 1 } });
      const raw = await tx.mediaAsset.create({ data: { ...input.raw, ownerUserId: job.ownerUserId, aiImageJobId: job.id,
        kind: 'AI_PROVIDER_OUTPUT', sourceCaptureSnapshotId: suite.sourceCaptureSnapshotId } });
      await appendAiCostSettlementInTransaction(tx, { reservationId: job.costReservation.id, ownerUserId: job.ownerUserId,
        actorUserId: job.actorUserId, idempotencyKey: `${job.id}:cost:original-suite-recovery`, requestFingerprint: job.requestFingerprint,
        kind: 'RECONCILED_CHARGE', actualCostMinor: input.actualCostCents, billedUnits: 1,
        reason: 'Recovered original accepted suite task without a new Provider request' });
      const changed = await tx.aiImageJob.updateMany({ where: { id: job.id, status: 'FAILED', providerJobId: job.providerJobId,
        providerReconciliationStatus: 'RUNNING', providerReconciliationRevision: input.claim.reconciliationRevision,
        providerReconciliationLeaseTokenHash: hash(input.claim.leaseToken), providerReconciliationLeaseExpiresAt: { gt: now } },
        data: { status: 'SUCCEEDED', progress: 100, errorCode: null, errorMessage: null, completedAt: now,
          providerReconciliationStatus: 'RECOVERED', providerReconciliationRevision: revision,
          providerReconciliationNextAt: null, providerReconciliationLeaseOwner: null, providerReconciliationLeaseTokenHash: null,
          providerReconciliationLeaseExpiresAt: null, providerReconciliationLastProviderStatus: 'SUCCEEDED',
          providerReconciliationLastErrorCode: null, providerReconciliationLastErrorMessage: null, providerReconciledAt: now } });
      if (changed.count !== 1) lost();
      const final = await tx.mediaAsset.create({ data: createAiImageSuiteOutputAssetData({ ownerUserId: job.ownerUserId, jobId: job.id,
        sourceCaptureSnapshotId: suite.sourceCaptureSnapshotId, suiteId: suite.id, slotId: slot.id, attempt: slot.attempt,
        asset: { ...input.output, metadata: { ...input.output.metadata, providerOutputAssetId: raw.id } } }) });
      for (const source of job.workflow.inputs) await tx.mediaAssetLineage.create({ data: { ownerUserId: job.ownerUserId,
        workflowId: job.workflowId, jobId: job.id, inputAssetId: source.assetId, outputAssetId: final.id,
        inputRole: source.role, ordinal: source.ordinal, operation: job.operation } });
      const workflow = await tx.aiMediaWorkflow.updateMany({ where: { id: job.workflowId, status: 'FAILED', currentAttempt: job.workflowAttempt },
        data: { status: 'SUCCEEDED', reviewStatus: 'PENDING', selectedOutputAssetId: null, completedAt: now, revision: { increment: 1 } } });
      const child = await tx.aiMediaSuiteSlot.updateMany({ where: { id: slot.id, status: 'FAILED', attempt: slot.attempt, revision: slot.revision },
        data: { status: 'SUCCEEDED', errorCode: null, errorMessage: null, revision: { increment: 1 } } });
      if (workflow.count !== 1 || child.count !== 1) lost();
      const slots = await tx.aiMediaSuiteSlot.findMany({ where: { suiteId: suite.id }, orderBy: { ordinal: 'asc' } });
      const succeeded = slots.filter((row: any) => row.status === 'SUCCEEDED').length;
      const failed = slots.filter((row: any) => row.status === 'FAILED').length;
      if (succeeded + failed !== slots.length) lost();
      const status = failed ? 'PARTIAL_FAILURE' : 'SUCCEEDED';
      const parent = await tx.aiMediaSuite.updateMany({ where: { id: suite.id, revision: suite.revision, status: suite.status },
        data: { status, completedAt: now, revision: { increment: 1 } } });
      if (parent.count !== 1) lost();
      const counts = { planned: 0, queued: 0, running: 0, succeeded, failed, cancelRequested: 0, cancelled: 0 };
      const result = { suiteId: suite.id, revision: suite.revision + 1, status, itemCount: suite.itemCount, concurrencyLimit: suite.concurrencyLimit,
        counts, slots: slots.map((row: any) => ({ slotId: row.id, ordinal: row.ordinal, slotKey: row.slotKey, status: row.status,
          attempt: row.attempt, revision: row.revision, childWorkflowId: row.childWorkflowId,
          error: row.errorCode ? { code: row.errorCode, message: row.errorMessage } : null })) };
      const payload = { version: 'ai-image-suite-execution-event/v1', suiteId: suite.id, ownerUserId: job.ownerUserId,
        actorUserId: job.actorUserId, beforeRevision: suite.revision, afterRevision: result.revision, beforeStatus: suite.status,
        afterStatus: status, counts: { ...counts, total: slots.length, active: 0 }, slotId: slot.id, childWorkflowId: job.workflowId,
        jobId: job.id, reservationId: job.costReservation.id, attempt: slot.attempt, originalTaskRecovery: true, result };
      await tx.aiMediaSuiteEvent.create({ data: { suiteId: suite.id, ownerUserId: job.ownerUserId, actorUserId: job.actorUserId,
        revision: result.revision, eventKey: `${suite.id}:SUITE_CHILD_SUCCEEDED:${result.revision}`, eventType: 'SUITE_CHILD_SUCCEEDED',
        payload, payloadHash: aiMediaPayloadHash(payload) } });
      const event = { outputAssetId: final.id, rawAssetId: raw.id, providerJobId: job.providerJobId, originalTaskRecovery: true };
      await tx.aiMediaWorkflowEvent.create({ data: { workflowId: job.workflowId, ownerUserId: job.ownerUserId, actorUserId: job.actorUserId,
        jobId: job.id, eventKey: `${job.workflowId}:SUITE_ORIGINAL_TASK_RECOVERED:${job.id}:${job.workflowAttempt}`,
        eventType: 'SUITE_ORIGINAL_TASK_RECOVERED', payload: event, payloadHash: aiMediaPayloadHash(event) } });
    });
  }
}
