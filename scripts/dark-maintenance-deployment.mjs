#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseEnv } from 'node:util';
import { parseQa04OfflineEvidence, readQa04GitProvenance } from './qa04-offline-gate.mjs';
import { REL04_DARK_CONFIG_KEYS } from './rel04-dark-canary.mjs';
import { verifyAiMediaDarkPolicy } from './verify-ai-media-dark-policy.mjs';
import { writeNewArtifactDurably } from './extension-release-artifact.mjs';
import { readStablePublicationFile } from './extension-website-publication-approval.mjs';
import { verifyExtensionReleaseSignature } from './verify-extension-release-signature.mjs';
import { canonicalExtensionReleaseEvidenceJson, parseExtensionReleaseEvidence } from './extension-release-contract.mjs';
import { parseRel04CandidateIdentity, parseVpsVerificationEvidence,
  validateRel04ReleaseBinding } from '../packages/shared/src/rel04-release-evidence-runtime.mjs';

export const DARK_MAINTENANCE_SCOPE = 'MAINTENANCE_DARK_DEPLOY';
const SOURCE_KEYS = ['full-image-edit.base', 'inpaint.base'];
const OPERATIONS = ['IMAGE_TO_IMAGE', 'IMAGE_TRANSLATE', 'FULL_EDIT', 'INPAINT'];
const MAX_RESPONSE_BYTES = 256 * 1024;
const BACKUP_MAX_AGE_MS = 120 * 60 * 1000;
const BASELINE_MAX_AGE_MS = 120 * 60 * 1000;
const canonicalJson = value => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const evidenceSha256 = value => sha256(canonicalJson(value));

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function object(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (keys && !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()))) fail(code);
  return value;
}

function digest(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail('MAINTENANCE_DIGEST_INVALID');
  return value;
}

function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) fail('MAINTENANCE_TIMESTAMP_INVALID');
  return value;
}

function fresh(value, observedAt, maximumAge) {
  const age = Date.parse(timestamp(observedAt)) - Date.parse(timestamp(value));
  if (age < 0 || age > maximumAge) fail('MAINTENANCE_EVIDENCE_STALE');
}

export function parseMaintenanceBackupBinding(value, expected, observedAt) {
  const item = object(value, ['schemaVersion', 'kind', 'scope', 'targetGitCommit', 'region',
    'databaseId', 'databaseIdentitySha256', 'databaseUuidSha256', 'attestationSha256', 'backupSha256',
    'backupCreatedAt', 'restoreStartedAt', 'restoreCompletedAt', 'verifiedAt',
    'maximumAgeMinutes', 'nativeVerifier'], 'MAINTENANCE_BACKUP_INVALID');
  if (item.schemaVersion !== 1 || item.kind !== 'SS_ERP_DARK_MAINTENANCE_BACKUP'
    || item.scope !== DARK_MAINTENANCE_SCOPE || item.targetGitCommit !== expected.gitCommit
    || item.region !== expected.region || item.maximumAgeMinutes !== 120
    || item.nativeVerifier !== 'verify-deploy-backup.sh'
    || typeof item.databaseId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(item.databaseId)
    || (expected.databaseId !== undefined && item.databaseId !== expected.databaseId)) {
    fail('MAINTENANCE_BACKUP_INVALID');
  }
  for (const key of ['databaseIdentitySha256', 'databaseUuidSha256', 'attestationSha256', 'backupSha256']) digest(item[key]);
  const times = [item.backupCreatedAt, item.restoreStartedAt, item.restoreCompletedAt, item.verifiedAt, observedAt]
    .map(value => Date.parse(timestamp(value)));
  if (times.some((time, index) => index > 0 && time < times[index - 1])) fail('MAINTENANCE_BACKUP_CHRONOLOGY_INVALID');
  fresh(item.backupCreatedAt, observedAt, BACKUP_MAX_AGE_MS);
  return item;
}

