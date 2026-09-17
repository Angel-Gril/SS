#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { writeNewArtifactDurably } from './extension-release-artifact.mjs';
import { gitCommitTreeEnvironment, gitCommitTreeSafeDirectoryArgs } from './git-commit-tree.mjs';
import { QA04_OFFLINE_STEPS, parseQa04OfflineEvidence, readQa04GitProvenance } from './qa04-offline-gate.mjs';
import {
  canonicalJson, canonicalTimestamp, evidenceReader, exactKeys, fail, isCommit, isRecord,
  isSha256, isWithin, pngEvidence, privateOutputPath, realDirectory, requireThat, sha256, sortedJson,
} from './qa04-final-evidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE = 'NORMAL_AI_TECHNICAL_AND_CONFIRMED_PRICE_V1';
const OPERATIONS = ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'];
const PROFILES = ['OZON_PORTRAIT_SINGLE_V1', 'DASHSCOPE_WANX21_IMAGE_TO_IMAGE_ASYNC_V1',
  'DASHSCOPE_WANX21_FULL_EDIT_ASYNC_V1', 'DASHSCOPE_WANX21_INPAINT_ASYNC_V1'];
const GATES = ['QA04_OFFLINE_CONTRACT', 'GIT_DIFF_CHECK', 'WORKSPACE_LINT', 'WORKSPACE_TYPECHECK',
  'FULL_PREFLIGHT_BUILD', 'SCOPE_REVOCATION_POSTGRES', 'AI_MEDIA_POSTGRES', 'EXTENSION_CLOUD', 'EXTENSION_LOCAL'];
const ERP_TREES = ['apps/server', 'packages/shared', 'pnpm-lock.yaml', 'tsconfig.base.json', 'pnpm-workspace.yaml'];
const OPTIONAL_DEPENDENCY_TREES = ['.npmrc', '.pnpmfile.cjs', 'patches'];
const QA04_SCRIPT_REGISTRATIONS = {
  'qa:04:final': 'node scripts/qa04-final-acceptance.mjs',
  'test:qa04:final': 'node --test scripts/qa04-final-acceptance.test.mjs',
};
const equal = (left, right) => sortedJson(left) === sortedJson(right);
const boundedText = value => typeof value === 'string' && value.length > 0 && value.length <= 2048
  && [...value].every(character => character.charCodeAt(0) >= 32);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

function scoped(code, action) {
  try { return action(); }
  catch (error) {
    if (error.code?.startsWith('QA04_')) throw error;
    fail(code);
  }
}

function validateInput(value) {
  exactKeys(value, ['schemaVersion', 'kind', 'scope', 'targetGitCommit', 'offline', 'technical', 'counterexamples', 'normalErp']);
  requireThat(value.schemaVersion === 1 && value.kind === 'SS_ERP_QA04_FINAL_INPUTS'
    && value.scope === SCOPE && isCommit(value.targetGitCommit), 'QA04_INPUT_INVALID');
  exactKeys(value.offline, ['receipt', 'log']);
  exactKeys(value.normalErp, ['acceptance', 'generated', 'applied', 'restored', 'controllerStatus', 'image']);
  requireThat(Array.isArray(value.technical) && value.technical.length === 4
    && equal(value.technical.map(row => row.operation).sort(), [...OPERATIONS].sort())
    && Array.isArray(value.counterexamples) && value.counterexamples.length >= 2
    && value.counterexamples.length <= 24, 'QA04_INPUT_INVALID');
  for (const row of value.technical) {
    const keys = ['operation', 'report', 'intent', 'approval', 'image', ...(row.operation === 'TEXT_TO_IMAGE'
      ? ['observation'] : ['asyncEvidence', 'technicalReview', 'humanConfirmation', 'source'])];
    if (row.operation === 'INPAINT') keys.push('mask');
    exactKeys(row, keys);
  }
  for (const row of value.counterexamples) exactKeys(row, ['report', 'review']);
  return value;
}

function gitRunner(root) {
  return (command, args, options) => spawnSync(command, [...gitCommitTreeSafeDirectoryArgs(root), ...args], {
    ...options, env: gitCommitTreeEnvironment(), shell: false, windowsHide: true,
    timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
  });
}

function provenance(root, expectedCommit) {
  return scoped('QA04_SOURCE_INVALID', () => {
    const result = readQa04GitProvenance({ repositoryRoot: root, runner: gitRunner(root) });
    requireThat(result.gitCommit === expectedCommit, 'QA04_SOURCE_INVALID');
    return result;
  });
}

function verifyOffline(reader, input, now) {
  return scoped('QA04_OFFLINE_INVALID', () => {
    const code = 'QA04_OFFLINE_INVALID';
    const receipt = parseQa04OfflineEvidence(reader.json(input.offline.receipt, code), input.targetGitCommit, now);
    const durationSeconds = (Date.parse(receipt.completedAt) - Date.parse(receipt.startedAt)) / 1000;
    requireThat(durationSeconds > 0, code);
    const bytes = reader.read(input.offline.log, 64 * 1024 * 1024);
    const log = stripVTControlCharacters(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).replace(/\r\n/gu, '\n');
    requireThat(log.split('\n').filter(line => line === 'QA-04 offline rehearsal').length === 1
      && log.split('\n').filter(line => line.startsWith('Git commit: ')).length === 1
      && log.includes(`\nGit commit: ${input.targetGitCommit}\n`), code);
    const markers = [...log.matchAll(/^\[qa04-offline\] (.*)$/gmu)];
    requireThat(markers.length === QA04_OFFLINE_STEPS.length + 1
      && markers.at(-1)[1] === 'all offline rehearsal checks passed', code);
    const extensionVerification = {};
    for (let index = 0; index < QA04_OFFLINE_STEPS.length; index++) {
      const step = QA04_OFFLINE_STEPS[index];
      requireThat(markers[index][1] === step.name, code);
      const segment = log.slice(markers[index].index, markers[index + 1].index);
      requireThat(segment.split('\n')[1] === `$ ${[step.command, ...step.args].join(' ')}`, code);
      const target = { 'preflight-build': 'source', 'extension-cloud': 'cloud', 'extension-local': 'local' }[step.id];
      if (target) {
        const summaries = [...segment.matchAll(/^=== Result: (\d+) failure\(s\), (\d+) warning\(s\), (\d+) pass\(es\) ===$/gmu)];
        requireThat(summaries.length === 1, code);
        const [, failures, warnings, passed] = summaries[0];
        const result = { passed: Number(passed), failures: Number(failures), warnings: Number(warnings) };
        requireThat(positiveInteger(result.passed) && result.failures === 0
          && Number.isSafeInteger(result.warnings) && result.warnings >= 0, code);
        extensionVerification[target] = result;
      }
    }
    return { receipt, durationSeconds, extensionVerification };
  });
}

function verifyApproval(approval, report, intent, row, code) {
  requireThat(approval.schemaVersion === 3
    && approval.statement === 'I_APPROVE_EXACTLY_ONE_PAID_AI_IMAGE_REQUEST' && approval.requestCount === 1, code);
  for (const key of ['operationId', 'operation', 'model', 'requestProfile', 'credentialRevision', 'adapterRevision',
    'sourceSha256', 'maskSha256', 'quotedCost', 'maximumCost']) requireThat(equal(approval[key], report[key]), code);
  const evidence = report.approvalEvidence;
  requireThat(evidence?.approvalSha256 === row.approval.sha256 && evidence.approvalId === approval.approvalId
    && evidence.approvedAt === approval.approvedAt && evidence.expiresAt === approval.expiresAt
    && evidence.currency === report.quotedCost.currency && equal(intent.request.approvalEvidence, evidence), code);
  for (const key of ['approverRef', 'providerAccountRef', 'pricingRevision', 'preCallBillingSnapshotRef', 'billingReconciliationRef']) {
    requireThat(boundedText(approval[key]) && evidence[`${key}Sha256`] === sha256(approval[key]), code);
  }
  const endpoint = new URL(approval.endpoint);
  requireThat(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash
    && endpoint.hostname === approval.expectedHost && sha256(approval.endpoint) === report.operationEndpointSha256, code);
  requireThat(canonicalTimestamp(approval.approvedAt, code) <= canonicalTimestamp(intent.createdAt, code)
    && Date.parse(intent.createdAt) <= Date.parse(report.startedAt)
    && canonicalTimestamp(approval.expiresAt, code) >= Date.parse(report.startedAt), code);
}

