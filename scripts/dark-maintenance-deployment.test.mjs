import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { QA04_OFFLINE_STEPS } from './qa04-offline-gate.mjs';
import { REL04_DARK_CONFIG_KEYS } from './rel04-dark-canary.mjs';
import { validateRel04DarkCanarySummary } from './extension-website-publication-approval.mjs';
import { checksumAiPromptRevision } from '../apps/server/src/services/ai-prompt-templates.ts';
import { canonicalExtensionReleaseEvidenceJson, parseExtensionReleaseEvidence } from './extension-release-contract.mjs';
import { canonicalReleaseSignatureJson, canonicalTrustedKeyringJson, releaseSignaturePayload } from './extension-release-publication-contract.mjs';

const implementation = existsSync(new URL('./dark-maintenance-deployment.mjs', import.meta.url))
  ? await import('./dark-maintenance-deployment.mjs') : {};
const apiOrigin = 'https://api.example.com';
const commit = 'b'.repeat(40);
const previousCommit = 'a'.repeat(40);
const token = 'synthetic-super-admin.secret.token';
const baselineTime = '2030-01-01T01:00:00.000Z';
const acceptanceTime = '2030-01-01T01:11:00.000Z';
const sha = value => createHash('sha256').update(value).digest('hex');

function feature(name) {
  assert.equal(typeof implementation[name], 'function', `${name} must be implemented`);
  return implementation[name];
}

function input(mode = 'baseline') {
  return {
    mode, adminToken: token,
    candidate: { gitCommit: commit, apiOrigin, region: 'COM', version: '1.2.3',
      releaseEvidenceSha256: 'c'.repeat(64), releaseSignatureSha256: 'd'.repeat(64) },
    releaseSignedAt: '2030-01-01T00:20:00.000Z',
    offline: { schemaVersion: 1, kind: 'SS_ERP_QA04_OFFLINE_REHEARSAL', gitCommit: commit,
      startedAt: '2030-01-01T00:00:00.000Z', completedAt: '2030-01-01T00:10:00.000Z',
      status: 'PASS', command: 'pnpm qa:04:offline', completesFormalTask: false,
      externalAccess: 'NO_PROVIDER_OR_VPS', steps: QA04_OFFLINE_STEPS.map(step => step.id) },
    backup: { schemaVersion: 1, kind: 'SS_ERP_DARK_MAINTENANCE_BACKUP', scope: 'MAINTENANCE_DARK_DEPLOY',
      targetGitCommit: commit, region: 'COM', databaseId: 'com-fixture-db',
      databaseIdentitySha256: '1'.repeat(64), databaseUuidSha256: '2'.repeat(64),
      attestationSha256: '3'.repeat(64), backupSha256: '4'.repeat(64),
      backupCreatedAt: '2030-01-01T00:25:00.000Z', restoreStartedAt: '2030-01-01T00:30:00.000Z',
      restoreCompletedAt: '2030-01-01T00:35:00.000Z', verifiedAt: '2030-01-01T00:40:00.000Z',
      maximumAgeMinutes: 120, nativeVerifier: 'verify-deploy-backup.sh' },
  };
}

