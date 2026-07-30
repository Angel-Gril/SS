import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeNewArtifactDurably } from './extension-release-artifact.mjs';
import {
  canonicalExtensionReleaseEvidenceJson,
  resolveExtensionReleaseProvenance,
} from './extension-release-contract.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-erp-extension-bump-'));
const sourceDir = path.join(root, 'source');
const outDir = path.join(root, 'out');
const previousBuildRoot = path.join(root, 'previous');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const repositoryManifest = JSON.parse(fs.readFileSync('extensions/ss-erp/manifest.json', 'utf8'));
const expectedOrigins = {
  web: 'https://release-web.fixture.example',
  admin: 'https://release-admin.fixture.example',
  api: 'https://release-api.fixture.example',
};

assert.equal(
  packageJson.scripts['package:extension'],
  'node scripts/package-extension-release.mjs',
  'the formal release command must coordinate cloud and local packages',
);
assert.equal(
  repositoryManifest.version,
  '1.0.264',
  'the canonical release migration floor must not be lower than the latest verified legacy package',
);

function writeManifest(dir, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    `${JSON.stringify({
      manifest_version: 3,
      name: 'SS ERP Test Extension',
      short_name: 'SS ERP',
      version,
      permissions: [],
      content_scripts: [],
      web_accessible_resources: [],
    }, null, 2)}\n`,
  );
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function writeHistoricalRelease(directory, version) {
  const artifacts = {};
  for (const target of ['cloud', 'local']) {
    writeManifest(path.join(directory, `ss-erp-${target}`), version);
    const filename = `ss-erp-${target}-${version}.zip`;
    const bytes = Buffer.from(`historical ${target} ${version}\n`);
    fs.writeFileSync(path.join(directory, filename), bytes);
    artifacts[target] = {
      target,
      filename,
      zipSha256: sha256Bytes(bytes),
      fileCount: 1,
    };
  }
  const checksumFilename = `ss-erp-extension-${version}.sha256`;
  fs.writeFileSync(
    path.join(directory, checksumFilename),
    `${artifacts.cloud.zipSha256}  ${artifacts.cloud.filename}\n`
      + `${artifacts.local.zipSha256}  ${artifacts.local.filename}\n`,
  );
  const gitCommit = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).stdout.trim().toLowerCase();
  fs.writeFileSync(
    path.join(directory, `ss-erp-extension-${version}.release-evidence.json`),
    canonicalExtensionReleaseEvidenceJson({
      schemaVersion: 1,
      gitCommit,
      provenance: {
        commitSource: 'GIT_HEAD',
        sourceMode: 'REPOSITORY_SOURCE',
        packageInputsSha256: 'a'.repeat(64),
      },
      version,
      expectedOrigins,
      artifacts,
      checksumFilename,
      signature: { status: 'EXTERNAL_REQUIRED' },
    }),
  );
}

