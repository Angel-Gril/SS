import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeNewArtifactDurably } from './extension-release-artifact.mjs';
import {
  canonicalExtensionReleaseEvidenceJson,
  readExpectedReleaseOrigins,
  resolveExtensionReleaseProvenance,
} from './extension-release-contract.mjs';
import {
  EXTENSION_RELEASE_CONTROLLED_INPUTS,
  extensionReleaseGitEnvironment,
  extensionReleaseGitHead,
  extensionReleaseGitSafeDirectoryArgs,
  extensionReleasePackageInputsSha256,
  extensionReleaseScopedGitStatus,
  materializeExtensionReleaseRepositorySnapshot,
} from './extension-release-inputs.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-erp-extension-bump-'));
const sourceDir = path.join(root, 'source');
const outDir = path.join(root, 'out');
const previousBuildRoot = path.join(root, 'previous');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const packageReleaseSource = fs.readFileSync('scripts/package-extension-release.mjs', 'utf8');
const releaseInputsSource = fs.readFileSync('scripts/extension-release-inputs.mjs', 'utf8');
const verifyReleaseSource = fs.readFileSync('scripts/verify-extension-release.mjs', 'utf8');
const repositoryManifest = JSON.parse(fs.readFileSync('extensions/ss-erp/manifest.json', 'utf8'));
const expectedOrigins = {
  web: 'https://release-web.fixture.example',
  admin: 'https://release-admin.fixture.example',
  api: 'https://release-api.fixture.example',
  local: 'http://127.0.0.1:3001',
};

assert.equal(
  packageJson.scripts['package:extension'],
  'node scripts/package-extension-release.mjs',
  'the formal release command must coordinate cloud and local packages',
);
assert.match(
  releaseInputsSource,
  /'ls-files',[\s\S]*'--ignored',[\s\S]*'--exclude-standard'/u,
  'repository release provenance must reject ignored source files that packaging would copy',
);
assert.equal(
  (releaseInputsSource.match(/\.\.\.extensionReleaseGitSafeDirectoryArgs\(repoRoot\)/gu) || [])
    .length,
  5,
  'all release Git reads must trust only the exact validated repository path',
);
assert.equal(
  repositoryManifest.version,
  '1.0.264',
  'the canonical release migration floor must not be lower than the latest verified legacy package',
);
assert.deepEqual(
  readExpectedReleaseOrigins({
    EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN: expectedOrigins.web,
    EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN: expectedOrigins.admin,
    EXTENSION_RELEASE_EXPECTED_API_ORIGIN: expectedOrigins.api,
  }),
  expectedOrigins,
  'the fixed local release origin must not require an operator environment migration',
);
for (const source of [packageReleaseSource, verifyReleaseSource]) {
  assert.match(
    source,
    /extensionReleaseGitHead\(repoRoot\)/u,
    'formal packaging and verification must share the fail-closed Git HEAD resolver',
  );
}
assert.match(
  packageReleaseSource,
  /materializeExtensionReleaseRepositorySnapshot/u,
  'formal repository releases must build from a Git-blob source snapshot',
);
assert.match(
  packageReleaseSource,
  /path\.join\(packagingRepoRoot, 'scripts\/package-extension-package\.mjs'\)/u,
  'formal repository releases must execute the snapshotted packaging entrypoint',
);
assert.match(
  packageReleaseSource,
  /repositorySnapshotParent = path\.join\(repoRoot, 'build'\)/u,
  'the Git snapshot must stay beneath the repository so snapshotted tools resolve dependencies',
);
assert.match(
  releaseInputsSource,
  /lstatSync\(gitMetadataPath, \{ throwIfNoEntry: false \}\)/u,
  'archive provenance must not inherit Git metadata from an unrelated ancestor checkout',
);
assert.match(
  releaseInputsSource,
  /could not resolve the active extension release Git HEAD/u,
  'release provenance must fail closed when an active checkout Git HEAD cannot be resolved',
);