function publishedSource(key) {
  const content = { templateKey: key, promptTemplate: 'Edit only as requested: {{user_prompt}}',
    negativePromptTemplate: '{{user_negative_prompt}}' };
  const checksum = checksumAiPromptRevision(content);
  const release = { id: `release-${key}`, templateKey: key, revisionId: `revision-${key}`,
    sequence: 1, action: 'PUBLISH', testRunId: `test-${key}`, createdAt: '2029-12-30T00:02:00.000Z' };
  return { schemaVersion: 1, kind: 'AI_PROMPT_PUBLISHED_SOURCE_V1', templateKey: key,
    activeRelease: release, publicationRelease: { ...release },
    revision: { id: release.revisionId, ...content, checksum, status: 'PUBLISHED', createdAt: '2029-12-30T00:00:00.000Z' },
    testRun: { id: release.testRunId, revisionId: release.revisionId, revisionChecksum: checksum,
      status: 'PASS', createdAt: '2029-12-30T00:01:00.000Z' } };
}

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function fetcher(options = {}) {
  const calls = [];
  const fetch = async (rawUrl, init) => {
    const url = new URL(rawUrl);
    calls.push({ path: url.pathname, ...init });
    assert.equal(url.origin, apiOrigin);
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert.ok(init.signal);
    if (options.throwSecret) throw new Error(token);
    if (url.pathname === '/api/user/me') {
      return response({ code: 1, data: { id: 'synthetic-admin', role: 'ADMIN', isSuperAdmin: !options.ordinaryAdmin } });
    }
    if (url.pathname === '/ready') {
      if (options.oversized) return response({}, 200, { 'content-length': '300000' });
      if (options.redirected) {
        const value = response({});
        Object.defineProperty(value, 'redirected', { value: true });
        return value;
      }
      return response({ status: 'ready', checks: { db: 'ok', redis: 'ok' },
        deployment: { gitCommit: options.deployedCommit || (options.deployed ? commit : previousCommit) } });
    }
    if (url.pathname === '/api/extensions/latest') {
      if (options.missingPublication) return response({ code: 0 }, 404);
      return response({ code: 1, data: { gitCommit: options.publicCommit || previousCommit,
        version: '1.0.1', signatureStatus: 'EXTERNAL_REQUIRED', publicationApprovalSha256: '5'.repeat(64),
        targets: Object.fromEntries(['cloud', 'local'].map((target, index) => [target, {
          filename: `ss-erp-${target}-1.0.1.zip`, sha256: String(index + 6).repeat(64),
          downloadUrl: options.badDownloadUrl ? 'https://foreign.example.com/download'
            : `${apiOrigin}/api/extensions/download/${target}/1.0.1/${String(index + 6).repeat(64)}`,
        }])) } });
    }
    if (url.pathname.startsWith('/api/admin/system-config/')) {
      const key = url.pathname.split('/').at(-1);
      assert.ok(REL04_DARK_CONFIG_KEYS.includes(key));
      let value = 'false';
      if (key.endsWith('_provider')) value = 'disabled';
      if (key === 'ai_media_workflow_v2_rollout_policy') value = JSON.stringify({ revision: 0, tenantIds: [] });
      if (key === 'extension_byok_admin_policy') value = JSON.stringify({
        contractVersion: 'extension-byok-admin-policy/v1', revision: 0, mode: 'off', ownerUserIds: [],
        shopIds: [], deviceSessionIds: [], allowedOrigins: [], allowedOperations: [], maxConcurrency: 1,
      });
      if (key === options.enabledFlag) value = 'true';
      if (options.missingConfig && key === 'feature_source_listing_extension_workbench') return response({ code: 0, msg: '配置不存在' }, 404);
      if (options.genericConfig404) return response({ message: 'Route not found' }, 404);
      return response({ code: 1, data: { key, value } });
    }
    if (url.pathname === '/api/ai-images/capabilities') {
      return response({ code: 1, data: { workflowEnabled: false, webMediaEnabled: false,
        applications: { applyEnabled: false, listingDraftApplyEnabled: false },
        operations: Object.fromEntries(['IMAGE_TO_IMAGE', 'IMAGE_TRANSLATE', 'FULL_EDIT', 'INPAINT']
          .map(operation => [operation, { ready: !!options.readyOperation }])) } });
    }
    const match = url.pathname.match(/^\/api\/admin\/ai-prompt-templates\/(full-image-edit\.base|inpaint\.base)\/source$/u);
    if (match) {
      if (!new Headers(init.headers).has('authorization')) {
        return options.anonymousSource ? response({ code: 1, data: publishedSource(match[1]) }) : response({ code: 0 }, 401);
      }
      if (options.missingSource) return response({ code: 0, error: { code: 'ACTIVE_RELEASE_NOT_FOUND' } }, 404, { 'cache-control': 'no-store' });
      if (options.genericSource404) return response({ message: 'Route not found' }, 404);
      const source = publishedSource(match[1]);
      if (options.badChecksum) source.revision.checksum = 'f'.repeat(64);
      return response({ code: 1, data: source }, 200, { 'cache-control': 'no-store' });
    }
    throw new Error(`Unexpected maintenance route: ${url.pathname}`);
  };
  return { fetch, calls };
}