function reportIdentity(report, code) {
  requireThat(report.schemaVersion === 5 && report.state === 'SUCCEEDED' && boundedText(report.operationId)
    && OPERATIONS.includes(report.operation) && isCommit(report.adapterRevision) && boundedText(report.credentialRevision)
    && isSha256(report.apiBaseSha256) && isSha256(report.operationEndpointSha256) && isSha256(report.promptSha256)
    && isSha256(report.providerRequestIdHash) && isSha256(report.sha256) && report.createRequests === 1 && report.imageCount === 1
    && report.mimeType === 'image/png' && positiveInteger(report.bytes), code);
  const text = report.operation === 'TEXT_TO_IMAGE';
  requireThat(report.provider === (text ? 'custom-openai-compatible' : 'dashscope-wanx21-image-edit')
    && report.model === (text ? 'gpt-image-2' : 'wanx2.1-imageedit')
    && report.requestProfile === PROFILES[OPERATIONS.indexOf(report.operation)]
    && report.width === 1024 && report.height === (text ? 1536 : 1024)
    && report.requestedSize === `${report.width}x${report.height}`, code);
  requireThat(canonicalTimestamp(report.startedAt, code) < canonicalTimestamp(report.completedAt, code)
    && report.elapsedMs === Date.parse(report.completedAt) - Date.parse(report.startedAt), code);
  requireThat(Array.isArray(report.sourceSha256) && report.sourceSha256.length === (text ? 0 : 1)
    && report.sourceSha256.every(isSha256) && (report.operation === 'INPAINT'
      ? isSha256(report.maskSha256) : report.maskSha256 === null), code);
}

function imageMatches(image, metadata, sizeKey, code) {
  requireThat(image.sha256 === metadata.sha256 && image.width === metadata.width && image.height === metadata.height
    && image.bytes === metadata[sizeKey] && image.mimeType === metadata.mimeType, code);
}

function verifyTechnical(reader, row, now) {
  return scoped('QA04_TECHNICAL_INVALID', () => {
    const code = 'QA04_TECHNICAL_INVALID', report = reader.json(row.report, code), intent = reader.json(row.intent, code);
    const approval = reader.json(row.approval, code), request = intent.request;
    reportIdentity(report, code);
    requireThat(report.operation === row.operation && Date.parse(report.completedAt) <= Date.parse(now)
      && intent.schemaVersion === 3 && intent.state === 'SUBMITTING' && intent.operationId === report.operationId
      && intent.endpointSha256 === report.operationEndpointSha256 && intent.apiBaseSha256 === report.apiBaseSha256
      && intent.model === report.model && intent.credentialRevision === report.credentialRevision
      && intent.adapterRevision === report.adapterRevision && equal(intent.quotedCost, report.quotedCost)
      && equal(intent.maximumCost, report.maximumCost), code);
    for (const key of ['operation', 'requestProfile', 'promptSha256', 'sourceSha256', 'maskSha256']) {
      requireThat(equal(request[key], report[key]), code);
    }
    // Schema-3 sandbox intent audits also contain dimensions and approval fields.
    // Its historical fingerprint uses sanitizeSandboxRequest().fingerprint in
    // ai-image-sandbox-guard.ts, not that larger audit object.
    const fingerprintRequest = {
      ...(report.operation === 'TEXT_TO_IMAGE' ? {} : {
        operation: report.operation, requestProfile: report.requestProfile,
        providerTransport: 'DASHSCOPE_WANX21_ASYNC_JSON_DATA_URL_V1',
        providerFunction: report.operation === 'INPAINT' ? 'description_edit_with_mask' : 'description_edit',
      }),
      n: 1, size: request.size, promptSha256: request.promptSha256,
      sourceSha256: request.sourceSha256, maskSha256: request.maskSha256,
    };
    requireThat(request.n === 1 && request.width === report.width && request.height === report.height
      && request.size === report.requestedSize && intent.requestFingerprint === sha256(sortedJson({
        endpointSha256: intent.endpointSha256, model: intent.model, request: fingerprintRequest,
      })), code);
    verifyApproval(approval, report, intent, row, code);
    const image = pngEvidence(reader, row.image, code);
    imageMatches(image, report, 'bytes', code);
    const refs = Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'operation').map(([key, ref]) => [`${key}Sha256`, ref.sha256]));
    let qualityBasis, historicalBilling;
    if (row.operation === 'TEXT_TO_IMAGE') {
      requireThat(equal(request.sourceDimensions, []) && request.maskDimensions === null, code);
      const observation = reader.json(row.observation, code);
      requireThat(observation.schemaVersion === 1 && observation.kind === 'PRIVATE_PROVIDER_PILOT_OBSERVATION_NOT_SETTLEMENT'
        && observation.operationId === report.operationId && observation.submitReportSha256 === row.report.sha256
        && observation.intentSha256 === row.intent.sha256 && observation.approvalSha256 === row.approval.sha256
        && observation.requestFingerprint === intent.requestFingerprint && observation.technicalState === 'SUCCEEDED'
        && observation.createRequests === 1 && observation.imageCount === 1 && boundedText(observation.visualReview)
        && isRecord(observation.billing) && boundedText(observation.billing.status), code);
      imageMatches(image, observation.image, 'bytes', code);
      requireThat(canonicalTimestamp(observation.recordedAt, code) >= Date.parse(report.completedAt)
        && Date.parse(observation.recordedAt) <= Date.parse(now), code);
      qualityBasis = 'RECORDED_VISUAL_OBSERVATION';
      historicalBilling = {
        status: observation.billing.status,
        perRequestLimitExceededByLog: observation.billing.perRequestLimitExceededByLog === true,
        actualCost: report.actualCost,
      };
    } else {
      const source = pngEvidence(reader, row.source, code);
      requireThat(equal(report.sourceSha256, [source.sha256])
        && equal(request.sourceDimensions, [{ width: source.width, height: source.height }]), code);
      if (row.operation === 'INPAINT') {
        const mask = pngEvidence(reader, row.mask, code);
        requireThat(report.maskSha256 === mask.sha256 && mask.width === source.width && mask.height === source.height
          && equal(request.maskDimensions, { width: mask.width, height: mask.height }), code);
      } else requireThat(request.maskDimensions === null, code);
      const async = reader.json(row.asyncEvidence, code), review = reader.json(row.technicalReview, code);
      const human = reader.json(row.humanConfirmation, code);
      for (const key of ['operationId', 'operation', 'provider', 'model', 'requestProfile', 'adapterRevision',
        'apiBaseSha256', 'operationEndpointSha256', 'sourceSha256', 'maskSha256']) requireThat(equal(async[key], report[key]), code);
      requireThat(async.schemaVersion === 1 && async.requestFingerprint === intent.requestFingerprint
        && async.transport === 'DASHSCOPE_WANX21_ASYNC_JSON_DATA_URL_V1'
        && async.providerFunction === (row.operation === 'INPAINT' ? 'description_edit_with_mask' : 'description_edit')
        && async.providerOutcome === 'SUCCEEDED' && async.state === 'ACCEPTED' && async.createRequests === 1
        && positiveInteger(async.pollRequests) && async.resultDownloads === 1 && async.providerStatus === 'SUCCEEDED'
        && async.usage?.imageCount === 1 && async.providerTaskIdHash === report.providerRequestIdHash, code);
      requireThat(review.schemaVersion === 1 && review.event === 'AI_IMAGE_PROVIDER_EDIT_CAPABILITY_TECHNICAL_REVIEW'
        && review.reportSha256 === row.report.sha256 && review.asyncEvidenceSha256 === row.asyncEvidence.sha256
        && review.sourceImageSha256 === source.sha256 && review.outputImageSha256 === image.sha256, code);
      for (const key of ['operationId', 'operation', 'provider', 'model', 'requestProfile']) requireThat(review[key] === report[key], code);
      requireThat(review.output?.width === image.width && review.output.height === image.height
        && review.output.byteLength === image.bytes && review.output.mimeType === image.mimeType, code);
      if (row.operation === 'INPAINT') requireThat(review.originalMaskSha256 === row.mask.sha256
        && isSha256(async.transportMaskSha256) && review.transportMaskSha256 === async.transportMaskSha256, code);
      else requireThat(async.transportMaskSha256 === null, code);
      requireThat(human.schemaVersion === 1 && human.event === 'AI_IMAGE_PROVIDER_EDIT_CAPABILITY_HUMAN_QUALITY_CONFIRMATION'
        && human.operationId === report.operationId && human.operation === report.operation && human.decision === 'APPROVED'
        && human.confirmationScope === 'IMAGE_QUALITY_ONLY' && human.billingDecision === 'NOT_ATTESTED'
        && human.reportSha256 === row.report.sha256 && human.technicalReviewSha256 === row.technicalReview.sha256
        && human.outputImageSha256 === image.sha256, code);
      requireThat(canonicalTimestamp(review.reviewedAt, code) >= Date.parse(report.completedAt)
        && canonicalTimestamp(human.confirmedAt, code) >= Date.parse(review.reviewedAt)
        && Date.parse(human.confirmedAt) <= Date.parse(now), code);
      qualityBasis = 'HISTORICAL_HUMAN_CONFIRMATION';
      requireThat(boundedText(review.billingStatus), code);
      historicalBilling = { status: review.billingStatus, billingDecision: human.billingDecision, actualCost: report.actualCost };
    }
    return {
      operation: report.operation, operationId: report.operationId, provider: report.provider, model: report.model,
      requestProfile: report.requestProfile, adapterRevision: report.adapterRevision, credentialRevision: report.credentialRevision,
      apiBaseSha256: report.apiBaseSha256, operationEndpointSha256: report.operationEndpointSha256,
      requestFingerprint: intent.requestFingerprint, promptSha256: report.promptSha256, sourceSha256: report.sourceSha256,
      maskSha256: report.maskSha256, completedAt: report.completedAt, image, qualityBasis, historicalBilling, evidence: refs,
    };
  });
}

