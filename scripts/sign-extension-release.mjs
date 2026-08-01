#!/usr/bin/env node
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
import { writeNewArtifactDurably } from './extension-release-artifact.mjs';
import {
  canonicalReleaseSignatureJson,
  canonicalTrustedKeyringJson,
  assertPublicationOutputOutsideCandidate,
  assertRealDirectoryTree,
  parseReleaseSignature,
  parseTrustedKeyring,
  releaseSignaturePayload,
  sha256,
} from './extension-release-publication-contract.mjs';
import { parseExtensionReleaseEvidence } from './extension-release-contract.mjs';

const MAX_KEY_BYTES = 16 * 1024;
const repoRoot = path.resolve(import.meta.dirname, '..');
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
  const allowed = new Set(['--evidence', '--keyring', '--output']);
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    if (!allowed.has(args[index]) || seen.has(args[index])
      || !args[index + 1] || args[index + 1].startsWith('--')) {
      fail('unknown or malformed signing option');
    }
    seen.add(args[index]);
    index += 1;
  }
  for (const required of ['--evidence', '--output']) {
    if (!option(required)) fail(`${required} is required`);
  }
}

function assertWindowsPrivateAcl(file) {
  if (process.platform !== 'win32') return;
  const executable = path.join(
    String(process.env.SystemRoot || 'C:\\Windows'),
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  const script = [
    "$ErrorActionPreference='Stop'",
    '$keyPath=$env:SS_ERP_EXTENSION_SIGNING_KEY_PATH',
    "if([string]::IsNullOrWhiteSpace($keyPath)){throw 'path'}",
    '$current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    "$allowed=@($current,'S-1-5-18','S-1-5-32-544')",
    '$acl=[System.IO.File]::GetAccessControl($keyPath)',
    '$owner=(New-Object Security.Principal.NTAccount($acl.Owner)).Translate([Security.Principal.SecurityIdentifier]).Value',
    "if(-not ($allowed -contains $owner)){throw 'owner'}",
    '$rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])',
    "foreach($rule in $rules){if($rule.AccessControlType -eq 'Allow' -and -not ($allowed -contains $rule.IdentityReference.Value)){throw 'access'}}",
    "Write-Output 'OK'",
  ].join(';');
  const result = spawnSync(executable, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
  ], {
    encoding: 'utf8',
    env: { ...process.env, SS_ERP_EXTENSION_SIGNING_KEY_PATH: file },
    windowsHide: true,
    timeout: 10_000,
  });
  if (result.status !== 0 || result.stdout.trim() !== 'OK') {
    fail('signing key Windows ACL must allow only the current user, SYSTEM, and Administrators');
  }
}

function readProtectedSigningKey(file) {
  const absolute = path.resolve(file);
  const relative = path.relative(repoRoot, absolute);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    fail('signing key must be stored outside the repository');
  }
  assertRealDirectoryTree(path.dirname(absolute), 'signing key parent');
  const link = lstatSync(absolute, { throwIfNoEntry: false });
  if (!link?.isFile() || link.isSymbolicLink()) fail('signing key must be one regular file');
  assertWindowsPrivateAcl(absolute);
  let descriptor = null;
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n
      || before.size < 1n || before.size > BigInt(MAX_KEY_BYTES)) {
      if (before.nlink !== 1n) fail('signing key must not have hard links');
      fail('signing key is missing or too large');
    }
    if (process.platform !== 'win32' && (before.mode & 0o077n) !== 0n) {
      fail('signing key must not be group/world readable or writable');
    }
    const size = Number(before.size);
    const bytes = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size) {
      const count = readSync(descriptor, bytes, offset, size - offset, offset);
      if (count < 1) fail('signing key changed while it was being read');
      offset += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (after.nlink !== 1n || after.size !== before.size
      || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) {
      fail('signing key changed while it was being read');
    }
    return bytes;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

export function loadProtectedSigningKey(file) {
  const bytes = readProtectedSigningKey(file);
  try {
    return createPrivateKey(bytes);
  } finally {
    bytes.fill(0);
  }
}

function timestamp() {
  const value = process.env.EXTENSION_RELEASE_SIGNED_AT || new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || new Date(value).toISOString() !== value) {
    fail('EXTENSION_RELEASE_SIGNED_AT must be a canonical UTC timestamp');
  }
  return value;
}

