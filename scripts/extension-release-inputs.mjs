import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const EXTENSION_RELEASE_GIT_MAX_BUFFER_BYTES = 128 * 1024 * 1024;

export const EXTENSION_RELEASE_CONTROLLED_INPUTS = Object.freeze([
  'scripts/build-extension-package.mjs',
  'scripts/package-extension-package.mjs',
  'scripts/package-extension-release.mjs',
  'scripts/stage-extension-release.mjs',
  'scripts/verify-extension-package.mjs',
  'scripts/verify-extension-archive.mjs',
  'scripts/verify-extension-release.mjs',
  'scripts/extension-release-contract.mjs',
  'scripts/extension-release-inputs.mjs',
  'scripts/extension-release-artifact.mjs',
  'scripts/generate-source-capture-contract.mjs',
  'packages/shared/schemas/source-product-capture-v2.schema.json',
  'packages/shared/src/source-product-capture.ts',
]);

export function extensionReleaseSourceMode(repoRoot, sourceDir) {
  const relative = path.relative(repoRoot, sourceDir);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    ? 'REPOSITORY_SOURCE'
    : 'EXTERNAL_SOURCE';
}

export function extensionReleaseGitSafeDirectoryArgs(repoRoot) {
  const absolute = path.resolve(repoRoot);
  const gitPath = process.platform === 'win32'
    ? absolute.split(path.sep).join('/')
    : absolute;
  return ['--no-replace-objects', '-c', `safe.directory=${gitPath}`];
}

export function extensionReleaseGitEnvironment(environment = process.env) {
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => !/^GIT_/iu.test(key)),
  );
}

export function extensionReleaseGitHead(repoRoot, { spawnGit = spawnSync } = {}) {
  const gitMetadataPath = path.join(repoRoot, '.git');
  const metadata = lstatSync(gitMetadataPath, { throwIfNoEntry: false });
  if (metadata === undefined) return '';
  if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
    throw new Error('could not resolve the active extension release Git HEAD');
  }
  let result;
  try {
    result = spawnGit('git', [
      ...extensionReleaseGitSafeDirectoryArgs(repoRoot),
      'rev-parse',
      '--verify',
      'HEAD',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: extensionReleaseGitEnvironment(),
    });
  } catch {
    throw new Error('could not resolve the active extension release Git HEAD');
  }
  const commit = String(result.stdout || '').trim().toLowerCase();
  if (result.status === 0 && /^[a-f0-9]{40}$/u.test(commit)) return commit;
  throw new Error('could not resolve the active extension release Git HEAD');
}

function inputFiles(root, prefix) {
  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    throw new Error(`extension release source directory is missing: ${root}`);
  }
  const files = [];
  function walk(directory, relativeDirectory = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) {
        files.push({ absolute, label: `${prefix}/${relative.split(path.sep).join('/')}` });
      } else {
        throw new Error(`extension release input must be a regular file: ${absolute}`);
      }
    }
  }
  walk(root);
  return files;
}

function repositoryRelativePath(repoRoot, absolute) {
  const relative = path.relative(repoRoot, absolute);
  if (
    relative === ''
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error(`extension release input is outside the repository: ${absolute}`);
  }
  return relative.split(path.sep).join('/');
}

function gitBuffer(result, failureMessage) {
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error(failureMessage);
  }
  return result.stdout;
}

function gitTreeEntries({ repoRoot, gitCommit, pathspecs, spawnGit }) {
  let result;
  try {
    result = spawnGit('git', [
      ...extensionReleaseGitSafeDirectoryArgs(repoRoot),
      'ls-tree',
      '-r',
      '-z',
      '--full-tree',
      gitCommit,
      '--',
      ...pathspecs,
    ], {
      cwd: repoRoot,
      encoding: null,
      env: extensionReleaseGitEnvironment(),
      maxBuffer: EXTENSION_RELEASE_GIT_MAX_BUFFER_BYTES,
    });
  } catch {
    throw new Error('could not resolve extension release inputs from Git HEAD');
  }
  const stdout = gitBuffer(
    result,
    'could not resolve extension release inputs from Git HEAD',
  );
  const entries = new Map();
  let cursor = 0;
  while (cursor < stdout.length) {
    const end = stdout.indexOf(0, cursor);
    if (end < 0) throw new Error('Git HEAD returned malformed extension release inputs');
    const record = stdout.subarray(cursor, end);
    cursor = end + 1;
    if (record.length === 0) continue;
    const separator = record.indexOf(0x09);
    if (separator < 0) throw new Error('Git HEAD returned malformed extension release inputs');
    const metadata = record.subarray(0, separator).toString('ascii');
    const match = metadata.match(/^(100644|100755) blob ([a-f0-9]{40})$/u);
    if (!match) {
      throw new Error('extension release Git HEAD input must be a regular blob');
    }
    const pathnameBytes = record.subarray(separator + 1);
    const pathname = pathnameBytes.toString('utf8');
    if (!Buffer.from(pathname, 'utf8').equals(pathnameBytes) || entries.has(pathname)) {
      throw new Error('Git HEAD returned malformed extension release input paths');
    }
    entries.set(pathname, { mode: match[1], objectId: match[2] });
  }
  return entries;
}