async function baseline() {
  const network = fetcher();
  const value = await feature('runDarkMaintenanceProbe')(input(), { fetch: network.fetch, now: () => new Date(baselineTime) });
  return { value, network };
}

function vps(candidate) {
  return { schemaVersion: 1, kind: 'SS_ERP_VPS_VERIFICATION', scope: 'FULL', status: 'PASS',
    startedAt: '2030-01-01T01:05:00.000Z', completedAt: '2030-01-01T01:10:00.000Z',
    failures: 0, warnings: 1, candidate };
}

test('captures a signed-candidate baseline using only bounded GETs and redacted identities', async () => {
  const { value, network } = await baseline();
  assert.equal(value.kind, 'SS_ERP_DARK_MAINTENANCE_BASELINE');
  assert.equal(value.scope, 'MAINTENANCE_DARK_DEPLOY');
  assert.equal(value.previousDeploymentCommit, previousCommit);
  assert.equal(value.publication.gitCommit, previousCommit);
  assert.equal(value.formalQa04Completed, false);
  assert.equal(value.qa02Prerequisite, 'INCOMPLETE');
  assert.ok(network.calls.every(call => call.method === 'GET'));
  assert.ok(!network.calls.some(call => call.path.endsWith('/ai-prompt-templates')));
  assert.ok(!JSON.stringify(value).includes(token));
});

test('accepts the new deployed commit, exact old publication and authentic read-only template sources', async () => {
  const before = (await baseline()).value;
  const target = input('acceptance');
  const network = fetcher({ deployed: true });
  const value = await feature('runDarkMaintenanceProbe')({ ...target, baseline: before, vps: vps(target.candidate) },
    { fetch: network.fetch, now: () => new Date(acceptanceTime) });
  assert.equal(value.kind, 'SS_ERP_DARK_MAINTENANCE_ACCEPTANCE');
  assert.equal(value.status, 'PASS');
  assert.equal(value.formalQa04Completed, false);
  assert.equal(value.sources.length, 2);
  assert.ok(value.sources.every(source => source.state === 'AVAILABLE' && /^[a-f0-9]{64}$/u.test(source.sha256)));
  assert.equal(value.publication.gitCommit, before.publication.gitCommit);
  assert.throws(() => validateRel04DarkCanarySummary(value, { expectedGitCommit: commit, expectedApiOrigin: apiOrigin }));
  assert.ok(!JSON.stringify(value).includes(token));
});

test('distinguishes a known empty source from an unavailable HTTP route', async () => {
  const before = (await baseline()).value;
  const target = input('acceptance');
  const network = fetcher({ deployed: true, missingSource: true });
  const value = await feature('runDarkMaintenanceProbe')({ ...target, baseline: before, vps: vps(target.candidate) },
    { fetch: network.fetch, now: () => new Date(acceptanceTime) });
  assert.ok(value.sources.every(source => source.state === 'SOURCE_UNAVAILABLE' && source.sha256 === null));
});

for (const [name, options] of [
  ['another old website commit', { publicCommit: 'e'.repeat(40) }],
  ['lost old publication', { missingPublication: true }],
  ['public target candidate', { publicCommit: commit }],
  ['changed website download URL', { badDownloadUrl: true }],
  ['non-super administrator', { ordinaryAdmin: true }],
  ['anonymous template access', { anonymousSource: true }],
  ['generic template 404', { genericSource404: true }],
  ['invalid template checksum', { badChecksum: true }],
  ['enabled workflow', { enabledFlag: 'feature_ai_media_workflow_v2' }],
  ['ready operation despite dark flags', { readyOperation: true }],
  ['generic config 404', { genericConfig404: true }],
  ['wrong deployed commit', { deployedCommit: 'e'.repeat(40) }],
  ['oversized response', { oversized: true }],
  ['redirect', { redirected: true }],
]) {
  test(`rejects ${name}`, async () => {
    const before = (await baseline()).value;
    const target = input('acceptance');
    const network = fetcher({ deployed: true, ...options });
    await assert.rejects(() => feature('runDarkMaintenanceProbe')({ ...target, baseline: before, vps: vps(target.candidate) },
      { fetch: network.fetch, now: () => new Date(acceptanceTime) }));
  });
}

