#!/usr/bin/env node
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  canonicalExtensionReleaseEvidenceJson,
  canonicalExtensionVersion,
  parseExpectedReleaseOrigins,
  parseExtensionReleaseEvidence,
} from './extension-release-contract.mjs';
import {
  assertExtensionReleaseInputsUnchanged,
  extensionReleaseGitHead,
  extensionReleasePackageInputsSha256,
  extensionReleaseScopedGitStatus,
  extensionReleaseSourceMode,
} from './extension-release-inputs.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const cliArgs = process.argv.slice(2);

function option(name) {
  const index = cliArgs.indexOf(name);
  if (index < 0) return '';
  const value = cliArgs[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function existingFile(value, label, maxBytes) {
  if (!value) throw new Error(`${label} is required`);
  const file = path.resolve(value);
  if (!existsSync(file)) throw new Error(`${label} is missing: ${file}`);
  const fileStat = lstatSync(file);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error(`${label} is missing: ${file}`);
  }
  if (fileStat.size > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`);
  return file;
}

function readFileNoFollow(file, label, maxBytes) {
  let descriptor = null;
  try {
    descriptor = openSync(
      file,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size > maxBytes) {
      throw new Error(`${label} is missing or exceeds ${maxBytes} bytes`);
    }
    return readFileSync(descriptor);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function currentGitCommit() {
  const deployedCommitPath = path.join(repoRoot, 'DEPLOYED_COMMIT');
  const activeGitCommit = extensionReleaseGitHead(repoRoot);
  if (existsSync(deployedCommitPath)) {
    const match = readFileNoFollow(deployedCommitPath, 'DEPLOYED_COMMIT', 128).toString('utf8')
      .match(/^([a-f0-9]{40})(?:\r?\n)?$/iu);
    if (!match) throw new Error('DEPLOYED_COMMIT must contain one full 40-character Git object ID');
    const gitCommit = match[1].toLowerCase();
    if (activeGitCommit && activeGitCommit !== gitCommit) {
      throw new Error('DEPLOYED_COMMIT does not match active Git HEAD');
    }
    return {
      gitCommit,
      commitSource: 'DEPLOYED_COMMIT',
      activeGitCheckout: Boolean(activeGitCommit),
    };
  }
  if (activeGitCommit) return {
    gitCommit: activeGitCommit,
    commitSource: 'GIT_HEAD',
    activeGitCheckout: true,
  };
  throw new Error('release Git commit requires Git HEAD or a full 40-character DEPLOYED_COMMIT');
}

function readCanonicalEvidence(evidencePath) {
  const text = readFileNoFollow(
    evidencePath,
    'extension release evidence',
    65_536,
  ).toString('utf8');
  if (text.charCodeAt(0) === 0xfeff || text.includes('\r')) {
    throw new Error('extension release evidence must be canonical UTF-8 with LF line endings');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('extension release evidence must be valid JSON');
  }
  const evidence = parseExtensionReleaseEvidence(value);
  if (text !== canonicalExtensionReleaseEvidenceJson(evidence)) {
    throw new Error('extension release evidence JSON is not canonical');
  }
  if (path.basename(evidencePath) !== `ss-erp-extension-${evidence.version}.release-evidence.json`) {
    throw new Error('extension release evidence filename does not match its package version');
  }
  return evidence;
}

function readChecksumRecords(checksumPath) {
  const text = readFileNoFollow(
    checksumPath,
    'extension release checksum manifest',
    4096,
  ).toString('utf8');
  if (text.charCodeAt(0) === 0xfeff || text.includes('\r')) {
    throw new Error('extension release checksum manifest must be canonical UTF-8 with LF line endings');
  }
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : [];
  if (lines.length !== 2) {
    throw new Error('extension release checksum manifest must contain exactly two lines');
  }
  const records = lines.map((line) => {
    const match = line.match(
      /^([a-f0-9]{64}) {2}(ss-erp-(cloud|local)-((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))\.zip)$/u,
    );
    if (!match) throw new Error(`invalid extension release checksum line: ${line}`);
    return { sha256: match[1], filename: match[2], target: match[3], version: match[4] };
  });
  if (records[0].target !== 'cloud' || records[1].target !== 'local') {
    throw new Error('extension release checksum records must be canonical cloud then local order');
  }
  if (new Set(records.map((record) => record.version)).size !== 1) {
    throw new Error('extension release cloud and local versions must match');
  }
  canonicalExtensionVersion(records[0].version, 'extension release checksum version');
  return records;
}

function selectCurrentRelease(buildRoot, resolvedCommit) {
  const root = path.resolve(buildRoot);
  if (!existsSync(root)) throw new Error(`extension release build root is missing: ${root}`);
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`extension release build root is missing: ${root}`);
  }
  const names = readdirSync(root).filter((name) => (
    /^ss-erp-extension-(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.release-evidence\.json$/u
      .test(name)
  ));
  if (names.length < 1 || names.length > 256) {
    throw new Error('extension release build root must contain 1 to 256 evidence candidates');
  }
  const matches = names.map((name) => {
    const evidencePath = existingFile(
      path.join(root, name),
      'extension release evidence',
      65_536,
    );
    return { evidencePath, evidence: readCanonicalEvidence(evidencePath) };
  }).filter(({ evidence }) => (
    evidence.gitCommit === resolvedCommit.gitCommit
    && evidence.provenance.commitSource === resolvedCommit.commitSource
    && evidence.provenance.sourceMode === 'REPOSITORY_SOURCE'
  ));
  matches.sort((left, right) => {
    const leftParts = left.evidence.version.split('.').map(Number);
    const rightParts = right.evidence.version.split('.').map(Number);
    for (let index = 0; index < 3; index += 1) {
      if (leftParts[index] !== rightParts[index]) return rightParts[index] - leftParts[index];
    }
    return 0;
  });
  const selected = matches[0];
  if (!selected) throw new Error('no repository-source extension release matches the active commit');
  return {
    evidencePath: selected.evidencePath,
    checksumPath: existingFile(
      path.join(root, selected.evidence.checksumFilename),
      'extension release checksum manifest',
      4096,
    ),
  };
}

function main() {
  const resolvedCommit = currentGitCommit();
  const buildRoot = option('--build-root');
  if (buildRoot && (option('--checksum') || option('--evidence'))) {
    throw new Error('--build-root cannot be combined with --checksum or --evidence');
  }
  const selected = buildRoot
    ? selectCurrentRelease(buildRoot, resolvedCommit)
    : {
        checksumPath: existingFile(
          option('--checksum'),
          'extension release checksum manifest',
          4096,
        ),
        evidencePath: existingFile(option('--evidence'), 'extension release evidence', 65_536),
      };
  const { checksumPath, evidencePath } = selected;
  if (path.dirname(checksumPath) !== path.dirname(evidencePath)) {
    throw new Error('extension release checksum and evidence must share one artifact directory');
  }
  const expectedOrigins = parseExpectedReleaseOrigins({
    web: option('--expected-web-origin'),
    admin: option('--expected-admin-origin'),
    api: option('--expected-api-origin'),
    local: option('--expected-local-origin'),
  }, 'release verifier expected origins');
  const evidence = readCanonicalEvidence(evidencePath);
  if (evidence.gitCommit !== resolvedCommit.gitCommit
    || evidence.provenance.commitSource !== resolvedCommit.commitSource) {
    throw new Error('extension release evidence Git commit does not match active provenance');
  }
  const sourceDir = path.resolve(process.env.EXTENSION_SOURCE_DIR || 'extensions/ss-erp');
  const actualSourceMode = extensionReleaseSourceMode(repoRoot, sourceDir);
  if (evidence.provenance.sourceMode === 'EXTERNAL_SOURCE'
    && process.env.EXTENSION_RELEASE_TEST_ALLOW_EXTERNAL_SOURCE !== '1') {
    throw new Error('formal extension releases must use repository source');
  }
  const requireCleanGit = resolvedCommit.activeGitCheckout
    && evidence.provenance.sourceMode === 'REPOSITORY_SOURCE';
  assertExtensionReleaseInputsUnchanged({
    expectedSourceMode: evidence.provenance.sourceMode,
    actualSourceMode,
    expectedPackageInputsSha256: evidence.provenance.packageInputsSha256,
    actualPackageInputsSha256: extensionReleasePackageInputsSha256({ repoRoot, sourceDir }),
    requireCleanGit,
    gitStatus: requireCleanGit && actualSourceMode === 'REPOSITORY_SOURCE'
      ? extensionReleaseScopedGitStatus({ repoRoot, sourceDir })
      : '',
  });
  for (const key of ['web', 'admin', 'api', 'local']) {
    if (evidence.expectedOrigins[key] !== expectedOrigins[key]) {
      throw new Error(`extension release evidence ${key} origin does not match explicit expectation`);
    }
  }
  if (path.basename(checksumPath) !== evidence.checksumFilename) {
    throw new Error('extension release checksum filename does not match release evidence');
  }

  const records = readChecksumRecords(checksumPath);
  if (records[0].version !== evidence.version) {
    throw new Error('extension release checksum version does not match release evidence');
  }
  for (const record of records) {
    const artifact = evidence.artifacts[record.target];
    if (record.filename !== artifact.filename || record.sha256 !== artifact.zipSha256) {
      throw new Error(`${record.target} checksum record does not match release evidence`);
    }
    const args = [
      'scripts/verify-extension-archive.mjs',
      '--zip',
      path.join(path.dirname(checksumPath), record.filename),
      '--target',
      record.target,
      '--version',
      evidence.version,
      '--expected-sha256',
      record.sha256,
      '--expected-file-count',
      String(artifact.fileCount),
    ];
    args.push(
      '--expected-web-origin',
      expectedOrigins.web,
      '--expected-admin-origin',
      expectedOrigins.admin,
      '--expected-api-origin',
      expectedOrigins.api,
      '--expected-local-origin',
      expectedOrigins.local,
    );
    const verification = spawnSync(process.execPath, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    });
    if (verification.status !== 0) {
      throw new Error(`${record.target} extension release archive verification failed`);
    }
  }
  console.log(JSON.stringify({
    schemaVersion: evidence.schemaVersion,
    gitCommit: evidence.gitCommit,
    provenance: evidence.provenance,
    version: evidence.version,
    expectedOrigins,
    checksum: checksumPath,
    evidence: evidencePath,
    packages: records.map(({ target, filename, sha256 }) => ({
      target,
      filename,
      sha256,
      fileCount: evidence.artifacts[target].fileCount,
    })),
    signature: { status: 'EXTERNAL_REQUIRED' },
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
