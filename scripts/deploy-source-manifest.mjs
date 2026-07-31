#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const MAX_RECORDS = 500_000;
const MAX_MANIFEST_BYTES = 128 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const HASH_BUFFER_BYTES = 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function stableFileDigest(file) {
  const before = lstatSync(file, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile()) fail('source manifest file type changed');
  if (before.size > BigInt(MAX_FILE_BYTES)) fail('source manifest file exceeds the per-file limit');
  let descriptor = null;
  try {
    descriptor = openSync(
      file,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
    const opened = fstatSync(descriptor, { bigint: true });
    const same = (left, right) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']
      .every((field) => left[field] === right[field]);
    if (!same(before, opened)) fail('source manifest file changed while opening');
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
    let bytesReadTotal = 0;
    while (bytesReadTotal < Number(before.size)) {
      const bytesRead = readSync(
        descriptor,
        buffer,
        0,
        Math.min(buffer.length, Number(before.size) - bytesReadTotal),
        null,
      );
      if (bytesRead === 0) fail('source manifest file ended while hashing');
      hash.update(buffer.subarray(0, bytesRead));
      bytesReadTotal += bytesRead;
    }
    const after = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(file, { bigint: true });
    if (!same(before, after) || !same(before, pathAfter)) {
      fail('source manifest file changed while hashing');
    }
    return {
      bytes: Number(before.size),
      sha256: hash.digest('hex'),
    };
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function sourceRecords(root) {
  const records = [];
  function walk(directory, prefix) {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      const metadata = lstatSync(absolute);
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
        records.push({ path: relative, type: 'DIRECTORY' });
        if (records.length > MAX_RECORDS) fail('source manifest has too many records');
        walk(absolute, relative);
      } else if (metadata.isFile() && !metadata.isSymbolicLink()) {
        records.push({ path: relative, type: 'FILE', ...stableFileDigest(absolute) });
      } else if (metadata.isSymbolicLink()) {
        records.push({ path: relative, target: readlinkSync(absolute), type: 'SYMLINK' });
      } else {
        fail(`source manifest rejects unsupported entry: ${relative}`);
      }
      if (records.length > MAX_RECORDS) fail('source manifest has too many records');
    }
  }
  walk(root, '');
  return records;
}

function canonical(value) {
  return `${JSON.stringify(value)}\n`;
}

function trustedRoot(value) {
  const root = path.resolve(value);
  const metadata = lstatSync(root);
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || root !== value) {
    fail('source manifest root must be one real canonical directory');
  }
  return root;
}

function create(rootValue, outputValue, targetGitCommit, closed) {
  if (!/^[a-f0-9]{40}$/u.test(targetGitCommit)) fail('source manifest commit is invalid');
  const root = trustedRoot(rootValue);
  const output = path.resolve(outputValue);
  const parent = lstatSync(path.dirname(output));
  if (parent.isSymbolicLink() || !parent.isDirectory()
    || (typeof process.geteuid === 'function' && parent.uid !== process.geteuid())
    || (process.platform !== 'win32' && (parent.mode & 0o077) !== 0)) {
    fail('source manifest output parent must be private and caller-owned');
  }
  const bytes = canonical({
    schemaVersion: 1,
    targetGitCommit,
    closed,
    records: sourceRecords(root),
  });
  if (Buffer.byteLength(bytes) > MAX_MANIFEST_BYTES) fail('source manifest is too large');
  const descriptor = openSync(
    output,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    0o600,
  );
  try {
    writeFileSync(descriptor, bytes, 'utf8');
  } finally {
    closeSync(descriptor);
  }
}

function verify(rootValue, manifestValue, targetGitCommit) {
  const root = trustedRoot(rootValue);
  const manifestPath = path.resolve(manifestValue);
  const metadata = lstatSync(manifestPath);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_MANIFEST_BYTES) {
    fail('source manifest must be one bounded regular file');
  }
  const source = readFileSync(manifestPath, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch {
    fail('source manifest is invalid JSON');
  }
  if (canonical(manifest) !== source || manifest?.schemaVersion !== 1
    || manifest.targetGitCommit !== targetGitCommit || typeof manifest.closed !== 'boolean'
    || !Array.isArray(manifest.records) || manifest.records.length > MAX_RECORDS) {
    fail('source manifest is noncanonical or does not match the target commit');
  }
  let actualRecords;
  if (manifest.closed) {
    actualRecords = sourceRecords(root);
  } else {
    actualRecords = manifest.records.map((record) => sourceRecordForPath(root, record.path));
    if (actualRecords.some((record) => record === null)) {
      fail('sealed deployment source is missing a pre-build manifest path');
    }
  }
  const expected = canonical({
    schemaVersion: 1,
    targetGitCommit,
    closed: manifest.closed,
    records: actualRecords,
  });
  if (expected !== source) {
    fail(manifest.closed
      ? 'sealed deployment source differs from its closed post-build manifest'
      : 'sealed deployment source differs from its open pre-build manifest');
  }
}

function sourceRecordForPath(root, relative) {
  if (typeof relative !== 'string' || relative.length === 0) return null;
  const segments = relative.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
    || (path.sep === '\\' && relative.includes('\\'))) {
    return null;
  }
  const absolute = path.resolve(root, ...segments);
  if (!absolute.startsWith(`${root}${path.sep}`)) return null;
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    let ancestor;
    try {
      ancestor = lstatSync(current);
    } catch {
      return null;
    }
    if (ancestor.isSymbolicLink() || !ancestor.isDirectory()) return null;
  }
  let metadata;
  try {
    metadata = lstatSync(absolute);
  } catch {
    return null;
  }
  if (metadata.isFile() && !metadata.isSymbolicLink()) {
    return { path: relative, type: 'FILE', ...stableFileDigest(absolute) };
  }
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
    return { path: relative, type: 'DIRECTORY' };
  }
  if (metadata.isSymbolicLink()) {
    return { path: relative, target: readlinkSync(absolute), type: 'SYMLINK' };
  }
  return null;
}

function main() {
  const [mode, root, manifest, targetGitCommit] = process.argv.slice(2);
  if (!['create', 'create-closed', 'verify'].includes(mode) || !root || !manifest || !targetGitCommit
    || process.argv.length !== 6) {
    fail('source manifest usage is: create|create-closed|verify <root> <manifest> <target-commit>');
  }
  if (typeof process.geteuid === 'function' && process.geteuid() !== 0) {
    fail('source manifest operations must run as root');
  }
  if (mode === 'create') create(root, manifest, targetGitCommit, false);
  else if (mode === 'create-closed') create(root, manifest, targetGitCommit, true);
  else verify(root, manifest, targetGitCommit);
}

try {
  main();
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