for (const [name, mutate] of [
  ['wrong backup target', value => { value.backup.targetGitCommit = previousCommit; }],
  ['wrong backup region', value => { value.backup.region = 'CN'; }],
  ['stale backup', value => { value.backup.backupCreatedAt = '2029-12-31T20:00:00.000Z'; }],
  ['future backup verification', value => { value.backup.verifiedAt = '2030-01-02T00:00:00.000Z'; }],
  ['relaxed backup timeout', value => { value.backup.maximumAgeMinutes = 1440; }],
  ['wrong offline target', value => { value.offline.gitCommit = previousCommit; }],
  ['incomplete offline gate', value => { value.offline.steps.pop(); }],
  ['future signature', value => { value.releaseSignedAt = '2030-01-02T00:00:00.000Z'; }],
  ['signature before verification', value => { value.releaseSignedAt = '2030-01-01T00:01:00.000Z'; }],
  ['unknown operation', value => { value.mode = 'deploy'; }],
]) {
  test(`rejects ${name} before any network call`, async () => {
    const target = input();
    mutate(target);
    const network = fetcher();
    await assert.rejects(() => feature('runDarkMaintenanceProbe')(target,
      { fetch: network.fetch, now: () => new Date(baselineTime) }));
    assert.equal(network.calls.length, 0);
  });
}

test('redacts a thrown request error containing credentials', async () => {
  const network = fetcher({ throwSecret: true });
  await assert.rejects(() => feature('runDarkMaintenanceProbe')(input(),
    { fetch: network.fetch, now: () => new Date(baselineTime) }), error => !String(error).includes(token));
});

function artifactFixture(callback) {
  const root = mkdtempSync(path.join(tmpdir(), 'ss-erp-maintenance-'));
  const repository = path.join(root, 'checkout');
  const privateRoot = path.join(root, 'private');
  mkdirSync(repository);
  mkdirSync(privateRoot);
  mkdirSync(path.join(repository, 'config'));
  const json = (filename, value) => {
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    const file = path.join(privateRoot, filename);
    writeFileSync(file, bytes, { mode: 0o600 });
    return { file, sha256: sha(bytes) };
  };
  try { return callback({ root, repository, privateRoot, json }); }
  finally {
    assert.equal(path.dirname(path.resolve(root)).toLowerCase(), path.resolve(tmpdir()).toLowerCase());
    assert.ok(path.basename(root).startsWith('ss-erp-maintenance-'));
    rmSync(root, { recursive: true, force: true });
  }
}