function gitBlobBytes({ repoRoot, objectIds, spawnGit }) {
  let result;
  try {
    result = spawnGit('git', [
      ...extensionReleaseGitSafeDirectoryArgs(repoRoot),
      'cat-file',
      '--batch',
    ], {
      cwd: repoRoot,
      encoding: null,
      env: extensionReleaseGitEnvironment(),
      input: `${objectIds.join('\n')}\n`,
      maxBuffer: EXTENSION_RELEASE_GIT_MAX_BUFFER_BYTES,
    });
  } catch {
    throw new Error('could not read extension release input blobs from Git HEAD');
  }
  const stdout = gitBuffer(
    result,
    'could not read extension release input blobs from Git HEAD',
  );
  const blobs = new Map();
  let cursor = 0;
  for (const expectedObjectId of objectIds) {
    const headerEnd = stdout.indexOf(0x0a, cursor);
    if (headerEnd < 0) throw new Error('Git returned malformed extension release blob data');
    const header = stdout.subarray(cursor, headerEnd).toString('ascii');
    const match = header.match(/^([a-f0-9]{40}) blob (0|[1-9][0-9]*)$/u);
    if (!match || match[1] !== expectedObjectId) {
      throw new Error('Git returned malformed extension release blob data');
    }
    const size = Number(match[2]);
    if (!Number.isSafeInteger(size)) {
      throw new Error('Git returned malformed extension release blob data');
    }
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= stdout.length || stdout[contentEnd] !== 0x0a) {
      throw new Error('Git returned malformed extension release blob data');
    }
    blobs.set(expectedObjectId, stdout.subarray(contentStart, contentEnd));
    cursor = contentEnd + 1;
  }
  if (cursor !== stdout.length) {
    throw new Error('Git returned unexpected extension release blob data');
  }
  return blobs;
}

function repositoryInputBytes({ repoRoot, sourceDir, files, gitCommit, spawnGit = spawnSync }) {
  const filesByPath = new Map();
  for (const file of files) {
    const pathname = repositoryRelativePath(repoRoot, file.absolute);
    const matching = filesByPath.get(pathname) || [];
    matching.push(file);
    filesByPath.set(pathname, matching);
  }
  const sourcePath = path.relative(repoRoot, sourceDir).split(path.sep).join('/') || '.';
  const treeEntries = gitTreeEntries({
    repoRoot,
    gitCommit,
    pathspecs: [sourcePath, ...EXTENSION_RELEASE_CONTROLLED_INPUTS],
    spawnGit,
  });
  if (
    treeEntries.size !== filesByPath.size
    || [...treeEntries.keys()].some((pathname) => !filesByPath.has(pathname))
    || [...filesByPath.keys()].some((pathname) => !treeEntries.has(pathname))
  ) {
    throw new Error('extension release inputs do not exactly match tracked Git HEAD files');
  }
  const objectIds = [...new Set(
    [...treeEntries.values()].map((entry) => entry.objectId),
  )];
  const blobs = gitBlobBytes({ repoRoot, objectIds, spawnGit });
  const bytesByPath = new Map(
    [...filesByPath].map(([pathname]) => [
      pathname,
      blobs.get(treeEntries.get(pathname).objectId),
    ]),
  );
  const bytesByFile = new Map(
    [...filesByPath].flatMap(([pathname, matching]) => matching.map((file) => [
      file,
      bytesByPath.get(pathname),
    ])),
  );
  return { bytesByFile, bytesByPath, filesByPath, treeEntries };
}

function releaseInputFiles({ repoRoot, sourceDir }) {
  const files = inputFiles(sourceDir, 'source');
  for (const relative of EXTENSION_RELEASE_CONTROLLED_INPUTS) {
    const absolute = path.join(repoRoot, relative);
    if (!existsSync(absolute) || !lstatSync(absolute).isFile()) {
      throw new Error(`controlled release input is missing: ${relative}`);
    }
    files.push({ absolute, label: `repository/${relative}` });
  }
  files.sort((left, right) => (left.label < right.label ? -1 : left.label > right.label ? 1 : 0));
  return files;
}

