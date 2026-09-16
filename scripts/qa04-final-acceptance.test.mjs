import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { QA04_OFFLINE_STEPS } from './qa04-offline-gate.mjs';

let subject = {};
try { subject = await import('./qa04-final-acceptance.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

const NOW = '2026-09-16T12:00:00.000Z';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const sortedJson = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(sortedJson).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${sortedJson(value[key])}`).join(',')}}`;
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
  for (const name of ['apps/server/src/rule.ts', 'apps/server/prisma/schema.prisma', 'apps/server/package.json', 'packages/shared/src/contracts.ts', 'packages/shared/package.json', 'pnpm-lock.yaml', 'tsconfig.base.json']) {
    mkdirSync(path.dirname(path.join(repositoryRoot, name)), { recursive: true });
    writeFileSync(path.join(repositoryRoot, name), 'fixture\n');
  }
  writeFileSync(path.join(repositoryRoot, 'package.json'), json({ name: 'fixture', private: true,
    scripts: { test: 'node --test', build: 'node --version', postinstall: 'node --version' },
    devDependencies: { example: '1.0.0' }, packageManager: 'pnpm@10.0.0' }));
  writeFileSync(path.join(repositoryRoot, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n');
  git('add', '--', 'apps/server', 'packages/shared', 'pnpm-lock.yaml', 'tsconfig.base.json', 'package.json', 'pnpm-workspace.yaml');
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

test('writes only a new private artifact and is accepted by the unchanged formal consumer', async t => {
  const f = fixture(t), outputPath = path.join(f.evidenceRoot, 'final.json');
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
});

test('CLI does not expose supplied bytes or create an output when arguments are invalid', () => {
  const result = spawnSync(process.execPath, ['scripts/qa04-final-acceptance.mjs', '--complete', 'SYNTHETIC_SECRET_SENTINEL'], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(result.status, 0);
  assert.equal(`${result.stdout}${result.stderr}`.includes('SYNTHETIC_SECRET_SENTINEL'), false);
});
