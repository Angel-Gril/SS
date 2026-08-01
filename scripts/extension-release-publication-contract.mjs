import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { canonicalPublicHttpsOrigin } from './extension-release-contract.mjs';

export const PUBLICATION_SIGNATURE_ALGORITHM = 'Ed25519';
export const RELEASE_SIGNATURE_KIND = 'SS_ERP_EXTENSION_RELEASE_SIGNATURE';
export const DISTRIBUTION_RECEIPT_KIND = 'SS_ERP_EXTENSION_WEBSITE_DISTRIBUTION_RECEIPT';
export const DISTRIBUTION_CHANNEL = 'FIRST_PARTY_WEBSITE';
export const TRUSTED_KEYS_KIND = 'SS_ERP_EXTENSION_RELEASE_TRUSTED_KEYS';
export const RELEASE_SIGNATURE_DOMAIN = 'SS_ERP_EXTENSION_RELEASE_SIGNATURE_V1';
export const DISTRIBUTION_RECEIPT_DOMAIN = 'SS_ERP_EXTENSION_WEBSITE_DISTRIBUTION_RECEIPT_V1';
export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
export const GIT_COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
export const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
export const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u;
export const MAX_SIGNATURE_BYTES = 16_384;
export const MAX_RECEIPT_BYTES = 65_536;
export const MAX_LATEST_BYTES = 1_048_576;
export const MAX_KEYRING_BYTES = 65_536;

const SIGNATURE_KEYS = Object.freeze([
  'algorithm',
  'keyId',
  'kind',
  'releaseEvidenceFilename',
  'releaseEvidenceSha256',
  'schemaVersion',
  'signatureBase64',
  'signedAt',
]);
const SIGNATURE_PAYLOAD_KEYS = Object.freeze([
  'algorithm',
  'keyId',
  'kind',
  'releaseEvidenceFilename',
  'releaseEvidenceSha256',
  'schemaVersion',
  'signedAt',
]);
const TRUSTED_KEY_KEYS = Object.freeze(['algorithm', 'keyId', 'publicKeyBase64', 'status']);
const TRUSTED_KEYRING_KEYS = Object.freeze(['keys', 'kind', 'schemaVersion']);
const RECEIPT_TARGET_KEYS = Object.freeze([
  'bodySha256',
  'contentDisposition',
  'contentLength',
  'filename',
  'statusCode',
  'url',
  'xContentSha256',
]);
const RECEIPT_LATEST_KEYS = Object.freeze([
  'responseSha256',
  'statusCode',
  'signatureStatus',
  'url',
  'version',
  'gitCommit',
  'targets',
]);
const RECEIPT_KEYS = Object.freeze([
  'algorithm',
  'channel',
  'distributionOrigin',
  'kind',
  'keyId',
  'latest',
  'observedAt',
  'releaseEvidenceFilename',
  'releaseEvidenceSha256',
  'releaseSignatureFilename',
  'releaseSignatureSha256',
  'schemaVersion',
  'signatureBase64',
]);
const RECEIPT_PAYLOAD_KEYS = Object.freeze(RECEIPT_KEYS.filter((key) => key !== 'signatureBase64'));

function fail(message) {
  throw new Error(message);
}