const ancestorCheckout = path.join(root, 'ancestor-checkout');
const nestedArchive = path.join(ancestorCheckout, 'nested', 'release-archive');
fs.mkdirSync(path.join(ancestorCheckout, '.git'), { recursive: true });
fs.mkdirSync(nestedArchive, { recursive: true });
let nestedArchiveGitCalls = 0;
assert.equal(
  extensionReleaseGitHead(nestedArchive, {
    spawnGit() {
      nestedArchiveGitCalls += 1;
      return { status: 0, stdout: `${'1'.repeat(40)}\n` };
    },
  }),
  '',
  'an archive nested below another checkout must remain marker-only',
);
assert.equal(nestedArchiveGitCalls, 0, 'archive-only provenance must not invoke Git');

const directCheckout = path.join(root, 'direct-checkout');
fs.mkdirSync(path.join(directCheckout, '.git'), { recursive: true });
assert.throws(
  () => extensionReleaseGitHead(directCheckout, {
    spawnGit: () => ({ status: 1, stdout: '' }),
  }),
  /could not resolve the active extension release Git HEAD/u,
  'a direct checkout must fail closed when Git inspection fails',
);
assert.equal(
  extensionReleaseGitHead(directCheckout, {
    spawnGit: () => ({ status: 0, stdout: `${'2'.repeat(40)}\n` }),
  }),
  '2'.repeat(40),
  'a direct checkout must accept one canonical full Git HEAD',
);
assert.deepEqual(
  extensionReleaseGitSafeDirectoryArgs(directCheckout),
  [
    '--no-replace-objects',
    '-c',
    `safe.directory=${process.platform === 'win32'
      ? path.resolve(directCheckout).split(path.sep).join('/')
      : path.resolve(directCheckout)}`,
  ],
  'release Git reads must not mutate global safe.directory configuration',
);
assert.deepEqual(
  extensionReleaseGitEnvironment({
    PATH: '/fixture/bin',
    GIT_DIR: '/attacker/metadata',
    git_work_tree: '/attacker/tree',
    GIT_CONFIG_COUNT: '1',
  }),
  { PATH: '/fixture/bin' },
  'release Git reads must remove every inherited GIT_* redirect and config variable',
);

