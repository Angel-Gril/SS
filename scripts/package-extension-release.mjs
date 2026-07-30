#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { writeNewArtifactDurably } from './extension-release-artifact.mjs';
import {
  canonicalExtensionReleaseEvidenceJson,
  parseExtensionReleaseEvidence,
  readExpectedReleaseOrigins,
  resolveExtensionReleaseProvenance,
} from './extension-release-contract.mjs';
import {
  assertExtensionReleaseInputsUnchanged,
  extensionReleasePackageInputsSha256,
  extensionReleaseScopedGitStatus,
  extensionReleaseSourceMode,
} from './extension-release-inputs.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const sourceDir = path.resolve(process.env.EXTENSION_SOURCE_DIR || 'extensions/ss-erp');
const outRoot = path.resolve(process.env.EXTENSION_OUT_DIR || 'build/extensions');
const previousBuildRoot = process.env.EXTENSION_PREVIOUS_BUILD_ROOT
  ? path.resolve(process.env.EXTENSION_PREVIOUS_BUILD_ROOT)
  : '';
const targets = ['cloud', 'local'];

function parseVersion(value) {
  const match = String(value || '').match(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u);
  if (!match) return null;
  const parsed = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: match[0],
  };
  return [parsed.major, parsed.minor, parsed.patch].every(Number.isSafeInteger) ? parsed : null;
}

function compareVersions(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] > right[key]) return 1;
    if (left[key] < right[key]) return -1;
  }
  return 0;
}

function releaseFile(root, filename) {
  const file = path.join(root, filename);
  return existsSync(file) && statSync(file).isFile() ? file : '';
}

function versionsInRoot(root) {
  if (!root || !existsSync(root)) return [];
  const versions = [];
  for (const name of readdirSync(root)) {
    const match = name.match(/^ss-erp-extension-(.+)\.release-evidence\.json$/u);
    const filenameVersion = match ? parseVersion(match[1]) : null;
    if (!filenameVersion) continue;
    try {
      const evidencePath = releaseFile(root, name);
      if (!evidencePath || statSync(evidencePath).size > 65_536) continue;
      const evidenceText = readFileSync(evidencePath, 'utf8');
      const evidence = parseExtensionReleaseEvidence(JSON.parse(evidenceText));
      if (evidenceText !== canonicalExtensionReleaseEvidenceJson(evidence)
        || evidence.version !== filenameVersion.raw) continue;
      const checksumPath = releaseFile(root, evidence.checksumFilename);
      if (!checksumPath || statSync(checksumPath).size > 4096) continue;
      const expectedChecksum = ['cloud', 'local']
        .map((target) => {
          const artifact = evidence.artifacts[target];
          return `${artifact.zipSha256}  ${artifact.filename}`;
        })
        .join('\n') + '\n';
      if (readFileSync(checksumPath, 'utf8') !== expectedChecksum) continue;
      let complete = true;
      for (const target of ['cloud', 'local']) {
        const artifact = evidence.artifacts[target];
        const zipPath = releaseFile(root, artifact.filename);
        if (!zipPath || sha256(zipPath) !== artifact.zipSha256) {
          complete = false;
          break;
        }
      }
      if (complete) versions.push(filenameVersion);
    } catch {
      // Incomplete, non-canonical, or damaged historical artifacts do not influence versioning.
    }
  }
  return versions;
}