function archiveEntries(buffer) {
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const endOffset = buffer.lastIndexOf(endSignature);
  assert.notEqual(endOffset, -1, 'test ZIP must contain an end-of-central-directory record');
  const totalEntries = buffer.readUInt16LE(endOffset + 10);
  let cursor = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  for (let index = 0; index < totalEntries; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    assert.equal(localNameLength, nameLength);
    entries.push({
      name: buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'),
      nameLength,
      centralNameOffset: cursor + 46,
      localNameOffset: localOffset + 30,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function renameArchiveEntry(buffer, entry, nextName) {
  const name = Buffer.from(nextName, 'utf8');
  assert.equal(name.length, entry.nameLength, 'replacement ZIP entry name must preserve byte length');
  name.copy(buffer, entry.centralNameOffset);
  name.copy(buffer, entry.localNameOffset);
}

fs.cpSync(path.resolve('extensions/ss-erp'), sourceDir, { recursive: true });
const sourceManifestPath = path.join(sourceDir, 'manifest.json');
const sourceTemplateManifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));
sourceTemplateManifest.version = repositoryManifest.version;
fs.writeFileSync(sourceManifestPath, `${JSON.stringify(sourceTemplateManifest, null, 2)}\n`);
writeHistoricalRelease(previousBuildRoot, '1.0.22');
writeHistoricalRelease(previousBuildRoot, '98.0.0');
fs.appendFileSync(
  path.join(previousBuildRoot, 'ss-erp-cloud-98.0.0.zip'),
  'corrupted after evidence\n',
);
fs.writeFileSync(path.join(previousBuildRoot, 'ss-erp-cloud-99.0.0.zip'), 'orphan high zip\n');

const atomicDirectory = path.join(root, 'atomic');
fs.mkdirSync(atomicDirectory);
const existingArtifact = path.join(atomicDirectory, 'existing.zip');
fs.writeFileSync(existingArtifact, 'retained');
assert.throws(
  () => writeNewArtifactDurably(existingArtifact, Buffer.from('replacement')),
  /EEXIST|exist/u,
  'durable artifact creation must never replace an existing release file',
);
assert.equal(fs.readFileSync(existingArtifact, 'utf8'), 'retained');
assert.deepEqual(fs.readdirSync(atomicDirectory), ['existing.zip'], 'failed writes must clean temporary files');

const provenanceDigest = 'b'.repeat(64);
assert.deepEqual(resolveExtensionReleaseProvenance({
  deployedCommit: '1'.repeat(40),
  gitCommit: '2'.repeat(40),
  sourceMode: 'REPOSITORY_SOURCE',
  gitStatus: ' M extensions/ss-erp/manifest.json\n',
  packageInputsSha256: provenanceDigest,
}), {
  gitCommit: '1'.repeat(40),
  provenance: {
    commitSource: 'DEPLOYED_COMMIT',
    sourceMode: 'REPOSITORY_SOURCE',
    packageInputsSha256: provenanceDigest,
  },
}, 'archive provenance must prefer full DEPLOYED_COMMIT over a parent repository HEAD');
assert.throws(
  () => resolveExtensionReleaseProvenance({
    gitCommit: '2'.repeat(40),
    sourceMode: 'REPOSITORY_SOURCE',
    gitStatus: '?? extensions/ss-erp/untracked.js\n',
    packageInputsSha256: provenanceDigest,
  }),
  /differ from Git HEAD/u,
  'repository-source releases must reject tracked or untracked package-input drift',
);
assert.deepEqual(resolveExtensionReleaseProvenance({
  gitCommit: '2'.repeat(40),
  sourceMode: 'EXTERNAL_SOURCE',
  gitStatus: ' M scripts/verify-extension-package.mjs\n',
  packageInputsSha256: provenanceDigest,
}).provenance, {
  commitSource: 'GIT_HEAD',
  sourceMode: 'EXTERNAL_SOURCE',
  packageInputsSha256: provenanceDigest,
}, 'external fixture sources must disclose and bind package inputs instead of claiming a clean HEAD');
assert.throws(
  () => resolveExtensionReleaseProvenance({
    deployedCommit: 'abc1234',
    gitCommit: '2'.repeat(40),
    sourceMode: 'REPOSITORY_SOURCE',
    gitStatus: '',
    packageInputsSha256: provenanceDigest,
  }),
  /full 40-character/u,
);

function packageRelease(outputDirectory = outDir, extraEnvironment = {}) {
  return spawnSync(process.execPath, ['scripts/package-extension-release.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      EXTENSION_SOURCE_DIR: sourceDir,
      EXTENSION_OUT_DIR: outputDirectory,
      EXTENSION_PREVIOUS_BUILD_ROOT: previousBuildRoot,
      EXTENSION_CLOUD_BASE_URL: expectedOrigins.web,
      NEXT_PUBLIC_ADMIN_HOSTNAME: new URL(expectedOrigins.admin).hostname,
      NEXT_PUBLIC_API_BASE_URL: expectedOrigins.api,
      EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN: expectedOrigins.web,
      EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN: expectedOrigins.admin,
      EXTENSION_RELEASE_EXPECTED_API_ORIGIN: expectedOrigins.api,
      ...extraEnvironment,
    },
    maxBuffer: 32 * 1024 * 1024,
  });
}

const lockedOutDir = path.join(root, 'locked-out');
fs.mkdirSync(lockedOutDir);
const lockPath = path.join(lockedOutDir, '.ss-erp-extension-release.lock');
fs.writeFileSync(lockPath, 'held by test\n');
const lockedPackage = packageRelease(lockedOutDir);
assert.notEqual(lockedPackage.status, 0, 'an active release lock must reject a concurrent package run');
assert.match(`${lockedPackage.stdout}\n${lockedPackage.stderr}`, /holds the lock/u);
assert.equal(fs.readFileSync(lockPath, 'utf8'), 'held by test\n', 'a rejected process must not remove another lock');
assert.deepEqual(fs.readdirSync(lockedOutDir), ['.ss-erp-extension-release.lock']);
fs.rmSync(lockPath);

const missingExpectedOutDir = path.join(root, 'missing-expected-out');
const missingExpected = packageRelease(missingExpectedOutDir, {
  EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN: '',
});
assert.notEqual(missingExpected.status, 0, 'formal release must require every explicit expected origin');
assert.match(`${missingExpected.stdout}\n${missingExpected.stderr}`, /canonical public HTTPS origin/u);
assert.deepEqual(
  fs.existsSync(missingExpectedOutDir) ? fs.readdirSync(missingExpectedOutDir) : [],
  [],
  'missing approval evidence must not leave release artifacts',
);

const mismatchedExpectedOutDir = path.join(root, 'mismatched-expected-out');
const mismatchedExpected = packageRelease(mismatchedExpectedOutDir, {
  EXTENSION_CLOUD_BASE_URL: 'https://unapproved-build.fixture.example',
});
assert.notEqual(
  mismatchedExpected.status,
  0,
  'formal release must not treat build-derived origins as independent approval evidence',
);
assert.match(
  `${mismatchedExpected.stdout}\n${mismatchedExpected.stderr}`,
  /do not exactly match independently approved release origins/u,
);
assert.deepEqual(
  fs.existsSync(mismatchedExpectedOutDir) ? fs.readdirSync(mismatchedExpectedOutDir) : [],
  [],
  'origin mismatch must clean build and release artifacts',
);

const failedOutDir = path.join(root, 'failed-out');
const failedPackage = packageRelease(failedOutDir, { STRICT_EXTENSION_CHECK: '1' });
assert.notEqual(failedPackage.status, 0, 'a strict local-package warning must abort the release fixture');
for (const target of ['cloud', 'local']) {
  assert.equal(
    fs.existsSync(path.join(failedOutDir, `ss-erp-${target}`)),
    false,
    `failed release must remove the ${target} build directory`,
  );
}
assert.deepEqual(
  fs.existsSync(failedOutDir) ? fs.readdirSync(failedOutDir) : [],
  [],
  'failed release must not retain ZIP, checksum, lock, or temporary artifacts',
);

writeManifest(path.join(outDir, 'ss-erp-cloud'), '9.9.9');
writeManifest(path.join(outDir, 'ss-erp-local'), '9.9.9');
const packageResult = packageRelease();
assert.equal(packageResult.status, 0, `${packageResult.stdout}\n${packageResult.stderr}`);

const sourceManifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'));

for (const target of ['cloud', 'local']) {
  const builtManifest = JSON.parse(
    fs.readFileSync(path.join(outDir, `ss-erp-${target}`, 'manifest.json'), 'utf8'),
  );
  assert.equal(builtManifest.version, '1.0.265');
  assert.ok(fs.existsSync(path.join(outDir, `ss-erp-${target}-1.0.265.zip`)));
}
assert.equal(sourceManifest.version, '1.0.264', 'source manifest should not be mutated by package builds');

const checksumPath = path.join(outDir, 'ss-erp-extension-1.0.265.sha256');
const evidencePath = path.join(outDir, 'ss-erp-extension-1.0.265.release-evidence.json');
assert.equal(fs.existsSync(checksumPath), true, 'release packaging must retain one checksum manifest');
assert.equal(fs.existsSync(evidencePath), true, 'release packaging must retain canonical release evidence');
const checksumLines = fs.readFileSync(checksumPath, 'utf8').trim().split('\n');
assert.equal(checksumLines.length, 2, 'checksum manifest must contain exactly two packages');
assert.match(checksumLines[0], /^[a-f0-9]{64} {2}ss-erp-cloud-1\.0\.265\.zip$/u);
assert.match(checksumLines[1], /^[a-f0-9]{64} {2}ss-erp-local-1\.0\.265\.zip$/u);

const evidenceText = fs.readFileSync(evidencePath, 'utf8');
const evidence = JSON.parse(evidenceText);
assert.equal(evidenceText, `${JSON.stringify(evidence, null, 2)}\n`);
assert.equal(evidence.schemaVersion, 1);
assert.match(evidence.gitCommit, /^[a-f0-9]{40}$/u);
assert.equal(evidence.provenance.commitSource, 'GIT_HEAD');
assert.equal(evidence.provenance.sourceMode, 'EXTERNAL_SOURCE');
assert.match(evidence.provenance.packageInputsSha256, /^[a-f0-9]{64}$/u);
assert.equal(evidence.version, '1.0.265');
assert.deepEqual(evidence.expectedOrigins, expectedOrigins);
assert.equal(evidence.checksumFilename, path.basename(checksumPath));
assert.deepEqual(evidence.signature, { status: 'EXTERNAL_REQUIRED' });
for (const target of ['cloud', 'local']) {
  assert.deepEqual(evidence.artifacts[target], {
    target,
    filename: `ss-erp-${target}-1.0.265.zip`,
    zipSha256: checksumLines[target === 'cloud' ? 0 : 1].slice(0, 64),
    fileCount: archiveEntries(
      fs.readFileSync(path.join(outDir, `ss-erp-${target}-1.0.265.zip`)),
    ).length,
  });
}

function releaseOriginArgs(origins = expectedOrigins) {
  return [
    '--expected-web-origin',
    origins.web,
    '--expected-admin-origin',
    origins.admin,
    '--expected-api-origin',
    origins.api,
  ];
}

const verifyRelease = (origins = expectedOrigins) => spawnSync(
  process.execPath,
  [
    'scripts/verify-extension-release.mjs',
    '--checksum',
    checksumPath,
    '--evidence',
    evidencePath,
    ...releaseOriginArgs(origins),
  ],
  {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, EXTENSION_SOURCE_DIR: sourceDir },
    maxBuffer: 32 * 1024 * 1024,
  },
);
const verification = verifyRelease();
assert.equal(verification.status, 0, `${verification.stdout}\n${verification.stderr}`);