const blobDigestCheckout = path.join(root, 'blob-digest-checkout');
const blobDigestSource = path.join(blobDigestCheckout, 'extensions', 'fixture');
const emptyGitTemplate = path.join(root, 'empty-git-template');
const emptyGitHooks = path.join(root, 'empty-git-hooks');
fs.mkdirSync(emptyGitTemplate);
fs.mkdirSync(emptyGitHooks);
fs.mkdirSync(blobDigestSource, { recursive: true });
fs.writeFileSync(path.join(blobDigestCheckout, '.gitattributes'), '* text eol=lf\n');
fs.writeFileSync(path.join(blobDigestSource, 'main.js'), 'export const fixture = true;\n');
const blobDigestControlledInputs = [...EXTENSION_RELEASE_CONTROLLED_INPUTS];
for (const relative of blobDigestControlledInputs) {
  const file = path.join(blobDigestCheckout, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `controlled ${relative}\n`);
}
function fixtureGit(args) {
  const result = spawnSync('git', args, {
    cwd: blobDigestCheckout,
    encoding: 'utf8',
    env: extensionReleaseGitEnvironment(),
  });
  assert.equal(result.status, 0, `fixture Git failed: git ${args.join(' ')}\n${result.stderr}`);
  return result;
}
fixtureGit([
  'init',
  '--quiet',
  '--object-format=sha1',
  `--template=${emptyGitTemplate}`,
]);
fixtureGit(['config', 'user.email', 'extension-release-test@example.invalid']);
fixtureGit(['config', 'user.name', 'Extension Release Test']);
fixtureGit(['config', 'commit.gpgsign', 'false']);
fixtureGit(['config', 'core.hooksPath', emptyGitHooks]);
fixtureGit(['add', '--all']);
fixtureGit(['commit', '--quiet', '--no-gpg-sign', '-m', 'fixture']);
const blobDigest = extensionReleasePackageInputsSha256({
  repoRoot: blobDigestCheckout,
  sourceDir: blobDigestSource,
});
const originalBlobDigestCommit = fixtureGit(['rev-parse', 'HEAD']).stdout.trim();
fs.writeFileSync(path.join(blobDigestSource, 'main.js'), 'export const replacement = true;\n');
fixtureGit(['add', '--all']);
fixtureGit(['commit', '--quiet', '--no-gpg-sign', '-m', 'replacement fixture']);
const replacementBlobDigestCommit = fixtureGit(['rev-parse', 'HEAD']).stdout.trim();
fixtureGit(['replace', originalBlobDigestCommit, replacementBlobDigestCommit]);
fixtureGit(['reset', '--hard', originalBlobDigestCommit]);
assert.equal(
  extensionReleasePackageInputsSha256({
    repoRoot: blobDigestCheckout,
    sourceDir: blobDigestSource,
  }),
  blobDigest,
  'repository provenance must ignore local Git replacement objects',
);
assert.notEqual(
  extensionReleaseScopedGitStatus({
    repoRoot: blobDigestCheckout,
    sourceDir: blobDigestSource,
  }),
  '',
  'clean-state verification must expose a worktree materialized from replacement objects',
);
fixtureGit(['replace', '-d', originalBlobDigestCommit]);
fixtureGit(['reset', '--hard', originalBlobDigestCommit]);
const filterAttributes = path.join(blobDigestCheckout, '.git', 'info', 'attributes');
fs.mkdirSync(path.dirname(filterAttributes), { recursive: true });
fs.writeFileSync(filterAttributes, 'extensions/fixture/main.js filter=release-snapshot\n');
fixtureGit([
  'config',
  'filter.release-snapshot.clean',
  'git show HEAD:extensions/fixture/main.js',
]);
fixtureGit([
  'config',
  'filter.release-snapshot.smudge',
  "printf 'export const smudged = true;\\n'",
]);
fixtureGit(['config', 'filter.release-snapshot.required', 'true']);
fs.rmSync(path.join(blobDigestSource, 'main.js'));
fixtureGit(['checkout', '--force', '--', 'extensions/fixture/main.js']);
assert.equal(
  fs.readFileSync(path.join(blobDigestSource, 'main.js'), 'utf8'),
  'export const smudged = true;\n',
  'the fixture must materialize bytes that differ from the committed blob',
);
assert.equal(
  fixtureGit(['status', '--porcelain', '--', 'extensions/fixture/main.js']).stdout,
  '',
  'the clean filter must hide the smudged worktree bytes from ordinary Git status',
);
const repositorySnapshotRoot = fs.mkdtempSync(path.join(root, 'blob-snapshot-'));
const repositorySnapshot = materializeExtensionReleaseRepositorySnapshot({
  repoRoot: blobDigestCheckout,
  sourceDir: blobDigestSource,
  outputRoot: repositorySnapshotRoot,
});
assert.equal(repositorySnapshot.gitCommit, originalBlobDigestCommit);
assert.equal(
  fs.readFileSync(path.join(repositorySnapshot.sourceDir, 'main.js'), 'utf8'),
  'export const fixture = true;\n',
  'the formal package snapshot must use committed blob bytes instead of smudged worktree bytes',
);
fs.rmSync(repositorySnapshotRoot, { recursive: true, force: true });
fs.rmSync(filterAttributes);
fixtureGit(['config', '--remove-section', 'filter.release-snapshot']);
fixtureGit(['checkout', '--force', '--', 'extensions/fixture/main.js']);
fs.writeFileSync(path.join(blobDigestSource, 'main.js'), 'export const fixture = true;\r\n');
fs.writeFileSync(
  path.join(blobDigestCheckout, blobDigestControlledInputs[0]),
  `controlled ${blobDigestControlledInputs[0]}\r\n`,
);
assert.equal(
  extensionReleasePackageInputsSha256({
    repoRoot: blobDigestCheckout,
    sourceDir: blobDigestSource,
  }),
  blobDigest,
  'repository input provenance must hash Git blob bytes instead of checkout line endings',
);
fs.writeFileSync(path.join(blobDigestSource, 'untracked.js'), 'untracked\n');
assert.throws(
  () => extensionReleasePackageInputsSha256({
    repoRoot: blobDigestCheckout,
    sourceDir: blobDigestSource,
  }),
  /do not exactly match tracked Git HEAD files/u,
  'repository input provenance must reject untracked source files',
);
fs.rmSync(path.join(blobDigestSource, 'untracked.js'));
fs.rmSync(path.join(blobDigestSource, 'main.js'));
assert.throws(
  () => extensionReleasePackageInputsSha256({
    repoRoot: blobDigestCheckout,
    sourceDir: blobDigestSource,
  }),
  /do not exactly match tracked Git HEAD files/u,
  'repository input provenance must reject missing tracked source files',
);
fs.writeFileSync(path.join(blobDigestSource, 'main.js'), 'export const fixture = true;\r\n');
if (process.platform !== 'win32') {
  fs.symlinkSync('main.js', path.join(blobDigestSource, 'linked.js'));
  fixtureGit(['add', 'extensions/fixture/linked.js']);
  fixtureGit(['commit', '--quiet', '--no-gpg-sign', '-m', 'non-blob fixture']);
  assert.throws(
    () => extensionReleasePackageInputsSha256({
      repoRoot: blobDigestCheckout,
      sourceDir: blobDigestSource,
    }),
    /must be a regular file/u,
    'repository input provenance must reject non-regular Git inputs',
  );
}
if (process.platform !== 'win32') {
  const danglingMetadataCheckout = path.join(root, 'dangling-metadata-checkout');
  fs.mkdirSync(danglingMetadataCheckout, { recursive: true });
  fs.symlinkSync(
    path.join(danglingMetadataCheckout, 'missing-git-metadata'),
    path.join(danglingMetadataCheckout, '.git'),
    'file',
  );
  assert.throws(
    () => extensionReleaseGitHead(danglingMetadataCheckout),
    /could not resolve the active extension release Git HEAD/u,
    'a dangling .git symlink must not be classified as an archive-only release tree',
  );
}

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
    deployedCommit: '1'.repeat(40),
    activeGitCommit: '1'.repeat(40),
    sourceMode: 'REPOSITORY_SOURCE',
    requireCleanGit: true,
    gitStatus: ' M extensions/ss-erp/manifest.json\n',
    packageInputsSha256: provenanceDigest,
  }),
  /differ from Git HEAD/u,
  'a Git checkout must reject dirty controlled inputs even when DEPLOYED_COMMIT exists',
);
assert.throws(
  () => resolveExtensionReleaseProvenance({
    deployedCommit: '1'.repeat(40),
    activeGitCommit: '2'.repeat(40),
    sourceMode: 'REPOSITORY_SOURCE',
    requireCleanGit: true,
    gitStatus: '',
    packageInputsSha256: provenanceDigest,
  }),
  /does not match active Git HEAD/u,
  'a Git checkout must not bind package evidence to a stale deployment marker',
);
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
      EXTENSION_RELEASE_EXPECTED_LOCAL_ORIGIN: expectedOrigins.local,
      EXTENSION_LOCAL_BASE_URL: expectedOrigins.local,
      EXTENSION_RELEASE_TEST_ALLOW_EXTERNAL_SOURCE: '1',
      ...extraEnvironment,
    },
    maxBuffer: 32 * 1024 * 1024,
  });
}

