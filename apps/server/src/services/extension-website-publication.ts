import { createHash, createPublicKey, verify } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { validateRel04ReleaseBinding } from 'shared/rel04-release-evidence';
import {
  loadVerifiedExtensionReleaseSet,
  type VerifiedExtensionReleaseSet,
} from './extension-release-set.js';

const APPROVAL_KIND = 'SS_ERP_EXTENSION_WEBSITE_PUBLICATION_APPROVAL';
const APPROVAL_DOMAIN = 'SS_ERP_EXTENSION_WEBSITE_PUBLICATION_APPROVAL_V1';
const RELEASE_SIGNATURE_KIND = 'SS_ERP_EXTENSION_RELEASE_SIGNATURE';
const RELEASE_SIGNATURE_DOMAIN = 'SS_ERP_EXTENSION_RELEASE_SIGNATURE_V1';
const TRUSTED_KEYS_KIND = 'SS_ERP_EXTENSION_RELEASE_TRUSTED_KEYS';
const CHANNEL = 'FIRST_PARTY_WEBSITE';
const ALGORITHM = 'Ed25519';
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const GIT_COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const VERSION_PATTERN = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const BASENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u;
const MAX_APPROVAL_BYTES = 16_384;
const MAX_SIGNATURE_BYTES = 16_384;
const MAX_KEYRING_BYTES = 65_536;
const MAX_CANARY_BYTES = 256 * 1024;
const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const REL04_CHECK_IDS = [
  'deployment-and-publication-isolation',
  'default-off-policy',
  'hosted-route-regression',
  'publish-reconciliation-read',
  'device-pairing-active-lifecycle',
  'byok-disabled-path',
  'device-session-cleanup',
] as const;
const REL04_NO_SHOP_DARK_CHECK_IDS = [
  'deployment-and-publication-isolation',
  'default-off-policy',
  'hosted-route-regression',
  'publish-reconciliation-read',
] as const;
const REL04_PILOT_CHECK_IDS = [
  'deployment-and-publication-isolation',
  'restricted-pilot-policy',
  'hosted-route-readiness',
  'publish-reconciliation-read',
  'device-pairing-active-lifecycle',
  'byok-disabled-path',
  'device-session-cleanup',
] as const;
const REL04_REQUIRED_REQUEST_ROUTES = [
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
] as const;
const REL04_NO_SHOP_DARK_REQUEST_ROUTES = [
  'GET /ready',
  'GET /api/extensions/latest',
  'OPTIONS /api/extension-device/byok-media/readiness',
  'GET /api/admin/system-config/:key',
  'GET /api/ai-images/suites/readiness',
  'GET /api/shops',
] as const;

const APPROVAL_KEYS = [
  'algorithm', 'approvedAt', 'channel', 'darkCanaryFilename', 'darkCanarySha256',
  'distributionOrigin', 'gitCommit', 'keyId', 'kind', 'region',
  'releaseEvidenceFilename', 'releaseEvidenceSha256', 'releaseSignatureFilename',
  'releaseSignatureSha256', 'schemaVersion', 'signatureBase64', 'version',
] as const;
const APPROVAL_PAYLOAD_KEYS = APPROVAL_KEYS.filter((key) => key !== 'signatureBase64');
const RELEASE_SIGNATURE_KEYS = [
  'algorithm', 'keyId', 'kind', 'releaseEvidenceFilename', 'releaseEvidenceSha256',
  'schemaVersion', 'signatureBase64', 'signedAt',
] as const;
const RELEASE_SIGNATURE_PAYLOAD_KEYS = RELEASE_SIGNATURE_KEYS
  .filter((key) => key !== 'signatureBase64');

export const WEBSITE_PUBLICATION_POINTER_FILENAME =
  'current.website-publication-approval.json';

export interface WebsitePublicationApproval {
  schemaVersion: 1;
  kind: typeof APPROVAL_KIND;
  algorithm: typeof ALGORITHM;
  channel: typeof CHANNEL;
  keyId: string;
  approvedAt: string;
  region: 'COM' | 'CN';
  distributionOrigin: string;
  gitCommit: string;
  version: string;
  releaseEvidenceFilename: string;
  releaseEvidenceSha256: string;
  releaseSignatureFilename: string;
  releaseSignatureSha256: string;
  darkCanaryFilename: string;
  darkCanarySha256: string;
  signatureBase64: string;
}

interface TrustedKeyring {
  schemaVersion: 1;
  kind: typeof TRUSTED_KEYS_KIND;
  keys: Array<{
    algorithm: typeof ALGORITHM;
    keyId: string;
    publicKeyBase64: string;
    status: 'ACTIVE' | 'REVOKED';
  }>;
}

interface ReleaseSignature {
  schemaVersion: 1;
  kind: typeof RELEASE_SIGNATURE_KIND;
  algorithm: typeof ALGORITHM;
  keyId: string;
  signedAt: string;
  releaseEvidenceFilename: string;
  releaseEvidenceSha256: string;
  signatureBase64: string;
}

export interface PublishedExtensionRelease {
  approvalSha256: string;
  artifactSnapshotKey: string;
  approval: WebsitePublicationApproval;
  release: VerifiedExtensionReleaseSet;
}

function fail(message: string): never {
  throw new Error(message);
}

