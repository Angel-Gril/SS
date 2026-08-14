#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeNewArtifactDurably } from './extension-release-artifact.mjs';
import { publicOriginForPublication } from './extension-release-publication-contract.mjs';
import { verifyAiMediaDarkPolicy } from './verify-ai-media-dark-policy.mjs';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_JSON_RESPONSE_BYTES = 256 * 1024;
const TOKEN_MAX_BYTES = 16 * 1024;
const GIT_COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const QA04_REQUIRED_GATES = Object.freeze([
  'QA04_OFFLINE_CONTRACT',
  'GIT_DIFF_CHECK',
  'WORKSPACE_LINT',
  'WORKSPACE_TYPECHECK',
  'FULL_PREFLIGHT_BUILD',
  'SCOPE_REVOCATION_POSTGRES',
  'AI_MEDIA_POSTGRES',
  'EXTENSION_CLOUD',
  'EXTENSION_LOCAL',
]);

export const REL04_DARK_CONFIG_KEYS = Object.freeze([
  'feature_ai_media_workflow_v2',
  'feature_ai_media_image_to_image',
  'feature_ai_media_suite',
  'feature_ai_media_full_edit',
  'feature_ai_media_inpaint',
  'feature_source_listing_web_media',
  'feature_source_listing_extension_workbench',
  'feature_source_ozon_publisher_v2',
  'ai_image_generation_enabled',
  'ai_image_provider',
  'feature_image_translate',
  'ai_image_translation_provider',
  'ai_media_workflow_v2_rollout_policy',
  'feature_extension_hosted_ai',
  'feature_extension_byok_ai',
  'feature_extension_byok_ingest',
  'feature_extension_byok_publish',
  'extension_byok_admin_policy',
]);

const REQUEST_RULES = new Map([
  ['GET /ready', { method: 'GET', path: /^\/ready$/u }],
  ['GET /api/extensions/latest', { method: 'GET', path: /^\/api\/extensions\/latest$/u }],
  [
    'OPTIONS /api/extension-device/byok-media/readiness',
    { method: 'OPTIONS', path: /^\/api\/extension-device\/byok-media\/readiness$/u },
  ],
  [
    'GET /api/admin/system-config/:key',
    { method: 'GET', path: /^\/api\/admin\/system-config\/[A-Za-z0-9_-]+$/u },
  ],
  [
    'POST /api/extension-device/pairing-codes',
    { method: 'POST', path: /^\/api\/extension-device\/pairing-codes$/u },
  ],
  [
    'POST /api/extension-device/pairing-claims',
    { method: 'POST', path: /^\/api\/extension-device\/pairing-claims$/u },
  ],
  ['GET /api/extension-device/shops', {
    method: 'GET', path: /^\/api\/extension-device\/shops$/u,
  }],
  ['GET /api/extension-device/shops (revoked)', {
    method: 'GET', path: /^\/api\/extension-device\/shops$/u,
  }],
  ['POST /api/extension-device/refresh', {
    method: 'POST', path: /^\/api\/extension-device\/refresh$/u,
  }],
  ['GET /api/extension-device/sessions', {
    method: 'GET', path: /^\/api\/extension-device\/sessions$/u,
  }],
  ['DELETE /api/extension-device/sessions/:sessionId', {
    method: 'DELETE', path: /^\/api\/extension-device\/sessions\/[A-Za-z0-9._:-]+$/u,
  }],
  ['DELETE /api/extension-device/pairing-codes/:pairingCodeId', {
    method: 'DELETE', path: /^\/api\/extension-device\/pairing-codes\/[A-Za-z0-9._:-]+$/u,
  }],
  ['GET /api/ai-images/suites/readiness', {
    method: 'GET', path: /^\/api\/ai-images\/suites\/readiness$/u,
  }],
  ['POST /api/extension-device/byok-media/readiness', {
    method: 'POST', path: /^\/api\/extension-device\/byok-media\/readiness$/u,
  }],
  ['GET /api/source-listing-workflows/publisher-capability', {
    method: 'GET', path: /^\/api\/source-listing-workflows\/publisher-capability$/u,
  }],
  ['GET /api/source-listing-workflows/:workflowId/publish-attempts/:attemptId', {
    method: 'GET',
    path: /^\/api\/source-listing-workflows\/[A-Za-z0-9._:-]+\/publish-attempts\/[A-Za-z0-9._:-]+$/u,
  }],
]);

class Rel04CanaryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'Rel04CanaryError';
    this.code = code;
  }
}

