import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { QA04_OFFLINE_STEPS } from './qa04-offline-gate.mjs';
import { evidenceReader, imageEvidence } from './qa04-final-evidence.mjs';
import { countSuiteFlowFixture, sourcePageCountSuiteFlowFixture, suiteFlowFixture } from './qa04-final-suite-fixture.mjs';

let subject = {};
try { subject = await import('./qa04-final-acceptance.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

const NOW = '2026-09-16T12:00:00.000Z';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const sortedJson = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(sortedJson).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${sortedJson(value[key])}`).join(',')}}`;
const sourceDraftJson = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(sourceDraftJson).join(',')}]`
    : `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${sourceDraftJson(item)}`).join(',')}}`;
const identity = 'b'.repeat(64);
const operations = ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'];
const profiles = ['OZON_PORTRAIT_SINGLE_V1', 'DASHSCOPE_WANX21_IMAGE_TO_IMAGE_ASYNC_V1', 'DASHSCOPE_WANX21_FULL_EDIT_ASYNC_V1', 'DASHSCOPE_WANX21_INPAINT_ASYNC_V1'];

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(width, height, seed = 1) {
  const chunk = (type, bytes) => {
    const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
    return Buffer.concat([size, name, bytes, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height, seed);
  for (let row = 0; row < height; row++) raw[row * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function jpeg(width, height) {
  const segment = (marker, payload) => {
    const length = Buffer.alloc(2); length.writeUInt16BE(payload.length + 2);
    return Buffer.concat([Buffer.from([0xff, marker]), length, payload]);
  };
  const app = Buffer.concat([Buffer.from('JFIF\0', 'ascii'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]);
  const quantization = Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)]);
  const frame = Buffer.alloc(15); frame[0] = 8; frame.writeUInt16BE(height, 1); frame.writeUInt16BE(width, 3); frame[5] = 3;
  frame.set([1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0], 6);
  const scan = Buffer.from([3, 1, 0, 2, 0, 3, 0, 0, 63, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), segment(0xe0, app), segment(0xdb, quantization),
    segment(0xc0, frame), segment(0xda, scan), Buffer.from([0x01, 0xff, 0x00, 0x02, 0xff, 0xd9])]);
}

function progressiveJpeg(width, height) {
  const segment = (marker, payload) => {
    const length = Buffer.alloc(2); length.writeUInt16BE(payload.length + 2);
    return Buffer.concat([Buffer.from([0xff, marker]), length, payload]);
  };
  const quantization = Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)]);
  const frame = Buffer.alloc(15); frame[0] = 8; frame.writeUInt16BE(height, 1); frame.writeUInt16BE(width, 3); frame[5] = 3;
  frame.set([1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0], 6);
  const scan = Buffer.from([3, 1, 0, 2, 0, 3, 0, 0, 63, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), segment(0xdb, quantization), segment(0xc2, frame),
    segment(0xc4, Buffer.from([0, 0])), segment(0xda, scan), Buffer.from([1, 0xff, 0]),
    segment(0xc4, Buffer.from([0, 0])), segment(0xda, scan), Buffer.from([2, 0xff, 0xd9])]);
}

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-erp-qa04-final-'));
  const repositoryRoot = path.join(root, 'repository'), evidenceRoot = path.join(root, 'private');
  mkdirSync(repositoryRoot); mkdirSync(evidenceRoot, { mode: 0o700 });
  t.after(() => {
    assert.equal(realpathSync(root), path.resolve(root));
    assert.ok(path.basename(root).startsWith('ss-erp-qa04-final-'));
    rmSync(root, { recursive: true, force: true });
  });
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=QA Fixture', '-c', 'user.email=qa@example.invalid', ...args], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q');
  for (const name of ['apps/server/src/rule.ts', 'apps/server/prisma/schema.prisma', 'apps/server/package.json',
    'apps/server/src/services/extension-website-publication.ts',
    'apps/server/src/__tests__/extensions-download.test.ts',
    'packages/shared/src/contracts.ts', 'packages/shared/package.json', 'pnpm-lock.yaml', 'tsconfig.base.json']) {
    mkdirSync(path.dirname(path.join(repositoryRoot, name)), { recursive: true });
    writeFileSync(path.join(repositoryRoot, name), 'fixture\n');
  }
  writeFileSync(path.join(repositoryRoot, 'package.json'), json({ name: 'fixture', private: true,
    scripts: { test: 'node --test', build: 'node --version', postinstall: 'node --version' },
    devDependencies: { example: '1.0.0' }, packageManager: 'pnpm@10.0.0' }));
  writeFileSync(path.join(repositoryRoot, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n');
  mkdirSync(path.join(repositoryRoot, 'extensions/ss-erp/pages'), { recursive: true });
  writeFileSync(path.join(repositoryRoot, 'extensions/ss-erp/pages/precision-workbench.css'), '.panel { color: black; }\n');
  git('add', '--', 'apps/server', 'packages/shared', 'pnpm-lock.yaml', 'tsconfig.base.json', 'package.json', 'pnpm-workspace.yaml', 'extensions');
  git('commit', '-qm', 'original ERP rules');
  const erpCommit = git('rev-parse', 'HEAD');
  mkdirSync(path.join(repositoryRoot, 'apps/web'), { recursive: true });
  writeFileSync(path.join(repositoryRoot, 'apps/web/read.ts'), 'new frontend read behavior\n');
  git('add', '--', 'apps/web/read.ts'); git('commit', '-qm', 'frontend only');
  const targetGitCommit = git('rev-parse', 'HEAD');
  const put = (name, value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : json(value));
    const file = path.join(evidenceRoot, name);
    writeFileSync(file, bytes, { mode: 0o600 });
    return { path: file, sha256: hash(bytes) };
  };
  const get = ref => JSON.parse(readFileSync(ref.path, 'utf8'));
  const change = (ref, mutate) => { const value = get(ref); mutate(value); Object.assign(ref, put(path.basename(ref.path), value)); };
  const native = {
    schemaVersion: 1, kind: 'SS_ERP_QA04_OFFLINE_REHEARSAL', gitCommit: targetGitCommit,
    startedAt: '2026-09-16T10:00:00.000Z', completedAt: '2026-09-16T10:20:00.000Z', status: 'PASS',
    command: 'pnpm qa:04:offline', completesFormalTask: false, externalAccess: 'NO_PROVIDER_OR_VPS',
    steps: QA04_OFFLINE_STEPS.map(step => step.id),
  };
  const log = ['QA-04 offline rehearsal', 'Formal QA-04 completion still requires complete QA-02 evidence.', `Git commit: ${targetGitCommit}`];
  for (const step of QA04_OFFLINE_STEPS) {
    log.push(`[qa04-offline] ${step.name}`, `$ ${step.command} ${step.args.join(' ')}`);
    if (['preflight-build', 'extension-cloud', 'extension-local'].includes(step.id)) {
      const count = { 'preflight-build': 459, 'extension-cloud': 464, 'extension-local': 460 }[step.id];
      log.push(`=== Result: 0 failure(s), 0 warning(s), ${count} pass(es) ===`);
    }
  }
  log.push('[qa04-offline] all offline rehearsal checks passed', '');
  const source = put('source.png', png(1024, 1024, 12)), mask = put('mask.png', png(1024, 1024, 20));
  const technical = operations.map((operation, index) => {
    const text = operation === 'TEXT_TO_IMAGE', id = `historical-${operation.toLowerCase()}`, height = text ? 1536 : 1024;
    const image = put(`${id}.png`, png(1024, height, 60 + index));
    const endpoint = text ? 'https://images.example.invalid/v1/images/generations'
      : 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis';
    const approval = put(`${id}.approval.json`, {
      schemaVersion: 3, statement: 'I_APPROVE_EXACTLY_ONE_PAID_AI_IMAGE_REQUEST', requestCount: 1,
      approvalId: `${id}-approval`, operationId: id, operation, model: text ? 'gpt-image-2' : 'wanx2.1-imageedit',
      requestProfile: profiles[index], credentialRevision: 'historical-credential-revision', adapterRevision: erpCommit,
      endpoint, expectedHost: new URL(endpoint).hostname,
      sourceSha256: text ? [] : [source.sha256], maskSha256: operation === 'INPAINT' ? mask.sha256 : null,
      quotedCost: { currency: text ? 'USD' : 'CNY', amount: 14, scale: 2 },
      maximumCost: { currency: text ? 'USD' : 'CNY', amount: 100, scale: 2 },
      approverRef: 'fixture-operator', providerAccountRef: 'fixture-account', pricingRevision: 'fixture-price',
      preCallBillingSnapshotRef: 'fixture-pre-call', billingReconciliationRef: 'fixture-reconciliation',
      approvedAt: '2026-08-01T10:00:00.000Z', expiresAt: '2026-08-01T11:00:00.000Z',
    });
    const approvalEvidence = { approvalId: `${id}-approval`, approvalSha256: approval.sha256,
      approvedAt: '2026-08-01T10:00:00.000Z', expiresAt: '2026-08-01T11:00:00.000Z',
      approverRefSha256: hash('fixture-operator'), providerAccountRefSha256: hash('fixture-account'), pricingRevisionSha256: hash('fixture-price'),
      currency: text ? 'USD' : 'CNY', preCallBillingSnapshotRefSha256: hash('fixture-pre-call'), billingReconciliationRefSha256: hash('fixture-reconciliation') };
    const report = {
      schemaVersion: 5, operationId: id, state: 'SUCCEEDED', operation, requestProfile: profiles[index],
      credentialRevision: 'historical-credential-revision', adapterRevision: erpCommit,
      provider: text ? 'custom-openai-compatible' : 'dashscope-wanx21-image-edit', model: text ? 'gpt-image-2' : 'wanx2.1-imageedit',
      apiBaseSha256: 'c'.repeat(64), operationEndpointSha256: hash(endpoint), approvalEvidence,
      promptSha256: hash(`prompt-${index}`), sourceSha256: text ? [] : [source.sha256], maskSha256: operation === 'INPAINT' ? mask.sha256 : null,
      requestedSize: `1024x${height}`, createRequests: 1, imageCount: 1, mimeType: 'image/png', width: 1024, height,
      bytes: readFileSync(image.path).length, sha256: image.sha256, providerRequestIdHash: hash(id), usage: null,
      startedAt: '2026-08-01T10:01:00.000Z', completedAt: '2026-08-01T10:02:00.000Z', elapsedMs: 60000,
      actualCost: null, quotedCost: { currency: text ? 'USD' : 'CNY', amount: 14, scale: 2 },
      maximumCost: { currency: text ? 'USD' : 'CNY', amount: 100, scale: 2 }, intentPath: '/historical/intent.json', imagePath: '/historical/output.png',
    };
    const request = { operation, requestProfile: report.requestProfile, n: 1, width: 1024, height, size: report.requestedSize,
      promptSha256: report.promptSha256, sourceSha256: report.sourceSha256, sourceDimensions: text ? [] : [{ width: 1024, height: 1024 }],
      maskSha256: report.maskSha256, maskDimensions: operation === 'INPAINT' ? { width: 1024, height: 1024 } : null, approvalEvidence };
    const fingerprintRequest = { ...(text ? {} : { operation, requestProfile: report.requestProfile,
      providerTransport: 'DASHSCOPE_WANX21_ASYNC_JSON_DATA_URL_V1',
      providerFunction: operation === 'INPAINT' ? 'description_edit_with_mask' : 'description_edit' }),
      n: 1, size: report.requestedSize, promptSha256: report.promptSha256, sourceSha256: report.sourceSha256, maskSha256: report.maskSha256 };
    const intent = put(`${id}.intent.json`, { schemaVersion: 3, operationId: id, state: 'SUBMITTING',
      endpointSha256: report.operationEndpointSha256, apiBaseSha256: report.apiBaseSha256, model: report.model,
      credentialRevision: report.credentialRevision, adapterRevision: erpCommit,
      requestFingerprint: hash(sortedJson({ endpointSha256: report.operationEndpointSha256, model: report.model, request: fingerprintRequest })), request,
      quotedCost: report.quotedCost, maximumCost: report.maximumCost, createdAt: report.startedAt });
    const reportRef = put(`${id}.report.json`, report);
    if (text) return { operation, report: reportRef, intent, approval, image,
      observation: put(`${id}.observation.json`, { schemaVersion: 1, kind: 'PRIVATE_PROVIDER_PILOT_OBSERVATION_NOT_SETTLEMENT', operationId: id,
        deployedCommit: erpCommit, recordedAt: '2026-08-01T10:03:00.000Z', submitReportSha256: reportRef.sha256,
        intentSha256: intent.sha256, approvalSha256: approval.sha256, requestFingerprint: get(intent).requestFingerprint,
        technicalState: 'SUCCEEDED', createRequests: 1, imageCount: 1,
        image: { sha256: image.sha256, width: 1024, height, bytes: report.bytes, mimeType: 'image/png' },
        visualReview: 'One valid studio product image observed.', billing: { status: 'HISTORICAL_METER_DIFFERENCE', perRequestLimitExceededByLog: true, actualCost: null },
        noAutomaticRetry: true, qa02Complete: false, qa04AcceptanceIssued: false }) };
    const asyncEvidence = put(`${id}.async.json`, { schemaVersion: 1, operationId: id, provider: report.provider, model: report.model,
      operation, requestProfile: report.requestProfile, adapterRevision: erpCommit, requestFingerprint: get(intent).requestFingerprint,
      apiBaseSha256: report.apiBaseSha256, operationEndpointSha256: report.operationEndpointSha256,
      sourceSha256: report.sourceSha256, maskSha256: report.maskSha256, transportMaskSha256: operation === 'INPAINT' ? hash('transport-mask') : null,
      transport: 'DASHSCOPE_WANX21_ASYNC_JSON_DATA_URL_V1', providerFunction: operation === 'INPAINT' ? 'description_edit_with_mask' : 'description_edit',
      providerOutcome: 'SUCCEEDED', state: 'ACCEPTED', createRequests: 1, pollRequests: 2, resultDownloads: 1,
      providerTaskIdHash: report.providerRequestIdHash, providerStatus: 'SUCCEEDED', usage: { imageCount: 1 } });
    const technicalReview = put(`${id}.technical.json`, { schemaVersion: 1, event: 'AI_IMAGE_PROVIDER_EDIT_CAPABILITY_TECHNICAL_REVIEW',
      operationId: id, operation, provider: report.provider, model: report.model, requestProfile: report.requestProfile,
      reportSha256: reportRef.sha256, asyncEvidenceSha256: asyncEvidence.sha256, sourceImageSha256: source.sha256,
      outputImageSha256: image.sha256, reviewedAt: '2026-08-01T10:03:00.000Z',
      billingStatus: 'UNRESOLVED_ACCOUNT_IDENTITY_MISMATCH', output: { mimeType: 'image/png', width: 1024, height, byteLength: report.bytes },
      ...(operation === 'INPAINT' ? { originalMaskSha256: mask.sha256, transportMaskSha256: hash('transport-mask') } : {}) });
    const humanConfirmation = put(`${id}.human.json`, { schemaVersion: 1, event: 'AI_IMAGE_PROVIDER_EDIT_CAPABILITY_HUMAN_QUALITY_CONFIRMATION',
      operationId: id, operation, decision: 'APPROVED', confirmationScope: 'IMAGE_QUALITY_ONLY', billingDecision: 'NOT_ATTESTED',
      reportSha256: reportRef.sha256, technicalReviewSha256: technicalReview.sha256, outputImageSha256: image.sha256,
      confirmedAt: '2026-08-01T10:04:00.000Z' });
    return { operation, report: reportRef, intent, approval, image, asyncEvidence, technicalReview, humanConfirmation, source,
      ...(operation === 'INPAINT' ? { mask } : {}) };
  });
  const counterexamples = ['FULL_EDIT', 'INPAINT'].map(operation => {
    const positive = technical.find(row => row.operation === operation), report = get(positive.report);
    report.operationId += '-later'; report.promptSha256 = hash(report.operationId); report.credentialRevision = 'later-revision';
    report.startedAt = '2026-09-01T10:00:00.000Z'; report.completedAt = '2026-09-01T10:01:00.000Z';
    const ref = put(`${operation}.counter.report.json`, report);
    return { report: ref, review: put(`${operation}.counter.review.json`, { schemaVersion: 1,
      kind: 'ASSISTANT_REVIEWED_WANX_OUTPUT', operationId: report.operationId, reportSha256: ref.sha256,
      sourceSha256: source.sha256, resultSha256: report.sha256, technicalState: 'SUCCEEDED', requestedQualityState: 'NOT_ACCEPTED' }) };
  });
  const output = technical.find(row => row.operation === 'FULL_EDIT').image;
  const workflow = { idSha256: hash('workflow'), operation: 'FULL_EDIT', status: 'SUCCEEDED', currentAttempt: 1, reviewStatus: 'APPROVED', revision: 5 };
  const job = { idSha256: hash('job'), status: 'SUCCEEDED', attemptCount: 1, providerJobIdSha256: hash('provider-task'), providerReconciliationStatus: 'NOT_REQUIRED',
    startedAt: '2026-09-15T10:00:00.000Z', completedAt: '2026-09-15T10:01:00.000Z', pricing: { currency: 'CNY', unitCostCents: 14, requestedImageCount: 1, maximumCostCents: 14 }, actualCostCents: 14, billedUnits: 1 };
  const outputRow = { idSha256: hash('output'), sha256: output.sha256, width: 1024, height: 1024, mimeType: 'image/png',
    sizeBytes: readFileSync(output.path).length, storageBackend: 'oss', generatedCount: 1, rawCount: 1 };
  const cost = { reservationCount: 1, status: 'SETTLED', currency: 'CNY', maximumCostMinor: 14, settlementCount: 1, chargeCount: 1, chargeKind: 'CHARGE', actualCostMinor: 14, billedUnits: 1 };
  const target = { idSha256: hash('target'), imageCount: 2, originalPreserved: true, outputIncluded: true, applicationCount: 1 };
  const events = ['CREATED', 'JOB_STARTED', 'PROVIDER_DISPATCH_STARTED', 'PROVIDER_SUBMITTED', 'PROVIDER_OUTPUT_PERSISTED', 'JOB_SUCCEEDED'];
  const stages = {};
  for (const phase of ['generated', 'applied', 'restored']) stages[phase] = put(`erp-${phase}.json`, { kind: 'NORMAL_IMAGE_DATABASE_VERIFICATION', status: 'PASS', phase, gitCommit: erpCommit,
    at: `2026-09-15T10:0${phase === 'generated' ? 2 : phase === 'applied' ? 4 : 6}:00.000Z`, ownerSha256: identity,
    workflow: { ...workflow, ...(phase === 'generated' ? { reviewStatus: 'PENDING', revision: 3 } : {}) }, job, cost, output: outputRow,
    target: phase === 'generated' ? { ...target, imageCount: 1, outputIncluded: false, applicationCount: 0 } : target,
    eventTypes: phase === 'generated' ? events : [...events, 'REVIEW_APPROVED', 'APPLIED'] });
  const controllerStatus = put('controller-status.json', { ok: true, result: { schemaVersion: 1, action: 'status', phase: 'restored', commit: erpCommit,
    ownerSha256: identity, credentialRevision: 4, masterEnabled: true, workflowEnabled: false,
    sharedDailyBudgetModified: false, legacyTextAiModified: false,
    pending: { jobs: 0, costs: 0, recovery: 0, workflows: 0 } } });
  const acceptance = put('erp-acceptance.json', { schemaVersion: 1, kind: 'NORMAL_IMAGE_REAL_FLOW_ACCEPTANCE', status: 'PASS', gitCommit: erpCommit, region: 'COM',
    completedAt: '2026-09-15T10:07:00.000Z', operation: 'FULL_EDIT', provider: 'dashscope-wanx', model: 'wanx2.1-imageedit',
    successfulImages: 1, currency: 'CNY', unitCostCents: 14, actualCostCents: 14, workflowRequests: 1, providerAttempts: 1,
    chargeSettlements: 1, reviewRequests: 1, appendRequests: 1, targetImageCount: 2, originalImagePreserved: true,
    configRestored: true, credentialRevisionAfterRestore: 4, pending: { jobs: 0, costs: 0, recovery: 0, workflows: 0 }, workflow, job, output: outputRow,
    browser: { realSignedInAccount: true, isolatedContext: true, contextDisposed: true, manualTaskRefreshUsed: true },
    excluded: { supplierInvoiceReconciliation: true, newOzonWrites: true, otherImageOperations: true, fullProductionMv3Flow: true, formalQa04: true, rel04: true, websitePublication: true },
    evidence: [{ file: stages.restored.path, sha256: stages.restored.sha256 }, { file: controllerStatus.path, sha256: controllerStatus.sha256 }] });
  const input = { schemaVersion: 1, kind: 'SS_ERP_QA04_FINAL_INPUTS', scope: 'NORMAL_AI_TECHNICAL_AND_CONFIRMED_PRICE_V1', targetGitCommit,
    offline: { receipt: put('offline.json', native), log: put('offline.log', log.join('\n')) }, technical, counterexamples,
    normalErp: { acceptance, ...stages, controllerStatus, image: output } };
  const inputPath = path.join(evidenceRoot, 'input.json');
  const save = () => { writeFileSync(inputPath, json(input), { mode: 0o600 }); return hash(readFileSync(inputPath)); };
  const verify = extra => {
    assert.equal(typeof subject.verifyQa04FinalAcceptance, 'function', 'final evidence verifier must exist');
    return subject.verifyQa04FinalAcceptance({ inputPath, inputSha256: save(), repositoryRoot, now: NOW, ...extra });
  };
  return { root, repositoryRoot, evidenceRoot, inputPath, input, put, get, change, save, verify, git, targetGitCommit, erpCommit };
}