function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function exactObject(value: unknown, keys: readonly string[], label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} is invalid`);
  const parsed = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify([...keys].sort())) {
    fail(`${label} has an invalid field set`);
  }
  return parsed;
}

function canonicalString(value: unknown, pattern: RegExp, label: string, max = 4096) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max
    || value !== value.trim() || !pattern.test(value)) fail(`${label} is invalid`);
  return value;
}

function timestamp(value: unknown, label: string) {
  const parsed = canonicalString(
    value,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
    label,
    24,
  );
  if (Number.isNaN(Date.parse(parsed)) || new Date(parsed).toISOString() !== parsed) {
    fail(`${label} is invalid`);
  }
  return parsed;
}

function digest(value: unknown, label: string) {
  return canonicalString(value, SHA256_PATTERN, label, 64);
}

function basename(value: unknown, suffix: string, label: string) {
  const parsed = canonicalString(value, BASENAME_PATTERN, label, 256);
  if (!parsed.endsWith(suffix) || parsed.includes('/') || parsed.includes('\\')) {
    fail(`${label} is invalid`);
  }
  return parsed;
}

function base64(value: unknown, bytes: number, label: string) {
  const parsed = canonicalString(value, /^[A-Za-z0-9+/]*={0,2}$/u, label, 4096);
  const decoded = Buffer.from(parsed, 'base64');
  if (decoded.length !== bytes || decoded.toString('base64') !== parsed) fail(`${label} is invalid`);
  return parsed;
}

function parseApproval(value: unknown): WebsitePublicationApproval {
  const parsed = exactObject(value, APPROVAL_KEYS, 'website publication approval');
  if (parsed.schemaVersion !== 1 || parsed.kind !== APPROVAL_KIND
    || parsed.algorithm !== ALGORITHM || parsed.channel !== CHANNEL) {
    fail('website publication approval identity is invalid');
  }
  const version = canonicalString(parsed.version, VERSION_PATTERN, 'approval version', 32);
  const evidenceFilename = basename(
    parsed.releaseEvidenceFilename,
    '.release-evidence.json',
    'approval evidence filename',
  );
  if (evidenceFilename !== `ss-erp-extension-${version}.release-evidence.json`) {
    fail('website publication approval release identity is invalid');
  }
  const origin = canonicalString(parsed.distributionOrigin, /^https:\/\/[^/]+$/u, 'approval origin');
  let hostname: string;
  try {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash
      || (url.pathname !== '' && url.pathname !== '/')) fail('approval origin is invalid');
    hostname = url.hostname.toLowerCase();
  } catch {
    fail('approval origin is invalid');
  }
  const region = parsed.region === 'COM' || parsed.region === 'CN' ? parsed.region : fail('approval region is invalid');
  if ((region === 'COM' && !hostname.endsWith('.com'))
    || (region === 'CN' && !hostname.endsWith('.cn'))) {
    fail('approval region does not match its origin');
  }
  return {
    schemaVersion: 1,
    kind: APPROVAL_KIND,
    algorithm: ALGORITHM,
    channel: CHANNEL,
    keyId: canonicalString(parsed.keyId, KEY_ID_PATTERN, 'approval keyId', 64),
    approvedAt: timestamp(parsed.approvedAt, 'approval approvedAt'),
    region,
    distributionOrigin: origin,
    gitCommit: canonicalString(parsed.gitCommit, GIT_COMMIT_PATTERN, 'approval Git commit', 40),
    version,
    releaseEvidenceFilename: evidenceFilename,
    releaseEvidenceSha256: digest(parsed.releaseEvidenceSha256, 'approval evidence digest'),
    releaseSignatureFilename: basename(
      parsed.releaseSignatureFilename,
      '.release-signature.json',
      'approval release signature filename',
    ),
    releaseSignatureSha256: digest(parsed.releaseSignatureSha256, 'approval signature digest'),
    darkCanaryFilename: basename(parsed.darkCanaryFilename, '.json', 'approval canary filename'),
    darkCanarySha256: digest(parsed.darkCanarySha256, 'approval canary digest'),
    signatureBase64: base64(parsed.signatureBase64, 64, 'approval signature'),
  };
}

function parseReleaseSignature(value: unknown): ReleaseSignature {
  const parsed = exactObject(value, RELEASE_SIGNATURE_KEYS, 'extension release signature');
  if (parsed.schemaVersion !== 1 || parsed.kind !== RELEASE_SIGNATURE_KIND
    || parsed.algorithm !== ALGORITHM) fail('extension release signature identity is invalid');
  return {
    schemaVersion: 1,
    kind: RELEASE_SIGNATURE_KIND,
    algorithm: ALGORITHM,
    keyId: canonicalString(parsed.keyId, KEY_ID_PATTERN, 'release signature keyId', 64),
    signedAt: timestamp(parsed.signedAt, 'release signature signedAt'),
    releaseEvidenceFilename: basename(
      parsed.releaseEvidenceFilename,
      '.release-evidence.json',
      'release signature evidence filename',
    ),
    releaseEvidenceSha256: digest(parsed.releaseEvidenceSha256, 'release signature evidence digest'),
    signatureBase64: base64(parsed.signatureBase64, 64, 'release signature'),
  };
}

function parseKeyring(value: unknown): TrustedKeyring {
  const parsed = exactObject(value, ['keys', 'kind', 'schemaVersion'], 'trusted keyring');
  if (parsed.schemaVersion !== 1 || parsed.kind !== TRUSTED_KEYS_KIND || !Array.isArray(parsed.keys)) {
    fail('trusted keyring identity is invalid');
  }
  const keys = parsed.keys.map((entry, index) => {
    const key = exactObject(entry, ['algorithm', 'keyId', 'publicKeyBase64', 'status'], `trusted key ${index}`);
    if (key.algorithm !== ALGORITHM || (key.status !== 'ACTIVE' && key.status !== 'REVOKED')) {
      fail(`trusted key ${index} is invalid`);
    }
    const status = key.status === 'ACTIVE' ? 'ACTIVE' as const : 'REVOKED' as const;
    return {
      algorithm: 'Ed25519' as const,
      keyId: canonicalString(key.keyId, KEY_ID_PATTERN, `trusted key ${index} keyId`, 64),
      publicKeyBase64: base64(key.publicKeyBase64, 44, `trusted key ${index} public key`),
      status,
    };
  });
  const ids = keys.map((key) => key.keyId);
  if (new Set(ids).size !== ids.length
    || JSON.stringify(ids) !== JSON.stringify([...ids].sort())) fail('trusted keyring order is invalid');
  return { schemaVersion: 1, kind: TRUSTED_KEYS_KIND, keys };
}

function sameSnapshot(left: BigIntStats, right: BigIntStats) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
    && left.nlink === right.nlink && left.uid === right.uid && left.gid === right.gid
    && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function snapshotKey(snapshot: BigIntStats) {
  return [
    snapshot.dev,
    snapshot.ino,
    snapshot.mode,
    snapshot.nlink,
    snapshot.uid,
    snapshot.gid,
    snapshot.size,
    snapshot.mtimeNs,
    snapshot.ctimeNs,
  ].join(':');
}

async function secureFileSnapshot(
  file: string,
  maxBytes: number,
  label: string,
  ownerUid: number | null,
) {
  const absolute = path.resolve(file);
  const before = await lstat(absolute, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n
    || before.size < 1n || before.size > BigInt(maxBytes)
    || (process.platform !== 'win32' && ownerUid !== null
      && (before.uid !== BigInt(ownerUid) || (before.mode & 0o022n) !== 0n))) {
    fail(`${label} is missing or unsafe`);
  }
  const handle = await open(
    absolute,
    constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
  );
  try {
    const opened = await handle.stat({ bigint: true });
    const pathAfter = await lstat(absolute, { bigint: true });
    if (!sameSnapshot(before, opened) || !sameSnapshot(before, pathAfter)) {
      fail(`${label} changed while opening`);
    }
    return snapshotKey(before);
  } finally {
    await handle.close();
  }
}

async function secureFile(
  file: string,
  maxBytes: number,
  label: string,
  ownerUid: number | null,
) {
  const absolute = path.resolve(file);
  const before = await lstat(absolute, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n
    || before.size < 1n || before.size > BigInt(maxBytes)
    || (process.platform !== 'win32' && ownerUid !== null
      && (before.uid !== BigInt(ownerUid) || (before.mode & 0o022n) !== 0n))) {
    fail(`${label} is missing or unsafe`);
  }
  const handle = await open(
    absolute,
    constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
  );
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameSnapshot(before, opened)) fail(`${label} changed while opening`);
    const bytes = Buffer.allocUnsafe(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead < 1) fail(`${label} changed while reading`);
      offset += result.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(absolute, { bigint: true });
    if (!sameSnapshot(before, after) || !sameSnapshot(before, pathAfter)) {
      fail(`${label} changed while reading`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function secureDirectory(directory: string, ownerUid: number | null) {
  const absolute = path.resolve(directory);
  const root = path.parse(absolute).root;
  let current = root;
  for (const segment of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const entry = await lstat(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()
      || (process.platform !== 'win32' && ownerUid !== null
        && (entry.uid !== ownerUid || (entry.mode & 0o022) !== 0))) {
      fail('website publication directory tree is unsafe');
    }
  }
  if (await realpath(absolute) !== absolute) fail('website publication directory is not canonical');
  return absolute;
}

async function canonicalFile<T>(
  file: string,
  maxBytes: number,
  label: string,
  ownerUid: number | null,
  parser: (value: unknown) => T,
) {
  const bytes = await secureFile(file, maxBytes, label, ownerUid);
  const text = bytes.toString('utf8');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { fail(`${label} is not valid JSON`); }
  const value = parser(raw);
  if (text.charCodeAt(0) === 0xfeff || text.includes('\r') || text !== canonicalJson(value)) {
    fail(`${label} is not canonical JSON`);
  }
  return { bytes, value };
}

function publicKey(keyring: TrustedKeyring, keyId: string) {
  const trusted = keyring.keys.find((key) => key.keyId === keyId);
  if (!trusted || trusted.status !== 'ACTIVE') fail('website publication signing key is unavailable');
  const key = createPublicKey({
    key: Buffer.from(trusted.publicKeyBase64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  if (key.asymmetricKeyType !== 'ed25519') fail('website publication signing key is invalid');
  return key;
}

function approvalPayload(approval: WebsitePublicationApproval) {
  const payload = Object.fromEntries(APPROVAL_PAYLOAD_KEYS.map((key) => [key, approval[key]]));
  return Buffer.from(`${APPROVAL_DOMAIN}\n${canonicalJson(payload)}`, 'utf8');
}

function releaseSignaturePayload(signature: ReleaseSignature, evidenceBytes: Buffer) {
  const payload = Object.fromEntries(
    RELEASE_SIGNATURE_PAYLOAD_KEYS.map((key) => [key, signature[key]]),
  );
  return Buffer.concat([
    Buffer.from(`${RELEASE_SIGNATURE_DOMAIN}\n${canonicalJson(payload)}`, 'utf8'),
    evidenceBytes,
  ]);
}

function rel04Digest(value: unknown, label: string) {
  return canonicalString(value, SHA256_PATTERN, label, 64);
}

function rel04Evidence(checks: Array<Record<string, unknown>>, id: string) {
  const check = checks.find((candidate) => candidate.id === id);
  return exactObject(check?.evidence, Object.keys(
    check?.evidence && typeof check.evidence === 'object' && !Array.isArray(check.evidence)
      ? check.evidence : {},
  ), `REL-04 ${id} evidence`);
}

function identifierList(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    fail(`${label} is invalid`);
  }
  const result = value.map((item) => {
    if (typeof item !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(item)) {
      fail(`${label} is invalid`);
    }
    return item;
  });
  if (new Set(result).size !== result.length) fail(`${label} contains duplicates`);
  return result;
}

function validateRestrictedPilotPolicy(value: unknown, rollout: unknown) {
  const policy = exactObject(value, [
    'allowedOperations', 'deviceSessionIds', 'expectation', 'ownerUserIds',
    'rolloutRevision', 'shopIds', 'sourcePolicyRevision',
  ], 'REL-04 restricted pilot policy evidence');
  const ownerUserIds = identifierList(policy.ownerUserIds, 'REL-04 pilot ownerUserIds');
  const shopIds = identifierList(policy.shopIds, 'REL-04 pilot shopIds');
  const deviceSessionIds = identifierList(policy.deviceSessionIds, 'REL-04 pilot deviceSessionIds');
  const allowedOperations = policy.allowedOperations;
  if (policy.expectation !== 'hosted-pilot'
    || !Array.isArray(allowedOperations)
    || ![JSON.stringify(['IMAGE_TO_IMAGE', 'SUITE']),
      JSON.stringify(['IMAGE_TO_IMAGE', 'SUITE', 'IMAGE_TRANSLATE'])].includes(JSON.stringify(allowedOperations))
    || !Number.isSafeInteger(policy.rolloutRevision)
    || Number(policy.rolloutRevision) < 0
    || typeof policy.sourcePolicyRevision !== 'string'
    || policy.sourcePolicyRevision.trim() !== policy.sourcePolicyRevision
    || policy.sourcePolicyRevision.length < 1
    || policy.sourcePolicyRevision.length > 200) {
    fail('REL-04 restricted pilot scope is invalid');
  }
  const binding = exactObject(rollout, ['expectation', 'policySha256'], 'REL-04 rollout binding');
  if (binding.expectation !== 'hosted-pilot') fail('REL-04 rollout expectation is invalid');
  rel04Digest(binding.policySha256, 'REL-04 restricted pilot policy SHA-256');
  const policyBytes = Buffer.from(`${JSON.stringify({
    expectation: policy.expectation,
    ownerUserIds,
    shopIds,
    deviceSessionIds,
    rolloutRevision: policy.rolloutRevision,
    sourcePolicyRevision: policy.sourcePolicyRevision,
    allowedOperations,
  }, null, 2)}\n`, 'utf8');
  if (binding.policySha256 !== sha256(policyBytes)) {
    fail('REL-04 restricted pilot policy digest is invalid');
  }
  return { ownerUserIds, shopIds, deviceSessionIds, allowedOperations };
}

function validateCanary(
  value: unknown,
  approval: WebsitePublicationApproval,
  apiOrigin: string,
  releaseSignedAt: string,
) {
  const summary = exactObject(value, [
    'bindings', 'checks', 'cleanup', 'kind', 'observedAt', 'requestAudit', 'schemaVersion', 'status',
  ], 'REL-04 dark canary');
  const restrictedPilot = summary.schemaVersion === 3;
  const noShopDarkCanary = (summary.bindings as Record<string, unknown>)?.noShopDarkCanary === true;
  const bindings = exactObject(summary.bindings, [
    'apiOrigin', 'expectedGitCommit', 'extensionOrigin', 'publishReconciliation', 'shopIdHash',
    ...([2, 3].includes(Number(summary.schemaVersion)) ? ['release'] : []),
    ...(restrictedPilot ? ['rollout'] : []),
    ...(noShopDarkCanary ? ['noShopDarkCanary'] : []),
  ], 'REL-04 dark canary bindings');
  const reconciliation = exactObject(bindings.publishReconciliation, [
    'attemptIdHash', 'mode', 'notBefore', 'regressionEvidenceSha256', 'workflowIdHash',
  ], 'REL-04 publish reconciliation binding');
  rel04Digest(bindings.shopIdHash, 'REL-04 shop hash');
  if (![1, 2, 3].includes(Number(summary.schemaVersion))
    || summary.kind !== (restrictedPilot
      ? 'SS_ERP_REL04_RESTRICTED_HOSTED_PILOT_CANARY'
      : 'SS_ERP_REL04_DARK_CANARY')
    || summary.status !== 'PASS' || !bindings || bindings.expectedGitCommit !== approval.gitCommit
    || bindings.apiOrigin !== apiOrigin
    || typeof bindings.extensionOrigin !== 'string'
    || !/^chrome-extension:\/\/[a-p]{32}$/u.test(bindings.extensionOrigin)) {
    fail('REL-04 dark canary does not authorize this website publication');
  }
  if ([2, 3].includes(Number(summary.schemaVersion))) {
    validateRel04ReleaseBinding(
      bindings.release,
      { ...approval, apiOrigin },
      timestamp(summary.observedAt, 'REL-04 dark canary observedAt'),
      releaseSignedAt,
    );
  }
  if (noShopDarkCanary && (summary.schemaVersion !== 2
    || approval.region !== 'CN'
    || bindings.noShopDarkCanary !== true
    || bindings.shopIdHash !== sha256(Buffer.from('SS_ERP_REL04_CANARY_SHOP\0cn-dark-no-shop', 'utf8'))
    || reconciliation.mode !== 'TARGET_COMMIT_QA04_REGRESSION')) {
    fail('REL-04 CN no-shop dark binding is invalid');
  }
  if (reconciliation.mode === 'LIVE_ATTEMPT') {
    rel04Digest(reconciliation.workflowIdHash, 'REL-04 workflow hash');
    rel04Digest(reconciliation.attemptIdHash, 'REL-04 attempt hash');
    if (reconciliation.regressionEvidenceSha256 !== null) {
      fail('REL-04 live reconciliation binding is invalid');
    }
    timestamp(reconciliation.notBefore, 'REL-04 reconciliation notBefore');
  } else if (reconciliation.mode === 'TARGET_COMMIT_QA04_REGRESSION') {
    if (reconciliation.workflowIdHash !== null || reconciliation.attemptIdHash !== null
      || reconciliation.notBefore !== null) {
      fail('REL-04 regression reconciliation binding is invalid');
    }
    rel04Digest(reconciliation.regressionEvidenceSha256, 'REL-04 regression evidence SHA-256');
  } else {
    fail('REL-04 reconciliation mode is invalid');
  }

  const expectedCheckIds = noShopDarkCanary ? REL04_NO_SHOP_DARK_CHECK_IDS
    : (restrictedPilot ? REL04_PILOT_CHECK_IDS : REL04_CHECK_IDS);
  if (!Array.isArray(summary.checks) || summary.checks.length !== expectedCheckIds.length) {
    fail('REL-04 dark canary check set is incomplete');
  }
  const checks = summary.checks.map((check, index) => exactObject(
    check,
    ['evidence', 'id', 'status'],
    `REL-04 dark canary check ${index}`,
  ));
  if (JSON.stringify(checks.map((check) => check.id)) !== JSON.stringify(expectedCheckIds)
    || checks.some((check) => check.status !== 'PASS')) {
    fail('REL-04 dark canary check set is invalid');
  }

  const deployment = exactObject(rel04Evidence(checks, REL04_CHECK_IDS[0]), [
    'deployedCandidatePublic', 'deployedGitCommit', 'existingPublication',
    'extensionCorsPreflight',
  ], 'REL-04 deployment isolation evidence');
  if (deployment.deployedGitCommit !== approval.gitCommit
    || deployment.deployedCandidatePublic !== false
    || deployment.extensionCorsPreflight !== true) {
    fail('REL-04 deployment isolation evidence is invalid');
  }
  if (deployment.existingPublication !== null) {
    const existing = exactObject(deployment.existingPublication, [
      'gitCommit', 'publicationApprovalSha256', 'targets', 'version',
    ], 'REL-04 existing website publication');
    canonicalString(existing.gitCommit, GIT_COMMIT_PATTERN, 'REL-04 existing Git commit', 40);
    rel04Digest(existing.publicationApprovalSha256, 'REL-04 existing approval SHA-256');
    canonicalString(existing.version, VERSION_PATTERN, 'REL-04 existing version', 32);
    const targets = exactObject(existing.targets, ['cloud', 'local'], 'REL-04 existing targets');
    for (const target of ['cloud', 'local'] as const) {
      const artifact = exactObject(targets[target], ['filename', 'path', 'sha256'], `REL-04 ${target} target`);
      rel04Digest(artifact.sha256, `REL-04 ${target} SHA-256`);
      if (artifact.filename !== `ss-erp-${target}-${existing.version}.zip`
        || artifact.path !== `/api/extensions/download/${target}/${existing.version}/${artifact.sha256}`) {
        fail(`REL-04 ${target} target is invalid`);
      }
    }
  }

  if (restrictedPilot) {
    validateRestrictedPilotPolicy(
      rel04Evidence(checks, REL04_PILOT_CHECK_IDS[1]),
      bindings.rollout,
    );
    const hostedReady = exactObject(rel04Evidence(checks, REL04_PILOT_CHECK_IDS[2]), [
      'providerDispatchMethodUsed', 'ready', 'reasonCode', 'routeReachable',
      'suiteEnabled', 'webMediaEnabled', 'workflowEnabled',
    ], 'REL-04 hosted readiness evidence');
    if (hostedReady.routeReachable !== true || hostedReady.providerDispatchMethodUsed !== false
      || hostedReady.suiteEnabled !== true || hostedReady.workflowEnabled !== true
      || hostedReady.webMediaEnabled !== true || hostedReady.ready !== true
      || hostedReady.reasonCode !== 'READY') {
      fail('REL-04 hosted readiness evidence is invalid');
    }
  }

  if (!restrictedPilot) {
    const policy = exactObject(rel04Evidence(checks, REL04_CHECK_IDS[1]), [
      'extensionByok', 'extensionWorkbench', 'fullEdit', 'imageToImage', 'imageTranslation',
      'inpaint', 'legacyGeneration', 'master', 'ozonPublisher', 'policy', 'suite', 'webMedia',
    ], 'REL-04 default-off policy evidence');
    for (const key of [
      'extensionWorkbench', 'fullEdit', 'imageToImage', 'inpaint',
      'master', 'ozonPublisher', 'suite', 'webMedia',
    ]) {
      if (policy[key] !== 'absent' && policy[key] !== 'false') {
        fail(`REL-04 default-off policy ${key} is invalid`);
      }
    }
    const extensionByok = exactObject(policy.extensionByok, [
      'expectation', 'generation', 'hostedAi', 'ingest', 'policy', 'publish',
    ], 'REL-04 extension BYOK policy');
    if (extensionByok.expectation !== 'off'
      || !['false', 'absent(default:false)'].includes(String(extensionByok.hostedAi))
      || !['false', 'absent(default:false)'].includes(String(extensionByok.generation))
      || !['false', 'absent(default:false)'].includes(String(extensionByok.ingest))
      || !['false', 'absent(default:false)'].includes(String(extensionByok.publish))
      || ![
        'absent(default:off)',
        'extension-byok-admin-policy/v1:revision:0,mode:off',
      ].includes(String(extensionByok.policy))) {
      fail('REL-04 extension BYOK policy is not dark');
    }
    if (typeof policy.legacyGeneration !== 'string'
      || !policy.legacyGeneration.endsWith('/disabled')
      || typeof policy.imageTranslation !== 'string'
      || !policy.imageTranslation.endsWith('/disabled')
      || typeof policy.policy !== 'string'
      || (policy.policy !== 'absent'
        && !/^revision:[0-9]+,tenantIds:0$/u.test(policy.policy))) {
      fail('REL-04 default-off Provider or rollout policy is invalid');
    }
    const hosted = exactObject(rel04Evidence(checks, REL04_CHECK_IDS[2]), [
      'providerDispatchMethodUsed', 'reasonCode', 'routeReachable', 'suiteEnabled', 'workflowEnabled',
    ], 'REL-04 hosted regression evidence');
    if (hosted.routeReachable !== true || hosted.providerDispatchMethodUsed !== false
      || hosted.suiteEnabled !== false || hosted.workflowEnabled !== false
      || hosted.reasonCode !== 'AI_MEDIA_SUITE_DISABLED') {
      fail('REL-04 hosted regression evidence is invalid');
    }
  }

  const observedAt = timestamp(summary.observedAt, 'REL-04 dark canary observedAt');
  if (noShopDarkCanary) {
    const evidence = exactObject(rel04Evidence(checks, REL04_NO_SHOP_DARK_CHECK_IDS[3]), [
      'mode', 'regressionEvidenceSha256', 'shopInventoryCount',
      'publisherCapabilityChecked', 'ozonMutationRequestSentByCanary',
    ], 'REL-04 CN no-shop dark evidence');
    if (evidence.mode !== 'TARGET_COMMIT_QA04_REGRESSION'
      || evidence.regressionEvidenceSha256 !== reconciliation.regressionEvidenceSha256
      || evidence.shopInventoryCount !== 0
      || evidence.publisherCapabilityChecked !== false
      || evidence.ozonMutationRequestSentByCanary !== false) {
      fail('REL-04 CN no-shop dark evidence is invalid');
    }
  } else if (reconciliation.mode === 'LIVE_ATTEMPT') {
    const reconciliationEvidence = exactObject(
      rel04Evidence(checks, restrictedPilot ? REL04_PILOT_CHECK_IDS[3] : REL04_CHECK_IDS[3]),
      [
        'attemptIdHash', 'completedAt', 'lastReconciledAt', 'mode', 'notBefore',
        'ozonMutationRequestSentByCanary', 'reconcileAttemptCount', 'reconciliationState',
        'state', 'stateVersion', 'workflowIdHash',
      ],
      'REL-04 live reconciliation evidence',
    );
    const lastReconciledAt = timestamp(
      reconciliationEvidence.lastReconciledAt,
      'REL-04 lastReconciledAt',
    );
    const completedAt = timestamp(
      reconciliationEvidence.completedAt,
      'REL-04 completedAt',
    );
    if (reconciliationEvidence.mode !== reconciliation.mode
      || reconciliationEvidence.workflowIdHash !== reconciliation.workflowIdHash
      || reconciliationEvidence.attemptIdHash !== reconciliation.attemptIdHash
      || reconciliationEvidence.notBefore !== reconciliation.notBefore
      || reconciliationEvidence.state !== 'SUBMITTED'
      || reconciliationEvidence.reconciliationState !== 'SUCCEEDED'
      || !Number.isSafeInteger(reconciliationEvidence.stateVersion)
      || Number(reconciliationEvidence.stateVersion) < 1
      || !Number.isSafeInteger(reconciliationEvidence.reconcileAttemptCount)
      || Number(reconciliationEvidence.reconcileAttemptCount) < 1
      || reconciliationEvidence.ozonMutationRequestSentByCanary !== false
      || Date.parse(lastReconciledAt) < Date.parse(String(reconciliation.notBefore))
      || Date.parse(completedAt) < Date.parse(lastReconciledAt)
      || Date.parse(completedAt) > Date.parse(observedAt)) {
      fail('REL-04 live publish reconciliation evidence is invalid');
    }
  } else {
    const reconciliationEvidence = exactObject(
      rel04Evidence(checks, restrictedPilot ? REL04_PILOT_CHECK_IDS[3] : REL04_CHECK_IDS[3]),
      [
        'capabilityEnabled', 'capabilityLegacyAllowed', 'capabilityReason',
        'capabilityRevision', 'liveAttemptRead', 'mode', 'ozonMutationRequestSentByCanary',
        'regressionEvidenceSha256',
      ],
      'REL-04 regression reconciliation evidence',
    );
    if (reconciliationEvidence.mode !== reconciliation.mode
      || reconciliationEvidence.liveAttemptRead !== false
      || reconciliationEvidence.regressionEvidenceSha256
        !== reconciliation.regressionEvidenceSha256
      || reconciliationEvidence.capabilityEnabled !== false
      || typeof reconciliationEvidence.capabilityReason !== 'string'
      || reconciliationEvidence.capabilityReason.length < 1
      || reconciliationEvidence.capabilityReason.length > 200
      || reconciliationEvidence.capabilityReason
        !== reconciliationEvidence.capabilityReason.trim()
      || typeof reconciliationEvidence.capabilityRevision !== 'string'
      || reconciliationEvidence.capabilityRevision.length < 1
      || reconciliationEvidence.capabilityRevision.length > 200
      || reconciliationEvidence.capabilityRevision
        !== reconciliationEvidence.capabilityRevision.trim()
      || typeof reconciliationEvidence.capabilityLegacyAllowed !== 'boolean'
      || reconciliationEvidence.ozonMutationRequestSentByCanary !== false) {
      fail('REL-04 regression publish reconciliation evidence is invalid');
    }
  }

  if (!noShopDarkCanary) {
    const lifecycle = exactObject(rel04Evidence(checks, restrictedPilot
      ? REL04_PILOT_CHECK_IDS[4] : REL04_CHECK_IDS[4]), [
      'authorizedShopIdHash', 'deploymentIdHash', 'deviceIdHash', 'refreshRotated', 'sessionIdHash',
    ], 'REL-04 device lifecycle evidence');
    for (const key of ['authorizedShopIdHash', 'deploymentIdHash', 'deviceIdHash', 'sessionIdHash']) {
      rel04Digest(lifecycle[key], `REL-04 ${key}`);
    }
    if (lifecycle.refreshRotated !== true) fail('REL-04 device refresh did not rotate');

    const disabled = exactObject(rel04Evidence(checks, restrictedPilot
      ? REL04_PILOT_CHECK_IDS[5] : REL04_CHECK_IDS[5]), [
      'erpIngestRequestSentByCanary', 'errorCode', 'providerRequestSentByCanary',
      'rejectedBeforeExecutionIntent', 'statusCode',
    ], 'REL-04 BYOK disabled evidence');
    if (disabled.rejectedBeforeExecutionIntent !== true
      || disabled.providerRequestSentByCanary !== false
      || disabled.erpIngestRequestSentByCanary !== false
      || disabled.statusCode !== 409 || disabled.errorCode !== 'byok_readiness_not_ready') {
      fail('REL-04 BYOK disabled evidence is invalid');
    }

    const cleanupCheck = exactObject(rel04Evidence(checks, restrictedPilot
      ? REL04_PILOT_CHECK_IDS[6] : REL04_CHECK_IDS[6]), [
      'action', 'revokedTokenRejected', 'sessionIdHash',
    ], 'REL-04 device cleanup evidence');
    rel04Digest(cleanupCheck.sessionIdHash, 'REL-04 cleanup session hash');
    if ((cleanupCheck.action === 'OWNER_REVOKED'
        && cleanupCheck.revokedTokenRejected !== true)
      || (cleanupCheck.action === 'OWNER_RECOVERED_AND_REVOKED'
        && cleanupCheck.revokedTokenRejected !== false)
      || !['OWNER_REVOKED', 'OWNER_RECOVERED_AND_REVOKED']
        .includes(String(cleanupCheck.action))) {
      fail('REL-04 device cleanup evidence is invalid');
    }
  }

  const requestAudit = exactObject(summary.requestAudit, [
    'credentialsMode', 'erpIngestSent', 'ozonMutationSent', 'providerDispatchSent',
    'redirectsAllowed', 'requests', 'timeoutMs',
  ], 'REL-04 request audit');
  if (requestAudit.timeoutMs !== 15_000 || requestAudit.redirectsAllowed !== false
    || requestAudit.credentialsMode !== 'omit'
    || requestAudit.providerDispatchSent !== false || requestAudit.erpIngestSent !== false
    || requestAudit.ozonMutationSent !== false || !Array.isArray(requestAudit.requests)
    || requestAudit.requests.length < 1 || requestAudit.requests.length > 128) {
    fail('REL-04 request audit is invalid');
  }
  const requiredRoutes = noShopDarkCanary ? new Set<string>(REL04_NO_SHOP_DARK_REQUEST_ROUTES)
    : reconciliation.mode === 'LIVE_ATTEMPT'
    ? new Set<string>([
        ...REL04_REQUIRED_REQUEST_ROUTES,
        'GET /api/source-listing-workflows/:workflowId/publish-attempts/:attemptId',
      ])
    : new Set<string>(REL04_REQUIRED_REQUEST_ROUTES);
  const routes = new Set(requestAudit.requests.map((request, index) => {
    const row = exactObject(request, ['method', 'route', 'statusCode'], `REL-04 request ${index}`);
    if (typeof row.route !== 'string' || typeof row.method !== 'string'
      || !Number.isSafeInteger(row.statusCode)
      || Number(row.statusCode) < 100 || Number(row.statusCode) > 599) {
      fail(`REL-04 request ${index} is invalid`);
    }
    const separator = row.route.indexOf(' ');
    if (separator < 1 || row.method !== row.route.slice(0, separator)
      || !requiredRoutes.has(row.route)) {
      fail(`REL-04 request ${index} is not allowlisted`);
    }
    return row.route;
  }));
  if ([...requiredRoutes].some((route) => !routes.has(route))) {
    fail('REL-04 request audit is incomplete');
  }

  const cleanup = exactObject(summary.cleanup, ['completed', 'errorCode', 'required'], 'REL-04 cleanup');
  if (cleanup.completed !== true || cleanup.errorCode !== null
    || (noShopDarkCanary ? cleanup.required !== false : cleanup.required !== true)) {
    fail('REL-04 cleanup evidence is invalid');
  }
  if (Date.parse(observedAt) > Date.parse(approval.approvedAt)) {
    fail('REL-04 dark canary postdates website publication approval');
  }
  return summary;
}

export async function loadPublishedExtensionRelease(input: {
  publicationRoot: string;
  keyringPath: string;
  expectedDistributionOrigin: string;
  expectedRegion: 'COM' | 'CN';
  trustedOwnerUid?: number | null;
}): Promise<PublishedExtensionRelease> {
  const ownerUid = input.trustedOwnerUid === undefined ? null : input.trustedOwnerUid;
  const publicationRoot = await secureDirectory(input.publicationRoot, ownerUid);
  const pointerFile = await canonicalFile(
    path.join(publicationRoot, WEBSITE_PUBLICATION_POINTER_FILENAME),
    MAX_APPROVAL_BYTES,
    'website publication pointer',
    ownerUid,
    parseApproval,
  );
  const approval = pointerFile.value;
  if (approval.distributionOrigin !== input.expectedDistributionOrigin
    || approval.region !== input.expectedRegion) {
    fail('website publication approval does not match this deployment region');
  }
  const approvalSha256 = sha256(pointerFile.bytes);
  const keyringFile = await canonicalFile(
    input.keyringPath,
    MAX_KEYRING_BYTES,
    'extension release trusted keyring',
    ownerUid,
    parseKeyring,
  );
  const approvalKey = publicKey(keyringFile.value, approval.keyId);
  if (!verify(
    null,
    approvalPayload(approval),
    approvalKey,
    Buffer.from(approval.signatureBase64, 'base64'),
  )) fail('website publication approval signature is invalid');

  const bundleRoot = await secureDirectory(
    path.join(publicationRoot, 'bundles', approvalSha256),
    ownerUid,
  );
  const candidateRoot = await secureDirectory(path.join(bundleRoot, 'candidate'), ownerUid);
  const evidenceRoot = await secureDirectory(path.join(bundleRoot, 'publication'), ownerUid);
  const bundleEntries = (await readdir(bundleRoot)).sort();
  if (JSON.stringify(bundleEntries) !== JSON.stringify(['DEPLOYED_COMMIT', 'candidate', 'publication'])) {
    fail('website publication bundle has an invalid file set');
  }
  const approvalCopy = await secureFile(
    path.join(
      evidenceRoot,
      `ss-erp-extension-${approval.version}.website-publication-approval.json`,
    ),
    MAX_APPROVAL_BYTES,
    'website publication approval copy',
    ownerUid,
  );
  if (!approvalCopy.equals(pointerFile.bytes)) fail('website publication approval copy is invalid');
  const deployedCommit = (await secureFile(
    path.join(bundleRoot, 'DEPLOYED_COMMIT'),
    128,
    'website publication deployed commit',
    ownerUid,
  )).toString('utf8');
  if (deployedCommit !== `${approval.gitCommit}\n`) fail('website publication commit is invalid');

  const release = await loadVerifiedExtensionReleaseSet({
    buildRoot: candidateRoot,
    deployedCommitPath: path.join(bundleRoot, 'DEPLOYED_COMMIT'),
    requireDeployedCommit: true,
    expectedEvidenceFilename: approval.releaseEvidenceFilename,
    requireExactFiles: true,
  });
  if (release.gitCommit !== approval.gitCommit || release.version !== approval.version
    || release.expectedOrigins.api !== approval.distributionOrigin
    || release.releaseEvidenceSha256 !== approval.releaseEvidenceSha256) {
    fail('website publication approval does not match release evidence');
  }
  const artifactSnapshots: string[] = [];
  for (const entry of (await readdir(candidateRoot)).sort()) {
    const maxBytes = entry.endsWith('.zip') ? MAX_ZIP_BYTES
      : entry.endsWith('.release-evidence.json') ? 65_536 : 4096;
    const entryPath = path.join(candidateRoot, entry);
    if (entry.endsWith('.zip')) {
      artifactSnapshots.push(
        `${entry}:${await secureFileSnapshot(
          entryPath,
          maxBytes,
          `website publication ${entry}`,
          ownerUid,
        )}`,
      );
    } else {
      await secureFile(entryPath, maxBytes, `website publication ${entry}`, ownerUid);
    }
  }
  if (artifactSnapshots.length !== 2) fail('website publication artifact set is invalid');
  const artifactSnapshotKey = sha256(Buffer.from(artifactSnapshots.join('\n'), 'utf8'));

  const publicationEntries = (await readdir(evidenceRoot)).sort();
  const expectedPublicationEntries = [
    approval.darkCanaryFilename,
    approval.releaseSignatureFilename,
    `ss-erp-extension-${approval.version}.website-publication-approval.json`,
  ].sort();
  if (JSON.stringify(publicationEntries) !== JSON.stringify(expectedPublicationEntries)) {
    fail('website publication evidence bundle has an invalid file set');
  }
  const evidenceBytes = await secureFile(
    path.join(candidateRoot, approval.releaseEvidenceFilename),
    65_536,
    'website publication release evidence',
    ownerUid,
  );
  const releaseSignatureFile = await canonicalFile(
    path.join(evidenceRoot, approval.releaseSignatureFilename),
    MAX_SIGNATURE_BYTES,
    'extension release signature',
    ownerUid,
    parseReleaseSignature,
  );
  const releaseSignature = releaseSignatureFile.value;
  if (sha256(releaseSignatureFile.bytes) !== approval.releaseSignatureSha256
    || releaseSignature.keyId !== approval.keyId
    || Date.parse(approval.approvedAt) < Date.parse(releaseSignature.signedAt)
    || releaseSignature.releaseEvidenceFilename !== approval.releaseEvidenceFilename
    || releaseSignature.releaseEvidenceSha256 !== approval.releaseEvidenceSha256
    || !verify(
      null,
      releaseSignaturePayload(releaseSignature, evidenceBytes),
      publicKey(keyringFile.value, releaseSignature.keyId),
      Buffer.from(releaseSignature.signatureBase64, 'base64'),
    )) {
    fail('extension release signature does not match website publication approval');
  }
  const canaryFile = await canonicalFile(
    path.join(evidenceRoot, approval.darkCanaryFilename),
    MAX_CANARY_BYTES,
    'REL-04 dark canary evidence',
    ownerUid,
    (value) => validateCanary(value, approval, release.expectedOrigins.api, releaseSignature.signedAt),
  );
  const canaryObservedAt = timestamp(
    canaryFile.value.observedAt,
    'REL-04 dark canary observedAt',
  );
  if (sha256(canaryFile.bytes) !== approval.darkCanarySha256
    || Date.parse(canaryObservedAt) < Date.parse(releaseSignature.signedAt)) {
    fail('REL-04 dark canary evidence does not match website publication approval');
  }
  return { approvalSha256, artifactSnapshotKey, approval, release };
}
