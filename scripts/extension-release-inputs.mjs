import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const EXTENSION_RELEASE_CONTROLLED_INPUTS = Object.freeze([
  'scripts/build-extension-package.mjs',
  'scripts/package-extension-package.mjs',
  'scripts/package-extension-release.mjs',
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

export function extensionReleasePackageInputsSha256({ repoRoot, sourceDir }) {
  const files = inputFiles(sourceDir, 'source');
  for (const relative of EXTENSION_RELEASE_CONTROLLED_INPUTS) {
    const absolute = path.join(repoRoot, relative);
    if (!existsSync(absolute) || !lstatSync(absolute).isFile()) {
      throw new Error(`controlled release input is missing: ${relative}`);
    }
    files.push({ absolute, label: `repository/${relative}` });
  }
  files.sort((left, right) => (left.label < right.label ? -1 : left.label > right.label ? 1 : 0));
  const hash = createHash('sha256');
  for (const file of files) {
    const bytes = readFileSync(file.absolute);
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
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      sourcePath,
      ...EXTENSION_RELEASE_CONTROLLED_INPUTS,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error('could not inspect extension release input Git state');
  const ignored = spawnSync(
    'git',
    [
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--',
      sourcePath,
      ...EXTENSION_RELEASE_CONTROLLED_INPUTS,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
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
