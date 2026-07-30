#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
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
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new Error(`${label} is missing: ${file}`);
  }
  if (statSync(file).size > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`);
  return file;
}

function currentGitCommit() {
  const deployedCommitPath = path.join(repoRoot, 'DEPLOYED_COMMIT');
  if (existsSync(deployedCommitPath)) {
    const match = readFileSync(deployedCommitPath, 'utf8')
      .match(/^([a-f0-9]{40})(?:\r?\n)?$/iu);
    if (!match) throw new Error('DEPLOYED_COMMIT must contain one full 40-character Git object ID');
    return { gitCommit: match[1].toLowerCase(), commitSource: 'DEPLOYED_COMMIT' };
  }
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const commit = String(result.stdout || '').trim().toLowerCase();
  if (result.status === 0 && /^[a-f0-9]{40}$/u.test(commit)) {
    return { gitCommit: commit, commitSource: 'GIT_HEAD' };
  }
  throw new Error('release Git commit requires Git HEAD or a full 40-character DEPLOYED_COMMIT');
}

function readCanonicalEvidence(evidencePath) {
  const text = readFileSync(evidencePath, 'utf8');
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
  const text = readFileSync(checksumPath, 'utf8');
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

function main() {
  const checksumPath = existingFile(option('--checksum'), 'extension release checksum manifest', 4096);
  const evidencePath = existingFile(option('--evidence'), 'extension release evidence', 65_536);
  if (path.dirname(checksumPath) !== path.dirname(evidencePath)) {
    throw new Error('extension release checksum and evidence must share one artifact directory');
  }
  const expectedOrigins = parseExpectedReleaseOrigins({
    web: option('--expected-web-origin'),
    admin: option('--expected-admin-origin'),
    api: option('--expected-api-origin'),
  }, 'release verifier expected origins');
  const evidence = readCanonicalEvidence(evidencePath);
  const resolvedCommit = currentGitCommit();
  if (evidence.gitCommit !== resolvedCommit.gitCommit
    || evidence.provenance.commitSource !== resolvedCommit.commitSource) {
    throw new Error('extension release evidence Git commit does not match active provenance');
  }
  const sourceDir = path.resolve(process.env.EXTENSION_SOURCE_DIR || 'extensions/ss-erp');
  const actualSourceMode = extensionReleaseSourceMode(repoRoot, sourceDir);
  const requireCleanGit = evidence.provenance.commitSource === 'GIT_HEAD'
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
  for (const key of ['web', 'admin', 'api']) {
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
    if (record.target === 'cloud') {
      args.push(
        '--expected-web-origin',
        expectedOrigins.web,
        '--expected-admin-origin',
        expectedOrigins.admin,
        '--expected-api-origin',
        expectedOrigins.api,
      );
    }
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
