import { canonicalTimestamp, exactKeys, imageEvidence, isRecord, isSha256, pngEvidence, requireThat, sha256, sortedJson } from './qa04-final-evidence.mjs';
import { isRestrictedAiMediaHostedPilotOperations, isApprovedAiMediaHostedPublicationOperations, verifyAiMediaHostedPilotPolicy } from './verify-ai-media-pilot-policy.mjs';
import { COUNT_SUITE_PROFILE, verifyCountSuiteRecord, verifiedCountSuiteOutputSize } from './qa04-count-suite-profile.mjs';
import { verifyCurrentSuiteUiEvidence } from './qa04-suite-target-ui.mjs';

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

// schema6 deliberately keeps partial historical observations distinct from
// current qualification. Never synthesize the three missing historical keys.
function verifySupplementedControl(read, reader, controller, context) {
  const { commit, input, binding, start, applied, restored, generated, now, offline, browser } = context;
  exactKeys(controller, ['schemaVersion', 'kind', 'executionGitCommit', 'before', 'after',
    'currentSnapshot', 'currentExpectation', 'pendingReadback', 'navigation', 'executionDeviceSessionId'], CODE);
  check(controller.schemaVersion === 3 && controller.kind === 'SS_ERP_SUPPLEMENTED_PILOT_EXECUTION_CONTROL'
    && controller.executionGitCommit === commit && text(controller.executionDeviceSessionId));
  const before = read(controller.before), after = read(controller.after), current = read(controller.currentSnapshot);
  const expected = read(controller.currentExpectation);
  for (const value of [before, after, current]) {
    check(value.kind === 'SS_ERP_QA04_RUNTIME_READ_ONLY' && value.readOnly === true
      && isRecord(value.snapshot) && Array.isArray(value.snapshot.configRows) && Array.isArray(value.snapshot.deviceSessions));
  }
  check(before.gitCommit === commit && after.gitCommit === commit && current.gitCommit === input.targetGitCommit
    && time(before.observedAt) <= time(start.at)
    && time(after.observedAt) >= time(applied.at) && time(after.observedAt) <= time(restored.observedAt)
    && time(after.observedAt) <= time(browser.completedAt)
    && time(current.observedAt) >= time(applied.at) && time(current.observedAt) <= time(now)
    && time(now) - time(current.observedAt) <= 60 * 60 * 1000);
  check(equal(before.snapshot, after.snapshot) && equal(before.runtime, after.runtime) && equal(before.providerConfig, after.providerConfig));
  const config = Object.fromEntries(Object.entries(generated.suiteRuntime)
    .filter(([key]) => !['itemCount', 'estimatedCostCents', 'maximumCostCents'].includes(key)));
  check(equal(before.providerConfig, config) && equal(current.providerConfig, config)
    && equal(before.runtime, generated.rows[0].job.operationConfig.providerRuntime)
    && equal(before.runtime, current.runtime) && Array.isArray(before.snapshot.controls)
    && equal(before.snapshot.controls, current.snapshot.controls));
  const controls = before.snapshot.controls;
  check(controls.length === 2);
  for (const key of ['ai_daily_budget_cents', 'ai_user_daily_image_generation_limit']) {
    const row = single(controls.filter(value => value.key === key));
    check(text(row.id) && positive(row.revision) && typeof row.value === 'string' && /^[0-9]+$/u.test(row.value)
      && Number.isSafeInteger(Number(row.value)) && Number(row.value) > 0 && time(row.updatedAt) <= time(before.observedAt));
  }
  const rows = snapshot => {
    const map = new Map();
    for (const row of snapshot.configRows) {
      check(text(row?.key) && typeof row.value === 'string' && !map.has(row.key)); map.set(row.key, row.value);
    }
    return map;
  };
  const originalRows = rows(before.snapshot), currentRows = rows(current.snapshot);
  const missing = ['feature_image_translate', 'ai_image_translation_provider', 'ai_image_translation_model'];
  check(missing.every(key => !originalRows.has(key) && currentRows.has(key))
    && currentRows.size === originalRows.size + missing.length);
  for (const [key, value] of originalRows) check(currentRows.get(key) === value);
  let qualification;
  try { qualification = verifyAiMediaHostedPilotPolicy(current.snapshot, expected); } catch { check(false); }
  check(qualification.ownerUserIds.length === 1 && sha256(qualification.ownerUserIds[0]) === binding.ownerSha256
    && qualification.shopIds.includes(binding.shopId)
    && isApprovedAiMediaHostedPublicationOperations(qualification.allowedOperations));
  const sessions = before.snapshot.deviceSessions;
  check(sessions.length > 0 && sessions.length <= 50); unique(sessions.map(value => value.id));
  const scopes = ['capture:write', 'listing:review', 'listing:write', 'media:execute'];
  for (const session of sessions) {
    check(session.status === 'ACTIVE' && session.ownerUserId === qualification.ownerUserIds[0]
      && session.actorUserId === session.ownerUserId && equal(session.scopes, scopes)
      && Array.isArray(session.shopIds) && session.shopIds.length > 0 && session.shopIds.length <= 50);
    unique(session.shopIds); check(session.shopIds.every(shop => qualification.shopIds.includes(shop)));
  }
  const currentExecutionSession = current.snapshot.deviceSessions
    .find(session => session.id === controller.executionDeviceSessionId);
  // Cleanup may revoke the execution session before the final readback. The
  // historical snapshot remains the authority for the grant used by the suite;
  // current readback must only prove that surviving sessions did not grow.
  check(!currentExecutionSession || currentExecutionSession.shopIds.includes(binding.shopId));
  // Current verification may remove expired/revoked sessions, never expand a
  // historical device's grants or use a new device as execution evidence.
  for (const session of current.snapshot.deviceSessions) check(equal(session, sessions.find(value => value.id === session.id)));
  const pending = read(controller.pendingReadback);
  check(pending.kind === 'REAL_HOSTED_SUITE_PENDING_READBACK' && pending.caseId === 'suite' && pending.phase === 'pending'
    && pending.gitCommit === commit && pending.readbackRuntimeCommit === commit && pending.readOnly === true
    && pending.ownerSha256 === binding.ownerSha256 && pending.databaseId === 'production-com-primary'
    && equal(pending.pending, { jobs: 0, costs: 0, recovery: 0, workflows: 0, suites: 0 })
    && time(pending.observedAt) >= time(applied.at) && time(pending.observedAt) <= time(restored.observedAt));
  const navigation = read(controller.navigation);
  exactKeys(navigation, ['schemaVersion', 'kind', 'gitCommit', 'ui', 'sourcePageTargetId', 'workbenchTargetId',
    'pagesBefore', 'pagesAfter', 'targetsBefore', 'targetsAfter', 'beforeAt', 'afterAt', 'click', 'isolation', 'cleanup',
    'providerRequests', 'ozonWrites', 'businessMutations'], CODE);
  const targetOffline = reader.json(input.offline.receipt, CODE);
  check(time(current.observedAt) >= time(targetOffline.completedAt));
  const reusedExecutionUi = commit !== input.targetGitCommit;
  const ui = verifyCurrentSuiteUiEvidence(reader, navigation.ui,
    { targetCommit: reusedExecutionUi ? commit : input.targetGitCommit, changes: [] },
    reusedExecutionUi ? restored.observedAt : targetOffline.completedAt,
    now, reusedExecutionUi ? { minimumObservedAt: restored.observedAt, requireRecent: false } : undefined);
  const uiRecord = read(navigation.ui);
  check(navigation.schemaVersion === 1 && navigation.kind === 'SS_ERP_CURRENT_SOURCE_NAVIGATION'
    && navigation.gitCommit === input.targetGitCommit && navigation.providerRequests === 0
    && navigation.ozonWrites === 0 && navigation.businessMutations === 0
    && (commit !== input.targetGitCommit || ui.version === binding.extensionVersion)
    && /^[0-9A-F]{32}$/u.test(navigation.sourcePageTargetId) && /^[0-9A-F]{32}$/u.test(navigation.workbenchTargetId)
    && navigation.sourcePageTargetId !== navigation.workbenchTargetId);
  const pages = values => {
    check(Array.isArray(values) && values.length > 0 && values.length <= 20); unique(values.map(value => value.id));
    for (const page of values) {
      check(/^[0-9A-F]{32}$/u.test(page.id) && typeof page.url === 'string' && page.url.length <= 4096);
      let url; try { url = new URL(page.url); } catch { check(false); }
      check(!/^(?:app\.)?ss-erp\.(?:com|cn)\.?$/iu.test(url.hostname));
    }
    return [...values].sort((left, right) => left.id.localeCompare(right.id));
  };
  check(equal(pages(navigation.pagesBefore), pages(navigation.pagesAfter)));
  for (const [ref, at, observedPages] of [[navigation.targetsBefore, navigation.beforeAt, navigation.pagesBefore],
    [navigation.targetsAfter, navigation.afterAt, navigation.pagesAfter]]) {
    const targets = read(ref);
    check(targets.at === at && Array.isArray(targets.targetInfos) && targets.targetInfos.length > 0 && targets.targetInfos.length <= 100);
    unique(targets.targetInfos.map(value => value.targetId));
    check(equal(pages(targets.targetInfos.filter(value => value.type === 'page').map(value => ({ id: value.targetId, url: value.url }))), pages(observedPages)));
  }
  const afterTargets = read(navigation.targetsAfter).targetInfos;
  const frame = afterTargets.find(value => value.targetId === navigation.workbenchTargetId);
  check(frame?.type === 'iframe' && frame.parentFrameId === navigation.sourcePageTargetId
    && /^chrome-extension:\/\/[a-p]{32}\/pages\/precision-workbench\.html$/u.test(frame.url));
  const page = navigation.pagesBefore.find(value => value.id === navigation.sourcePageTargetId), click = navigation.click;
  check(page && /^https:\/\/detail\.1688\.com\/offer\/[0-9]+\.html(?:\?|$)/u.test(page.url)
    && click?.method === 'Input.dispatchMouseEvent' && click.targetId === page.id
    && click.selector === '#ss-erp-donor-workbench-trigger' && Number.isFinite(click.x) && Number.isFinite(click.y)
    && click.x >= 0 && click.y >= 0 && click.x < uiRecord.viewport.width && click.y < uiRecord.viewport.height
    && (reusedExecutionUi || time(navigation.beforeAt) >= time(targetOffline.completedAt))
    && time(navigation.beforeAt) <= time(click.at) && time(click.at) <= time(navigation.afterAt)
    && time(navigation.afterAt) === time(ui.observedAt));
  const isolation = navigation.isolation, cleanup = navigation.cleanup;
  check(isolation?.kind === 'DEDICATED_QA_PROFILE' && isSha256(isolation.profileSha256)
    && positive(isolation.debuggingPort) && isolation.debuggingPort <= 65535
    && positive(isolation.protectedDebuggingPort) && isolation.protectedDebuggingPort <= 65535
    && isolation.debuggingPort !== isolation.protectedDebuggingPort
    && cleanup?.ownedTargetsClosed === true && cleanup.originalBrowserPreserved === true
    && time(cleanup.at) >= time(navigation.afterAt) && time(cleanup.at) <= time(now));
  return { executionControlBoundary: 'BEFORE_START', historicalFullPilotVerified: false, historicalNoNewTabsVerified: false,
    currentPilotVerified: true, currentCandidateNavigationVerified: true,
    supplementalEvidence: { beforeSha256: controller.before.sha256, afterSha256: controller.after.sha256,
      currentSnapshotSha256: controller.currentSnapshot.sha256, currentExpectationSha256: controller.currentExpectation.sha256,
      navigationSha256: controller.navigation.sha256, ui } };
}

