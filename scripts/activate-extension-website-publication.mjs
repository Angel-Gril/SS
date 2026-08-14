#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  replaceArtifactDurably,
  writeNewArtifactDurably,
} from './extension-release-artifact.mjs';
import {
  canonicalExtensionReleaseEvidenceJson,
  parseExtensionReleaseEvidence,
} from './extension-release-contract.mjs';
import {
  canonicalWebsitePublicationApprovalJson,
  parseWebsitePublicationApproval,
  sha256,
} from './extension-release-publication-contract.mjs';
import { verifyExtensionReleaseSignature } from './verify-extension-release-signature.mjs';
import {
  readStablePublicationFile,
  verifyRel04DarkCanaryEvidence,
  verifyWebsitePublicationApproval,
} from './extension-website-publication-approval.mjs';

export const WEBSITE_PUBLICATION_POINTER_FILENAME =
  'current.website-publication-approval.json';
export const WEBSITE_PUBLICATION_DEPLOY_LOCK_PATH =
  '/var/lib/ss-erp-deploy-build/deploy.lock';
const repoRoot = path.resolve(import.meta.dirname, '..');

function fail(message) {
  throw new Error(message);
}

function assertSecureDirectoryTree(directory, ownerUid, enforceOwnership = true) {
  const absolute = path.resolve(directory);
  const root = path.parse(absolute).root;
  let current = root;
  for (const segment of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const entry = lstatSync(current, { throwIfNoEntry: false });
    if (!entry?.isDirectory() || entry.isSymbolicLink()
      || (enforceOwnership && process.platform !== 'win32'
        && (entry.uid !== ownerUid || (entry.mode & 0o022) !== 0))) {
      fail('website publication root must use a trusted non-writable real directory tree');
    }
  }
  if (realpathSync.native(absolute) !== absolute) {
    fail('website publication root must be canonical');
  }
  return absolute;
}

function canonicalEvidence(file) {
  const bytes = readStablePublicationFile(file, 65_536, 'extension release evidence');
  const text = bytes.toString('utf8');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    fail('extension release evidence is not valid JSON');
  }
  const evidence = parseExtensionReleaseEvidence(raw);
  if (text.charCodeAt(0) === 0xfeff || text.includes('\r')
    || text !== canonicalExtensionReleaseEvidenceJson(evidence)) {
    fail('extension release evidence is not canonical JSON');
  }
  return { bytes, evidence };
}

function activeCommit(file) {
  const text = readStablePublicationFile(file, 128, 'active DEPLOYED_COMMIT').toString('utf8');
  const match = text.match(/^([a-f0-9]{40})\n?$/u);
  if (!match) fail('active DEPLOYED_COMMIT is invalid');
  return match[1];
}

function realPath(file, label) {
  try {
    return realpathSync.native(path.resolve(file));
  } catch {
    fail(`${label} is missing or cannot be resolved`);
  }
}

function resolveActiveDeployment(input, approval) {
  const suppliedCommitPath = path.resolve(input.activeDeployedCommitPath);
  if (path.basename(suppliedCommitPath) !== 'DEPLOYED_COMMIT') {
    fail('active deployment binding must point to DEPLOYED_COMMIT');
  }
  const deployedCommitPath = realPath(suppliedCommitPath, 'active DEPLOYED_COMMIT');
  if (path.basename(deployedCommitPath) !== 'DEPLOYED_COMMIT') {
    fail('active deployment binding must resolve to DEPLOYED_COMMIT');
  }
  const activeRoot = path.dirname(deployedCommitPath);
  const candidateRoot = path.join(activeRoot, 'build', 'extensions');
  if (realPath(input.candidateRoot, 'active extension candidate') !== candidateRoot
    || realPath(candidateRoot, 'active extension candidate') !== candidateRoot) {
    fail('website publication candidate must be the active deployed extension candidate');
  }
  const signatureRoot = path.join(activeRoot, 'build', 'extension-release-publication');
  if (realPath(signatureRoot, 'active extension signature directory') !== signatureRoot) {
    fail('active extension signature directory must be canonical');
  }
  const signatureRootEntry = lstatSync(signatureRoot);
  const signatureNames = readdirSync(signatureRoot, { withFileTypes: true });
  if (!signatureRootEntry.isDirectory() || signatureRootEntry.isSymbolicLink()
    || signatureNames.length !== 1 || !signatureNames[0].isFile()
    || signatureNames[0].isSymbolicLink()
    || signatureNames[0].name !== approval.releaseSignatureFilename) {
    fail('active extension signature directory must contain exactly the sealed release signature');
  }
  const releaseSignaturePath = path.join(signatureRoot, approval.releaseSignatureFilename);
  if (realPath(input.releaseSignaturePath, 'active extension release signature')
      !== releaseSignaturePath
    || realPath(releaseSignaturePath, 'active extension release signature')
      !== releaseSignaturePath) {
    fail('website publication signature must be the active deployed sealed signature');
  }
  const signatureShaPath = path.join(activeRoot, 'build', 'extension-release-signature.sha256');
  const signatureShaText = readStablePublicationFile(
    signatureShaPath,
    128,
    'active extension release signature SHA-256',
  ).toString('utf8');
  if (signatureShaText !== `${approval.releaseSignatureSha256}\n`) {
    fail('active extension release signature SHA-256 does not match website approval');
  }
  return {
    activeRoot,
    candidateRoot,
    deployedCommitPath,
    releaseSignaturePath,
  };
}

