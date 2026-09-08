#!/usr/bin/env node
import { createPublicKey, sign } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeNewArtifactDurably } from './extension-release-artifact.mjs';
import {
  canonicalExtensionReleaseEvidenceJson,
} from './extension-release-contract.mjs';
import {
  DISTRIBUTION_CHANNEL,
  MAX_KEYRING_BYTES,
  WEBSITE_PUBLICATION_APPROVAL_KIND,
  canonicalTrustedKeyringJson,
  canonicalWebsitePublicationApprovalJson,
  parseTrustedKeyring,
  parseWebsitePublicationApproval,
  publicOriginForPublication,
  sha256,
  websitePublicationApprovalPayload,
  assertPublicationOutputOutsideCandidate,
} from './extension-release-publication-contract.mjs';
import { parseExtensionReleaseEvidence } from './extension-release-contract.mjs';
import { loadProtectedSigningKey } from './sign-extension-release.mjs';
import { verifyExtensionReleaseSignature } from './verify-extension-release-signature.mjs';
import {
  readStablePublicationFile,
  verifyRel04DarkCanaryEvidence,
} from './extension-website-publication-approval.mjs';

const args = process.argv.slice(2);
const repoRoot = path.resolve(import.meta.dirname, '..');

function fail(message) {
  throw new Error(message);
}

function options() {
  const required = new Set([
    '--dark-canary',
    '--distribution-origin',
    '--evidence',
    '--expected-dark-canary-sha256',
    '--expected-release-signature-sha256',
    '--output',
    '--region',
    '--release-signature',
  ]);
  const allowed = new Set([...required, '--keyring']);
  const values = new Map();
  if (args.length % 2 !== 0) fail('website publication signing options are malformed');
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || values.has(name) || !value || value.startsWith('--')) {
      fail('website publication signing options are malformed');
    }
    values.set(name, value);
  }
  for (const name of required) if (!values.has(name)) fail(`${name} is required`);
  return Object.fromEntries(values);
}