function verifyCounterexamples(reader, rows, technical, now) {
  return scoped('QA04_COUNTEREXAMPLE_INVALID', () => {
    const code = 'QA04_COUNTEREXAMPLE_INVALID', seen = new Set();
    const results = rows.map(row => {
      const report = reader.json(row.report, code), review = reader.json(row.review, code);
      reportIdentity(report, code);
      const positive = technical.find(item => item.operation === report.operation);
      requireThat(['FULL_EDIT', 'INPAINT'].includes(report.operation) && !seen.has(report.operationId)
        && report.operationId !== positive.operationId && Date.parse(report.completedAt) > Date.parse(positive.completedAt)
        && Date.parse(report.completedAt) <= Date.parse(now), code);
      seen.add(report.operationId);
      const imageHash = review.resultSha256 ?? review.rawProviderImageSha256 ?? review.rawImageSha256;
      requireThat(review.schemaVersion === 1 && imageHash === report.sha256
        && (review.operationId === undefined || review.operationId === report.operationId)
        && (review.reportSha256 === undefined || review.reportSha256 === row.report.sha256)
        && (review.sourceSha256 === undefined || equal([review.sourceSha256], report.sourceSha256))
        && (review.alphaMaskSha256 === undefined || review.alphaMaskSha256 === report.maskSha256)
        && (review.providerTaskIdHash === undefined || review.providerTaskIdHash === report.providerRequestIdHash)
        && (review.technicalState ?? review.technicalOutcome) === 'SUCCEEDED'
        && (review.requestedQualityState === 'NOT_ACCEPTED' || review.decision === 'REJECTED'
          || review.visualReview?.outcome === 'REJECTED')
        && review.requestedQualityState !== 'ACCEPTED' && review.decision !== 'APPROVED'
        && review.capabilityPromoted !== true, code);
      return { operation: report.operation, operationId: report.operationId, requestProfile: report.requestProfile,
        adapterRevision: report.adapterRevision, credentialRevision: report.credentialRevision,
        promptSha256: report.promptSha256, sourceSha256: report.sourceSha256, maskSha256: report.maskSha256,
        outputSha256: report.sha256, completedAt: report.completedAt, technicalState: 'SUCCEEDED', qualityState: 'REJECTED',
        reportSha256: row.report.sha256, reviewSha256: row.review.sha256 };
    });
    requireThat(['FULL_EDIT', 'INPAINT'].every(operation => results.some(row => row.operation === operation)), code);
    return results;
  });
}

function verifyErpSource(root, executionCommit, targetCommit) {
  return scoped('QA04_ERP_SOURCE_CHANGED', () => {
    const code = 'QA04_ERP_SOURCE_CHANGED', run = gitRunner(root);
    const git = args => {
      const result = run('git', args, { cwd: root, encoding: 'utf8' });
      requireThat(!result.error && result.status === 0, code);
      return result.stdout;
    };
    requireThat(isCommit(executionCommit), code);
    const objects = commit => {
      requireThat(git(['rev-parse', '--verify', `${commit}^{commit}`]).trim() === commit, code);
      const output = git(['ls-tree', '-z', commit, '--', ...ERP_TREES, ...OPTIONAL_DEPENDENCY_TREES]);
      return Object.fromEntries(output.split('\0').filter(Boolean).map(line => {
        const match = line.match(/^(040000 tree|100644 blob|100755 blob) ([a-f0-9]{40})\t(.+)$/u);
        requireThat(Boolean(match), code);
        return [match[3], { mode: match[1], objectId: match[2] }];
      }));
    };
    const before = objects(executionCommit), after = objects(targetCommit);
    requireThat(ERP_TREES.every(name => before[name] && after[name]) && equal(before, after), code);
    const rootDependencies = commit => {
      const manifest = JSON.parse(git(['show', `${commit}:package.json`]));
      requireThat(isRecord(manifest) && isRecord(manifest.scripts), code);
      for (const [name, command] of Object.entries(QA04_SCRIPT_REGISTRATIONS)) {
        requireThat(manifest.scripts[name] === undefined || manifest.scripts[name] === command, code);
        delete manifest.scripts[name];
      }
      return manifest;
    };
    const original = rootDependencies(executionCommit), current = rootDependencies(targetCommit);
    requireThat(equal(original, current), code);
    return { kind: 'IDENTICAL_ERP_SOURCE_AND_DEPENDENCIES', objects: before,
      rootPackageWithoutQa04RegistrationsSha256: sha256(sortedJson(original)),
      excludedRootScripts: Object.keys(QA04_SCRIPT_REGISTRATIONS) };
  });
}

function jsonPointer(value, pointer, code) {
  requireThat(typeof pointer === 'string' && pointer.length <= 2048
    && (pointer === '' || pointer.startsWith('/')), code);
  if (pointer === '') return value;
  const parts = pointer.slice(1).split('/');
  requireThat(parts.length <= 32, code);
  for (const part of parts) {
    requireThat(!/~(?![01])/u.test(part), code);
    const key = part.replace(/~1/gu, '/').replace(/~0/gu, '~');
    requireThat(key && !['__proto__', 'prototype', 'constructor'].includes(key)
      && value !== null && typeof value === 'object' && Object.hasOwn(value, key)
      && (!Array.isArray(value) || /^(0|[1-9]\d*)$/u.test(key)), code);
    value = value[key];
  }
  return value;
}

function pointedOriginal(reader, reference, code) {
  exactKeys(reference, ['path', 'sha256', 'pointer'], code);
  return jsonPointer(reader.json({ path: reference.path, sha256: reference.sha256 }, code,
    { nativeCompact: true }), reference.pointer, code);
}

// source-listing-workflow-prisma.ts hashes draft payloads with localeCompare,
// whereas ai-media-planning.ts uses code-point ordering for application states.
function sourceDraftPayloadJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(sourceDraftPayloadJson).join(',')}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${sourceDraftPayloadJson(item)}`).join(',')}}`;
}