export function materializeExtensionReleaseRepositorySnapshot(
  { repoRoot, sourceDir, outputRoot },
  { spawnGit = spawnSync } = {},
) {
  if (extensionReleaseSourceMode(repoRoot, sourceDir) !== 'REPOSITORY_SOURCE') {
    throw new Error('extension release Git snapshot requires a repository source directory');
  }
  const snapshotRoot = path.resolve(outputRoot);
  const snapshotMetadata = lstatSync(snapshotRoot, { throwIfNoEntry: false });
  if (!snapshotMetadata?.isDirectory() || snapshotMetadata.isSymbolicLink()
    || readdirSync(snapshotRoot).length !== 0) {
    throw new Error('extension release Git snapshot output must be one empty real directory');
  }
  const files = releaseInputFiles({ repoRoot, sourceDir });
  const gitCommit = extensionReleaseGitHead(repoRoot, { spawnGit });
  const { bytesByPath, filesByPath, treeEntries } = repositoryInputBytes({
    repoRoot,
    sourceDir,
    files,
    gitCommit,
    spawnGit,
  });
  for (const [pathname, matching] of filesByPath) {
    const segments = pathname.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new Error('extension release Git snapshot contains an unsafe path');
    }
    const destination = path.resolve(snapshotRoot, ...segments);
    if (!destination.startsWith(`${snapshotRoot}${path.sep}`)) {
      throw new Error('extension release Git snapshot contains an unsafe path');
    }
    const treeEntry = treeEntries.get(pathname);
    const bytes = matching.length ? bytesByPath.get(pathname) : null;
    if (!Buffer.isBuffer(bytes)) {
      throw new Error('extension release Git snapshot blob is missing');
    }
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
    const mode = treeEntry.mode === '100755' ? 0o755 : 0o644;
    writeFileSync(destination, bytes, { flag: 'wx', mode });
    chmodSync(destination, mode);
  }
  const sourceRelative = repositoryRelativePath(repoRoot, sourceDir);
  return {
    gitCommit,
    repoRoot: snapshotRoot,
    sourceDir: path.join(snapshotRoot, ...sourceRelative.split('/')),
  };
}

export function extensionReleasePackageInputsSha256(
  { repoRoot, sourceDir },
  { spawnGit = spawnSync } = {},
) {
  const files = releaseInputFiles({ repoRoot, sourceDir });
  const sourceMode = extensionReleaseSourceMode(repoRoot, sourceDir);
  const gitCommit = sourceMode === 'REPOSITORY_SOURCE'
    ? extensionReleaseGitHead(repoRoot, { spawnGit })
    : '';
  const repositoryInputs = gitCommit
    ? repositoryInputBytes({ repoRoot, sourceDir, files, gitCommit, spawnGit })
    : null;
  const hash = createHash('sha256');
  for (const file of files) {
    const bytes = repositoryInputs?.bytesByFile.get(file) || readFileSync(file.absolute);
    hash.update(`${Buffer.byteLength(file.label, 'utf8')}:`);
    hash.update(file.label, 'utf8');
    hash.update(`${bytes.length}:`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

export function extensionReleaseScopedGitStatus({ repoRoot, sourceDir }) {
  if (extensionReleaseSourceMode(repoRoot, sourceDir) !== 'REPOSITORY_SOURCE') {
    throw new Error('scoped release Git status requires a repository source directory');
  }
  const sourcePath = path.relative(repoRoot, sourceDir).split(path.sep).join('/');
  const result = spawnSync(
    'git',
    [
      ...extensionReleaseGitSafeDirectoryArgs(repoRoot),
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      sourcePath,
      ...EXTENSION_RELEASE_CONTROLLED_INPUTS,
    ],
    { cwd: repoRoot, encoding: 'utf8', env: extensionReleaseGitEnvironment() },
  );
  if (result.status !== 0) throw new Error('could not inspect extension release input Git state');
  const ignored = spawnSync(
    'git',
    [
      ...extensionReleaseGitSafeDirectoryArgs(repoRoot),
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--',
      sourcePath,
      ...EXTENSION_RELEASE_CONTROLLED_INPUTS,
    ],
    { cwd: repoRoot, encoding: 'utf8', env: extensionReleaseGitEnvironment() },
  );
  if (ignored.status !== 0) throw new Error('could not inspect ignored extension release inputs');
  const ignoredStatus = String(ignored.stdout || '')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((file) => `!! ${file}\n`)
    .join('');
  return `${String(result.stdout || '')}${ignoredStatus}`;
}

export function assertExtensionReleaseInputsUnchanged(input) {
  if (input.actualSourceMode !== input.expectedSourceMode) {
    throw new Error('extension release sourceMode changed during verification');
  }
  if (input.actualPackageInputsSha256 !== input.expectedPackageInputsSha256) {
    throw new Error('extension release package inputs changed after provenance capture');
  }
  if (input.requireCleanGit && String(input.gitStatus || '') !== '') {
    throw new Error('tracked or untracked extension release inputs differ from Git HEAD');
  }
}