function auditRoutes(mode) {
  return ['identity', 'ready-before', 'publication-before',
    ...REL04_DARK_CONFIG_KEYS.map(key => `config-before:${key}`), 'capabilities',
    ...(mode === 'acceptance' ? SOURCE_KEYS.flatMap(key => [`source-anonymous:${key}`, `source:${key}`]) : []),
    ...REL04_DARK_CONFIG_KEYS.map(key => `config-after:${key}`), 'ready-after', 'publication-after'];
}

const PROBE_EFFECTS = Object.freeze({ businessWrites: 0, providerRequests: 0, ozonWrites: 0,
  templateWrites: 0, featureFlagWrites: 0, deviceSessionWrites: 0 });

function parsePublication(value) {
  if (value === null) return null;
  const item = object(value, ['gitCommit', 'version', 'publicationApprovalSha256', 'targets'], 'MAINTENANCE_PUBLICATION_INVALID');
  if (typeof item.gitCommit !== 'string' || !/^[a-f0-9]{40}$/u.test(item.gitCommit)
    || typeof item.version !== 'string' || item.version.length > 32
    || !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(item.version)) fail('MAINTENANCE_PUBLICATION_INVALID');
  digest(item.publicationApprovalSha256);
  object(item.targets, ['cloud', 'local'], 'MAINTENANCE_PUBLICATION_INVALID');
  for (const target of ['cloud', 'local']) {
    const artifact = object(item.targets[target], ['filename', 'sha256'], 'MAINTENANCE_PUBLICATION_INVALID');
    if (artifact.filename !== `ss-erp-${target}-${item.version}.zip`) fail('MAINTENANCE_PUBLICATION_INVALID');
    digest(artifact.sha256);
  }
  return item;
}

export function parseMaintenanceBaseline(value, expected, observedAt) {
  const item = object(value, ['schemaVersion', 'kind', 'scope', 'status', 'startedAt', 'completedAt',
    'candidate', 'releaseSignedAt', 'offlineSha256', 'backupSha256', 'qa02Prerequisite',
    'formalQa04Completed', 'providerCapabilityPromoted', 'actorIdSha256', 'requestAudit',
    'probeEffects', 'publication', 'policy', 'capabilities', 'previousDeploymentCommit'], 'MAINTENANCE_BASELINE_INVALID');
  if (item.schemaVersion !== 1 || item.kind !== 'SS_ERP_DARK_MAINTENANCE_BASELINE'
    || item.scope !== DARK_MAINTENANCE_SCOPE || item.status !== 'PASS'
    || item.formalQa04Completed !== false || item.providerCapabilityPromoted !== false
    || item.qa02Prerequisite !== 'INCOMPLETE'
    || !isDeepStrictEqual(parseRel04CandidateIdentity(item.candidate), expected.candidate)
    || item.releaseSignedAt !== expected.releaseSignedAt
    || item.offlineSha256 !== evidenceSha256(expected.offline)
    || item.backupSha256 !== evidenceSha256(expected.backup)
    || !isDeepStrictEqual(item.probeEffects, PROBE_EFFECTS)
    || !/^[a-f0-9]{40}$/u.test(item.previousDeploymentCommit)
    || item.previousDeploymentCommit === expected.candidate.gitCommit) fail('MAINTENANCE_BASELINE_INVALID');
  digest(item.actorIdSha256);
  parsePublication(item.publication);
  if (item.publication?.gitCommit === expected.candidate.gitCommit) fail('MAINTENANCE_CANDIDATE_ALREADY_PUBLIC');
  if (Date.parse(timestamp(item.startedAt)) > Date.parse(timestamp(item.completedAt))
    || Date.parse(item.startedAt) < Date.parse(expected.releaseSignedAt)
    || Date.parse(item.startedAt) < Date.parse(expected.backup.verifiedAt)) fail('MAINTENANCE_TIMESTAMP_INVALID');
  fresh(item.completedAt, observedAt, BASELINE_MAX_AGE_MS);
  if (!Array.isArray(item.requestAudit) || !isDeepStrictEqual(item.requestAudit.map(row => row.route), auditRoutes('baseline'))
    || item.requestAudit.some(row => {
      object(row, ['route', 'method', 'status', 'bytes'], 'MAINTENANCE_BASELINE_AUDIT_INVALID');
      const allowedStatuses = /^(?:config-|publication-)/u.test(row.route) ? [200, 404] : [200];
      return row.method !== 'GET' || !Number.isSafeInteger(row.status)
        || !allowedStatuses.includes(row.status) || !Number.isSafeInteger(row.bytes)
        || row.bytes < 1 || row.bytes > MAX_RESPONSE_BYTES;
    })) fail('MAINTENANCE_BASELINE_AUDIT_INVALID');
  return item;
}

