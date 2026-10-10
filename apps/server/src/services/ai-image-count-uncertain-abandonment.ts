import { hashAiMediaPlanningJson } from './ai-media-planning.js';
import { AI_IMAGE_DONOR_GPT2_COUNT_API_BASE, validDonorGpt2SuiteConfig } from './ai-image-donor-gpt2-profile.js';
import { aiImageProviderEndpointSha256, parseAiImageProviderRuntimeContract } from './ai-image-provider-runtime-contract.js';

const unknownFailures = new Set(['PROVIDER_REQUEST_FAILED', 'PROVIDER_TIMEOUT', 'PROVIDER_SUBMISSION_UNCERTAIN']);
const terminalCostKinds = new Set(['CHARGE', 'RECONCILED_CHARGE', 'RELEASE', 'RECONCILED_RELEASE']);

export function isUncertainCountSuite(job: any): boolean {
  return job?.operation === 'IMAGE_TO_IMAGE' && job.provider === 'custom' && job.model === 'gpt-image-2-count'
    && unknownFailures.has(job.errorCode) && Boolean(job.workflow?.suiteSlot);
}

/** An operator terminates ERP recovery, not the Provider request. Output and Supplier billing stay unknown. */
export function countUncertainAbandonmentEvidence(job: any, now: Date) {
  if (!isUncertainCountSuite(job)) return null;
  const workflow = job.workflow, slot = workflow.suiteSlot, suite = slot.suite, cost = job.costReservation;
  const dispatchedAt = job.providerDispatchedAt;
  if (!(dispatchedAt instanceof Date) || !Number.isFinite(dispatchedAt.getTime()) || dispatchedAt > now
    || job.status !== 'FAILED' || job.providerReconciliationStatus !== 'MANUAL_REVIEW'
    || job.providerJobId !== null || job.actualCostCents !== null || job.billedUnits !== 0
    || workflow.id !== job.workflowId || workflow.ownerUserId !== job.ownerUserId
    || workflow.currentAttempt !== job.workflowAttempt || workflow.operation !== job.operation
    || workflow.status !== 'FAILED' || workflow.reviewStatus !== 'NOT_READY' || workflow.selectedOutputAssetId !== null
    || slot.childWorkflowId !== workflow.id || slot.ownerUserId !== job.ownerUserId
    || slot.attempt !== job.workflowAttempt || slot.status !== 'FAILED'
    || !suite || suite.ownerUserId !== job.ownerUserId || !['FAILED', 'PARTIAL_FAILURE'].includes(suite.status)
    || suite.cancelRequestedAt || suite.provider !== job.provider || suite.model !== job.model
    || job.attemptCount !== 1 || job.maxAttempts !== 1 || job.requestedImageCount !== 1
    || job.width !== 900 || job.height !== 1200 || job.estimatedCostCents !== 10
    || slot.estimatedCostCents !== 10 || slot.maximumCostCents !== 10
    || !Number.isSafeInteger(suite.itemCount) || suite.itemCount < 1 || suite.itemCount > 2
    || suite.maximumCostCents !== suite.itemCount * 10
    || !Array.isArray(job.assets) || job.assets.length !== 0
    || !cost || cost.status !== 'SUBMISSION_UNCERTAIN' || cost.ownerUserId !== job.ownerUserId
    || cost.jobId !== job.id || cost.workflowId !== job.workflowId || cost.actorUserId !== job.actorUserId
    || cost.provider !== job.provider || cost.model !== job.model || cost.operation !== job.operation
    || cost.currency !== 'CNY' || cost.estimatedCostMinor !== 10 || cost.maximumCostMinor !== 10
    || cost.providerRequestId !== null || cost.providerAcceptedAt !== null
    || !/^[a-f0-9]{64}$/u.test(job.requestFingerprint || '') || cost.requestFingerprint !== job.requestFingerprint
    || !Array.isArray(cost.settlements) || cost.settlements.some((row: any) => terminalCostKinds.has(row.kind))) return null;
  const event = Array.isArray(workflow.events) ? workflow.events.find((row: any) =>
    row.eventKey === `${workflow.id}:PROVIDER_DISPATCH_STARTED:${job.id}:${job.workflowAttempt}`
    && row.eventType === 'PROVIDER_DISPATCH_STARTED' && row.workflowId === workflow.id && row.jobId === job.id
    && row.ownerUserId === job.ownerUserId && row.actorUserId === job.actorUserId
    && row.payload?.providerDispatchedAt === dispatchedAt.toISOString()
    && Object.keys(row.payload).join(',') === 'providerDispatchedAt'
    && hashAiMediaPlanningJson(row.payload) === row.payloadHash) : null;
  if (!event) return null;
  try {
    const config = job.operationConfig, runtime = parseAiImageProviderRuntimeContract(config?.providerRuntime);
    if (config?.version !== 'ai-image-suite-child-operation/v2' || !validDonorGpt2SuiteConfig(config)
      || runtime.contractVersion !== 'ai-image-provider-runtime/v3' || runtime.provider !== job.provider || runtime.model !== job.model
      || runtime.baseUrlSha256 !== aiImageProviderEndpointSha256('custom', AI_IMAGE_DONOR_GPT2_COUNT_API_BASE)
      || runtime.currency !== 'CNY' || runtime.imageCount !== 1 || runtime.unitCostCents !== 10
      || runtime.maximumCostCents !== 10 || runtime.width !== 1008 || runtime.height !== 1344) return null;
  } catch { return null; }
  return { version: 'ai-image-count-uncertain-abandonment/v1', suiteId: suite.id, slotId: slot.id, jobId: job.id,
    reservationId: cost.id, snapshotId: suite.sourceCaptureSnapshotId, attempt: job.workflowAttempt,
    requestFingerprint: job.requestFingerprint, providerJobId: null, providerDispatchedAt: dispatchedAt.toISOString(),
    dispatchEventKey: event.eventKey, dispatchPayloadHash: event.payloadHash,
    originalErrorCode: job.errorCode, originalErrorMessage: job.errorMessage || '',
    providerOutputDisposition: 'UNKNOWN', providerBillingDisposition: 'UNKNOWN', erpDeliveredImageCount: 0 };
}
