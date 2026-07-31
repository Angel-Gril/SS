#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

const MAX_JSON_BYTES = 65_536;
const MAX_BACKUP_BYTES = 64 * 1024 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024 * 1024;
const MAX_AGE_MINUTES = 24 * 60;
const READ_CHUNK_BYTES = 64 * 1024;
const FULL_GIT_OID = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const DATABASE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const BACKUP_FILENAME = /^ss_erp_[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}\.sql\.gz$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const RECORD_OPTIONS = new Set([
  '--backup-dir',
  '--backup-status',
  '--output',
  '--expected-database-id',
  '--expected-database-identity-sha256',
  '--expected-database-uuid-sha256',
  '--expected-target-git-commit',
  '--restore-proof',
  '--restore-started-at',
  '--restore-completed-at',
  '--table-count',
  '--now',
]);

const VERIFY_OPTIONS = new Set([
  '--attestation',
  '--backup-dir',
  '--expected-database-id',
  '--expected-database-identity-sha256',
  '--expected-database-uuid-sha256',
  '--expected-target-git-commit',
  '--max-age-minutes',
  '--now',
]);

const ARCHIVE_OPTIONS = new Set([
  '--attestation',
  '--backup-dir',
  '--expected-database-id',
  '--expected-database-identity-sha256',
  '--expected-database-uuid-sha256',
  '--expected-target-git-commit',
]);

const RESTORE_STREAM_OPTIONS = new Set([
  '--backup-dir',
  '--backup-status',
  '--restore-proof',
  '--expected-database-id',
  '--expected-database-identity-sha256',
  '--expected-database-uuid-sha256',
  '--expected-target-git-commit',
  '--restore-started-at',
  '--now',
]);

function fail(message) {
  throw new Error(message);
}

function parseArguments() {
  const args = process.argv.slice(2);
  const mode = args.shift();
  if (!['archive', 'record', 'restore-stream', 'verify'].includes(mode)) {
    fail('mode must be archive, record, restore-stream, or verify');
  }
  const allowed = mode === 'archive'
    ? ARCHIVE_OPTIONS
    : mode === 'record'
      ? RECORD_OPTIONS
    : mode === 'restore-stream'
      ? RESTORE_STREAM_OPTIONS
      : VERIFY_OPTIONS;
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name)) fail(`unknown ${mode} option: ${String(name || '')}`);
    if (value === undefined || value.startsWith('--')) fail(`${name} requires a value`);
    if (options.has(name)) fail(`${name} must be provided exactly once`);
    options.set(name, value);
  }
  return { mode, options };
}

function requiredOption(options, name) {
  const value = options.get(name);
  if (!value) fail(`${name} is required`);
  return value;
}

function canonicalPositiveInteger(value, label) {
  if (!/^[1-9][0-9]{0,14}$/u.test(String(value || ''))) {
    fail(`${label} must be a canonical positive integer`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) fail(`${label} must be a canonical positive integer`);
  return number;
}

function canonicalDatabaseId(value, label) {
  if (!DATABASE_ID.test(String(value || ''))) {
    fail(`${label} must be a canonical database identifier`);
  }
  return value;
}

function canonicalGitCommit(value, label) {
  if (!FULL_GIT_OID.test(String(value || ''))) {
    fail(`${label} must be one lowercase full 40-character Git object ID`);
  }
  return value;
}

function canonicalTimestamp(value, label) {
  if (!CANONICAL_TIMESTAMP.test(String(value || ''))) {
    fail(`${label} must be a canonical UTC timestamp`);
  }
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== value) {
    fail(`${label} must be a canonical UTC timestamp`);
  }
  return value;
}

function nowTimestamp(options) {
  const supplied = options.get('--now');
  if (!supplied) return new Date().toISOString();
  if (process.env.DEPLOY_BACKUP_ATTESTATION_TEST_NOW !== '1') {
    fail('--now is available only when DEPLOY_BACKUP_ATTESTATION_TEST_NOW=1');
  }
  return canonicalTimestamp(supplied, '--now');
}

function statIdentity(stat) {
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    mode: stat.mode.toString(),
    uid: stat.uid.toString(),
    gid: stat.gid.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  };
}

function sameIdentity(left, right) {
  const leftIdentity = statIdentity(left);
  const rightIdentity = statIdentity(right);
  return Object.keys(leftIdentity).every((key) => leftIdentity[key] === rightIdentity[key]);
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameDirectory(left, right) {
  return sameFile(left, right) && left.mode === right.mode;
}

function assertPrivateFileMode(metadata, label) {
  if (process.platform !== 'win32') {
    if (Number(metadata.mode & 0o777n) !== 0o600) {
      fail(`${label} must use private mode 0600`);
    }
    if (typeof process.geteuid === 'function' && metadata.uid !== BigInt(process.geteuid())) {
      fail(`${label} must be owned by the deployment verifier user`);
    }
  }
}

function assertTrustedDirectory(metadata, label) {
  if (process.platform !== 'win32') {
    if (Number(metadata.mode & 0o022n) !== 0) {
      fail(`${label} must not be group or world writable`);
    }
    if (typeof process.geteuid === 'function' && metadata.uid !== BigInt(process.geteuid())) {
      fail(`${label} must be owned by the deployment verifier user`);
    }
  }
}

function lstatRegularFile(file, label) {
  let metadata;
  try {
    metadata = lstatSync(file, { bigint: true });
  } catch {
    fail(`${label} is missing or unreadable: ${file}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail(`${label} must be one regular non-symbolic-link file`);
  }
  return metadata;
}

function lstatDirectory(directory, label) {
  let metadata;
  try {
    metadata = lstatSync(directory, { bigint: true });
  } catch {
    fail(`${label} is missing or unreadable: ${directory}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    fail(`${label} must be one real directory`);
  }
  assertTrustedDirectory(metadata, label);
  return metadata;
}

function openDirectorySnapshot(directory, label) {
  const absolute = path.resolve(directory);
  const before = lstatDirectory(absolute, label);
  let descriptor = null;
  if (process.platform !== 'win32') {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (constants.O_DIRECTORY || 0) | constants.O_NOFOLLOW,
    );
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isDirectory() || !sameFile(before, opened)) {
      closeSync(descriptor);
      fail(`${label} changed while it was opened`);
    }
  }
  return { absolute, before, descriptor, label };
}

