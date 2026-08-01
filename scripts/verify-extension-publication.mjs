#!/usr/bin/env node
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
import { pathToFileURL } from 'node:url';
import {
  MAX_KEYRING_BYTES,
  MAX_RECEIPT_BYTES,
  MAX_SIGNATURE_BYTES,
  canonicalDistributionReceiptJson,
  canonicalReleaseSignatureJson,
  canonicalTrustedKeyringJson,
  distributionReceiptPayload,
  parseDistributionReceipt,
  parseReleaseSignature,
  parseTrustedKeyring,
  releaseSignaturePayload,
  sha256,
} from './extension-release-publication-contract.mjs';
import {
  canonicalExtensionReleaseEvidenceJson,
  parseExtensionReleaseEvidence,
} from './extension-release-contract.mjs';

const MAX_EVIDENCE_BYTES = 65_536;
const MAX_CHECKSUM_BYTES = 4096;
const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const MAX_RECEIPT_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const repoRoot = path.resolve(import.meta.dirname, '..');
const trustedKeyringPath = path.join(repoRoot, 'config/extension-release-trusted-keys.json');
const args = process.argv.slice(2);

function fail(message) {
  throw new Error(message);
}

function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return '';
  const value = args[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} requires a value`);
  return value;
}

function assertArguments() {
  const allowed = new Set(['--evidence', '--signature', '--receipt', '--keyring']);
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index]) || seen.has(args[index])
      || !args[index + 1] || args[index + 1].startsWith('--')) {
      fail('unknown or malformed publication verification option');
    }
    seen.add(args[index]);
  }
  for (const required of allowed) if (!option(required)) fail(`${required} is required`);
}

function cliTrustedKeyring(file) {
  const absolute = path.resolve(file);
  if (path.relative(trustedKeyringPath, absolute) !== '') {
    fail('--keyring must be the repository trusted keyring');
  }
  return trustedKeyringPath;
}

function readRegularFile(file, maxBytes, field) {
  const absolute = path.resolve(file);
  const entry = lstatSync(absolute, { throwIfNoEntry: false });
  if (!entry?.isFile() || entry.isSymbolicLink() || entry.size < 1 || entry.size > maxBytes) {
    fail(`${field} is missing, unsafe, or too large`);
  }
  let descriptor = null;
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > BigInt(maxBytes)) {
      fail(`${field} is missing or too large`);
    }
    const size = Number(before.size);
    const bytes = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size) {
      const count = readSync(descriptor, bytes, offset, size - offset, offset);
      if (count < 1) fail(`${field} changed while it was being read`);
      offset += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      fail(`${field} changed while it was being read`);
    }
    return bytes;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function readCanonical(file, parser, canonicalizer, maxBytes, field) {
  const bytes = readRegularFile(file, maxBytes, field);
  const text = bytes.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff || text.includes('\r')) fail(`${field} must be canonical UTF-8 JSON`);
  let raw;
  try { raw = JSON.parse(text); } catch { fail(`${field} is not valid JSON`); }
  const value = parser(raw);
  if (text !== canonicalizer(value)) fail(`${field} is not canonical JSON`);
  return { bytes, value };
}

function activeKey(keyring, keyId) {
  const key = keyring.keys.find((candidate) => candidate.keyId === keyId);
  if (!key || key.status !== 'ACTIVE') fail(`trusted Ed25519 key is unavailable: ${keyId}`);
  let publicKey;
  try {
    publicKey = createPublicKey({
      key: Buffer.from(key.publicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
  } catch {
    fail(`trusted Ed25519 public key is invalid: ${keyId}`);
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') fail(`trusted public key is not Ed25519: ${keyId}`);
  return publicKey;
}

function exactDownloadUrl(origin, target, version, digest) {
  return `${origin}/api/extensions/download/${target}/${version}/${digest}`;
}

export function verifyExtensionPublication({
  evidencePath,
  signaturePath,
  receiptPath,
  keyringPath,
  now = new Date(),
}) {
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) fail('publication verification now must be a valid Date');
  const evidenceFile = readCanonical(
    evidencePath,
    parseExtensionReleaseEvidence,
    canonicalExtensionReleaseEvidenceJson,
    MAX_EVIDENCE_BYTES,
    'release evidence',
  );
  const signatureFile = readCanonical(
    signaturePath,
    parseReleaseSignature,
    canonicalReleaseSignatureJson,
    MAX_SIGNATURE_BYTES,
    'release signature',
  );
  const receiptFile = readCanonical(
    receiptPath,
    parseDistributionReceipt,
    canonicalDistributionReceiptJson,
    MAX_RECEIPT_BYTES,
    'distribution receipt',
  );
  const keyringFile = readCanonical(
    keyringPath,
    parseTrustedKeyring,
    canonicalTrustedKeyringJson,
    MAX_KEYRING_BYTES,
    'trusted keyring',
  );
  const evidence = evidenceFile.value;
  const signature = signatureFile.value;
  const receipt = receiptFile.value;
  if (evidence.signature.status !== 'EXTERNAL_REQUIRED') fail('release is not an external publication candidate');
  const expectedEvidenceFilename = `ss-erp-extension-${evidence.version}.release-evidence.json`;
  const expectedSignatureFilename = `ss-erp-extension-${evidence.version}.release-signature.json`;
  const expectedReceiptFilename = `ss-erp-extension-${evidence.version}.distribution-receipt.json`;
  if (path.basename(evidencePath) !== expectedEvidenceFilename
    || path.basename(signaturePath) !== expectedSignatureFilename
    || path.basename(receiptPath) !== expectedReceiptFilename
    || signature.releaseEvidenceFilename !== expectedEvidenceFilename
    || signature.releaseEvidenceSha256 !== sha256(evidenceFile.bytes)) {
    fail('release signature identity does not match release evidence');
  }
  const releaseKey = activeKey(keyringFile.value, signature.keyId);
  if (!verify(
    null,
    releaseSignaturePayload(signature, evidenceFile.bytes),
    releaseKey,
    Buffer.from(signature.signatureBase64, 'base64'),
  )) {
    fail('release signature verification failed');
  }
  if (receipt.keyId !== signature.keyId
    || receipt.releaseEvidenceFilename !== expectedEvidenceFilename
    || receipt.releaseEvidenceSha256 !== sha256(evidenceFile.bytes)
    || receipt.releaseSignatureFilename !== expectedSignatureFilename
    || receipt.releaseSignatureSha256 !== sha256(signatureFile.bytes)) {
    fail('distribution receipt is not bound to the signed release');
  }
  if (Date.parse(receipt.observedAt) < Date.parse(signature.signedAt)) {
    fail('distribution receipt predates the release signature');
  }
  const receiptAge = nowMs - Date.parse(receipt.observedAt);
  if (receiptAge < -MAX_CLOCK_SKEW_MS || receiptAge > MAX_RECEIPT_AGE_MS) {
    fail('distribution receipt is stale or too far in the future');
  }
  if (!verify(
    null,
    distributionReceiptPayload(receipt),
    releaseKey,
    Buffer.from(receipt.signatureBase64, 'base64'),
  )) {
    fail('distribution receipt signature verification failed');
  }
  if (receipt.latest.statusCode !== 200
    || receipt.distributionOrigin !== evidence.expectedOrigins.api
    || receipt.latest.version !== evidence.version
    || receipt.latest.gitCommit !== evidence.gitCommit
    || receipt.latest.signatureStatus !== 'EXTERNAL_REQUIRED'
    || receipt.latest.url !== `${receipt.distributionOrigin}/api/extensions/latest`) {
    fail('distribution receipt latest observation does not match release evidence');
  }
  const root = path.dirname(path.resolve(evidencePath));
  const expectedChecksum = ['cloud', 'local'].map((target) => {
    const artifact = evidence.artifacts[target];
    const zipBytes = readRegularFile(
      path.join(root, artifact.filename),
      MAX_ZIP_BYTES,
      `${target} release archive`,
    );
    if (sha256(zipBytes) !== artifact.zipSha256) fail(`${target} release archive SHA-256 mismatch`);
    const observed = receipt.latest.targets[target];
    if (observed.statusCode !== 200
      || observed.filename !== artifact.filename
      || observed.bodySha256 !== artifact.zipSha256
      || observed.xContentSha256 !== artifact.zipSha256
      || observed.contentLength !== zipBytes.length
      || observed.contentDisposition !== `attachment; filename="${artifact.filename}"`
      || observed.url !== exactDownloadUrl(
        receipt.distributionOrigin,
        target,
        evidence.version,
        artifact.zipSha256,
      )) {
      fail(`${target} distribution observation does not match release evidence`);
    }
    return `${artifact.zipSha256}  ${artifact.filename}`;
  }).join('\n') + '\n';
  const checksumBytes = readRegularFile(
    path.join(root, evidence.checksumFilename),
    MAX_CHECKSUM_BYTES,
    'release checksum',
  );
  if (checksumBytes.toString('utf8') !== expectedChecksum) fail('release checksum does not match artifacts');
  return {
    schemaVersion: 1,
    version: evidence.version,
    gitCommit: evidence.gitCommit,
    distributionOrigin: receipt.distributionOrigin,
    keyId: signature.keyId,
    releaseEvidenceSha256: sha256(evidenceFile.bytes),
    releaseSignatureSha256: sha256(signatureFile.bytes),
    distributionReceiptSha256: sha256(receiptFile.bytes),
    targets: Object.fromEntries(['cloud', 'local'].map((target) => [target, {
      filename: evidence.artifacts[target].filename,
      sha256: evidence.artifacts[target].zipSha256,
      contentLength: receipt.latest.targets[target].contentLength,
    }])),
  };
}

function main() {
  assertArguments();
  const result = verifyExtensionPublication({
    evidencePath: option('--evidence'),
    signaturePath: option('--signature'),
    receiptPath: option('--receipt'),
    keyringPath: cliTrustedKeyring(option('--keyring')),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