function workflowEventPayloadHash(event, operation, code) {
  // Most workflow writers hash JSON.stringify in the construction order below.
  // JSONB loses that order; reconstruct only the typed original keys, never
  // rewrite the original payload/hash or accept arbitrary claimed hash recipes.
  const keys = {
    CREATED: operation === 'IMAGE_TO_IMAGE' ? ['operation', 'attempt', 'referenceCount']
      : ['operation', 'attempt', 'sourceAssetId', 'maskAssetId', 'maskSemantics'],
    JOB_STARTED: ['attempt'],
    PROVIDER_DISPATCH_STARTED: ['providerDispatchedAt'],
    PROVIDER_SUBMITTED: ['providerJobId', 'providerAcceptedAt'],
    PROVIDER_OUTPUT_PERSISTED: ['outputAssetId', 'sha256'],
    JOB_SUCCEEDED: ['outputAssetIds'],
    REVIEW_APPROVED: ['note', ...(Object.hasOwn(event.payload, 'operationKey') ? ['operationKey'] : [])],
    LISTING_DRAFT_APPLIED: ['version', 'applicationId', 'kind', 'rollbackOfId', 'operationKey', 'mode',
      'targetType', 'targetId', 'targetSequence', 'targetRevision', 'targetDraftVersion', 'contextSkuKey', 'contextSlotKey'],
  }[event.eventType];
  requireThat(Array.isArray(keys), code);
  exactKeys(event.payload, keys, code);
  requireThat(keys.every(key => key === 'outputAssetIds'
    ? Array.isArray(event.payload[key]) && event.payload[key].length === 1 && event.payload[key].every(boundedText)
    : event.payload[key] === null || ['string', 'number', 'boolean'].includes(typeof event.payload[key])), code);
  const payload = event.payload;
  if (event.eventType === 'CREATED') requireThat(payload.operation === operation && payload.attempt === 1
    && (operation === 'IMAGE_TO_IMAGE' ? payload.referenceCount === 1
      : boundedText(payload.sourceAssetId) && boundedText(payload.maskAssetId)
        && payload.maskSemantics === 'WHITE_EDIT_BLACK_PRESERVE_V1'), code);
  if (event.eventType === 'JOB_STARTED') requireThat(payload.attempt === 1, code);
  if (event.eventType === 'PROVIDER_DISPATCH_STARTED') canonicalTimestamp(payload.providerDispatchedAt, code);
  if (event.eventType === 'PROVIDER_SUBMITTED') {
    requireThat(boundedText(payload.providerJobId), code); canonicalTimestamp(payload.providerAcceptedAt, code);
  }
  if (event.eventType === 'REVIEW_APPROVED') requireThat((payload.note === null
    || typeof payload.note === 'string' && payload.note.length <= 2000)
    && (!Object.hasOwn(payload, 'operationKey') || boundedText(payload.operationKey)), code);
  const typed = Object.fromEntries(keys.map(key => [key, event.payload[key]]));
  return sha256(event.eventType === 'LISTING_DRAFT_APPLIED' ? sortedJson(typed) : JSON.stringify(typed));
}