function assertDirectoryUnchanged(snapshot) {
  const after = lstatDirectory(snapshot.absolute, snapshot.label);
  if (!sameDirectory(snapshot.before, after)) {
    fail(`${snapshot.label} changed during backup attestation processing`);
  }
  if (snapshot.descriptor !== null) {
    const opened = fstatSync(snapshot.descriptor, { bigint: true });
    if (!opened.isDirectory() || !sameDirectory(snapshot.before, opened)) {
      fail(`${snapshot.label} handle changed during backup attestation processing`);
    }
  }
}

function closeDirectorySnapshot(snapshot) {
  if (snapshot.descriptor !== null) closeSync(snapshot.descriptor);
}

function openRegularNoFollow(file, label, maxBytes) {
  const absolute = path.resolve(file);
  const pathBefore = lstatRegularFile(absolute, label);
  let descriptor = null;
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
    const descriptorBefore = fstatSync(descriptor, { bigint: true });
    if (!descriptorBefore.isFile() || !sameFile(pathBefore, descriptorBefore)) {
      fail(`${label} changed while it was opened`);
    }
    if (descriptorBefore.size < 1n || descriptorBefore.size > BigInt(maxBytes)) {
      fail(`${label} is empty or exceeds ${maxBytes} bytes`);
    }
    return { absolute, descriptor, pathBefore, descriptorBefore, label };
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    throw error;
  }
}

function finishRegularRead(snapshot) {
  const descriptorAfter = fstatSync(snapshot.descriptor, { bigint: true });
  const pathAfter = lstatRegularFile(snapshot.absolute, snapshot.label);
  if (!sameIdentity(snapshot.descriptorBefore, descriptorAfter)
    || !sameIdentity(snapshot.pathBefore, pathAfter)
    || !sameFile(descriptorAfter, pathAfter)) {
    fail(`${snapshot.label} changed while it was read`);
  }
  return pathAfter;
}

function assertPathSnapshotUnchanged(file, expected, label) {
  const current = lstatRegularFile(file, label);
  if (!sameIdentity(expected, current)) {
    fail(`${label} changed during backup attestation processing`);
  }
}

function readBoundedNoFollow(file, label, maxBytes) {
  const snapshot = openRegularNoFollow(file, label, maxBytes);
  try {
    const chunks = [];
    let total = 0;
    while (true) {
      const remaining = maxBytes + 1 - total;
      if (remaining < 1) fail(`${label} exceeds ${maxBytes} bytes`);
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining));
      const read = readSync(snapshot.descriptor, chunk, 0, chunk.length, null);
      if (read === 0) break;
      total += read;
      if (total > maxBytes) fail(`${label} exceeds ${maxBytes} bytes`);
      chunks.push(chunk.subarray(0, read));
    }
    const pathAfter = finishRegularRead(snapshot);
    return { bytes: Buffer.concat(chunks, total), path: snapshot.absolute, pathAfter };
  } finally {
    closeSync(snapshot.descriptor);
  }
}

function decodeCanonicalUtf8(bytes, label) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail(`${label} must use valid UTF-8`);
  }
  if (text.charCodeAt(0) === 0xfeff || text.includes('\r') || text.includes('\0')) {
    fail(`${label} must use canonical UTF-8 with LF line endings`);
  }
  return text;
}

