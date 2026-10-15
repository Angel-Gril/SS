import { createPublicKey, verify } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs';
import path from 'node:path';
import {
  parseRel04CandidateIdentity,
  validateRel04ReleaseBinding,
} from '../packages/shared/src/rel04-release-evidence-runtime.mjs';
import {
  MAX_KEYRING_BYTES,
  MAX_PUBLICATION_APPROVAL_BYTES,
  canonicalTrustedKeyringJson,
  canonicalWebsitePublicationApprovalJson,
  parseTrustedKeyring,
  parseWebsitePublicationApproval,
  sha256,
  websitePublicationApprovalPayload,
} from './extension-release-publication-contract.mjs';
import {
  isApprovedAiMediaHostedPublicationOperations,
  isRestrictedAiMediaHostedPilotOperations,
  normalizeAiMediaHostedPilotExpectation,
} from './verify-ai-media-pilot-policy.mjs';

const MAX_DARK_CANARY_BYTES = 256 * 1024;
const MAX_DARK_CANARY_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const REL04_DARK_CHECK_IDS = Object.freeze([
  'deployment-and-publication-isolation',
  'default-off-policy',
  'hosted-route-regression',
  'publish-reconciliation-read',
  'device-pairing-active-lifecycle',
  'byok-disabled-path',
  'device-session-cleanup',
]);
const REL04_NO_SHOP_DARK_CHECK_IDS = Object.freeze([
  'deployment-and-publication-isolation',
  'default-off-policy',
  'hosted-route-regression',
  'publish-reconciliation-read',
]);
const REL04_PILOT_CHECK_IDS = Object.freeze([
  'deployment-and-publication-isolation',
  'restricted-pilot-policy',
  'hosted-route-readiness',
  'publish-reconciliation-read',
  'device-pairing-active-lifecycle',
  'byok-disabled-path',
  'device-session-cleanup',
]);
const REL04_REQUIRED_REQUEST_ROUTES = Object.freeze([
  'GET /ready',
  'GET /api/extensions/latest',
  'OPTIONS /api/extension-device/byok-media/readiness',
  'GET /api/admin/system-config/:key',
  'GET /api/ai-images/suites/readiness',
  'GET /api/source-listing-workflows/publisher-capability',
  'POST /api/extension-device/pairing-codes',
  'POST /api/extension-device/pairing-claims',
  'GET /api/extension-device/shops',
  'POST /api/extension-device/refresh',
  'GET /api/extension-device/sessions',
  'POST /api/extension-device/byok-media/readiness',
  'DELETE /api/extension-device/sessions/:sessionId',
  'GET /api/extension-device/shops (revoked)',
]);
const REL04_NO_SHOP_DARK_REQUIRED_REQUEST_ROUTES = Object.freeze([
  'GET /ready',
  'GET /api/extensions/latest',
  'OPTIONS /api/extension-device/byok-media/readiness',
  'GET /api/admin/system-config/:key',
  'GET /api/ai-images/suites/readiness',
  'GET /api/shops',
]);

function fail(message) {
  throw new Error(message);
}

function sameFileSnapshot(left, right) {
  return ['dev', 'ino', 'mode', 'nlink', 'uid', 'gid', 'size', 'mtimeNs', 'ctimeNs']
    .every((field) => left[field] === right[field]);
}