function fail(code) {
  throw new Rel04CanaryError(code);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function identityHash(kind, value) {
  return sha256(Buffer.from(`SS_ERP_REL04_CANARY_${kind}\0${value}`, 'utf8'));
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function canonicalTimestamp(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail(`${field}_INVALID`);
  return date.toISOString();
}

function exactIdentifier(value, field) {
  const parsed = typeof value === 'string' ? value.trim() : '';
  if (parsed !== value || !IDENTIFIER_PATTERN.test(parsed)) fail(`${field}_INVALID`);
  return parsed;
}

function exactGitCommit(value) {
  const parsed = String(value || '').trim().toLowerCase();
  if (!GIT_COMMIT_PATTERN.test(parsed)) fail('TARGET_GIT_COMMIT_INVALID');
  return parsed;
}

function publishReconciliationBinding({ workflowId, attemptId, regressionSha256, notBefore }) {
  const rawWorkflowId = typeof workflowId === 'string' ? workflowId : '';
  const rawAttemptId = typeof attemptId === 'string' ? attemptId : '';
  const rawRegressionSha256 = String(regressionSha256 || '').trim().toLowerCase();
  if (rawWorkflowId || rawAttemptId) {
    if (!rawWorkflowId || !rawAttemptId || rawRegressionSha256 || !notBefore) {
      fail('PUBLISH_RECONCILIATION_BINDING_INVALID');
    }
    return {
      mode: 'LIVE_ATTEMPT',
      workflowId: exactIdentifier(rawWorkflowId, 'PUBLISH_WORKFLOW_ID'),
      attemptId: exactIdentifier(rawAttemptId, 'PUBLISH_ATTEMPT_ID'),
      regressionSha256: null,
      notBefore: canonicalTimestamp(notBefore, 'PUBLISH_RECONCILIATION_NOT_BEFORE'),
    };
  }
  if (!SHA256_PATTERN.test(rawRegressionSha256) || notBefore) {
    fail('PUBLISH_RECONCILIATION_BINDING_INVALID');
  }
  return {
    mode: 'TARGET_COMMIT_QA04_REGRESSION',
    workflowId: null,
    attemptId: null,
    regressionSha256: rawRegressionSha256,
    notBefore: null,
  };
}

function exactExtensionOrigin(value) {
  const parsed = String(value || '').trim().toLowerCase();
  if (!EXTENSION_ORIGIN_PATTERN.test(parsed)) fail('EXTENSION_ORIGIN_INVALID');
  return parsed;
}

function exactToken(value, field) {
  const parsed = typeof value === 'string' ? value.trim() : '';
  const unsafeCharacter = [...parsed].some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 32 || codePoint === 127;
  });
  if (!parsed || parsed.length > TOKEN_MAX_BYTES || unsafeCharacter) {
    fail(`${field}_INVALID`);
  }
  return parsed;
}

function exactCapabilityText(value, field) {
  const parsed = typeof value === 'string' ? value.trim() : '';
  const unsafeCharacter = [...parsed].some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (parsed !== value || !parsed || parsed.length > 200 || unsafeCharacter) {
    fail(`${field}_INVALID`);
  }
  return parsed;
}

function exactBoolean(value, field) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  fail(`${field}_INVALID`);
}

function publishCapabilityExpectation(value) {
  const candidate = exactObject(value, 'PUBLISH_CAPABILITY_EXPECTATION');
  return {
    reason: exactCapabilityText(candidate.reason, 'PUBLISH_CAPABILITY_REASON'),
    revision: exactCapabilityText(candidate.revision, 'PUBLISH_CAPABILITY_REVISION'),
    legacyAllowed: exactBoolean(
      candidate.legacyAllowed,
      'PUBLISH_CAPABILITY_LEGACY_ALLOWED',
    ),
  };
}

function pathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertExistingRealDirectoryTree(directory, field) {
  const absolute = path.resolve(directory);
  const root = path.parse(absolute).root;
  let current = root;
  for (const segment of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const entry = lstatSync(current, { throwIfNoEntry: false });
    if (!entry?.isDirectory() || entry.isSymbolicLink()) fail(`${field}_UNSAFE`);
  }
  return realpathSync.native(absolute);
}

function readPrivateFileBytes(file, repositoryRoot, field, maxBytes) {
  const absolute = path.resolve(String(file || ''));
  if (!absolute || pathInside(repositoryRoot, absolute)) fail(`${field}_FILE_LOCATION_INVALID`);
  assertExistingRealDirectoryTree(path.dirname(absolute), `${field}_FILE_DIRECTORY`);
  const entry = lstatSync(absolute, { throwIfNoEntry: false });
  if (!entry?.isFile() || entry.isSymbolicLink() || entry.size < 1 || entry.size > maxBytes
    || entry.nlink !== 1) fail(`${field}_FILE_INVALID`);
  if (process.platform !== 'win32' && (entry.mode & 0o077) !== 0) fail(`${field}_FILE_PERMISSIONS_INVALID`);
  let descriptor = null;
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size < 1 || before.size > maxBytes || before.nlink !== 1) {
      fail(`${field}_FILE_INVALID`);
    }
    if (before.dev !== entry.dev || before.ino !== entry.ino) fail(`${field}_FILE_CHANGED`);
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < before.size) {
      const count = readSync(descriptor, bytes, offset, before.size - offset, offset);
      if (count < 1) fail(`${field}_FILE_CHANGED`);
      offset += count;
    }
    const after = fstatSync(descriptor);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs || after.nlink !== 1
      || after.dev !== before.dev || after.ino !== before.ino) fail(`${field}_FILE_CHANGED`);
    return bytes;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function readTokenFile(file, repositoryRoot, field) {
  const bytes = readPrivateFileBytes(file, repositoryRoot, field, TOKEN_MAX_BYTES);
  try {
    return exactToken(bytes.toString('utf8'), field);
  } finally {
    bytes.fill(0);
  }
}

function readQa04Acceptance(file, expectedSha256, repositoryRoot, expectedGitCommit) {
  const bytes = readPrivateFileBytes(file, repositoryRoot, 'QA04_ACCEPTANCE', 64 * 1024);
  try {
    if (sha256(bytes) !== expectedSha256) fail('QA04_ACCEPTANCE_SHA256_MISMATCH');
    let value;
    try {
      value = JSON.parse(bytes.toString('utf8'));
    } catch {
      fail('QA04_ACCEPTANCE_INVALID');
    }
    const canonical = Buffer.from(canonicalJson(value), 'utf8');
    if (!canonical.equals(bytes)) fail('QA04_ACCEPTANCE_NOT_CANONICAL');
    const verification = value?.extensionVerification;
    const externalEffects = value?.externalEffects;
    if (value?.schemaVersion !== 1
      || value?.kind !== 'QA04_FINAL_ACCEPTANCE'
      || value?.taskId !== 'QA-04'
      || value?.gitCommit !== expectedGitCommit
      || canonicalTimestamp(value?.completedAt, 'QA04_COMPLETED_AT') !== value.completedAt
      || !Number.isFinite(value?.durationSeconds)
      || value.durationSeconds <= 0
      || value?.decision !== 'PASS'
      || value?.qa02Prerequisite !== 'COMPLETE'
      || value?.command !== 'pnpm qa:04:offline'
      || JSON.stringify(value?.gates) !== JSON.stringify(QA04_REQUIRED_GATES)
      || !['cloud', 'local', 'source'].every((target) => (
        Number.isSafeInteger(verification?.[target]?.passed)
        && verification[target].passed > 0
        && Number.isSafeInteger(verification[target].warnings)
        && verification[target].warnings >= 0
        && verification[target].failures === 0
      ))
      || externalEffects?.providerRequests !== 0
      || externalEffects?.vpsAccess !== false
      || externalEffects?.deployment !== false
      || externalEffects?.featureFlagChanges !== 0
      || externalEffects?.ozonWrites !== 0) {
      fail('QA04_ACCEPTANCE_INVALID');
    }
    return {
      completedAt: value.completedAt,
      durationSeconds: value.durationSeconds,
      sha256: expectedSha256,
    };
  } finally {
    bytes.fill(0);
  }
}