function parseJsonObject(bytes, label) {
  const text = decodeCanonicalUtf8(bytes, label);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail(`${label} must contain one valid JSON object`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must contain one valid JSON object`);
  }
  return { text, value };
}

function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !actual.includes(key))) {
    fail(`${label} must use its closed schema without unknown or missing fields`);
  }
}

function canonicalBackupFilename(value, label) {
  if (typeof value !== 'string' || !BACKUP_FILENAME.test(value) || path.basename(value) !== value) {
    fail(`${label} must be one safe ss_erp_*.sql.gz filename`);
  }
  return value;
}

function canonicalSha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail(`${label} must be one lowercase SHA-256 digest`);
  }
  return value;
}

function boundedText(value, label, maxLength, { allowEmpty = false } = {}) {
  const hasControlCharacter = typeof value === 'string' && [...value].some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (typeof value !== 'string'
    || (!allowEmpty && value.length === 0)
    || value.length > maxLength
    || hasControlCharacter) {
    fail(`${label} must be bounded printable text`);
  }
  return value;
}

function parseBackupStatus(readResult) {
  const { text, value } = parseJsonObject(readResult.bytes, 'backup status');
  assertExactKeys(value, [
    'schemaVersion',
    'lastBackupAt',
    'lastLocalFile',
    'lastLocalSize',
    'lastLocalBytes',
    'lastLocalSha256',
    'databaseId',
    'databaseIdentitySha256',
    'databaseUuidSha256',
    'targetGitCommit',
    'remoteUploaded',
    'lastRemoteKey',
  ], 'backup status');
  if (value.schemaVersion !== 3) fail('backup status schemaVersion must be 3');
  if (!Number.isSafeInteger(value.lastLocalBytes) || value.lastLocalBytes < 1
    || value.lastLocalBytes > MAX_BACKUP_BYTES) {
    fail('backup status lastLocalBytes is outside the backup size limit');
  }
  if (typeof value.remoteUploaded !== 'boolean') {
    fail('backup status remoteUploaded must be boolean');
  }
  const normalized = {
    schemaVersion: 3,
    lastBackupAt: canonicalTimestamp(value.lastBackupAt, 'backup status lastBackupAt'),
    lastLocalFile: canonicalBackupFilename(value.lastLocalFile, 'backup status lastLocalFile'),
    lastLocalSize: boundedText(value.lastLocalSize, 'backup status lastLocalSize', 64),
    lastLocalBytes: value.lastLocalBytes,
    lastLocalSha256: canonicalSha256(value.lastLocalSha256, 'backup status lastLocalSha256'),
    databaseId: canonicalDatabaseId(value.databaseId, 'backup status databaseId'),
    databaseIdentitySha256: canonicalSha256(
      value.databaseIdentitySha256,
      'backup status databaseIdentitySha256',
    ),
    databaseUuidSha256: canonicalSha256(
      value.databaseUuidSha256,
      'backup status databaseUuidSha256',
    ),
    targetGitCommit: canonicalGitCommit(
      value.targetGitCommit,
      'backup status targetGitCommit',
    ),
    remoteUploaded: value.remoteUploaded,
    lastRemoteKey: boundedText(
      value.lastRemoteKey,
      'backup status lastRemoteKey',
      1024,
      { allowEmpty: true },
    ),
  };
  if (normalized.remoteUploaded !== Boolean(normalized.lastRemoteKey)) {
    fail('backup status remote upload state and remote key do not agree');
  }
  const canonical = `${JSON.stringify(normalized, null, 2)}\n`;
  if (text !== canonical) {
    fail('backup status must use canonical JSON without duplicate keys');
  }
  return normalized;
}

function parseAttestation(readResult) {
  const { text, value } = parseJsonObject(readResult.bytes, 'deploy backup attestation');
  assertExactKeys(value, [
    'schemaVersion',
    'kind',
    'databaseId',
    'databaseIdentitySha256',
    'databaseUuidSha256',
    'targetGitCommit',
    'backup',
    'restoreDrill',
  ], 'deploy backup attestation');
  if (value.schemaVersion !== 2) fail('deploy backup attestation schemaVersion must be 2');
  if (value.kind !== 'SS_ERP_DEPLOY_BACKUP_ATTESTATION') {
    fail('deploy backup attestation kind is invalid');
  }
  if (!value.backup || typeof value.backup !== 'object' || Array.isArray(value.backup)) {
    fail('deploy backup attestation backup must be an object');
  }
  if (!value.restoreDrill
    || typeof value.restoreDrill !== 'object'
    || Array.isArray(value.restoreDrill)) {
    fail('deploy backup attestation restoreDrill must be an object');
  }
  assertExactKeys(value.backup, [
    'filename',
    'createdAt',
    'bytes',
    'sha256',
    'statusSha256',
  ], 'deploy backup attestation backup');
  assertExactKeys(value.restoreDrill, [
    'status',
    'startedAt',
    'completedAt',
    'tableCount',
  ], 'deploy backup attestation restoreDrill');
  if (!Number.isSafeInteger(value.backup.bytes)
    || value.backup.bytes < 1
    || value.backup.bytes > MAX_BACKUP_BYTES) {
    fail('deploy backup attestation backup bytes are outside the backup size limit');
  }
  if (value.restoreDrill.status !== 'PASSED') {
    fail('deploy backup attestation restore drill must have passed');
  }
  if (!Number.isSafeInteger(value.restoreDrill.tableCount)
    || value.restoreDrill.tableCount < 1) {
    fail('deploy backup attestation restore table count must be positive');
  }
  const normalized = {
    schemaVersion: 2,
    kind: 'SS_ERP_DEPLOY_BACKUP_ATTESTATION',
    databaseId: canonicalDatabaseId(value.databaseId, 'attested databaseId'),
    databaseIdentitySha256: canonicalSha256(
      value.databaseIdentitySha256,
      'attested databaseIdentitySha256',
    ),
    databaseUuidSha256: canonicalSha256(
      value.databaseUuidSha256,
      'attested databaseUuidSha256',
    ),
    targetGitCommit: canonicalGitCommit(value.targetGitCommit, 'attested targetGitCommit'),
    backup: {
      filename: canonicalBackupFilename(value.backup.filename, 'attested backup filename'),
      createdAt: canonicalTimestamp(value.backup.createdAt, 'attested backup createdAt'),
      bytes: value.backup.bytes,
      sha256: canonicalSha256(value.backup.sha256, 'attested backup sha256'),
      statusSha256: canonicalSha256(
        value.backup.statusSha256,
        'attested backup statusSha256',
      ),
    },
    restoreDrill: {
      status: 'PASSED',
      startedAt: canonicalTimestamp(
        value.restoreDrill.startedAt,
        'attested restore startedAt',
      ),
      completedAt: canonicalTimestamp(
        value.restoreDrill.completedAt,
        'attested restore completedAt',
      ),
      tableCount: value.restoreDrill.tableCount,
    },
  };
  const canonical = `${JSON.stringify(normalized, null, 2)}\n`;
  if (text !== canonical) {
    fail('deploy backup attestation must use canonical JSON without duplicate keys');
  }
  assertChronology(normalized, null);
  return normalized;
}

function parseRestoreProof(readResult) {
  const { text, value } = parseJsonObject(readResult.bytes, 'restore stream proof');
  assertExactKeys(value, [
    'schemaVersion',
    'kind',
    'databaseId',
    'databaseIdentitySha256',
    'databaseUuidSha256',
    'targetGitCommit',
    'restoreStartedAt',
    'backup',
  ], 'restore stream proof');
  if (value.schemaVersion !== 1 || value.kind !== 'SS_ERP_DEPLOY_BACKUP_RESTORE_STREAM') {
    fail('restore stream proof schema or kind is invalid');
  }
  if (!value.backup || typeof value.backup !== 'object' || Array.isArray(value.backup)) {
    fail('restore stream proof backup must be an object');
  }
  assertExactKeys(value.backup, [
    'filename',
    'bytes',
    'sha256',
    'statusSha256',
  ], 'restore stream proof backup');
  if (!Number.isSafeInteger(value.backup.bytes)
    || value.backup.bytes < 1
    || value.backup.bytes > MAX_BACKUP_BYTES) {
    fail('restore stream proof backup bytes are outside the backup size limit');
  }
  const normalized = {
    schemaVersion: 1,
    kind: 'SS_ERP_DEPLOY_BACKUP_RESTORE_STREAM',
    databaseId: canonicalDatabaseId(value.databaseId, 'restore proof databaseId'),
    databaseIdentitySha256: canonicalSha256(
      value.databaseIdentitySha256,
      'restore proof databaseIdentitySha256',
    ),
    databaseUuidSha256: canonicalSha256(
      value.databaseUuidSha256,
      'restore proof databaseUuidSha256',
    ),
    targetGitCommit: canonicalGitCommit(
      value.targetGitCommit,
      'restore proof targetGitCommit',
    ),
    restoreStartedAt: canonicalTimestamp(
      value.restoreStartedAt,
      'restore proof restoreStartedAt',
    ),
    backup: {
      filename: canonicalBackupFilename(value.backup.filename, 'restore proof backup filename'),
      bytes: value.backup.bytes,
      sha256: canonicalSha256(value.backup.sha256, 'restore proof backup sha256'),
      statusSha256: canonicalSha256(
        value.backup.statusSha256,
        'restore proof backup statusSha256',
      ),
    },
  };
  if (text !== `${JSON.stringify(normalized, null, 2)}\n`) {
    fail('restore stream proof must use canonical JSON without duplicate keys');
  }
  return normalized;
}

function assertChronology(attestation, now) {
  const createdAt = Date.parse(attestation.backup.createdAt);
  const startedAt = Date.parse(attestation.restoreDrill.startedAt);
  const completedAt = Date.parse(attestation.restoreDrill.completedAt);
  if (!(createdAt <= startedAt && startedAt < completedAt)) {
    fail('backup and restore timestamps are not in chronological order');
  }
  if (now !== null && completedAt > Date.parse(now)) {
    fail('backup restore evidence cannot be dated in the future');
  }
}

async function inspectGzipBackup(file, label, output = null) {
  const snapshot = openRegularNoFollow(file, label, MAX_BACKUP_BYTES);
  const compressedBytes = Number(snapshot.descriptorBefore.size);
  const hash = createHash('sha256');
  let uncompressedBytes = 0;
  const hashingStream = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  const countChunk = (chunk, callback, passThrough) => {
    uncompressedBytes += chunk.length;
    if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
      callback(new Error('uncompressed backup exceeds the restore verification limit'));
      return;
    }
    callback(null, passThrough ? chunk : undefined);
  };
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      countChunk(chunk, callback, false);
    },
  });
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      countChunk(chunk, callback, true);
    },
  });
  try {
    const stream = createReadStream(snapshot.absolute, {
      fd: snapshot.descriptor,
      autoClose: false,
      start: 0,
      end: compressedBytes - 1,
    });
    try {
      if (output === null) {
        await pipeline(stream, hashingStream, createGunzip(), sink);
      } else {
        await pipeline(stream, hashingStream, createGunzip(), limiter, output);
      }
    } catch (error) {
      fail(
        `backup must be a valid non-empty gzip stream: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (uncompressedBytes < 1) fail('backup must be a valid non-empty gzip stream');
    const pathAfter = finishRegularRead(snapshot);
    return {
      bytes: compressedBytes,
      sha256: hash.digest('hex'),
      path: snapshot.absolute,
      pathAfter,
    };
  } finally {
    closeSync(snapshot.descriptor);
  }
}