function prerequisites(input, observedAt) {
  if (!['baseline', 'acceptance'].includes(input.mode)) fail('MAINTENANCE_MODE_INVALID');
  const candidate = parseRel04CandidateIdentity(input.candidate);
  const offline = parseQa04OfflineEvidence(input.offline, candidate.gitCommit, observedAt);
  const backup = parseMaintenanceBackupBinding(input.backup, { ...candidate, databaseId: input.databaseId }, observedAt);
  const signedAt = timestamp(input.releaseSignedAt);
  if (Date.parse(signedAt) < Date.parse(offline.completedAt) || Date.parse(signedAt) > Date.parse(observedAt)) {
    fail('MAINTENANCE_SIGNATURE_CHRONOLOGY_INVALID');
  }
  const expected = { candidate, offline, backup, releaseSignedAt: signedAt };
  let baseline = null;
  let vps = null;
  if (input.mode === 'acceptance') {
    baseline = parseMaintenanceBaseline(input.baseline, expected, observedAt);
    vps = parseVpsVerificationEvidence(input.vps);
    validateRel04ReleaseBinding({ candidate: vps.candidate, vpsVerificationSha256: evidenceSha256(vps),
      vpsStartedAt: vps.startedAt, vpsVerifiedAt: vps.completedAt }, candidate, observedAt, signedAt);
    if (Date.parse(vps.startedAt) < Date.parse(baseline.completedAt)) fail('MAINTENANCE_VPS_PRECEDES_BASELINE');
  }
  return { ...expected, baseline, vps };
}

async function boundedJson(response, expectedOrigin) {
  if (response.redirected || (response.url && new URL(response.url).origin !== expectedOrigin)) fail('MAINTENANCE_REDIRECT_REJECTED');
  if (!/\bapplication\/json\b/iu.test(response.headers.get('content-type') || '')) fail('MAINTENANCE_RESPONSE_INVALID');
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_RESPONSE_BYTES)) fail('MAINTENANCE_RESPONSE_TOO_LARGE');
  const reader = response.body?.getReader();
  if (!reader) fail('MAINTENANCE_RESPONSE_INVALID');
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) fail('MAINTENANCE_RESPONSE_TOO_LARGE');
      chunks.push(part.value);
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return { body: JSON.parse(text), bytes };
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error?.code === 'MAINTENANCE_RESPONSE_TOO_LARGE') throw error;
    fail('MAINTENANCE_RESPONSE_INVALID');
  } finally { reader.releaseLock(); }
}