function exactObject(value, expectedKeys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${field} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${field} has an invalid field set`);
  }
  return value;
}

function exactArray(value, field) {
  if (!Array.isArray(value)) fail(`${field} must be an array`);
  return value;
}

function canonicalString(value, field, pattern, maxLength = 4096) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength
    || value !== value.trim() || !pattern.test(value)) {
    fail(`${field} is invalid`);
  }
  return value;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function base64(value, field, expectedBytes) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096
    || !BASE64_PATTERN.test(value) || value.length % 4 !== 0) {
    fail(`${field} must be canonical base64`);
  }
  let bytes;
  try {
    bytes = Buffer.from(value, 'base64');
  } catch {
    fail(`${field} must be canonical base64`);
  }
  if (bytes.toString('base64') !== value || (expectedBytes !== undefined && bytes.length !== expectedBytes)) {
    fail(`${field} must be canonical base64`);
  }
  return value;
}

function timestamp(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail(`${field} must be a canonical UTC timestamp`);
  }
  return value;
}

function filename(value, field, suffix) {
  const parsed = canonicalString(value, field, /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u, 256);
  if (!parsed.endsWith(suffix) || parsed.includes('/') || parsed.includes('\\')) {
    fail(`${field} is invalid`);
  }
  return parsed;
}

function statusCode(value, field) {
  if (!Number.isSafeInteger(value) || value < 100 || value > 599) fail(`${field} is invalid`);
  return value;
}

function releaseVersion(value) {
  return canonicalString(
    value,
    'distribution receipt version',
    /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u,
    32,
  );
}

function publicOrigin(value, field) {
  return canonicalPublicHttpsOrigin(value, field);
}

export function publicOriginForPublication(value) {
  return publicOrigin(value, 'website distribution origin');
}

function releaseEvidenceFilename(value) {
  const parsed = filename(value, 'release evidence filename', '.release-evidence.json');
  const version = parsed.match(/^ss-erp-extension-(.+)\.release-evidence\.json$/u)?.[1];
  if (!version) fail('release evidence filename is invalid');
  return { filename: parsed, version: releaseVersion(version) };
}

function releaseSignatureFilename(value) {
  return filename(value, 'release signature filename', '.release-signature.json');
}

function parseSignaturePayload(value) {
  const parsed = exactObject(value, SIGNATURE_PAYLOAD_KEYS, 'release signature payload');
  if (parsed.schemaVersion !== 1 || parsed.kind !== RELEASE_SIGNATURE_KIND
    || parsed.algorithm !== PUBLICATION_SIGNATURE_ALGORITHM) {
    fail('release signature payload identity is invalid');
  }
  const evidence = releaseEvidenceFilename(parsed.releaseEvidenceFilename);
  if (parsed.releaseEvidenceSha256 !== String(parsed.releaseEvidenceSha256).toLowerCase()) {
    fail('release signature evidence digest must be lowercase');
  }
  return {
    schemaVersion: 1,
    kind: RELEASE_SIGNATURE_KIND,
    algorithm: PUBLICATION_SIGNATURE_ALGORITHM,
    keyId: canonicalString(parsed.keyId, 'release signature keyId', KEY_ID_PATTERN, 64),
    signedAt: timestamp(parsed.signedAt, 'release signature signedAt'),
    releaseEvidenceFilename: evidence.filename,
    releaseEvidenceSha256: canonicalString(
      parsed.releaseEvidenceSha256,
      'release signature evidence SHA-256',
      SHA256_PATTERN,
      64,
    ),
  };
}

export function parseReleaseSignature(value) {
  const parsed = exactObject(value, SIGNATURE_KEYS, 'release signature');
  const payload = parseSignaturePayload({
    ...Object.fromEntries(SIGNATURE_PAYLOAD_KEYS.map((key) => [key, parsed[key]])),
  });
  return {
    ...payload,
    signatureBase64: base64(parsed.signatureBase64, 'release signature signatureBase64', 64),
  };
}

export function canonicalReleaseSignatureJson(value) {
  return canonicalJson(parseReleaseSignature(value));
}

export function releaseSignaturePayload(value, evidenceBytes) {
  const signature = parseReleaseSignature({
    ...value,
    signatureBase64: Buffer.alloc(64).toString('base64'),
  });
  if (!Buffer.isBuffer(evidenceBytes) || sha256(evidenceBytes) !== signature.releaseEvidenceSha256) {
    fail('release signature evidence bytes do not match its digest');
  }
  const payload = Object.fromEntries(SIGNATURE_PAYLOAD_KEYS.map((key) => [key, signature[key]]));
  return Buffer.concat([
    Buffer.from(`${RELEASE_SIGNATURE_DOMAIN}\n`, 'utf8'),
    Buffer.from(canonicalJson(payload), 'utf8'),
    evidenceBytes,
  ]);
}

function parseTrustedKey(value, index) {
  const parsed = exactObject(value, TRUSTED_KEY_KEYS, `trusted key ${index}`);
  if (parsed.algorithm !== PUBLICATION_SIGNATURE_ALGORITHM) fail(`trusted key ${index} algorithm is invalid`);
  const keyId = canonicalString(parsed.keyId, `trusted key ${index} keyId`, KEY_ID_PATTERN, 64);
  if (parsed.status !== 'ACTIVE' && parsed.status !== 'REVOKED') {
    fail(`trusted key ${index} status is invalid`);
  }
  return {
    algorithm: PUBLICATION_SIGNATURE_ALGORITHM,
    keyId,
    publicKeyBase64: base64(parsed.publicKeyBase64, `trusted key ${index} publicKeyBase64`, 44),
    status: parsed.status,
  };
}

export function parseTrustedKeyring(value) {
  const parsed = exactObject(value, TRUSTED_KEYRING_KEYS, 'trusted keyring');
  if (parsed.schemaVersion !== 1 || parsed.kind !== TRUSTED_KEYS_KIND) {
    fail('trusted keyring identity is invalid');
  }
  const keys = exactArray(parsed.keys, 'trusted keyring keys').map(parseTrustedKey);
  const ids = keys.map((key) => key.keyId);
  if (new Set(ids).size !== ids.length || ids.some((id, index) => id !== [...ids].sort()[index])) {
    fail('trusted keyring keys must be unique and sorted by keyId');
  }
  return { schemaVersion: 1, kind: TRUSTED_KEYS_KIND, keys };
}

export function canonicalTrustedKeyringJson(value) {
  return canonicalJson(parseTrustedKeyring(value));
}

function parseReceiptTarget(value, target) {
  const parsed = exactObject(value, RECEIPT_TARGET_KEYS, `distribution receipt ${target} target`);
  const expectedFilename = `ss-erp-${target}-`;
  const targetFilename = filename(parsed.filename, `distribution receipt ${target} filename`, '.zip');
  if (!targetFilename.startsWith(expectedFilename)) fail(`distribution receipt ${target} filename is invalid`);
  const url = publicUrl(parsed.url, `distribution receipt ${target} URL`);
  return {
    url,
    statusCode: statusCode(parsed.statusCode, `distribution receipt ${target} statusCode`),
    filename: targetFilename,
    contentLength: positiveInteger(parsed.contentLength, `distribution receipt ${target} contentLength`),
    bodySha256: digest(parsed.bodySha256, `distribution receipt ${target} bodySha256`),
    xContentSha256: digest(parsed.xContentSha256, `distribution receipt ${target} xContentSha256`),
    contentDisposition: canonicalString(
      parsed.contentDisposition,
      `distribution receipt ${target} contentDisposition`,
      /^[\x20-\x7e]{1,1024}$/u,
      1024,
    ),
  };
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${field} must be a positive integer`);
  return value;
}