function synchronizeDirectory(snapshot) {
  if (snapshot.descriptor !== null) fsyncSync(snapshot.descriptor);
}

function writeNewFileDurably(finalPath, bytes, beforeCommit) {
  const absolute = path.resolve(finalPath);
  const directory = openDirectorySnapshot(path.dirname(absolute), 'attestation output directory');
  const temporary = path.join(
    directory.absolute,
    `.${path.basename(absolute)}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`,
  );
  let descriptor = null;
  let finalLinked = false;
  let temporaryStat = null;
  try {
    if (existsSync(absolute)) fail(`deploy backup attestation already exists: ${absolute}`);
    descriptor = openSync(
      temporary,
      constants.O_WRONLY
        | constants.O_CREAT
        | constants.O_EXCL
        | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
      0o600,
    );
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (written < 1) fail('could not complete the deploy backup attestation write');
      offset += written;
    }
    fsyncSync(descriptor);
    temporaryStat = fstatSync(descriptor, { bigint: true });
    if (!temporaryStat.isFile()
      || (process.platform !== 'win32' && Number(temporaryStat.mode & 0o777n) !== 0o600)) {
      fail('deploy backup attestation temporary file is not private mode 0600');
    }
    closeSync(descriptor);
    descriptor = null;

    assertDirectoryUnchanged(directory);
    beforeCommit();
    assertDirectoryUnchanged(directory);
    linkSync(temporary, absolute);
    finalLinked = true;
    const finalStat = lstatRegularFile(absolute, 'written deploy backup attestation');
    if (!sameFile(temporaryStat, finalStat)
      || (process.platform !== 'win32' && Number(finalStat.mode & 0o777n) !== 0o600)) {
      fail('written deploy backup attestation identity or private mode is invalid');
    }
    synchronizeDirectory(directory);
    rmSync(temporary);
    synchronizeDirectory(directory);
    assertDirectoryUnchanged(directory);
    return { absolute, pathAfter: lstatRegularFile(absolute, 'written deploy backup attestation') };
  } catch (error) {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the actionable write failure.
      }
    }
    if (finalLinked && temporaryStat !== null) {
      try {
        const current = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
        if (current !== undefined && current.isFile() && sameFile(temporaryStat, current)) {
          rmSync(absolute);
        }
      } catch {
        // A failed durability check cannot leave an accepted artifact.
      }
    }
    try {
      rmSync(temporary, { force: true });
    } catch {
      // The original failure remains actionable.
    }
    throw error;
  } finally {
    closeDirectorySnapshot(directory);
  }
}