export async function runDarkMaintenanceProbe(input, { fetch: fetcher = globalThis.fetch, now = () => new Date() } = {}) {
  const startedAt = now().toISOString();
  const verified = prerequisites(input, startedAt);
  const { candidate, baseline } = verified;
  if (typeof input.adminToken !== 'string' || !/^[A-Za-z0-9._-]{20,8192}$/u.test(input.adminToken)) fail('MAINTENANCE_TOKEN_INVALID');
  const requestAudit = [];
  async function get(route, pathname, authenticated = true, statuses = [200]) {
    const url = new URL(pathname, candidate.apiOrigin);
    if (url.origin !== candidate.apiOrigin || url.search || url.hash
      || !auditRoutes(input.mode).includes(route)) fail('MAINTENANCE_REQUEST_FORBIDDEN');
    let response;
    try {
      response = await fetcher(url.href, { method: 'GET', redirect: 'error', credentials: 'omit',
        headers: { accept: 'application/json', 'accept-encoding': 'identity', 'cache-control': 'no-cache',
          ...(authenticated ? { authorization: `Bearer ${input.adminToken}` } : {}) },
        signal: AbortSignal.timeout(15_000) });
    } catch { fail('MAINTENANCE_NETWORK_FAILED'); }
    const parsed = await boundedJson(response, candidate.apiOrigin);
    requestAudit.push({ route, method: 'GET', status: response.status, bytes: parsed.bytes });
    if (!statuses.includes(response.status)) fail('MAINTENANCE_HTTP_STATUS_REJECTED');
    return { ...parsed, status: response.status, headers: response.headers };
  }
  async function ready(route) {
    const { body } = await get(route, '/ready', false);
    const deployed = body?.deployment?.gitCommit;
    if (body?.status !== 'ready' || body?.checks?.db !== 'ok' || body?.checks?.redis !== 'ok'
      || !/^[a-f0-9]{40}$/u.test(deployed)
      || (input.mode === 'acceptance' ? deployed !== candidate.gitCommit : deployed === candidate.gitCommit)) {
      fail('MAINTENANCE_DEPLOYMENT_NOT_READY');
    }
    return deployed;
  }
  async function publication(route) {
    const { body, status } = await get(route, '/api/extensions/latest', false, [200, 404]);
    if (status === 404) {
      if (body?.code !== 0) fail('MAINTENANCE_PUBLICATION_INVALID');
      return null;
    }
    const data = body?.data;
    if (body?.code !== 1 || data?.signatureStatus !== 'EXTERNAL_REQUIRED') fail('MAINTENANCE_PUBLICATION_INVALID');
    const result = parsePublication({ gitCommit: data.gitCommit, version: data.version,
      publicationApprovalSha256: data.publicationApprovalSha256,
      targets: Object.fromEntries(['cloud', 'local'].map(target => [target, {
        filename: data.targets?.[target]?.filename, sha256: data.targets?.[target]?.sha256,
      }])) });
    for (const target of ['cloud', 'local']) {
      const download = new URL(data.targets[target].downloadUrl, candidate.apiOrigin);
      if (download.origin !== candidate.apiOrigin || download.username || download.password || download.search || download.hash
        || download.pathname !== `/api/extensions/download/${target}/${result.version}/${result.targets[target].sha256}`) {
        fail('MAINTENANCE_PUBLICATION_URL_INVALID');
      }
    }
    if (result.gitCommit === candidate.gitCommit) fail('MAINTENANCE_CANDIDATE_ALREADY_PUBLIC');
    return result;
  }
  async function darkPolicy(phase) {
    const rows = [];
    for (const key of REL04_DARK_CONFIG_KEYS) {
      const { body, status } = await get(`config-${phase}:${key}`, `/api/admin/system-config/${key}`, true, [200, 404]);
      if (status === 404) {
        if (body?.code !== 0 || body?.msg !== '配置不存在') fail('MAINTENANCE_CONFIG_INVALID');
        continue;
      }
      if (body?.code !== 1 || body?.data?.key !== key || typeof body.data.value !== 'string') fail('MAINTENANCE_CONFIG_INVALID');
      rows.push({ key, value: body.data.value });
    }
    try { return verifyAiMediaDarkPolicy(rows); } catch { fail('MAINTENANCE_POLICY_NOT_DARK'); }
  }
  const identity = (await get('identity', '/api/user/me')).body;
  if (identity?.code !== 1 || identity.data?.role !== 'ADMIN' || identity.data?.isSuperAdmin !== true
    || typeof identity.data?.id !== 'string' || !identity.data.id) fail('MAINTENANCE_SUPER_ADMIN_REQUIRED');
  const actorIdSha256 = sha256(`SS_ERP_MAINTENANCE_ACTOR\0${identity.data.id}`);
  if (baseline && baseline.actorIdSha256 !== actorIdSha256) fail('MAINTENANCE_ACTOR_CHANGED');
  const deployedBefore = await ready('ready-before');
  const publicationBefore = await publication('publication-before');
  if (baseline && !isDeepStrictEqual(publicationBefore, baseline.publication)) fail('MAINTENANCE_PUBLICATION_CHANGED');
  const policy = await darkPolicy('before');
  const capabilityBody = (await get('capabilities', '/api/ai-images/capabilities')).body;
  const capabilities = capabilityBody?.data;
  if (capabilityBody?.code !== 1 || capabilities?.workflowEnabled !== false || capabilities?.webMediaEnabled !== false
    || capabilities?.applications?.applyEnabled !== false || capabilities?.applications?.listingDraftApplyEnabled !== false
    || OPERATIONS.some(operation => capabilities?.operations?.[operation]?.ready !== false)) fail('MAINTENANCE_CAPABILITY_NOT_DARK');
  const sources = [];
  if (input.mode === 'acceptance') {
    const { parseAiPromptPublishedSource } = await import('../apps/server/src/services/ai-prompt-template-source.ts');
    for (const key of SOURCE_KEYS) {
      const pathname = `/api/admin/ai-prompt-templates/${key}/source`;
      await get(`source-anonymous:${key}`, pathname, false, [401, 403]);
      const response = await get(`source:${key}`, pathname, true, [200, 404]);
      if (!/\bno-store\b/iu.test(response.headers.get('cache-control') || '')) fail('MAINTENANCE_SOURCE_NOT_FRESH');
      if (response.status === 404) {
        if (response.body?.code !== 0 || response.body?.error?.code !== 'ACTIVE_RELEASE_NOT_FOUND') fail('MAINTENANCE_SOURCE_ROUTE_MISSING');
        sources.push({ templateKey: key, state: 'SOURCE_UNAVAILABLE', sha256: null });
      } else {
        let source;
        try { source = parseAiPromptPublishedSource(response.body?.data); } catch { fail('MAINTENANCE_SOURCE_INVALID'); }
        if (response.body?.code !== 1 || source.templateKey !== key) fail('MAINTENANCE_SOURCE_INVALID');
        sources.push({ templateKey: key, state: 'AVAILABLE', sha256: evidenceSha256(source) });
      }
    }
  }
  const finalPolicy = await darkPolicy('after');
  if (!isDeepStrictEqual(policy, finalPolicy) || (baseline && !isDeepStrictEqual(policy, baseline.policy))) fail('MAINTENANCE_POLICY_CHANGED');
  if (await ready('ready-after') !== deployedBefore) fail('MAINTENANCE_DEPLOYMENT_CHANGED');
  const finalPublication = await publication('publication-after');
  if (!isDeepStrictEqual(publicationBefore, finalPublication)) fail('MAINTENANCE_PUBLICATION_CHANGED');
  const completedAt = now().toISOString();
  if (Date.parse(completedAt) < Date.parse(startedAt)) fail('MAINTENANCE_TIMESTAMP_INVALID');
  prerequisites(input, completedAt);
  if (!isDeepStrictEqual(requestAudit.map(row => row.route), auditRoutes(input.mode))) fail('MAINTENANCE_REQUEST_AUDIT_INVALID');
  const summary = { schemaVersion: 1,
    kind: input.mode === 'baseline' ? 'SS_ERP_DARK_MAINTENANCE_BASELINE' : 'SS_ERP_DARK_MAINTENANCE_ACCEPTANCE',
    scope: DARK_MAINTENANCE_SCOPE, status: 'PASS', startedAt, completedAt,
    candidate, releaseSignedAt: verified.releaseSignedAt, offlineSha256: evidenceSha256(verified.offline),
    backupSha256: evidenceSha256(verified.backup), qa02Prerequisite: 'INCOMPLETE', formalQa04Completed: false,
    providerCapabilityPromoted: false, actorIdSha256, requestAudit, probeEffects: { ...PROBE_EFFECTS },
    publication: finalPublication, policy: finalPolicy,
    capabilities: { workflowEnabled: false, webMediaEnabled: false, applyEnabled: false,
      listingDraftApplyEnabled: false, operations: Object.fromEntries(OPERATIONS.map(operation => [operation, false])) },
    ...(input.mode === 'baseline' ? { previousDeploymentCommit: deployedBefore } : {
      baselineSha256: evidenceSha256(baseline), vpsSha256: evidenceSha256(verified.vps), sources,
      deploymentEffects: { scope: 'EXISTING_DEPLOYMENT_AND_BACKUP_GATES',
        backupBindingSha256: evidenceSha256(verified.backup), fullVpsVerificationSha256: evidenceSha256(verified.vps) },
    }),
  };
  if (canonicalJson(summary).includes(input.adminToken)) fail('MAINTENANCE_SECRET_IN_EVIDENCE');
  return summary;
}