function resolveVersion() {
  const sourceManifestPath = path.join(sourceDir, 'manifest.json');
  if (!existsSync(sourceManifestPath)) throw new Error(`extension source manifest is missing: ${sourceManifestPath}`);
  const source = parseVersion(JSON.parse(readFileSync(sourceManifestPath, 'utf8')).version);
  if (!source) throw new Error('extension source version must be canonical major.minor.patch');
  const candidates = [source, ...versionsInRoot(outRoot), ...versionsInRoot(previousBuildRoot)];
  const latest = candidates.reduce(
    (highest, current) => (compareVersions(current, highest) > 0 ? current : highest),
    source,
  );
  const requested = String(process.env.EXTENSION_RELEASE_VERSION || '').trim();
  if (requested) {
    const explicit = parseVersion(requested);
    if (!explicit) throw new Error('EXTENSION_RELEASE_VERSION must be canonical major.minor.patch');
    if (compareVersions(explicit, latest) <= 0) {
      throw new Error(`EXTENSION_RELEASE_VERSION must be newer than existing version ${latest.raw}`);
    }
    return explicit.raw;
  }
  const patch = latest.patch + 1;
  if (!Number.isSafeInteger(patch)) throw new Error('extension release patch version cannot be incremented safely');
  return `${latest.major}.${latest.minor}.${patch}`;
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function gitHead() {
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const commit = String(result.stdout || '').trim().toLowerCase();
  if (result.status === 0 && /^[a-f0-9]{40}$/u.test(commit)) return commit;
  return '';
}

function deployedCommit() {
  const deployedCommitPath = path.join(repoRoot, 'DEPLOYED_COMMIT');
  if (!existsSync(deployedCommitPath)) return undefined;
  const match = readFileSync(deployedCommitPath, 'utf8')
    .match(/^([a-f0-9]{40})(?:\r?\n)?$/iu);
  if (!match) throw new Error('DEPLOYED_COMMIT must contain one full 40-character Git object ID');
  return match[1].toLowerCase();
}

function releaseProvenance() {
  const sourceMode = extensionReleaseSourceMode(repoRoot, sourceDir);
  const archiveCommit = deployedCommit();
  return resolveExtensionReleaseProvenance({
    deployedCommit: archiveCommit,
    gitCommit: archiveCommit === undefined ? gitHead() : undefined,
    sourceMode,
    gitStatus: archiveCommit === undefined && sourceMode === 'REPOSITORY_SOURCE'
      ? extensionReleaseScopedGitStatus({ repoRoot, sourceDir })
      : '',
    packageInputsSha256: extensionReleasePackageInputsSha256({ repoRoot, sourceDir }),
  });
}

function packagedFileCount(root, subdirectory = '') {
  let count = 0;
  const directory = path.join(root, subdirectory);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const relative = path.join(subdirectory, entry.name);
    if (entry.isDirectory()) count += packagedFileCount(root, relative);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

function acquireReleaseLock(lockPath) {
  let descriptor = null;
  try {
    descriptor = openSync(lockPath, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify({
      schemaVersion: 1,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    })}\n`);
    fsyncSync(descriptor);
    return descriptor;
  } catch (error) {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the original lock failure.
      }
      rmSync(lockPath, { force: true });
    }
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      throw new Error(`another extension release holds the lock: ${lockPath}`);
    }
    throw error;
  }
}

mkdirSync(outRoot, { recursive: true });
const lockPath = path.join(outRoot, '.ss-erp-extension-release.lock');
const buildDirectories = targets.map((target) => path.join(outRoot, `ss-erp-${target}`));
let lockDescriptor = null;
let ownsLock = false;
let releaseStarted = false;
let cleanupArtifacts = [];
try {
  lockDescriptor = acquireReleaseLock(lockPath);
  ownsLock = true;
  const expectedOrigins = readExpectedReleaseOrigins(process.env);
  const resolvedProvenance = releaseProvenance();
  const gitCommit = resolvedProvenance.gitCommit;
  const version = resolveVersion();
  const zipPaths = new Map(targets.map((target) => [
    target,
    path.join(outRoot, `ss-erp-${target}-${version}.zip`),
  ]));
  const checksumPath = path.join(outRoot, `ss-erp-extension-${version}.sha256`);
  const evidencePath = path.join(
    outRoot,
    `ss-erp-extension-${version}.release-evidence.json`,
  );
  cleanupArtifacts = [...zipPaths.values(), checksumPath, evidencePath];
  for (const artifact of cleanupArtifacts) {
    if (existsSync(artifact)) throw new Error(`refusing to overwrite existing release artifact: ${artifact}`);
  }

  releaseStarted = true;
  const fileCounts = new Map();
  for (const target of targets) {
    const packaging = spawnSync(
      process.execPath,
      ['scripts/package-extension-package.mjs', target],
      {
        cwd: repoRoot,
        stdio: 'inherit',
        env: { ...process.env, EXTENSION_PACKAGE_VERSION: version },
      },
    );
    if (packaging.status !== 0) throw new Error(`${target} extension packaging failed`);
    const builtManifest = JSON.parse(
      readFileSync(path.join(outRoot, `ss-erp-${target}`, 'manifest.json'), 'utf8'),
    );
    if (builtManifest.version !== version) {
      throw new Error(`${target} extension did not use coordinated version ${version}`);
    }
    fileCounts.set(target, packagedFileCount(path.join(outRoot, `ss-erp-${target}`)));
  }

  const requireCleanGit = resolvedProvenance.provenance.commitSource === 'GIT_HEAD'
    && resolvedProvenance.provenance.sourceMode === 'REPOSITORY_SOURCE';
  assertExtensionReleaseInputsUnchanged({
    expectedSourceMode: resolvedProvenance.provenance.sourceMode,
    actualSourceMode: extensionReleaseSourceMode(repoRoot, sourceDir),
    expectedPackageInputsSha256: resolvedProvenance.provenance.packageInputsSha256,
    actualPackageInputsSha256: extensionReleasePackageInputsSha256({ repoRoot, sourceDir }),
    requireCleanGit,
    gitStatus: requireCleanGit
      ? extensionReleaseScopedGitStatus({ repoRoot, sourceDir })
      : '',
  });

  const records = targets.map((target) => ({
    target,
    filename: path.basename(zipPaths.get(target)),
    sha256: sha256(zipPaths.get(target)),
    fileCount: fileCounts.get(target),
  }));
  writeNewArtifactDurably(
    checksumPath,
    `${records.map((record) => `${record.sha256}  ${record.filename}`).join('\n')}\n`,
  );
  const evidence = {
    schemaVersion: 1,
    gitCommit,
    provenance: resolvedProvenance.provenance,
    version,
    expectedOrigins,
    artifacts: Object.fromEntries(records.map((record) => [record.target, {
      target: record.target,
      filename: record.filename,
      zipSha256: record.sha256,
      fileCount: record.fileCount,
    }])),
    checksumFilename: path.basename(checksumPath),
    signature: { status: 'EXTERNAL_REQUIRED' },
  };
  writeNewArtifactDurably(evidencePath, canonicalExtensionReleaseEvidenceJson(evidence));
  const verification = spawnSync(
    process.execPath,
    [
      'scripts/verify-extension-release.mjs',
      '--checksum',
      checksumPath,
      '--evidence',
      evidencePath,
      '--expected-web-origin',
      expectedOrigins.web,
      '--expected-admin-origin',
      expectedOrigins.admin,
      '--expected-api-origin',
      expectedOrigins.api,
    ],
    { cwd: repoRoot, stdio: 'inherit', env: process.env },
  );
  if (verification.status !== 0) throw new Error('coordinated extension release verification failed');
  console.log(JSON.stringify({
    version,
    gitCommit,
    provenance: resolvedProvenance.provenance,
    expectedOrigins,
    checksum: checksumPath,
    evidence: evidencePath,
    packages: records,
    signature: { status: 'EXTERNAL_REQUIRED' },
  }, null, 2));
} catch (error) {
  if (ownsLock && releaseStarted) {
    for (const artifact of cleanupArtifacts) rmSync(artifact, { force: true });
    for (const directory of buildDirectories) rmSync(directory, { recursive: true, force: true });
  }
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (lockDescriptor !== null) {
    try {
      closeSync(lockDescriptor);
    } catch {
      // The release result already determines the process status.
    }
  }
  if (ownsLock) rmSync(lockPath, { force: true });
}