function signedFiles(value) {
  const target = input();
  const buildRoot = path.join(value.root, 'candidate');
  mkdirSync(buildRoot);
  const evidence = parseExtensionReleaseEvidence({ schemaVersion: 1, gitCommit: commit, version: '1.2.3',
    provenance: { commitSource: 'GIT_HEAD', sourceMode: 'REPOSITORY_SOURCE', packageInputsSha256: 'a'.repeat(64) },
    expectedOrigins: { web: 'https://app.example.com', admin: 'https://admin.example.com', api: apiOrigin, local: 'http://127.0.0.1:3001' },
    artifacts: Object.fromEntries(['cloud', 'local'].map(target => [target, { target,
      filename: `ss-erp-${target}-1.2.3.zip`, zipSha256: 'b'.repeat(64), fileCount: 1 }])),
    checksumFilename: 'ss-erp-extension-1.2.3.sha256', signature: { status: 'EXTERNAL_REQUIRED' } });
  const evidenceBytes = Buffer.from(canonicalExtensionReleaseEvidenceJson(evidence));
  const evidenceName = 'ss-erp-extension-1.2.3.release-evidence.json';
  writeFileSync(path.join(buildRoot, evidenceName), evidenceBytes);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyId = 'maintenance-fixture-key';
  writeFileSync(path.join(value.repository, 'config/extension-release-trusted-keys.json'), canonicalTrustedKeyringJson({
    schemaVersion: 1, kind: 'SS_ERP_EXTENSION_RELEASE_TRUSTED_KEYS', keys: [{ algorithm: 'Ed25519', keyId,
      status: 'ACTIVE', publicKeyBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }] }));
  const signature = { schemaVersion: 1, kind: 'SS_ERP_EXTENSION_RELEASE_SIGNATURE', algorithm: 'Ed25519', keyId,
    signedAt: target.releaseSignedAt, releaseEvidenceFilename: evidenceName,
    releaseEvidenceSha256: sha(evidenceBytes), signatureBase64: '' };
  signature.signatureBase64 = sign(null, releaseSignaturePayload(signature, evidenceBytes), privateKey).toString('base64');
  const signatureBytes = Buffer.from(canonicalReleaseSignatureJson(signature));
  const signaturePath = path.join(value.privateRoot, 'ss-erp-extension-1.2.3.release-signature.json');
  writeFileSync(signaturePath, signatureBytes, { mode: 0o600 });
  const offline = value.json('offline.json', target.offline);
  const backup = value.json('backup.json', target.backup);
  const tokenFile = path.join(value.privateRoot, 'admin.token');
  writeFileSync(tokenFile, token, { mode: 0o600 });
  const environment = { MAINTENANCE_TARGET_COMMIT: commit, MAINTENANCE_REGION: 'COM',
    MAINTENANCE_API_ORIGIN: apiOrigin, MAINTENANCE_DATABASE_ID: target.backup.databaseId,
    MAINTENANCE_RELEASE_BUILD_ROOT: buildRoot, MAINTENANCE_RELEASE_SIGNATURE_FILE: signaturePath,
    MAINTENANCE_RELEASE_SIGNATURE_SHA256: sha(signatureBytes),
    MAINTENANCE_OFFLINE_FILE: offline.file, MAINTENANCE_OFFLINE_SHA256: offline.sha256,
    MAINTENANCE_BACKUP_FILE: backup.file, MAINTENANCE_BACKUP_SHA256: backup.sha256,
    MAINTENANCE_SUPER_ADMIN_TOKEN_FILE: tokenFile, MAINTENANCE_OUTPUT_FILE: path.join(value.privateRoot, 'result.json') };
  return { environment, signaturePath, signatureBytes, offline, tokenFile };
}

test('loads real Ed25519 evidence and native prerequisites before reading a private token', () => {
  artifactFixture(value => {
    const files = signedFiles(value);
    const loaded = feature('loadMaintenanceProbeInput')('baseline', files.environment, value.repository, baselineTime,
      { readProvenance: () => ({ repositoryRoot: value.repository, gitCommit: commit }) });
    assert.equal(loaded.adminToken, token);
    assert.equal(loaded.candidate.releaseSignatureSha256, sha(files.signatureBytes));
    assert.equal(loaded.databaseId, 'com-fixture-db');
  });
});

test('rejects a bad evidence digest before attempting to open a token', () => {
  artifactFixture(value => {
    const { environment } = signedFiles(value);
    environment.MAINTENANCE_OFFLINE_SHA256 = 'f'.repeat(64);
    environment.MAINTENANCE_SUPER_ADMIN_TOKEN_FILE = path.join(value.privateRoot, 'missing.token');
    assert.throws(() => feature('loadMaintenanceProbeInput')('baseline', environment, value.repository, baselineTime,
      { readProvenance: () => ({ repositoryRoot: value.repository, gitCommit: commit }) }),
    error => error.code === 'MAINTENANCE_EVIDENCE_DIGEST_MISMATCH');
  });
});

test('rejects signature tampering and a stale checkout before network or token use', () => {
  artifactFixture(value => {
    const files = signedFiles(value);
    const changed = JSON.parse(files.signatureBytes.toString());
    changed.signatureBase64 = Buffer.alloc(64, 1).toString('base64');
    const bytes = Buffer.from(canonicalReleaseSignatureJson(changed));
    writeFileSync(files.signaturePath, bytes);
    files.environment.MAINTENANCE_RELEASE_SIGNATURE_SHA256 = sha(bytes);
    assert.throws(() => feature('loadMaintenanceProbeInput')('baseline', files.environment, value.repository, baselineTime,
      { readProvenance: () => ({ repositoryRoot: value.repository, gitCommit: commit }) }));
    assert.throws(() => feature('loadMaintenanceProbeInput')('baseline', files.environment, value.repository, baselineTime,
      { readProvenance: () => ({ repositoryRoot: value.repository, gitCommit: previousCommit }) }));
  });
});