const externalDenied = packageRelease(path.join(root, 'external-denied'), {
  EXTENSION_RELEASE_TEST_ALLOW_EXTERNAL_SOURCE: '',
});
assert.notEqual(externalDenied.status, 0);
assert.match(
  `${externalDenied.stdout}\n${externalDenied.stderr}`,
  /formal extension releases must use repository source/u,
);
const localOriginDenied = packageRelease(path.join(root, 'local-origin-denied'), {
  EXTENSION_LOCAL_BASE_URL: 'https://remote-local.example',
});
assert.notEqual(localOriginDenied.status, 0);
assert.match(
  `${localOriginDenied.stdout}\n${localOriginDenied.stderr}`,
  /formal local extension origin does not match its independent approval/u,
);

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
    '--expected-local-origin',
    origins.local,
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
    env: {
      ...process.env,
      EXTENSION_SOURCE_DIR: sourceDir,
      EXTENSION_RELEASE_TEST_ALLOW_EXTERNAL_SOURCE: '1',
    },
    maxBuffer: 32 * 1024 * 1024,
  },
);
const verification = verifyRelease();
assert.equal(verification.status, 0, `${verification.stdout}\n${verification.stderr}`);

function stageRelease(
  outputDir,
  targetGitCommit = evidence.gitCommit,
  { verifyOnly = false } = {},
) {
  const options = [
    'scripts/stage-extension-release.mjs',
    '--build-root', outDir,
    verifyOnly ? '--verify-output-dir' : '--output-dir', outputDir,
    '--target-git-commit', targetGitCommit,
    '--expected-web-origin', expectedOrigins.web,
    '--expected-admin-origin', expectedOrigins.admin,
    '--expected-api-origin', expectedOrigins.api,
    '--expected-local-origin', expectedOrigins.local,
  ];
  const environment = {
    ...process.env,
    EXTENSION_SOURCE_DIR: sourceDir,
    EXTENSION_RELEASE_TEST_ALLOW_EXTERNAL_SOURCE: '1',
  };
  if (process.platform === 'win32') {
    return spawnSync(process.execPath, options, {
      cwd: process.cwd(), encoding: 'utf8', env: environment,
      maxBuffer: 32 * 1024 * 1024,
    });
  }
  const previousUmask = process.umask(0o077);
  try {
    return spawnSync(process.execPath, options, {
      cwd: process.cwd(), encoding: 'utf8', env: environment,
      maxBuffer: 32 * 1024 * 1024,
    });
  } finally {
    process.umask(previousUmask);
  }
}