function credential(environment, name, repositoryRoot) {
  const direct = String(environment[name] || '').trim();
  const file = String(environment[`${name}_FILE`] || '').trim();
  if ((direct && file) || (!direct && !file)) fail(`${name}_SOURCE_INVALID`);
  return direct ? exactToken(direct, name) : readTokenFile(file, repositoryRoot, name);
}

function defaultPrivateRoot(environment) {
  if (process.platform === 'win32') {
    const base = String(environment.LOCALAPPDATA || '').trim();
    if (!base) fail('LOCALAPPDATA_REQUIRED');
    return path.join(base, 'SS-ERP', 'private', 'rel04-dark-canaries');
  }
  const base = String(environment.XDG_STATE_HOME || '').trim()
    || path.join(String(environment.HOME || os.homedir()), '.local', 'state');
  return path.join(base, 'ss-erp', 'private', 'rel04-dark-canaries');
}

function ensureRealDirectoryTree(directory) {
  const absolute = path.resolve(directory);
  const root = path.parse(absolute).root;
  let current = root;
  for (const segment of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let entry = lstatSync(current, { throwIfNoEntry: false });
    if (!entry) {
      try {
        mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
      entry = lstatSync(current, { throwIfNoEntry: false });
      if (process.platform !== 'win32' && entry?.isDirectory() && !entry.isSymbolicLink()) {
        chmodSync(current, 0o700);
      }
    }
    if (!entry?.isDirectory() || entry.isSymbolicLink()) fail('SUMMARY_DIRECTORY_UNSAFE');
  }
  if (process.platform !== 'win32') chmodSync(absolute, 0o700);
  return realpathSync.native(absolute);
}

function summaryOutputPath(environment, repositoryRoot, observedAt) {
  const configured = String(environment.REL04_CANARY_OUTPUT || '').trim();
  const stamp = observedAt.replace(/[-:.TZ]/gu, '');
  const output = configured
    ? path.resolve(configured)
    : path.join(ensureRealDirectoryTree(defaultPrivateRoot(environment)), `rel04-dark-canary-${stamp}.json`);
  if (pathInside(repositoryRoot, output)) fail('SUMMARY_OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  const parent = configured
    ? ensureRealDirectoryTree(path.dirname(output))
    : path.dirname(output);
  if (realpathSync.native(path.dirname(output)) !== parent) fail('SUMMARY_DIRECTORY_UNSAFE');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}\.json$/u.test(path.basename(output))) {
    fail('SUMMARY_FILENAME_INVALID');
  }
  return output;
}

export function parseRel04DarkCanaryEnvironment(
  environment = process.env,
  repositoryRoot = path.resolve('.'),
  now = new Date(),
) {
  const trustedRepositoryRoot = assertExistingRealDirectoryTree(
    repositoryRoot,
    'REPOSITORY_ROOT',
  );
  const observedAt = canonicalTimestamp(now, 'OBSERVED_AT');
  const apiOrigin = publicOriginForPublication(environment.REL04_API_ORIGIN);
  const expectedGitCommit = exactGitCommit(environment.REL04_TARGET_GIT_COMMIT);
  const extensionOrigin = exactExtensionOrigin(environment.REL04_EXTENSION_ORIGIN);
  const shopId = exactIdentifier(environment.REL04_SHOP_ID, 'SHOP_ID');
  const publishReconciliation = publishReconciliationBinding({
    workflowId: environment.REL04_PUBLISH_WORKFLOW_ID,
    attemptId: environment.REL04_PUBLISH_ATTEMPT_ID,
    regressionSha256: environment.REL04_PUBLISH_RECONCILIATION_REGRESSION_SHA256,
    notBefore: environment.REL04_PUBLISH_RECONCILIATION_NOT_BEFORE,
  });
  if (publishReconciliation.mode === 'TARGET_COMMIT_QA04_REGRESSION') {
    const acceptance = readQa04Acceptance(
      environment.REL04_QA04_ACCEPTANCE_FILE,
      publishReconciliation.regressionSha256,
      trustedRepositoryRoot,
      expectedGitCommit,
    );
    if (Date.parse(acceptance.completedAt) > Date.parse(observedAt)) {
      fail('QA04_ACCEPTANCE_INVALID');
    }
  } else if (String(environment.REL04_QA04_ACCEPTANCE_FILE || '').trim()) {
    fail('PUBLISH_RECONCILIATION_BINDING_INVALID');
  }
  const expectedPublishCapability = publishCapabilityExpectation({
    reason: environment.REL04_EXPECTED_PUBLISH_CAPABILITY_REASON,
    revision: environment.REL04_EXPECTED_PUBLISH_CAPABILITY_REVISION,
    legacyAllowed: environment.REL04_EXPECTED_PUBLISH_LEGACY_ALLOWED,
  });
  return {
    apiOrigin,
    expectedGitCommit,
    extensionOrigin,
    shopId,
    publishWorkflowId: publishReconciliation.workflowId,
    publishAttemptId: publishReconciliation.attemptId,
    publishReconciliationRegressionSha256: publishReconciliation.regressionSha256,
    publishReconciliationNotBefore: publishReconciliation.notBefore,
    expectedPublishCapability,
    ownerToken: credential(environment, 'REL04_OWNER_TOKEN', trustedRepositoryRoot),
    adminToken: credential(environment, 'REL04_ADMIN_TOKEN', trustedRepositoryRoot),
    observedAt,
    outputPath: summaryOutputPath(environment, trustedRepositoryRoot, observedAt),
  };
}

