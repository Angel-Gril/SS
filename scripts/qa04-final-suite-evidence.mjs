import { canonicalTimestamp, exactKeys, isRecord, isSha256, pngEvidence, requireThat, sha256, sortedJson } from './qa04-final-evidence.mjs';

const CODE = 'QA04_SUITE_INVALID';
const check = condition => requireThat(condition, CODE);
const equal = (left, right) => sortedJson(left) === sortedJson(right);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 500;
const positive = value => Number.isSafeInteger(value) && value > 0;
const time = value => canonicalTimestamp(value, CODE);
const pair = values => { check(Array.isArray(values) && values.length === 2 && values.every(isRecord)); return values; };
const single = values => { check(Array.isArray(values) && values.length === 1 && isRecord(values[0])); return values[0]; };
const unique = values => check(values.every(text) && new Set(values).size === values.length);
const success = response => check(response?.status >= 200 && response.status < 300 && response.body?.code === 1);

// This variant consumes only original local records. It cannot create tasks,
// rewrite old evidence, bridge historical execution, or grant production access.
export function verifySuiteNormalErp(reader, input, manifest, now, verifySource) {
  exactKeys(manifest, ['schemaVersion', 'kind', 'operation', 'source', 'referenceImage', 'secondImage', 'workbench', 'generatedUi',
    'submitted', 'startRequest', 'startResponse', 'continueRequest', 'continueResponse', 'applyRequest', 'queue', 'browser', 'previews', 'reviews'], CODE);
  check(manifest.schemaVersion === 1 && manifest.kind === 'NORMAL_IMAGE_SUITE_DRAFT_FLOW_INPUTS' && manifest.operation === 'IMAGE_TO_IMAGE');
  pair(manifest.previews); pair(manifest.reviews);
  const refs = input.normalErp, read = ref => reader.json(ref, CODE, { nativeCompact: true });
  const generated = read(refs.generated), restored = read(refs.restored), applied = read(refs.applied);
  const binding = read(manifest.workbench), ui = read(manifest.generatedUi), submitted = read(manifest.submitted);
  const start = read(manifest.startRequest), startResponse = read(manifest.startResponse), continueRequest = read(manifest.continueRequest),
    continueResponse = read(manifest.continueResponse), applyRequest = read(manifest.applyRequest), queue = read(manifest.queue), browser = read(manifest.browser);
  const controller = read(refs.controllerStatus)?.result?.qualification;
  const source = pngEvidence(reader, manifest.source, CODE), reference = pngEvidence(reader, manifest.referenceImage, CODE);
  const images = [pngEvidence(reader, refs.image, CODE), pngEvidence(reader, manifest.secondImage, CODE)];
  check(images.every(image => image.width === 900 && image.height === 1200) && images[0].sha256 !== images[1].sha256);
  const commit = input.targetGitCommit, offline = reader.json(input.offline.receipt, CODE), owner = binding.ownerSha256;
  const native = (value, kind) => check(value?.kind === kind && value.gitCommit === commit);
  native(ui, 'REAL_HOSTED_SUITE_UI_GET_READBACK'); native(applied, 'REAL_HOSTED_SUITE_ERP_DRAFT_ASSIGNMENT');
  native(queue, 'REAL_HOSTED_SUITE_QUEUE_READBACK'); native(browser, 'NORMAL_IMAGE_SUITE_BROWSER_EXECUTION');
  check(binding.gitCommit === commit && isSha256(owner) && binding.caseId === 'suite' && binding.operation === 'IMAGE_TO_IMAGE'
    && binding.launch === 'ACTUAL_ERP_DRAFT_BUTTON' && binding.sourceSha256 === source.sha256
    && text(binding.sourceMediaKey) && text(binding.sourceAssetId) && text(binding.snapshotId) && text(binding.draftId)
    && text(binding.shopId) && text(binding.collectId) && positive(binding.revision) && positive(binding.draftVersion)
    && /^[0-9A-F]{32}$/u.test(binding.workbenchTargetId) && /^[0-9A-F]{32}$/u.test(binding.ownedWebTargetId)
    && binding.workbenchTargetId !== binding.ownedWebTargetId && /^\d+\.\d+\.\d+$/u.test(binding.extensionVersion));
  const suiteId = ui.suiteId, projection = ui.projection, slots = pair(projection?.suite?.slots), plan = projection.plan;
  unique(slots.map(slot => slot.id)); unique(slots.map(slot => slot.slotKey)); unique(slots.map(slot => slot.workflowId));
  check(text(suiteId) && projection.executionMode === 'ERP_HOSTED' && projection.suite.id === suiteId
    && projection.suite.status === 'SUCCEEDED' && projection.suite.itemCount === 2 && ui.mutationPosts === 0
    && equal(slots.map(slot => slot.goal).sort(), ['scene', 'sku_hero'])
    && projection.sourceBinding?.snapshotId === binding.snapshotId && projection.sourceBinding.supplyGoodsId === binding.collectId
    && equal(projection.binding, { shopId: binding.shopId, workflowId: binding.draftId, draftRevision: binding.revision, draftVersion: binding.draftVersion })
    && text(plan?.id) && text(plan.versionId) && positive(plan.revision) && isSha256(plan.previewHash)
    && projection.quote?.currency === 'CNY' && projection.quote.itemCount === 2
    && projection.quote.estimatedCostCents === 28 && projection.quote.maximumCostCents === 28
    && text(projection.quote.pricingVersion));
  for (const value of [ui, submitted, applied]) check(value.extensionVersion === binding.extensionVersion);
  check(submitted.gitCommit === commit && submitted.suiteId === suiteId && submitted.startExecutePosts === 1
    && submitted.continueExecutePosts === 1 && submitted.additionalStartPosts === 0
    && submitted.providerWorkDispatched === true && submitted.retryAllowed === false);
  success(startResponse);
  check(startResponse.body.data.action === 'START' && startResponse.body.data.suiteId === suiteId
    && startResponse.body.data.status === 'PLANNED' && startResponse.body.data.revision === 1 && startResponse.body.data.replayed === false);
  check(continueRequest.method === 'POST' && continueRequest.path === '/api/extension-device/media-workflows/execute'
    && continueRequest.body?.command?.version === 'extension-ai-image-suite-execute-command/v1'
    && continueRequest.body.command.action === 'CONTINUE' && continueRequest.body.command.suiteId === suiteId
    && continueRequest.body.command.expectedSuiteRevision === startResponse.body.data.revision
    && continueRequest.body.workflowId === binding.draftId && continueRequest.body.draftVersion === binding.draftVersion
    && text(continueRequest.body.idempotencyKey));
  success(continueResponse);
  check(continueResponse.body.data.action === 'CONTINUE' && continueResponse.body.data.suiteId === suiteId
    && ['QUEUED', 'RUNNING', 'SUCCEEDED'].includes(continueResponse.body.data.status)
    && positive(continueResponse.body.data.revision) && continueResponse.body.data.revision > startResponse.body.data.revision
    && continueResponse.body.data.replayed === false);
  check(start.method === 'POST' && start.path === '/api/extension-device/media-workflows/execute'
    && start.body?.shopId === binding.shopId && start.body.workflowId === binding.draftId && start.body.draftVersion === binding.draftVersion
    && text(start.body.idempotencyKey) && start.body.command?.version === 'extension-ai-image-suite-execute-command/v1'
    && start.body.command.action === 'START' && start.body.command.expectedPreviewHash === plan.previewHash
    && start.body.command.acceptedPricingVersion === projection.quote.pricingVersion
    && start.body.command.acceptedEstimatedCostCents === 28 && start.body.command.acceptedMaximumCostCents === 28
    && start.body.command.snapshotId === binding.snapshotId && start.body.command.supplyGoodsId === binding.collectId
    && start.body.command.draftRevision === binding.revision && start.body.command.planId === plan.id
    && start.body.command.planVersionId === plan.versionId && start.body.command.planRevision === plan.revision);
  check(time(offline.completedAt) <= time(binding.launchedAt) && time(binding.launchedAt) <= time(start.at)
    && time(start.at) <= time(startResponse.at) && time(startResponse.at) <= time(continueRequest.at)
    && time(continueRequest.at) <= time(continueResponse.at) && time(continueResponse.at) <= time(submitted.at)
    && time(submitted.at) <= time(generated.observedAt));
  const originalRows = pair(generated.rows), restoredRows = pair(restored.rows), seenJobs = [], seenProviders = [], seenCharges = [], seenOutputs = [], seenReservations = [];
  const rows = [];
  for (const [phase, database] of [['generated', generated], ['restored', restored]]) {
    native(database, 'REAL_ERP_JOB_DATABASE_READBACK');
    check(database.caseId === 'suite' && database.readOnly === true && database.readbackRuntimeCommit === commit && time(database.observedAt) <= time(now));
    const lineage = single(database.suiteReferences);
    check(lineage.suiteId === suiteId && sha256(lineage.ownerUserId) === owner && lineage.ordinal === 0
      && lineage.candidateId === binding.sourceMediaKey && text(lineage.assetId)
      && lineage.assetSha256 === reference.sha256 && lineage.rawSourceSha256 === source.sha256
      && lineage.sizeBytes === reference.bytes && lineage.width === reference.width && lineage.height === reference.height
      && lineage.mimeType === reference.mimeType);
    if (phase === 'restored') check(equal(database.suiteReferences, generated.suiteReferences));
    pair(database.rows);
    for (const row of database.rows) {
      const job = row.job, flow = row.workflow, cost = row.cost, output = single(row.outputs), charge = single(cost?.charges);
      check(text(job?.id) && job.idSha256 === sha256(job.id) && job.ownerSha256 === owner && job.status === 'SUCCEEDED'
        && job.operation === 'IMAGE_TO_IMAGE' && job.provider === 'dashscope-wanx' && job.model === 'wanx2.1-imageedit'
        && job.attemptCount === 1 && job.requestedImageCount === 1 && job.width === 900 && job.height === 1200
        && job.providerReconciliationStatus === 'NOT_REQUIRED' && isSha256(job.providerJobIdSha256)
        && job.actualCostCents === 14 && job.billedUnits === 1 && job.errorCode === null
        && equal(job.pricing, { currency: 'CNY', unitCostCents: 14, requestedImageCount: 1, maximumCostCents: 14 }));
      check(time(job.startedAt) >= time(offline.completedAt) && time(job.startedAt) >= time(start.at)
        && time(job.completedAt) > time(job.startedAt) && time(job.completedAt) <= time(database.observedAt));
      check(cost.status === 'SETTLED' && cost.currency === 'CNY' && cost.maximumCostMinor === 14 && cost.settlementCount === 1
        && cost.jobIdSha256 === job.idSha256 && isSha256(cost.idSha256) && charge.kind === 'CHARGE' && charge.currency === 'CNY'
        && charge.actualCostMinor === 14 && charge.billedUnits === 1 && charge.jobIdSha256 === job.idSha256 && isSha256(charge.chargeIdSha256));
      const slot = slots.find(slot => slot.workflowId === flow?.id), image = images.find(image => image.sha256 === output.sha256);
      check(slot && image && flow.idSha256 === sha256(flow.id) && flow.operation === 'IMAGE_TO_IMAGE' && flow.status === 'SUCCEEDED'
        && flow.contextType === 'collect' && flow.contextId === binding.collectId && flow.contextSlotKey === slot.slotKey
        && flow.reviewStatus === (phase === 'generated' ? 'PENDING' : 'APPROVED')
        && flow.selectedOutputAssetId === (phase === 'generated' ? null : output.id)
        && slot.status === 'SUCCEEDED' && slot.attempt === 1 && slot.output?.assetId === output.id
        && slot.output.width === 900 && slot.output.height === 1200);
      check(output.idSha256 === sha256(output.id) && output.jobIdSha256 === job.idSha256 && output.kind === 'AI_GENERATED'
        && output.width === image.width && output.height === image.height && output.mimeType === image.mimeType
        && output.sizeBytes === image.bytes && output.storageBackend === 'oss');
      const frozen = single(job.frozenInputs), selected = single(flow.inputs), sourceAsset = single(flow.inputAssets);
      check(frozen.role === 'REFERENCE' && frozen.ordinal === 0 && frozen.assetId === lineage.assetId
        && frozen.sha256 === reference.sha256 && frozen.sizeBytes === reference.bytes
        && selected.role === 'REFERENCE' && selected.ordinal === 0 && selected.assetId === frozen.assetId && selected.assetSha256 === frozen.sha256
        && sourceAsset.id === frozen.assetId && sourceAsset.sha256 === reference.sha256
        && sourceAsset.sourceMediaKey === binding.sourceMediaKey && sourceAsset.sourceCaptureSnapshotId === binding.snapshotId
        && sourceAsset.sizeBytes === reference.bytes && sourceAsset.width === reference.width && sourceAsset.height === reference.height
        && sourceAsset.mimeType === reference.mimeType);
      check(Array.isArray(flow.eventTypes) && ['CREATED', 'JOB_STARTED', 'PROVIDER_DISPATCH_STARTED', 'PROVIDER_SUBMITTED',
        'PROVIDER_OUTPUT_PERSISTED', 'JOB_SUCCEEDED'].every(type => flow.eventTypes.includes(type)));
      if (phase === 'generated') {
        check(!flow.eventTypes.includes('REVIEW_APPROVED') && !flow.eventTypes.includes('REVIEW_REJECTED'));
        seenJobs.push(job.id); seenProviders.push(job.providerJobIdSha256); seenCharges.push(charge.chargeIdSha256); seenOutputs.push(output.id); seenReservations.push(cost.idSha256);
        rows.push({ job, flow, output, slot, image });
      } else {
        const original = originalRows.find(value => value.job.id === job.id);
        check(original && equal(original.job, job) && equal(original.cost, cost) && equal(original.outputs, row.outputs)
          && equal(original.workflow.inputs, flow.inputs) && equal(original.workflow.inputAssets, flow.inputAssets)
          && flow.revision === original.workflow.revision + 1 && flow.eventTypes.includes('REVIEW_APPROVED')
          && !flow.eventTypes.includes('REVIEW_REJECTED'));
      }
    }
  }
  unique(seenJobs); unique(seenProviders); unique(seenCharges); unique(seenOutputs); unique(seenReservations);
  unique(restoredRows.map(row => row.job.id));
  check(rows.every(row => time(ui.at) >= time(row.job.completedAt)) && time(ui.at) <= time(applied.at)
    && time(generated.observedAt) <= time(applied.at) && time(applied.at) <= time(restored.observedAt));
  const before = applied.before, after = applied.after, items = pair(applied.items);
  check(applied.suiteId === suiteId && applied.assignmentPosts === 1 && applied.ozonProductWrites === 0 && applied.actualUi === true);
  check(before?.id === binding.draftId && after?.id === before.id && sha256(before.ownerUserId) === owner && after.ownerUserId === before.ownerUserId
    && before.shopId === binding.shopId && after.shopId === before.shopId && before.sourceCaptureSnapshotId === binding.snapshotId
    && after.sourceCaptureSnapshotId === before.sourceCaptureSnapshotId && before.supplyGoodsId === binding.collectId && after.supplyGoodsId === before.supplyGoodsId
    && before.revision === binding.revision && before.draftVersion === binding.draftVersion && after.revision === before.revision + 1
    && after.draftVersion === before.draftVersion + 1 && equal(after.selectedSkuKeys, before.selectedSkuKeys)
    && Array.isArray(before.media?.assignments) && Array.isArray(after.media?.assignments)
    && after.media.assignments.length === before.media.assignments.length + 2 && after.media.assignments.length <= 500
    && equal(after.media.assignments.slice(0, before.media.assignments.length), before.media.assignments));
  success(applied.response);
  const result = applied.response.body.data, command = applyRequest.body;
  check(result.contractVersion === 'extension-hosted-ai-image-listing-assignment/v2' && text(result.batchId) && result.replayed === false
    && result.shopId === binding.shopId && result.listingWorkflowId === binding.draftId && result.sourceDraftRevision === before.revision
    && result.sourceDraftVersion === before.draftVersion && result.boundDraftRevision === after.revision && result.boundDraftVersion === after.draftVersion);
  const returned = pair(result.assignments);
  unique(items.map(item => item.suiteSlotId)); unique(returned.map(item => item.assignmentId));
  check(applyRequest.method === 'POST' && applyRequest.path === '/api/extension-device/source-workbench/ai-image-suite/listing-assignments'
    && command?.contractVersion === result.contractVersion && command.shopId === binding.shopId && command.listingWorkflowId === binding.draftId
    && command.expectedDraftRevision === before.revision && command.expectedDraftVersion === before.draftVersion
    && command.sourceCaptureSnapshotId === binding.snapshotId && command.assignmentStartOrdinal === before.media.assignments.length
    && command.planId === plan.id && command.planVersionId === plan.versionId && command.expectedPlanRevision === plan.revision
      && command.suiteId === suiteId && positive(command.expectedSuiteRevision) && text(command.idempotencyKey) && equal(command.items, items)
    && time(applyRequest.at) >= time(ui.at) && time(applyRequest.at) <= time(applied.at));
  const previews = manifest.previews.map(read), reviews = manifest.reviews.map(read);
  unique(previews.map(value => value.slotId)); unique(reviews.map(value => value.slotId));
  for (const row of rows) {
    const { job, flow, output, slot } = row, preview = previews.find(value => value.slotId === slot.id), review = reviews.find(value => value.slotId === slot.id);
    native(preview, 'REAL_HOSTED_SUITE_CANDIDATE_PREVIEW'); native(review, 'REAL_HOSTED_SUITE_CANDIDATE_REVIEW');
    check(preview.suiteId === suiteId && review.suiteId === suiteId && preview.workflowId === flow.id && review.workflowId === flow.id
      && preview.outputAssetId === output.id && review.outputAssetId === output.id && preview.sha256 === output.sha256
      && preview.width === 900 && preview.height === 1200 && preview.mimeType === 'image/png' && preview.byteLength === output.sizeBytes
      && review.decision === 'APPROVE' && review.viewedSha256 === output.sha256 && text(review.visualObservation)
      && preview.extensionVersion === binding.extensionVersion && review.extensionVersion === binding.extensionVersion
      && time(preview.at) >= time(ui.at) && time(review.at) >= time(preview.at)
      && time(review.at) >= time(generated.observedAt) && time(review.at) <= time(applyRequest.at));
    success(review.response);
    check(review.projection?.suite?.id === suiteId && review.projection.suite.slots.find(value => value.id === slot.id)?.reviewStatus === 'APPROVED');
    const item = items.find(item => item.suiteSlotId === slot.id), added = after.media.assignments.filter(item => item.assetId === output.id);
    const receipt = returned.find(item => item.assetId === output.id);
    check(item && item.childWorkflowId === flow.id && item.outputAssetId === output.id && item.slotKey === slot.slotKey
      && positive(item.expectedSuiteSlotRevision) && item.expectedChildWorkflowRevision === restoredRows.find(value => value.job.id === job.id).workflow.revision
      && Array.isArray(slot.applicableSkuKeys) && slot.applicableSkuKeys.includes(item.skuKey)
      && before.selectedSkuKeys.includes(item.skuKey) && added.length === 1 && receipt && added[0].slotKey === item.slotKey
      && added[0].source === 'GENERATED' && receipt.slotKey === item.slotKey && receipt.skuKey === item.skuKey
      && receipt.assignmentOrdinal === before.media.assignments.length + items.indexOf(item)
      && !before.media.assignments.some(value => value.slotKey === item.slotKey || value.assetId === output.id));
    check((receipt.assignmentScope === 'SKU' && added[0].scope === 'SKU' && added[0].skuKey === item.skuKey)
      || (receipt.assignmentScope === 'PRODUCT' && added[0].scope === 'PRODUCT' && !Object.hasOwn(added[0], 'skuKey')));
  }
  check(queue.suiteId === suiteId && queue.readOnly === true && queue.databaseId === 'production-com-primary' && queue.ownerSha256 === owner
    && queue.queueName === 'ai-image-suite-generation' && time(queue.observedAt) >= time(generated.observedAt) && time(queue.observedAt) <= time(now));
  pair(queue.jobs); pair(queue.slots); unique(queue.jobs.map(job => job.id)); unique(queue.slots.map(slot => slot.id));
  for (const { job, flow, slot } of rows) {
    const payload = { suiteId, slotId: slot.id, workflowId: flow.id, jobId: job.id, attempt: 1 };
    const id = 'suite-generate-' + sha256(JSON.stringify(['ai-image-suite-generation/v1', suiteId, slot.id, flow.id, job.id, 1]));
    const queued = queue.jobs.find(value => value.id === id), observedSlot = queue.slots.find(value => value.id === slot.id);
    check(queued && queued.name === 'generate-suite-slot' && queued.state === 'completed' && equal(queued.payload, payload)
      && queued.attemptsMade === 1 && queued.attemptsStarted === 1 && positive(queued.processedOn) && positive(queued.finishedOn)
      && queued.processedOn >= time(offline.completedAt) && queued.processedOn <= time(job.startedAt)
      && queued.finishedOn >= time(job.completedAt) && queued.finishedOn <= time(queue.observedAt)
      && observedSlot?.suiteId === suiteId && observedSlot.childWorkflowId === flow.id && observedSlot.attempt === 1
      && observedSlot.status === 'SUCCEEDED' && observedSlot.slotKey === slot.slotKey && observedSlot.ownerSha256 === owner);
  }
  check(controller?.schemaVersion === 1 && controller.kind === 'SS_ERP_COMPLETION_BOOTSTRAP_RECEIPT'
    && controller.action === 'restore' && controller.phase === 'restored' && controller.caseId === 'suite'
    && controller.commit === commit && controller.ownerSha256 === owner && controller.currency === 'CNY'
    && controller.unitCostCents === 14 && controller.maximumTaskCostCents === 28 && controller.workflowEnabled === false
    && controller.sharedDailyBudgetModified === false && controller.userDailyLimitModified === false && controller.legacyTextAiModified === false
    && equal(controller.pending, { jobs: 0, costs: 0, recovery: 0, workflows: 0, suites: 0 }) && isSha256(controller.backupSha256)
    && positive(controller.credentialRevisionBefore) && positive(controller.credentialRevisionAfter)
    && controller.credentialRevisionAfter > controller.credentialRevisionBefore
    && controller.candidate?.gitCommit === commit && controller.candidate.offlineSha256 === input.offline.receipt.sha256
    && ['releaseEvidenceSha256', 'signatureSha256', 'vpsSha256'].every(key => isSha256(controller.candidate[key]))
    && time(controller.restoredAt) >= time(applied.at) && time(controller.restoredAt) <= time(restored.observedAt));
  check(browser.schemaVersion === 1 && browser.ownerSha256 === owner && browser.suiteId === suiteId
    && Array.isArray(browser.jobIdHashes) && browser.jobIdHashes.length === 2 && browser.jobIdHashes.every(isSha256)
    && Array.isArray(browser.imageSha256) && browser.imageSha256.length === 2 && browser.imageSha256.every(isSha256)
    && equal([...browser.jobIdHashes].sort(), rows.map(row => row.job.idSha256).sort())
    && equal([...browser.imageSha256].sort(), images.map(image => image.sha256).sort())
    && browser.realSignedInAccount === true && browser.ownedTargetsClosed === true && browser.originalBrowserPreserved === true
    && browser.isolation?.kind === 'DEDICATED_QA_PROFILE' && isSha256(browser.isolation.profileSha256)
    && positive(browser.isolation.debuggingPort) && browser.isolation.debuggingPort <= 65535
    && positive(browser.isolation.protectedDebuggingPort) && browser.isolation.protectedDebuggingPort <= 65535
    && browser.isolation.debuggingPort !== browser.isolation.protectedDebuggingPort
    && time(browser.startedAt) <= time(binding.launchedAt) && time(browser.completedAt) >= time(restored.observedAt) && time(browser.completedAt) <= time(now));
  const sourceBridge = verifySource(commit, commit);
  return { executionCommit: commit, completedAt: browser.completedAt, operation: 'IMAGE_TO_IMAGE', workflowKind: 'SUITE',
    provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', currency: 'CNY', unitCostMinor: 14,
    successfulImages: 2, actualCostMinor: 28, chargeCount: 2, applicationCount: 2, originalImagePreserved: true,
    configurationRestored: true, image: images[0], images, sourceBridge, targetUiProductionVerified: false, verifiedSuiteBrowser: true,
    sourceSha256: source.sha256, referenceSha256: reference.sha256,
    evidence: { ...Object.fromEntries(Object.entries(refs).map(([key, ref]) => [`${key}Sha256`, ref.sha256])),
      ...Object.fromEntries(Object.entries(manifest).filter(([, value]) => isRecord(value) && isSha256(value.sha256)).map(([key, ref]) => [`${key}Sha256`, ref.sha256])),
      previewSha256: manifest.previews.map(ref => ref.sha256), reviewSha256: manifest.reviews.map(ref => ref.sha256),
      startResponseSha256: manifest.startResponse.sha256, continueRequestSha256: manifest.continueRequest.sha256,
      continueResponseSha256: manifest.continueResponse.sha256 } };
}