function privateOutputPath(filename, repositoryRoot) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) fail('MAINTENANCE_OUTPUT_INVALID');
  const absolute = path.resolve(filename);
  const relative = path.relative(path.resolve(repositoryRoot), absolute);
  const parent = path.dirname(absolute);
  const actualParent = realpathSync(parent);
  if ((!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
    || (process.platform === 'win32' ? actualParent.toLowerCase() !== parent.toLowerCase() : actualParent !== parent)
    || !lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink()) fail('MAINTENANCE_OUTPUT_INVALID');
  try { lstatSync(absolute); fail('MAINTENANCE_OUTPUT_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return absolute;
}

export function writeMaintenanceEvidence(filename, value, repositoryRoot) {
  const absolute = privateOutputPath(filename, repositoryRoot);
  const bytes = Buffer.from(canonicalJson(value));
  if (bytes.length > MAX_RESPONSE_BYTES) fail('MAINTENANCE_EVIDENCE_TOO_LARGE');
  writeNewArtifactDurably(absolute, bytes, { mode: 0o600 });
  return { outputPath: absolute, outputSha256: sha256(bytes) };
}

function readArtifact(filename, expectedSha256, maximumBytes = MAX_RESPONSE_BYTES) {
  const bytes = readStablePublicationFile(filename, maximumBytes, 'maintenance evidence');
  const hash = sha256(bytes);
  if (expectedSha256 !== undefined && hash !== digest(expectedSha256)) fail('MAINTENANCE_EVIDENCE_DIGEST_MISMATCH');
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { fail('MAINTENANCE_EVIDENCE_INVALID'); }
  if (canonicalJson(value) !== bytes.toString('utf8')) fail('MAINTENANCE_EVIDENCE_NOT_CANONICAL');
  return { value, bytes, sha256: hash };
}

function required(environment, name) {
  const value = environment[name];
  if (typeof value !== 'string' || !value || value.trim() !== value) fail('MAINTENANCE_CONFIGURATION_INVALID');
  return value;
}

export function recordMaintenanceBackupBinding({ repositoryRoot, envFile, region, targetGitCommit,
  now = () => new Date() }, { runner = spawnSync } = {}) {
  if (!['COM', 'CN'].includes(region) || !/^[a-f0-9]{40}$/u.test(targetGitCommit)) fail('MAINTENANCE_BACKUP_INVALID');
  const envBytes = readStablePublicationFile(envFile, 1024 * 1024, 'deployment environment');
  const environment = parseEnv(envBytes.toString('utf8'));
  envBytes.fill(0);
  const databaseId = required(environment, 'DEPLOY_DATABASE_ID');
  const directory = required(environment, 'DEPLOY_BACKUP_LOCAL_DIR');
  if (!path.isAbsolute(directory)) fail('MAINTENANCE_BACKUP_INVALID');
  const attestationPath = path.join(directory, `deploy-backup-${targetGitCommit}.attestation.json`);
  const before = readArtifact(attestationPath, undefined, 65_536);
  const native = before.value;
  if (native.schemaVersion !== 2 || native.kind !== 'SS_ERP_DEPLOY_BACKUP_ATTESTATION'
    || native.targetGitCommit !== targetGitCommit || native.databaseId !== databaseId
    || native.restoreDrill?.status !== 'PASSED') fail('MAINTENANCE_BACKUP_INVALID');
  const childEnvironment = {
    PATH: process.env.PATH || '', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot || '' } : {}),
    LANG: 'C.UTF-8', DATABASE_URL: required(environment, 'DATABASE_URL'),
    DEPLOY_DATABASE_ID: databaseId, DEPLOY_BACKUP_LOCAL_DIR: directory,
    DEPLOY_TARGET_GIT_COMMIT: targetGitCommit, DEPLOY_BACKUP_MAX_AGE_MINUTES: '120',
    ...(environment.BACKUP_LOCAL_DIR ? { BACKUP_LOCAL_DIR: environment.BACKUP_LOCAL_DIR } : {}),
  };
  let result;
  try {
    result = runner('bash', [path.resolve(repositoryRoot, 'scripts/verify-deploy-backup.sh'), targetGitCommit], {
      cwd: repositoryRoot, env: childEnvironment, encoding: 'utf8', windowsHide: true,
      timeout: 21 * 60 * 1000, maxBuffer: 65_536,
    });
  } catch { fail('MAINTENANCE_BACKUP_VERIFICATION_FAILED'); }
  finally { delete childEnvironment.DATABASE_URL; }
  if (result.error || result.signal || result.status !== 0) fail('MAINTENANCE_BACKUP_VERIFICATION_FAILED');
  const after = readArtifact(attestationPath, before.sha256, 65_536);
  const verifiedAt = now().toISOString();
  const binding = { schemaVersion: 1, kind: 'SS_ERP_DARK_MAINTENANCE_BACKUP', scope: DARK_MAINTENANCE_SCOPE,
    targetGitCommit, region, databaseId, databaseIdentitySha256: native.databaseIdentitySha256,
    databaseUuidSha256: native.databaseUuidSha256, attestationSha256: after.sha256, backupSha256: native.backup.sha256,
    backupCreatedAt: native.backup.createdAt, restoreStartedAt: native.restoreDrill.startedAt,
    restoreCompletedAt: native.restoreDrill.completedAt, verifiedAt, maximumAgeMinutes: 120,
    nativeVerifier: 'verify-deploy-backup.sh' };
  return parseMaintenanceBackupBinding(binding, { gitCommit: targetGitCommit, region, databaseId }, verifiedAt);
}