function jsonResponseError(response, expectedOrigin) {
  if (response.redirected || (response.url && new URL(response.url).origin !== expectedOrigin)) {
    fail('HTTP_REDIRECT_REJECTED');
  }
  const encoding = response.headers.get('content-encoding');
  if (encoding && encoding.trim().toLowerCase() !== 'identity') fail('HTTP_ENCODING_REJECTED');
  const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') fail('HTTP_CONTENT_TYPE_INVALID');
}

async function boundedJson(response, expectedOrigin) {
  jsonResponseError(response, expectedOrigin);
  const declaredText = response.headers.get('content-length');
  const declared = declaredText == null ? null : Number(declaredText);
  if (declared !== null
    && (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_JSON_RESPONSE_BYTES)) {
    fail('HTTP_CONTENT_LENGTH_INVALID');
  }
  const reader = response.body?.getReader();
  if (!reader) fail('HTTP_RESPONSE_BODY_MISSING');
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_JSON_RESPONSE_BYTES || (declared !== null && total > declared)) {
      await reader.cancel().catch(() => {});
      fail('HTTP_RESPONSE_TOO_LARGE');
    }
    chunks.push(Buffer.from(value));
  }
  if (declared !== null && total !== declared) fail('HTTP_CONTENT_LENGTH_MISMATCH');
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
  } catch {
    fail('HTTP_RESPONSE_JSON_INVALID');
  }
  return parsed;
}

function requestPath(apiOrigin, pathname, search = '') {
  const url = new URL(pathname, apiOrigin);
  if (url.origin !== apiOrigin || url.username || url.password || url.hash) fail('REQUEST_ORIGIN_ESCAPE');
  url.search = search;
  return url;
}

function assertRequestAllowed(routeId, method, url) {
  const rule = REQUEST_RULES.get(routeId);
  if (!rule || rule.method !== method || !rule.path.test(url.pathname)) {
    fail('REQUEST_NOT_ALLOWLISTED');
  }
  if (routeId === 'GET /api/source-listing-workflows/publisher-capability') {
    if ([...url.searchParams.keys()].join(',') !== 'shopId'
      || !url.searchParams.get('shopId')) fail('REQUEST_QUERY_NOT_ALLOWLISTED');
  } else if (url.search) {
    fail('REQUEST_QUERY_NOT_ALLOWLISTED');
  }
}

function bearer(token) {
  return { authorization: `Bearer ${token}` };
}

function checkResult(id, evidence) {
  return { id, status: 'PASS', evidence };
}

function failureResult(id, code) {
  return { id, status: 'FAIL', errorCode: code };
}

function responseErrorCode(body) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && typeof body.errorCode === 'string'
    ? body.errorCode
    : null;
}

function exactObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field}_INVALID`);
  return value;
}

function exactArray(value, field) {
  if (!Array.isArray(value)) fail(`${field}_INVALID`);
  return value;
}

function releaseTarget(data, target, apiOrigin, version) {
  const value = exactObject(data.targets?.[target], `RELEASE_${target.toUpperCase()}_TARGET`);
  if (typeof value.filename !== 'string'
    || typeof value.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(value.sha256)) fail(`RELEASE_${target.toUpperCase()}_INVALID`);
  const expectedPath = `/api/extensions/download/${target}/${version}/${value.sha256}`;
  const url = new URL(value.downloadUrl, apiOrigin);
  if (url.origin !== apiOrigin || url.pathname !== expectedPath || url.search || url.hash) {
    fail(`RELEASE_${target.toUpperCase()}_URL_INVALID`);
  }
  return { filename: value.filename, sha256: value.sha256, path: expectedPath };
}

function assertNoSecret(summary, secrets) {
  const text = canonicalJson(summary);
  for (const secret of secrets) {
    if (secret && text.includes(secret)) fail('SUMMARY_SECRET_LEAK');
  }
  return text;
}

export async function runRel04DarkCanary(input, dependencies = {}) {
  const fetcher = dependencies.fetcher || globalThis.fetch;
  const idFactory = dependencies.randomUUID || randomUUID;
  const apiOrigin = publicOriginForPublication(input.apiOrigin);
  const expectedGitCommit = exactGitCommit(input.expectedGitCommit);
  const extensionOrigin = exactExtensionOrigin(input.extensionOrigin);
  const shopId = exactIdentifier(input.shopId, 'SHOP_ID');
  const publishReconciliation = publishReconciliationBinding({
    workflowId: input.publishWorkflowId,
    attemptId: input.publishAttemptId,
    regressionSha256: input.publishReconciliationRegressionSha256,
    notBefore: input.publishReconciliationNotBefore,
  });
  const expectedPublishCapability = publishCapabilityExpectation(input.expectedPublishCapability);
  const { workflowId: publishWorkflowId, attemptId: publishAttemptId } = publishReconciliation;
  const ownerToken = exactToken(input.ownerToken, 'OWNER_TOKEN');
  const adminToken = exactToken(input.adminToken, 'ADMIN_TOKEN');
  const observedAt = canonicalTimestamp(input.observedAt || new Date(), 'OBSERVED_AT');
  if (typeof fetcher !== 'function') fail('FETCH_UNAVAILABLE');
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('TLS_VERIFICATION_DISABLED');

  const checks = [];
  const requests = [];
  const secrets = new Set([ownerToken, adminToken]);
  let pairingCodeId = null;
  let pairingCode = null;
  let deviceAccessToken = null;
  let refreshToken = null;
  let sessionId = null;
  let canaryDeviceId = null;
  let cleanupRequired = false;
  let cleanupCode = null;

  async function requestJson(routeId, method, pathname, {
    token,
    body,
    search = '',
    expectedStatuses = [200],
    requireCors = true,
  } = {}) {
    const url = requestPath(apiOrigin, pathname, search);
    assertRequestAllowed(routeId, method, url);
    const headers = {
      accept: 'application/json',
      'accept-encoding': 'identity',
      origin: extensionOrigin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? bearer(token) : {}),
    };
    let response;
    try {
      response = await fetcher(url.toString(), {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      requests.push({ route: routeId, method, statusCode: 0 });
      fail('HTTP_REQUEST_FAILED');
    }
    requests.push({ route: routeId, method, statusCode: response.status });
    if (requireCors && response.headers.get('access-control-allow-origin') !== extensionOrigin) {
      fail('EXTENSION_CORS_ORIGIN_MISMATCH');
    }
    const parsed = await boundedJson(response, apiOrigin);
    if (!expectedStatuses.includes(response.status)) fail('HTTP_STATUS_UNEXPECTED');
    return { status: response.status, body: parsed };
  }

  async function verifyExtensionCorsPreflight() {
    const routeId = 'OPTIONS /api/extension-device/byok-media/readiness';
    const method = 'OPTIONS';
    const url = requestPath(apiOrigin, '/api/extension-device/byok-media/readiness');
    assertRequestAllowed(routeId, method, url);
    let response;
    try {
      response = await fetcher(url.toString(), {
        method,
        headers: {
          origin: extensionOrigin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type',
          'accept-encoding': 'identity',
        },
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      requests.push({ route: routeId, method, statusCode: 0 });
      fail('HTTP_REQUEST_FAILED');
    }
    requests.push({ route: routeId, method, statusCode: response.status });
    const allowedMethods = String(response.headers.get('access-control-allow-methods') || '')
      .split(',').map((value) => value.trim().toUpperCase());
    const allowedHeaders = String(response.headers.get('access-control-allow-headers') || '')
      .split(',').map((value) => value.trim().toLowerCase());
    if (response.status !== 204
      || response.redirected
      || (response.url && new URL(response.url).origin !== apiOrigin)
      || response.headers.get('access-control-allow-origin') !== extensionOrigin
      || !allowedMethods.includes('POST')
      || !allowedHeaders.includes('authorization')
      || !allowedHeaders.includes('content-type')) {
      fail('EXTENSION_CORS_PREFLIGHT_FAILED');
    }
  }

  async function verifyHostedRegression() {
    const hosted = await requestJson(
      'GET /api/ai-images/suites/readiness',
      'GET',
      '/api/ai-images/suites/readiness',
      { token: ownerToken },
    );
    const hostedData = exactObject(hosted.body?.data, 'HOSTED_READINESS');
    if (hosted.body?.code !== 1
      || hostedData.suiteEnabled !== false
      || hostedData.workflowEnabled !== false
      || hostedData.ready !== false
      || hostedData.reasonCode !== 'AI_MEDIA_SUITE_DISABLED') {
      fail('HOSTED_DARK_REGRESSION_FAILED');
    }
    checks.push(checkResult('hosted-route-regression', {
      routeReachable: true,
      providerDispatchMethodUsed: false,
      suiteEnabled: false,
      workflowEnabled: false,
      reasonCode: hostedData.reasonCode,
    }));
  }

  async function verifyPublishReconciliation() {
    const capability = await requestJson(
      'GET /api/source-listing-workflows/publisher-capability',
      'GET',
      '/api/source-listing-workflows/publisher-capability',
      { token: ownerToken, search: `?shopId=${encodeURIComponent(shopId)}` },
    );
    const capabilityData = exactObject(capability.body?.data, 'PUBLISH_CAPABILITY');
    if (capability.body?.code !== 1
      || capabilityData.enabled !== false
      || capabilityData.reason !== expectedPublishCapability.reason
      || capabilityData.revision !== expectedPublishCapability.revision
      || capabilityData.legacyAllowed !== expectedPublishCapability.legacyAllowed) {
      fail('PUBLISH_CAPABILITY_NOT_DARK');
    }
    if (publishReconciliation.mode === 'LIVE_ATTEMPT') {
      const attempt = await requestJson(
        'GET /api/source-listing-workflows/:workflowId/publish-attempts/:attemptId',
        'GET',
        `/api/source-listing-workflows/${encodeURIComponent(publishWorkflowId)}`
          + `/publish-attempts/${encodeURIComponent(publishAttemptId)}`,
        { token: ownerToken },
      );
      const attemptData = exactObject(attempt.body?.data, 'PUBLISH_ATTEMPT');
      const lastReconciledAt = canonicalTimestamp(
        attemptData.lastReconciledAt,
        'PUBLISH_LAST_RECONCILED_AT',
      );
      const completedAt = canonicalTimestamp(attemptData.completedAt, 'PUBLISH_COMPLETED_AT');
      const reconciledMillis = Date.parse(lastReconciledAt);
      const completedMillis = Date.parse(completedAt);
      if (attempt.body?.code !== 1
        || attemptData.id !== publishAttemptId
        || attemptData.workflowId !== publishWorkflowId
        || attemptData.shopId !== shopId
        || attemptData.state !== 'SUBMITTED'
        || attemptData.reconciliationState !== 'SUCCEEDED'
        || !Number.isSafeInteger(attemptData.stateVersion)
        || attemptData.stateVersion < 1
        || !Number.isSafeInteger(attemptData.reconcileAttemptCount)
        || attemptData.reconcileAttemptCount < 1
        || reconciledMillis < Date.parse(publishReconciliation.notBefore)
        || completedMillis < reconciledMillis
        || completedMillis > Date.parse(observedAt)) {
        fail('PUBLISH_RECONCILIATION_STATUS_INVALID');
      }
      checks.push(checkResult('publish-reconciliation-read', {
        mode: publishReconciliation.mode,
        workflowIdHash: identityHash('WORKFLOW', publishWorkflowId),
        attemptIdHash: identityHash('ATTEMPT', publishAttemptId),
        state: attemptData.state,
        reconciliationState: attemptData.reconciliationState,
        stateVersion: attemptData.stateVersion,
        reconcileAttemptCount: attemptData.reconcileAttemptCount,
        lastReconciledAt,
        completedAt,
        notBefore: publishReconciliation.notBefore,
        ozonMutationRequestSentByCanary: false,
      }));
      return;
    }
    checks.push(checkResult('publish-reconciliation-read', {
      mode: publishReconciliation.mode,
      liveAttemptRead: false,
      regressionEvidenceSha256: publishReconciliation.regressionSha256,
      capabilityEnabled: false,
      capabilityReason: capabilityData.reason,
      capabilityRevision: capabilityData.revision,
      capabilityLegacyAllowed: capabilityData.legacyAllowed,
      ozonMutationRequestSentByCanary: false,
    }));
  }

  async function normalChecks() {
    let activeCheck = 'deployment-and-publication-isolation';
    try {
      const ready = await requestJson('GET /ready', 'GET', '/ready');
      if (ready.body?.status !== 'ready'
        || ready.body?.checks?.db !== 'ok'
        || ready.body?.checks?.redis !== 'ok'
        || ready.body?.deployment?.gitCommit !== expectedGitCommit) {
        fail('SERVICE_READINESS_FAILED');
      }
      await verifyExtensionCorsPreflight();
      const latest = await requestJson(
        'GET /api/extensions/latest',
        'GET',
        '/api/extensions/latest',
        { expectedStatuses: [200, 404] },
      );
      let existingPublication = null;
      if (latest.status === 200) {
        const release = exactObject(latest.body?.data, 'RELEASE_METADATA');
        if (latest.body?.code !== 1
          || release.gitCommit === expectedGitCommit
          || !/^[a-f0-9]{40}$/u.test(release.gitCommit)
          || release.signatureStatus !== 'EXTERNAL_REQUIRED'
          || !/^[a-f0-9]{64}$/u.test(release.publicationApprovalSha256)
          || !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(release.version)) {
          fail('DEPLOYED_CANDIDATE_PREMATURELY_PUBLISHED');
        }
        existingPublication = {
          gitCommit: release.gitCommit,
          version: release.version,
          publicationApprovalSha256: release.publicationApprovalSha256,
          targets: {
            cloud: releaseTarget(release, 'cloud', apiOrigin, release.version),
            local: releaseTarget(release, 'local', apiOrigin, release.version),
          },
        };
      } else if (latest.body?.code !== 0) {
        fail('WEBSITE_PUBLICATION_GATE_INVALID');
      }
      checks.push(checkResult(activeCheck, {
        deployedGitCommit: expectedGitCommit,
        deployedCandidatePublic: false,
        existingPublication,
        extensionCorsPreflight: true,
      }));

      activeCheck = 'default-off-policy';
      const rows = [];
      for (const key of REL04_DARK_CONFIG_KEYS) {
        const response = await requestJson(
          'GET /api/admin/system-config/:key',
          'GET',
          `/api/admin/system-config/${encodeURIComponent(key)}`,
          { token: adminToken, expectedStatuses: [200, 404] },
        );
        if (response.status === 404) continue;
        const data = exactObject(response.body?.data, 'SYSTEM_CONFIG_RESPONSE');
        if (response.body?.code !== 1 || data.key !== key || typeof data.value !== 'string') {
          fail('SYSTEM_CONFIG_RESPONSE_INVALID');
        }
        rows.push({ key, value: data.value });
      }
      const policy = verifyAiMediaDarkPolicy(rows);
      checks.push(checkResult(activeCheck, policy));

      activeCheck = 'hosted-route-regression';
      await verifyHostedRegression();

      activeCheck = 'publish-reconciliation-read';
      await verifyPublishReconciliation();

      activeCheck = 'device-pairing-active-lifecycle';
      const deviceId = `rel04-canary-${idFactory()}`;
      canaryDeviceId = deviceId;
      const sessionsBefore = await requestJson(
        'GET /api/extension-device/sessions',
        'GET',
        '/api/extension-device/sessions',
        { token: ownerToken },
      );
      const sessionRowsBefore = exactArray(sessionsBefore.body?.data, 'DEVICE_SESSIONS');
      if (sessionsBefore.body?.code !== 1
        || sessionRowsBefore.some((value) => value?.deviceId === deviceId)) {
        fail('CANARY_DEVICE_ID_NOT_UNIQUE');
      }
      const scopes = ['byok:media:ingest'];
      const created = await requestJson(
        'POST /api/extension-device/pairing-codes',
        'POST',
        '/api/extension-device/pairing-codes',
        {
          token: ownerToken,
          body: { shopIds: [shopId], scopes, deviceLabel: 'REL-04 dark canary' },
          expectedStatuses: [201],
        },
      );
      const pairing = exactObject(created.body?.data, 'PAIRING_CODE_RESPONSE');
      pairingCodeId = exactIdentifier(pairing.id, 'PAIRING_CODE_ID');
      cleanupRequired = true;
      pairingCode = exactToken(pairing.code, 'PAIRING_CODE');
      const deploymentId = exactIdentifier(pairing.deploymentId, 'DEPLOYMENT_ID');
      secrets.add(pairingCode);
      const claimed = await requestJson(
        'POST /api/extension-device/pairing-claims',
        'POST',
        '/api/extension-device/pairing-claims',
        {
          body: { code: pairingCode, deviceId, deviceLabel: 'REL-04 dark canary', deploymentId },
          expectedStatuses: [201],
        },
      );
      const claim = exactObject(claimed.body?.data, 'PAIRING_CLAIM_RESPONSE');
      const session = exactObject(claim.session, 'PAIRING_SESSION');
      sessionId = exactIdentifier(session.id, 'SESSION_ID');
      deviceAccessToken = exactToken(claim.accessToken, 'DEVICE_ACCESS_TOKEN');
      refreshToken = exactToken(claim.refreshToken, 'DEVICE_REFRESH_TOKEN');
      secrets.add(deviceAccessToken);
      secrets.add(refreshToken);
      pairingCode = null;
      const shops = await requestJson(
        'GET /api/extension-device/shops',
        'GET',
        '/api/extension-device/shops',
        { token: deviceAccessToken },
      );
      const authorizedShops = exactArray(shops.body?.data, 'DEVICE_SHOPS');
      if (shops.body?.code !== 1
        || authorizedShops.length !== 1
        || authorizedShops[0]?.id !== shopId
        || authorizedShops[0]?.platform !== 'OZON') fail('DEVICE_SHOP_SCOPE_MISMATCH');
      const refreshed = await requestJson(
        'POST /api/extension-device/refresh',
        'POST',
        '/api/extension-device/refresh',
        { body: { refreshToken } },
      );
      const refresh = exactObject(refreshed.body?.data, 'DEVICE_REFRESH_RESPONSE');
      if (refresh.session?.id !== sessionId) fail('DEVICE_REFRESH_SESSION_MISMATCH');
      const nextAccessToken = exactToken(refresh.accessToken, 'DEVICE_ACCESS_TOKEN');
      const nextRefreshToken = exactToken(refresh.refreshToken, 'DEVICE_REFRESH_TOKEN');
      if (nextAccessToken === deviceAccessToken || nextRefreshToken === refreshToken) {
        fail('DEVICE_REFRESH_NOT_ROTATED');
      }
      secrets.add(nextAccessToken);
      secrets.add(nextRefreshToken);
      deviceAccessToken = nextAccessToken;
      refreshToken = nextRefreshToken;
      const sessions = await requestJson(
        'GET /api/extension-device/sessions',
        'GET',
        '/api/extension-device/sessions',
        { token: ownerToken },
      );
      const sessionRows = exactArray(sessions.body?.data, 'DEVICE_SESSIONS');
      if (!sessionRows.some((value) => value?.id === sessionId && value?.status === 'ACTIVE')) {
        fail('DEVICE_SESSION_NOT_ACTIVE');
      }
      checks.push(checkResult(activeCheck, {
        deploymentIdHash: identityHash('DEPLOYMENT', deploymentId),
        deviceIdHash: identityHash('DEVICE', deviceId),
        sessionIdHash: identityHash('SESSION', sessionId),
        authorizedShopIdHash: identityHash('SHOP', shopId),
        refreshRotated: true,
      }));

      activeCheck = 'byok-disabled-path';
      const disabled = await requestJson(
        'POST /api/extension-device/byok-media/readiness',
        'POST',
        '/api/extension-device/byok-media/readiness',
        {
          token: deviceAccessToken,
          body: {
            contractVersion: 'extension-byok-readiness-request/v2',
            shopId,
            workflowId: null,
            draftRevision: null,
            draftVersion: null,
            sourcePlatform: null,
            sourceProductId: null,
            sourceCaptureSnapshotId: null,
            supplyGoodsId: null,
            skuKey: null,
            slotKey: null,
            assignmentMode: null,
            assignmentOrdinal: null,
            providerOrigin: 'https://rel04-disabled.invalid',
            model: 'rel04-disabled-fixture',
            operation: 'TEXT_TO_IMAGE',
          },
          expectedStatuses: [409],
        },
      );
      if (disabled.body?.code !== 0
        || responseErrorCode(disabled.body) !== 'byok_readiness_not_ready') {
        fail('BYOK_DISABLED_PATH_NOT_REJECTED');
      }
      checks.push(checkResult(activeCheck, {
        rejectedBeforeExecutionIntent: true,
        providerRequestSentByCanary: false,
        erpIngestRequestSentByCanary: false,
        statusCode: disabled.status,
        errorCode: responseErrorCode(disabled.body),
      }));

    } catch (error) {
      checks.push(failureResult(
        activeCheck,
        error instanceof Rel04CanaryError ? error.code : 'UNEXPECTED_CANARY_FAILURE',
      ));
    }
  }

  async function cleanup() {
    if (!cleanupRequired) {
      checks.push(checkResult('device-session-cleanup', { action: 'NOT_REQUIRED' }));
      return;
    }
    try {
      if (!sessionId && pairingCodeId && canaryDeviceId) {
        const sessions = await requestJson(
          'GET /api/extension-device/sessions',
          'GET',
          '/api/extension-device/sessions',
          { token: ownerToken },
        );
        const sessionRows = exactArray(sessions.body?.data, 'DEVICE_SESSIONS');
        if (sessions.body?.code !== 1) fail('DEVICE_SESSION_RECOVERY_FAILED');
        const matches = sessionRows.filter((value) => value?.deviceId === canaryDeviceId);
        if (matches.length > 1) fail('DEVICE_SESSION_RECOVERY_AMBIGUOUS');
        if (matches.length === 1) {
          const recovered = exactObject(matches[0], 'RECOVERED_DEVICE_SESSION');
          sessionId = exactIdentifier(recovered.id, 'SESSION_ID');
          if (recovered.status !== 'ACTIVE') {
            checks.push(checkResult('device-session-cleanup', {
              action: 'RECOVERED_SESSION_ALREADY_INACTIVE',
              sessionIdHash: identityHash('SESSION', sessionId),
            }));
            return;
          }
        }
      }
      if (sessionId) {
        const revoked = await requestJson(
          'DELETE /api/extension-device/sessions/:sessionId',
          'DELETE',
          `/api/extension-device/sessions/${encodeURIComponent(sessionId)}`,
          { token: ownerToken },
        );
        if (revoked.body?.code !== 1) fail('DEVICE_SESSION_REVOKE_FAILED');
        let revokedTokenRejected = false;
        if (deviceAccessToken) {
          const denied = await requestJson(
            'GET /api/extension-device/shops (revoked)',
            'GET',
            '/api/extension-device/shops',
            { token: deviceAccessToken, expectedStatuses: [401] },
          );
          if (denied.body?.code !== 0
            || responseErrorCode(denied.body) !== 'invalid_device_token') {
            fail('REVOKED_DEVICE_TOKEN_STILL_ACTIVE');
          }
          revokedTokenRejected = true;
        }
        checks.push(checkResult('device-session-cleanup', {
          action: deviceAccessToken ? 'OWNER_REVOKED' : 'OWNER_RECOVERED_AND_REVOKED',
          sessionIdHash: identityHash('SESSION', sessionId),
          revokedTokenRejected,
        }));
      } else if (pairingCodeId) {
        const canceled = await requestJson(
          'DELETE /api/extension-device/pairing-codes/:pairingCodeId',
          'DELETE',
          `/api/extension-device/pairing-codes/${encodeURIComponent(pairingCodeId)}`,
          { token: ownerToken },
        );
        if (canceled.body?.code !== 1) fail('PAIRING_CODE_CANCEL_FAILED');
        checks.push(checkResult('device-session-cleanup', {
          action: 'PAIRING_CODE_CANCELED',
          pairingCodeIdHash: identityHash('PAIRING', pairingCodeId),
        }));
      } else {
        fail('PAIRING_CLEANUP_IDENTITY_MISSING');
      }
    } catch (error) {
      cleanupCode = error instanceof Rel04CanaryError ? error.code : 'UNEXPECTED_CLEANUP_FAILURE';
      checks.push(failureResult('device-session-cleanup', cleanupCode));
    }
  }

  await normalChecks();
  await cleanup();
  const passed = checks.every((check) => check.status === 'PASS');
  const summary = {
    schemaVersion: 1,
    kind: 'SS_ERP_REL04_DARK_CANARY',
    status: passed ? 'PASS' : 'FAIL',
    observedAt,
    bindings: {
      apiOrigin,
      expectedGitCommit,
      extensionOrigin,
      shopIdHash: identityHash('SHOP', shopId),
      publishReconciliation: publishReconciliation.mode === 'LIVE_ATTEMPT'
        ? {
            mode: publishReconciliation.mode,
            workflowIdHash: identityHash('WORKFLOW', publishWorkflowId),
            attemptIdHash: identityHash('ATTEMPT', publishAttemptId),
            regressionEvidenceSha256: null,
            notBefore: publishReconciliation.notBefore,
          }
        : {
            mode: publishReconciliation.mode,
            workflowIdHash: null,
            attemptIdHash: null,
            regressionEvidenceSha256: publishReconciliation.regressionSha256,
            notBefore: null,
          },
    },
    checks,
    requestAudit: {
      timeoutMs: REQUEST_TIMEOUT_MS,
      redirectsAllowed: false,
      credentialsMode: 'omit',
      requests,
      providerDispatchSent: false,
      erpIngestSent: false,
      ozonMutationSent: false,
    },
    cleanup: {
      required: cleanupRequired,
      completed: cleanupRequired
        ? checks.some((check) => check.id === 'device-session-cleanup' && check.status === 'PASS')
        : true,
      errorCode: cleanupCode,
    },
  };
  assertNoSecret(summary, secrets);
  pairingCode = null;
  deviceAccessToken = null;
  refreshToken = null;
  return summary;
}

export function writeRel04DarkCanarySummary(outputPath, summary, repositoryRoot = path.resolve('.')) {
  const absolute = path.resolve(outputPath);
  if (pathInside(repositoryRoot, absolute)) fail('SUMMARY_OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  ensureRealDirectoryTree(path.dirname(absolute));
  const bytes = Buffer.from(canonicalJson(summary), 'utf8');
  writeNewArtifactDurably(absolute, bytes, { mode: 0o600 });
  return { outputPath: absolute, outputSha256: sha256(bytes) };
}

async function main() {
  if (process.argv.length !== 2) {
    console.error('FAIL REL-04 canary accepts configuration only through environment variables');
    process.exitCode = 1;
    return;
  }
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let config;
  try {
    config = parseRel04DarkCanaryEnvironment(process.env, repositoryRoot, new Date());
  } catch {
    console.error('FAIL REL-04 canary configuration rejected before network I/O');
    process.exitCode = 1;
    return;
  }
  const summary = await runRel04DarkCanary(config);
  const retained = writeRel04DarkCanarySummary(config.outputPath, summary, repositoryRoot);
  console.log(JSON.stringify({
    schemaVersion: 1,
    status: summary.status,
    output: path.basename(retained.outputPath),
    outputSha256: retained.outputSha256,
  }, null, 2));
  if (summary.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main();
  } catch {
    console.error('FAIL REL-04 dark canary failed without exposing response or credential data');
    process.exitCode = 1;
  }
}