const stagedRoot = path.join(root, 'staged-release');
const stageResult = stageRelease(stagedRoot);
assert.equal(stageResult.status, 0, `${stageResult.stdout}\n${stageResult.stderr}`);
assert.deepEqual(fs.readdirSync(stagedRoot).sort(), [
  path.basename(checksumPath),
  path.basename(evidencePath),
  'ss-erp-cloud-1.0.265.zip',
  'ss-erp-local-1.0.265.zip',
].sort(), 'staging must copy only the exact canonical four-file release set');
if (process.platform !== 'win32') {
  assert.equal(
    fs.statSync(stagedRoot).mode & 0o777,
    0o755,
    'the sealed runtime must be able to traverse the staged release directory',
  );
}
for (const filename of fs.readdirSync(stagedRoot)) {
  if (process.platform !== 'win32') {
    assert.equal(
      fs.statSync(path.join(stagedRoot, filename)).mode & 0o777,
      0o644,
      `staged runtime artifact ${filename} must remain readable under umask 077`,
    );
  }
  assert.deepEqual(
    fs.readFileSync(path.join(stagedRoot, filename)),
    fs.readFileSync(path.join(outDir, filename)),
    `staging must preserve exact bytes for ${filename}`,
  );
}
const exactStageVerification = stageRelease(
  stagedRoot,
  evidence.gitCommit,
  { verifyOnly: true },
);
assert.equal(
  exactStageVerification.status,
  0,
  `${exactStageVerification.stdout}\n${exactStageVerification.stderr}`,
);
const stagedCloudPath = path.join(stagedRoot, 'ss-erp-cloud-1.0.265.zip');
fs.appendFileSync(stagedCloudPath, 'post-stage replacement\n');
const replacedStageVerification = stageRelease(
  stagedRoot,
  evidence.gitCommit,
  { verifyOnly: true },
);
assert.notEqual(
  replacedStageVerification.status,
  0,
  'sealed verification must reject a build-user replacement after staging',
);
assert.match(
  `${replacedStageVerification.stdout}\n${replacedStageVerification.stderr}`,
  /does not byte-match the root release candidate/u,
);
fs.copyFileSync(path.join(outDir, 'ss-erp-cloud-1.0.265.zip'), stagedCloudPath);
if (process.platform !== 'win32') {
  const nobody = spawnSync('id', ['-u', 'nobody'], { encoding: 'utf8' });
  if (nobody.status === 0) {
    fs.chmodSync(root, 0o755);
    for (const filename of fs.readdirSync(stagedRoot)) {
      const readable = spawnSync(
        'runuser',
        ['-u', 'nobody', '--', 'test', '-r', path.join(stagedRoot, filename)],
        { encoding: 'utf8' },
      );
      assert.equal(readable.status, 0, `runtime user must read staged ${filename}`);
    }
  }
}