function backupPathWithin(directory, filename) {
  const backupPath = path.resolve(directory, filename);
  if (path.dirname(backupPath) !== directory || path.basename(backupPath) !== filename) {
    fail('backup filename escapes the approved backup directory');
  }
  return backupPath;
}

function restoreProofPathWithin(directory, file, targetGitCommit) {
  const absolute = path.resolve(file);
  const filename = path.basename(absolute);
  const expected = new RegExp(
    `^deploy-backup-${targetGitCommit}\\.restore-proof-[a-f0-9]{24}\\.json$`,
    'u',
  );
  if (path.dirname(absolute) !== directory || !expected.test(filename)) {
    fail('restore proof must use its target-bound randomized path in the backup directory');
  }
  return absolute;
}

async function restoreStream(options) {
  const backupDirectory = openDirectorySnapshot(
    requiredOption(options, '--backup-dir'),
    'backup directory',
  );
  try {
    const expectedDatabaseId = canonicalDatabaseId(
      requiredOption(options, '--expected-database-id'),
      '--expected-database-id',
    );
    const expectedDatabaseIdentitySha256 = canonicalSha256(
      requiredOption(options, '--expected-database-identity-sha256'),
      '--expected-database-identity-sha256',
    );
    const expectedDatabaseUuidSha256 = canonicalSha256(
      requiredOption(options, '--expected-database-uuid-sha256'),
      '--expected-database-uuid-sha256',
    );
    const expectedTargetGitCommit = canonicalGitCommit(
      requiredOption(options, '--expected-target-git-commit'),
      '--expected-target-git-commit',
    );
    const restoreStartedAt = canonicalTimestamp(
      requiredOption(options, '--restore-started-at'),
      '--restore-started-at',
    );
    const now = nowTimestamp(options);
    if (Date.parse(restoreStartedAt) > Date.parse(now)) {
      fail('restore stream cannot start in the future');
    }
    const statusPath = path.resolve(requiredOption(options, '--backup-status'));
    const statusRead = readBoundedNoFollow(statusPath, 'backup status', MAX_JSON_BYTES);
    assertPrivateFileMode(statusRead.pathAfter, 'backup status');
    const status = parseBackupStatus(statusRead);
    const expectedStatusPath = path.join(
      backupDirectory.absolute,
      `${status.lastLocalFile}.status.json`,
    );
    if (statusPath !== expectedStatusPath) {
      fail(`--backup-status must be exactly ${expectedStatusPath}`);
    }
    if (status.databaseId !== expectedDatabaseId
      || status.databaseIdentitySha256 !== expectedDatabaseIdentitySha256
      || status.databaseUuidSha256 !== expectedDatabaseUuidSha256
      || status.targetGitCommit !== expectedTargetGitCommit) {
      fail('backup status deployment identity does not match the restore target');
    }
    if (Date.parse(status.lastBackupAt) > Date.parse(restoreStartedAt)) {
      fail('backup timestamp must not follow the restore start');
    }
    const proofPath = restoreProofPathWithin(
      backupDirectory.absolute,
      requiredOption(options, '--restore-proof'),
      expectedTargetGitCommit,
    );
    const backupPath = backupPathWithin(backupDirectory.absolute, status.lastLocalFile);
    const inspected = await inspectGzipBackup(backupPath, 'backup artifact', process.stdout);
    assertPrivateFileMode(inspected.pathAfter, 'backup artifact');
    if (inspected.bytes !== status.lastLocalBytes || inspected.sha256 !== status.lastLocalSha256) {
      fail('restored backup bytes or SHA-256 do not match backup status');
    }
    const proof = {
      schemaVersion: 1,
      kind: 'SS_ERP_DEPLOY_BACKUP_RESTORE_STREAM',
      databaseId: expectedDatabaseId,
      databaseIdentitySha256: expectedDatabaseIdentitySha256,
      databaseUuidSha256: expectedDatabaseUuidSha256,
      targetGitCommit: expectedTargetGitCommit,
      restoreStartedAt,
      backup: {
        filename: status.lastLocalFile,
        bytes: inspected.bytes,
        sha256: inspected.sha256,
        statusSha256: createHash('sha256').update(statusRead.bytes).digest('hex'),
      },
    };
    writeNewFileDurably(
      proofPath,
      Buffer.from(`${JSON.stringify(proof, null, 2)}\n`, 'utf8'),
      () => {
        assertPathSnapshotUnchanged(statusRead.path, statusRead.pathAfter, 'backup status');
        assertPathSnapshotUnchanged(inspected.path, inspected.pathAfter, 'backup artifact');
        assertDirectoryUnchanged(backupDirectory);
      },
    );
  } finally {
    closeDirectorySnapshot(backupDirectory);
  }
}

