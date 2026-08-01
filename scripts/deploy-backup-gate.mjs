#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const MAX_ENV_BYTES = 1024 * 1024;
const FULL_GIT_OID = /^[a-f0-9]{40}$/u;
const RUN_USER = /^[a-z_][a-z0-9_-]{0,31}$/u;
const DURATION = /^([1-9][0-9]*)([smh])$/u;
const REQUIRED_KEYS = [
  'DATABASE_URL',
  'DEPLOY_DATABASE_ID',
  'DEPLOY_BACKUP_LOCAL_DIR',
];
const OPTIONAL_KEYS = [
  'BACKUP_LOCAL_DIR',
  'DEPLOY_BACKUP_MAX_AGE_MINUTES',
  'DEPLOY_BACKUP_VERIFY_TIMEOUT',
];

function fail(message) {
  throw new Error(message);
}

function parseArguments() {
  const values = new Map();
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (![
      '--mode',
      '--env-file',
      '--target-git-commit',
      '--server-dir',
      '--run-user',
      '--migration-timeout',
    ].includes(name) || !value || values.has(name)) {
      fail('deploy backup gate received invalid arguments');
    }
    values.set(name, value);
  }
  const mode = values.get('--mode');
  if (!['verify', 'migrate'].includes(mode)) fail('deploy backup gate mode is invalid');
  if (values.size !== (mode === 'migrate' ? 6 : 3)) {
    fail('deploy backup gate received an incomplete mode-specific argument set');
  }
  return {
    mode,
    envFile: path.resolve(values.get('--env-file')),
    targetGitCommit: values.get('--target-git-commit'),
    serverDirectory: values.has('--server-dir') ? path.resolve(values.get('--server-dir')) : null,
    runUser: values.get('--run-user'),
    migrationTimeout: values.get('--migration-timeout'),
  };
}

function trustedRegularFile(file, label, { maxBytes = null, requireCurrentOwner = true } = {}) {
  let before;
  try {
    before = lstatSync(file, { bigint: true });
  } catch {
    fail(`${label} is missing or unreadable`);
  }
  const expectedUid = typeof process.geteuid === 'function' ? BigInt(process.geteuid()) : before.uid;
  if (before.isSymbolicLink() || !before.isFile()
    || before.size < 1n
    || (requireCurrentOwner && before.uid !== expectedUid)
    || Number(before.mode & 0o022n) !== 0
    || (maxBytes !== null && (before.size < 1n || before.size > BigInt(maxBytes)))) {
    fail(`${label} must be a trusted, bounded regular non-symbolic-link file`);
  }
  return before;
}