const sourceManifestBeforeDrift = fs.readFileSync(sourceManifestPath);
fs.appendFileSync(sourceManifestPath, '\n');
const sourceDriftVerification = verifyRelease();
assert.notEqual(
  sourceDriftVerification.status,
  0,
  'release verification must independently recompute and reject changed package inputs',
);
assert.match(
  `${sourceDriftVerification.stdout}\n${sourceDriftVerification.stderr}`,
  /package inputs changed after provenance capture/u,
);
fs.writeFileSync(sourceManifestPath, sourceManifestBeforeDrift);

const cloudDirectory = path.join(outDir, 'ss-erp-cloud');
const cloudManifestPath = path.join(cloudDirectory, 'manifest.json');
const deploymentDefaultsPath = path.join(
  cloudDirectory,
  'shared/erp-adapter/deployment-defaults.js',
);

function verifyCloudPackage(origins = expectedOrigins) {
  return spawnSync(
    process.execPath,
    [
      'scripts/verify-extension-package.mjs',
      '--dir',
      cloudDirectory,
      '--target',
      'cloud',
      '--strict',
      ...releaseOriginArgs(origins),
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
}

const approvedCloudPackage = verifyCloudPackage();
assert.equal(
  approvedCloudPackage.status,
  0,
  `${approvedCloudPackage.stdout}\n${approvedCloudPackage.stderr}`,
);

for (const key of ['web', 'admin', 'api']) {
  const drifted = {
    ...expectedOrigins,
    [key]: `https://unexpected-${key}.fixture.example`,
  };
  const result = verifyCloudPackage(drifted);
  assert.notEqual(result.status, 0, `${key} expected-origin drift must fail strict verification`);
}

const originalDeploymentDefaults = fs.readFileSync(deploymentDefaultsPath, 'utf8');
fs.writeFileSync(
  deploymentDefaultsPath,
  originalDeploymentDefaults.replace(
    expectedOrigins.api,
    'https://unexpected-default.fixture.example',
  ),
);
const defaultsDrift = verifyCloudPackage();
assert.notEqual(defaultsDrift.status, 0, 'deployment-defaults origin drift must fail verification');
fs.writeFileSync(deploymentDefaultsPath, originalDeploymentDefaults);

const originalCloudManifestText = fs.readFileSync(cloudManifestPath, 'utf8');
const unknownManifestOrigin = 'https://unapproved-erp.fixture.example/*';
for (const [label, mutate] of [
  ['externally_connectable', (manifest) => manifest.externally_connectable.matches.push(
    unknownManifestOrigin,
  )],
  ['ERP bridge', (manifest) => manifest.content_scripts
    .find((script) => script.js?.includes('content/erp-collect-bridge.js'))
    .matches.push(unknownManifestOrigin)],
  ['API host permission', (manifest) => manifest.host_permissions.push(unknownManifestOrigin)],
  ['non-ERP content script', (manifest) => manifest.content_scripts
    .find((script) => !script.js?.includes('content/erp-collect-bridge.js'))
    .matches.push(unknownManifestOrigin)],
  ['web accessible resource', (manifest) => manifest.web_accessible_resources[0]
    .matches.push(unknownManifestOrigin)],
]) {
  const manifest = JSON.parse(originalCloudManifestText);
  mutate(manifest);
  fs.writeFileSync(cloudManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const result = verifyCloudPackage();
  assert.notEqual(result.status, 0, `${label} unknown origin drift must fail verification`);
  fs.writeFileSync(cloudManifestPath, originalCloudManifestText);
}

for (const key of ['web', 'admin', 'api']) {
  const drifted = {
    ...expectedOrigins,
    [key]: `https://unexpected-release-${key}.fixture.example`,
  };
  const result = verifyRelease(drifted);
  assert.notEqual(result.status, 0, `${key} release evidence expectation drift must fail`);
  assert.match(`${result.stdout}\n${result.stderr}`, /does not match explicit expectation/u);
}

fs.writeFileSync(evidencePath, `${JSON.stringify({ ...evidence, unexpected: true }, null, 2)}\n`);
const extraEvidenceField = verifyRelease();
assert.notEqual(extraEvidenceField.status, 0, 'release evidence must reject unknown schema fields');
assert.match(`${extraEvidenceField.stdout}\n${extraEvidenceField.stderr}`, /must contain exactly/u);
fs.writeFileSync(evidencePath, evidenceText);

const wrongEntryCountEvidence = structuredClone(evidence);
wrongEntryCountEvidence.artifacts.cloud.fileCount += 1;
fs.writeFileSync(evidencePath, `${JSON.stringify(wrongEntryCountEvidence, null, 2)}\n`);
const wrongEntryCount = verifyRelease();
assert.notEqual(wrongEntryCount.status, 0, 'release evidence must bind the exact ZIP entry count');
assert.match(`${wrongEntryCount.stdout}\n${wrongEntryCount.stderr}`, /entry count mismatch/u);
fs.writeFileSync(evidencePath, evidenceText);

const cloudZipPath = path.join(outDir, 'ss-erp-cloud-1.0.265.zip');
const validCloudZip = fs.readFileSync(cloudZipPath);
const validEntries = archiveEntries(validCloudZip);
const manifestEntry = validEntries.find((entry) => entry.name === 'ss-erp-cloud/manifest.json');
assert.ok(manifestEntry, 'test ZIP must contain manifest.json');

function expectArchiveNameRejected(label, mutate, expectedPattern) {
  const bytes = Buffer.from(validCloudZip);
  mutate(bytes);
  const zipPath = path.join(root, `${label}.zip`);
  fs.writeFileSync(zipPath, bytes);
  const result = spawnSync(
    process.execPath,
    ['scripts/verify-extension-archive.mjs', '--zip', zipPath, '--target', 'cloud', '--version', '1.0.265'],
    { cwd: process.cwd(), encoding: 'utf8', env: process.env },
  );
  assert.notEqual(result.status, 0, `${label} ZIP entry name must be rejected`);
  assert.match(`${result.stdout}\n${result.stderr}`, expectedPattern);
}

expectArchiveNameRejected('colon-path', (bytes) => {
  renameArchiveEntry(bytes, manifestEntry, 'ss-erp-cloud/manifest:json');
}, /unsafe ZIP entry/u);
expectArchiveNameRejected('control-path', (bytes) => {
  renameArchiveEntry(bytes, manifestEntry, 'ss-erp-cloud/\u0001anifest.json');
}, /unsafe ZIP entry/u);
expectArchiveNameRejected('trailing-space-path', (bytes) => {
  renameArchiveEntry(bytes, manifestEntry, 'ss-erp-cloud/manifest.jso ');
}, /unsafe ZIP entry/u);
expectArchiveNameRejected('non-nfc-path', (bytes) => {
  renameArchiveEntry(bytes, manifestEntry, 'ss-erp-cloud/e\u0301ifest.json');
}, /canonical NFC/u);

const sameLengthPair = validEntries
  .map((entry, index) => ({ entry, index }))
  .find(({ entry, index }) => {
    const relative = entry.name.slice('ss-erp-cloud/'.length);
    if (!relative || relative.toUpperCase() === relative) return false;
    return validEntries.slice(index + 1).some((candidate) => candidate.nameLength === entry.nameLength);
  });
assert.ok(sameLengthPair, 'test ZIP must contain two same-length entry names');
const collisionTarget = validEntries
  .slice(sameLengthPair.index + 1)
  .find((candidate) => candidate.nameLength === sameLengthPair.entry.nameLength);
const collisionRelative = sameLengthPair.entry.name.slice('ss-erp-cloud/'.length).toUpperCase();
expectArchiveNameRejected('case-collision-path', (bytes) => {
  renameArchiveEntry(bytes, collisionTarget, `ss-erp-cloud/${collisionRelative}`);
}, /portable ZIP entry collision/u);

const tamperedZip = Buffer.from(validCloudZip);
tamperedZip[100] ^= 0xff;
fs.writeFileSync(cloudZipPath, tamperedZip);
const tamperedVerification = verifyRelease();
assert.notEqual(tamperedVerification.status, 0, 'recorded SHA-256 must reject a changed ZIP');
assert.match(
  `${tamperedVerification.stdout}\n${tamperedVerification.stderr}`,
  /SHA-256 mismatch/u,
);
const tamperedArchiveVerification = spawnSync(
  process.execPath,
  [
    'scripts/verify-extension-archive.mjs',
    '--zip',
    cloudZipPath,
    '--target',
    'cloud',
    '--version',
    '1.0.265',
  ],
  { cwd: process.cwd(), encoding: 'utf8', env: process.env },
);
assert.notEqual(tamperedArchiveVerification.status, 0, 'ZIP CRC verification must reject changed bytes');
assert.match(
  `${tamperedArchiveVerification.stdout}\n${tamperedArchiveVerification.stderr}`,
  /ZIP CRC-32 mismatch/u,
);

for (const file of [
  'scripts/deploy.sh',
  'scripts/deploy-app-dir.sh',
  'scripts/deploy-staging.sh',
]) {
  const deployer = fs.readFileSync(file, 'utf8');
  assert.match(
    deployer,
    /pnpm package:extension(?:\s|"|$)/u,
    `${file} must use the coordinated extension release command`,
  );
  assert.doesNotMatch(
    deployer,
    /package:extension:(?:cloud|local)/u,
    `${file} must not package release targets independently`,
  );
  assert.equal(
    (deployer.match(/EXTENSION_PREVIOUS_BUILD_ROOT=/gu) || []).length,
    1,
    `${file} must pass the previous release once to the coordinator`,
  );
}

const releaseDeployer = fs.readFileSync('scripts/deploy.sh', 'utf8');
assert.match(releaseDeployer, /DEPLOY_REF="\$\{1:-HEAD\}"/u);
assert.match(
  releaseDeployer,
  /git rev-parse --verify --end-of-options "\$\{DEPLOY_REF\}\^\{commit\}"/u,
  'release deploy must resolve an explicit ref to a commit before creating its archive',
);
assert.match(
  releaseDeployer,
  /\[\[ ! "\$COMMIT_HASH" =~ \^\[0-9a-f\]\{40\}\$ \]\]/u,
  'release deploy must reject short commit IDs',
);
assert.match(
  releaseDeployer,
  /echo "\$COMMIT_HASH" > "\$RELEASE_DIR\/DEPLOYED_COMMIT"/u,
  'the archive-only release must persist the full commit for formal release evidence',
);
assert.doesNotMatch(releaseDeployer, /git rev-parse --short/u);

console.log('PASS extension package auto bump and deployment targets');
