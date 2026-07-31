#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const FULL_GIT_OID = /^[a-f0-9]{40}$/u;
const MAX_GIT_OUTPUT_BYTES = 512 * 1024 * 1024;
const MAX_TREE_ENTRIES = 100_000;
const SNAPSHOT_TIME = new Date('2000-01-01T00:00:00.000Z');

function fail(message) {
  throw new Error(message);
}

export function gitCommitTreeEnvironment(environment = process.env) {
  const clean = Object.fromEntries(
    Object.entries(environment).filter(([key]) => !/^GIT_/iu.test(key)),
  );
  return {
    ...clean,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
}

export function gitCommitTreeSafeDirectoryArgs(repositoryRoot) {
  const absolute = path.resolve(repositoryRoot);
  return [
    '--no-replace-objects',
    '-c',
    `safe.directory=${process.platform === 'win32'
      ? absolute.split(path.sep).join('/')
      : absolute}`,
  ];
}

function runGit(repositoryRoot, args, options = {}) {
  const result = spawnSync(
    'git',
    [...gitCommitTreeSafeDirectoryArgs(repositoryRoot), ...args],
    {
      cwd: repositoryRoot,
      encoding: options.encoding ?? null,
      env: gitCommitTreeEnvironment(options.environment),
      input: options.input,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      windowsHide: true,
    },
  );
  if (result.error || result.signal || result.status !== 0) {
    fail(options.failureMessage || 'could not read the bound Git commit tree');
  }
  return result.stdout;
}

function canonicalRepositoryRoot(repositoryRoot) {
  const absolute = path.resolve(repositoryRoot);
  const metadata = lstatSync(absolute, { throwIfNoEntry: false });
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
    fail('Git commit tree repository root must be one real directory');
  }
  const resolved = realpathSync(absolute);
  const inputIsCanonical = process.platform === 'win32'
    ? resolved.toLowerCase() === absolute.toLowerCase()
    : resolved === absolute;
  if (!inputIsCanonical) fail('Git commit tree repository root must not traverse symbolic links');
  const reported = String(runGit(absolute, ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    failureMessage: 'could not resolve the Git commit tree repository root',
  })).trim();
  const equal = process.platform === 'win32'
    ? resolved.toLowerCase() === path.resolve(reported).toLowerCase()
    : resolved === path.resolve(reported);
  if (!equal) fail('Git commit tree repository root does not match the active checkout');
  return absolute;
}

function safeTreePath(pathnameBytes) {
  const pathname = pathnameBytes.toString('utf8');
  if (
    !pathname
    || !Buffer.from(pathname, 'utf8').equals(pathnameBytes)
    || pathname.includes('\\')
    || pathname.includes(':')
    || pathname.startsWith('/')
    || pathname.split('/').some((segment) => (
      !segment || segment === '.' || segment === '..' || /[\u0000-\u001f]/u.test(segment)
    ))
    || path.posix.normalize(pathname) !== pathname
  ) {
    fail('Git commit tree contains an unsafe path');
  }
  return pathname;
}