function digest(value, field) {
  return canonicalString(value, field, SHA256_PATTERN, 64);
}

function publicUrl(value, field) {
  if (typeof value !== 'string' || value.length > 4096 || value !== value.trim()) fail(`${field} is invalid`);
  let parsed;
  try { parsed = new URL(value); } catch { fail(`${field} is invalid`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash
    || parsed.toString() !== value || parsed.pathname === '/') {
    fail(`${field} must be one canonical HTTPS URL`);
  }
  return value;
}

function parseReceiptLatest(value) {
  const parsed = exactObject(value, RECEIPT_LATEST_KEYS, 'distribution receipt latest');
  const targets = exactObject(parsed.targets, ['cloud', 'local'], 'distribution receipt latest targets');
  return {
    url: publicUrl(parsed.url, 'distribution receipt latest URL'),
    statusCode: statusCode(parsed.statusCode, 'distribution receipt latest statusCode'),
    responseSha256: digest(parsed.responseSha256, 'distribution receipt latest responseSha256'),
    version: releaseVersion(parsed.version),
    gitCommit: canonicalString(parsed.gitCommit, 'distribution receipt latest gitCommit', GIT_COMMIT_PATTERN, 40),
    signatureStatus: parsed.signatureStatus === 'EXTERNAL_REQUIRED'
      ? 'EXTERNAL_REQUIRED'
      : fail('distribution receipt latest signatureStatus is invalid'),
    targets: {
      cloud: parseReceiptTarget(targets.cloud, 'cloud'),
      local: parseReceiptTarget(targets.local, 'local'),
    },
  };
}

function parseReceiptPayload(value) {
  const parsed = exactObject(value, RECEIPT_PAYLOAD_KEYS, 'distribution receipt payload');
  if (parsed.schemaVersion !== 1 || parsed.kind !== DISTRIBUTION_RECEIPT_KIND
    || parsed.algorithm !== PUBLICATION_SIGNATURE_ALGORITHM
    || parsed.channel !== DISTRIBUTION_CHANNEL) {
    fail('distribution receipt payload identity is invalid');
  }
  return {
    schemaVersion: 1,
    kind: DISTRIBUTION_RECEIPT_KIND,
    algorithm: PUBLICATION_SIGNATURE_ALGORITHM,
    channel: DISTRIBUTION_CHANNEL,
    keyId: canonicalString(parsed.keyId, 'distribution receipt keyId', KEY_ID_PATTERN, 64),
    observedAt: timestamp(parsed.observedAt, 'distribution receipt observedAt'),
    distributionOrigin: publicOrigin(parsed.distributionOrigin, 'distribution receipt origin'),
    releaseEvidenceFilename: releaseEvidenceFilename(parsed.releaseEvidenceFilename).filename,
    releaseEvidenceSha256: digest(parsed.releaseEvidenceSha256, 'distribution receipt evidence SHA-256'),
    releaseSignatureFilename: releaseSignatureFilename(parsed.releaseSignatureFilename),
    releaseSignatureSha256: digest(parsed.releaseSignatureSha256, 'distribution receipt signature SHA-256'),
    latest: parseReceiptLatest(parsed.latest),
  };
}

export function parseDistributionReceipt(value) {
  const parsed = exactObject(value, RECEIPT_KEYS, 'distribution receipt');
  return {
    ...parseReceiptPayload(Object.fromEntries(RECEIPT_PAYLOAD_KEYS.map((key) => [key, parsed[key]]))),
    signatureBase64: base64(parsed.signatureBase64, 'distribution receipt signatureBase64', 64),
  };
}

export function canonicalDistributionReceiptJson(value) {
  return canonicalJson(parseDistributionReceipt(value));
}

export function distributionReceiptPayload(value) {
  const receipt = parseDistributionReceipt({
    ...value,
    signatureBase64: Buffer.alloc(64).toString('base64'),
  });
  return Buffer.from(
    `${DISTRIBUTION_RECEIPT_DOMAIN}\n${canonicalJson(
      Object.fromEntries(RECEIPT_PAYLOAD_KEYS.map((key) => [key, receipt[key]])),
    )}`,
    'utf8',
  );
}

export function sidecarPath(evidencePath, suffix) {
  const absolute = path.resolve(evidencePath);
  if (!absolute.endsWith('.release-evidence.json')) fail('release evidence path must use the canonical filename');
  return absolute.slice(0, -'.release-evidence.json'.length) + suffix;
}

export function assertRealDirectoryTree(directory, field) {
  const absolute = path.resolve(directory);
  const root = path.parse(absolute).root;
  let current = root;
  const relative = path.relative(root, absolute);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const entry = lstatSync(current, { throwIfNoEntry: false });
    if (!entry?.isDirectory() || entry.isSymbolicLink()) {
      fail(`${field} must not traverse a symlink or reparse point`);
    }
  }
  return realpathSync.native(absolute);
}

export function assertPublicationOutputOutsideCandidate(evidencePath, outputPath, field) {
  const candidate = assertRealDirectoryTree(path.dirname(path.resolve(evidencePath)), 'release candidate');
  const outputParent = assertRealDirectoryTree(path.dirname(path.resolve(outputPath)), `${field} parent`);
  const relative = path.relative(candidate, outputParent);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    fail(`${field} must be outside the immutable four-file candidate directory`);
  }
}