export function loadMaintenanceProbeInput(mode, environment, repositoryRoot, observedAt,
  { readProvenance = readQa04GitProvenance } = {}) {
  if (!['baseline', 'acceptance'].includes(mode)) fail('MAINTENANCE_MODE_INVALID');
  privateOutputPath(required(environment, 'MAINTENANCE_OUTPUT_FILE'), repositoryRoot);
  if (environment.MAINTENANCE_SUPER_ADMIN_TOKEN) fail('MAINTENANCE_TOKEN_MUST_USE_PRIVATE_FILE');
  const gitCommit = required(environment, 'MAINTENANCE_TARGET_COMMIT');
  const provenance = readProvenance({ repositoryRoot });
  if (provenance.gitCommit !== gitCommit || path.resolve(provenance.repositoryRoot) !== path.resolve(repositoryRoot)) {
    fail('MAINTENANCE_SOURCE_REVISION_MISMATCH');
  }
  const offline = readArtifact(required(environment, 'MAINTENANCE_OFFLINE_FILE'), required(environment, 'MAINTENANCE_OFFLINE_SHA256'), 65_536).value;
  parseQa04OfflineEvidence(offline, gitCommit, observedAt);
  const buildRoot = required(environment, 'MAINTENANCE_RELEASE_BUILD_ROOT');
  const signature = verifyExtensionReleaseSignature({ buildRoot,
    signaturePath: required(environment, 'MAINTENANCE_RELEASE_SIGNATURE_FILE'), expectedGitCommit: gitCommit,
    expectedSignatureSha256: required(environment, 'MAINTENANCE_RELEASE_SIGNATURE_SHA256'),
    keyringPath: path.join(repositoryRoot, 'config/extension-release-trusted-keys.json') });
  const evidence = readArtifact(path.join(buildRoot, `ss-erp-extension-${signature.version}.release-evidence.json`), signature.releaseEvidenceSha256, 65_536);
  const release = parseExtensionReleaseEvidence(evidence.value);
  if (canonicalExtensionReleaseEvidenceJson(release) !== evidence.bytes.toString('utf8')
    || release.expectedOrigins.api !== required(environment, 'MAINTENANCE_API_ORIGIN')) fail('MAINTENANCE_RELEASE_BINDING_INVALID');
  const candidate = parseRel04CandidateIdentity({ gitCommit, apiOrigin: release.expectedOrigins.api,
    region: required(environment, 'MAINTENANCE_REGION'), version: signature.version,
    releaseEvidenceSha256: signature.releaseEvidenceSha256, releaseSignatureSha256: signature.releaseSignatureSha256 });
  const backup = readArtifact(required(environment, 'MAINTENANCE_BACKUP_FILE'), required(environment, 'MAINTENANCE_BACKUP_SHA256'), 65_536).value;
  const input = { mode, candidate, releaseSignedAt: signature.signedAt, offline, backup,
    databaseId: required(environment, 'MAINTENANCE_DATABASE_ID'),
    ...(mode === 'acceptance' ? {
      baseline: readArtifact(required(environment, 'MAINTENANCE_BASELINE_FILE'), required(environment, 'MAINTENANCE_BASELINE_SHA256')).value,
      vps: readArtifact(required(environment, 'MAINTENANCE_VPS_FILE'), required(environment, 'MAINTENANCE_VPS_SHA256'), 65_536).value,
    } : {}),
  };
  prerequisites(input, observedAt);
  const tokenPath = required(environment, 'MAINTENANCE_SUPER_ADMIN_TOKEN_FILE');
  if (!path.isAbsolute(tokenPath)) fail('MAINTENANCE_TOKEN_FILE_UNSAFE');
  const tokenParent = path.dirname(path.resolve(tokenPath));
  const actualTokenParent = realpathSync(tokenParent);
  if (process.platform === 'win32' ? tokenParent.toLowerCase() !== actualTokenParent.toLowerCase() : tokenParent !== actualTokenParent) {
    fail('MAINTENANCE_TOKEN_FILE_UNSAFE');
  }
  const tokenRelative = path.relative(path.resolve(repositoryRoot), path.resolve(tokenPath));
  if ((!path.isAbsolute(tokenRelative) && tokenRelative !== '..' && !tokenRelative.startsWith(`..${path.sep}`))
    || (process.platform !== 'win32' && (lstatSync(tokenPath).mode & 0o077) !== 0)) fail('MAINTENANCE_TOKEN_FILE_UNSAFE');
  const tokenBytes = readStablePublicationFile(tokenPath, 8192, 'maintenance token');
  const adminToken = tokenBytes.toString('utf8').trim();
  tokenBytes.fill(0);
  if (!/^[A-Za-z0-9._-]{20,8192}$/u.test(adminToken)) fail('MAINTENANCE_TOKEN_INVALID');
  return { ...input, adminToken };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--backup-binding', '--baseline', '--acceptance'].includes(args[0])) fail('MAINTENANCE_MODE_INVALID');
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const output = required(process.env, 'MAINTENANCE_OUTPUT_FILE');
  privateOutputPath(output, repositoryRoot);
  let summary;
  if (args[0] === '--backup-binding') {
    summary = recordMaintenanceBackupBinding({ repositoryRoot,
      envFile: required(process.env, 'MAINTENANCE_DEPLOY_ENV_FILE'),
      region: required(process.env, 'MAINTENANCE_REGION'),
      targetGitCommit: required(process.env, 'MAINTENANCE_TARGET_COMMIT') });
  } else {
    const mode = args[0].slice(2);
    const input = loadMaintenanceProbeInput(mode, process.env, repositoryRoot, new Date().toISOString());
    summary = await runDarkMaintenanceProbe(input);
    // Re-read every immutable input and the clean source identity after network I/O.
    const after = loadMaintenanceProbeInput(mode, process.env, repositoryRoot, new Date().toISOString());
    if (!isDeepStrictEqual(input, after)) fail('MAINTENANCE_INPUTS_CHANGED');
  }
  const result = writeMaintenanceEvidence(output, summary, repositoryRoot);
  process.stdout.write(`${JSON.stringify({ kind: summary.kind, ...result })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    process.stderr.write(`${/^MAINTENANCE_[A-Z_]+$/u.test(error?.code || '') ? error.code : 'MAINTENANCE_VERIFICATION_FAILED'}\n`);
    process.exitCode = 1;
  });
}