// New normal-ERP variant contract. These are synthetic Prisma-shaped records,
// not producer summaries: no caller-supplied PASS or count can replace them.
function draftFlowFixture(t, operation = 'IMAGE_TO_IMAGE') {
  const f = fixture(t), commit = f.targetGitCommit, ownerUserId = 'private-owner', workflowId = 'private-workflow';
  const jobId = 'private-job', outputId = 'private-output', sourceId = 'private-source', draftId = 'private-draft';
  const snapshotId = 'private-snapshot', shopId = 'private-shop', skuKey = null, slotKey = 'product:hero';
  const source = f.input.technical.find(row => row.operation === operation).source;
  const output = f.put('draft-output.png', png(1024, 1024, 49));
  const asset = (id, ref, kind) => ({ id, ownerUserId, sourceCaptureSnapshotId: snapshotId, kind,
    sha256: ref.sha256, width: 1024, height: 1024, mimeType: 'image/png', sizeBytes: readFileSync(ref.path).length, storageBackend: 'oss' });
  const sourceAsset = asset(sourceId, source, 'SOURCE_ORIGINAL');
  const outputAsset = { ...asset(outputId, output, 'AI_GENERATED'), aiImageJobId: jobId,
    ...(operation === 'IMAGE_TO_IMAGE' ? { width: null, height: null } : {}) };
  const inputs = [{ id: 'input-source', workflowId, ownerUserId, assetId: sourceId, role: 'REFERENCE', ordinal: 0, assetSha256: source.sha256, asset: sourceAsset }];
  const mask = operation === 'INPAINT' ? f.input.technical.find(row => row.operation === operation).mask : null;
  if (mask) inputs.push({ id: 'input-mask', workflowId, ownerUserId, assetId: 'private-mask', role: 'MASK', ordinal: 0,
    assetSha256: mask.sha256, asset: asset('private-mask', mask, 'MASK') });
  const runtime = { contractVersion: 'ai-image-provider-runtime/v3', provider: 'dashscope-wanx', model: 'wanx2.1-imageedit',
    baseUrlSha256: hash('https://dashscope.aliyuncs.com/api/v1'), currency: 'CNY', unitCostCents: 14, imageCount: 1,
    width: 1024, height: 1024, maximumCostCents: 14,
    credentialRevision: { recordId: 'private-credential-record', revision: 9, updatedAt: '2026-09-16T10:25:00.000Z' } };
  const job = { id: jobId, ownerUserId, actorUserId: ownerUserId, workflowId, workflowAttempt: 1, executionMode: 'ERP_HOSTED', operation,
    provider: runtime.provider, model: runtime.model, status: 'SUCCEEDED', attemptCount: 1, requestedImageCount: 1,
    width: 1024, height: 1024, estimatedCostCents: 14, actualCostCents: 14, billedUnits: 1,
    requestFingerprint: hash('job-request'), operationConfig: operation === 'IMAGE_TO_IMAGE' ? runtime : { providerRuntime: runtime },
    providerJobId: 'private-provider-job', providerReconciliationStatus: 'NOT_REQUIRED',
    startedAt: '2026-09-16T10:30:00.000Z', providerDispatchedAt: '2026-09-16T10:30:01.000Z', completedAt: '2026-09-16T10:31:00.000Z',
    appliedAt: null, appliedMode: null, applyTargetType: null, applyTargetId: null };
  const workflow = { id: workflowId, ownerUserId, actorUserId: ownerUserId, operation, status: 'SUCCEEDED', currentAttempt: 1,
    revision: 3, reviewStatus: 'PENDING', selectedOutputAssetId: null, reviewedByUserId: null, reviewedAt: null,
    idempotencyKey: 'private-create-key', contextType: 'listing-draft', contextId: draftId,
    contextSkuKey: skuKey, contextSlotKey: slotKey, contextDraftRevision: 1, contextDraftVersion: 1 };
  const reservation = { id: 'private-reservation', ownerUserId, actorUserId: ownerUserId, jobId, workflowId, operation,
    provider: runtime.provider, model: runtime.model, status: 'SETTLED', currency: 'CNY', estimatedCostMinor: 14, maximumCostMinor: 14,
    requestFingerprint: hash('reservation-request'), providerRequestId: job.providerJobId, settledAt: job.completedAt };
  const settlement = { id: 'private-settlement', reservationId: reservation.id, ownerUserId, actorUserId: ownerUserId,
    kind: 'CHARGE', actualCostMinor: 14, billedUnits: 1, requestFingerprint: hash('settlement-request'), createdAt: job.completedAt };
  const assignment = { scope: 'PRODUCT', slotKey, assetId: outputId, source: operation === 'INPAINT' ? 'EDITED' : 'GENERATED' };
  const beforeState = { version: 'ai-media-listing-draft-assignment/v1', assignment: null };
  const afterState = { version: beforeState.version, assignment };
  const application = { id: 'private-application', ownerUserId, actorUserId: ownerUserId, workflowId, jobId, assetId: outputId,
    sourceCaptureSnapshotId: snapshotId, operation, kind: 'APPLY', revision: 1, rollbackOfId: null, rolledBackBy: null,
    targetId: draftId, targetSequence: 1, mode: 'APPEND', replaceConfirmed: false, contextSkuKey: skuKey, contextSlotKey: slotKey,
    contextDraftRevision: 1, contextDraftVersion: 1, operationKey: 'private-apply-key', requestFingerprint: hash('application-request'),
    workflowRevisionBefore: 4, workflowRevisionAfter: 5, targetRevisionBefore: 1, targetDraftVersionBefore: 1,
    targetRevisionAfter: 2, targetDraftVersionAfter: 2, beforeState, beforeStateHash: hash(sortedJson(beforeState)),
    afterState, afterStateHash: hash(sortedJson(afterState)), createdAt: '2026-09-16T10:33:30.000Z' };
  const baseTypes = ['CREATED', 'JOB_STARTED', 'PROVIDER_DISPATCH_STARTED', 'PROVIDER_SUBMITTED',
    ...(operation === 'INPAINT' ? ['PROVIDER_OUTPUT_PERSISTED'] : []), 'JOB_SUCCEEDED'];
  const event = (eventType, at) => {
    const payload = eventType === 'LISTING_DRAFT_APPLIED' ? { version: 'ai-media-listing-draft-application/v1', applicationId: application.id,
      kind: 'APPLY', rollbackOfId: null, operationKey: application.operationKey, mode: 'append', targetType: 'listing-draft',
      targetId: draftId, targetSequence: 1, targetRevision: 2, targetDraftVersion: 2, contextSkuKey: skuKey, contextSlotKey: slotKey }
      : eventType === 'PROVIDER_SUBMITTED' ? { providerJobId: job.providerJobId, providerAcceptedAt: '2026-09-16T10:30:02.000Z' }
        : eventType === 'JOB_SUCCEEDED' ? { outputAssetIds: [outputId] }
          : eventType === 'PROVIDER_OUTPUT_PERSISTED' ? { outputAssetId: 'private-raw', sha256: hash('raw-provider-output') }
            : eventType === 'JOB_STARTED' ? { attempt: 1 }
              : eventType === 'PROVIDER_DISPATCH_STARTED' ? { providerDispatchedAt: job.providerDispatchedAt }
                : eventType === 'REVIEW_APPROVED' ? { note: null }
                  : operation === 'IMAGE_TO_IMAGE' ? { operation, attempt: 1, referenceCount: 1 }
                    : { operation, attempt: 1, sourceAssetId: sourceId, maskAssetId: 'private-mask', maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1' };
    return { id: 'event-' + eventType, workflowId, ownerUserId, actorUserId: ownerUserId,
      jobId: eventType === 'REVIEW_APPROVED' ? null : jobId,
      assetId: ['REVIEW_APPROVED', 'LISTING_DRAFT_APPLIED'].includes(eventType) ? outputId : null,
      eventKey: 'event-key-' + eventType, eventType,
      // JSONB does not retain the writer's key insertion order. Worker/media
      // events hash that original order; listing application events canonicalize.
      payload: Object.fromEntries(Object.entries(payload).reverse()),
      payloadHash: hash(eventType === 'LISTING_DRAFT_APPLIED' ? sortedJson(payload) : JSON.stringify(payload)), createdAt: at };
  };
  const baseEvents = baseTypes.map(type => event(type, job.completedAt));
  const references = {};
  for (const phase of ['generated', 'applied', 'restored']) {
    const first = phase === 'generated';
    const payload = { id: draftId, ownerUserId, shopId, supplyGoodsId: 'private-goods', sourceCaptureSnapshotId: snapshotId,
      revision: first ? 1 : 2, draftVersion: first ? 1 : 2, selectedSkuKeys: ['__ss_erp_product_only__'], media: { assignments: first ? [] : [assignment] } };
    const draft = { id: first ? 'private-draft-version-1' : 'private-draft-version-2', workflowId: draftId, ownerUserId,
      actorUserId: ownerUserId, shopId, sourceCaptureSnapshotId: snapshotId, revision: payload.revision, draftVersion: payload.draftVersion,
      selectedSkuKeys: payload.selectedSkuKeys, payload, payloadHash: hash(sourceDraftJson(payload)) };
    const snapshot = { schemaVersion: 1, kind: 'NORMAL_IMAGE_DRAFT_DATABASE_SNAPSHOT', gitCommit: commit, region: 'COM', phase,
      at: `2026-09-16T10:${first ? '32' : phase === 'applied' ? '34' : '36'}:00.000Z`, ownerUserId, actorUserId: ownerUserId,
      workflow: first ? workflow : { ...workflow, revision: 5, reviewStatus: 'APPROVED', selectedOutputAssetId: outputId,
        reviewedByUserId: ownerUserId, reviewedAt: '2026-09-16T10:33:00.000Z' },
      jobs: [first ? job : { ...job, appliedAt: application.createdAt, appliedMode: 'append', applyTargetType: 'listing-draft', applyTargetId: draftId }],
      inputs, outputs: [outputAsset, ...(operation === 'INPAINT' ? [{ ...outputAsset, id: 'private-raw', kind: 'AI_PROVIDER_OUTPUT', sha256: hash('raw-provider-output') }] : [])],
      reservations: [reservation], settlements: [settlement], draft, applications: first ? [] : [application],
      events: first ? baseEvents : [...baseEvents, event('REVIEW_APPROVED', '2026-09-16T10:33:00.000Z'), event('LISTING_DRAFT_APPLIED', application.createdAt)] };
    references[phase] = f.put(`draft-${phase}.json`, { snapshot });
  }
  const qualification = { schemaVersion: 1, kind: 'SS_ERP_COMPLETION_BOOTSTRAP_RECEIPT', action: 'restore', phase: 'restored', commit,
    ownerSha256: hash(ownerUserId), currency: 'CNY', unitCostCents: 14, maximumTaskCostCents: 14, workflowEnabled: false,
    sharedDailyBudgetModified: false, userDailyLimitModified: false, legacyTextAiModified: false,
    pending: { jobs: 0, costs: 0, recovery: 0, workflows: 0, suites: 0 }, backupSha256: hash('encrypted-backup'),
    credentialRevisionBefore: 8, credentialRevisionAfter: 10, restoredAt: '2026-09-16T10:35:00.000Z',
    candidate: { gitCommit: commit, offlineSha256: f.input.offline.receipt.sha256,
      releaseEvidenceSha256: hash('candidate'), signatureSha256: hash('signature'), vpsSha256: hash('vps') } };
  const controllerStatus = f.put('draft-controller.json', { result: { qualification } });
  const browser = f.put('draft-browser.json', { browser: { schemaVersion: 1, kind: 'NORMAL_IMAGE_DRAFT_BROWSER_EXECUTION',
    gitCommit: commit, ownerUserId, operation, workflowId, jobId, outputAssetId: outputId, sourceSha256: source.sha256, outputSha256: output.sha256,
    startedAt: '2026-09-16T10:28:00.000Z', completedAt: '2026-09-16T10:37:00.000Z', realSignedInAccount: true,
    isolation: { kind: 'DEDICATED_QA_PROFILE', profileSha256: hash('qa-profile'), debuggingPort: 9444, protectedDebuggingPort: 9222 },
    ownedTargetsClosed: true, originalBrowserPreserved: true } });
  const interactions = f.put('draft-interactions.json', { actions: { schemaVersion: 1, kind: 'NORMAL_IMAGE_DRAFT_UI_INTERACTIONS', gitCommit: commit, ownerUserId, operation,
    creates: [{ at: '2026-09-16T10:29:00.000Z', workflowId, jobId, operation, sourceAssetId: sourceId, maskAssetId: mask ? 'private-mask' : null,
      idempotencyKey: workflow.idempotencyKey }],
    reviews: [{ at: '2026-09-16T10:33:00.000Z', workflowId, outputAssetId: outputId, decision: 'APPROVE', expectedRevision: 3 }],
    applications: [{ at: '2026-09-16T10:33:30.000Z', workflowId, jobId, outputAssetId: outputId, applicationId: application.id,
      mode: 'append', operationKey: application.operationKey, expectedWorkflowRevision: 4, expectedTargetRevision: 1, expectedTargetDraftVersion: 1 }] } });
  const acceptance = f.put('draft-flow-inputs.json', { schemaVersion: 1, kind: 'NORMAL_IMAGE_DRAFT_FLOW_INPUTS', operation,
    pointers: { generated: '/snapshot', applied: '/snapshot', restored: '/snapshot', controllerStatus: '/result/qualification' },
    source, ...(mask ? { mask } : {}), browser: { ...browser, pointer: '/browser' }, interactions: { ...interactions, pointer: '/actions' } });
  f.input.normalErp = { acceptance, ...references, controllerStatus, image: output };
  const changeMapped = (name, mutate) => {
    const ref = name === 'browser' ? browser : interactions;
    f.change(ref, mutate);
    f.change(f.input.normalErp.acceptance, value => { value[name].sha256 = ref.sha256; });
  };
  return { ...f, browser, interactions, operation, changeMapped };
}

function historicalDraftFlowFixture(t, operation = 'IMAGE_TO_IMAGE') {
  const f = draftFlowFixture(t, operation), executionGitCommit = f.targetGitCommit;
  const executionOfflineQa04 = structuredClone(f.input.offline), originalManifest = f.get(f.input.normalErp.acceptance);
  const originals = [...Object.values(f.input.normalErp), ...Object.values(executionOfflineQa04),
    originalManifest.source, originalManifest.browser, originalManifest.interactions,
    ...(originalManifest.mask ? [originalManifest.mask] : [])].map(ref => ({ path: ref.path, sha256: ref.sha256 }));
  const extensionFile = 'extensions/ss-erp/pages/source-preview.js';
  mkdirSync(path.dirname(path.join(f.repositoryRoot, extensionFile)), { recursive: true });
  writeFileSync(path.join(f.repositoryRoot, extensionFile), 'extension image transport repair\n');
  f.git('add', '--', extensionFile); f.git('commit', '-qm', 'repair extension source preview');
  const targetGitCommit = f.git('rev-parse', 'HEAD');
  f.input.targetGitCommit = targetGitCommit;
  f.input.offline = {
    receipt: f.put('target-offline.json', { ...f.get(executionOfflineQa04.receipt), gitCommit: targetGitCommit,
      startedAt: '2026-09-16T11:00:00.000Z', completedAt: '2026-09-16T11:20:00.000Z' }),
    log: f.put('target-offline.log', readFileSync(executionOfflineQa04.log.path, 'utf8')
      .replace(executionGitCommit, targetGitCommit).replace('459 pass(es)', '472 pass(es)')),
  };
  f.input.normalErp.acceptance = f.put('historical-draft-flow-inputs.json', {
    ...originalManifest, schemaVersion: 2, executionGitCommit, executionOfflineQa04,
  });
  const changeExecutionOffline = (name, mutate) => {
    const reference = executionOfflineQa04[name];
    f.change(reference, mutate);
    f.change(f.input.normalErp.acceptance, value => { value.executionOfflineQa04[name].sha256 = reference.sha256; });
  };
  return { ...f, targetGitCommit, executionGitCommit, executionOfflineQa04, originals, changeExecutionOffline };
}

function historicalRestrictedSuiteFixture(t) {
  const f = suiteFlowFixture(fixture(t), png), executionGitCommit = f.targetGitCommit;
  const executionOfflineQa04 = structuredClone(f.input.offline), manifest = f.get(f.input.normalErp.acceptance);
  const extensionFile = 'extensions/ss-erp/pages/ai-image-workbench-hosted.js';
  mkdirSync(path.dirname(path.join(f.repositoryRoot, extensionFile)), { recursive: true });
  writeFileSync(path.join(f.repositoryRoot, extensionFile), 'authority refresh repair\n');
  f.git('add', '--', extensionFile); f.git('commit', '-qm', 'repair hosted authority refresh');
  const targetGitCommit = f.git('rev-parse', 'HEAD');
  f.input.targetGitCommit = targetGitCommit;
  f.input.offline = {
    receipt: f.put('suite-target-offline.json', { ...f.get(executionOfflineQa04.receipt), gitCommit: targetGitCommit,
      startedAt: '2026-09-16T11:00:00.000Z', completedAt: '2026-09-16T11:20:00.000Z' }),
    log: f.put('suite-target-offline.log', readFileSync(executionOfflineQa04.log.path, 'utf8')
      .replace(executionGitCommit, targetGitCommit).replace('459 pass(es)', '476 pass(es)')),
  };
  const source = f.put('suite-source.jpg', jpeg(1024, 1024));
  const reference = source;
  f.change(manifest.workbench, value => { value.sourceSha256 = source.sha256; });
  const updateDatabaseSource = databaseReference => f.change(databaseReference, value => {
    const lineage = value.suiteReferences[0];
    Object.assign(lineage, { assetSha256: reference.sha256, rawSourceSha256: source.sha256,
      sizeBytes: readFileSync(reference.path).length, width: 1024, height: 1024, mimeType: 'image/jpeg' });
    for (const row of value.rows) {
      Object.assign(row.job.frozenInputs[0], { sha256: reference.sha256, sizeBytes: readFileSync(reference.path).length });
      row.workflow.inputs[0].assetSha256 = reference.sha256;
      Object.assign(row.workflow.inputAssets[0], { sourceSha256: source.sha256, sha256: reference.sha256,
        sizeBytes: readFileSync(reference.path).length, width: 1024, height: 1024, mimeType: 'image/jpeg' });
    }
  });
  updateDatabaseSource(f.input.normalErp.generated);
  updateDatabaseSource(f.input.normalErp.restored);
  f.change(manifest.queue, value => {
    value.retentionPolicy = 'REMOVE_ON_COMPLETE';
    value.jobs = [];
  });
  for (const [key, id] of [['startResponse', 'suite-start-receipt'], ['continueResponse', 'suite-continue-receipt']]) {
    f.change(manifest[key], value => {
      const result = value.body.data;
      value.status = 202;
      value.body.data = { receipt: { id, grantId: id + '-grant', status: 'SUCCEEDED', result,
        failureCode: null, createdAt: value.at, completedAt: value.at }, replay: false };
    });
  }
  const generated = f.get(f.input.normalErp.generated), ownerSha256 = generated.rows[0].job.ownerSha256;
  const pilot = (observedAt) => ({ kind: 'SS_ERP_CURRENT_HOSTED_PILOT_RUNTIME_ACCEPTANCE', observedAt,
    gitCommit: executionGitCommit, version: '1.0.354', region: 'COM', providerRequests: 0, ozonWrites: 0,
    result: { expectation: 'hosted-pilot', ownerSha256, shopIds: ['private-shop'], deviceCount: 2,
      allowedOperations: ['IMAGE_TO_IMAGE', 'SUITE'], rolloutRevision: 11, sourcePolicyRevision: 'pilot-11' } });
  f.input.normalErp.controllerStatus = f.put('suite-restricted-pilot-control.json', {
    schemaVersion: 1, kind: 'SS_ERP_RESTRICTED_PILOT_EXECUTION_CONTROL', gitCommit: executionGitCommit,
    version: '1.0.354', region: 'COM', ownerSha256, currency: 'CNY', maximumTaskCostCents: 28,
    configurationChanged: false, pending: { jobs: 0, costs: 0, recovery: 0, workflows: 0, suites: 0 },
    before: pilot('2026-09-16T10:23:00.000Z'), after: pilot('2026-09-16T10:36:00.000Z'),
  });
  manifest.schemaVersion = 2;
  manifest.executionGitCommit = executionGitCommit;
  manifest.executionOfflineQa04 = executionOfflineQa04;
  manifest.source = source;
  manifest.referenceImage = reference;
  f.input.normalErp.acceptance = f.put('suite-v2-inputs.json', manifest);
  f.save();
  return { ...f, executionGitCommit, executionOfflineQa04, targetGitCommit };
}

function postApplicationDerivedSuiteFixture(t) {
  const f = historicalRestrictedSuiteFixture(t), manifest = f.get(f.input.normalErp.acceptance);
  const applied = f.get(f.input.normalErp.applied), binding = f.get(manifest.workbench);
  manifest.schemaVersion = 3;
  manifest.databaseEvidenceMode = 'POST_APPLICATION_EVENT_DERIVATION_V1';
  f.change(manifest.generatedUi, value => { value.kind = 'REAL_HOSTED_SUITE_GENERATED_READBACK'; });
  const event = (row, eventType, createdAt, payload, assetId = null) => ({
    eventKey: `${row.workflow.id}:${eventType}:${row.job.id}`,
    eventType,
    jobId: row.job.id,
    assetId,
    payload,
    payloadHash: hash(sortedJson(payload)),
    createdAt,
  });
  for (const [phase, observedAt] of [['generated', '2026-09-16T10:36:30.000Z'], ['restored', '2026-09-16T10:37:00.000Z']]) {
    f.change(f.input.normalErp[phase], database => {
      database.observedAt = observedAt;
      database.rows = database.rows.map((row, index) => {
        const output = row.outputs[0], slotId = `suite-slot-${index}`;
        const events = [
          event(row, 'CREATED', `2026-09-16T10:29:1${index}.000Z`, { suiteId: 'private-suite', slotId }),
          event(row, 'JOB_STARTED', `2026-09-16T10:30:0${index}.000Z`, { attempt: 1 }),
          event(row, 'PROVIDER_DISPATCH_STARTED', `2026-09-16T10:30:1${index}.000Z`, { attempt: 1 }),
          event(row, 'PROVIDER_SUBMITTED', `2026-09-16T10:30:2${index}.000Z`, { providerJobIdSha256: row.job.providerJobIdSha256 }),
          event(row, 'PROVIDER_OUTPUT_PERSISTED', `2026-09-16T10:30:5${index}.000Z`, { outputAssetId: output.id, sha256: output.sha256 }),
          event(row, 'JOB_SUCCEEDED', row.job.completedAt, { outputAssetId: output.id }),
          event(row, 'REVIEW_APPROVED', index === 0 ? '2026-09-16T10:33:59.500Z' : '2026-09-16T10:34:00.500Z', {
            version: 'ai-image-suite-candidate-review/v1',
            suiteId: 'private-suite',
            slotId,
            workflowId: row.workflow.id,
            jobId: row.job.id,
            outputAssetId: output.id,
            actorUserId: 'private-suite-owner',
            decision: 'APPROVE',
            expectedWorkflowRevision: 3,
          }, output.id),
        ];
        return { ...row, workflow: { ...row.workflow, reviewStatus: 'APPROVED', revision: 4,
          selectedOutputAssetId: output.id, eventTypes: events.map(value => value.eventType), events } };
      });
      database.draftVersions = [
        { revision: applied.before.revision, draftVersion: applied.before.draftVersion, parentRevision: null,
          payload: applied.before, payloadHash: hash(sourceDraftJson(applied.before)), createdAt: '2026-09-16T10:24:00.000Z' },
        { revision: applied.after.revision, draftVersion: applied.after.draftVersion, parentRevision: applied.before.revision,
          payload: applied.after, payloadHash: hash(sourceDraftJson(applied.after)), createdAt: applied.at },
      ];
      database.draftSnapshot = { id: binding.draftId, currentRevision: applied.after.revision,
        currentDraftVersion: applied.after.draftVersion, payload: applied.after, payloadHash: hash(sourceDraftJson(applied.after)) };
      database.listingAssignments = applied.items.map((item, index) => ({
        assignmentId: applied.response.body.data.assignments[index].assignmentId,
        batchId: applied.response.body.data.batchId,
        batchItemOrdinal: index,
        listingWorkflowId: binding.draftId,
        skuKey: item.skuKey,
        slotKey: item.slotKey,
        assignmentScope: applied.response.body.data.assignments[index].assignmentScope,
        assignmentOrdinal: applied.response.body.data.assignments[index].assignmentOrdinal,
        assetId: item.outputAssetId,
        assetSha256: database.rows[index].outputs[0].sha256,
        suiteSlotId: item.suiteSlotId,
        childWorkflowId: item.childWorkflowId,
        jobId: database.rows[index].job.id,
        sourceDraftRevision: applied.before.revision,
        sourceDraftVersion: applied.before.draftVersion,
        boundDraftRevision: applied.after.revision,
        boundDraftVersion: applied.after.draftVersion,
      }));
      database.ozonPublishAttempts = 0;
    });
  }
  f.input.normalErp.acceptance = f.put('suite-v3-inputs.json', manifest);
  f.save();
  return f;
}

for (const operation of ['IMAGE_TO_IMAGE', 'INPAINT']) {
  test(`derives current-code ${operation} draft acceptance from original records and pointer bindings`, t => {
    const f = draftFlowFixture(t, operation), result = f.verify();
    assert.equal(result.report.decision, 'PASS');
    assert.equal(result.report.provenance.normalErp.operation, operation);
    assert.equal(result.report.provenance.normalErp.executionCommit, f.targetGitCommit);
    assert.equal(result.report.provenance.normalErp.actualCostMinor, 14);
    assert.equal(result.report.provenance.normalErp.applicationCount, 1);
    assert.equal(result.report.provenance.normalErp.configurationRestored, true);
    assert.equal(result.report.provenance.normalErp.image.width, 1024);
    assert.equal(Object.hasOwn(result.report.provenance.normalErp, 'executionOfflineQa04'), false,
      'v1 reports must retain their original shape');
    if (operation === 'IMAGE_TO_IMAGE') assert.equal(f.get(f.input.normalErp.generated).snapshot.outputs[0].width, null,
      'actual nullable DB dimensions must not be filled in by the producer');
    assert.equal(result.report.provenance.fullProductionMv3Verified, false);
    assert.doesNotMatch(JSON.stringify(result.report), /private-owner|private-workflow|private-job|private-credential/u);
  });

  test(`bridges historical ${operation} draft originals with an explicit execution commit and its native offline run`, t => {
    const f = historicalDraftFlowFixture(t, operation), result = f.verify(), proof = result.report.provenance.normalErp;
    assert.equal(result.report.gitCommit, f.targetGitCommit);
    assert.equal(proof.executionCommit, f.executionGitCommit);
    assert.notEqual(proof.executionCommit, result.report.gitCommit);
    assert.equal(proof.sourceBridge.kind, 'IDENTICAL_ERP_SOURCE_AND_DEPENDENCIES');
    assert.deepEqual(proof.executionOfflineQa04, { gitCommit: f.executionGitCommit,
      receiptSha256: f.executionOfflineQa04.receipt.sha256, logSha256: f.executionOfflineQa04.log.sha256,
      startedAt: '2026-09-16T10:00:00.000Z', completedAt: '2026-09-16T10:20:00.000Z' });
    assert.equal(result.report.provenance.offline.receiptSha256, f.input.offline.receipt.sha256);
    assert.equal(result.report.extensionVerification.source.passed, 472);
    assert.equal(proof.actualCostMinor, 14);
    assert.equal(proof.targetUiProductionVerified, false);
    assert.equal(result.report.provenance.fullProductionMv3Verified, false);
    assert.equal(result.report.provenance.allConfigurationsPromoted, false);
    for (const reference of f.originals) assert.equal(hash(readFileSync(reference.path)), reference.sha256,
      'historical execution, controller and offline originals must not be rewritten');
  });
}

test('draft v2 requires both explicit execution fields without relaxing the v1 manifest', t => {
  const f = historicalDraftFlowFixture(t), reference = f.input.normalErp.acceptance, original = readFileSync(reference.path);
  for (const mutate of [value => { delete value.executionGitCommit; }, value => { delete value.executionOfflineQa04; },
    value => { value.schemaVersion = 1; }, value => { value.schemaVersion = 3; }, value => { value.status = 'PASS'; },
    value => { delete value.executionOfflineQa04.log; }]) {
    f.change(reference, mutate);
    assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_INVALID');
    Object.assign(reference, f.put(path.basename(reference.path), original));
  }
});

test('rejects an execution commit different from the original draft records even if ERP source is identical', t => {
  const f = historicalDraftFlowFixture(t), reference = f.input.normalErp.acceptance, original = readFileSync(reference.path);
  for (const commit of [f.targetGitCommit, f.erpCommit, 'not-a-commit']) {
    f.change(reference, value => { value.executionGitCommit = commit; });
    assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
    Object.assign(reference, f.put(path.basename(reference.path), original));
  }
});

test('keeps every historical draft phase, browser, action and restored candidate bound to the execution commit', t => {
  const f = historicalDraftFlowFixture(t);
  const cases = [
    ...['applied', 'restored'].map(phase => [f.input.normalErp[phase], value => { value.snapshot.gitCommit = f.targetGitCommit; }]),
    [f.input.normalErp.controllerStatus, value => { value.result.qualification.commit = f.targetGitCommit; }],
    [f.input.normalErp.controllerStatus, value => { value.result.qualification.candidate.gitCommit = f.targetGitCommit; }],
    [f.input.normalErp.controllerStatus, value => { value.result.qualification.candidate.offlineSha256 = f.input.offline.receipt.sha256; }],
  ];
  for (const [reference, mutate] of cases) {
    const original = readFileSync(reference.path);
    f.change(reference, mutate);
    assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_INVALID');
    Object.assign(reference, f.put(path.basename(reference.path), original));
  }
  for (const [name, key] of [['browser', 'browser'], ['interactions', 'actions']]) {
    const original = f.get(f[name]);
    f.changeMapped(name, value => { value[key].gitCommit = f.targetGitCommit; });
    assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_INVALID');
    f.changeMapped(name, value => { value[key].gitCommit = original[key].gitCommit; });
  }
  assert.equal(f.verify().report.provenance.normalErp.executionCommit, f.executionGitCommit);
});

test('rejects wrong-source, incomplete and forged original execution offline receipts', t => {
  const f = historicalDraftFlowFixture(t), original = f.get(f.executionOfflineQa04.receipt);
  for (const mutate of [value => { value.gitCommit = f.targetGitCommit; }, value => { value.kind = 'QA04_FINAL_ACCEPTANCE'; },
    value => { value.steps.pop(); }, value => { value.completesFormalTask = true; }, value => { value.status = 'UNKNOWN'; }]) {
    f.changeExecutionOffline('receipt', mutate);
    assert.throws(() => f.verify(), error => error.code === 'QA04_OFFLINE_INVALID');
    f.changeExecutionOffline('receipt', value => { Object.assign(value, structuredClone(original)); });
  }
});

test('requires the complete original execution offline log and its pinned bytes', t => {
  const f = historicalDraftFlowFixture(t), reference = f.executionOfflineQa04.log, original = readFileSync(reference.path, 'utf8');
  for (const log of [original.replace(f.executionGitCommit, f.targetGitCommit),
    original.replace('[qa04-offline] Workspace lint', '[qa04-offline] skipped lint'),
    original.replace('464 pass(es)', '0 pass(es)'), `${original}\n${original}`]) {
    Object.assign(reference, f.put(path.basename(reference.path), log));
    f.change(f.input.normalErp.acceptance, value => { value.executionOfflineQa04.log.sha256 = reference.sha256; });
    assert.throws(() => f.verify(), error => error.code === 'QA04_OFFLINE_INVALID');
  }
  Object.assign(reference, f.put(path.basename(reference.path), original));
  f.change(f.input.normalErp.acceptance, value => { value.executionOfflineQa04.log.sha256 = reference.sha256; });
  writeFileSync(reference.path, `${original}changed after pinning\n`);
  assert.throws(() => f.verify(), error => error.code === 'QA04_ARTIFACT_CHANGED');
});

test('rejects a job preceding its execution offline run and a run already stale when the job started', t => {
  const f = historicalDraftFlowFixture(t), original = f.get(f.executionOfflineQa04.receipt);
  for (const times of [
    { startedAt: '2026-09-16T10:20:00.000Z', completedAt: '2026-09-16T10:30:00.001Z' },
    { startedAt: '2026-09-15T10:00:00.000Z', completedAt: '2026-09-15T10:20:00.000Z' },
  ]) {
    f.changeExecutionOffline('receipt', value => { Object.assign(value, times); });
    assert.throws(() => f.verify(), error => error.code === 'QA04_OFFLINE_INVALID');
    f.changeExecutionOffline('receipt', value => { Object.assign(value, original); });
  }
});

test('checks historical offline freshness at execution while requiring a fresh independent target offline run', t => {
  const f = historicalDraftFlowFixture(t), now = '2026-09-17T12:00:00.000Z';
  f.change(f.input.offline.receipt, value => {
    value.startedAt = '2026-09-17T11:00:00.000Z'; value.completedAt = '2026-09-17T11:20:00.000Z';
  });
  assert.equal(f.verify({ now }).report.provenance.normalErp.executionCommit, f.executionGitCommit);
  assert.throws(() => f.verify({ now: '2026-09-18T12:00:00.000Z' }), error => error.code === 'QA04_OFFLINE_INVALID');
  f.input.offline = structuredClone(f.executionOfflineQa04);
  assert.throws(() => f.verify({ now }), error => error.code === 'QA04_OFFLINE_INVALID');
});

test('bridges historical suite evidence across website-publication-only server changes', t => {
  const f = historicalRestrictedSuiteFixture(t);
  const advance = message => {
    const previous = f.input.targetGitCommit;
    f.git('add', '--', 'apps/server'); f.git('commit', '-qm', message);
    f.input.targetGitCommit = f.git('rev-parse', 'HEAD');
    f.change(f.input.offline.receipt, value => { value.gitCommit = f.input.targetGitCommit; });
    Object.assign(f.input.offline.log, f.put(path.basename(f.input.offline.log.path),
      readFileSync(f.input.offline.log.path, 'utf8').replace(previous, f.input.targetGitCommit)));
  };
  writeFileSync(path.join(f.repositoryRoot, 'apps/server/src/services/extension-website-publication.ts'),
    'changed website publication validation\n');
  writeFileSync(path.join(f.repositoryRoot, 'apps/server/src/__tests__/extensions-download.test.ts'),
    'changed website publication tests\n');
  advance('change website publication validation');
  const result = f.verify();
  assert.equal(result.report.provenance.normalErp.sourceBridge.kind,
    'IDENTICAL_ERP_EXECUTION_SOURCE_AND_DEPENDENCIES');
  writeFileSync(path.join(f.repositoryRoot, 'apps/server/src/rule.ts'), 'changed production behavior\n');
  advance('change protected ERP source');
  assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
});

test('bridges only the exact audited order and extension-rule server transition', () => {
  assert.equal(typeof subject.verifyErpSource, 'function');
  const proof = subject.verifyErpSource(
    path.resolve('.'),
    '1570a17b99bd8c38b251282184a9d60322a72a5d',
    '21243a1a20d145818f88aa2fd236714f4f6fe541',
  );
  assert.equal(proof.kind, 'IDENTICAL_ERP_EXECUTION_SOURCE_AND_DEPENDENCIES');
  assert.equal(proof.exactExecutionNeutralServerFiles.length, 9);
  assert.throws(
    () => subject.verifyErpSource(
      path.resolve('.'),
      '1570a17b99bd8c38b251282184a9d60322a72a5d',
      'd0720b4fab237880f49e5f991ec84d2557fd33a8',
    ),
    error => error.code === 'QA04_ERP_SOURCE_CHANGED',
  );
});

for (const filename of ['apps/server/src/rule.ts', 'packages/shared/src/contracts.ts', 'pnpm-lock.yaml']) {
  test(`refuses historical draft evidence after ${filename} changes`, t => {
    const f = historicalDraftFlowFixture(t), previous = f.targetGitCommit;
    writeFileSync(path.join(f.repositoryRoot, filename), 'changed production behavior\n');
    f.git('add', '--', filename); f.git('commit', '-qm', 'change protected ERP source');
    f.input.targetGitCommit = f.git('rev-parse', 'HEAD');
    f.change(f.input.offline.receipt, value => { value.gitCommit = f.input.targetGitCommit; });
    Object.assign(f.input.offline.log, f.put(path.basename(f.input.offline.log.path),
      readFileSync(f.input.offline.log.path, 'utf8').replace(previous, f.input.targetGitCommit)));
    assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
  });
}

test('rejects reused asset identities even when every pointed stage and action agrees', t => {
  const f = draftFlowFixture(t);
  for (const phase of ['generated', 'applied', 'restored']) f.change(f.input.normalErp[phase], value => {
    const row = value.snapshot.inputs[0]; row.assetId = 'private-output'; row.asset.id = 'private-output';
  });
  f.changeMapped('interactions', value => { value.actions.creates[0].sourceAssetId = 'private-output'; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_INVALID');
});

test('preserves prior draft assignments while adding only the approved empty slot', t => {
  const f = draftFlowFixture(t), prior = { scope: 'PRODUCT', slotKey: 'product:detail-1', assetId: 'prior-source-asset', source: 'SOURCE' };
  for (const phase of ['generated', 'applied', 'restored']) f.change(f.input.normalErp[phase], value => {
    value.snapshot.draft.payload.media.assignments.unshift(prior);
    value.snapshot.draft.payloadHash = hash(sourceDraftJson(value.snapshot.draft.payload));
  });
  assert.equal(f.verify().report.provenance.normalErp.originalImagePreserved, true);
  for (const phase of ['applied', 'restored']) f.change(f.input.normalErp[phase], value => {
    value.snapshot.draft.payload.media.assignments.shift();
    value.snapshot.draft.payloadHash = hash(sourceDraftJson(value.snapshot.draft.payload));
  });
  assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_INVALID');
});

test('requires provider and output audit payloads to identify the same single job result', t => {
  const f = draftFlowFixture(t);
  for (const phase of ['generated', 'applied', 'restored']) f.change(f.input.normalErp[phase], value => {
    const event = value.snapshot.events.find(row => row.eventType === 'JOB_SUCCEEDED');
    event.payload.outputAssetIds = ['another-output']; event.payloadHash = hash(sortedJson(event.payload));
  });
  assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_INVALID');
});

test('refuses nested payload values outside the actual flat workflow-event contract', t => {
  const f = draftFlowFixture(t);
  for (const phase of ['applied', 'restored']) f.change(f.input.normalErp[phase], value => {
    const event = value.snapshot.events.find(row => row.eventType === 'REVIEW_APPROVED');
    event.payload = { note: { a: 1, b: 2 } }; event.payloadHash = hash(JSON.stringify(event.payload));
  });
  assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_INVALID');
});

test('requires raw current-code ERP records rather than a completion flag or an old commit', t => {
  const f = draftFlowFixture(t), ref = f.input.normalErp.acceptance, original = readFileSync(ref.path);
  f.change(ref, value => { value.status = 'PASS'; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_INVALID');
  Object.assign(ref, f.put(path.basename(ref.path), original));
  for (const phase of ['generated', 'applied', 'restored']) f.change(f.input.normalErp[phase], value => { value.snapshot.gitCommit = f.erpCommit; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
});

test('rejects an old execution merely reread and labelled with the current commit', t => {
  const f = draftFlowFixture(t);
  const makeHistorical = value => {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string' && item.startsWith('2026-09-16T10:')) value[key] = item.replace('2026-09-16', '2026-09-15');
      else if (item && typeof item === 'object') makeHistorical(item);
    }
  };
  for (const field of ['generated', 'applied', 'restored', 'controllerStatus']) f.change(f.input.normalErp[field], makeHistorical);
  f.changeMapped('browser', makeHistorical); f.changeMapped('interactions', makeHistorical);
  assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
});

test('rejects tampered draft workflow, owner, frozen price, charge or application facts', t => {
  const f = draftFlowFixture(t), refs = f.input.normalErp;
  const original = Object.fromEntries(['generated', 'applied', 'restored'].map(phase => [phase, readFileSync(refs[phase].path)]));
  for (const [phase, mutate] of [
    ['generated', value => { value.jobs[0].provider = 'fake'; }],
    ['generated', value => { value.ownerUserId = 'another-owner'; }],
    ['generated', value => { const config = value.jobs[0].operationConfig; (config.providerRuntime || config).unitCostCents = 1; }],
    ['generated', value => { value.reservations.push(value.reservations[0]); }],
    ['generated', value => { value.settlements.push(value.settlements[0]); }],
    ['generated', value => { value.settlements[0].kind = 'RELEASE'; }],
    ['generated', value => { value.settlements[0].actualCostMinor = 0; }],
    ['generated', value => { value.jobs[0].attemptCount = 2; }],
    ['generated', value => { value.outputs[0].ownerUserId = 'foreign-output-owner'; }],
    ['generated', value => { value.outputs[0].width = 1000; }],
    ['applied', value => { value.workflow.selectedOutputAssetId = 'another-output'; }],
    ['applied', value => { value.applications[0].mode = 'REPLACE'; }],
    ['applied', value => { value.applications[0].targetRevisionAfter += 1; }],
    ['applied', value => { value.draft.payload.media.assignments = []; value.draft.payloadHash = hash(sourceDraftJson(value.draft.payload)); }],
    ['restored', value => { value.applications = []; }],
    ['restored', value => { value.at = '2026-09-16T10:31:00.000Z'; }],
  ]) {
    f.change(refs[phase], value => mutate(value.snapshot));
    assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_INVALID');
    for (const name of Object.keys(original)) Object.assign(refs[name], f.put(path.basename(refs[name].path), original[name]));
  }
});

test('requires bound single UI actions and a closed dedicated browser on the same owner and output', t => {
  const f = draftFlowFixture(t);
  const original = { browser: readFileSync(f.browser.path), interactions: readFileSync(f.interactions.path) };
  for (const [name, mutate] of [
    ['interactions', value => { value.actions.creates.push(value.actions.creates[0]); }],
    ['interactions', value => { value.actions.reviews[0].decision = 'REJECT'; }],
    ['interactions', value => { value.actions.applications[0].operationKey = 'another-key'; }],
    ['interactions', value => { value.actions.creates[0].sourceAssetId = 'another-source'; }],
    ['browser', value => { value.browser.ownerUserId = 'another-owner'; }],
    ['browser', value => { value.browser.outputSha256 = hash('another-image'); }],
    ['browser', value => { value.browser.ownedTargetsClosed = false; }],
    ['browser', value => { value.browser.originalBrowserPreserved = false; }],
    ['browser', value => { value.browser.isolation.debuggingPort = value.browser.isolation.protectedDebuggingPort; }],
  ]) {
    f.changeMapped(name, mutate);
    assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_INVALID');
    const ref = name === 'browser' ? f.browser : f.interactions;
    Object.assign(ref, f.put(path.basename(ref.path), original[name]));
    f.change(f.input.normalErp.acceptance, value => { value[name].sha256 = ref.sha256; });
  }
});

test('requires an exact bootstrap restoration and its verified candidate/offline bindings', t => {
  const f = draftFlowFixture(t), ref = f.input.normalErp.controllerStatus, original = readFileSync(ref.path);
  for (const mutate of [
    value => { value.pending.suites = 1; }, value => { value.workflowEnabled = true; },
    value => { value.userDailyLimitModified = true; }, value => { value.legacyTextAiModified = true; },
    value => { value.credentialRevisionAfter = value.credentialRevisionBefore; },
    value => { value.candidate.offlineSha256 = hash('other-offline'); },
    value => { value.candidate.gitCommit = f.erpCommit; }, value => { value.ownerSha256 = hash('other-owner'); },
  ]) {
    f.change(ref, value => mutate(value.result.qualification));
    assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_INVALID');
    Object.assign(ref, f.put(path.basename(ref.path), original));
  }
  f.change(ref, value => { value.result.restoredEditUnitCostMinor = 99; });
  assert.equal(f.verify().report.provenance.normalErp.unitCostMinor, 14, 'execution price must not be inferred from restored config');
});

test('validates original-byte hashes and strict pointers for the new draft evidence', t => {
  const f = draftFlowFixture(t, 'INPAINT'), ref = f.input.normalErp.acceptance, original = readFileSync(ref.path);
  for (const mutate of [
    value => { value.pointers.generated = '/missing'; }, value => { value.pointers.generated = '/__proto__'; },
    value => { value.pointers.generated = '/snapshot/~2'; }, value => { delete value.mask; },
    value => { value.mask = value.source; }, value => { value.operation = 'TEXT_TO_IMAGE'; },
  ]) {
    f.change(ref, mutate);
    assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_INVALID');
    Object.assign(ref, f.put(path.basename(ref.path), original));
  }
  writeFileSync(f.browser.path, json({ browser: { realSignedInAccount: true } }));
  assert.throws(() => f.verify(), error => error.code === 'QA04_ARTIFACT_CHANGED');
});

test('derives formal fields only from complete original evidence and preserves limited historical claims', t => {
  const f = fixture(t), result = f.verify();
  assert.equal(result.report.kind, 'QA04_FINAL_ACCEPTANCE');
  assert.equal(result.report.decision, 'PASS');
  assert.equal(result.report.qa02Prerequisite, 'COMPLETE');
  assert.equal(result.report.gitCommit, f.targetGitCommit);
  assert.equal(result.report.durationSeconds, 1200);
  assert.deepEqual(result.report.extensionVerification, {
    source: { passed: 459, failures: 0, warnings: 0 }, cloud: { passed: 464, failures: 0, warnings: 0 }, local: { passed: 460, failures: 0, warnings: 0 },
  });
  assert.deepEqual(result.report.externalEffects, { providerRequests: 0, vpsAccess: false, deployment: false, featureFlagChanges: 0, ozonWrites: 0 });
  assert.equal(result.report.provenance.normalErp.executionCommit, f.erpCommit);
  assert.equal(result.report.provenance.normalErp.targetUiProductionVerified, false);
  assert.equal(result.report.provenance.technical[0].qualityBasis, 'RECORDED_VISUAL_OBSERVATION');
  assert.equal(result.report.provenance.technical[1].qualityBasis, 'HISTORICAL_HUMAN_CONFIRMATION');
  assert.equal(result.report.provenance.counterexamples.length, 2);
  assert.equal(result.report.provenance.technical[0].historicalBilling.perRequestLimitExceededByLog, true);
  assert.equal(result.report.provenance.supplierSettlementClaimed, false);
  assert.equal(result.report.provenance.allConfigurationsPromoted, false);
  assert.equal(existsSync(path.join(f.evidenceRoot, 'final.json')), false);
});

test('rejects a caller completion flag, wrong scope, omitted operation and unknown outcome', t => {
  const f = fixture(t);
  for (const mutate of [
    input => { input.qa02Prerequisite = 'COMPLETE'; },
    input => { input.scope = 'ALL_AI_PRODUCTION_READY'; },
    input => { input.technical.pop(); },
    input => { input.counterexamples = []; },
  ]) {
    const original = structuredClone(f.input); mutate(f.input);
    assert.throws(() => f.verify(), error => error.code === 'QA04_INPUT_INVALID');
    Object.keys(f.input).forEach(key => delete f.input[key]); Object.assign(f.input, original);
  }
  f.change(f.input.technical[0].report, report => { report.state = 'RECONCILIATION_REQUIRED'; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_TECHNICAL_INVALID');
});

test('rejects missing, modified, reused and hard-linked originals', t => {
  const f = fixture(t), ref = f.input.technical[1].humanConfirmation;
  writeFileSync(ref.path, json({ decision: 'APPROVED' }));
  assert.throws(() => f.verify(), error => error.code === 'QA04_ARTIFACT_CHANGED');
  f.input.technical[1].humanConfirmation = f.input.technical[2].humanConfirmation;
  assert.throws(() => f.verify(), error => error.code === 'QA04_TECHNICAL_INVALID');
  f.input.technical[1].humanConfirmation = { path: path.join(f.evidenceRoot, 'missing.json'), sha256: 'a'.repeat(64) };
  assert.throws(() => f.verify(), error => error.code === 'QA04_ARTIFACT_UNSAFE');
  linkSync(f.input.offline.receipt.path, path.join(f.evidenceRoot, 'receipt-alias.json'));
  assert.throws(() => f.verify(), error => error.code === 'QA04_ARTIFACT_UNSAFE');
});

test('rejects fake providers and a confirmation bound to another output', t => {
  const f = fixture(t);
  const original = readFileSync(f.input.technical[1].report.path);
  f.change(f.input.technical[1].report, report => { report.provider = 'fake'; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_TECHNICAL_INVALID');
  Object.assign(f.input.technical[1].report, f.put('historical-image_to_image.report.json', original));
  f.change(f.input.technical[1].humanConfirmation, value => { value.outputImageSha256 = 'f'.repeat(64); });
  assert.throws(() => f.verify(), error => error.code === 'QA04_TECHNICAL_INVALID');
});

test('requires every native gate and the actual three verifier summaries from one complete run', t => {
  const f = fixture(t), original = readFileSync(f.input.offline.log.path, 'utf8');
  for (const log of [original.replace('[qa04-offline] Workspace lint', '[qa04-offline] skipped lint'), original.replace('464 pass(es)', '0 pass(es)'), `${original}\n${original}`, original.replace('0 warning(s), 460', '1 failure(s), 460')]) {
    Object.assign(f.input.offline.log, f.put('offline.log', log));
    assert.throws(() => f.verify(), error => error.code === 'QA04_OFFLINE_INVALID');
  }
  Object.assign(f.input.offline.log, f.put('offline.log', original));
  f.change(f.input.offline.receipt, value => { value.kind = 'QA04_FINAL_ACCEPTANCE'; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_OFFLINE_INVALID');
});

test('rejects stale native evidence and dirty or different checkout provenance', t => {
  const f = fixture(t);
  assert.throws(() => f.verify({ now: '2026-09-17T12:00:00.000Z' }), error => error.code === 'QA04_OFFLINE_INVALID');
  writeFileSync(path.join(f.repositoryRoot, 'untracked.txt'), 'dirty');
  assert.throws(() => f.verify(), error => error.code === 'QA04_SOURCE_INVALID');
});

test('does not accept a successful image summary without matching frozen pricing and a single CHARGE', t => {
  const f = fixture(t);
  f.change(f.input.normalErp.generated, value => { value.cost.actualCostMinor = 28; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_INVALID');
});

test('accepts the original compact controller receipt without reformatting archived bytes', t => {
  const f = fixture(t), controller = f.get(f.input.normalErp.controllerStatus);
  Object.assign(f.input.normalErp.controllerStatus, f.put('controller-status.json', `${JSON.stringify(controller)}\n`));
  f.change(f.input.normalErp.acceptance, value => {
    value.evidence[1].sha256 = f.input.normalErp.controllerStatus.sha256;
  });
  assert.equal(f.verify().report.provenance.normalErp.configurationRestored, true);
});

test('rejects changed backend or dependency trees instead of promoting historical ERP evidence', t => {
  const f = fixture(t);
  writeFileSync(path.join(f.repositoryRoot, 'pnpm-lock.yaml'), 'changed dependency\n');
  f.git('add', '--', 'pnpm-lock.yaml'); f.git('commit', '-qm', 'changed dependency');
  f.input.targetGitCommit = f.git('rev-parse', 'HEAD');
  f.change(f.input.offline.receipt, value => { value.gitCommit = f.input.targetGitCommit; });
  Object.assign(f.input.offline.log, f.put('offline.log', readFileSync(f.input.offline.log.path, 'utf8').replace(f.targetGitCommit, f.input.targetGitCommit)));
  assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
});

test('allows root script registration but rejects root dependency changes for historical ERP evidence', t => {
  const f = fixture(t), manifest = path.join(f.repositoryRoot, 'package.json');
  const advance = () => {
    const previous = f.input.targetGitCommit;
    f.git('add', '--', 'package.json'); f.git('commit', '-qm', 'update root manifest');
    f.input.targetGitCommit = f.git('rev-parse', 'HEAD');
    f.change(f.input.offline.receipt, value => { value.gitCommit = f.input.targetGitCommit; });
    Object.assign(f.input.offline.log, f.put('offline.log', readFileSync(f.input.offline.log.path, 'utf8').replace(previous, f.input.targetGitCommit)));
  };
  const value = JSON.parse(readFileSync(manifest));
  value.scripts['qa:04:final'] = 'node scripts/qa04-final-acceptance.mjs';
  value.scripts['test:qa04:final'] = 'node --test scripts/qa04-final-acceptance.test.mjs';
  writeFileSync(manifest, json(value)); advance();
  assert.equal(f.verify().report.provenance.normalErp.executionCommit, f.erpCommit);
  value.devDependencies.example = '2.0.0';
  writeFileSync(manifest, json(value)); advance();
  assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
});

for (const script of ['postinstall', 'build']) {
  test(`rejects changed root ${script} scripts when bridging historical ERP evidence`, t => {
    const f = fixture(t), manifest = path.join(f.repositoryRoot, 'package.json');
    const value = JSON.parse(readFileSync(manifest));
    value.scripts[script] = 'node scripts/change-server-artifact.mjs';
    writeFileSync(manifest, json(value));
    f.git('add', '--', 'package.json'); f.git('commit', '-qm', `change ${script}`);
    f.input.targetGitCommit = f.git('rev-parse', 'HEAD');
    f.change(f.input.offline.receipt, receipt => { receipt.gitCommit = f.input.targetGitCommit; });
    Object.assign(f.input.offline.log, f.put('offline.log', readFileSync(f.input.offline.log.path, 'utf8').replace(f.targetGitCommit, f.input.targetGitCommit)));
    assert.throws(() => f.verify(), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
  });
}

test('refuses to hide quality counterexamples or relabel them as positive evidence', t => {
  const f = fixture(t);
  f.change(f.input.counterexamples[0].review, value => { value.requestedQualityState = 'ACCEPTED'; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_COUNTEREXAMPLE_INVALID');
});

test('derives current-source suite acceptance from two original jobs, PNGs, reviews, queue records and a restored bootstrap', t => {
  const f = suiteFlowFixture(fixture(t), png), result = f.verify(), proof = result.report.provenance.normalErp;
  assert.equal(proof.executionCommit, f.targetGitCommit); assert.equal(proof.workflowKind, 'SUITE');
  assert.equal(proof.successfulImages, 2); assert.equal(proof.actualCostMinor, 28); assert.equal(proof.chargeCount, 2);
  assert.equal(proof.applicationCount, 2); assert.equal(proof.verifiedSuiteBrowser, true); assert.equal(proof.targetUiProductionVerified, false);
  assert.equal(proof.images.length, 2); assert.equal(proof.configurationRestored, true);
  assert.equal(result.report.provenance.fullProductionMv3Verified, false);
  assert.doesNotMatch(JSON.stringify(result.report), /private-suite|private-draft|private-source/u);
});

test('count suite v4 binds exact CNY10 runtime, raw portrait bytes, pending review, assignment and original replay', t => {
  const f = countSuiteFlowFixture(fixture(t), png), proof = f.verify().report.provenance.normalErp;
  assert.equal(proof.provider, 'custom'); assert.equal(proof.model, 'gpt-image-2-count');
  assert.equal(proof.currency, 'CNY'); assert.equal(proof.unitCostMinor, 10); assert.equal(proof.actualCostMinor, 20);
  assert.equal(proof.providerProfile, 'BIG_MODEL_GPT_IMAGE_2_COUNT_SUITE_CNY10_V1');
  assert.equal(proof.verifiedIdempotencyReplay, true);
  assert.equal(proof.evidence.rawProviderImageSha256.length, 2);
  assert.doesNotMatch(JSON.stringify(proof), /private-suite|private-credential|provider-0/u);
});

test('source-page count suite v5 admits verified full-frame output with exact same-tab draft evidence', t => {
  const f = sourcePageCountSuiteFlowFixture(fixture(t), png);
  const proof = f.verify().report.provenance.normalErp;
  assert.equal(proof.actualCostMinor, 20); assert.equal(proof.verifiedIdempotencyReplay, true);
  assert.equal(proof.sourcePageWorkflowVerified, true);
});

function historicalCountReuseFixture(t, filename = 'dev-docs/README.md') {
  const f = sourcePageCountSuiteFlowFixture(fixture(t), png), executionCommit = f.targetGitCommit;
  const originals = [...Object.values(f.input.normalErp), ...Object.values(f.input.offline),
    ...Object.values(f.manifest).filter(value => value?.path), ...f.manifest.previews, ...f.manifest.reviews]
    .map(ref => ({ path: ref.path, sha256: hash(readFileSync(ref.path)) }));
  mkdirSync(path.dirname(path.join(f.repositoryRoot, filename)), { recursive: true });
  writeFileSync(path.join(f.repositoryRoot, filename), filename.endsWith('.css') ? '.panel { color: navy; }\n' : '# Release notes\n');
  f.git('add', '--', filename); f.git('commit', '-qm', 'presentation or documentation only');
  f.input.targetGitCommit = f.git('rev-parse', 'HEAD');
  f.input.offline = {
    receipt: f.put('reuse-target-offline.json', { ...f.get(f.input.offline.receipt), gitCommit: f.input.targetGitCommit,
      startedAt: '2026-09-16T11:00:00.000Z', completedAt: '2026-09-16T11:20:00.000Z' }),
    log: f.put('reuse-target-offline.log', readFileSync(f.input.offline.log.path, 'utf8').replace(executionCommit, f.input.targetGitCommit)),
  };
  const runtime = f.get(f.input.normalErp.generated).suiteRuntime;
  const currentRuntime = f.put('current-suite-runtime.json', {
    schemaVersion: 1, kind: 'SS_ERP_HOSTED_SUITE_CURRENT_RUNTIME', gitCommit: f.input.targetGitCommit,
    observedAt: '2026-09-16T11:50:00.000Z', readOnly: true, databaseReadOnly: true,
    configured: true, executionReady: true, testOnly: false, providerRequests: 0, ozonWrites: 0,
    providerConfig: Object.fromEntries(Object.entries(runtime).filter(([key]) => !['itemCount', 'estimatedCostCents', 'maximumCostCents'].includes(key))),
  });
  f.input.suiteReuse = { currentRuntime };
  return { ...f, originals, executionCommit, currentRuntime };
}

test('count suite can reuse complete immutable execution for a documentation-only target with fresh runtime and offline', t => {
  const f = historicalCountReuseFixture(t), proof = f.verify().report.provenance.normalErp;
  assert.equal(proof.executionCommit, f.executionCommit);
  assert.notEqual(proof.executionCommit, f.input.targetGitCommit);
  assert.equal(proof.sourceBridge.kind, 'UNCHANGED_HOSTED_SUITE_RUNTIME_V1');
  assert.equal(proof.sourceBridge.currentRuntime.receiptSha256, f.currentRuntime.sha256);
  assert.equal(proof.sourceBridge.requiresFreshTargetUiVerification, false);
  assert.equal(proof.verifiedIdempotencyReplay, true);
  for (const original of f.originals) assert.equal(hash(readFileSync(original.path)), original.sha256);
});

test('count suite reuse still requires fresh target offline and current selected runtime, never historical job configuration', t => {
  const f = historicalCountReuseFixture(t), original = f.get(f.currentRuntime);
  for (const mutate of [value => { value.gitCommit = f.executionCommit; }, value => { value.readOnly = false; },
    value => { value.databaseReadOnly = false; }, value => { value.providerRequests = 1; },
    value => { value.providerConfig.providerConfigHash = hash('changed-runtime'); },
    value => { value.providerConfig.pricingVersion = 'changed-price'; },
    value => { value.executionReady = false; }, value => { value.testOnly = true; },
    value => { value.observedAt = '2026-09-16T10:36:00.000Z'; }, value => { value.observedAt = '2026-09-16T12:01:00.000Z'; }]) {
    f.change(f.currentRuntime, mutate);
    assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_REUSE_INVALID');
    Object.assign(f.currentRuntime, f.put('current-suite-runtime.json', original));
  }
  assert.throws(() => f.verify({ now: '2026-09-16T13:00:00.000Z' }), error => error.code === 'QA04_SUITE_REUSE_INVALID');
  f.input.offline = f.manifest.executionOfflineQa04;
  assert.throws(() => f.verify(), error => error.code === 'QA04_OFFLINE_INVALID');
});

test('CSS count-suite reuse additionally requires fresh current-candidate UI screenshot and applied styles', t => {
  const cssPath = 'extensions/ss-erp/pages/precision-workbench.css', f = historicalCountReuseFixture(t, cssPath);
  assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_REUSE_INVALID');
  const record = { schemaVersion: 1, kind: 'SS_ERP_SUITE_TARGET_UI_READBACK', gitCommit: f.input.targetGitCommit,
    version: '1.0.459', observedAt: '2026-09-16T11:51:00.000Z', releaseSignatureSha256: hash('candidate-signature'),
    cloudZipSha256: hash('cloud'), installedTreeSha256: hash('installed'), workerScriptSha256: hash('worker'),
    runtimeWorkerScriptSha256: hash('worker'), visible: true, sourcePageVisible: true, controlsVisible: true, mutations: 0,
    viewport: { width: 1200, height: 900 }, screenshot: f.put('current-css-ui.png', png(1200, 900, 24)),
    css: [{ path: cssPath, targetObjectId: f.git('rev-parse', f.input.targetGitCommit + ':' + cssPath), applied: true }] };
  const ref = f.put('current-css-ui.json', record); f.input.suiteReuse.currentUi = ref;
  const result = f.verify().report.provenance.normalErp.sourceBridge;
  assert.equal(result.requiresFreshTargetUiVerification, true);
  assert.equal(result.currentUi.releaseSignatureSha256, record.releaseSignatureSha256);
  f.change(ref, value => { value.css[0].applied = false; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_TARGET_UI_REQUIRED');
});

test('count suite reuse refuses missing runtime, unknown source and incomplete original review/replay evidence', t => {
  const f = historicalCountReuseFixture(t), reuse = f.input.suiteReuse;
  delete f.input.suiteReuse;
  assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_REUSE_INVALID');
  f.input.suiteReuse = reuse;
  f.changeMapped('replayResponse', value => { value.body.data.replayed = false; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
  const changed = historicalCountReuseFixture(t, 'extensions/ss-erp/pages/workbench.js');
  assert.throws(() => changed.verify(), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
});

test('source-page v5 accepts the exact approved COM configuration but rejects added operations and stale offline ordering', t => {
  const full = ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT', 'SUITE', 'IMAGE_TRANSLATE', 'OZON_PUBLISH'];
  const f = sourcePageCountSuiteFlowFixture(fixture(t), png);
  f.change(f.input.normalErp.controllerStatus, value => { value.before.result.allowedOperations = full; value.after.result.allowedOperations = full; });
  assert.equal(f.verify().report.provenance.normalErp.sourcePageWorkflowVerified, true);
  f.change(f.input.normalErp.controllerStatus, value => { value.before.result.allowedOperations.push('TEXT_TO_IMAGE'); value.after.result.allowedOperations.push('TEXT_TO_IMAGE'); });
  assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
  const fresh = sourcePageCountSuiteFlowFixture(fixture(t), png);
  fresh.changeMapped('workbench', value => { value.launchedAt = '2026-09-16T10:19:00.000Z'; });
  assert.throws(() => fresh.verify(), error => ['QA04_SUITE_INVALID','QA04_OFFLINE_INVALID'].includes(error.code));
});

test('source-page suite accepts an unchanged multi-shop pilot containing its exact execution shop', t => {
  const f = sourcePageCountSuiteFlowFixture(fixture(t), png);
  f.change(f.input.normalErp.controllerStatus, value => {
    value.before.result.shopIds.push('approved-second-shop');
    value.after.result.shopIds.push('approved-second-shop');
  });
  assert.equal(f.verify().report.provenance.normalErp.successfulImages, 2);
});

for (const [name, mutate] of [
  ['missing execution shop', value => { value.before.result.shopIds = ['another-shop']; value.after.result.shopIds = ['another-shop']; }],
  ['duplicate shops', value => { value.before.result.shopIds.push(value.before.result.shopIds[0]); value.after.result.shopIds.push(value.after.result.shopIds[0]); }],
  ['blank shop', value => { value.before.result.shopIds.push(' '); value.after.result.shopIds.push(' '); }],
  ['noncanonical shop', value => { value.before.result.shopIds.push(' another-shop '); value.after.result.shopIds.push(' another-shop '); }],
  ['URL as shop id', value => { value.before.result.shopIds.push('https://untrusted.invalid/shop'); value.after.result.shopIds = [...value.before.result.shopIds]; }],
  ['path as shop id', value => { value.before.result.shopIds.push('../shop'); value.after.result.shopIds = [...value.before.result.shopIds]; }],
  ['too many shops', value => { value.before.result.shopIds.push(...Array.from({ length: 50 }, (_, index) => 'shop-' + index)); value.after.result.shopIds = [...value.before.result.shopIds]; }],
  ['authority growth', value => { value.after.result.shopIds.push('new-unapproved-shop'); }],
]) {
  test('multi-shop execution still refuses ' + name, t => {
    const f = sourcePageCountSuiteFlowFixture(fixture(t), png);
    f.change(f.input.normalErp.controllerStatus, mutate);
    assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
  });
}

test('count suite supports later read-only cleanup without changing original execution receipts', t => {
  const f = historicalCountReuseFixture(t), previous = f.get(f.input.normalErp.controllerStatus);
  const original = [...f.originals];
  previous.version = f.get(f.manifest.workbench).extensionVersion;
  previous.before.version = previous.version; previous.after.version = previous.version;
  const executionControl = f.put('count-consistent-execution-control.json', previous);
  const pending = f.put('count-current-pending.json', {
    kind: 'REAL_HOSTED_SUITE_PENDING_READBACK', caseId: 'suite', phase: 'pending',
    gitCommit: f.input.targetGitCommit, readbackRuntimeCommit: f.input.targetGitCommit,
    databaseId: 'production-com-primary', ownerSha256: previous.ownerSha256,
    observedAt: '2026-09-16T11:52:00.000Z', readOnly: true, pending: previous.pending,
  });
  const final = f.put('count-current-db.json', { ...f.get(f.input.normalErp.restored),
    gitCommit: f.input.targetGitCommit, readbackRuntimeCommit: f.input.targetGitCommit,
    observedAt: '2026-09-16T11:53:00.000Z' });
  const controller = { ...previous, schemaVersion: 2, gitCommit: f.input.targetGitCommit,
    executionGitCommit: f.executionCommit, executionControl, pendingReadback: pending, finalReadback: final,
    after: { ...previous.after, gitCommit: f.input.targetGitCommit, observedAt: '2026-09-16T11:51:00.000Z',
      result: { ...previous.after.result, deviceCount: 1 } } };
  f.input.normalErp.controllerStatus = f.put('count-current-controller.json', controller);
  assert.equal(f.verify().report.provenance.normalErp.executionCommit, f.executionCommit);
  for (const ref of original) assert.equal(hash(readFileSync(ref.path)), ref.sha256);
  for (const mutate of [value => { value.unitCostCents = 14; }, value => { value.providerProfile = 'different-profile'; },
    value => { value.after.result.deviceCount = 3; }, value => { value.after.result.shopIds.push('unapproved'); },
    value => { delete value.executionControl; }]) {
    f.change(f.input.normalErp.controllerStatus, mutate);
    assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
    Object.assign(f.input.normalErp.controllerStatus, f.put('count-current-controller.json', controller));
  }
});

test('source-page v5 refuses changed page identity, draft ownership, navigation and unverified dimensions', t => {
  for (const [key, mutate] of [
    ['sourceEntry', value => { value.pagesAfter[0].url = 'https://app.ss-erp.com/collect/source'; }],
    ['sourceEntry', value => { value.pagesAfter.push({ id: 'D'.repeat(32), url: 'https://app.ss-erp.com' }); }],
    ['sourceEntry', value => { value.sourcePageTargetId = 'D'.repeat(32); }],
    ['sourceEntry', value => { value.draftId = 'different-draft'; }],
    ['sourceEntry', value => { value.gitCommit = '1'.repeat(40); }],
    ['sourceEntry', value => { value.actualUi = false; }],
    ['sourceEntry', value => { value.at = '2026-09-16T11:00:00.000Z'; }],
    ['workbench', value => { value.sourcePageTargetId = value.workbenchTargetId; }],
    ['workbench', value => { value.ownerSha256 = hash('another-owner'); }],
  ]) {
    const f = sourcePageCountSuiteFlowFixture(fixture(t), png); f.changeMapped(key, mutate);
    assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
  }
  for (const [width, height] of [[1086, 1447], [1085, 1448], [1086, 1344], [768, 1024], [1024, 1024]]) {
    const f = sourcePageCountSuiteFlowFixture(fixture(t), png);
    f.change(f.input.normalErp.acceptance, value => { value.rawProviderImages[0] = f.put('wrong-v5-frame.png', png(width, height)); });
    assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
  }
});

test('count suite v4 refuses endpoint, model, frozen price, credential, request and normalization drift', t => {
  const f = countSuiteFlowFixture(fixture(t), png), ref = f.input.normalErp.generated, original = readFileSync(ref.path);
  const changes = [
    value => { value.rows[0].job.provider = 'dashscope-wanx'; },
    value => { value.rows[0].job.model = 'gpt-image-2'; },
    value => { value.rows[0].job.actualCostCents = 14; },
    value => { value.rows[0].job.operationConfig.providerRuntime.currency = 'USD'; },
    value => { value.rows[0].job.operationConfig.providerRuntime.baseUrlSha256 = hash('https://another.example/v1'); },
    value => { value.rows[0].job.operationConfig.providerRuntime.contractVersion = 'ai-image-provider-runtime/v2'; },
    value => { delete value.rows[0].job.operationConfig.providerRuntime.credentialRevision; },
    value => { value.rows[1].job.operationConfig.providerRuntime.credentialRevision.revision += 1; },
    value => { value.rows[0].job.operationConfig.providerRequest.quality = 'standard'; },
    value => { value.rows[0].job.operationConfig.providerRequest.width = 1024; },
    value => { value.rows[0].job.operationConfig.requestProfile = 'OZON_PORTRAIT_SINGLE_V1'; },
    value => { value.rows[0].job.operationConfig.finalOutput.fit = 'contain'; },
    value => { value.rows[0].job.operationConfig.finalOutput.normalizerVersion = 'ai-image-suite-output-normalizer/v1'; },
    value => { value.suiteRuntime.pricingVersion = 'ai-image-suite-price-cny/v1:' + 'a'.repeat(32); },
    value => { value.suiteRuntime.providerConfigHash = hash('forged'); },
    value => { value.suiteRuntime.estimatedCostCents = 28; },
    value => { value.rows[0].job.frozenInputs.push({ ...value.rows[0].job.frozenInputs[0], ordinal: 1 }); },
  ];
  for (const mutate of changes) {
    f.change(ref, mutate);
    assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
    Object.assign(ref, f.put('suite-generated-db.json', original));
  }
});

test('count suite v4 refuses unrelated raw bytes, raw/final lineage, replay and execution relabeling', t => {
  const f = countSuiteFlowFixture(fixture(t), png), ref = f.input.normalErp.generated, original = readFileSync(ref.path);
  for (const mutate of [
    value => { value.rows[0].workflow.inputAssets[0].ownerSha256 = hash('other-owner'); },
    value => { value.rows[0].rawOutput.ownerSha256 = hash('other-owner'); },
    value => { value.rows[0].outputs[0].ownerSha256 = hash('other-owner'); },
    value => { value.rows[0].rawOutput.sha256 = value.rows[1].rawOutput.sha256; },
    value => { value.rows[0].rawOutput.width = 1024; },
    value => { value.rows[0].rawOutput.metadata.normalizedSha256 = hash('wrong'); },
    value => { value.rows[0].rawOutput.metadata.providerJobId = 'different-provider-task'; },
    value => { value.rows[0].outputs[0].metadata.providerOutputAssetId = value.rows[1].rawOutput.id; },
    value => { value.rows[0].outputs[0].metadata.sourceCaptureSnapshotId = 'other-snapshot'; },
  ]) {
    f.change(ref, mutate); assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
    Object.assign(ref, f.put('suite-generated-db.json', original));
  }
  const response = f.manifest.replayResponse, responseOriginal = readFileSync(response.path);
  f.changeMapped('replayResponse', value => { value.body.data.replayed = false; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
  Object.assign(response, f.put('suite-replay-response.json', responseOriginal));
  f.change(f.input.normalErp.acceptance, value => { value.replayResponse = response; value.executionGitCommit = f.erpCommit; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
});

test('count suite v4 keeps the exact cost control, accepted quote, reference bytes and pending evidence mandatory', t => {
  const f = countSuiteFlowFixture(fixture(t), png);
  const acceptance = f.input.normalErp.acceptance, manifestOriginal = readFileSync(acceptance.path);
  for (const mutate of [
    value => { value.providerProfile = 'CUSTOM_PROVIDER_ANY_PRICE'; },
    value => { value.schemaVersion = 1; },
    value => { delete value.executionOfflineQa04; },
    value => { value.rawProviderImages = [value.rawProviderImages[0]]; },
    value => { value.rawProviderImages[0] = f.put('wrong-raw-dimensions.png', png(1024, 1024, 81)); },
  ]) {
    f.change(acceptance, mutate); assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
    Object.assign(acceptance, f.put('count-suite-inputs.json', manifestOriginal));
  }
  const controller = f.input.normalErp.controllerStatus, controllerOriginal = readFileSync(controller.path);
  for (const mutate of [
    value => { value.unitCostCents = 14; }, value => { value.maximumTaskCostCents = 28; },
    value => { value.currency = 'USD'; }, value => { value.configurationChanged = true; },
    value => { value.pending.suites = 1; }, value => { value.after.result.shopIds.push('other-shop'); },
  ]) {
    f.change(controller, mutate); assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
    Object.assign(controller, f.put('count-suite-controller.json', controllerOriginal));
  }
  for (const [key, mutate] of [
    ['generatedUi', value => { value.projection.quote.maximumCostCents = 28; }],
    ['startRequest', value => { value.body.command.acceptedMaximumCostCents = 28; }],
    ['replayRequest', value => { value.body.idempotencyKey = 'another-request'; }],
    ['replayResponse', value => { value.body.data.assignments[0].assetId = 'other-output'; }],
  ]) {
    const ref = f.manifest[key], original = readFileSync(ref.path);
    f.changeMapped(key, mutate); assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
    Object.assign(ref, f.put(path.basename(ref.path), original));
    f.change(acceptance, value => { value[key] = ref; });
  }
  const generated = f.input.normalErp.generated;
  f.change(generated, value => { value.rows[0].workflow.reviewStatus = 'APPROVED'; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
});

test('suite v2 bridges a JPEG source execution with removed completed queue jobs and unchanged restricted pilot', t => {
  const f = historicalRestrictedSuiteFixture(t), manifest = f.get(f.input.normalErp.acceptance);
  const database = f.get(f.input.normalErp.generated), binding = f.get(manifest.workbench), ui = f.get(manifest.generatedUi);
  const source = imageEvidence(evidenceReader(), manifest.source, 'QA04_SUITE_INVALID');
  const reference = imageEvidence(evidenceReader(), manifest.referenceImage, 'QA04_SUITE_INVALID');
  const lineage = database.suiteReferences[0];
  assert.equal(lineage.suiteId, ui.suiteId); assert.equal(hash(lineage.ownerUserId), binding.ownerSha256);
  assert.equal(lineage.candidateId, binding.sourceMediaKey); assert.equal(lineage.assetSha256, reference.sha256);
  assert.equal(lineage.rawSourceSha256, source.sha256); assert.equal(lineage.sizeBytes, reference.bytes);
  assert.equal(lineage.width, reference.width); assert.equal(lineage.height, reference.height); assert.equal(lineage.mimeType, reference.mimeType);
  const result = f.verify(), proof = result.report.provenance.normalErp;
  assert.equal(result.report.decision, 'PASS');
  assert.equal(proof.executionCommit, f.executionGitCommit);
  assert.equal(proof.sourceBridge.kind, 'IDENTICAL_ERP_SOURCE_AND_DEPENDENCIES');
  assert.equal(proof.source.mimeType, 'image/jpeg');
  assert.equal(proof.configurationRestored, true);
  assert.deepEqual(proof.executionOfflineQa04, {
    gitCommit: f.executionGitCommit,
    receiptSha256: f.executionOfflineQa04.receipt.sha256,
    logSha256: f.executionOfflineQa04.log.sha256,
    startedAt: '2026-09-16T10:00:00.000Z',
    completedAt: '2026-09-16T10:20:00.000Z',
  });
});

test('suite v3 derives the missed pre-review database phase from immutable events and draft versions', t => {
  const f = postApplicationDerivedSuiteFixture(t), result = f.verify(), proof = result.report.provenance.normalErp;
  assert.equal(result.report.decision, 'PASS');
  assert.equal(proof.workflowKind, 'SUITE');
  assert.equal(proof.generatedPhaseEvidence, 'POST_APPLICATION_EVENT_DERIVATION_V1');
  assert.equal(proof.actualCostMinor, 28);
  assert.equal(proof.applicationCount, 2);
});

test('suite v3 rejects review events before the pending UI, changed event hashes, draft history drift, and Ozon writes', t => {
  for (const mutate of [
    database => { database.rows[0].workflow.events.at(-1).createdAt = '2026-09-16T10:31:00.000Z'; },
    database => { database.rows[0].workflow.events.at(-1).payloadHash = hash('changed'); },
    database => { database.draftVersions[0].payload.media.assignments.push({ assetId: 'fabricated' }); },
    database => { database.ozonPublishAttempts = 1; },
  ]) {
    const f = postApplicationDerivedSuiteFixture(t);
    f.change(f.input.normalErp.generated, mutate);
    assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
  }
});

test('bounded image evidence parses a single-frame progressive JPEG with multiple scans', t => {
  const f = fixture(t), reference = f.put('progressive-source.jpg', progressiveJpeg(1080, 1080));
  assert.deepEqual(imageEvidence(evidenceReader(), reference, 'QA04_SUITE_INVALID'), {
    bytes: readFileSync(reference.path).length,
    sha256: reference.sha256,
    width: 1080,
    height: 1080,
    mimeType: 'image/jpeg',
  });
});

test('suite v2 rejects queue retention ambiguity, restricted pilot drift, and malformed JPEG evidence', t => {
  {
    const f = historicalRestrictedSuiteFixture(t), manifest = f.get(f.input.normalErp.acceptance);
    f.change(manifest.queue, value => { delete value.retentionPolicy; });
    f.change(f.input.normalErp.acceptance, value => { value.queue.sha256 = manifest.queue.sha256; });
    assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
  }
  {
    const f = historicalRestrictedSuiteFixture(t);
    f.change(f.input.normalErp.controllerStatus, value => { value.after.result.rolloutRevision += 1; });
    assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
  }
  {
    const f = historicalRestrictedSuiteFixture(t), source = f.put('suite-source.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    f.change(f.input.normalErp.acceptance, value => { value.source = source; value.referenceImage = source; });
    assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
  }
});

test('original execution control still rejects device-count changes', t => {
  const f = historicalRestrictedSuiteFixture(t);
  f.change(f.input.normalErp.controllerStatus, value => { value.after.result.deviceCount = 1; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
});

test('suite accepts explicitly reviewed translation in the unchanged restricted pilot and rejects authority growth', t => {
  const f = historicalRestrictedSuiteFixture(t);
  f.change(f.input.normalErp.controllerStatus, value => {
    value.before.result.allowedOperations.push('IMAGE_TRANSLATE');
    value.after.result.allowedOperations.push('IMAGE_TRANSLATE');
  });
  assert.equal(f.verify().report.decision, 'PASS');
  for (const mutate of [value => { value.after.result.allowedOperations.pop(); },
    value => { value.before.result.allowedOperations.push('FULL_EDIT'); value.after.result.allowedOperations.push('FULL_EDIT'); },
    value => { value.after.result.shopIds.push('another-shop'); },
    value => { value.after.result.deviceCount++; }]) {
    const original = f.get(f.input.normalErp.controllerStatus);
    f.change(f.input.normalErp.controllerStatus, mutate);
    assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
    Object.assign(f.input.normalErp.controllerStatus, f.put('translation-pilot-controller.json', original));
  }
});

test('suite separates later target-runtime cleanup from immutable original execution evidence', t => {
  const f = historicalRestrictedSuiteFixture(t);
  const previous = f.get(f.input.normalErp.controllerStatus);
  const currentDatabase = { ...f.get(f.input.normalErp.restored),
    gitCommit: f.targetGitCommit, readbackRuntimeCommit: f.targetGitCommit,
    observedAt: '2026-09-16T11:30:02.000Z' };
  const pendingReadback = f.put('current-pending.json', {
    kind: 'REAL_HOSTED_SUITE_PENDING_READBACK', caseId: 'suite', phase: 'pending',
    gitCommit: f.targetGitCommit, readbackRuntimeCommit: f.targetGitCommit,
    databaseId: 'production-com-primary', ownerSha256: previous.ownerSha256,
    observedAt: '2026-09-16T11:30:01.000Z', readOnly: true, pending: previous.pending,
  });
  const finalReadback = f.put('current-suite-db.json', currentDatabase);
  const controller = { ...previous, schemaVersion: 2, gitCommit: f.targetGitCommit,
    executionGitCommit: f.executionGitCommit, pendingReadback, finalReadback,
    after: { ...previous.after, gitCommit: f.targetGitCommit, observedAt: '2026-09-16T11:30:00.000Z' } };
  f.input.normalErp.controllerStatus = f.put('current-cleanup-controller.json', controller);
  assert.equal(f.verify().report.provenance.normalErp.executionCommit, f.executionGitCommit);
  f.change(f.input.normalErp.controllerStatus, value => { value.after.result.deviceCount = 1; });
  assert.equal(f.verify().report.provenance.normalErp.configurationRestored, true,
    'later cleanup may have fewer valid devices without changing the pilot authority');
  for (const mutate of [value => { value.after.result.deviceCount = 3; },
    value => { value.after.result.deviceCount = 0; },
    value => { value.after.result.allowedOperations.push('FULL_EDIT'); },
    value => { value.after.result.shopIds.push('another-shop'); },
    value => { value.after.result.rolloutRevision++; },
    value => { value.after.result.sourcePolicyRevision = 'another-policy'; }]) {
    const original = f.get(f.input.normalErp.controllerStatus);
    f.change(f.input.normalErp.controllerStatus, mutate);
    assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
    Object.assign(f.input.normalErp.controllerStatus, f.put('current-cleanup-controller.json', original));
  }
  for (const mutate of [value => { value.pending.recovery = 1; },
    value => { value.gitCommit = f.executionGitCommit; },
    value => { value.readOnly = false; },
    value => { value.ownerSha256 = hash('another-owner'); }]) {
    f.change(pendingReadback, mutate);
    f.change(f.input.normalErp.controllerStatus, value => { value.pendingReadback = pendingReadback; });
    assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
    Object.assign(pendingReadback, f.put('current-pending.json', {
      kind: 'REAL_HOSTED_SUITE_PENDING_READBACK', caseId: 'suite', phase: 'pending',
      gitCommit: f.targetGitCommit, readbackRuntimeCommit: f.targetGitCommit,
      databaseId: 'production-com-primary', ownerSha256: previous.ownerSha256,
      observedAt: '2026-09-16T11:30:01.000Z', readOnly: true, pending: previous.pending,
    }));
    f.change(f.input.normalErp.controllerStatus, value => { value.pendingReadback = pendingReadback; });
  }
  f.change(finalReadback, value => { value.rows[0].job.billedUnits = 0; });
  f.change(f.input.normalErp.controllerStatus, value => { value.finalReadback = finalReadback; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
  Object.assign(finalReadback, f.put('current-suite-db.json', currentDatabase));
  f.change(f.input.normalErp.controllerStatus, value => { value.finalReadback = finalReadback; });
  writeFileSync(path.join(f.repositoryRoot, 'apps/server/src/rule.ts'), 'unreviewed generation behavior\n');
  f.git('add', '--', 'apps/server/src/rule.ts'); f.git('commit', '-qm', 'change generation owner');
  assert.throws(() => subject.verifyErpSource(f.repositoryRoot, f.executionGitCommit, f.git('rev-parse', 'HEAD')),
    error => error.code === 'QA04_ERP_SOURCE_CHANGED');
});

test('suite rejects missing images, price changes, reused jobs and historical records relabeled as current', t => {
  const f = suiteFlowFixture(fixture(t), png);
  const ref = f.input.normalErp.generated, original = readFileSync(ref.path);
  for (const change of [value => { value.gitCommit = f.erpCommit; },
    value => { value.rows[0].job.startedAt = '2026-09-16T10:19:59.000Z'; },
    value => { value.rows[0].cost.charges[0].actualCostMinor = 13; },
    value => { value.rows[0].job.pricing.unitCostCents = 15; },
    value => { value.rows[1] = structuredClone(value.rows[0]); }, value => { value.rows[0].job.attemptCount = 2; }]) {
    f.change(ref, change); assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
    Object.assign(ref, f.put('suite-generated-db.json', original));
  }
  f.change(f.input.normalErp.acceptance, value => { delete value.secondImage; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
});

test('suite refuses lost prior draft assignments, incorrect queue ids, rejected reviews and pending restoration', t => {
  const f = suiteFlowFixture(fixture(t), png), ref = f.input.normalErp.applied, original = readFileSync(ref.path);
  f.change(ref, value => { value.after.media.assignments.shift(); });
  assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID'); Object.assign(ref, f.put('suite-applied.json', original));
  const queue = f.get(f.manifest.queue); f.changeMapped('queue', value => { value.jobs[0].id = 'other-queue-job'; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID'); f.changeMapped('queue', value => Object.assign(value, queue));
  f.changeMapped('reviews', value => { value.decision = 'REJECT'; }, 1);
  assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID'); f.changeMapped('reviews', value => { value.decision = 'APPROVE'; }, 1);
  f.change(f.input.normalErp.controllerStatus, value => { value.result.qualification.pending.suites = 1; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
});

test('suite binds both image bytes, canonical source lineage, browser owner and restore candidate to the new execution', t => {
  const f = suiteFlowFixture(fixture(t), png);
  const manifestOriginal = readFileSync(f.input.normalErp.acceptance.path);
  f.change(f.input.normalErp.acceptance, value => { value.secondImage = structuredClone(f.input.normalErp.image); });
  assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
  Object.assign(f.input.normalErp.acceptance, f.put('suite-inputs.json', manifestOriginal));
  const canonical = f.put('canonical-suite-reference.png', png(1024, 1024, 63));
  f.change(f.input.normalErp.acceptance, value => { value.referenceImage = canonical; });
  for (const phase of ['generated', 'restored']) f.change(f.input.normalErp[phase], database => {
    database.suiteReferences[0].assetSha256 = canonical.sha256;
    database.suiteReferences[0].sizeBytes = readFileSync(canonical.path).length;
    for (const row of database.rows) {
      row.job.frozenInputs[0].sha256 = canonical.sha256; row.job.frozenInputs[0].sizeBytes = readFileSync(canonical.path).length;
      row.workflow.inputs[0].assetSha256 = canonical.sha256; row.workflow.inputAssets[0].sha256 = canonical.sha256;
      row.workflow.inputAssets[0].sizeBytes = readFileSync(canonical.path).length;
    }
  });
  assert.equal(f.verify().report.provenance.normalErp.referenceSha256, canonical.sha256);
  const controller = f.input.normalErp.controllerStatus, original = readFileSync(controller.path);
  for (const change of [value => { value.result.qualification.commit = f.erpCommit; },
    value => { value.result.qualification.candidate.offlineSha256 = hash('other-offline'); },
    value => { value.result.qualification.maximumTaskCostCents = 14; }]) {
    f.change(controller, change); assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
    Object.assign(controller, f.put('suite-controller.json', original));
  }
  f.changeMapped('browser', value => { value.ownerSha256 = hash('other-owner'); });
  assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
});

test('suite binds the actual accepted 28-minor quote and permits UI readback before its later database snapshot', t => {
  const f = suiteFlowFixture(fixture(t), png);
  assert.ok(Date.parse(f.get(f.manifest.generatedUi).at) < Date.parse(f.get(f.input.normalErp.generated).observedAt));
  const start = f.get(f.manifest.startRequest);
  for (const mutate of [value => { value.body.command.acceptedMaximumCostCents = 29; },
    value => { value.body.command.acceptedEstimatedCostCents = 27; },
    value => { value.body.command.expectedPreviewHash = hash('other-preview'); },
    value => { value.body.command.version = 'other-command'; }]) {
    f.changeMapped('startRequest', mutate);
    assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
    f.changeMapped('startRequest', value => Object.assign(value, structuredClone(start)));
  }
  const ui = f.get(f.manifest.generatedUi);
  f.changeMapped('generatedUi', value => { value.projection.quote.maximumCostCents = 0; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
  f.changeMapped('generatedUi', value => Object.assign(value, ui));
  assert.equal(f.verify().report.provenance.normalErp.actualCostMinor, 28);
});

test('suite requires the distinct START receipt and the later CONTINUE dispatch before queue execution', t => {
  const f = suiteFlowFixture(fixture(t), png), acceptance = f.input.normalErp.acceptance;
  const original = readFileSync(acceptance.path);
  for (const field of ['startResponse', 'continueRequest', 'continueResponse']) {
    f.change(acceptance, value => { delete value[field]; });
    assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
    Object.assign(acceptance, f.put('suite-inputs.json', original));
  }
  f.changeMapped('submitted', value => { value.startExecutePosts = 0; });
  assert.throws(() => f.verify(), error => error.code === 'QA04_SUITE_INVALID');
});

test('writes only a new private artifact and is accepted by the unchanged formal consumer', async t => {
  for (const f of [fixture(t), draftFlowFixture(t), historicalDraftFlowFixture(t), suiteFlowFixture(fixture(t), png)]) {
  const outputPath = path.join(f.evidenceRoot, 'final.json');
  assert.equal(typeof subject.writeQa04FinalAcceptance, 'function', 'durable formal producer must exist');
  const result = subject.writeQa04FinalAcceptance({ inputPath: f.inputPath, inputSha256: f.save(), repositoryRoot: f.repositoryRoot, now: NOW, outputPath });
  assert.equal(hash(readFileSync(outputPath)), result.outputSha256);
  assert.deepEqual(JSON.parse(readFileSync(outputPath)), result.report);
  assert.throws(() => subject.writeQa04FinalAcceptance({ inputPath: f.inputPath, inputSha256: f.save(), repositoryRoot: f.repositoryRoot, now: NOW, outputPath }), error => error.code === 'QA04_OUTPUT_UNSAFE');
  assert.throws(() => subject.writeQa04FinalAcceptance({ inputPath: f.inputPath, inputSha256: f.save(), repositoryRoot: f.repositoryRoot, now: NOW, outputPath: path.join(f.repositoryRoot, 'final.json') }), error => error.code === 'QA04_OUTPUT_UNSAFE');
  const source = readFileSync(new URL('./rel04-dark-canary.mjs', import.meta.url), 'utf8');
  const begin = source.indexOf('function readQa04Acceptance('), end = source.indexOf('\nfunction credential(', begin);
  assert.ok(begin >= 0 && end > begin);
  const requiredGates = source.match(/const QA04_REQUIRED_GATES = Object\.freeze\(\[[\s\S]*?\]\);/u);
  assert.ok(requiredGates);
  const { default: vm } = await import('node:vm');
  const consumer = vm.runInNewContext(`${requiredGates[0]}\n${source.slice(begin, end)}\nreadQa04Acceptance`, {
    Buffer, readPrivateFileBytes: filename => readFileSync(filename), sha256: hash,
    fail: code => { throw Error(code); }, canonicalJson: json,
    canonicalTimestamp: value => { assert.equal(new Date(value).toISOString(), value); return value; },
  });
  assert.equal(consumer(outputPath, result.outputSha256, f.repositoryRoot, f.targetGitCommit).sha256, result.outputSha256);
  const changed = { ...result.report, gates: [...result.report.gates].reverse() };
  const incorrect = f.put('wrong-order.json', changed);
  assert.throws(() => consumer(incorrect.path, incorrect.sha256, f.repositoryRoot, f.targetGitCommit), /QA04_ACCEPTANCE_INVALID/u);
  }
});

test('CLI does not expose supplied bytes or create an output when arguments are invalid', () => {
  const result = spawnSync(process.execPath, ['scripts/qa04-final-acceptance.mjs', '--complete', 'SYNTHETIC_SECRET_SENTINEL'], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(result.status, 0);
  assert.equal(`${result.stdout}${result.stderr}`.includes('SYNTHETIC_SECRET_SENTINEL'), false);
});
