#!/usr/bin/env node
import { createPublicKey, verify } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  MAX_KEYRING_BYTES,
  MAX_PUBLICATION_APPROVAL_BYTES,
  MAX_RECEIPT_BYTES,
  MAX_SIGNATURE_BYTES,
  canonicalDistributionReceiptJson,
  canonicalReleaseSignatureJson,
  canonicalTrustedKeyringJson,
  canonicalWebsitePublicationApprovalJson,
  distributionReceiptPayload,
  parseDistributionReceipt,
  parseReleaseSignature,
  parseTrustedKeyring,
  parseWebsitePublicationApproval,
  releaseSignaturePayload,
  sha256,
  websitePublicationApprovalPayload,
} from './extension-release-publication-contract.mjs';
import {
  canonicalExtensionReleaseEvidenceJson,
  parseExtensionReleaseEvidence,
} from './extension-release-contract.mjs';
import {
  readStablePublicationFile,
  verifyRel04DarkCanaryEvidence,
} from './extension-website-publication-approval.mjs';

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
  const allowed = new Set([
    '--evidence',
    '--signature',
    '--approval',
    '--dark-canary',
    '--receipt',
    '--keyring',
  ]);
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
  return readStablePublicationFile(file, maxBytes, field);
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

function assertApprovalRegion(approval) {
  const hostname = new URL(approval.distributionOrigin).hostname.toLowerCase();
  if ((approval.region === 'COM' && !hostname.endsWith('.com'))
    || (approval.region === 'CN' && !hostname.endsWith('.cn'))) {
    fail('website publication approval region does not match its origin');
  }
}

export function verifyExtensionPublication({
  evidencePath,
  signaturePath,
  approvalPath,
  darkCanaryPath,
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
  const approvalFile = readCanonical(
    approvalPath,
    parseWebsitePublicationApproval,
    canonicalWebsitePublicationApprovalJson,
    MAX_PUBLICATION_APPROVAL_BYTES,
    'website publication approval',
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
  const approval = approvalFile.value;
  const receipt = receiptFile.value;
  if (evidence.signature.status !== 'EXTERNAL_REQUIRED') fail('release is not an external publication candidate');
  const expectedEvidenceFilename = `ss-erp-extension-${evidence.version}.release-evidence.json`;
  const expectedSignatureFilename = `ss-erp-extension-${evidence.version}.release-signature.json`;
  const expectedApprovalFilename =
    `ss-erp-extension-${evidence.version}.website-publication-approval.json`;
  const expectedReceiptFilename = `ss-erp-extension-${evidence.version}.distribution-receipt.json`;
  if (path.basename(evidencePath) !== expectedEvidenceFilename
    || path.basename(signaturePath) !== expectedSignatureFilename
    || path.basename(approvalPath) !== expectedApprovalFilename
    || path.basename(darkCanaryPath) !== approval.darkCanaryFilename
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
  const approvalSha256 = sha256(approvalFile.bytes);
  const approvalKey = activeKey(keyringFile.value, approval.keyId);
  if (!verify(
    null,
    websitePublicationApprovalPayload(approval),
    approvalKey,
    Buffer.from(approval.signatureBase64, 'base64'),
  )) {
    fail('website publication approval signature verification failed');
  }
  assertApprovalRegion(approval);
  if (approval.keyId !== signature.keyId
    || approval.gitCommit !== evidence.gitCommit
    || approval.version !== evidence.version
    || approval.distributionOrigin !== evidence.expectedOrigins.api
    || approval.releaseEvidenceFilename !== expectedEvidenceFilename
    || approval.releaseEvidenceSha256 !== sha256(evidenceFile.bytes)
    || approval.releaseSignatureFilename !== expectedSignatureFilename
    || approval.releaseSignatureSha256 !== sha256(signatureFile.bytes)) {
    fail('website publication approval is not bound to the signed release');
  }
  if (Date.parse(approval.approvedAt) < Date.parse(signature.signedAt)) {
    fail('website publication approval predates the release signature');
  }
  if (receipt.keyId !== approval.keyId
    || receipt.releaseEvidenceFilename !== expectedEvidenceFilename
    || receipt.releaseEvidenceSha256 !== sha256(evidenceFile.bytes)
    || receipt.releaseSignatureFilename !== expectedSignatureFilename
    || receipt.releaseSignatureSha256 !== sha256(signatureFile.bytes)
    || receipt.websitePublicationApprovalFilename !== expectedApprovalFilename
    || receipt.websitePublicationApprovalSha256 !== approvalSha256
    || receipt.darkCanarySha256 !== approval.darkCanarySha256) {
    fail('distribution receipt is not bound to the approved website publication');
  }
  if (Date.parse(receipt.observedAt) < Date.parse(approval.approvedAt)) {
    fail('distribution receipt predates the website publication approval');
  }
  const receiptAge = nowMs - Date.parse(receipt.observedAt);
  if (receiptAge < -MAX_CLOCK_SKEW_MS || receiptAge > MAX_RECEIPT_AGE_MS) {
    fail('distribution receipt is stale or too far in the future');
  }
  const darkCanary = verifyRel04DarkCanaryEvidence({
    darkCanaryPath,
    expectedSha256: approval.darkCanarySha256,
    expectedGitCommit: evidence.gitCommit,
    expectedApiOrigin: evidence.expectedOrigins.api,
    approvedAt: approval.approvedAt,
    now,
  });
  if (Date.parse(darkCanary.observedAt) < Date.parse(signature.signedAt)) {
    fail('REL-04 dark canary observation predates the release signature');
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
    || receipt.latest.publicationApprovalSha256 !== approvalSha256
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
      || observed.publicationApprovalSha256 !== approvalSha256
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
    websitePublicationApprovalSha256: approvalSha256,
    darkCanarySha256: darkCanary.sha256,
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
    approvalPath: option('--approval'),
    darkCanaryPath: option('--dark-canary'),
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