const markerPath = path.resolve('DEPLOYED_COMMIT');
const markerBefore = fs.existsSync(markerPath) ? fs.readFileSync(markerPath) : null;
try {
  fs.writeFileSync(markerPath, `${evidence.gitCommit}\n`, { mode: 0o644 });
  const deployedMarkerStage = stageRelease(path.join(root, 'deployed-marker-stage'));
  assert.equal(
    deployedMarkerStage.status,
    0,
    `${deployedMarkerStage.stdout}\n${deployedMarkerStage.stderr}`,
  );
} finally {
  if (markerBefore === null) fs.rmSync(markerPath, { force: true });
  else fs.writeFileSync(markerPath, markerBefore);
}

const wrongCommitStage = stageRelease(path.join(root, 'wrong-commit-stage'), 'f'.repeat(40));
assert.notEqual(wrongCommitStage.status, 0, 'staging must reject a release for another commit');
assert.match(
  `${wrongCommitStage.stdout}\n${wrongCommitStage.stderr}`,
  /no approved-source extension release matches the active commit|exactly one matching/u,
);

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

if (process.platform !== 'win32') {
  for (const artifactPath of [evidencePath, checksumPath]) {
    const realPath = `${artifactPath}.real`;
    fs.renameSync(artifactPath, realPath);
    fs.symlinkSync(realPath, artifactPath, 'file');
    const symlinkVerification = verifyRelease();
    assert.notEqual(symlinkVerification.status, 0, 'release metadata symlinks must fail closed');
    fs.rmSync(artifactPath);
    fs.renameSync(realPath, artifactPath);
  }
  for (const target of ['cloud', 'local']) {
    const zipPath = path.join(outDir, `ss-erp-${target}-1.0.265.zip`);
    const realPath = `${zipPath}.real`;
    fs.renameSync(zipPath, realPath);
    fs.symlinkSync(realPath, zipPath, 'file');
    const symlinkVerification = spawnSync(
      process.execPath,
      [
        'scripts/verify-extension-archive.mjs',
        '--zip',
        zipPath,
        '--target',
        target,
        '--version',
        '1.0.265',
        ...releaseOriginArgs(),
      ],
      { cwd: process.cwd(), encoding: 'utf8', env: process.env },
    );
    assert.notEqual(symlinkVerification.status, 0, 'extension ZIP symlinks must fail closed');
    fs.rmSync(zipPath);
    fs.renameSync(realPath, zipPath);
  }
}

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
    /stage-extension-release\.mjs/u,
    `${file} must stage the prebuilt coordinated extension release`,
  );
  assert.doesNotMatch(
    deployer,
    /pnpm package:extension/u,
    `${file} must not replace the REL-03 candidate during REL-04 deployment`,
  );
  assert.match(deployer, /EXTENSION_RELEASE_ROOT/u);
  assert.match(deployer, /--verify-output-dir/u);
  assert.match(deployer, /Revoking build-user writes to the staged extension release/u);
  assert.doesNotMatch(deployer, /EXTENSION_PREVIOUS_BUILD_ROOT/u);
}

const releaseDeployer = fs.readFileSync('scripts/deploy.sh', 'utf8');
assert.match(releaseDeployer, /DEPLOY_REF="\$\{1:-HEAD\}"/u);
assert.match(
  releaseDeployer,
  /git "\$\{GIT_SAFE_ARGS\[@\]\}" rev-parse --verify --end-of-options "\$\{DEPLOY_REF\}\^\{commit\}"/u,
  'release deploy must resolve an explicit ref to a commit before creating its raw snapshot',
);
assert.match(
  releaseDeployer,
  /PACKAGE_SNAPSHOT_TOOL" materialize/u,
  'release deploy must materialize its archive from raw Git blobs',
);
assert.doesNotMatch(releaseDeployer, /git archive/u);
assert.match(
  releaseDeployer,
  /\[\[ ! "\$COMMIT_HASH" =~ \^\[0-9a-f\]\{40\}\$ \]\]/u,
  'release deploy must reject short commit IDs',
);
assert.match(
  releaseDeployer,
  /printf '%s\\n' "\$TARGET_GIT_COMMIT" > "\$RELEASE_DIR\/DEPLOYED_COMMIT"/u,
  'the archive-only release must persist the full commit for formal release evidence',
);
assert.doesNotMatch(releaseDeployer, /git rev-parse --short/u);

console.log('PASS extension package auto bump and deployment targets');