async function record(options) {
  const backupDirectory = openDirectorySnapshot(
    requiredOption(options, '--backup-dir'),
    'backup directory',
  );
  try {
    const statusPath = path.resolve(requiredOption(options, '--backup-status'));
    const outputPath = path.resolve(requiredOption(options, '--output'));
    const expectedDatabaseId = canonicalDatabaseId(
      requiredOption(options, '--expected-database-id'),
      '--expected-database-id',
    );
    const expectedDatabaseIdentitySha256 = canonicalSha256(
      requiredOption(options, '--expected-database-identity-sha256'),
      '--expected-database-identity-sha256',
    );
    const expectedDatabaseUuidSha256 = canonicalSha256(
      requiredOption(options, '--expected-database-uuid-sha256'),
      '--expected-database-uuid-sha256',
    );
    const expectedTargetGitCommit = canonicalGitCommit(
      requiredOption(options, '--expected-target-git-commit'),
      '--expected-target-git-commit',
    );
    const expectedOutputPath = path.join(
      backupDirectory.absolute,
      `deploy-backup-${expectedTargetGitCommit}.attestation.json`,
    );
    if (outputPath !== expectedOutputPath) {
      fail(`--output must be exactly ${expectedOutputPath}`);
    }
    const restoreProofPath = restoreProofPathWithin(
      backupDirectory.absolute,
      requiredOption(options, '--restore-proof'),
      expectedTargetGitCommit,
    );
    const restoreStartedAt = canonicalTimestamp(
      requiredOption(options, '--restore-started-at'),
      '--restore-started-at',
    );
    const restoreCompletedAt = canonicalTimestamp(
      requiredOption(options, '--restore-completed-at'),
      '--restore-completed-at',
    );
    const tableCount = canonicalPositiveInteger(
      requiredOption(options, '--table-count'),
      '--table-count',
    );
    const now = nowTimestamp(options);

    const statusRead = readBoundedNoFollow(statusPath, 'backup status', MAX_JSON_BYTES);
    assertPrivateFileMode(statusRead.pathAfter, 'backup status');
    const status = parseBackupStatus(statusRead);
    const expectedStatusPath = path.join(
      backupDirectory.absolute,
      `${status.lastLocalFile}.status.json`,
    );
    if (statusPath !== expectedStatusPath) {
      fail(`--backup-status must be exactly ${expectedStatusPath}`);
    }
    if (status.databaseId !== expectedDatabaseId) {
      fail('backup status databaseId does not match the expected deployment database');
    }
    if (status.databaseIdentitySha256 !== expectedDatabaseIdentitySha256) {
      fail('backup status database identity digest does not match the deployment database');
    }
    if (status.databaseUuidSha256 !== expectedDatabaseUuidSha256) {
      fail('backup status database UUID digest does not match the deployment database');
    }
    if (status.targetGitCommit !== expectedTargetGitCommit) {
      fail('backup status targetGitCommit does not match the expected deployment commit');
    }
    const backupPath = backupPathWithin(backupDirectory.absolute, status.lastLocalFile);
    const inspected = await inspectGzipBackup(backupPath, 'backup artifact');
    assertPrivateFileMode(inspected.pathAfter, 'backup artifact');
    if (inspected.bytes !== status.lastLocalBytes || inspected.sha256 !== status.lastLocalSha256) {
      fail('backup bytes or SHA-256 do not match backup status');
    }
    const restoreProofRead = readBoundedNoFollow(
      restoreProofPath,
      'restore stream proof',
      MAX_JSON_BYTES,
    );
    assertPrivateFileMode(restoreProofRead.pathAfter, 'restore stream proof');
    const restoreProof = parseRestoreProof(restoreProofRead);
    const statusSha256 = createHash('sha256').update(statusRead.bytes).digest('hex');
    if (restoreProof.databaseId !== expectedDatabaseId
      || restoreProof.databaseIdentitySha256 !== expectedDatabaseIdentitySha256
      || restoreProof.databaseUuidSha256 !== expectedDatabaseUuidSha256
      || restoreProof.targetGitCommit !== expectedTargetGitCommit
      || restoreProof.restoreStartedAt !== restoreStartedAt
      || restoreProof.backup.filename !== status.lastLocalFile
      || restoreProof.backup.bytes !== inspected.bytes
      || restoreProof.backup.sha256 !== inspected.sha256
      || restoreProof.backup.statusSha256 !== statusSha256) {
      fail('restore stream proof does not match the attested backup and restore attempt');
    }
    const attestation = {
      schemaVersion: 2,
      kind: 'SS_ERP_DEPLOY_BACKUP_ATTESTATION',
      databaseId: expectedDatabaseId,
      databaseIdentitySha256: expectedDatabaseIdentitySha256,
      databaseUuidSha256: expectedDatabaseUuidSha256,
      targetGitCommit: expectedTargetGitCommit,
      backup: {
        filename: status.lastLocalFile,
        createdAt: status.lastBackupAt,
        bytes: inspected.bytes,
        sha256: inspected.sha256,
        statusSha256,
      },
      restoreDrill: {
        status: 'PASSED',
        startedAt: restoreStartedAt,
        completedAt: restoreCompletedAt,
        tableCount,
      },
    };
    assertChronology(attestation, now);
    const output = writeNewFileDurably(
      outputPath,
      Buffer.from(`${JSON.stringify(attestation, null, 2)}\n`, 'utf8'),
      () => {
        assertPathSnapshotUnchanged(statusRead.path, statusRead.pathAfter, 'backup status');
        assertPathSnapshotUnchanged(inspected.path, inspected.pathAfter, 'backup artifact');
        assertPathSnapshotUnchanged(
          restoreProofRead.path,
          restoreProofRead.pathAfter,
          'restore stream proof',
        );
        assertDirectoryUnchanged(backupDirectory);
      },
    );
    assertPathSnapshotUnchanged(
      output.absolute,
      output.pathAfter,
      'written deploy backup attestation',
    );
    console.log(`PASS deploy backup attestation recorded: ${output.absolute}`);
  } finally {
    closeDirectorySnapshot(backupDirectory);
  }
}