function verifyDraftNormalErp(reader, input, manifest, root, now) {
  const code = 'QA04_ERP_INVALID', refs = input.normalErp, operation = manifest.operation;
  requireThat(['IMAGE_TO_IMAGE', 'INPAINT'].includes(operation), code);
  const explicitExecution = manifest.schemaVersion === 2;
  exactKeys(manifest, ['schemaVersion', 'kind', 'operation', 'pointers', 'source', 'browser', 'interactions',
    ...(operation === 'INPAINT' ? ['mask'] : []),
    ...(explicitExecution ? ['executionGitCommit', 'executionOfflineQa04'] : [])], code);
  requireThat(manifest.schemaVersion === 1 || explicitExecution, code);
  const executionCommit = explicitExecution ? manifest.executionGitCommit : input.targetGitCommit;
  const executionOfflineRefs = explicitExecution ? manifest.executionOfflineQa04 : input.offline;
  requireThat(isCommit(executionCommit), 'QA04_ERP_SOURCE_CHANGED');
  if (explicitExecution) exactKeys(executionOfflineRefs, ['receipt', 'log'], code);
  exactKeys(manifest.pointers, ['generated', 'applied', 'restored', 'controllerStatus'], code);
  const stages = Object.fromEntries(['generated', 'applied', 'restored'].map(phase => [phase,
    jsonPointer(reader.json(refs[phase], code, { nativeCompact: true }), manifest.pointers[phase], code)]));
  const controller = jsonPointer(reader.json(refs.controllerStatus, code, { nativeCompact: true }), manifest.pointers.controllerStatus, code);
  const browser = pointedOriginal(reader, manifest.browser, code), actions = pointedOriginal(reader, manifest.interactions, code);
  const image = pngEvidence(reader, refs.image, code), source = pngEvidence(reader, manifest.source, code);
  const mask = operation === 'INPAINT' ? pngEvidence(reader, manifest.mask, code) : null;
  // Normal generation can persist null dimension columns. The decoded bytes,
  // still pinned by DB SHA/MIME/size, supply dimensions without rewriting a row.
  const storedImageMatches = (decoded, row) => requireThat(decoded.sha256 === row.sha256 && decoded.bytes === row.sizeBytes
    && decoded.mimeType === row.mimeType && (row.width == null || row.width === decoded.width)
    && (row.height == null || row.height === decoded.height), code);
  requireThat(image.width === 1024 && image.height === 1024, code);
  const single = rows => { requireThat(Array.isArray(rows) && rows.length === 1 && isRecord(rows[0]), code); return rows[0]; };
  const owned = (row, owner) => requireThat(isRecord(row) && boundedText(row.id) && row.ownerUserId === owner, code);
  const fields = (row, names) => Object.fromEntries(names.map(name => [name, row[name]]));
  const generated = stages.generated, applied = stages.applied, restored = stages.restored;
  requireThat(isRecord(generated) && isCommit(generated.gitCommit)
    && generated.gitCommit === executionCommit, 'QA04_ERP_SOURCE_CHANGED');
  const owner = generated.ownerUserId, flow = generated.workflow, job = single(generated.jobs);
  requireThat(boundedText(owner) && isRecord(flow), code);
  // An earlier execution must have its own complete offline run, fresh when that
  // job started. The target's independently verified run remains fresh at release.
  // v1 retains the same-commit, after-target-offline contract and report bytes.
  const executionOffline = explicitExecution ? verifyOffline(reader, {
    targetGitCommit: executionCommit, offline: executionOfflineRefs,
  }, job.startedAt) : null;
  const offline = executionOffline?.receipt ?? reader.json(input.offline.receipt, 'QA04_OFFLINE_INVALID');
  requireThat(canonicalTimestamp(job.startedAt, code) >= canonicalTimestamp(offline.completedAt, 'QA04_OFFLINE_INVALID'),
    'QA04_ERP_SOURCE_CHANGED');
  const finalOutput = single(generated.outputs?.filter(row => row.kind === 'AI_GENERATED'));
  const inputSource = single(generated.inputs?.filter(row => row.role === 'REFERENCE'));
  const inputMask = mask ? single(generated.inputs?.filter(row => row.role === 'MASK')) : null;
  const mutation = single(applied?.applications);
  const runtime = Object.hasOwn(job.operationConfig || {}, 'providerRuntime') ? job.operationConfig.providerRuntime : job.operationConfig;
  requireThat(isRecord(runtime), code);
  exactKeys(runtime, ['contractVersion', 'provider', 'model', 'baseUrlSha256', 'currency', 'unitCostCents', 'imageCount',
    'width', 'height', 'maximumCostCents', 'credentialRevision'], code);
  exactKeys(runtime.credentialRevision, ['recordId', 'revision', 'updatedAt'], code);
  requireThat(runtime.contractVersion === 'ai-image-provider-runtime/v3' && runtime.provider === 'dashscope-wanx'
    && runtime.model === 'wanx2.1-imageedit' && runtime.currency === 'CNY' && runtime.unitCostCents === 14
    && runtime.maximumCostCents === 14 && runtime.imageCount === 1 && runtime.width === 1024 && runtime.height === 1024
    && runtime.baseUrlSha256 === sha256('https://dashscope.aliyuncs.com/api/v1')
    && boundedText(runtime.credentialRevision.recordId) && positiveInteger(runtime.credentialRevision.revision), code);
  requireThat(canonicalTimestamp(runtime.credentialRevision.updatedAt, code) <= canonicalTimestamp(job.startedAt, code), code);
  const jobCore = ['id', 'ownerUserId', 'actorUserId', 'workflowId', 'workflowAttempt', 'executionMode', 'operation',
    'provider', 'model', 'status', 'attemptCount', 'requestedImageCount', 'width', 'height', 'estimatedCostCents',
    'actualCostCents', 'billedUnits', 'requestFingerprint', 'operationConfig', 'providerJobId',
    'providerReconciliationStatus', 'startedAt', 'providerDispatchedAt', 'completedAt'];
  const flowCore = ['id', 'ownerUserId', 'actorUserId', 'operation', 'status', 'currentAttempt', 'idempotencyKey',
    'contextType', 'contextId', 'contextSkuKey', 'contextSlotKey', 'contextDraftRevision', 'contextDraftVersion'];
  const assetCore = ['id', 'ownerUserId', 'aiImageJobId', 'sourceCaptureSnapshotId', 'kind', 'sha256', 'width', 'height', 'mimeType', 'sizeBytes', 'storageBackend'];
  const assetsIdentity = values => values.map(row => fields(row, assetCore)).sort((left, right) => left.id.localeCompare(right.id));
  const inputsIdentity = values => values.map(row => ({ ...fields(row, ['id', 'ownerUserId', 'workflowId', 'assetId', 'role', 'ordinal', 'assetSha256']),
    asset: fields(row.asset, assetCore) })).sort((left, right) => left.id.localeCompare(right.id));
  const expectedTypes = ['CREATED', 'JOB_STARTED', 'PROVIDER_DISPATCH_STARTED', 'PROVIDER_SUBMITTED',
    ...(mask ? ['PROVIDER_OUTPUT_PERSISTED'] : []), 'JOB_SUCCEEDED'];
  let previousTime = canonicalTimestamp(job.completedAt, code);
  requireThat(canonicalTimestamp(job.startedAt, code) < previousTime
    && canonicalTimestamp(job.providerDispatchedAt, code) >= Date.parse(job.startedAt)
    && Date.parse(job.providerDispatchedAt) <= previousTime, code);
  const acceptedJob = restored.jobs?.[0];
  for (const phase of ['generated', 'applied', 'restored']) {
    const value = stages[phase], first = phase === 'generated';
    exactKeys(value, ['schemaVersion', 'kind', 'gitCommit', 'region', 'phase', 'at', 'ownerUserId', 'actorUserId',
      'workflow', 'jobs', 'inputs', 'outputs', 'reservations', 'settlements', 'draft', 'applications', 'events'], code);
    requireThat(value.schemaVersion === 1 && value.kind === 'NORMAL_IMAGE_DRAFT_DATABASE_SNAPSHOT'
      && value.phase === phase && value.gitCommit === executionCommit && value.region === 'COM'
      && value.ownerUserId === owner && value.actorUserId === owner, code);
    const at = canonicalTimestamp(value.at, code);
    requireThat(at >= previousTime && at <= Date.parse(now), code); previousTime = at;
    const currentJob = single(value.jobs), workflow = value.workflow, draft = value.draft;
    owned(workflow, owner); owned(currentJob, owner); owned(draft, owner);
    requireThat(equal(fields(currentJob, jobCore), fields(job, jobCore)) && equal(fields(workflow, flowCore), fields(flow, flowCore))
      && currentJob.actorUserId === owner && currentJob.workflowId === flow.id && currentJob.workflowAttempt === 1
      && currentJob.executionMode === 'ERP_HOSTED' && currentJob.operation === operation && currentJob.status === 'SUCCEEDED'
      && currentJob.provider === runtime.provider && currentJob.model === runtime.model && currentJob.attemptCount === 1
      && currentJob.providerReconciliationStatus === 'NOT_REQUIRED' && boundedText(currentJob.providerJobId)
      && isSha256(currentJob.requestFingerprint) && currentJob.requestedImageCount === 1
      && currentJob.width === 1024 && currentJob.height === 1024 && currentJob.estimatedCostCents === 14
      && currentJob.actualCostCents === 14 && currentJob.billedUnits === 1, code);
    requireThat(workflow.actorUserId === owner && workflow.operation === operation && workflow.status === 'SUCCEEDED'
      && workflow.currentAttempt === 1 && boundedText(workflow.idempotencyKey) && workflow.contextType === 'listing-draft'
      && workflow.contextId === draft.workflowId && boundedText(workflow.contextSlotKey)
      && (workflow.contextSkuKey === null || boundedText(workflow.contextSkuKey))
      && workflow.contextDraftRevision === generated.draft.revision && workflow.contextDraftVersion === generated.draft.draftVersion
      && workflow.reviewStatus === (first ? 'PENDING' : 'APPROVED') && positiveInteger(workflow.revision)
      && workflow.selectedOutputAssetId === (first ? null : finalOutput.id)
      && workflow.reviewedByUserId === (first ? null : owner), code);
    requireThat(first ? currentJob.appliedAt === null && currentJob.appliedMode === null && currentJob.applyTargetType === null
      && currentJob.applyTargetId === null && workflow.reviewedAt === null
      : currentJob.appliedMode === 'append' && currentJob.applyTargetType === 'listing-draft' && currentJob.applyTargetId === draft.workflowId
        && equal(fields(currentJob, ['appliedAt', 'appliedMode', 'applyTargetType', 'applyTargetId']),
          fields(acceptedJob, ['appliedAt', 'appliedMode', 'applyTargetType', 'applyTargetId']))
        && canonicalTimestamp(workflow.reviewedAt, code) <= canonicalTimestamp(currentJob.appliedAt, code)
        && Date.parse(currentJob.appliedAt) <= at, code);
    requireThat(Array.isArray(value.inputs) && value.inputs.length === (mask ? 2 : 1)
      && new Set(value.inputs.map(row => row.id)).size === value.inputs.length
      && equal(inputsIdentity(value.inputs), inputsIdentity(generated.inputs)), code);
    for (const row of value.inputs) {
      owned(row, owner); owned(row.asset, owner);
      const expected = row.role === 'REFERENCE' ? source : row.role === 'MASK' ? mask : null;
      requireThat(expected && row.workflowId === flow.id && row.assetId === row.asset.id && row.ordinal === 0
        && row.assetSha256 === expected.sha256 && row.asset.sourceCaptureSnapshotId === draft.sourceCaptureSnapshotId, code);
      storedImageMatches(expected, row.asset);
    }
    requireThat(Array.isArray(value.outputs) && value.outputs.length === (mask ? 2 : 1)
      && new Set(value.outputs.map(row => row.id)).size === value.outputs.length
      && new Set([...value.inputs.map(row => row.assetId), ...value.outputs.map(row => row.id)]).size === value.inputs.length + value.outputs.length
      && value.outputs.filter(row => row.kind === 'AI_GENERATED').length === 1
      && value.outputs.filter(row => row.kind === 'AI_PROVIDER_OUTPUT').length === (mask ? 1 : 0)
      && equal(assetsIdentity(value.outputs), assetsIdentity(generated.outputs)), code);
    for (const row of value.outputs) {
      owned(row, owner);
      requireThat(row.aiImageJobId === job.id && row.storageBackend === 'oss' && isSha256(row.sha256)
        && positiveInteger(row.sizeBytes) && row.mimeType === 'image/png'
        && (row.width == null || row.width === 1024) && (row.height == null || row.height === 1024), code);
    }
    storedImageMatches(image, finalOutput);
    requireThat(finalOutput.sourceCaptureSnapshotId === draft.sourceCaptureSnapshotId, code);
    const reservation = single(value.reservations), charge = single(value.settlements);
    owned(reservation, owner); owned(charge, owner);
    requireThat(reservation.actorUserId === owner && reservation.jobId === job.id && reservation.workflowId === flow.id
      && reservation.operation === operation && reservation.provider === runtime.provider && reservation.model === runtime.model
      && reservation.currency === 'CNY' && reservation.status === 'SETTLED' && reservation.estimatedCostMinor === 14
      && reservation.maximumCostMinor === 14 && isSha256(reservation.requestFingerprint)
      && charge.actorUserId === owner && charge.reservationId === reservation.id && charge.kind === 'CHARGE'
      && charge.actualCostMinor === 14 && charge.billedUnits === 1 && isSha256(charge.requestFingerprint)
      && equal(value.reservations, generated.reservations) && equal(value.settlements, generated.settlements), code);
    const payload = draft.payload;
    requireThat(isRecord(payload) && draft.actorUserId === owner && isSha256(draft.payloadHash)
      && sha256(sourceDraftPayloadJson(payload)) === draft.payloadHash && payload.id === draft.workflowId && payload.ownerUserId === owner
      && payload.shopId === draft.shopId && draft.shopId === generated.draft.shopId
      && boundedText(payload.supplyGoodsId) && payload.supplyGoodsId === generated.draft.payload.supplyGoodsId
      && boundedText(draft.sourceCaptureSnapshotId) && payload.sourceCaptureSnapshotId === draft.sourceCaptureSnapshotId
      && payload.sourceCaptureSnapshotId === generated.draft.sourceCaptureSnapshotId
      && positiveInteger(draft.revision) && positiveInteger(draft.draftVersion)
      && payload.revision === draft.revision && payload.draftVersion === draft.draftVersion
      && Array.isArray(payload.selectedSkuKeys) && payload.selectedSkuKeys.length > 0
      && payload.selectedSkuKeys.every(boundedText) && equal(payload.selectedSkuKeys, draft.selectedSkuKeys)
      && equal(draft.selectedSkuKeys, generated.draft.selectedSkuKeys)
      && (workflow.contextSkuKey === null || payload.selectedSkuKeys.includes(workflow.contextSkuKey))
      && Array.isArray(payload.media?.assignments) && payload.media.assignments.length <= 500, code);
    requireThat(Array.isArray(value.applications) && value.applications.length === (first ? 0 : 1)
      && (first || equal(value.applications, applied.applications) && equal(value.draft, applied.draft)
        && equal(value.workflow, applied.workflow)), code);
    requireThat(Array.isArray(value.events) && value.events.length === expectedTypes.length + (first ? 0 : 2)
      && new Set(value.events.map(row => row.id)).size === value.events.length
      && new Set(value.events.map(row => row.eventKey)).size === value.events.length
      && equal(value.events.map(row => row.eventType).sort(), [...expectedTypes, ...(first ? [] : ['REVIEW_APPROVED', 'LISTING_DRAFT_APPLIED'])].sort()), code);
    for (const event of value.events) {
      owned(event, owner);
      requireThat(event.workflowId === flow.id && (event.actorUserId === null || event.actorUserId === owner)
        && (event.jobId === null || event.jobId === job.id) && boundedText(event.eventKey)
        && isRecord(event.payload) && isSha256(event.payloadHash) && workflowEventPayloadHash(event, operation, code) === event.payloadHash
        && canonicalTimestamp(event.createdAt, code) <= at, code);
      if (event.eventType === 'PROVIDER_SUBMITTED') requireThat(event.payload.providerJobId === job.providerJobId, code);
      if (event.eventType === 'JOB_SUCCEEDED') requireThat(equal(event.payload.outputAssetIds, [finalOutput.id]), code);
      if (event.eventType === 'PROVIDER_OUTPUT_PERSISTED') {
        const raw = single(value.outputs.filter(row => row.kind === 'AI_PROVIDER_OUTPUT'));
        requireThat(event.payload.outputAssetId === raw.id && event.payload.sha256 === raw.sha256, code);
      }
    }
    requireThat(generated.events.every(event => value.events.some(row => equal(row, event))), code);
  }
  const beforeDraft = generated.draft, afterDraft = applied.draft;
  owned(mutation, owner);
  requireThat(mutation.actorUserId === owner && mutation.workflowId === flow.id && mutation.jobId === job.id
    && mutation.assetId === finalOutput.id && mutation.sourceCaptureSnapshotId === beforeDraft.sourceCaptureSnapshotId
    && mutation.operation === operation && mutation.kind === 'APPLY' && mutation.revision === 1
    && mutation.rollbackOfId === null && mutation.rolledBackBy === null && mutation.targetId === beforeDraft.workflowId
    && positiveInteger(mutation.targetSequence) && mutation.mode === 'APPEND' && mutation.replaceConfirmed === false
    && mutation.contextSkuKey === flow.contextSkuKey && mutation.contextSlotKey === flow.contextSlotKey
    && mutation.contextDraftRevision === flow.contextDraftRevision && mutation.contextDraftVersion === flow.contextDraftVersion
    && boundedText(mutation.operationKey) && mutation.operationKey.length >= 8 && isSha256(mutation.requestFingerprint)
    && mutation.workflowRevisionBefore === generated.workflow.revision + 1
    && mutation.workflowRevisionAfter === mutation.workflowRevisionBefore + 1 && applied.workflow.revision === mutation.workflowRevisionAfter
    && mutation.targetRevisionBefore === beforeDraft.revision && mutation.targetDraftVersionBefore === beforeDraft.draftVersion
    && mutation.targetRevisionAfter === beforeDraft.revision + 1 && mutation.targetDraftVersionAfter === beforeDraft.draftVersion + 1
    && mutation.targetRevisionAfter === afterDraft.revision && mutation.targetDraftVersionAfter === afterDraft.draftVersion, code);
  requireThat(canonicalTimestamp(mutation.createdAt, code) >= Date.parse(job.completedAt)
    && Date.parse(mutation.createdAt) <= Date.parse(applied.at), code);
  const assignment = { scope: flow.contextSkuKey === null ? 'PRODUCT' : 'SKU', ...(flow.contextSkuKey === null ? {} : { skuKey: flow.contextSkuKey }),
    slotKey: flow.contextSlotKey, assetId: finalOutput.id, source: operation === 'INPAINT' ? 'EDITED' : 'GENERATED' };
  requireThat(equal(mutation.beforeState, { version: 'ai-media-listing-draft-assignment/v1', assignment: null })
    && equal(mutation.afterState, { version: 'ai-media-listing-draft-assignment/v1', assignment })
    && sha256(sortedJson(mutation.beforeState)) === mutation.beforeStateHash && sha256(sortedJson(mutation.afterState)) === mutation.afterStateHash
    && !beforeDraft.payload.media.assignments.some(row => row.slotKey === flow.contextSlotKey && (row.skuKey || null) === flow.contextSkuKey)
    && equal(afterDraft.payload.media.assignments, [...beforeDraft.payload.media.assignments, assignment]), code);
  const review = single(applied.events.filter(row => row.eventType === 'REVIEW_APPROVED'));
  const applicationEvent = single(applied.events.filter(row => row.eventType === 'LISTING_DRAFT_APPLIED'));
  requireThat(review.actorUserId === owner && review.assetId === finalOutput.id && applicationEvent.actorUserId === owner
    && applicationEvent.jobId === job.id && applicationEvent.assetId === finalOutput.id
    && applicationEvent.payload.applicationId === mutation.id && applicationEvent.payload.operationKey === mutation.operationKey
    && applicationEvent.payload.targetId === beforeDraft.workflowId && applicationEvent.payload.targetRevision === afterDraft.revision
    && applicationEvent.payload.targetDraftVersion === afterDraft.draftVersion && applicationEvent.payload.contextSkuKey === flow.contextSkuKey
    && applicationEvent.payload.contextSlotKey === flow.contextSlotKey && applicationEvent.payload.mode === 'append'
    && applicationEvent.payload.version === 'ai-media-listing-draft-application/v1' && applicationEvent.payload.kind === 'APPLY'
    && applicationEvent.payload.rollbackOfId === null && applicationEvent.payload.targetType === 'listing-draft'
    && applicationEvent.payload.targetSequence === mutation.targetSequence, code);
  requireThat(controller?.schemaVersion === 1 && controller.kind === 'SS_ERP_COMPLETION_BOOTSTRAP_RECEIPT'
    && controller.action === 'restore' && controller.phase === 'restored' && controller.commit === executionCommit
    && controller.ownerSha256 === sha256(owner) && controller.currency === 'CNY' && controller.unitCostCents === 14
    && controller.maximumTaskCostCents === 14 && controller.workflowEnabled === false && controller.sharedDailyBudgetModified === false
    && controller.userDailyLimitModified === false && controller.legacyTextAiModified === false
    && equal(controller.pending, { jobs: 0, costs: 0, recovery: 0, workflows: 0, suites: 0 })
    && isSha256(controller.backupSha256) && positiveInteger(controller.credentialRevisionBefore)
    && positiveInteger(controller.credentialRevisionAfter) && controller.credentialRevisionAfter > controller.credentialRevisionBefore
    && controller.candidate?.gitCommit === executionCommit && controller.candidate.offlineSha256 === executionOfflineRefs.receipt.sha256
    && ['releaseEvidenceSha256', 'signatureSha256', 'vpsSha256'].every(key => isSha256(controller.candidate[key])), code);
  const restoredAt = canonicalTimestamp(controller.restoredAt, code);
  requireThat(restoredAt >= Date.parse(applied.at) && restoredAt <= Date.parse(restored.at), code);
  requireThat(browser?.schemaVersion === 1 && browser.kind === 'NORMAL_IMAGE_DRAFT_BROWSER_EXECUTION'
    && browser.gitCommit === executionCommit && browser.ownerUserId === owner && browser.operation === operation
    && browser.workflowId === flow.id && browser.jobId === job.id && browser.outputAssetId === finalOutput.id
    && browser.sourceSha256 === source.sha256 && browser.outputSha256 === image.sha256 && browser.realSignedInAccount === true
    && browser.ownedTargetsClosed === true && browser.originalBrowserPreserved === true
    && browser.isolation?.kind === 'DEDICATED_QA_PROFILE' && isSha256(browser.isolation.profileSha256)
    && Number.isSafeInteger(browser.isolation.debuggingPort) && browser.isolation.debuggingPort > 0 && browser.isolation.debuggingPort <= 65535
    && Number.isSafeInteger(browser.isolation.protectedDebuggingPort) && browser.isolation.protectedDebuggingPort > 0
    && browser.isolation.protectedDebuggingPort <= 65535 && browser.isolation.debuggingPort !== browser.isolation.protectedDebuggingPort, code);
  const browserStarted = canonicalTimestamp(browser.startedAt, code), completedAt = canonicalTimestamp(browser.completedAt, code);
  requireThat(browserStarted <= Date.parse(job.startedAt) && completedAt >= Date.parse(restored.at) && completedAt <= Date.parse(now), code);
  exactKeys(actions, ['schemaVersion', 'kind', 'gitCommit', 'ownerUserId', 'operation', 'creates', 'reviews', 'applications'], code);
  requireThat(actions.schemaVersion === 1 && actions.kind === 'NORMAL_IMAGE_DRAFT_UI_INTERACTIONS'
    && actions.gitCommit === executionCommit && actions.ownerUserId === owner && actions.operation === operation, code);
  const createAction = single(actions.creates), reviewAction = single(actions.reviews), applyAction = single(actions.applications);
  for (const action of [createAction, reviewAction, applyAction]) {
    const at = canonicalTimestamp(action.at, code);
    requireThat(at >= browserStarted && at <= completedAt && action.workflowId === flow.id, code);
  }
  requireThat(createAction.operation === operation && createAction.jobId === job.id && createAction.sourceAssetId === inputSource.assetId
    && createAction.maskAssetId === (inputMask?.assetId || null) && createAction.idempotencyKey === flow.idempotencyKey
    && Date.parse(createAction.at) <= Date.parse(generated.at)
    && reviewAction.outputAssetId === finalOutput.id && reviewAction.decision === 'APPROVE'
    && reviewAction.expectedRevision === generated.workflow.revision && Date.parse(reviewAction.at) >= Date.parse(generated.at)
    && applyAction.outputAssetId === finalOutput.id && applyAction.jobId === job.id && applyAction.applicationId === mutation.id
    && applyAction.mode === 'append' && applyAction.operationKey === mutation.operationKey
    && applyAction.expectedWorkflowRevision === mutation.workflowRevisionBefore
    && applyAction.expectedTargetRevision === mutation.targetRevisionBefore && applyAction.expectedTargetDraftVersion === mutation.targetDraftVersionBefore
    && Date.parse(applyAction.at) >= Date.parse(reviewAction.at) && Date.parse(applyAction.at) <= Date.parse(applied.at), code);
  const sourceBridge = verifyErpSource(root, generated.gitCommit, input.targetGitCommit);
  return { executionCommit: generated.gitCommit, completedAt: browser.completedAt, operation,
    provider: runtime.provider, model: runtime.model, currency: 'CNY', unitCostMinor: 14,
    successfulImages: 1, actualCostMinor: 14, chargeCount: 1, applicationCount: 1, originalImagePreserved: true,
    configurationRestored: true, image, sourceBridge, targetUiProductionVerified: false,
    ...(executionOffline ? { executionOfflineQa04: { gitCommit: executionCommit,
      receiptSha256: executionOfflineRefs.receipt.sha256, logSha256: executionOfflineRefs.log.sha256,
      startedAt: executionOffline.receipt.startedAt, completedAt: executionOffline.receipt.completedAt } } : {}),
    evidence: Object.fromEntries(Object.entries(refs).map(([key, ref]) => [`${key}Sha256`, ref.sha256])) };
}