test('rejects a token reached through a directory link', () => {
  artifactFixture(value => {
    const files = signedFiles(value);
    const alias = path.join(value.root, 'token-alias');
    symlinkSync(value.privateRoot, alias, 'junction');
    files.environment.MAINTENANCE_SUPER_ADMIN_TOKEN_FILE = path.join(alias, 'admin.token');
    assert.throws(() => feature('loadMaintenanceProbeInput')('baseline', files.environment, value.repository, baselineTime,
      { readProvenance: () => ({ repositoryRoot: value.repository, gitCommit: commit }) }));
  });
});

function nativeBackup(value) {
  const source = input().backup;
  const native = { schemaVersion: 2, kind: 'SS_ERP_DEPLOY_BACKUP_ATTESTATION', databaseId: source.databaseId,
    databaseIdentitySha256: source.databaseIdentitySha256, databaseUuidSha256: source.databaseUuidSha256,
    targetGitCommit: commit,
    backup: { filename: 'ss_erp_synthetic.sql.gz', createdAt: source.backupCreatedAt, bytes: 100,
      sha256: source.backupSha256, statusSha256: 'a'.repeat(64) },
    restoreDrill: { status: 'PASSED', startedAt: source.restoreStartedAt, completedAt: source.restoreCompletedAt, tableCount: 144 } };
  const attestation = value.json(`deploy-backup-${commit}.attestation.json`, native);
  const envFile = path.join(value.privateRoot, 'deployment.env');
  writeFileSync(envFile, `DATABASE_URL=postgresql://fixture:synthetic-db-secret@127.0.0.1:5432/fixture\nDEPLOY_DATABASE_ID=${source.databaseId}\nDEPLOY_BACKUP_LOCAL_DIR=${value.privateRoot.replaceAll('\\', '/')}\nAI_IMAGE_SANDBOX_API_KEY=unrelated-secret\nNODE_OPTIONS=--inspect\n`, { mode: 0o600 });
  return { envFile, attestation };
}

test('binds backup evidence only after the existing native verifier with the 120-minute limit', () => {
  artifactFixture(value => {
    const files = nativeBackup(value);
    let calls = 0;
    const report = feature('recordMaintenanceBackupBinding')({ repositoryRoot: value.repository,
      envFile: files.envFile, region: 'COM', targetGitCommit: commit, now: () => new Date(baselineTime) }, {
      runner(command, args, options) {
        calls += 1;
        assert.equal(command, 'bash');
        assert.equal(path.basename(args[0]), 'verify-deploy-backup.sh');
        assert.equal(path.basename(path.dirname(args[0])), 'scripts');
        assert.equal(args[1], commit);
        assert.equal(options.env.DEPLOY_BACKUP_MAX_AGE_MINUTES, '120');
        assert.equal(options.env.AI_IMAGE_SANDBOX_API_KEY, undefined);
        assert.equal(options.env.NODE_OPTIONS, undefined);
        return { status: 0, stdout: 'PASS deploy backup attestation verified\n' };
      },
    });
    assert.equal(calls, 1);
    assert.equal(report.attestationSha256, files.attestation.sha256);
    assert.equal(report.kind, 'SS_ERP_DARK_MAINTENANCE_BACKUP');
    assert.ok(!JSON.stringify(report).includes('synthetic-db-secret'));
  });
});

test('preserves the native verifier application-backup separation input', () => {
  artifactFixture(value => {
    const files = nativeBackup(value);
    writeFileSync(files.envFile, `${readFileSync(files.envFile, 'utf8')}BACKUP_LOCAL_DIR=/srv/application-backups\n`);
    feature('recordMaintenanceBackupBinding')({ repositoryRoot: value.repository, envFile: files.envFile,
      region: 'COM', targetGitCommit: commit, now: () => new Date(baselineTime) }, {
      runner(_command, _args, options) {
        assert.equal(options.env.BACKUP_LOCAL_DIR, '/srv/application-backups');
        return { status: 0 };
      },
    });
  });
});