function readEnvFile(file) {
  const before = trustedRegularFile(file, 'deployment environment file', {
    maxBytes: MAX_ENV_BYTES,
    requireCurrentOwner: false,
  });
  let descriptor = null;
  try {
    descriptor = openSync(
      file,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameFileSnapshot(before, opened)) {
      fail('deployment environment file changed while it was opened');
    }
    const source = readFileSync(descriptor, 'utf8');
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const pathAfter = trustedRegularFile(file, 'deployment environment file', {
      maxBytes: MAX_ENV_BYTES,
      requireCurrentOwner: false,
    });
    if (!sameFileSnapshot(before, openedAfter) || !sameFileSnapshot(before, pathAfter)) {
      fail('deployment environment file changed while it was read');
    }
    return source;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function sameFileSnapshot(left, right) {
  return [
    'dev',
    'ino',
    'mode',
    'nlink',
    'uid',
    'gid',
    'size',
    'mtimeNs',
    'ctimeNs',
  ].every((field) => left[field] === right[field]);
}

function exactAssignmentCount(source, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return [...source.matchAll(
    new RegExp(`^[ \\t]*(?:export[ \\t]+)?${escaped}[ \\t]*=`, 'gmu'),
  )].length;
}

function loadAllowedEnvironment(source) {
  let parsed;
  try {
    parsed = parseEnv(source);
  } catch {
    fail('deployment environment file is not valid dotenv data');
  }
  const selected = {};
  for (const key of REQUIRED_KEYS) {
    if (exactAssignmentCount(source, key) !== 1 || !parsed[key]) {
      fail(`${key} must be assigned exactly once in the deployment environment file`);
    }
    selected[key] = parsed[key];
  }
  for (const key of OPTIONAL_KEYS) {
    const count = exactAssignmentCount(source, key);
    if (count > 1) fail(`${key} must not be assigned more than once`);
    if (count === 1) selected[key] = parsed[key];
  }
  return selected;
}

function assertTrustedGateDirectory(directory, targetGitCommit) {
  let directoryMetadata;
  try {
    directoryMetadata = lstatSync(directory, { bigint: true });
  } catch {
    fail('deployment gate directory is missing or unreadable');
  }
  const expectedUid = typeof process.geteuid === 'function'
    ? BigInt(process.geteuid())
    : directoryMetadata.uid;
  if (directoryMetadata.isSymbolicLink() || !directoryMetadata.isDirectory()
    || directoryMetadata.uid !== expectedUid
    || Number(directoryMetadata.mode & 0o022n) !== 0) {
    fail('deployment gate directory must be owned by the orchestrator and not writable by others');
  }
  const requiredFiles = [
    'deploy-backup-gate.mjs',
    'deploy-backup-attestation.mjs',
    'deploy-database-identity.mjs',
    'postgres-connection-environment.mjs',
    'deploy-environment.mjs',
    'deploy-source-manifest.mjs',
    'freeze-deploy-source.sh',
    'verify-deploy-backup.sh',
    'TARGET_GIT_COMMIT',
  ];
  for (const name of requiredFiles) {
    trustedRegularFile(path.join(directory, name), `deployment gate ${name}`, {
      maxBytes: name === 'TARGET_GIT_COMMIT' ? 64 : null,
    });
  }
  const marker = readFileSync(path.join(directory, 'TARGET_GIT_COMMIT'), 'utf8');
  if (marker !== `${targetGitCommit}\n`) {
    fail('installed deployment gate does not match the target Git commit');
  }
}

function checkedDuration(value) {
  const match = value.match(DURATION);
  const factors = { s: 1, m: 60, h: 3600 };
  const seconds = match ? Number(match[1]) * factors[match[2]] : Number.NaN;
  if (!Number.isSafeInteger(seconds) || seconds > 24 * 60 * 60) {
    fail('migration timeout must be a positive duration no longer than 24 hours');
  }
  return value;
}

function runChecked(command, args, options, label) {
  const result = spawnSync(command, args, {
    ...options,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0) fail(`${label} failed`);
}

function runDatabaseCommandAsUser({ runUser, serverDirectory, environment, timeout }, args, label) {
  const childEnvironment = {
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: `/home/${runUser}`,
    LANG: 'C.UTF-8',
    NODE_ENV: 'production',
    DATABASE_URL: environment.DATABASE_URL,
  };
  runChecked('runuser', [
    '--user', runUser, '--preserve-environment', '--',
    'timeout', '--signal=TERM', '--kill-after=30s', timeout,
    ...args,
  ], { cwd: serverDirectory, env: childEnvironment }, label);
}

function verifyFrozenSource(gateDirectory, targetGitCommit, serverDirectory) {
  const sourceRoot = path.resolve(serverDirectory, '..', '..');
  runChecked('bash', [
    path.join(gateDirectory, 'freeze-deploy-source.sh'),
    'verify',
    targetGitCommit,
    sourceRoot,
  ], {
    env: {
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      HOME: '/root',
      LANG: 'C.UTF-8',
    },
  }, 'frozen migration source verification');
}

function main() {
  const {
    mode,
    envFile,
    targetGitCommit,
    serverDirectory,
    runUser,
    migrationTimeout: rawMigrationTimeout,
  } = parseArguments();
  if (!FULL_GIT_OID.test(targetGitCommit)) {
    fail('target Git commit must be one lowercase full 40-character object ID');
  }
  if (mode === 'migrate' && !RUN_USER.test(runUser)) fail('deployment run user is invalid');
  if (typeof process.geteuid === 'function' && process.geteuid() !== 0) {
    fail('deployment backup gate and migration orchestrator must run as root');
  }
  let migrationTimeout = null;
  if (mode === 'migrate') {
    let serverMetadata;
    try {
      serverMetadata = lstatSync(serverDirectory);
    } catch {
      fail('server directory is missing or unreadable');
    }
    const expectedUid = typeof process.geteuid === 'function'
      ? process.geteuid()
      : serverMetadata.uid;
    if (serverMetadata.isSymbolicLink() || !serverMetadata.isDirectory()
      || serverMetadata.uid !== expectedUid || (serverMetadata.mode & 0o022) !== 0) {
      fail('server directory must be frozen, orchestrator-owned, and non-writable by others');
    }
    migrationTimeout = checkedDuration(rawMigrationTimeout);
  }
  const gateDirectory = path.dirname(fileURLToPath(import.meta.url));
  assertTrustedGateDirectory(gateDirectory, targetGitCommit);
  const selected = loadAllowedEnvironment(readEnvFile(envFile));
  const environment = {
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: process.platform === 'win32' ? (process.env.USERPROFILE || '') : '/root',
    LANG: 'C.UTF-8',
    DEPLOY_TARGET_GIT_COMMIT: targetGitCommit,
    ...selected,
  };
  runChecked('bash', [
    path.join(gateDirectory, 'verify-deploy-backup.sh'),
    targetGitCommit,
  ], {
    env: environment,
  }, 'deployment backup gate');
  if (mode === 'verify') return;
  verifyFrozenSource(gateDirectory, targetGitCommit, serverDirectory);
  runDatabaseCommandAsUser({
    runUser,
    serverDirectory,
    environment: selected,
    timeout: migrationTimeout,
  }, ['pnpm', 'exec', 'prisma', 'migrate', 'deploy'], 'Prisma migration');
  verifyFrozenSource(gateDirectory, targetGitCommit, serverDirectory);
  runDatabaseCommandAsUser({
    runUser,
    serverDirectory,
    environment: selected,
    timeout: migrationTimeout,
  }, ['node', 'scripts/verify-ai-media-suite-post-migration.mjs'], 'post-migration guard');
  verifyFrozenSource(gateDirectory, targetGitCommit, serverDirectory);
}

try {
  main();
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