function canonicalFile(file, maxBytes, label, parser, canonicalizer) {
  const bytes = readStablePublicationFile(file, maxBytes, label);
  const text = bytes.toString('utf8');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON`);
  }
  const value = parser(raw);
  if (text.charCodeAt(0) === 0xfeff || text.includes('\r')
    || text !== canonicalizer(value)) {
    fail(`${label} is not canonical JSON`);
  }
  return { bytes, value };
}

function approvedAt() {
  const value = String(
    process.env.EXTENSION_WEBSITE_PUBLICATION_APPROVED_AT || new Date().toISOString(),
  );
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    fail('EXTENSION_WEBSITE_PUBLICATION_APPROVED_AT must be a canonical UTC timestamp');
  }
  return value;
}

function assertOutsideCandidate(candidateRoot, file, label) {
  const relative = path.relative(candidateRoot, path.resolve(file));
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    fail(`${label} must remain outside the immutable four-file candidate directory`);
  }
}

function main() {
  const input = options();
  const evidencePath = path.resolve(input['--evidence']);
  const candidateRoot = path.dirname(evidencePath);
  const releaseSignaturePath = path.resolve(input['--release-signature']);
  const darkCanaryPath = path.resolve(input['--dark-canary']);
  const outputPath = path.resolve(input['--output']);
  const expectedReleaseSignatureSha256 = input['--expected-release-signature-sha256'];
  const expectedDarkCanarySha256 = input['--expected-dark-canary-sha256'];
  const distributionOrigin = publicOriginForPublication(input['--distribution-origin']);
  const region = input['--region'];
  const keyringPath = path.resolve(
    input['--keyring']
      || process.env.EXTENSION_RELEASE_TRUSTED_KEYRING_PATH
      || path.join(repoRoot, 'config/extension-release-trusted-keys.json'),
  );
  if (region !== 'COM' && region !== 'CN') fail('--region must be COM or CN');
  assertOutsideCandidate(candidateRoot, releaseSignaturePath, 'release signature');
  assertOutsideCandidate(candidateRoot, darkCanaryPath, 'REL-04 dark canary evidence');
  assertPublicationOutputOutsideCandidate(evidencePath, outputPath, 'website publication approval output');

  const evidenceFile = canonicalFile(
    evidencePath,
    65_536,
    'extension release evidence',
    parseExtensionReleaseEvidence,
    canonicalExtensionReleaseEvidenceJson,
  );
  const evidence = evidenceFile.value;
  const expectedApprovalFilename =
    `ss-erp-extension-${evidence.version}.website-publication-approval.json`;
  if (path.basename(evidencePath) !== `ss-erp-extension-${evidence.version}.release-evidence.json`
    || path.basename(releaseSignaturePath)
      !== `ss-erp-extension-${evidence.version}.release-signature.json`
    || path.basename(outputPath) !== expectedApprovalFilename
    || evidence.expectedOrigins.api !== distributionOrigin) {
    fail('website publication approval identity does not match release evidence');
  }
  const signatureVerification = verifyExtensionReleaseSignature({
    buildRoot: candidateRoot,
    signaturePath: releaseSignaturePath,
    expectedSignatureSha256: expectedReleaseSignatureSha256,
    expectedGitCommit: evidence.gitCommit,
    keyringPath,
  });
  const approvalTime = approvedAt();
  if (Date.parse(approvalTime) < Date.parse(signatureVerification.signedAt)) {
    fail('website publication approval must not predate the release signature');
  }
  const darkCanary = verifyRel04DarkCanaryEvidence({
    darkCanaryPath,
    expectedSha256: expectedDarkCanarySha256,
    expectedGitCommit: evidence.gitCommit,
    expectedApiOrigin: evidence.expectedOrigins.api,
    requireReleaseBinding: true,
    expectedReleaseSignedAt: signatureVerification.signedAt,
    expectedCandidate: {
      gitCommit: evidence.gitCommit,
      apiOrigin: evidence.expectedOrigins.api,
      region,
      version: evidence.version,
      releaseEvidenceSha256: signatureVerification.releaseEvidenceSha256,
      releaseSignatureSha256: signatureVerification.releaseSignatureSha256,
    },
    approvedAt: approvalTime,
    now: new Date(approvalTime),
  });
  if (Date.parse(darkCanary.observedAt) < Date.parse(signatureVerification.signedAt)) {
    fail('website publication dark canary observation must not predate the release signature');
  }

  const keyPath = String(process.env.EXTENSION_RELEASE_SIGNING_KEY_PATH || '').trim();
  const keyId = String(process.env.EXTENSION_RELEASE_SIGNING_KEY_ID || '').trim();
  if (!keyPath || !keyId) {
    fail('EXTENSION_RELEASE_SIGNING_KEY_PATH and _KEY_ID are required');
  }
  const keyringFile = canonicalFile(
    keyringPath,
    MAX_KEYRING_BYTES,
    'extension release trusted keyring',
    parseTrustedKeyring,
    canonicalTrustedKeyringJson,
  );
  const privateKey = loadProtectedSigningKey(keyPath);
  if (privateKey.asymmetricKeyType !== 'ed25519') fail('signing key must be Ed25519');
  const publicKeyBytes = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const trustedKey = keyringFile.value.keys.find((candidate) => candidate.keyId === keyId);
  if (!trustedKey || trustedKey.status !== 'ACTIVE'
    || trustedKey.publicKeyBase64 !== publicKeyBytes.toString('base64')) {
    fail('signing key is not the active key bound by the trusted public keyring');
  }
  if (keyId !== signatureVerification.keyId) {
    fail('website publication approval key must match the release signature key');
  }

  const approvalValue = {
    schemaVersion: 1,
    kind: WEBSITE_PUBLICATION_APPROVAL_KIND,
    algorithm: 'Ed25519',
    channel: DISTRIBUTION_CHANNEL,
    keyId,
    approvedAt: approvalTime,
    region,
    distributionOrigin,
    gitCommit: evidence.gitCommit,
    version: evidence.version,
    releaseEvidenceFilename: path.basename(evidencePath),
    releaseEvidenceSha256: sha256(evidenceFile.bytes),
    releaseSignatureFilename: path.basename(releaseSignaturePath),
    releaseSignatureSha256: signatureVerification.releaseSignatureSha256,
    darkCanaryFilename: path.basename(darkCanaryPath),
    darkCanarySha256: expectedDarkCanarySha256,
    signatureBase64: '',
  };
  approvalValue.signatureBase64 = sign(
    null,
    websitePublicationApprovalPayload({
      ...approvalValue,
      signatureBase64: Buffer.alloc(64).toString('base64'),
    }),
    privateKey,
  ).toString('base64');
  const approval = parseWebsitePublicationApproval(approvalValue);
  const approvalBytes = Buffer.from(canonicalWebsitePublicationApprovalJson(approval), 'utf8');
  writeNewArtifactDurably(outputPath, approvalBytes, { mode: 0o600 });
  console.log(JSON.stringify({
    schemaVersion: 1,
    kind: approval.kind,
    region: approval.region,
    gitCommit: approval.gitCommit,
    version: approval.version,
    output: path.basename(outputPath),
    outputSha256: sha256(approvalBytes),
    keyId: approval.keyId,
  }, null, 2));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