// Source listing drafts use locale ordering in their database hash owner.
const sourceDraftJson = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(sourceDraftJson).join(',')}]`
    : `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${sourceDraftJson(item)}`).join(',')}}`;

// This variant consumes only original records. Reuse requires an independent
// conservative Git source bridge and a fresh read of current runtime config;
// original execution records and their execution/offline identities stay exact.
export function verifySuiteNormalErp(reader, input, manifest, now, verifySource, verifyExecutionOffline) {
  const supplemented = manifest.schemaVersion === 6;
  const sourcePageWorkflow = manifest.schemaVersion === 5 || supplemented;
  const countProfile = manifest.schemaVersion === 4 || sourcePageWorkflow;
  const derivedGeneratedPhase = manifest.schemaVersion === 3;
  const explicitExecution = manifest.schemaVersion === 2 || derivedGeneratedPhase || countProfile;
  const unitCost = countProfile ? 10 : 14, taskCost = unitCost * 2;
  const provider = countProfile ? 'custom' : 'dashscope-wanx', model = countProfile ? 'gpt-image-2-count' : 'wanx2.1-imageedit';
  exactKeys(manifest, ['schemaVersion', 'kind', 'operation', 'source', 'referenceImage', 'secondImage', 'workbench', 'generatedUi',
    'submitted', 'startRequest', 'startResponse', 'continueRequest', 'continueResponse', 'applyRequest', 'queue', 'browser', 'previews', 'reviews',
    ...(explicitExecution ? ['executionGitCommit', 'executionOfflineQa04'] : []),
    ...(derivedGeneratedPhase ? ['databaseEvidenceMode'] : []),
    ...(countProfile ? ['providerProfile', 'rawProviderImages', 'replayRequest', 'replayResponse'] : []),
    ...(sourcePageWorkflow ? ['sourceEntry'] : [])], CODE);
  check((manifest.schemaVersion === 1 || explicitExecution)
    && manifest.kind === 'NORMAL_IMAGE_SUITE_DRAFT_FLOW_INPUTS' && manifest.operation === 'IMAGE_TO_IMAGE');
  if (derivedGeneratedPhase) check(manifest.databaseEvidenceMode === 'POST_APPLICATION_EVENT_DERIVATION_V1');
  const executionCommit = explicitExecution ? manifest.executionGitCommit : input.targetGitCommit;
  if (countProfile) check(manifest.providerProfile === COUNT_SUITE_PROFILE);
  const reusingCountSuite = countProfile && executionCommit !== input.targetGitCommit;
  const executionOfflineRefs = explicitExecution ? manifest.executionOfflineQa04 : input.offline;
  check(/^[a-f0-9]{40}$/u.test(executionCommit));
  if (explicitExecution) exactKeys(executionOfflineRefs, ['receipt', 'log'], CODE);
  pair(manifest.previews); pair(manifest.reviews);
  const refs = input.normalErp, read = ref => {
    if (!supplemented) return reader.json(ref, CODE, { nativeCompact: true });
    // These native producers wrote JSON.stringify(..., null, 2) without LF.
    // Validate the pinned original bytes; do not rewrite historical evidence.
    let value, normalized;
    try {
      normalized = new TextDecoder('utf-8', { fatal: true }).decode(reader.read(ref)).replace(/\r\n/gu, '\n');
      value = JSON.parse(normalized);
    } catch (error) { if (error.code?.startsWith('QA04_')) throw error; check(false); }
    const pretty = JSON.stringify(value, null, 2), compact = JSON.stringify(value);
    check(isRecord(value) && [pretty, pretty + '\n', compact, compact + '\n'].includes(normalized));
    return value;
  };
  const generated = read(refs.generated), restored = read(refs.restored), applied = read(refs.applied);
  const binding = read(manifest.workbench), ui = read(manifest.generatedUi), submitted = read(manifest.submitted);
  if (countProfile) check([binding, ui, generated].every(value => value.gitCommit === executionCommit));
  requireThat(reusingCountSuite === Object.hasOwn(input, 'suiteReuse'), 'QA04_SUITE_REUSE_INVALID');
  const start = read(manifest.startRequest), startResponse = read(manifest.startResponse), continueRequest = read(manifest.continueRequest),
    continueResponse = read(manifest.continueResponse), applyRequest = read(manifest.applyRequest), queue = read(manifest.queue), browser = read(manifest.browser);
  const controllerRecord = read(refs.controllerStatus), controller = controllerRecord?.result?.qualification ?? controllerRecord;
  const source = imageEvidence(reader, manifest.source, CODE), reference = imageEvidence(reader, manifest.referenceImage, CODE);
  const images = [pngEvidence(reader, refs.image, CODE), pngEvidence(reader, manifest.secondImage, CODE)];
  const rawImages = countProfile ? (() => {
    check(Array.isArray(manifest.rawProviderImages) && manifest.rawProviderImages.length === 2);
    const values = manifest.rawProviderImages.map(ref => imageEvidence(reader, ref, CODE));
    check(values.every(image => verifiedCountSuiteOutputSize(image.width, image.height, sourcePageWorkflow) && image.bytes <= 20 * 1024 * 1024)
      && values[0].sha256 !== values[1].sha256);
    return values;
  })() : [];
  const previews = manifest.previews.map(read), reviews = manifest.reviews.map(read);
  check(images.every(image => image.width === 900 && image.height === 1200) && images[0].sha256 !== images[1].sha256);
  const executionOffline = explicitExecution ? verifyExecutionOffline(executionOfflineRefs, executionCommit,
    supplemented ? now : binding.launchedAt) : null;
  const commit = executionCommit, offline = executionOffline?.receipt ?? reader.json(input.offline.receipt, CODE), owner = binding.ownerSha256;
  const native = (value, kind) => check(value?.kind === kind && value.gitCommit === commit);
  native(ui, derivedGeneratedPhase ? 'REAL_HOSTED_SUITE_GENERATED_READBACK' : 'REAL_HOSTED_SUITE_UI_GET_READBACK');
  native(applied, 'REAL_HOSTED_SUITE_ERP_DRAFT_ASSIGNMENT');
  native(queue, 'REAL_HOSTED_SUITE_QUEUE_READBACK'); native(browser, 'NORMAL_IMAGE_SUITE_BROWSER_EXECUTION');
  check(binding.gitCommit === commit && isSha256(owner) && binding.caseId === 'suite' && binding.operation === 'IMAGE_TO_IMAGE'
    && (sourcePageWorkflow ? binding.launch === 'ACTUAL_SOURCE_IMAGE_BUTTON' : binding.launch === 'ACTUAL_ERP_DRAFT_BUTTON') && binding.sourceSha256 === source.sha256
    && text(binding.sourceMediaKey) && (text(binding.sourceAssetId) || (derivedGeneratedPhase && binding.sourceAssetId === null))
    && text(binding.snapshotId) && text(binding.draftId)
    && text(binding.shopId) && text(binding.collectId) && positive(binding.revision) && positive(binding.draftVersion)
    && /^[0-9A-F]{32}$/u.test(binding.workbenchTargetId)
    && (sourcePageWorkflow ? /^[0-9A-F]{32}$/u.test(binding.sourcePageTargetId)
      && binding.sourcePageTargetId !== binding.workbenchTargetId && binding.uiSurface === 'ACTUAL_SOURCE_PRECISION_IFRAME'
      && (supplemented ? binding.noNewTabs === undefined && binding.erpPageOpened === undefined
        : binding.noNewTabs === true && binding.erpPageOpened === false) && binding.ownedWebTargetId === undefined
      : /^[0-9A-F]{32}$/u.test(binding.ownedWebTargetId) && binding.workbenchTargetId !== binding.ownedWebTargetId)
    && /^\d+\.\d+\.\d+$/u.test(binding.extensionVersion));
  if (sourcePageWorkflow) {
    const entry = read(manifest.sourceEntry);
    check(entry.kind === 'REAL_SOURCE_WORKBENCH_DRAFT_ENTRY' && entry.gitCommit === commit
      && entry.extensionVersion === binding.extensionVersion && entry.actualUi === true
      && entry.sourcePageTargetId === binding.sourcePageTargetId && entry.workbenchTargetId === binding.workbenchTargetId
      && ['snapshotId', 'collectId', 'shopId', 'draftId', 'revision', 'draftVersion'].every(key => entry[key] === binding[key])
      && (supplemented ? entry.noNewTabs === undefined && entry.erpPageOpened === undefined
        && entry.pagesBefore === undefined && entry.pagesAfter === undefined
        : entry.noNewTabs === true && entry.erpPageOpened === false
      && Array.isArray(entry.pagesBefore) && entry.pagesBefore.length > 0 && entry.pagesBefore.length <= 20
      && equal(entry.pagesBefore, entry.pagesAfter)
      && entry.pagesBefore.every(page => /^[0-9A-F]{32}$/u.test(page.id) && typeof page.url === 'string' && page.url.length <= 4096
        && !/^https:\/\/(?:app\.)?ss-erp\.(?:com|cn)(?:\/|$)/u.test(page.url))
      && new Set(entry.pagesBefore.map(page => page.id)).size === entry.pagesBefore.length
      && (supplemented || time(entry.at) >= time(offline.completedAt)
        && time(entry.at) <= time(binding.launchedAt))));
    if (supplemented) {
      const original = read(entry.rawReadback);
      const launch = read(entry.rawLaunch), captured = read(entry.rawTargets);
      check(original.observedAt === entry.at && time(entry.at) >= time(binding.launchedAt) && time(entry.at) <= time(start.at)
        && Array.isArray(original.result?.drafts) && original.result.drafts.some(draft => draft.id === binding.draftId
          && draft.shopId === binding.shopId && draft.revision === binding.revision && draft.draftVersion === binding.draftVersion));
      check(launch.observedAt === binding.launchedAt && launch.result?.physical === true
        && launch.result.selector === '#image-workflow-start-btn' && Number.isFinite(launch.result.x) && Number.isFinite(launch.result.y)
        && time(captured.observedAt) <= time(binding.launchedAt)
        && captured.targets?.page?.targetId === binding.sourcePageTargetId && captured.targets.page.type === 'page'
        && /^https:\/\/detail\.1688\.com\/offer\/[0-9]+\.html(?:\?|$)/u.test(captured.targets.page.url)
        && captured.targets.frame?.targetId === binding.workbenchTargetId && captured.targets.frame.type === 'iframe'
        && captured.targets.frame.parentFrameId === binding.sourcePageTargetId
        && /^chrome-extension:\/\/[a-p]{32}\/pages\/precision-workbench\.html$/u.test(captured.targets.frame.url));
    } else {
      const page = entry.pagesBefore.find(value => value.id === binding.sourcePageTargetId);
      check(page && /^https:\/\/detail\.1688\.com\/offer\/[0-9]+\.html(?:\?|$)/u.test(page.url));
    }
  }
  const suiteId = ui.suiteId, projection = ui.projection, slots = pair(projection?.suite?.slots), plan = projection.plan;
  if (supplemented) check(slots.every(slot => slot.reviewStatus === 'PENDING'));
  unique(slots.map(slot => slot.id)); unique(slots.map(slot => slot.slotKey)); unique(slots.map(slot => slot.workflowId));
  check(text(suiteId) && projection.executionMode === 'ERP_HOSTED' && projection.suite.id === suiteId
    && projection.suite.status === 'SUCCEEDED' && projection.suite.itemCount === 2 && ui.mutationPosts === 0
    && equal(slots.map(slot => slot.goal).sort(), ['scene', 'sku_hero'])
    && projection.sourceBinding?.snapshotId === binding.snapshotId && projection.sourceBinding.supplyGoodsId === binding.collectId
    && equal(projection.binding, { shopId: binding.shopId, workflowId: binding.draftId, draftRevision: binding.revision, draftVersion: binding.draftVersion })
    && text(plan?.id) && text(plan.versionId) && positive(plan.revision) && isSha256(plan.previewHash)
    && projection.quote?.currency === 'CNY' && projection.quote.itemCount === 2
    && projection.quote.estimatedCostCents === taskCost && projection.quote.maximumCostCents === taskCost
    && text(projection.quote.pricingVersion));
  for (const value of [ui, submitted, applied]) check(value.extensionVersion === binding.extensionVersion);
  check(submitted.gitCommit === commit && submitted.suiteId === suiteId && submitted.startExecutePosts === 1
    && submitted.continueExecutePosts === 1 && submitted.additionalStartPosts === 0
    && submitted.providerWorkDispatched === true && submitted.retryAllowed === false);
  const commandResponse = response => {
    success(response);
    const data = response.body.data;
    if (!isRecord(data?.receipt)) return data;
    check(data.replay === false && text(data.receipt.id) && text(data.receipt.grantId)
      && data.receipt.status === 'SUCCEEDED' && data.receipt.failureCode === null
      && time(data.receipt.createdAt) <= time(data.receipt.completedAt) && isRecord(data.receipt.result));
    return data.receipt.result;
  };
  const startResult = commandResponse(startResponse);
  check(startResult.action === 'START' && startResult.suiteId === suiteId
    && startResult.status === 'PLANNED' && startResult.revision === 1 && startResult.replayed === false);
  check(continueRequest.method === 'POST' && continueRequest.path === '/api/extension-device/media-workflows/execute'
    && continueRequest.body?.command?.version === 'extension-ai-image-suite-execute-command/v1'
    && continueRequest.body.command.action === 'CONTINUE' && continueRequest.body.command.suiteId === suiteId
    && continueRequest.body.command.expectedSuiteRevision === startResult.revision
    && continueRequest.body.workflowId === binding.draftId && continueRequest.body.draftVersion === binding.draftVersion
    && text(continueRequest.body.idempotencyKey));
  const continueResult = commandResponse(continueResponse);
  check(continueResult.action === 'CONTINUE' && continueResult.suiteId === suiteId
    && ['QUEUED', 'RUNNING', 'SUCCEEDED'].includes(continueResult.status)
    && positive(continueResult.revision) && continueResult.revision > startResult.revision
    && continueResult.replayed === false);
  check(start.method === 'POST' && start.path === '/api/extension-device/media-workflows/execute'
    && start.body?.shopId === binding.shopId && start.body.workflowId === binding.draftId && start.body.draftVersion === binding.draftVersion
    && text(start.body.idempotencyKey) && start.body.command?.version === 'extension-ai-image-suite-execute-command/v1'
    && start.body.command.action === 'START' && start.body.command.expectedPreviewHash === plan.previewHash
    && start.body.command.acceptedPricingVersion === projection.quote.pricingVersion
    && start.body.command.acceptedEstimatedCostCents === taskCost && start.body.command.acceptedMaximumCostCents === taskCost
    && start.body.command.snapshotId === binding.snapshotId && start.body.command.supplyGoodsId === binding.collectId
    && start.body.command.draftRevision === binding.revision && start.body.command.planId === plan.id
    && start.body.command.planVersionId === plan.versionId && start.body.command.planRevision === plan.revision);
  check((supplemented || time(offline.completedAt) <= time(binding.launchedAt)) && time(binding.launchedAt) <= time(start.at)
    && time(start.at) <= time(startResponse.at) && time(startResponse.at) <= time(continueRequest.at)
    && time(continueRequest.at) <= time(continueResponse.at) && time(continueResponse.at) <= time(submitted.at)
    && time(submitted.at) <= time(generated.observedAt));
  const verifyDerivedEvents = (database, row, slot, output) => {
    const events = row.workflow.events;
    check(Array.isArray(events) && events.length >= 7 && equal(row.workflow.eventTypes, events.map(event => event.eventType)));
    let previousAt = 0;
    for (const event of events) {
      const createdAt = time(event.createdAt);
      check(text(event.eventKey) && text(event.eventType) && isRecord(event.payload) && isSha256(event.payloadHash)
        && event.payloadHash === sha256(sortedJson(event.payload)) && createdAt >= previousAt && createdAt <= time(database.observedAt));
      previousAt = createdAt;
    }
    const succeeded = single(events.filter(event => event.eventType === 'JOB_SUCCEEDED'));
    const approved = single(events.filter(event => event.eventType === 'REVIEW_APPROVED'));
    const preview = previews.find(value => value.slotId === slot.id), review = reviews.find(value => value.slotId === slot.id);
    check(!events.some(event => event.eventType === 'REVIEW_REJECTED')
      && succeeded.jobId === row.job.id && succeeded.payload.outputAssetId === output.id
      && time(succeeded.createdAt) >= time(row.job.completedAt) && time(succeeded.createdAt) <= time(ui.at)
      && approved.jobId === row.job.id && approved.assetId === output.id
      && approved.payload.version === 'ai-image-suite-candidate-review/v1'
      && approved.payload.suiteId === ui.suiteId && approved.payload.slotId === slot.id
      && approved.payload.workflowId === row.workflow.id && approved.payload.jobId === row.job.id
      && approved.payload.outputAssetId === output.id && approved.payload.decision === 'APPROVE'
      && sha256(approved.payload.actorUserId) === owner && positive(approved.payload.expectedWorkflowRevision)
      && row.workflow.revision === approved.payload.expectedWorkflowRevision + 1
      && row.workflow.reviewStatus === 'APPROVED' && row.workflow.selectedOutputAssetId === output.id
      && preview && review && time(approved.createdAt) >= time(preview.at)
      && time(approved.createdAt) > time(ui.at) && time(approved.createdAt) <= time(review.at));
  };
  const originalRows = pair(generated.rows), restoredRows = pair(restored.rows), seenJobs = [], seenProviders = [], seenCharges = [], seenOutputs = [], seenReservations = [];
  const countRows = [];
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
        && job.operation === 'IMAGE_TO_IMAGE' && job.provider === provider && job.model === model
        && job.attemptCount === 1 && job.requestedImageCount === 1 && job.width === 900 && job.height === 1200
        && job.providerReconciliationStatus === 'NOT_REQUIRED' && isSha256(job.providerJobIdSha256)
        && job.actualCostCents === unitCost && job.billedUnits === 1 && job.errorCode === null
        && equal(job.pricing, { currency: 'CNY', unitCostCents: unitCost, requestedImageCount: 1, maximumCostCents: unitCost }));
      check((supplemented || time(job.startedAt) >= time(offline.completedAt)) && time(job.startedAt) >= time(start.at)
        && time(job.completedAt) > time(job.startedAt) && time(job.completedAt) <= time(database.observedAt));
      check(cost.status === 'SETTLED' && cost.currency === 'CNY' && cost.maximumCostMinor === unitCost && cost.settlementCount === 1
        && cost.jobIdSha256 === job.idSha256 && isSha256(cost.idSha256) && charge.kind === 'CHARGE' && charge.currency === 'CNY'
        && charge.actualCostMinor === unitCost && charge.billedUnits === 1 && charge.jobIdSha256 === job.idSha256 && isSha256(charge.chargeIdSha256));
      const slot = slots.find(slot => slot.workflowId === flow?.id), image = images.find(image => image.sha256 === output.sha256);
      check(slot && image && flow.idSha256 === sha256(flow.id) && flow.operation === 'IMAGE_TO_IMAGE' && flow.status === 'SUCCEEDED'
        && flow.contextType === 'collect' && flow.contextId === binding.collectId && flow.contextSlotKey === slot.slotKey
        && flow.reviewStatus === (phase === 'generated' && !derivedGeneratedPhase ? 'PENDING' : 'APPROVED')
        && flow.selectedOutputAssetId === (phase === 'generated' && !derivedGeneratedPhase ? null : output.id)
        && slot.status === 'SUCCEEDED' && slot.attempt === 1 && slot.output?.assetId === output.id
        && slot.output.width === 900 && slot.output.height === 1200);
      check(output.idSha256 === sha256(output.id) && output.jobIdSha256 === job.idSha256 && output.kind === 'AI_GENERATED'
        && output.width === image.width && output.height === image.height && output.mimeType === image.mimeType
        && output.sizeBytes === image.bytes && output.storageBackend === 'oss');
      if (countProfile) {
        const verified = verifyCountSuiteRecord(row, database, { rawImages, binding, suiteId, slot, quote: projection.quote, observedPortrait: sourcePageWorkflow });
        if (phase === 'generated') countRows.push(verified);
        else check(equal(originalRows.find(value => value.job.id === job.id)?.rawOutput, row.rawOutput)
          && equal(generated.suiteRuntime, database.suiteRuntime));
      }
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
        if (derivedGeneratedPhase) verifyDerivedEvents(database, row, slot, output);
        else check(!flow.eventTypes.includes('REVIEW_APPROVED') && !flow.eventTypes.includes('REVIEW_REJECTED'));
        seenJobs.push(job.id); seenProviders.push(job.providerJobIdSha256); seenCharges.push(charge.chargeIdSha256); seenOutputs.push(output.id); seenReservations.push(cost.idSha256);
        rows.push({ job, flow, output, slot, image });
      } else {
        const original = originalRows.find(value => value.job.id === job.id);
        check(original && equal(original.job, job) && equal(original.cost, cost) && equal(original.outputs, row.outputs)
          && equal(original.workflow.inputs, flow.inputs) && equal(original.workflow.inputAssets, flow.inputAssets)
          && flow.revision === original.workflow.revision + (derivedGeneratedPhase ? 0 : 1) && flow.eventTypes.includes('REVIEW_APPROVED')
          && !flow.eventTypes.includes('REVIEW_REJECTED'));
        if (derivedGeneratedPhase) {
          check(equal(flow.events, original.workflow.events));
          verifyDerivedEvents(database, row, slot, output);
        }
      }
    }
  }
  unique(seenJobs); unique(seenProviders); unique(seenCharges); unique(seenOutputs); unique(seenReservations);
  unique(restoredRows.map(row => row.job.id));
  if (countProfile) {
    check(equal(countRows[0].runtime, countRows[1].runtime) && countRows[0].referenceSetHash === countRows[1].referenceSetHash);
    unique(countRows.map(row => row.slotPromptId)); unique(countRows.map(row => row.raw.id));
    unique(countRows.map(row => row.raw.sha256));
  }
  check(rows.every(row => time(ui.at) >= time(row.job.completedAt)) && time(ui.at) <= time(applied.at)
    && (derivedGeneratedPhase
      ? time(applied.at) <= time(generated.observedAt) && time(generated.observedAt) <= time(restored.observedAt)
      : time(generated.observedAt) <= time(applied.at) && time(applied.at) <= time(restored.observedAt)));
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
  if (countProfile) {
    const request = read(manifest.replayRequest), response = read(manifest.replayResponse);
    success(response);
    check(request.method === applyRequest.method && request.path === applyRequest.path && equal(request.body, applyRequest.body)
      && response.body.data?.replayed === true && equal(response.body.data, { ...result, replayed: true })
      && time(request.at) >= time(applied.at) && time(response.at) >= time(request.at)
      && time(response.at) <= time(restored.observedAt) && time(response.at) <= time(queue.observedAt));
  }
  unique(items.map(item => item.suiteSlotId)); unique(returned.map(item => item.assignmentId));
  check(applyRequest.method === 'POST' && applyRequest.path === '/api/extension-device/source-workbench/ai-image-suite/listing-assignments'
    && command?.contractVersion === result.contractVersion && command.shopId === binding.shopId && command.listingWorkflowId === binding.draftId
    && command.expectedDraftRevision === before.revision && command.expectedDraftVersion === before.draftVersion
    && command.sourceCaptureSnapshotId === binding.snapshotId && command.assignmentStartOrdinal === before.media.assignments.length
      && command.planId === plan.id && command.planVersionId === plan.versionId && command.expectedPlanRevision === plan.revision
      && command.suiteId === suiteId && positive(command.expectedSuiteRevision) && text(command.idempotencyKey) && equal(command.items, items)
    && time(applyRequest.at) >= time(ui.at) && time(applyRequest.at) <= time(applied.at));
  if (derivedGeneratedPhase) {
    const verifyDatabaseHistory = database => {
      const versions = pair(database.draftVersions), beforeVersion = versions.find(value => value.revision === before.revision),
        afterVersion = versions.find(value => value.revision === after.revision);
      check(beforeVersion && afterVersion && beforeVersion.draftVersion === before.draftVersion
        && afterVersion.draftVersion === after.draftVersion && beforeVersion.parentRevision === null
        && afterVersion.parentRevision === before.revision && equal(beforeVersion.payload, before) && equal(afterVersion.payload, after)
        && beforeVersion.payloadHash === sha256(sourceDraftJson(beforeVersion.payload))
        && afterVersion.payloadHash === sha256(sourceDraftJson(afterVersion.payload))
        && time(beforeVersion.createdAt) <= time(binding.launchedAt)
        && time(afterVersion.createdAt) >= time(applyRequest.at) && time(afterVersion.createdAt) <= time(applied.at));
      const draft = database.draftSnapshot;
      check(draft?.id === binding.draftId && draft.currentRevision === after.revision
        && draft.currentDraftVersion === after.draftVersion && equal(draft.payload, after)
        && draft.payloadHash === afterVersion.payloadHash && database.ozonPublishAttempts === 0);
      const persisted = pair(database.listingAssignments);
      unique(persisted.map(value => value.assignmentId));
      for (const [index, item] of items.entries()) {
        const receipt = returned[index], row = rows.find(value => value.flow.id === item.childWorkflowId),
          assignment = persisted.find(value => value.assignmentId === receipt.assignmentId);
        check(row && assignment && assignment.batchId === result.batchId && assignment.batchItemOrdinal === index
          && assignment.listingWorkflowId === binding.draftId && assignment.skuKey === item.skuKey
          && assignment.slotKey === item.slotKey && assignment.assignmentScope === receipt.assignmentScope
          && assignment.assignmentOrdinal === before.media.assignments.length + index
          && assignment.assetId === item.outputAssetId && assignment.assetSha256 === row.output.sha256
          && assignment.suiteSlotId === item.suiteSlotId && assignment.childWorkflowId === item.childWorkflowId
          && assignment.jobId === row.job.id && assignment.sourceDraftRevision === before.revision
          && assignment.sourceDraftVersion === before.draftVersion && assignment.boundDraftRevision === after.revision
          && assignment.boundDraftVersion === after.draftVersion);
      }
    };
    verifyDatabaseHistory(generated); verifyDatabaseHistory(restored);
    check(equal(generated.draftVersions, restored.draftVersions)
      && equal(generated.draftSnapshot, restored.draftSnapshot)
      && equal(generated.listingAssignments, restored.listingAssignments));
  }
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
      && (derivedGeneratedPhase || time(review.at) >= time(generated.observedAt)) && time(review.at) <= time(applyRequest.at));
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
    && queue.queueName === 'ai-image-suite-generation'
    && time(queue.observedAt) >= time(derivedGeneratedPhase ? applied.at : generated.observedAt) && time(queue.observedAt) <= time(now));
  const removedCompletedJobs = explicitExecution && queue.retentionPolicy === 'REMOVE_ON_COMPLETE';
  check(Array.isArray(queue.jobs) && (removedCompletedJobs ? queue.jobs.length === 0 : queue.jobs.length === 2));
  pair(queue.slots); unique(queue.jobs.map(job => job.id)); unique(queue.slots.map(slot => slot.id));
  if (removedCompletedJobs) check(queue.allCompleted === true);
  for (const { job, flow, slot } of rows) {
    const payload = { suiteId, slotId: slot.id, workflowId: flow.id, jobId: job.id, attempt: 1 };
    const id = 'suite-generate-' + sha256(JSON.stringify(['ai-image-suite-generation/v1', suiteId, slot.id, flow.id, job.id, 1]));
    const queued = queue.jobs.find(value => value.id === id), observedSlot = queue.slots.find(value => value.id === slot.id);
    if (removedCompletedJobs) check(queued === undefined);
    else check(queued && queued.name === 'generate-suite-slot' && queued.state === 'completed' && equal(queued.payload, payload)
      && queued.attemptsMade === 1 && queued.attemptsStarted === 1 && positive(queued.processedOn) && positive(queued.finishedOn)
      && (supplemented || queued.processedOn >= time(offline.completedAt)) && queued.processedOn <= time(job.startedAt)
      && queued.finishedOn >= time(job.completedAt) && queued.finishedOn <= time(queue.observedAt));
    check(observedSlot?.suiteId === suiteId && observedSlot.childWorkflowId === flow.id && observedSlot.attempt === 1
      && observedSlot.status === 'SUCCEEDED' && observedSlot.slotKey === slot.slotKey && observedSlot.ownerSha256 === owner);
  }
  const supplementalProof = supplemented ? verifySupplementedControl(read, reader, controller,
    { commit, input, binding, start, applied, restored, generated, now, offline, browser }) : null;
  if (supplemented) {
    check(supplementalProof.currentPilotVerified && supplementalProof.currentCandidateNavigationVerified);
  } else if (explicitExecution && controller?.kind === 'SS_ERP_RESTRICTED_PILOT_EXECUTION_CONTROL') {
    const expectedPending = { jobs: 0, costs: 0, recovery: 0, workflows: 0, suites: 0 };
    const targetCleanup = controller.schemaVersion === 2;
    const cleanupCommit = targetCleanup ? input.targetGitCommit : commit;
    const pilot = (value, runtimeCommit) => {
      const shops = value?.result?.shopIds;
      check(Array.isArray(shops) && shops.length > 0 && shops.length <= 50
        && shops.every(shop => typeof shop === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(shop))
        && new Set(shops).size === shops.length && shops.includes(binding.shopId));
      check(value?.kind === 'SS_ERP_CURRENT_HOSTED_PILOT_RUNTIME_ACCEPTANCE' && value.gitCommit === runtimeCommit
        && /^\d+\.\d+\.\d+$/u.test(value.version) && value.region === 'COM'
        && value.providerRequests === 0 && value.ozonWrites === 0 && value.result?.expectation === 'hosted-pilot'
        && value.result.ownerSha256 === owner
        && positive(value.result.deviceCount) && (sourcePageWorkflow ? isApprovedAiMediaHostedPublicationOperations(value.result.allowedOperations)
          : isRestrictedAiMediaHostedPilotOperations(value.result.allowedOperations))
        && positive(value.result.rolloutRevision) && text(value.result.sourcePolicyRevision));
      return value;
    };
    const beforePilot = pilot(controller.before, commit), afterPilot = pilot(controller.after, cleanupCommit);
    // Account/device sessions may expire or be revoked between execution and a
    // later maintenance readback. Keep every authority field identical and
    // reject growth; the original execution controller remains exact.
    const pilotAuthority = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'deviceCount'));
    const samePilot = targetCleanup
      ? afterPilot.result.deviceCount <= beforePilot.result.deviceCount
        && equal(pilotAuthority(beforePilot.result), pilotAuthority(afterPilot.result))
      : equal(beforePilot.result, afterPilot.result);
    check((controller.schemaVersion === 1 || targetCleanup) && controller.gitCommit === cleanupCommit && controller.version === afterPilot.version
      && controller.region === 'COM' && controller.ownerSha256 === owner && controller.currency === 'CNY'
      && controller.maximumTaskCostCents === taskCost && controller.configurationChanged === false
      && equal(controller.pending, expectedPending)
      && samePilot
      && time(beforePilot.observedAt) <= time(binding.launchedAt)
      && time(afterPilot.observedAt) >= time(applied.at));
    if (countProfile) check((controller.schemaVersion === 1 || targetCleanup) && controller.unitCostCents === unitCost
      && controller.providerProfile === COUNT_SUITE_PROFILE);
    if (countProfile && targetCleanup) {
      check(isRecord(controller.executionControl));
      const original = read(controller.executionControl);
      check(original.schemaVersion === 1 && original.kind === controller.kind && original.gitCommit === commit
        && original.version === binding.extensionVersion && original.ownerSha256 === owner && original.region === 'COM'
        && original.currency === 'CNY' && original.unitCostCents === unitCost && original.maximumTaskCostCents === taskCost
        && original.providerProfile === COUNT_SUITE_PROFILE && original.configurationChanged === false
        && equal(original.pending, expectedPending) && equal(original.before, controller.before));
      const originalAfter = pilot(original.after, commit);
      check(equal(originalAfter.result, controller.before.result)
        && time(originalAfter.observedAt) >= time(applied.at) && time(originalAfter.observedAt) <= time(browser.completedAt)
        && time(afterPilot.observedAt) >= time(originalAfter.observedAt));
    }
    if (targetCleanup) {
      check(controller.executionGitCommit === commit);
      // Later maintenance is evidence about the current runtime, never a
      // relabeling of the original suite, review, settlement or browser action.
      verifySource(commit, cleanupCommit);
      const pending = read(controller.pendingReadback), final = read(controller.finalReadback);
      check(pending.kind === 'REAL_HOSTED_SUITE_PENDING_READBACK' && pending.caseId === 'suite'
        && pending.phase === 'pending' && pending.gitCommit === cleanupCommit
        && pending.readbackRuntimeCommit === cleanupCommit && pending.readOnly === true
        && pending.ownerSha256 === owner && pending.databaseId === 'production-com-primary'
        && equal(pending.pending, expectedPending)
        && time(afterPilot.observedAt) <= time(pending.observedAt) && time(pending.observedAt) <= time(now));
      check(final.kind === 'REAL_ERP_JOB_DATABASE_READBACK' && final.caseId === 'suite'
        && final.gitCommit === cleanupCommit && final.readbackRuntimeCommit === cleanupCommit && final.readOnly === true
        && time(pending.observedAt) <= time(final.observedAt) && time(final.observedAt) <= time(now));
      const originalState = value => Object.fromEntries(Object.entries(value)
        .filter(([key]) => !['gitCommit', 'readbackRuntimeCommit', 'observedAt'].includes(key)));
      check(equal(originalState(final), originalState(restored)));
    } else {
      check(time(afterPilot.observedAt) <= time(restored.observedAt));
    }
  } else {
    check(!countProfile);
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
  }
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
    && time(browser.startedAt) <= time(binding.launchedAt)
    && time(browser.completedAt) >= time(derivedGeneratedPhase ? applied.at : restored.observedAt) && time(browser.completedAt) <= time(now));
  const sourceBridge = verifySource(commit, input.targetGitCommit);
  if (reusingCountSuite) {
    const code = 'QA04_SUITE_REUSE_INVALID';
    exactKeys(input.suiteReuse, ['currentRuntime', ...(sourceBridge.requiresFreshTargetUiVerification ? ['currentUi'] : [])], code);
    const reference = input.suiteReuse.currentRuntime, current = reader.json(reference, code, { nativeCompact: true });
    exactKeys(current, ['schemaVersion', 'kind', 'gitCommit', 'observedAt', 'readOnly', 'databaseReadOnly',
      'configured', 'executionReady', 'testOnly', 'providerRequests', 'ozonWrites', 'providerConfig'], code);
    const currentTime = canonicalTimestamp(current.observedAt, code);
    const targetOffline = reader.json(input.offline.receipt, code);
    requireThat(current.schemaVersion === 1 && current.kind === 'SS_ERP_HOSTED_SUITE_CURRENT_RUNTIME'
      && current.gitCommit === input.targetGitCommit && current.readOnly === true && current.databaseReadOnly === true
      && current.configured === true && current.executionReady === true && current.testOnly === false
      && current.providerRequests === 0 && current.ozonWrites === 0
      && currentTime >= canonicalTimestamp(targetOffline.completedAt, code)
      && currentTime <= time(now) && time(now) - currentTime <= 60 * 60 * 1000, code);
    const suite = generated.suiteRuntime;
    const expectedConfig = Object.fromEntries(Object.entries(suite)
      .filter(([key]) => !['itemCount', 'estimatedCostCents', 'maximumCostCents'].includes(key)));
    requireThat(equal(current.providerConfig, expectedConfig), code);
    sourceBridge.currentRuntime = { receiptSha256: reference.sha256, observedAt: current.observedAt,
      providerConfigHash: current.providerConfig.providerConfigHash, pricingVersion: current.providerConfig.pricingVersion };
    if (sourceBridge.requiresFreshTargetUiVerification) sourceBridge.currentUi = verifyCurrentSuiteUiEvidence(reader,
      input.suiteReuse.currentUi, sourceBridge, targetOffline.completedAt, now);
  }
  return { executionCommit: commit, completedAt: browser.completedAt, operation: 'IMAGE_TO_IMAGE', workflowKind: 'SUITE',
    provider, model, currency: 'CNY', unitCostMinor: unitCost,
    successfulImages: 2, actualCostMinor: taskCost, chargeCount: 2, applicationCount: 2, originalImagePreserved: true,
    ...(countProfile ? { providerProfile: COUNT_SUITE_PROFILE, verifiedIdempotencyReplay: true } : {}),
    ...(sourcePageWorkflow ? { sourcePageWorkflowVerified: !supplemented } : {}),
    ...(supplementalProof ?? {}),
    configurationRestored: true, image: images[0], images, source, sourceBridge, targetUiProductionVerified: false, verifiedSuiteBrowser: true,
    sourceSha256: source.sha256, referenceSha256: reference.sha256,
    ...(derivedGeneratedPhase ? { generatedPhaseEvidence: manifest.databaseEvidenceMode } : {}),
    ...(executionOffline ? { executionOfflineQa04: { gitCommit: executionCommit,
      receiptSha256: executionOfflineRefs.receipt.sha256, logSha256: executionOfflineRefs.log.sha256,
      startedAt: executionOffline.receipt.startedAt, completedAt: executionOffline.receipt.completedAt } } : {}),
    evidence: { ...Object.fromEntries(Object.entries(refs).map(([key, ref]) => [`${key}Sha256`, ref.sha256])),
      ...Object.fromEntries(Object.entries(manifest).filter(([, value]) => isRecord(value) && isSha256(value.sha256)).map(([key, ref]) => [`${key}Sha256`, ref.sha256])),
      previewSha256: manifest.previews.map(ref => ref.sha256), reviewSha256: manifest.reviews.map(ref => ref.sha256),
      startResponseSha256: manifest.startResponse.sha256, continueRequestSha256: manifest.continueRequest.sha256,
      continueResponseSha256: manifest.continueResponse.sha256,
      ...(countProfile ? { rawProviderImageSha256: manifest.rawProviderImages.map(ref => ref.sha256) } : {}) } };
}