function verifyNormalErp(reader, input, root, now) {
  return scoped('QA04_ERP_INVALID', () => {
    const code = 'QA04_ERP_INVALID', refs = input.normalErp, acceptance = reader.json(refs.acceptance, code);
    if (acceptance.kind === 'NORMAL_IMAGE_DRAFT_FLOW_INPUTS') return verifyDraftNormalErp(reader, input, acceptance, root, now);
    const generated = reader.json(refs.generated, code), applied = reader.json(refs.applied, code), restored = reader.json(refs.restored, code);
    const controller = reader.json(refs.controllerStatus, code, { nativeCompact: true }), image = pngEvidence(reader, refs.image, code);
    requireThat(acceptance.schemaVersion === 1 && acceptance.kind === 'NORMAL_IMAGE_REAL_FLOW_ACCEPTANCE'
      && acceptance.status === 'PASS' && isCommit(acceptance.gitCommit) && acceptance.region === 'COM'
      && acceptance.operation === 'FULL_EDIT' && acceptance.provider === 'dashscope-wanx' && acceptance.model === 'wanx2.1-imageedit'
      && acceptance.currency === 'CNY' && positiveInteger(acceptance.unitCostCents)
      && acceptance.successfulImages === 1 && acceptance.workflowRequests === 1 && acceptance.providerAttempts === 1
      && acceptance.chargeSettlements === 1 && acceptance.reviewRequests === 1 && acceptance.appendRequests === 1
      && acceptance.targetImageCount === 2 && acceptance.originalImagePreserved === true && acceptance.configRestored === true, code);
    requireThat(canonicalTimestamp(acceptance.completedAt, code) <= Date.parse(now), code);
    const job = acceptance.job, price = job?.pricing, expected = acceptance.unitCostCents * acceptance.successfulImages;
    requireThat(job?.status === 'SUCCEEDED' && job.attemptCount === 1 && job.providerReconciliationStatus === 'NOT_REQUIRED'
      && isSha256(job.idSha256) && isSha256(job.providerJobIdSha256) && job.billedUnits === 1
      && price?.currency === acceptance.currency && price.unitCostCents === acceptance.unitCostCents
      && price.requestedImageCount === 1 && price.maximumCostCents === expected
      && job.actualCostCents === expected && acceptance.actualCostCents === expected, code);
    requireThat(canonicalTimestamp(job.startedAt, code) < canonicalTimestamp(job.completedAt, code), code);
    imageMatches(image, acceptance.output, 'sizeBytes', code);
    requireThat(image.width === 1024 && image.height === 1024 && acceptance.output.storageBackend === 'oss'
      && acceptance.output.generatedCount === 1 && acceptance.output.rawCount === 1 && isSha256(acceptance.output.idSha256), code);
    const baseEvents = ['CREATED', 'JOB_STARTED', 'PROVIDER_DISPATCH_STARTED', 'PROVIDER_SUBMITTED', 'PROVIDER_OUTPUT_PERSISTED', 'JOB_SUCCEEDED'];
    let previousTime = Date.parse(job.completedAt);
    for (const [phase, value] of [['generated', generated], ['applied', applied], ['restored', restored]]) {
      const first = phase === 'generated';
      requireThat(value.kind === 'NORMAL_IMAGE_DATABASE_VERIFICATION' && value.status === 'PASS' && value.phase === phase
        && value.gitCommit === acceptance.gitCommit && isSha256(value.ownerSha256) && value.ownerSha256 === generated.ownerSha256
        && equal(value.job, job) && equal(value.output, acceptance.output), code);
      const time = canonicalTimestamp(value.at, code);
      requireThat(time >= previousTime && time <= Date.parse(acceptance.completedAt), code); previousTime = time;
      const cost = value.cost, workflow = value.workflow, target = value.target;
      requireThat(cost?.reservationCount === 1 && cost.status === 'SETTLED' && cost.currency === acceptance.currency
        && cost.maximumCostMinor === price.maximumCostCents && cost.settlementCount === 1 && cost.chargeCount === 1
        && cost.chargeKind === 'CHARGE' && cost.actualCostMinor === expected && cost.billedUnits === 1, code);
      requireThat(isSha256(workflow?.idSha256) && workflow.idSha256 === acceptance.workflow.idSha256
        && workflow.operation === 'FULL_EDIT' && workflow.status === 'SUCCEEDED' && workflow.currentAttempt === 1
        && workflow.reviewStatus === (first ? 'PENDING' : 'APPROVED')
        && positiveInteger(workflow.revision) && (first ? workflow.revision < applied.workflow.revision : equal(workflow, acceptance.workflow)), code);
      requireThat(isSha256(target?.idSha256) && target.idSha256 === generated.target.idSha256
        && target.imageCount === (first ? 1 : 2) && target.originalPreserved === true
        && target.outputIncluded === !first && target.applicationCount === (first ? 0 : 1)
        && Array.isArray(value.eventTypes)
        && equal([...value.eventTypes].sort(), [...baseEvents, ...(first ? [] : ['REVIEW_APPROVED', 'APPLIED'])].sort()), code);
    }
    const status = controller.result;
    const emptyPending = { jobs: 0, costs: 0, recovery: 0, workflows: 0 };
    requireThat(controller.ok === true && status?.schemaVersion === 1 && status.action === 'status' && status.phase === 'restored'
      && status.commit === acceptance.gitCommit && status.ownerSha256 === generated.ownerSha256
      && positiveInteger(status.credentialRevision) && status.credentialRevision === acceptance.credentialRevisionAfterRestore
      && status.workflowEnabled === false && status.sharedDailyBudgetModified === false && status.legacyTextAiModified === false
      && equal(status.pending, emptyPending) && equal(acceptance.pending, emptyPending)
      && acceptance.browser?.realSignedInAccount === true && acceptance.browser.isolatedContext === true
      && acceptance.browser.contextDisposed === true, code);
    for (const field of ['supplierInvoiceReconciliation', 'newOzonWrites', 'otherImageOperations', 'fullProductionMv3Flow',
      'formalQa04', 'rel04', 'websitePublication']) requireThat(acceptance.excluded?.[field] === true, code);
    requireThat(Array.isArray(acceptance.evidence) && acceptance.evidence.length > 0 && acceptance.evidence.length <= 64, code);
    for (const evidence of acceptance.evidence) {
      exactKeys(evidence, ['file', 'sha256'], code);
      reader.read({ path: evidence.file, sha256: evidence.sha256 }, 32 * 1024 * 1024);
    }
    const sourceBridge = verifyErpSource(root, acceptance.gitCommit, input.targetGitCommit);
    return { executionCommit: acceptance.gitCommit, completedAt: acceptance.completedAt, operation: acceptance.operation,
      provider: acceptance.provider, model: acceptance.model, currency: acceptance.currency, unitCostMinor: acceptance.unitCostCents,
      successfulImages: 1, actualCostMinor: expected, chargeCount: 1, applicationCount: 1, originalImagePreserved: true,
      configurationRestored: true, image, sourceBridge, targetUiProductionVerified: false,
      evidence: Object.fromEntries(Object.entries(refs).map(([key, ref]) => [`${key}Sha256`, ref.sha256])) };
  });
}