for (const scenario of ['native-failure', 'changed-attestation']) {
  test(`does not bind a backup after ${scenario}`, () => {
    artifactFixture(value => {
      const files = nativeBackup(value);
      assert.throws(() => feature('recordMaintenanceBackupBinding')({ repositoryRoot: value.repository,
        envFile: files.envFile, region: 'COM', targetGitCommit: commit, now: () => new Date(baselineTime) }, {
        runner() {
          if (scenario === 'changed-attestation') writeFileSync(files.attestation.file, '{}\n');
          return { status: scenario === 'native-failure' ? 1 : 0 };
        },
      }));
    });
  });
}

test('writes private evidence once and rejects repository output', () => {
  artifactFixture(value => {
    const output = path.join(value.privateRoot, 'receipt.json');
    const report = input().backup;
    feature('writeMaintenanceEvidence')(output, report, value.repository);
    assert.equal(readFileSync(output, 'utf8'), `${JSON.stringify(report, null, 2)}\n`);
    assert.throws(() => feature('writeMaintenanceEvidence')(output, report, value.repository));
    assert.throws(() => feature('writeMaintenanceEvidence')(path.join(value.repository, 'leak.json'), report, value.repository));
  });
});

test('CLI rejects mixed modes without echoing argument secrets', () => {
  const result = spawnSync(process.execPath, ['scripts/dark-maintenance-deployment.mjs', '--baseline', 'synthetic-argument-secret'],
    { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.ok(!`${result.stdout}${result.stderr}`.includes('synthetic-argument-secret'));
});

test('exposes separate operator modes and includes the maintenance tests in preflight', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.match(packageJson.scripts['maintenance:backup:bind'] || '', /dark-maintenance-deployment\.mjs --backup-binding$/u);
  assert.match(packageJson.scripts['maintenance:baseline'] || '', /dark-maintenance-deployment\.mjs --baseline$/u);
  assert.match(packageJson.scripts['maintenance:verify'] || '', /dark-maintenance-deployment\.mjs --acceptance$/u);
  assert.match(readFileSync('scripts/preflight.mjs', 'utf8'), /scripts\/dark-maintenance-deployment\.test\.mjs/u);
});

test('accepts the existing API not-found contract for an absent default-off config', async () => {
  const network = fetcher({ missingConfig: true });
  const result = await feature('runDarkMaintenanceProbe')(input(), { fetch: network.fetch, now: () => new Date(baselineTime) });
  assert.equal(result.policy.extensionWorkbench, 'absent');
});

test('rejects a probe clock that moves backwards instead of emitting PASS', async () => {
  const times = [baselineTime, '2030-01-01T00:59:00.000Z'];
  const network = fetcher();
  await assert.rejects(() => feature('runDarkMaintenanceProbe')(input(), {
    fetch: network.fetch, now: () => new Date(times.shift()),
  }));
});

for (const [name, mutate] of [
  ['another candidate', value => { value.vps.candidate = { ...value.candidate, version: '2.0.0' }; }],
  ['failed VPS run', value => { value.vps.status = 'FAIL'; value.vps.failures = 1; }],
  ['VPS before baseline', value => { value.vps.startedAt = '2030-01-01T00:50:00.000Z'; }],
  ['VPS in future', value => { value.vps.completedAt = '2030-01-01T01:12:00.000Z'; }],
  ['forged baseline kind', value => { value.baseline.kind = 'SS_ERP_REL04_DARK_CANARY'; }],
  ['baseline POST', value => { value.baseline.requestAudit[0].method = 'POST'; }],
  ['unknown audit fields', value => { value.baseline.requestAudit[0].token = 'injected-secret'; }],
  ['unsuccessful baseline request', value => { value.baseline.requestAudit[0].status = 400; }],
  ['baseline before its signature', value => { value.baseline.startedAt = '2030-01-01T00:15:00.000Z'; }],
  ['baseline promotion', value => { value.baseline.formalQa04Completed = true; }],
]) {
  test(`rejects ${name} before acceptance network I/O`, async () => {
    const before = (await baseline()).value;
    const target = input('acceptance');
    const request = { ...target, baseline: before, vps: vps(target.candidate) };
    mutate(request);
    const network = fetcher({ deployed: true });
    await assert.rejects(() => feature('runDarkMaintenanceProbe')(request,
      { fetch: network.fetch, now: () => new Date(acceptanceTime) }));
    assert.equal(network.calls.length, 0);
  });
}
