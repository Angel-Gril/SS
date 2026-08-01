#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  canonicalExtensionReleaseEvidenceJson,
  parseExpectedReleaseOrigins,
  parseExtensionReleaseEvidence,
} from './extension-release-contract.mjs';
import { parseStoredZip } from './verify-extension-archive.mjs';

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const FULL_GIT_COMMIT = /^[a-f0-9]{40}$/u;

function fail(message) {
  throw new Error(message);
}

function sameFileSnapshot(left, right) {
  return [
    'dev',
    'ino',
    'mode',
    'nlink',
    'uid',
    'gid',
    'size',
    'mtimeNs',
    'ctimeNs',
  ].every((field) => left[field] === right[field]);
}

function readStableFile(file, label, maxBytes) {
  let before;
  try {
    before = lstatSync(file, { bigint: true });
  } catch {
    fail(`${label} is missing or unreadable`);
  }
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n
    || before.size < 1n || before.size > BigInt(maxBytes)) {
    fail(`${label} must be one bounded regular non-symbolic-link file`);
  }
  if (process.platform !== 'win32') {
    const expectedUid = BigInt(process.geteuid());
    if (before.uid !== expectedUid || Number(before.mode & 0o022n) !== 0) {
      fail(`${label} must be owned by the verifier and not writable by group or world`);
    }
  }

  let descriptor = null;
  try {
    descriptor = openSync(
      file,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameFileSnapshot(before, opened)) fail(`${label} changed while it was opened`);
    const bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(file, { bigint: true });
    if (!sameFileSnapshot(before, openedAfter) || !sameFileSnapshot(before, pathAfter)) {
      fail(`${label} changed while it was read`);
    }
    return bytes;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function canonicalCandidateFiles(buildRoot) {
  const absolute = path.resolve(buildRoot);
  let metadata;
  try {
    metadata = lstatSync(absolute);
  } catch {
    fail('staged extension release directory is missing or unreadable');
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    fail('staged extension release must be one real directory');
  }
  if (process.platform !== 'win32'
    && (metadata.uid !== process.geteuid() || (metadata.mode & 0o022) !== 0)) {
    fail('staged extension release directory has unsafe ownership or permissions');
  }
  const entries = readdirSync(absolute, { withFileTypes: true });
  if (entries.length !== 4 || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    fail('staged extension release must contain exactly four files');
  }
  return {
    absolute,
    names: entries.map((entry) => entry.name).sort(),
  };
}

function parseCanonicalEvidence(buildRoot, names) {
  const evidenceNames = names.filter((name) => (
    /^ss-erp-extension-(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.release-evidence\.json$/u
      .test(name)
  ));
  if (evidenceNames.length !== 1) fail('staged extension release must contain one evidence file');
  const evidencePath = path.join(buildRoot, evidenceNames[0]);
  const text = readStableFile(evidencePath, 'extension release evidence', 65_536).toString('utf8');
  if (text.charCodeAt(0) === 0xfeff || text.includes('\r')) {
    fail('extension release evidence must use canonical UTF-8 with LF line endings');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail('extension release evidence must be valid JSON');
  }
  const evidence = parseExtensionReleaseEvidence(value);
  if (text !== canonicalExtensionReleaseEvidenceJson(evidence)) {
    fail('extension release evidence JSON is not canonical');
  }
  return { evidence, evidenceName: evidenceNames[0] };
}

function expectedCandidateNames(evidence, evidenceName) {
  return [
    evidenceName,
    evidence.checksumFilename,
    evidence.artifacts.cloud.filename,
    evidence.artifacts.local.filename,
  ].sort();
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function canonicalCloudLogisticsFeature(enabled) {
  if (typeof enabled !== 'boolean') fail('cloud logistics expectation must be boolean');
  return Buffer.from([
    '(function (root) {',
    '  root.SS_ERP_LOGISTICS_DISTRIBUTION_FEATURE = Object.freeze({',
    `    enabled: ${enabled},`,
    "    source: 'package-cloud',",
    '  });',
    "})(typeof globalThis !== 'undefined' ? globalThis : self);",
    '',
  ].join('\n'), 'utf8');
}

function runFormalReleaseVerifier({ buildRoot, expectedOrigins }) {
  const verifier = path.join(import.meta.dirname, 'verify-extension-release.mjs');
  const result = spawnSync(process.execPath, [
    verifier,
    '--build-root', buildRoot,
    '--expected-web-origin', expectedOrigins.web,
    '--expected-admin-origin', expectedOrigins.admin,
    '--expected-api-origin', expectedOrigins.api,
    '--expected-local-origin', expectedOrigins.local,
  ], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: process.env,
    stdio: 'inherit',
    timeout: 10 * 60 * 1000,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0) {
    fail('formal extension release verification failed');
  }
}

export function verifyVpsExtensionRelease(input, dependencies = {}) {
  const expectedOrigins = parseExpectedReleaseOrigins(input.expectedOrigins, 'VPS expected origins');
  const expectedGitCommit = readStableFile(
    path.resolve(input.deployedCommitFile),
    'DEPLOYED_COMMIT',
    128,
  ).toString('utf8').match(/^([a-f0-9]{40})\n$/u)?.[1];
  if (!expectedGitCommit || !FULL_GIT_COMMIT.test(expectedGitCommit)) {
    fail('DEPLOYED_COMMIT must contain one canonical full Git commit');
  }
  const candidate = canonicalCandidateFiles(input.buildRoot);
  const { evidence, evidenceName } = parseCanonicalEvidence(candidate.absolute, candidate.names);
  if (JSON.stringify(candidate.names) !== JSON.stringify(expectedCandidateNames(evidence, evidenceName))) {
    fail('staged extension release must contain exactly four files');
  }
  if (evidence.gitCommit !== expectedGitCommit) {
    fail('extension release evidence Git commit does not match DEPLOYED_COMMIT');
  }
  if (JSON.stringify(evidence.expectedOrigins) !== JSON.stringify(expectedOrigins)) {
    fail('extension release evidence origins do not match the deployment');
  }

  const checksumPath = path.join(candidate.absolute, evidence.checksumFilename);
  const checksum = readStableFile(checksumPath, 'extension release checksum', 4096);
  const expectedChecksum = Buffer.from(
    `${evidence.artifacts.cloud.zipSha256}  ${evidence.artifacts.cloud.filename}\n`
      + `${evidence.artifacts.local.zipSha256}  ${evidence.artifacts.local.filename}\n`,
    'utf8',
  );
  if (!checksum.equals(expectedChecksum)) fail('extension release checksum manifest is not canonical');

  const cloudArchive = readStableFile(
    path.join(candidate.absolute, evidence.artifacts.cloud.filename),
    'cloud extension ZIP',
    MAX_ARCHIVE_BYTES,
  );
  const localArchive = readStableFile(
    path.join(candidate.absolute, evidence.artifacts.local.filename),
    'local extension ZIP',
    MAX_ARCHIVE_BYTES,
  );
  if (sha256(cloudArchive) !== evidence.artifacts.cloud.zipSha256
    || sha256(localArchive) !== evidence.artifacts.local.zipSha256) {
    fail('extension release ZIP SHA-256 does not match evidence');
  }

  const cloudEntries = parseStoredZip(cloudArchive, 'ss-erp-cloud');
  if (cloudEntries.length !== evidence.artifacts.cloud.fileCount) {
    fail('cloud extension ZIP entry count does not match evidence');
  }
  const featureName = 'ss-erp-cloud/shared/logistics-rules/distribution-feature.js';
  const featureEntries = cloudEntries.filter((entry) => entry.name === featureName);
  if (featureEntries.length !== 1) fail('cloud extension logistics feature entry is missing');
  const expectedFeature = canonicalCloudLogisticsFeature(input.expectedCloudLogisticsEnabled);
  if (!featureEntries[0].data.equals(expectedFeature)) {
    fail('cloud extension logistics feature does not match the rollout expectation');
  }

  const formalVerify = dependencies.formalVerify || runFormalReleaseVerifier;
  formalVerify({ buildRoot: candidate.absolute, expectedOrigins });
  return {
    schemaVersion: 1,
    gitCommit: expectedGitCommit,
    version: evidence.version,
    cloudLogisticsEnabled: input.expectedCloudLogisticsEnabled,
    files: candidate.names,
  };
}

function parseArguments() {
  const args = process.argv.slice(2);
  const allowed = new Set([
    '--build-root',
    '--deployed-commit-file',
    '--expected-web-origin',
    '--expected-admin-origin',
    '--expected-api-origin',
    '--expected-local-origin',
    '--expected-cloud-logistics-enabled',
  ]);
  if (args.length !== allowed.size * 2) fail('VPS extension verifier arguments are incomplete');
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || values.has(name) || !value || value.startsWith('--')) {
      fail('VPS extension verifier arguments are invalid');
    }
    values.set(name, value);
  }
  if (values.size !== allowed.size) fail('VPS extension verifier arguments are incomplete');
  const logisticsText = values.get('--expected-cloud-logistics-enabled');
  if (!['true', 'false'].includes(logisticsText)) {
    fail('--expected-cloud-logistics-enabled must be true or false');
  }
  return {
    buildRoot: values.get('--build-root'),
    deployedCommitFile: values.get('--deployed-commit-file'),
    expectedOrigins: {
      web: values.get('--expected-web-origin'),
      admin: values.get('--expected-admin-origin'),
      api: values.get('--expected-api-origin'),
      local: values.get('--expected-local-origin'),
    },
    expectedCloudLogisticsEnabled: logisticsText === 'true',
  };
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    console.log(JSON.stringify(verifyVpsExtensionRelease(parseArguments()), null, 2));
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