export function verifyQa04FinalAcceptance({ inputPath, inputSha256, repositoryRoot = ROOT, now = new Date().toISOString() } = {}) {
  return scoped('QA04_INPUT_INVALID', () => {
    canonicalTimestamp(now, 'QA04_INPUT_INVALID');
    const root = realDirectory(repositoryRoot, 'QA04_SOURCE_INVALID');
    requireThat(typeof inputPath === 'string' && path.isAbsolute(inputPath) && !isWithin(root, path.resolve(inputPath)), 'QA04_INPUT_INVALID');
    const reader = evidenceReader(), input = validateInput(reader.json({ path: inputPath, sha256: inputSha256 }, 'QA04_INPUT_INVALID'));
    provenance(root, input.targetGitCommit);
    const offline = verifyOffline(reader, input, now);
    const technical = OPERATIONS.map(operation => verifyTechnical(reader, input.technical.find(row => row.operation === operation), now));
    const counterexamples = verifyCounterexamples(reader, input.counterexamples, technical, now);
    const normalErp = verifyNormalErp(reader, input, root, now);
    provenance(root, input.targetGitCommit);
    const report = {
      schemaVersion: 1, kind: 'QA04_FINAL_ACCEPTANCE', taskId: 'QA-04', gitCommit: input.targetGitCommit,
      completedAt: now, durationSeconds: offline.durationSeconds, decision: 'PASS', qa02Prerequisite: 'COMPLETE',
      command: 'pnpm qa:04:offline', gates: [...GATES], extensionVerification: offline.extensionVerification,
      externalEffects: { providerRequests: 0, vpsAccess: false, deployment: false, featureFlagChanges: 0, ozonWrites: 0 },
      provenance: {
        scope: SCOPE, inputSha256, externalEffectsScope: 'THIS_OFFLINE_AGGREGATION',
        offline: { receiptSha256: input.offline.receipt.sha256, logSha256: input.offline.log.sha256,
          startedAt: offline.receipt.startedAt, completedAt: offline.receipt.completedAt },
        technical, counterexamples, normalErp,
        qualityCoverage: 'ONLY_EXACT_HISTORICAL_INPUT_OUTPUT_PAIRS',
        supplierSettlementClaimed: false, allConfigurationsPromoted: false,
        fullProductionMv3Verified: false, websitePublicationVerified: false,
      },
    };
    const bytes = Buffer.from(canonicalJson(report));
    requireThat(bytes.length <= 64 * 1024, 'QA04_INPUT_INVALID');
    return { report, outputSha256: sha256(bytes) };
  });
}