async function verify(options) {
  const backupDirectory = openDirectorySnapshot(
    requiredOption(options, '--backup-dir'),
    'backup directory',
  );
  try {
    const attestationPath = path.resolve(requiredOption(options, '--attestation'));
    const expectedDatabaseId = canonicalDatabaseId(
      requiredOption(options, '--expected-database-id'),
      '--expected-database-id',
    );
    const expectedDatabaseIdentitySha256 = canonicalSha256(
      requiredOption(options, '--expected-database-identity-sha256'),
      '--expected-database-identity-sha256',
    );
    const expectedDatabaseUuidSha256 = canonicalSha256(
      requiredOption(options, '--expected-database-uuid-sha256'),
      '--expected-database-uuid-sha256',
    );
    const expectedTargetGitCommit = canonicalGitCommit(
      requiredOption(options, '--expected-target-git-commit'),
      '--expected-target-git-commit',
    );
    const expectedAttestationPath = path.join(
      backupDirectory.absolute,
      `deploy-backup-${expectedTargetGitCommit}.attestation.json`,
    );
    if (attestationPath !== expectedAttestationPath) {
      fail(`--attestation must be exactly ${expectedAttestationPath}`);
    }
    const maxAgeMinutes = canonicalPositiveInteger(
      requiredOption(options, '--max-age-minutes'),
      '--max-age-minutes',
    );
    if (maxAgeMinutes > MAX_AGE_MINUTES) {
      fail(`--max-age-minutes must not exceed ${MAX_AGE_MINUTES}`);
    }
    const now = nowTimestamp(options);
    const attestationRead = readBoundedNoFollow(
      attestationPath,
      'deploy backup attestation',
      MAX_JSON_BYTES,
    );
    assertPrivateFileMode(attestationRead.pathAfter, 'deploy backup attestation');
    const attestation = parseAttestation(attestationRead);
    const statusPath = path.join(
      backupDirectory.absolute,
      `${attestation.backup.filename}.status.json`,
    );
    const statusRead = readBoundedNoFollow(statusPath, 'backup status', MAX_JSON_BYTES);
    assertPrivateFileMode(statusRead.pathAfter, 'backup status');
    const status = parseBackupStatus(statusRead);
    if (attestation.databaseId !== expectedDatabaseId) {
      fail('deploy backup attestation databaseId does not match the expected deployment database');
    }
    if (attestation.databaseIdentitySha256 !== expectedDatabaseIdentitySha256) {
      fail('deploy backup attestation database identity digest does not match the deployment database');
    }
    if (attestation.databaseUuidSha256 !== expectedDatabaseUuidSha256) {
      fail('deploy backup attestation database UUID digest does not match the deployment database');
    }
    if (attestation.targetGitCommit !== expectedTargetGitCommit) {
      fail('deploy backup attestation targetGitCommit does not match the expected deployment commit');
    }
    if (status.databaseId !== expectedDatabaseId
      || status.databaseIdentitySha256 !== expectedDatabaseIdentitySha256
      || status.databaseUuidSha256 !== expectedDatabaseUuidSha256
      || status.targetGitCommit !== expectedTargetGitCommit) {
      fail('backup status deployment identity does not match the verification target');
    }
    const statusSha256 = createHash('sha256').update(statusRead.bytes).digest('hex');
    if (attestation.backup.statusSha256 !== statusSha256
      || attestation.backup.filename !== status.lastLocalFile
      || attestation.backup.bytes !== status.lastLocalBytes
      || attestation.backup.sha256 !== status.lastLocalSha256) {
      fail('backup status does not match the deploy backup attestation');
    }
    assertChronology(attestation, now);
    const nowMs = Date.parse(now);
    const oldestAllowed = nowMs - maxAgeMinutes * 60_000;
    if (Date.parse(attestation.backup.createdAt) < oldestAllowed
      || Date.parse(attestation.restoreDrill.completedAt) < oldestAllowed) {
      fail('backup or restore evidence is older than the deployment backup age limit');
    }
    const backupPath = backupPathWithin(
      backupDirectory.absolute,
      attestation.backup.filename,
    );
    const inspected = await inspectGzipBackup(backupPath, 'backup artifact');
    assertPrivateFileMode(inspected.pathAfter, 'backup artifact');
    if (inspected.bytes !== attestation.backup.bytes
      || inspected.sha256 !== attestation.backup.sha256) {
      fail('backup bytes or SHA-256 do not match the deploy backup attestation');
    }
    assertPathSnapshotUnchanged(
      attestationRead.path,
      attestationRead.pathAfter,
      'deploy backup attestation',
    );
    assertPathSnapshotUnchanged(statusRead.path, statusRead.pathAfter, 'backup status');
    assertPathSnapshotUnchanged(inspected.path, inspected.pathAfter, 'backup artifact');
    assertDirectoryUnchanged(backupDirectory);
    console.log('PASS deploy backup attestation verified');
  } finally {
    closeDirectorySnapshot(backupDirectory);
  }
}

