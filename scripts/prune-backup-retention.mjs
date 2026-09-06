#!/usr/bin/env node
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKUP_FILE = /^ss_erp_[0-9]{8}_[0-9]{6}\.sql\.gz$/u;
const BACKUP_STATUS_FILE = /^ss_erp_[0-9]{8}_[0-9]{6}\.sql\.gz\.status\.json$/u;
const ATTESTATION_FILE = /^deploy-backup-([a-f0-9]{40})\.attestation(?:\.archived-[a-f0-9]{64})?\.json$/u;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_DIRECTORY_ENTRIES = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function fail(message) {
  throw new Error(`Backup retention failed: ${message}`);
}

function canonicalBackupFilename(value, field) {
  if (typeof value !== 'string' || !BACKUP_FILE.test(value) || path.basename(value) !== value) {
    fail(`${field} is invalid`);
  }
  return value;
}

function sameFile(left, right) {
  return [
    'dev',
    'ino',
    'mode',
    'nlink',
    'uid',
    'gid',
    'size',
    'mtimeMs',
    'ctimeMs',
  ].every((field) => left[field] === right[field]);
}

function readCanonicalJson(file, label) {
  const before = lstatSync(file);
  if (before.isSymbolicLink() || !before.isFile() || before.size < 1 || before.size > MAX_JSON_BYTES) {
    fail(`${label} must be a bounded regular non-symlink file`);
  }
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    fail(`${label} is unreadable`);
  }
  const after = lstatSync(file);
  if (!sameFile(before, after)) fail(`${label} changed while it was read`);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must contain an object`);
  }
  if (text !== `${JSON.stringify(value, null, 2)}\n`) {
    fail(`${label} must use canonical JSON`);
  }
  return value;
}

function protectBackup(protectedFiles, filename) {
  protectedFiles.add(filename);
  protectedFiles.add(`${filename}.status.json`);
}

function parseLatestStatus(file, protectedFiles) {
  const value = readCanonicalJson(file, 'backup-status.json');
  if (value.schemaVersion !== 3) fail('backup-status.json schemaVersion must be 3');
  protectBackup(
    protectedFiles,
    canonicalBackupFilename(value.lastLocalFile, 'backup-status.json lastLocalFile'),
  );
}

function parseAttestation(file, filename, commit, protectedFiles) {
  const value = readCanonicalJson(file, filename);
  if (
    value.schemaVersion !== 2
    || value.kind !== 'SS_ERP_DEPLOY_BACKUP_ATTESTATION'
    || value.targetGitCommit !== commit
    || !value.backup
    || typeof value.backup !== 'object'
    || Array.isArray(value.backup)
  ) {
    fail(`${filename} is not a valid deployment backup attestation`);
  }
  protectBackup(
    protectedFiles,
    canonicalBackupFilename(value.backup.filename, `${filename} backup filename`),
  );
}

function backupDirectory(directory) {
  if (typeof directory !== 'string' || !directory.trim() || !path.isAbsolute(directory)) {
    fail('backup directory must be an explicit absolute path');
  }
  const resolved = path.resolve(directory);
  if (resolved === path.parse(resolved).root) fail('backup directory must not be a filesystem root');
  const stat = lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync.native(resolved) !== resolved) {
    fail('backup directory must be a canonical non-symlink directory');
  }
  if (typeof process.geteuid === 'function' && stat.uid !== process.geteuid()) {
    fail('backup directory must be owned by the retention process');
  }
  if (process.platform !== 'win32' && (stat.mode & 0o022) !== 0) {
    fail('backup directory must not be writable by group or world');
  }
  return resolved;
}

function keepDaysValue(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 36_500) {
    fail('keep days must be an integer from 0 through 36500');
  }
  return parsed;
}

export function collectProtectedBackupFiles(directory) {
  const root = backupDirectory(directory);
  const entries = readdirSync(root, { withFileTypes: true });
  if (entries.length > MAX_DIRECTORY_ENTRIES) fail('backup directory contains too many entries');
  const protectedFiles = new Set();
  const latest = entries.find((entry) => entry.name === 'backup-status.json');
  if (latest) {
    if (!latest.isFile() || latest.isSymbolicLink()) fail('backup-status.json must be a regular file');
    parseLatestStatus(path.join(root, latest.name), protectedFiles);
  }
  for (const entry of entries) {
    const match = entry.name.match(ATTESTATION_FILE);
    if (!match) continue;
    if (!entry.isFile() || entry.isSymbolicLink()) {
      fail(`${entry.name} must be a regular file`);
    }
    parseAttestation(path.join(root, entry.name), entry.name, match[1], protectedFiles);
  }
  return Object.freeze([...protectedFiles].sort());
}

function isExpired(mtimeMs, nowMs, keepDays) {
  if (!Number.isFinite(mtimeMs) || mtimeMs > nowMs) return false;
  return Math.floor((nowMs - mtimeMs) / DAY_MS) > keepDays;
}

export function pruneBackupRetention({
  directory,
  keepDays,
  now = new Date(),
} = {}) {
  const root = backupDirectory(directory);
  const normalizedKeepDays = keepDaysValue(keepDays);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('retention clock is invalid');
  const protectedFiles = new Set(collectProtectedBackupFiles(root));
  const entries = readdirSync(root, { withFileTypes: true });
  if (entries.length > MAX_DIRECTORY_ENTRIES) fail('backup directory contains too many entries');
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    if (!BACKUP_FILE.test(entry.name) && !BACKUP_STATUS_FILE.test(entry.name)) continue;
    if (protectedFiles.has(entry.name)) continue;
    const file = path.join(root, entry.name);
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) continue;
    if (isExpired(stat.mtimeMs, now.getTime(), normalizedKeepDays)) {
      candidates.push({ file, name: entry.name, stat });
    }
  }
  candidates.sort((left, right) => {
    const leftStatus = BACKUP_STATUS_FILE.test(left.name);
    const rightStatus = BACKUP_STATUS_FILE.test(right.name);
    if (leftStatus !== rightStatus) return leftStatus ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  const deleted = [];
  for (const candidate of candidates) {
    const current = lstatSync(candidate.file);
    if (!sameFile(candidate.stat, current) || current.isSymbolicLink() || !current.isFile()) {
      fail(`${candidate.name} changed before retention cleanup`);
    }
    rmSync(candidate.file);
    deleted.push(candidate.name);
  }
  return Object.freeze({
    deleted: Object.freeze(deleted.sort()),
    protected: Object.freeze([...protectedFiles].sort()),
  });
}

function parseCliArgs(argv) {
  const allowed = new Set(['--backup-dir', '--keep-days', '--count']);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--count') {
      if (values.has(name)) fail('arguments are invalid');
      values.set(name, true);
      continue;
    }
    const value = argv[index + 1];
    if (!allowed.has(name) || values.has(name) || typeof value !== 'string' || value.startsWith('--')) {
      fail('arguments are invalid');
    }
    values.set(name, value);
    index += 1;
  }
  if (!values.has('--backup-dir') || !values.has('--keep-days')) fail('backup directory and keep days are required');
  return {
    directory: values.get('--backup-dir'),
    keepDays: values.get('--keep-days'),
    count: values.get('--count') === true,
  };
}

function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = pruneBackupRetention(options);
  if (options.count) console.log(result.deleted.filter((name) => BACKUP_FILE.test(name)).length);
  else console.log(JSON.stringify(result, null, 2));
}

function isDirectRun(entry = process.argv[1]) {
  if (!entry) return false;
  try {
    return realpathSync.native(path.resolve(entry)) === realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