function treeEntries(repositoryRoot, commit) {
  const resolved = String(runGit(repositoryRoot, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${commit}^{commit}`,
  ], {
    encoding: 'utf8',
    failureMessage: 'could not resolve the bound Git commit',
  })).trim().toLowerCase();
  if (resolved !== commit) fail('bound Git commit did not resolve to its exact object ID');

  const output = runGit(repositoryRoot, [
    'ls-tree',
    '-r',
    '-z',
    '--full-tree',
    commit,
  ], { failureMessage: 'could not enumerate the bound Git commit tree' });
  const entries = [];
  const seenPaths = new Set();
  let cursor = 0;
  while (cursor < output.length) {
    const end = output.indexOf(0, cursor);
    if (end < 0) fail('Git returned a malformed commit tree');
    const record = output.subarray(cursor, end);
    cursor = end + 1;
    if (record.length === 0) continue;
    const separator = record.indexOf(0x09);
    if (separator < 0) fail('Git returned a malformed commit tree');
    const metadata = record.subarray(0, separator).toString('ascii');
    const match = metadata.match(/^(100644|100755) blob ([a-f0-9]{40})$/u);
    if (!match) fail('deployment commit tree inputs must be regular Git blobs');
    const pathname = safeTreePath(record.subarray(separator + 1));
    if (seenPaths.has(pathname)) fail('Git commit tree contains duplicate paths');
    seenPaths.add(pathname);
    entries.push({ mode: match[1], objectId: match[2], pathname });
    if (entries.length > MAX_TREE_ENTRIES) fail('Git commit tree contains too many entries');
  }
  if (entries.length === 0) fail('Git commit tree is empty');
  return entries;
}

function blobBytes(repositoryRoot, entries) {
  const objectIds = [...new Set(entries.map((entry) => entry.objectId))];
  const output = runGit(repositoryRoot, ['cat-file', '--batch'], {
    input: `${objectIds.join('\n')}\n`,
    failureMessage: 'could not read bound Git commit blobs',
  });
  const blobs = new Map();
  let cursor = 0;
  let totalBytes = 0;
  for (const expectedObjectId of objectIds) {
    const headerEnd = output.indexOf(0x0a, cursor);
    if (headerEnd < 0) fail('Git returned malformed commit blob data');
    const header = output.subarray(cursor, headerEnd).toString('ascii');
    const match = header.match(/^([a-f0-9]{40}) blob (0|[1-9][0-9]*)$/u);
    if (!match || match[1] !== expectedObjectId) {
      fail('Git returned malformed commit blob data');
    }
    const size = Number(match[2]);
    totalBytes += size;
    if (!Number.isSafeInteger(size) || totalBytes > MAX_GIT_OUTPUT_BYTES) {
      fail('Git commit blob data exceeds the deployment snapshot limit');
    }
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= output.length || output[contentEnd] !== 0x0a) {
      fail('Git returned malformed commit blob data');
    }
    blobs.set(expectedObjectId, output.subarray(contentStart, contentEnd));
    cursor = contentEnd + 1;
  }
  if (cursor !== output.length) fail('Git returned unexpected commit blob data');
  return blobs;
}

export function readGitCommitTree({ repositoryRoot, commit }) {
  if (!FULL_GIT_OID.test(commit || '')) fail('Git commit must be one lowercase SHA-1 object ID');
  const root = canonicalRepositoryRoot(repositoryRoot);
  const entries = treeEntries(root, commit);
  const blobs = blobBytes(root, entries);
  return {
    commit,
    entries: entries.map((entry) => ({
      ...entry,
      bytes: blobs.get(entry.objectId),
    })),
    repositoryRoot: root,
  };
}

function assertEmptyOutputRoot(outputRoot) {
  const root = path.resolve(outputRoot);
  const metadata = lstatSync(root, { throwIfNoEntry: false });
  if (!metadata?.isDirectory() || metadata.isSymbolicLink() || readdirSync(root).length !== 0) {
    fail('Git commit snapshot output must be one empty real directory');
  }
  const resolved = realpathSync(root);
  const canonical = process.platform === 'win32'
    ? resolved.toLowerCase() === root.toLowerCase()
    : resolved === root;
  if (!canonical) fail('Git commit snapshot output must not traverse symbolic links');
  return root;
}

export function materializeGitCommitTree({ repositoryRoot, commit, outputRoot }) {
  const snapshotRoot = assertEmptyOutputRoot(outputRoot);
  const tree = readGitCommitTree({ repositoryRoot, commit });
  let byteLength = 0;
  const directories = new Set([snapshotRoot]);
  for (const entry of tree.entries) {
    const destination = path.resolve(snapshotRoot, ...entry.pathname.split('/'));
    if (!destination.startsWith(`${snapshotRoot}${path.sep}`)) {
      fail('Git commit snapshot path escapes its output root');
    }
    let directory = path.dirname(destination);
    mkdirSync(directory, { recursive: true, mode: 0o755 });
    while (directory.startsWith(`${snapshotRoot}${path.sep}`)) {
      directories.add(directory);
      directory = path.dirname(directory);
    }
    const mode = entry.mode === '100755' ? 0o755 : 0o644;
    writeFileSync(destination, entry.bytes, { flag: 'wx', mode });
    chmodSync(destination, mode);
    utimesSync(destination, SNAPSHOT_TIME, SNAPSHOT_TIME);
    byteLength += entry.bytes.length;
  }
  for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
    chmodSync(directory, 0o755);
    utimesSync(directory, SNAPSHOT_TIME, SNAPSHOT_TIME);
  }
  return { commit, fileCount: tree.entries.length, byteLength, outputRoot: snapshotRoot };
}

function stableFileBytes(filename) {
  const noFollow = constants.O_NOFOLLOW || 0;
  const descriptor = openSync(filename, constants.O_RDONLY | noFollow);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n) fail('deployment worktree input is not a single-link file');
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
    ) {
      fail('deployment worktree input changed while it was read');
    }
    return { bytes, metadata: after };
  } finally {
    closeSync(descriptor);
  }
}

export function verifyGitCommitWorktree({ repositoryRoot, commit }) {
  const tree = readGitCommitTree({ repositoryRoot, commit });
  let byteLength = 0;
  for (const entry of tree.entries) {
    const filename = path.resolve(tree.repositoryRoot, ...entry.pathname.split('/'));
    const relative = path.relative(tree.repositoryRoot, filename);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      fail('deployment worktree input escapes its repository root');
    }
    let actual;
    try {
      actual = stableFileBytes(filename);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('deployment worktree')) throw error;
      fail(`deployment worktree input is missing or unsafe: ${entry.pathname}`);
    }
    if (!actual.bytes.equals(entry.bytes)) {
      fail(`deployment worktree bytes differ from Git commit: ${entry.pathname}`);
    }
    if (process.platform !== 'win32') {
      const executable = (Number(actual.metadata.mode) & 0o111) !== 0;
      if (executable !== (entry.mode === '100755')) {
        fail(`deployment worktree mode differs from Git commit: ${entry.pathname}`);
      }
    }
    byteLength += actual.bytes.length;
  }
  return { commit, fileCount: tree.entries.length, byteLength };
}

function main(args = process.argv.slice(2)) {
  if (args.length !== 3 || args[0] !== 'materialize') {
    fail('usage: git-commit-tree materialize <commit> <empty-output-directory>');
  }
  const result = materializeGitCommitTree({
    repositoryRoot: process.cwd(),
    commit: args[1],
    outputRoot: args[2],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const isDirectRun = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirectRun) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`FAIL ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