function archive(options) {
  if (typeof process.geteuid !== 'function' || process.geteuid() !== 0) {
    fail('deploy backup attestation archival must run as root');
  }
  const backupDirectory = openDirectorySnapshot(
    requiredOption(options, '--backup-dir'),
    'backup directory',
  );
  try {
    const expectedDatabaseId = canonicalDatabaseId(
      requiredOption(options, '--expected-database-id'),
      '--expected-database-id',
    );
    const expectedDatabaseIdentitySha256 = canonicalSha256(
      requiredOption(options, '--expected-database-identity-sha256'),
      '--expected-database-identity-sha256',
    );
    const expectedDatabaseUuidSha256 = canonicalSha256(
      requiredOption(options, '--expected-database-uuid-sha256'),
      '--expected-database-uuid-sha256',
    );
    const expectedTargetGitCommit = canonicalGitCommit(
      requiredOption(options, '--expected-target-git-commit'),
      '--expected-target-git-commit',
    );
    const attestationPath = path.resolve(requiredOption(options, '--attestation'));
    const expectedAttestationPath = path.join(
      backupDirectory.absolute,
      `deploy-backup-${expectedTargetGitCommit}.attestation.json`,
    );
    if (attestationPath !== expectedAttestationPath) {
      fail(`--attestation must be exactly ${expectedAttestationPath}`);
    }
    const attestationRead = readBoundedNoFollow(
      attestationPath,
      'deploy backup attestation',
      MAX_JSON_BYTES,
    );
    assertPrivateFileMode(attestationRead.pathAfter, 'deploy backup attestation');
    const attestation = parseAttestation(attestationRead);
    if (attestation.databaseId !== expectedDatabaseId
      || attestation.databaseIdentitySha256 !== expectedDatabaseIdentitySha256
      || attestation.databaseUuidSha256 !== expectedDatabaseUuidSha256
      || attestation.targetGitCommit !== expectedTargetGitCommit) {
      fail('deploy backup attestation archival identity does not match');
    }
    assertPathSnapshotUnchanged(
      attestationRead.path,
      attestationRead.pathAfter,
      'deploy backup attestation',
    );
    const digest = createHash('sha256').update(attestationRead.bytes).digest('hex');
    const archivePath = path.join(
      backupDirectory.absolute,
      `deploy-backup-${expectedTargetGitCommit}.attestation.archived-${digest}.json`,
    );
    if (existsSync(archivePath)) {
      const archivedRead = readBoundedNoFollow(
        archivePath,
        'archived deploy backup attestation',
        MAX_JSON_BYTES,
      );
      assertPrivateFileMode(archivedRead.pathAfter, 'archived deploy backup attestation');
      if (!archivedRead.bytes.equals(attestationRead.bytes)) {
        fail('archived deploy backup attestation digest collision');
      }
    } else {
      linkSync(attestationPath, archivePath);
      synchronizeDirectory(backupDirectory);
    }
    const archiveStat = lstatRegularFile(archivePath, 'archived deploy backup attestation');
    if (!sameFile(attestationRead.pathAfter, archiveStat)) {
      fail('archived deploy backup attestation is not the original immutable inode');
    }
    rmSync(attestationPath);
    synchronizeDirectory(backupDirectory);
    const finalArchiveStat = lstatRegularFile(
      archivePath,
      'archived deploy backup attestation',
    );
    assertPrivateFileMode(finalArchiveStat, 'archived deploy backup attestation');
    if (finalArchiveStat.nlink !== 1n) {
      fail('archived deploy backup attestation must have exactly one link');
    }
    console.log(`PASS deploy backup attestation archived: ${archivePath}`);
  } finally {
    closeDirectorySnapshot(backupDirectory);
  }
}

async function main() {
  const { mode, options } = parseArguments();
  if (mode === 'archive') archive(options);
  else if (mode === 'record') await record(options);
  else if (mode === 'restore-stream') await restoreStream(options);
  else await verify(options);
}

main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