export function writeQa04FinalAcceptance(options = {}) {
  const root = realDirectory(options.repositoryRoot ?? ROOT, 'QA04_SOURCE_INVALID');
  const outputPath = privateOutputPath(options.outputPath, root);
  const result = verifyQa04FinalAcceptance(options);
  scoped('QA04_OUTPUT_UNSAFE', () => {
    privateOutputPath(outputPath, root);
    writeNewArtifactDurably(outputPath, canonicalJson(result.report), { mode: 0o600 });
  });
  return { ...result, outputPath };
}

export function qa04FinalMain(args = process.argv.slice(2)) {
  try {
    const options = {};
    const flags = { '--input': 'inputPath', '--input-sha256': 'inputSha256', '--output': 'outputPath' };
    requireThat(args.length === 4 || args.length === 6, 'QA04_INPUT_INVALID');
    for (let index = 0; index < args.length; index += 2) {
      const key = flags[args[index]];
      requireThat(key && !(key in options) && typeof args[index + 1] === 'string'
        && !args[index + 1].startsWith('--'), 'QA04_INPUT_INVALID');
      options[key] = args[index + 1];
    }
    requireThat(options.inputPath && options.inputSha256, 'QA04_INPUT_INVALID');
    const result = options.outputPath ? writeQa04FinalAcceptance(options) : verifyQa04FinalAcceptance(options);
    process.stdout.write(`${JSON.stringify({ status: options.outputPath ? 'WRITTEN' : 'VERIFIED',
      gitCommit: result.report.gitCommit, sha256: result.outputSha256 })}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${/^QA04_[A-Z_]+$/u.test(error.code || '') ? error.code : 'QA04_INPUT_INVALID'}\n`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = qa04FinalMain();
}
