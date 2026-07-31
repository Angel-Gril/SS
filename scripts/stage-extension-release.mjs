#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync, constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  canonicalExtensionReleaseEvidenceJson,
  parseExpectedReleaseOrigins,
  parseExtensionReleaseEvidence,
} from './extension-release-contract.mjs';
import { writeNewArtifactDurably } from './extension-release-artifact.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const MAX_EVIDENCE_BYTES = 65_536;
const MAX_CHECKSUM_BYTES = 4096;
const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const RELEASE_EVIDENCE_PATTERN =
  /^ss-erp-extension-(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.release-evidence\.json$/u;

function fail(message) {
  throw new Error(message);
}

function option(name) {
  const index = args.indexOf(name);
  if (index === -1) fail(`${name} is required`);
  const value = args[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} requires a value`);
  return value;
}

function assertKnownArguments() {
  const required = new Set([
    '--build-root',
    '--expected-admin-origin',
    '--expected-api-origin',
    '--expected-local-origin',
    '--expected-web-origin',
    '--target-git-commit',
  ]);
  const outputOptions = new Set(['--output-dir', '--verify-output-dir']);
  const allowed = new Set([...required, ...outputOptions]);
  const seen = new Set();
  if (args.length !== (required.size + 1) * 2) {
    fail('every extension release staging option is required exactly once');
  }
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index]) || seen.has(args[index]) || args[index + 1]?.startsWith('--')) {
      fail('unknown or malformed extension release staging option');
    }
    seen.add(args[index]);
    required.delete(args[index]);
  }
  const selectedOutputOptions = [...outputOptions].filter((name) => seen.has(name));
  if (required.size || selectedOutputOptions.length !== 1) {
    fail('every extension release staging option is required exactly once');
  }
  return selectedOutputOptions[0];
}

function realDirectory(value, field) {
  const absolute = path.resolve(value);
  const entry = lstatSync(absolute, { throwIfNoEntry: false });
  if (!entry?.isDirectory() || entry.isSymbolicLink()) fail(`${field} must be one real directory`);
  return absolute;
}

function sameIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function readBoundedRegularFile(file, maxBytes, field) {
  let descriptor = null;
  try {
    descriptor = openSync(
      file,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > BigInt(maxBytes)) {
      fail(`${field} is missing, unsafe, or too large`);
    }
    const expectedBytes = Number(before.size);
    const buffer = Buffer.allocUnsafe(expectedBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = readSync(descriptor, buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (offset !== expectedBytes || !sameIdentity(before, after)) {
      fail(`${field} changed while it was being read`);
    }
    return buffer.subarray(0, expectedBytes);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(field)) throw error;
    fail(`${field} is missing, unsafe, or too large`);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function verifyRelease(buildRoot, expectedOrigins) {
  const result = spawnSync(
    process.execPath,
    [
      'scripts/verify-extension-release.mjs',
      '--build-root', buildRoot,
      '--expected-web-origin', expectedOrigins.web,
      '--expected-admin-origin', expectedOrigins.admin,
      '--expected-api-origin', expectedOrigins.api,
      '--expected-local-origin', expectedOrigins.local,
    ],
    { cwd: repoRoot, stdio: 'inherit', env: process.env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) fail('extension release staging verification failed');
}

function selectRelease(buildRoot, targetGitCommit, expectedOrigins) {
  const matches = [];
  const allowExternalSource = process.env.EXTENSION_RELEASE_TEST_ALLOW_EXTERNAL_SOURCE === '1';
  const names = readdirSync(buildRoot).filter((name) => RELEASE_EVIDENCE_PATTERN.test(name));
  if (names.length > 256) fail('extension release root contains too many evidence candidates');
  for (const name of names) {
    try {
      const bytes = readBoundedRegularFile(
        path.join(buildRoot, name),
        MAX_EVIDENCE_BYTES,
        'extension release evidence',
      );
      const text = bytes.toString('utf8');
      const evidence = parseExtensionReleaseEvidence(JSON.parse(text));
      if (text !== canonicalExtensionReleaseEvidenceJson(evidence)
        || evidence.gitCommit !== targetGitCommit
        || (evidence.provenance.sourceMode !== 'REPOSITORY_SOURCE' && !allowExternalSource)
        || JSON.stringify(evidence.expectedOrigins) !== JSON.stringify(expectedOrigins)) continue;
      matches.push({ bytes, evidence, name });
    } catch {
      // A malformed or unrelated historical candidate cannot become the selected release.
    }
  }
  if (matches.length !== 1) {
    fail('extension release root must contain exactly one matching repository-source candidate');
  }
  return matches[0];
}

function prepareOutputDirectory(outputDir) {
  const absolute = path.resolve(outputDir);
  const existing = lstatSync(absolute, { throwIfNoEntry: false });
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink() || readdirSync(absolute).length) {
      fail('extension release staging output must be one empty real directory');
    }
  } else {
    mkdirSync(absolute, { recursive: false, mode: 0o755 });
  }
  chmodSync(absolute, 0o755);
  return absolute;
}

function verifyExactOutput(outputDir, expectedFiles, expectedOrigins) {
  const absolute = realDirectory(outputDir, 'staged extension release');
  const names = readdirSync(absolute).sort();
  const expectedNames = [...expectedFiles.keys()].sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    fail('staged extension release must contain exactly the selected four files');
  }
  for (const [name, expected] of expectedFiles) {
    const actual = readBoundedRegularFile(
      path.join(absolute, name),
      expected.maxBytes,
      `staged ${expected.field}`,
    );
    if (!actual.equals(expected.bytes)) {
      fail(`staged ${expected.field} does not byte-match the root release candidate`);
    }
  }
  verifyRelease(absolute, expectedOrigins);
  return absolute;
}

const outputOption = assertKnownArguments();
const buildRoot = realDirectory(option('--build-root'), 'extension release root');
const outputDirValue = option(outputOption);
const targetGitCommit = option('--target-git-commit').toLowerCase();
if (!/^[a-f0-9]{40}$/u.test(targetGitCommit)) fail('target Git commit must be one full object ID');
const expectedOrigins = parseExpectedReleaseOrigins({
  web: option('--expected-web-origin'),
  admin: option('--expected-admin-origin'),
  api: option('--expected-api-origin'),
  local: option('--expected-local-origin'),
}, 'extension release staging expected origins');

verifyRelease(buildRoot, expectedOrigins);
const selected = selectRelease(buildRoot, targetGitCommit, expectedOrigins);
const checksumBytes = readBoundedRegularFile(
  path.join(buildRoot, selected.evidence.checksumFilename),
  MAX_CHECKSUM_BYTES,
  'extension release checksum',
);
const artifacts = {};
for (const target of ['cloud', 'local']) {
  const record = selected.evidence.artifacts[target];
  const bytes = readBoundedRegularFile(
    path.join(buildRoot, record.filename),
    MAX_ZIP_BYTES,
    `${target} extension release archive`,
  );
  if (sha256(bytes) !== record.zipSha256) fail(`${target} extension release archive SHA-256 mismatch`);
  artifacts[target] = { bytes, record };
}

const expectedFiles = new Map([
  [selected.name, {
    bytes: selected.bytes,
    field: 'extension release evidence',
    maxBytes: MAX_EVIDENCE_BYTES,
  }],
  [selected.evidence.checksumFilename, {
    bytes: checksumBytes,
    field: 'extension release checksum',
    maxBytes: MAX_CHECKSUM_BYTES,
  }],
  ...['cloud', 'local'].map((target) => [artifacts[target].record.filename, {
    bytes: artifacts[target].bytes,
    field: `${target} extension release archive`,
    maxBytes: MAX_ZIP_BYTES,
  }]),
]);

let outputDir;
if (outputOption === '--verify-output-dir') {
  outputDir = verifyExactOutput(outputDirValue, expectedFiles, expectedOrigins);
} else {
  outputDir = prepareOutputDirectory(outputDirValue);
  try {
    for (const [name, expected] of expectedFiles) {
      writeNewArtifactDurably(path.join(outputDir, name), expected.bytes);
    }
    verifyExactOutput(outputDir, expectedFiles, expectedOrigins);
  } catch (error) {
    rmSync(outputDir, { recursive: true, force: true });
    throw error;
  }
}

console.log(JSON.stringify({
  schemaVersion: 1,
  mode: outputOption === '--verify-output-dir' ? 'VERIFY' : 'STAGE',
  gitCommit: selected.evidence.gitCommit,
  version: selected.evidence.version,
  releaseEvidenceSha256: sha256(selected.bytes),
  files: [
    selected.name,
    selected.evidence.checksumFilename,
    selected.evidence.artifacts.cloud.filename,
    selected.evidence.artifacts.local.filename,
  ],
}, null, 2));