export function readStablePublicationFile(file, maxBytes, label) {
  const absolute = path.resolve(file);
  let before;
  try {
    before = lstatSync(absolute, { bigint: true });
  } catch {
    fail(`${label} is missing or unreadable`);
  }
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n
    || before.size < 1n || before.size > BigInt(maxBytes)
    || (process.platform !== 'win32'
      && (before.uid !== BigInt(process.geteuid()) || Number(before.mode & 0o022n) !== 0))) {
    fail(`${label} must be one bounded non-writable regular file`);
  }
  let descriptor = null;
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameFileSnapshot(before, opened)) fail(`${label} changed while it was opened`);
    const bytes = Buffer.allocUnsafe(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count < 1) fail(`${label} changed while it was read`);
      offset += count;
    }
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(absolute, { bigint: true });
    if (!sameFileSnapshot(before, openedAfter) || !sameFileSnapshot(before, pathAfter)) {
      fail(`${label} changed while it was read`);
    }
    return bytes;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function canonicalJsonFile(file, maxBytes, label, parser, canonicalizer) {
  const bytes = readStablePublicationFile(file, maxBytes, label);
  const text = bytes.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff || text.includes('\r')) {
    fail(`${label} must be canonical UTF-8 JSON`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON`);
  }
  const value = parser(raw);
  if (text !== canonicalizer(value)) fail(`${label} is not canonical JSON`);
  return { bytes, value };
}

function trustedPublicKey(keyring, keyId) {
  const trusted = keyring.keys.find((candidate) => candidate.keyId === keyId);
  if (!trusted || trusted.status !== 'ACTIVE') {
    fail(`trusted Ed25519 key is unavailable: ${keyId}`);
  }
  let publicKey;
  try {
    publicKey = createPublicKey({
      key: Buffer.from(trusted.publicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
  } catch {
    fail(`trusted Ed25519 public key is invalid: ${keyId}`);
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    fail(`trusted public key is not Ed25519: ${keyId}`);
  }
  return publicKey;
}

export function verifyWebsitePublicationApproval(input) {
  const approvalFile = canonicalJsonFile(
    input.approvalPath,
    MAX_PUBLICATION_APPROVAL_BYTES,
    'website publication approval',
    parseWebsitePublicationApproval,
    canonicalWebsitePublicationApprovalJson,
  );
  const keyringFile = canonicalJsonFile(
    input.keyringPath,
    MAX_KEYRING_BYTES,
    'extension release trusted keyring',
    parseTrustedKeyring,
    canonicalTrustedKeyringJson,
  );
  const publicKey = trustedPublicKey(keyringFile.value, approvalFile.value.keyId);
  if (!verify(
    null,
    websitePublicationApprovalPayload(approvalFile.value),
    publicKey,
    Buffer.from(approvalFile.value.signatureBase64, 'base64'),
  )) {
    fail('website publication approval signature verification failed');
  }
  return {
    approval: approvalFile.value,
    approvalBytes: approvalFile.bytes,
    approvalSha256: sha256(approvalFile.bytes),
  };
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(`${label} has an invalid field set`);
  }
  return value;
}

function canonicalTimestamp(value, label) {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    fail(`${label} is invalid`);
  }
  return value;
}

function rel04Digest(value, label) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    fail(`${label} is invalid`);
  }
  return value;
}

function validateExistingPublication(value) {
  if (value === null) return;
  const publication = exactKeys(value, [
    'gitCommit',
    'publicationApprovalSha256',
    'targets',
    'version',
  ], 'REL-04 existing website publication');
  if (!/^[a-f0-9]{40}$/u.test(publication.gitCommit)
    || !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u
      .test(publication.version)) {
    fail('REL-04 existing website publication identity is invalid');
  }
  rel04Digest(publication.publicationApprovalSha256, 'REL-04 existing approval SHA-256');
  const targets = exactKeys(
    publication.targets,
    ['cloud', 'local'],
    'REL-04 existing website publication targets',
  );
  for (const target of ['cloud', 'local']) {
    const artifact = exactKeys(
      targets[target],
      ['filename', 'path', 'sha256'],
      `REL-04 existing ${target} target`,
    );
    rel04Digest(artifact.sha256, `REL-04 existing ${target} SHA-256`);
    if (typeof artifact.filename !== 'string'
      || artifact.filename !== `ss-erp-${target}-${publication.version}.zip`
      || artifact.path !== `/api/extensions/download/${target}/${publication.version}/${artifact.sha256}`) {
      fail(`REL-04 existing ${target} target identity is invalid`);
    }
  }
}

function validateDarkPolicyEvidence(value) {
  const policy = exactKeys(value, [
    'extensionByok',
    'extensionWorkbench',
    'fullEdit',
    'imageToImage',
    'imageTranslation',
    'inpaint',
    'legacyGeneration',
    'master',
    'ozonPublisher',
    'policy',
    'suite',
    'webMedia',
  ], 'REL-04 default-off policy evidence');
  for (const key of [
    'extensionWorkbench', 'fullEdit', 'imageToImage', 'inpaint',
    'master', 'ozonPublisher', 'suite', 'webMedia',
  ]) {
    if (!['absent', 'false'].includes(policy[key])) {
      fail(`REL-04 default-off policy ${key} is invalid`);
    }
  }
  if (typeof policy.legacyGeneration !== 'string'
    || !(policy.legacyGeneration.endsWith('/disabled') || policy.legacyGeneration === 'disabled/custom')
    || typeof policy.imageTranslation !== 'string'
    || !policy.imageTranslation.endsWith('/disabled')
    || typeof policy.policy !== 'string'
    || (policy.policy !== 'absent' && !/^revision:[0-9]+,tenantIds:0$/u.test(policy.policy))) {
    fail('REL-04 default-off Provider or rollout policy is invalid');
  }
  const extensionByok = exactKeys(policy.extensionByok, [
    'expectation', 'generation', 'hostedAi', 'ingest', 'policy', 'publish',
  ], 'REL-04 extension BYOK policy evidence');
  if (extensionByok.expectation !== 'off'
    || !['false', 'absent(default:false)'].includes(extensionByok.hostedAi)
    || !['false', 'absent(default:false)'].includes(extensionByok.generation)
    || !['false', 'absent(default:false)'].includes(extensionByok.ingest)
    || !['false', 'absent(default:false)'].includes(extensionByok.publish)
    || typeof extensionByok.policy !== 'string'
    || !['absent(default:off)', 'extension-byok-admin-policy/v1:revision:0,mode:off']
      .includes(extensionByok.policy)) {
    fail('REL-04 extension BYOK policy is not dark');
  }
}

function validateRestrictedPilotEvidence(value, rollout, candidateRegion) {
  const policy = exactKeys(value, [
    'allowedOperations', 'deviceSessionIds', 'expectation', 'ownerUserIds',
    'rolloutRevision', 'shopIds', 'sourcePolicyRevision',
  ], 'REL-04 restricted pilot policy evidence');
  let normalized;
  try {
    normalized = normalizeAiMediaHostedPilotExpectation({
      ownerUserIds: policy.ownerUserIds,
      shopIds: policy.shopIds,
      deviceSessionIds: policy.deviceSessionIds,
      rolloutRevision: policy.rolloutRevision,
      sourcePolicyRevision: policy.sourcePolicyRevision,
      allowedOperations: policy.allowedOperations,
    });
  } catch {
    fail('REL-04 restricted pilot policy evidence is invalid');
  }
  if (policy.expectation !== 'hosted-pilot'
    || normalized.ownerUserIds.length !== 1
    || !isApprovedAiMediaHostedPublicationOperations(normalized.allowedOperations)
    || (!isRestrictedAiMediaHostedPilotOperations(normalized.allowedOperations)
      && candidateRegion !== 'COM')) {
    fail('REL-04 restricted pilot scope is invalid');
  }
  const binding = exactKeys(rollout, ['expectation', 'policySha256'], 'REL-04 rollout binding');
  if (binding.expectation !== 'hosted-pilot') fail('REL-04 rollout expectation is invalid');
  rel04Digest(binding.policySha256, 'REL-04 restricted pilot policy SHA-256');
  if (binding.policySha256 !== sha256(Buffer.from(`${JSON.stringify(policy, null, 2)}\n`, 'utf8'))) {
    fail('REL-04 restricted pilot policy digest is invalid');
  }
}

function validateReconciliationBinding(value) {
  const binding = exactKeys(value, [
    'attemptIdHash',
    'mode',
    'notBefore',
    'regressionEvidenceSha256',
    'workflowIdHash',
  ], 'REL-04 publish reconciliation binding');
  if (binding.mode === 'LIVE_ATTEMPT') {
    rel04Digest(binding.workflowIdHash, 'REL-04 workflow hash');
    rel04Digest(binding.attemptIdHash, 'REL-04 attempt hash');
    if (binding.regressionEvidenceSha256 !== null) {
      fail('REL-04 live reconciliation regression digest must be null');
    }
    canonicalTimestamp(binding.notBefore, 'REL-04 reconciliation notBefore');
  } else if (binding.mode === 'TARGET_COMMIT_QA04_REGRESSION') {
    if (binding.workflowIdHash !== null || binding.attemptIdHash !== null
      || binding.notBefore !== null) {
      fail('REL-04 regression reconciliation live binding must be null');
    }
    rel04Digest(binding.regressionEvidenceSha256, 'REL-04 regression evidence SHA-256');
  } else {
    fail('REL-04 publish reconciliation mode is invalid');
  }
  return binding;
}

function validateReconciliationEvidence(value, binding, observedAt) {
  if (binding.mode === 'LIVE_ATTEMPT') {
    const evidence = exactKeys(value, [
      'attemptIdHash', 'completedAt', 'lastReconciledAt', 'mode', 'notBefore',
      'ozonMutationRequestSentByCanary', 'reconcileAttemptCount', 'reconciliationState',
      'state', 'stateVersion', 'workflowIdHash',
    ], 'REL-04 live reconciliation evidence');
    if (evidence.mode !== binding.mode
      || evidence.workflowIdHash !== binding.workflowIdHash
      || evidence.attemptIdHash !== binding.attemptIdHash
      || evidence.notBefore !== binding.notBefore
      || evidence.state !== 'SUBMITTED'
      || evidence.reconciliationState !== 'SUCCEEDED'
      || !Number.isSafeInteger(evidence.stateVersion) || evidence.stateVersion < 1
      || !Number.isSafeInteger(evidence.reconcileAttemptCount)
      || evidence.reconcileAttemptCount < 1
      || evidence.ozonMutationRequestSentByCanary !== false) {
      fail('REL-04 live reconciliation evidence is invalid');
    }
    const lastReconciledAt = canonicalTimestamp(
      evidence.lastReconciledAt,
      'REL-04 lastReconciledAt',
    );
    const completedAt = canonicalTimestamp(evidence.completedAt, 'REL-04 completedAt');
    if (Date.parse(lastReconciledAt) < Date.parse(binding.notBefore)
      || Date.parse(completedAt) < Date.parse(lastReconciledAt)
      || Date.parse(completedAt) > Date.parse(observedAt)) {
      fail('REL-04 live reconciliation timestamps are invalid');
    }
    return;
  }
  const evidence = exactKeys(value, [
    'capabilityEnabled', 'capabilityLegacyAllowed', 'capabilityReason',
    'capabilityRevision', 'liveAttemptRead', 'mode', 'ozonMutationRequestSentByCanary',
    'regressionEvidenceSha256',
  ], 'REL-04 regression reconciliation evidence');
  if (evidence.mode !== binding.mode
    || evidence.liveAttemptRead !== false
    || evidence.regressionEvidenceSha256 !== binding.regressionEvidenceSha256
    || evidence.capabilityEnabled !== false
    || typeof evidence.capabilityReason !== 'string'
    || evidence.capabilityReason.length < 1
    || evidence.capabilityReason.length > 200
    || evidence.capabilityReason !== evidence.capabilityReason.trim()
    || typeof evidence.capabilityRevision !== 'string'
    || evidence.capabilityRevision.length < 1
    || evidence.capabilityRevision.length > 200
    || evidence.capabilityRevision !== evidence.capabilityRevision.trim()
    || typeof evidence.capabilityLegacyAllowed !== 'boolean'
    || evidence.ozonMutationRequestSentByCanary !== false) {
    fail('REL-04 regression reconciliation evidence is invalid');
  }
}

function validateNoShopDarkReconciliationEvidence(value, binding) {
  const evidence = exactKeys(value, [
    'mode', 'regressionEvidenceSha256', 'shopInventoryCount',
    'publisherCapabilityChecked', 'ozonMutationRequestSentByCanary',
  ], 'REL-04 CN no-shop dark evidence');
  if (binding.mode !== 'TARGET_COMMIT_QA04_REGRESSION'
    || evidence.mode !== binding.mode
    || evidence.regressionEvidenceSha256 !== binding.regressionEvidenceSha256
    || evidence.shopInventoryCount !== 0
    || evidence.publisherCapabilityChecked !== false
    || evidence.ozonMutationRequestSentByCanary !== false) {
    fail('REL-04 CN no-shop dark evidence is invalid');
  }
}

export function validateRel04DarkCanarySummary(summary, input) {
  const expectedGitCommit = String(input.expectedGitCommit || '');
  const expectedApiOrigin = String(input.expectedApiOrigin || '');
  const value = exactKeys(summary, [
    'bindings', 'checks', 'cleanup', 'kind', 'observedAt', 'requestAudit',
    'schemaVersion', 'status',
  ], 'REL-04 dark canary evidence');
  const restrictedPilot = value.schemaVersion === 3;
  const noShopDarkCanary = value.bindings?.noShopDarkCanary === true;
  const bindings = exactKeys(value.bindings, [
    'apiOrigin', 'expectedGitCommit', 'extensionOrigin', 'publishReconciliation',
    'shopIdHash', ...([2, 3].includes(value.schemaVersion) ? ['release'] : []),
    ...(restrictedPilot ? ['rollout'] : []),
    ...(noShopDarkCanary ? ['noShopDarkCanary'] : []),
  ], 'REL-04 dark canary bindings');
  const reconciliation = validateReconciliationBinding(bindings.publishReconciliation);
  const observedAt = canonicalTimestamp(value.observedAt, 'REL-04 dark canary observedAt');
  rel04Digest(bindings.shopIdHash, 'REL-04 shop hash');
  if (![1, 2, 3].includes(value.schemaVersion)
    || value.kind !== (restrictedPilot
      ? 'SS_ERP_REL04_RESTRICTED_HOSTED_PILOT_CANARY'
      : 'SS_ERP_REL04_DARK_CANARY')
    || value.status !== 'PASS'
    || bindings.expectedGitCommit !== expectedGitCommit
    || bindings.apiOrigin !== expectedApiOrigin
    || !/^chrome-extension:\/\/[a-p]{32}$/u.test(bindings.extensionOrigin)) {
    fail('REL-04 dark canary identity or bindings are invalid');
  }
  if (input.requireReleaseBinding && ![2, 3].includes(value.schemaVersion)) {
    fail('REL-04 v2 candidate-bound or v3 restricted-pilot evidence is required for a new website approval');
  }
  if (noShopDarkCanary && (value.schemaVersion !== 2
    || value.kind !== 'SS_ERP_REL04_DARK_CANARY'
    || bindings.noShopDarkCanary !== true
    || bindings.shopIdHash !== sha256(Buffer.from('SS_ERP_REL04_CANARY_SHOP\0cn-dark-no-shop', 'utf8'))
    || reconciliation.mode !== 'TARGET_COMMIT_QA04_REGRESSION'
    || input.expectedCandidate?.region !== 'CN')) {
    fail('REL-04 no-shop dark canary binding is invalid');
  }
  if ([2, 3].includes(value.schemaVersion)) {
    let candidate;
    try {
      const expected = input.expectedCandidate || {};
      candidate = parseRel04CandidateIdentity({
        gitCommit: expected.gitCommit, apiOrigin: expected.apiOrigin,
        region: expected.region, version: expected.version,
        releaseEvidenceSha256: expected.releaseEvidenceSha256,
        releaseSignatureSha256: expected.releaseSignatureSha256,
      });
    } catch {
      fail('REL-04 expected candidate identity is incomplete or invalid');
    }
    if (candidate.gitCommit !== expectedGitCommit || candidate.apiOrigin !== expectedApiOrigin) {
      fail('REL-04 expected candidate does not match the publication target');
    }
    const releaseSignedAt = canonicalTimestamp(input.expectedReleaseSignedAt, 'REL-04 expected release signature timestamp');
    validateRel04ReleaseBinding(bindings.release, candidate, observedAt, releaseSignedAt);
  }

  const expectedCheckIds = noShopDarkCanary
    ? REL04_NO_SHOP_DARK_CHECK_IDS
    : (restrictedPilot ? REL04_PILOT_CHECK_IDS : REL04_DARK_CHECK_IDS);
  if (!Array.isArray(value.checks) || value.checks.length !== expectedCheckIds.length) {
    fail('REL-04 dark canary check set is incomplete');
  }
  const checks = value.checks.map((check, index) => exactKeys(
    check,
    ['evidence', 'id', 'status'],
    `REL-04 dark canary check ${index}`,
  ));
  if (JSON.stringify(checks.map((check) => check.id)) !== JSON.stringify(expectedCheckIds)
    || checks.some((check) => check.status !== 'PASS')) {
    fail('REL-04 dark canary check set is invalid');
  }
  const evidence = Object.fromEntries(checks.map((check) => [check.id, exactKeys(
    check.evidence,
    Object.keys(check.evidence || {}),
    `REL-04 ${check.id} evidence`,
  )]));

  const deployment = exactKeys(evidence['deployment-and-publication-isolation'], [
    'deployedCandidatePublic', 'deployedGitCommit', 'existingPublication',
    'extensionCorsPreflight',
  ], 'REL-04 deployment isolation evidence');
  if (deployment.deployedGitCommit !== expectedGitCommit
    || deployment.deployedCandidatePublic !== false
    || deployment.extensionCorsPreflight !== true) {
    fail('REL-04 deployment isolation evidence is invalid');
  }
  validateExistingPublication(deployment.existingPublication);
  if (restrictedPilot) {
    validateRestrictedPilotEvidence(evidence['restricted-pilot-policy'], bindings.rollout, bindings.release?.candidate?.region);
    const hosted = exactKeys(evidence['hosted-route-readiness'], [
      'providerDispatchMethodUsed', 'ready', 'reasonCode', 'routeReachable',
      'suiteEnabled', 'webMediaEnabled', 'workflowEnabled',
    ], 'REL-04 hosted readiness evidence');
    if (hosted.routeReachable !== true || hosted.providerDispatchMethodUsed !== false
      || hosted.suiteEnabled !== true || hosted.workflowEnabled !== true
      || hosted.webMediaEnabled !== true || hosted.ready !== true
      || hosted.reasonCode !== 'READY') {
      fail('REL-04 hosted readiness evidence is invalid');
    }
  } else {
    validateDarkPolicyEvidence(evidence['default-off-policy']);
    const hosted = exactKeys(evidence['hosted-route-regression'], [
      'providerDispatchMethodUsed', 'reasonCode', 'routeReachable', 'suiteEnabled',
      'workflowEnabled',
    ], 'REL-04 hosted regression evidence');
    if (hosted.routeReachable !== true || hosted.providerDispatchMethodUsed !== false
      || hosted.suiteEnabled !== false || hosted.workflowEnabled !== false
      || hosted.reasonCode !== 'AI_MEDIA_SUITE_DISABLED') {
      fail('REL-04 hosted regression evidence is invalid');
    }
  }
  if (noShopDarkCanary) {
    validateNoShopDarkReconciliationEvidence(evidence['publish-reconciliation-read'], reconciliation);
  } else {
    validateReconciliationEvidence(evidence['publish-reconciliation-read'], reconciliation, observedAt);
  }

  if (!noShopDarkCanary) {
    const lifecycle = exactKeys(evidence['device-pairing-active-lifecycle'], [
      'authorizedShopIdHash', 'deploymentIdHash', 'deviceIdHash', 'refreshRotated',
      'sessionIdHash',
    ], 'REL-04 device lifecycle evidence');
    for (const key of ['authorizedShopIdHash', 'deploymentIdHash', 'deviceIdHash', 'sessionIdHash']) {
      rel04Digest(lifecycle[key], `REL-04 ${key}`);
    }
    if (lifecycle.refreshRotated !== true) fail('REL-04 device refresh did not rotate');

    const disabled = exactKeys(evidence['byok-disabled-path'], [
      'erpIngestRequestSentByCanary', 'errorCode', 'providerRequestSentByCanary',
      'rejectedBeforeExecutionIntent', 'statusCode',
    ], 'REL-04 BYOK disabled evidence');
    if (disabled.rejectedBeforeExecutionIntent !== true
      || disabled.providerRequestSentByCanary !== false
      || disabled.erpIngestRequestSentByCanary !== false
      || disabled.statusCode !== 409
      || disabled.errorCode !== 'byok_readiness_not_ready') {
      fail('REL-04 BYOK disabled evidence is invalid');
    }

    const cleanupCheck = exactKeys(evidence['device-session-cleanup'], [
      'action', 'revokedTokenRejected', 'sessionIdHash',
    ], 'REL-04 device cleanup evidence');
    rel04Digest(cleanupCheck.sessionIdHash, 'REL-04 cleanup session hash');
    if ((cleanupCheck.action === 'OWNER_REVOKED'
        && cleanupCheck.revokedTokenRejected !== true)
      || (cleanupCheck.action === 'OWNER_RECOVERED_AND_REVOKED'
        && cleanupCheck.revokedTokenRejected !== false)
      || !['OWNER_REVOKED', 'OWNER_RECOVERED_AND_REVOKED'].includes(cleanupCheck.action)) {
      fail('REL-04 device cleanup evidence is invalid');
    }
  }

  const requestAudit = exactKeys(value.requestAudit, [
    'credentialsMode', 'erpIngestSent', 'ozonMutationSent', 'providerDispatchSent',
    'redirectsAllowed', 'requests', 'timeoutMs',
  ], 'REL-04 request audit');
  if (requestAudit.timeoutMs !== 15_000 || requestAudit.redirectsAllowed !== false
    || requestAudit.credentialsMode !== 'omit'
    || requestAudit.providerDispatchSent !== false
    || requestAudit.erpIngestSent !== false
    || requestAudit.ozonMutationSent !== false
    || !Array.isArray(requestAudit.requests) || requestAudit.requests.length < 1) {
    fail('REL-04 request audit is invalid');
  }
  if (requestAudit.requests.length > 128) fail('REL-04 request audit is too large');
  const requiredRoutes = noShopDarkCanary
    ? new Set(REL04_NO_SHOP_DARK_REQUIRED_REQUEST_ROUTES)
    : reconciliation.mode === 'LIVE_ATTEMPT'
    ? new Set([
        ...REL04_REQUIRED_REQUEST_ROUTES,
        'GET /api/source-listing-workflows/:workflowId/publish-attempts/:attemptId',
      ])
    : new Set(REL04_REQUIRED_REQUEST_ROUTES);
  const routes = new Set(requestAudit.requests.map((request, index) => {
    const row = exactKeys(request, ['method', 'route', 'statusCode'], `REL-04 request audit ${index}`);
    if (typeof row.route !== 'string' || typeof row.method !== 'string'
      || !Number.isSafeInteger(row.statusCode) || row.statusCode < 100 || row.statusCode > 599) {
      fail(`REL-04 request audit ${index} is invalid`);
    }
    const separator = row.route.indexOf(' ');
    if (separator < 1 || row.method !== row.route.slice(0, separator)
      || !requiredRoutes.has(row.route)) {
      fail(`REL-04 request audit ${index} is not allowlisted`);
    }
    return row.route;
  }));
  if ([...requiredRoutes].some((route) => !routes.has(route))) {
    fail('REL-04 request audit is incomplete');
  }

  const cleanup = exactKeys(
    value.cleanup,
    ['completed', 'errorCode', 'required'],
    'REL-04 cleanup summary',
  );
  if (cleanup.completed !== true || cleanup.errorCode !== null
    || (!noShopDarkCanary && cleanup.required !== true)
    || (noShopDarkCanary && cleanup.required !== false)) {
    fail('REL-04 cleanup summary is invalid');
  }
  return {
    observedAt,
    summary: value,
  };
}

export function verifyRel04DarkCanaryEvidence(input) {
  const expectedSha256 = String(input.expectedSha256 || '');
  const expectedGitCommit = String(input.expectedGitCommit || '');
  const expectedApiOrigin = String(input.expectedApiOrigin || '');
  const approvedAt = canonicalTimestamp(input.approvedAt, 'website publication approvedAt');
  const now = input.now instanceof Date ? input.now : new Date();
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256)
    || !/^[a-f0-9]{40}$/u.test(expectedGitCommit)
    || Number.isNaN(now.getTime())) {
    fail('REL-04 dark canary verification input is invalid');
  }
  const bytes = readStablePublicationFile(
    input.darkCanaryPath,
    MAX_DARK_CANARY_BYTES,
    'REL-04 dark canary evidence',
  );
  if (sha256(bytes) !== expectedSha256) {
    fail('REL-04 dark canary SHA-256 does not match operator approval');
  }
  const text = bytes.toString('utf8');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    fail('REL-04 dark canary evidence is not valid JSON');
  }
  if (text.charCodeAt(0) === 0xfeff || text.includes('\r')
    || text !== `${JSON.stringify(raw, null, 2)}\n`) {
    fail('REL-04 dark canary evidence is not canonical JSON');
  }
  const { observedAt } = validateRel04DarkCanarySummary(raw, {
    expectedGitCommit,
    expectedApiOrigin,
    expectedCandidate: input.expectedCandidate,
    expectedReleaseSignedAt: input.expectedReleaseSignedAt,
    requireReleaseBinding: input.requireReleaseBinding,
  });
  const age = now.getTime() - Date.parse(observedAt);
  if (Date.parse(observedAt) > Date.parse(approvedAt)
    || age < -MAX_CLOCK_SKEW_MS
    || age > MAX_DARK_CANARY_AGE_MS) {
    fail('REL-04 dark canary evidence does not authorize website publication');
  }
  return { bytes, observedAt, sha256: expectedSha256 };
}
