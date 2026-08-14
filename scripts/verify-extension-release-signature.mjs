#!/usr/bin/env node
import { createPublicKey, verify } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  canonicalExtensionReleaseEvidenceJson,
  parseExtensionReleaseEvidence,
} from './extension-release-contract.mjs';
import {
  MAX_KEYRING_BYTES,
  MAX_SIGNATURE_BYTES,
  canonicalReleaseSignatureJson,
  canonicalTrustedKeyringJson,
  parseReleaseSignature,
  parseTrustedKeyring,
  releaseSignaturePayload,
  sha256,
} from './extension-release-publication-contract.mjs';

const FULL_GIT_COMMIT = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_EVIDENCE_BYTES = 65_536;
const repoRoot = path.resolve(import.meta.dirname, '..');
const repositoryKeyring = path.join(repoRoot, 'config/extension-release-trusted-keys.json');

function fail(message) {
  throw new Error(message);
}

function sameFileSnapshot(left, right) {
  return ['dev', 'ino', 'mode', 'nlink', 'uid', 'gid', 'size', 'mtimeNs', 'ctimeNs']
    .every((field) => left[field] === right[field]);
}

function readStableFile(file, label, maxBytes) {
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

function readCanonical(file, parser, canonicalizer, maxBytes, label) {
  const bytes = readStableFile(file, label, maxBytes);
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

function findEvidence(buildRoot) {
  const absolute = path.resolve(buildRoot);
  const root = lstatSync(absolute, { throwIfNoEntry: false });
  if (!root?.isDirectory() || root.isSymbolicLink()) {
    fail('extension release root must be one real directory');
  }
  const matches = readdirSync(absolute, { withFileTypes: true }).filter((entry) => (
    entry.isFile()
      && /^ss-erp-extension-(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.release-evidence\.json$/u
        .test(entry.name)
  ));
  if (matches.length !== 1) fail('extension release root must contain one canonical evidence file');
  return path.join(absolute, matches[0].name);
}

function trustedPublicKey(keyring, keyId) {
  const trusted = keyring.keys.find((candidate) => candidate.keyId === keyId);
  if (!trusted || trusted.status !== 'ACTIVE') fail(`trusted Ed25519 key is unavailable: ${keyId}`);
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

export function verifyExtensionReleaseSignature(input) {
  const expectedGitCommit = String(input.expectedGitCommit || '');
  const expectedSignatureSha256 = String(input.expectedSignatureSha256 || '');
  if (!FULL_GIT_COMMIT.test(expectedGitCommit)) fail('expected Git commit must be a full object ID');
  if (!SHA256.test(expectedSignatureSha256)) fail('expected signature SHA-256 is invalid');

  const signaturePath = String(input.signaturePath || '');
  if (!signaturePath) fail('extension release signature path is required');
  const buildRoot = path.resolve(input.buildRoot);
  const signatureAbsolute = path.resolve(signaturePath);
  const signatureRelative = path.relative(buildRoot, signatureAbsolute);
  if (signatureRelative === ''
    || (!signatureRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(signatureRelative))) {
    fail('extension release signature must remain outside the four-file candidate directory');
  }
  const evidencePath = findEvidence(buildRoot);
  const evidenceFile = readCanonical(
    evidencePath,
    parseExtensionReleaseEvidence,
    canonicalExtensionReleaseEvidenceJson,
    MAX_EVIDENCE_BYTES,
    'extension release evidence',
  );
  const signatureFile = readCanonical(
    signatureAbsolute,
    parseReleaseSignature,
    canonicalReleaseSignatureJson,
    MAX_SIGNATURE_BYTES,
    'extension release signature',
  );
  const keyringFile = readCanonical(
    input.keyringPath || repositoryKeyring,
    parseTrustedKeyring,
    canonicalTrustedKeyringJson,
    MAX_KEYRING_BYTES,
    'extension release trusted keyring',
  );
  const evidence = evidenceFile.value;
  const signature = signatureFile.value;
  const signatureDigest = sha256(signatureFile.bytes);
  const expectedEvidenceFilename = `ss-erp-extension-${evidence.version}.release-evidence.json`;
  const expectedSignatureFilename = `ss-erp-extension-${evidence.version}.release-signature.json`;

  if (evidence.signature?.status !== 'EXTERNAL_REQUIRED') {
    fail('extension release is not awaiting an external signature');
  }
  if (evidence.gitCommit !== expectedGitCommit) {
    fail('extension release signature evidence does not match the target Git commit');
  }
  if (path.basename(evidencePath) !== expectedEvidenceFilename
    || path.basename(signatureAbsolute) !== expectedSignatureFilename
    || signature.releaseEvidenceFilename !== expectedEvidenceFilename
    || signature.releaseEvidenceSha256 !== sha256(evidenceFile.bytes)) {
    fail('extension release signature identity does not match release evidence');
  }
  if (signatureDigest !== expectedSignatureSha256) {
    fail('extension release signature SHA-256 does not match operator approval');
  }
  const publicKey = trustedPublicKey(keyringFile.value, signature.keyId);
  if (!verify(
    null,
    releaseSignaturePayload(signature, evidenceFile.bytes),
    publicKey,
    Buffer.from(signature.signatureBase64, 'base64'),
  )) {
    fail('extension release signature verification failed');
  }
  return {
    schemaVersion: 1,
    gitCommit: evidence.gitCommit,
    version: evidence.version,
    keyId: signature.keyId,
    signedAt: signature.signedAt,
    releaseEvidenceSha256: sha256(evidenceFile.bytes),
    releaseSignatureSha256: signatureDigest,
  };
}

function parseArguments() {
  const args = process.argv.slice(2);
  const allowed = new Set([
    '--build-root',
    '--signature',
    '--expected-signature-sha256',
    '--expected-git-commit',
  ]);
  if (args.length !== allowed.size * 2) fail('extension signature verifier arguments are incomplete');
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || values.has(name) || !value || value.startsWith('--')) {
      fail('extension signature verifier arguments are invalid');
    }
    values.set(name, value);
  }
  return {
    buildRoot: values.get('--build-root'),
    signaturePath: values.get('--signature'),
    expectedSignatureSha256: values.get('--expected-signature-sha256'),
    expectedGitCommit: values.get('--expected-git-commit'),
  };
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    console.log(JSON.stringify(verifyExtensionReleaseSignature(parseArguments()), null, 2));
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
