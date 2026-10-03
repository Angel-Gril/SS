import { prepareAiImageSuitePaidProviderExecution } from './ai-image-suite-paid-provider.js';
import { recoverAiImageSuitePaidProvider, type AiImageSuitePaidStoredAsset,
  type ExecuteAiImageSuitePaidProviderInput, type ExecuteAiImageSuitePaidProviderDependencies } from './ai-image-suite-paid-execution.js';
import type { AiProviderReconciliationClaim, AiProviderTaskLookupResult } from './ai-provider-reconciliation.js';

export interface AiImageSuiteRecoveryAuthorization {
  version: 'ai-image-suite-original-task-recovery/v1';
  suiteId: string; slotId: string; snapshotId: string; attempt: number;
  jobId: string; reservationId: string; requestFingerprint: string;
  providerJobId: string; deadlineAt: string;
  originalJobStatus: 'FAILED'; originalErrorCode: string; originalErrorMessage: string;
}
export interface AiImageSuiteRecoveryRepository {
  isSuiteClaim(claim: AiProviderReconciliationClaim): Promise<boolean>;
  getClaimedGraph(claim: AiProviderReconciliationClaim): Promise<{ job: any; suite: any }>;
  complete(input: { claim: AiProviderReconciliationClaim; raw: AiImageSuitePaidStoredAsset;
    output: AiImageSuitePaidStoredAsset; actualCostCents: number; providerJobId: string | null }): Promise<void>;
}
export interface AiImageSuiteRecoveryOptions {
  repository: AiImageSuiteRecoveryRepository;
  uploadBuffer: Parameters<typeof recoverAiImageSuitePaidProvider>[1]['uploadBuffer'];
  prepareProvider?: typeof prepareAiImageSuitePaidProviderExecution;
  executeRecovery?: (input: ExecuteAiImageSuitePaidProviderInput, dependencies: ExecuteAiImageSuitePaidProviderDependencies<void>) => Promise<void>;
}
export function aiImageSuiteRecoveryAuthorization(job: any, now = new Date()): AiImageSuiteRecoveryAuthorization | null {
  const workflow = job?.workflow;
  const slot = workflow?.suiteSlot;
  const suite = slot?.suite;
  const reservation = job?.costReservation;
  const acceptedAt = reservation?.providerAcceptedAt;
  const dispatchedAt = job?.providerDispatchedAt;
  if (!(acceptedAt instanceof Date) || !(dispatchedAt instanceof Date)) return null;
  const deadline = Math.min(acceptedAt.getTime(), dispatchedAt.getTime()) + 24 * 60 * 60_000;
  const persistedDeadline = job.providerReconciliationDeadlineAt instanceof Date
    ? job.providerReconciliationDeadlineAt.getTime() : deadline;
  const effectiveDeadline = Math.min(deadline, persistedDeadline);
  if (!Number.isFinite(effectiveDeadline) || effectiveDeadline <= now.getTime()
    || acceptedAt.getTime() > now.getTime() || dispatchedAt.getTime() > now.getTime()
    || job.status !== 'FAILED' || job.errorCode !== 'PROVIDER_OUTPUT_DIMENSIONS_MISMATCH'
    || job.operation !== 'IMAGE_TO_IMAGE' || job.provider !== 'dashscope-wanx' || job.model !== 'wanx2.1-imageedit'
    || job.attemptCount !== 1 || job.maxAttempts !== 1 || job.requestedImageCount !== 1
    || job.width !== 900 || job.height !== 1200 || job.actualCostCents !== null || job.billedUnits !== 0
    || !Array.isArray(job.assets) || job.assets.length !== 0 || !slot || !suite || !workflow || !reservation
    || workflow.id !== job.workflowId || slot.childWorkflowId !== workflow.id
    || workflow.ownerUserId !== job.ownerUserId || slot.ownerUserId !== job.ownerUserId || suite.ownerUserId !== job.ownerUserId
    || workflow.currentAttempt !== job.workflowAttempt || slot.attempt !== job.workflowAttempt
    || workflow.status !== 'FAILED' || slot.status !== 'FAILED' || workflow.reviewStatus !== 'NOT_READY'
    || workflow.selectedOutputAssetId !== null || suite.cancelRequestedAt
    || !['FAILED', 'PARTIAL_FAILURE'].includes(suite.status) || suite.provider !== job.provider || suite.model !== job.model
    || !Number.isSafeInteger(suite.itemCount) || suite.itemCount < 1 || suite.itemCount > 2
    || !Number.isSafeInteger(suite.maximumCostCents) || suite.maximumCostCents < 1 || suite.maximumCostCents > 28
    || !Number.isSafeInteger(job.estimatedCostCents) || job.estimatedCostCents < 1 || job.estimatedCostCents > 14
    || slot.estimatedCostCents !== job.estimatedCostCents || slot.maximumCostCents !== job.estimatedCostCents
    || reservation.status !== 'RECONCILIATION_REQUIRED' || reservation.currency !== 'CNY'
    || reservation.jobId !== job.id || reservation.workflowId !== job.workflowId || reservation.ownerUserId !== job.ownerUserId
    || reservation.actorUserId !== job.actorUserId || reservation.provider !== job.provider || reservation.model !== job.model
    || reservation.operation !== job.operation || reservation.requestFingerprint !== job.requestFingerprint
    || !/^[a-f0-9]{64}$/u.test(job.requestFingerprint) || !job.providerJobId
    || reservation.providerRequestId !== job.providerJobId
    || reservation.estimatedCostMinor !== job.estimatedCostCents || reservation.maximumCostMinor !== job.estimatedCostCents
    || (reservation.settlements || []).some((row: any) => ['CHARGE', 'RECONCILED_CHARGE', 'RELEASE', 'RECONCILED_RELEASE'].includes(row.kind))) return null;
  return { version: 'ai-image-suite-original-task-recovery/v1', suiteId: suite.id, slotId: slot.id,
    snapshotId: suite.sourceCaptureSnapshotId, attempt: job.workflowAttempt, jobId: job.id, reservationId: reservation.id,
    requestFingerprint: job.requestFingerprint, providerJobId: job.providerJobId, deadlineAt: new Date(effectiveDeadline).toISOString(),
    originalJobStatus: 'FAILED', originalErrorCode: job.errorCode, originalErrorMessage: job.errorMessage || '' };
}
export function createAiImageSuiteRecovery(options: AiImageSuiteRecoveryOptions) {
  const assertClaim = async (claim: AiProviderReconciliationClaim) => { await options.repository.getClaimedGraph(claim); };
  return {
    async lookup(claim: AiProviderReconciliationClaim): Promise<AiProviderTaskLookupResult> {
      const graph = await options.repository.getClaimedGraph(claim);
      const prepared = await (options.prepareProvider || prepareAiImageSuitePaidProviderExecution)(graph);
      if (!prepared.recover) throw Object.assign(new Error('Original suite task lookup is unavailable'), { code: 'SUITE_PROVIDER_RECOVERY_UNSUPPORTED' });
      const result = await prepared.recover(claim.providerJobId, () => assertClaim(claim));
      await assertClaim(claim);
      return result;
    },
    async recover(claim: AiProviderReconciliationClaim, result: Extract<AiProviderTaskLookupResult, { status: 'SUCCEEDED' }>) {
      const graph = await options.repository.getClaimedGraph(claim);
      if (result.providerJobId !== claim.providerJobId) throw Object.assign(new Error('Recovered task identity changed'), { code: 'PROVIDER_JOB_ID_MISMATCH' });
      const prepared = await (options.prepareProvider || prepareAiImageSuitePaidProviderExecution)(graph);
      let raw: AiImageSuitePaidStoredAsset | null = null;
      await (options.executeRecovery || recoverAiImageSuitePaidProvider)({ ownerUserId: claim.ownerUserId, jobId: claim.jobId,
        maximumCostCents: graph.job.estimatedCostCents, ...graph }, {
        prepareProvider: async () => ({ ...prepared,
          execute: async () => { throw new Error('Suite reconciliation cannot create a Provider task'); },
          recover: async (taskId, beforeLookup) => {
            await beforeLookup();
            if (taskId !== claim.providerJobId) throw new Error('Suite recovery task changed');
            return result;
          } }),
        assertClaim: () => assertClaim(claim),
        markProviderDispatchStarted: async () => { throw new Error('Suite reconciliation cannot dispatch'); },
        recordProviderAccepted: async () => { throw new Error('Suite reconciliation cannot replace acceptance'); },
        recordProviderResultEvidence: async () => { await assertClaim(claim); },
        uploadBuffer: options.uploadBuffer,
        recordProviderOutput: async asset => { raw = asset; await assertClaim(claim); },
        complete: async output => {
          if (!raw) throw new Error('Suite recovery has no archived Provider output');
          await options.repository.complete({ claim, raw, output: output.output, actualCostCents: output.actualCostCents,
            providerJobId: output.providerJobId });
        },
      });
    },
  };
}