function assertActiveDeploymentUnchanged(input, deployment, expectedGitCommit) {
  if (realPath(input.activeDeployedCommitPath, 'active DEPLOYED_COMMIT')
      !== deployment.deployedCommitPath
    || activeCommit(deployment.deployedCommitPath) !== expectedGitCommit) {
    fail('active deployment changed before website publication pointer switch');
  }
}

function assertExactCandidate(candidateRoot, evidence, evidenceFilename) {
  const root = lstatSync(candidateRoot);
  const entries = readdirSync(candidateRoot, { withFileTypes: true });
  const expected = [
    evidenceFilename,
    evidence.checksumFilename,
    evidence.artifacts.cloud.filename,
    evidence.artifacts.local.filename,
  ].sort();
  if (!root.isDirectory() || root.isSymbolicLink()
    || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())
    || JSON.stringify(entries.map((entry) => entry.name).sort()) !== JSON.stringify(expected)) {
    fail('active deployed extension candidate must contain exactly the approved four files');
  }
}

function syncPointerAndVerify(pointerPath, expectedBytes) {
  if (process.platform !== 'win32') {
    let descriptor = null;
    try {
      descriptor = openSync(pointerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      fsyncSync(descriptor);
    } finally {
      if (descriptor !== null) closeSync(descriptor);
    }
    const directoryDescriptor = openSync(path.dirname(pointerPath), 'r');
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  }
  const confirmed = readStablePublicationFile(
    pointerPath,
    16_384,
    'website publication pointer',
  );
  if (!confirmed.equals(expectedBytes)) {
    fail('website publication pointer changed during durability confirmation');
  }
}

function verifyCandidate(candidateRoot, evidence) {
  const result = spawnSync(process.execPath, [
    'scripts/stage-extension-release.mjs',
    '--build-root', candidateRoot,
    '--verify-output-dir', candidateRoot,
    '--target-git-commit', evidence.gitCommit,
    '--expected-web-origin', evidence.expectedOrigins.web,
    '--expected-admin-origin', evidence.expectedOrigins.admin,
    '--expected-api-origin', evidence.expectedOrigins.api,
    '--expected-local-origin', evidence.expectedOrigins.local,
  ], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail('website publication candidate verification failed');
}

function exactBundleFiles(root, expected) {
  const rootNames = readdirSync(root).sort();
  if (JSON.stringify(rootNames) !== JSON.stringify(['DEPLOYED_COMMIT', 'candidate', 'publication'])) {
    fail('website publication bundle has an invalid file set');
  }
  for (const directory of ['candidate', 'publication']) {
    const entry = lstatSync(path.join(root, directory));
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      fail('website publication bundle contains an unsafe directory');
    }
  }
  const candidateNames = readdirSync(path.join(root, 'candidate')).sort();
  const publicationNames = readdirSync(path.join(root, 'publication')).sort();
  const expectedCandidateNames = [...expected.keys()]
    .filter((name) => name.startsWith('candidate/'))
    .map((name) => name.slice('candidate/'.length))
    .sort();
  const expectedPublicationNames = [...expected.keys()]
    .filter((name) => name.startsWith('publication/'))
    .map((name) => name.slice('publication/'.length))
    .sort();
  if (JSON.stringify(candidateNames) !== JSON.stringify(expectedCandidateNames)
    || JSON.stringify(publicationNames) !== JSON.stringify(expectedPublicationNames)) {
    fail('website publication bundle has an invalid file set');
  }
  for (const [relative, bytes] of expected) {
    const file = path.join(root, relative);
    const actual = readStablePublicationFile(
      file,
      Math.max(bytes.length, 1),
      `website publication bundle ${relative}`,
    );
    if (!actual.equals(bytes)) fail(`website publication bundle ${relative} changed`);
  }
}

function installBundle(publicationRoot, approvalSha256, expected) {
  const bundlesRoot = path.join(publicationRoot, 'bundles');
  const finalRoot = path.join(bundlesRoot, approvalSha256);
  const existing = lstatSync(finalRoot, { throwIfNoEntry: false });
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      fail('website publication bundle path is unsafe');
    }
    exactBundleFiles(finalRoot, expected);
    return finalRoot;
  }
  const temporary = path.join(
    bundlesRoot,
    `.install-${approvalSha256}-${process.pid}`,
  );
  if (lstatSync(temporary, { throwIfNoEntry: false })) {
    fail('website publication temporary bundle path already exists');
  }
  mkdirSync(temporary, { mode: 0o755 });
  try {
    mkdirSync(path.join(temporary, 'candidate'), { mode: 0o755 });
    mkdirSync(path.join(temporary, 'publication'), { mode: 0o755 });
    for (const [relative, bytes] of expected) {
      writeNewArtifactDurably(path.join(temporary, relative), bytes, { mode: 0o644 });
    }
    for (const directory of [temporary, path.join(temporary, 'candidate'), path.join(temporary, 'publication')]) {
      chmodSync(directory, 0o755);
    }
    exactBundleFiles(temporary, expected);
    renameSync(temporary, finalRoot);
    exactBundleFiles(finalRoot, expected);
    return finalRoot;
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

export function activateExtensionWebsitePublication(input) {
  const requireRoot = input.requireRoot !== false;
  if (requireRoot && process.platform !== 'win32' && process.geteuid() !== 0) {
    fail('website publication activation must run as root');
  }
  const ownerUid = process.platform === 'win32' ? 0 : process.geteuid();
  const enforceSecureTree = input.enforceSecureTree !== false;
  const publicationRoot = assertSecureDirectoryTree(
    input.publicationRoot,
    ownerUid,
    enforceSecureTree,
  );
  const bundlesRoot = assertSecureDirectoryTree(
    path.join(publicationRoot, 'bundles'),
    ownerUid,
    enforceSecureTree,
  );
  if (path.dirname(bundlesRoot) !== publicationRoot) fail('website publication bundle root is invalid');

  const approvalVerification = verifyWebsitePublicationApproval({
    approvalPath: input.approvalPath,
    keyringPath: input.keyringPath,
  });
  if (approvalVerification.approvalSha256 !== input.expectedApprovalSha256) {
    fail('website publication approval SHA-256 does not match operator approval');
  }
  const approval = approvalVerification.approval;
  if (approval.distributionOrigin !== input.expectedDistributionOrigin
    || approval.region !== input.expectedRegion) {
    fail('website publication approval does not match this deployment region');
  }
  const deployment = resolveActiveDeployment(input, approval);
  const candidateRoot = deployment.candidateRoot;
  const evidencePath = path.join(candidateRoot, approval.releaseEvidenceFilename);
  const evidenceFile = canonicalEvidence(evidencePath);
  assertExactCandidate(candidateRoot, evidenceFile.evidence, approval.releaseEvidenceFilename);
  if (evidenceFile.evidence.gitCommit !== approval.gitCommit
    || evidenceFile.evidence.version !== approval.version
    || evidenceFile.evidence.expectedOrigins.api !== approval.distributionOrigin
    || sha256(evidenceFile.bytes) !== approval.releaseEvidenceSha256
    || activeCommit(deployment.deployedCommitPath) !== approval.gitCommit) {
    fail('website publication approval does not match the active release candidate');
  }
  (input.verifyCandidate || verifyCandidate)(candidateRoot, evidenceFile.evidence);

  const releaseSignatureBytes = readStablePublicationFile(
    deployment.releaseSignaturePath,
    16_384,
    'extension release signature',
  );
  if (path.basename(deployment.releaseSignaturePath) !== approval.releaseSignatureFilename
    || sha256(releaseSignatureBytes) !== approval.releaseSignatureSha256) {
    fail('website publication release signature does not match approval');
  }
  const signatureVerification = verifyExtensionReleaseSignature({
    buildRoot: candidateRoot,
    signaturePath: deployment.releaseSignaturePath,
    expectedSignatureSha256: approval.releaseSignatureSha256,
    expectedGitCommit: approval.gitCommit,
    keyringPath: input.keyringPath,
  });
  if (signatureVerification.keyId !== approval.keyId
    || Date.parse(approval.approvedAt) < Date.parse(signatureVerification.signedAt)) {
    fail('website publication approval does not match the release signature authority');
  }
  const darkCanary = verifyRel04DarkCanaryEvidence({
    darkCanaryPath: input.darkCanaryPath,
    expectedSha256: approval.darkCanarySha256,
    expectedGitCommit: approval.gitCommit,
    expectedApiOrigin: evidenceFile.evidence.expectedOrigins.api,
    approvedAt: approval.approvedAt,
    now: input.now,
  });
  if (path.basename(input.darkCanaryPath) !== approval.darkCanaryFilename) {
    fail('website publication dark canary filename does not match approval');
  }
  if (Date.parse(darkCanary.observedAt) < Date.parse(signatureVerification.signedAt)) {
    fail('REL-04 dark canary observation predates the release signature');
  }

  const approvalFilename =
    `ss-erp-extension-${approval.version}.website-publication-approval.json`;
  if (path.basename(input.approvalPath) !== approvalFilename) {
    fail('website publication approval filename is invalid');
  }
  const expected = new Map([
    ['DEPLOYED_COMMIT', Buffer.from(`${approval.gitCommit}\n`, 'utf8')],
    [`candidate/${approval.releaseEvidenceFilename}`, evidenceFile.bytes],
    [`candidate/${evidenceFile.evidence.checksumFilename}`, readStablePublicationFile(
      path.join(candidateRoot, evidenceFile.evidence.checksumFilename),
      4096,
      'extension release checksum',
    )],
    ...(['cloud', 'local'].map((target) => {
      const artifact = evidenceFile.evidence.artifacts[target];
      return [`candidate/${artifact.filename}`, readStablePublicationFile(
        path.join(candidateRoot, artifact.filename),
        100 * 1024 * 1024,
        `${target} extension release archive`,
      )];
    })),
    [`publication/${approvalFilename}`, approvalVerification.approvalBytes],
    [`publication/${approval.releaseSignatureFilename}`, releaseSignatureBytes],
    [`publication/${approval.darkCanaryFilename}`, darkCanary.bytes],
  ]);
  const bundleRoot = installBundle(
    publicationRoot,
    approvalVerification.approvalSha256,
    expected,
  );

  const pointerPath = path.join(publicationRoot, WEBSITE_PUBLICATION_POINTER_FILENAME);
  const pointerBytes = Buffer.from(canonicalWebsitePublicationApprovalJson(
    parseWebsitePublicationApproval(approval),
  ), 'utf8');
  const pointer = lstatSync(pointerPath, { throwIfNoEntry: false });
  let currentSha256 = 'NONE';
  let currentBytes = null;
  if (pointer) {
    if (!pointer.isFile() || pointer.isSymbolicLink()) {
      fail('website publication pointer must be one regular file');
    }
    currentBytes = readStablePublicationFile(
      pointerPath,
      16_384,
      'website publication pointer',
    );
    currentSha256 = sha256(currentBytes);
  }
  const result = (status) => ({
    schemaVersion: 1,
    status,
    region: approval.region,
    gitCommit: approval.gitCommit,
    version: approval.version,
    approvalSha256: approvalVerification.approvalSha256,
    previousApprovalSha256: currentSha256,
    bundle: path.basename(bundleRoot),
  });
  if (currentBytes?.equals(pointerBytes)) {
    assertActiveDeploymentUnchanged(input, deployment, approval.gitCommit);
    try {
      syncPointerAndVerify(pointerPath, pointerBytes);
      return result('ALREADY_ACTIVATED');
    } catch {
      return result('UNKNOWN_OUTCOME');
    }
  }
  if (input.expectedCurrentApprovalSha256 !== currentSha256) {
    fail('website publication pointer compare-and-swap precondition failed');
  }
  assertActiveDeploymentUnchanged(input, deployment, approval.gitCommit);
  try {
    (input.replacePointer || replaceArtifactDurably)(pointerPath, pointerBytes, { mode: 0o644 });
    syncPointerAndVerify(pointerPath, pointerBytes);
    return result('ACTIVATED');
  } catch (error) {
    try {
      const after = readStablePublicationFile(
        pointerPath,
        16_384,
        'website publication pointer',
      );
      if (after.equals(pointerBytes)) return result('UNKNOWN_OUTCOME');
    } catch {
      // Preserve the original failure when the desired pointer is not readable.
    }
    throw error;
  }
}

function cliOptions() {
  const required = new Set([
    '--active-deployed-commit',
    '--approval',
    '--candidate-root',
    '--dark-canary',
    '--deploy-lock',
    '--expected-approval-sha256',
    '--expected-current-approval-sha256',
    '--expected-distribution-origin',
    '--expected-region',
    '--keyring',
    '--publication-root',
    '--release-signature',
  ]);
  const args = process.argv.slice(2);
  const values = new Map();
  if (args.length !== required.size * 2) fail('website publication activation options are incomplete');
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!required.has(name) || values.has(name) || !value || value.startsWith('--')) {
      fail('website publication activation options are invalid');
    }
    values.set(name, value);
  }
  const expectedCurrent = values.get('--expected-current-approval-sha256');
  if (expectedCurrent !== 'NONE' && !/^[a-f0-9]{64}$/u.test(expectedCurrent)) {
    fail('expected current approval SHA-256 must be NONE or one digest');
  }
  return {
    activeDeployedCommitPath: values.get('--active-deployed-commit'),
    approvalPath: values.get('--approval'),
    candidateRoot: values.get('--candidate-root'),
    darkCanaryPath: values.get('--dark-canary'),
    deployLockPath: values.get('--deploy-lock'),
    expectedApprovalSha256: values.get('--expected-approval-sha256'),
    expectedCurrentApprovalSha256: expectedCurrent,
    expectedDistributionOrigin: values.get('--expected-distribution-origin'),
    expectedRegion: values.get('--expected-region'),
    keyringPath: values.get('--keyring'),
    publicationRoot: values.get('--publication-root'),
    releaseSignaturePath: values.get('--release-signature'),
  };
}

