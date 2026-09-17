// Synthetic native-record fixture, used only by the final QA04 contract tests.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const hash = value => createHash('sha256').update(value).digest('hex');
export function suiteFlowFixture(f, png) {
  const commit = f.targetGitCommit, owner = 'private-suite-owner', ownerSha256 = hash(owner), suiteId = 'private-suite';
  const source = f.input.technical.find(row => row.operation === 'IMAGE_TO_IMAGE').source;
  const imageRefs = [f.put('suite-hero.png', png(900, 1200, 53)), f.put('suite-scene.png', png(900, 1200, 57))];
  const binding = { gitCommit: commit, extensionVersion: '1.0.333', ownerSha256, caseId: 'suite', operation: 'IMAGE_TO_IMAGE',
    launch: 'ACTUAL_ERP_DRAFT_BUTTON', workbenchTargetId: 'A'.repeat(32), ownedWebTargetId: 'B'.repeat(32),
    sourceSha256: source.sha256, sourceAssetId: 'private-source', sourceMediaKey: 'legacy-media-0',
    snapshotId: 'private-snapshot', collectId: 'private-goods', shopId: 'private-shop', draftId: 'private-draft',
    revision: 3, draftVersion: 3, launchedAt: '2026-09-16T10:25:00.000Z' };
  const before = { id: binding.draftId, ownerUserId: owner, shopId: binding.shopId, sourceCaptureSnapshotId: binding.snapshotId,
    supplyGoodsId: binding.collectId, revision: 3, draftVersion: 3, selectedSkuKeys: ['fixture-sku'],
    media: { assignments: [{ scope: 'PRODUCT', slotKey: 'original', assetId: 'original-output', source: 'GENERATED' }] } };
  const rows = imageRefs.map((ref, index) => {
    const jobId = 'private-suite-job-' + index, workflowId = 'private-suite-workflow-' + index, outputId = 'private-suite-output-' + index;
    return { job: { id: jobId, idSha256: hash(jobId), ownerSha256, status: 'SUCCEEDED', operation: 'IMAGE_TO_IMAGE',
      provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', attemptCount: 1, requestedImageCount: 1, width: 900, height: 1200,
      providerJobIdSha256: hash('provider-' + index), providerReconciliationStatus: 'NOT_REQUIRED',
      idempotencyKeySha256: hash('job-key-' + index), startedAt: `2026-09-16T10:30:0${index}.000Z`, completedAt: `2026-09-16T10:31:0${index}.000Z`,
      pricing: { currency: 'CNY', unitCostCents: 14, requestedImageCount: 1, maximumCostCents: 14 }, actualCostCents: 14, billedUnits: 1, errorCode: null,
      frozenInputs: [{ assetId: binding.sourceAssetId, role: 'REFERENCE', ordinal: 0, sha256: source.sha256, sizeBytes: readFileSync(source.path).length }] },
      cost: { idSha256: hash('reservation-' + index), jobIdSha256: hash(jobId), status: 'SETTLED', currency: 'CNY', maximumCostMinor: 14, settlementCount: 1,
        charges: [{ chargeIdSha256: hash('charge-' + index), jobIdSha256: hash(jobId), kind: 'CHARGE', actualCostMinor: 14, billedUnits: 1, currency: 'CNY' }] },
      outputs: [{ id: outputId, idSha256: hash(outputId), jobIdSha256: hash(jobId), kind: 'AI_GENERATED', sha256: ref.sha256,
        width: 900, height: 1200, mimeType: 'image/png', sizeBytes: readFileSync(ref.path).length, storageBackend: 'oss' }],
      workflow: { id: workflowId, idSha256: hash(workflowId), operation: 'IMAGE_TO_IMAGE', status: 'SUCCEEDED', reviewStatus: 'PENDING', revision: 3,
        contextType: 'collect', contextId: binding.collectId, contextSkuKey: 'fixture-sku', contextSlotKey: 'slot-' + index, selectedOutputAssetId: null,
        inputs: [{ role: 'REFERENCE', ordinal: 0, assetId: binding.sourceAssetId, assetSha256: source.sha256 }],
        inputAssets: [{ id: binding.sourceAssetId, sourceSha256: source.sha256, sourceMediaKey: binding.sourceMediaKey, sha256: source.sha256,
          width: 1024, height: 1024, sizeBytes: readFileSync(source.path).length, mimeType: 'image/png', sourceCaptureSnapshotId: binding.snapshotId }],
        eventTypes: ['CREATED', 'JOB_STARTED', 'PROVIDER_DISPATCH_STARTED', 'PROVIDER_SUBMITTED', 'PROVIDER_OUTPUT_PERSISTED', 'JOB_SUCCEEDED'] } };
  });
  const slots = rows.map((row, index) => ({ id: 'suite-slot-' + index, slotKey: row.workflow.contextSlotKey, ordinal: index,
    goal: index === 0 ? 'sku_hero' : 'scene', workflowId: row.workflow.id, status: 'SUCCEEDED', attempt: 1, reviewStatus: 'PENDING',
    applicableSkuKeys: ['fixture-sku'], output: { assetId: row.outputs[0].id, width: 900, height: 1200 } }));
  const plan = { id: 'private-plan', versionId: 'private-plan-version', revision: 2, previewHash: hash('preview') };
  const quote = { currency: 'CNY', itemCount: 2, estimatedCostCents: 28, maximumCostCents: 28, pricingVersion: 'ai-image-suite-price-cny/v1' };
  const suiteReferences = [{ suiteId, ownerUserId: owner, ordinal: 0, candidateId: binding.sourceMediaKey,
    assetId: binding.sourceAssetId, assetSha256: source.sha256, rawSourceSha256: source.sha256,
    sizeBytes: readFileSync(source.path).length, width: 1024, height: 1024, mimeType: 'image/png' }];
  const generated = f.put('suite-generated-db.json', { kind: 'REAL_ERP_JOB_DATABASE_READBACK', caseId: 'suite', gitCommit: commit,
    readbackRuntimeCommit: commit, observedAt: '2026-09-16T10:32:00.000Z', readOnly: true, rows, suiteReferences });
  const generatedUi = f.put('suite-generated-ui.json', { kind: 'REAL_HOSTED_SUITE_UI_GET_READBACK', at: '2026-09-16T10:31:30.000Z',
    gitCommit: commit, extensionVersion: binding.extensionVersion, suiteId, mutationPosts: 0,
    projection: { executionMode: 'ERP_HOSTED', sourceBinding: { snapshotId: binding.snapshotId, supplyGoodsId: binding.collectId },
      binding: { shopId: binding.shopId, workflowId: binding.draftId, draftRevision: 3, draftVersion: 3 }, plan, quote,
      suite: { id: suiteId, status: 'SUCCEEDED', itemCount: 2, slots } } });
  const previews = rows.map((row, index) => f.put(`suite-preview-${index}.json`, { kind: 'REAL_HOSTED_SUITE_CANDIDATE_PREVIEW',
    at: `2026-09-16T10:33:0${index}.000Z`, gitCommit: commit, extensionVersion: binding.extensionVersion,
    suiteId, slotId: slots[index].id, slotKey: slots[index].slotKey, workflowId: row.workflow.id, outputAssetId: row.outputs[0].id,
    sha256: row.outputs[0].sha256, width: 900, height: 1200, mimeType: 'image/png', byteLength: row.outputs[0].sizeBytes }));
  const reviews = rows.map((row, index) => f.put(`suite-review-${index}.json`, { kind: 'REAL_HOSTED_SUITE_CANDIDATE_REVIEW',
    at: `2026-09-16T10:34:0${index}.000Z`, gitCommit: commit, extensionVersion: binding.extensionVersion,
    suiteId, slotId: slots[index].id, workflowId: row.workflow.id, outputAssetId: row.outputs[0].id,
    decision: 'APPROVE', viewedSha256: row.outputs[0].sha256, visualObservation: 'Synthetic candidate explicitly viewed',
    response: { status: 200, body: { code: 1 } }, projection: { suite: { id: suiteId,
      slots: slots.map((slot, i) => ({ ...slot, reviewStatus: i <= index ? 'APPROVED' : 'PENDING' })) } } }));
  const items = slots.map((slot, index) => ({ skuKey: 'fixture-sku', slotKey: slot.slotKey, suiteSlotId: slot.id,
    expectedSuiteSlotRevision: 3, childWorkflowId: slot.workflowId, expectedChildWorkflowRevision: 4, outputAssetId: rows[index].outputs[0].id }));
  const assignments = items.map(item => ({ scope: 'SKU', skuKey: item.skuKey, slotKey: item.slotKey, assetId: item.outputAssetId, source: 'GENERATED' }));
  const after = { ...before, revision: 4, draftVersion: 4, media: { assignments: [...before.media.assignments, ...assignments] } };
  const startResponse = f.put('suite-start-response.json', { at: '2026-09-16T10:29:00.100Z', status: 200, body: { code: 1, data: { action: 'START', suiteId, status: 'PLANNED', revision: 1, replayed: false } } });
  const continueRequest = f.put('suite-continue-request.json', { at: '2026-09-16T10:29:01.000Z', method: 'POST', path: '/api/extension-device/media-workflows/execute',
    body: { workflowId: binding.draftId, draftVersion: binding.draftVersion, idempotencyKey: 'fixture-continue-key', command: { version: 'extension-ai-image-suite-execute-command/v1', action: 'CONTINUE', suiteId, expectedSuiteRevision: 1 } } });
  const continueResponse = f.put('suite-continue-response.json', { at: '2026-09-16T10:29:01.100Z', status: 200, body: { code: 1, data: { action: 'CONTINUE', suiteId, status: 'QUEUED', revision: 2, replayed: false } } });
  const applyRequest = f.put('suite-apply-request.json', { at: '2026-09-16T10:35:00.000Z', path: '/api/extension-device/source-workbench/ai-image-suite/listing-assignments', method: 'POST',
    body: { contractVersion: 'extension-hosted-ai-image-listing-assignment/v2', shopId: binding.shopId, listingWorkflowId: binding.draftId,
      expectedDraftRevision: 3, expectedDraftVersion: 3, sourceCaptureSnapshotId: binding.snapshotId, assignmentStartOrdinal: before.media.assignments.length,
      planId: plan.id, planVersionId: plan.versionId, expectedPlanRevision: plan.revision, suiteId, expectedSuiteRevision: 4, idempotencyKey: 'fixture-apply-key', items } });
  const applied = f.put('suite-applied.json', { kind: 'REAL_HOSTED_SUITE_ERP_DRAFT_ASSIGNMENT', at: '2026-09-16T10:35:02.000Z',
    gitCommit: commit, extensionVersion: binding.extensionVersion, suiteId, items, before, after, assignmentPosts: 1,
    ozonProductWrites: 0, actualUi: true, actualDraftAssignmentsVerified: true, response: { status: 200, body: { code: 1, data: {
      contractVersion: 'extension-hosted-ai-image-listing-assignment/v2', batchId: 'private-batch', replayed: false,
      shopId: binding.shopId, listingWorkflowId: binding.draftId, sourceDraftRevision: 3, sourceDraftVersion: 3, boundDraftRevision: 4, boundDraftVersion: 4,
      assignments: assignments.map((row, index) => ({ assignmentId: 'assignment-' + index, skuKey: row.skuKey, slotKey: row.slotKey,
        assignmentScope: row.scope, assignmentOrdinal: index + 1, assetId: row.assetId })) } } } });
  const restored = f.put('suite-restored-db.json', { kind: 'REAL_ERP_JOB_DATABASE_READBACK', caseId: 'suite', gitCommit: commit,
    readbackRuntimeCommit: commit, observedAt: '2026-09-16T10:37:00.000Z', readOnly: true, suiteReferences,
    rows: rows.map(row => ({ ...row, workflow: { ...row.workflow, reviewStatus: 'APPROVED', revision: 4, selectedOutputAssetId: row.outputs[0].id,
      eventTypes: [...row.workflow.eventTypes, 'REVIEW_APPROVED'] } })) });
  const queue = f.put('suite-queue.json', { kind: 'REAL_HOSTED_SUITE_QUEUE_READBACK', gitCommit: commit, observedAt: '2026-09-16T10:35:10.000Z',
    readOnly: true, databaseId: 'production-com-primary', ownerSha256, suiteId, queueName: 'ai-image-suite-generation', allCompleted: true,
    jobs: rows.map((row, index) => ({ id: 'suite-generate-' + hash(JSON.stringify(['ai-image-suite-generation/v1', suiteId, slots[index].id, row.workflow.id, row.job.id, 1])),
      name: 'generate-suite-slot', state: 'completed', payload: { suiteId, slotId: slots[index].id, workflowId: row.workflow.id, jobId: row.job.id, attempt: 1 },
      attemptsMade: 1, attemptsStarted: 1, processedOn: Date.parse(row.job.startedAt), finishedOn: Date.parse(row.job.completedAt) })),
    slots: slots.map(slot => ({ id: slot.id, suiteId, childWorkflowId: slot.workflowId, attempt: 1, status: 'SUCCEEDED', slotKey: slot.slotKey, ownerSha256 })) });
  const controllerStatus = f.put('suite-controller.json', { result: { qualification: {
    schemaVersion: 1, kind: 'SS_ERP_COMPLETION_BOOTSTRAP_RECEIPT', action: 'restore', phase: 'restored', caseId: 'suite', commit, ownerSha256,
    currency: 'CNY', unitCostCents: 14, maximumTaskCostCents: 28, workflowEnabled: false, sharedDailyBudgetModified: false,
    userDailyLimitModified: false, legacyTextAiModified: false, pending: { jobs: 0, costs: 0, recovery: 0, workflows: 0, suites: 0 },
    backupSha256: hash('backup'), credentialRevisionBefore: 8, credentialRevisionAfter: 10, restoredAt: '2026-09-16T10:36:00.000Z',
    candidate: { gitCommit: commit, offlineSha256: f.input.offline.receipt.sha256, releaseEvidenceSha256: hash('release'), signatureSha256: hash('signature'), vpsSha256: hash('vps') },
  } } });
  const startRequest = f.put('suite-start-request.json', { at: '2026-09-16T10:29:00.000Z', method: 'POST', path: '/api/extension-device/media-workflows/execute',
    body: { shopId: binding.shopId, workflowId: binding.draftId, draftVersion: 3, idempotencyKey: 'fixture-start-key',
      command: { version: 'extension-ai-image-suite-execute-command/v1', action: 'START',
        expectedPreviewHash: plan.previewHash, acceptedPricingVersion: quote.pricingVersion, acceptedEstimatedCostCents: 28, acceptedMaximumCostCents: 28,
        snapshotId: binding.snapshotId, supplyGoodsId: binding.collectId, draftRevision: 3,
        planId: plan.id, planVersionId: plan.versionId, planRevision: plan.revision } } });
  const submitted = f.put('suite-submitted.json', { at: '2026-09-16T10:29:01.200Z', gitCommit: commit, extensionVersion: binding.extensionVersion,
    suiteId, providerWorkDispatched: true, startExecutePosts: 1, continueExecutePosts: 1, additionalStartPosts: 0, retryAllowed: false });
  const browser = f.put('suite-browser.json', { schemaVersion: 1, kind: 'NORMAL_IMAGE_SUITE_BROWSER_EXECUTION', gitCommit: commit,
    ownerSha256, suiteId, jobIdHashes: rows.map(row => row.job.idSha256), imageSha256: imageRefs.map(ref => ref.sha256),
    startedAt: '2026-09-16T10:24:00.000Z', completedAt: '2026-09-16T10:38:00.000Z', realSignedInAccount: true,
    isolation: { kind: 'DEDICATED_QA_PROFILE', profileSha256: hash('profile'), debuggingPort: 9444, protectedDebuggingPort: 9222 },
    ownedTargetsClosed: true, originalBrowserPreserved: true });
  const manifest = { schemaVersion: 1, kind: 'NORMAL_IMAGE_SUITE_DRAFT_FLOW_INPUTS', operation: 'IMAGE_TO_IMAGE', source, referenceImage: source,
    secondImage: imageRefs[1], workbench: f.put('suite-workbench.json', binding), generatedUi, submitted, startRequest, startResponse, continueRequest, continueResponse, applyRequest, queue, browser, previews, reviews };
  const acceptance = f.put('suite-inputs.json', manifest);
  f.input.normalErp = { acceptance, generated, applied, restored, controllerStatus, image: imageRefs[0] };
  const changeMapped = (key, mutate, index) => {
    const ref = index === undefined ? manifest[key] : manifest[key][index]; f.change(ref, mutate);
    f.change(acceptance, value => { if (index === undefined) value[key].sha256 = ref.sha256; else value[key][index].sha256 = ref.sha256; });
  };
  return { ...f, manifest, changeMapped };
}