function main() {
  assertArguments();
  const evidencePath = path.resolve(option('--evidence'));
  const output = path.resolve(option('--output'));
  assertPublicationOutputOutsideCandidate(evidencePath, output, 'release signature output');
  const evidenceBytes = requireCanonicalEvidence(evidencePath);
  const evidence = evidenceBytes.value;
  if (path.basename(evidencePath) !== `ss-erp-extension-${evidence.version}.release-evidence.json`
    || path.basename(output) !== `ss-erp-extension-${evidence.version}.release-signature.json`) {
    fail('release evidence and signature must use their canonical versioned filenames');
  }
  if (evidence.signature?.status !== 'EXTERNAL_REQUIRED') {
    fail('release evidence is not awaiting external publication');
  }
  const keyPath = String(process.env.EXTENSION_RELEASE_SIGNING_KEY_PATH || '').trim();
  const keyId = String(process.env.EXTENSION_RELEASE_SIGNING_KEY_ID || '').trim();
  if (!keyPath || !keyId) fail('EXTENSION_RELEASE_SIGNING_KEY_PATH and _KEY_ID are required');
  const privateKey = loadProtectedSigningKey(keyPath);
  if (privateKey.asymmetricKeyType !== 'ed25519') fail('signing key must be Ed25519');
  const keyringPath = path.resolve(
    option('--keyring')
      || process.env.EXTENSION_RELEASE_TRUSTED_KEYRING_PATH
      || path.join(repoRoot, 'config/extension-release-trusted-keys.json'),
  );
  const keyring = requireCanonicalKeyring(keyringPath);
  const trustedKey = keyring.keys.find((candidate) => candidate.keyId === keyId);
  const publicKeyBytes = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  if (!trustedKey || trustedKey.status !== 'ACTIVE'
    || trustedKey.publicKeyBase64 !== publicKeyBytes.toString('base64')) {
    fail('signing key is not the active key bound by the trusted public keyring');
  }
  const signatureValue = {
    schemaVersion: 1,
    kind: 'SS_ERP_EXTENSION_RELEASE_SIGNATURE',
    algorithm: 'Ed25519',
    keyId,
    signedAt: timestamp(),
    releaseEvidenceFilename: path.basename(evidencePath),
    releaseEvidenceSha256: sha256(evidenceBytes.bytes),
    signatureBase64: '',
  };
  const payload = releaseSignaturePayload({
    ...signatureValue,
    signatureBase64: Buffer.alloc(64).toString('base64'),
  }, evidenceBytes.bytes);
  const signature = sign(null, payload, privateKey);
  signatureValue.signatureBase64 = signature.toString('base64');
  const parsed = parseReleaseSignature(signatureValue);
  writeNewArtifactDurably(output, canonicalReleaseSignatureJson(parsed));
  console.log(JSON.stringify({
    schemaVersion: 1,
    evidence: path.basename(evidencePath),
    evidenceSha256: parsed.releaseEvidenceSha256,
    output: path.basename(output),
    outputSha256: sha256(Buffer.from(canonicalReleaseSignatureJson(parsed), 'utf8')),
    keyId: parsed.keyId,
    algorithm: parsed.algorithm,
    publicKeySha256: sha256(publicKeyBytes),
  }, null, 2));
}

function requireCanonicalEvidence(file) {
  const bytes = readFileStrict(file, 65_536, 'release evidence');
  const text = bytes.toString('utf8');
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail('release evidence is not valid JSON'); }
  const evidence = parseExtensionReleaseEvidence(parsed);
  if (text.charCodeAt(0) === 0xfeff || text.includes('\r')
    || text !== `${JSON.stringify(evidence, null, 2)}\n`) {
    fail('release evidence must be canonical UTF-8 JSON');
  }
  return { bytes, value: evidence };
}

function requireCanonicalKeyring(file) {
  const bytes = readFileStrict(file, 65_536, 'trusted keyring');
  const text = bytes.toString('utf8');
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail('trusted keyring is not valid JSON'); }
  const keyring = parseTrustedKeyring(parsed);
  if (text.charCodeAt(0) === 0xfeff || text.includes('\r')
    || text !== canonicalTrustedKeyringJson(keyring)) {
    fail('trusted keyring must be canonical UTF-8 JSON');
  }
  return keyring;
}

function readFileStrict(file, maxBytes, label) {
  const absolute = path.resolve(file);
  const link = lstatSync(absolute, { throwIfNoEntry: false });
  if (!link?.isFile() || link.isSymbolicLink() || link.size < 1 || link.size > maxBytes) {
    fail(`${label} is missing, unsafe, or too large`);
  }
  let descriptor = null;
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size < 1 || before.size > maxBytes) fail(`${label} is missing or too large`);
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < before.size) {
      const count = readSync(descriptor, bytes, offset, before.size - offset, offset);
      if (count < 1) fail(`${label} changed while it was being read`);
      offset += count;
    }
    const after = fstatSync(descriptor);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      fail(`${label} changed while it was being read`);
    }
    return bytes;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