export function assertDeployLockFile(file) {
  if (file !== WEBSITE_PUBLICATION_DEPLOY_LOCK_PATH
    || (process.platform !== 'win32'
      && path.resolve(file) !== WEBSITE_PUBLICATION_DEPLOY_LOCK_PATH)) {
    fail('website publication must use the canonical deployment lock');
  }
  if (process.platform === 'win32') return;
  const entry = lstatSync(file, { bigint: true, throwIfNoEntry: false });
  if (!entry?.isFile() || entry.isSymbolicLink() || entry.nlink !== 1n
    || entry.uid !== 0n || (entry.mode & 0o777n) !== 0o660n
    || realpathSync.native(file) !== WEBSITE_PUBLICATION_DEPLOY_LOCK_PATH) {
    fail('website publication deploy lock must be one root-owned 0660 regular file');
  }
}

function runLocked(options) {
  if (process.platform === 'win32' || process.env.SS_ERP_WEBSITE_PUBLICATION_LOCK_HELD === '1') {
    return null;
  }
  assertDeployLockFile(options.deployLockPath);
  const result = spawnSync('flock', [
    '--exclusive', '--nonblock', options.deployLockPath,
    process.execPath, path.resolve(process.argv[1]), ...process.argv.slice(2),
  ], {
    cwd: process.cwd(),
    env: { ...process.env, SS_ERP_WEBSITE_PUBLICATION_LOCK_HELD: '1' },
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status ?? 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = cliOptions();
    const lockedStatus = runLocked(options);
    if (lockedStatus !== null) {
      process.exitCode = lockedStatus;
    } else {
      const result = activateExtensionWebsitePublication(options);
      console.log(JSON.stringify(result, null, 2));
      if (result.status === 'UNKNOWN_OUTCOME') process.exitCode = 2;
    }
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
