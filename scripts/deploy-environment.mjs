#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseEnv } from 'node:util';

const MAX_ENV_BYTES = 1024 * 1024;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const FORBIDDEN_EXECUTION_KEYS = new Set([
  'BASH_ENV',
  'CDPATH',
  'DEPLOY_ENV_PRELOADED',
  'ENV',
  'EXTENSION_PREVIOUS_BUILD_ROOT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'HOME',
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'NODE_OPTIONS',
  'NODE_PATH',
  'PATH',
  'PNPM_HOME',
  'SHELLOPTS',
]);
const BUILD_KEYS = new Set([
  'CORS_ORIGIN',
  'EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN',
  'EXTENSION_RELEASE_EXPECTED_API_ORIGIN',
  'EXTENSION_RELEASE_EXPECTED_LOCAL_ORIGIN',
  'EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN',
  'LEGAL_PROFILE',
  'NODE_ENV',
  'RUNTIME_MODE',
]);

function fail(message) {
  throw new Error(message);
}

function sameSnapshot(left, right) {
  return ['dev', 'ino', 'mode', 'nlink', 'uid', 'gid', 'size', 'mtimeNs', 'ctimeNs']
    .every((field) => left[field] === right[field]);
}

function trustedEnvironmentFile(file) {
  let metadata;
  try {
    metadata = lstatSync(file, { bigint: true });
  } catch {
    fail('deployment environment file is missing or unreadable');
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1n
    || metadata.size < 1n || metadata.size > BigInt(MAX_ENV_BYTES)
    || (process.platform !== 'win32' && Number(metadata.mode & 0o022n) !== 0)) {
    fail('deployment environment must be one bounded non-writable regular file');
  }
  return metadata;
}

function readStableEnvironment(file) {
  const absolute = path.resolve(file);
  const before = trustedEnvironmentFile(absolute);
  let descriptor = null;
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameSnapshot(before, opened)) fail('deployment environment changed while opening');
    const bytes = readFileSync(descriptor);
    let source;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      fail('deployment environment must be strict UTF-8');
    }
    const after = fstatSync(descriptor, { bigint: true });
    const pathAfter = trustedEnvironmentFile(absolute);
    if (!sameSnapshot(before, after) || !sameSnapshot(before, pathAfter)) {
      fail('deployment environment changed while reading');
    }
    return { bytes, source };
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function parsedEnvironment(file) {
  const { bytes, source } = readStableEnvironment(file);
  const assignments = new Set();
  for (const match of source.matchAll(
    /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=/gmu,
  )) {
    if (assignments.has(match[1])) fail(`duplicate deployment environment key: ${match[1]}`);
    assignments.add(match[1]);
  }
  let parsed;
  try {
    parsed = parseEnv(source);
  } catch {
    fail('deployment environment is not valid dotenv data');
  }
  for (const key of Object.keys(parsed)) {
    if (FORBIDDEN_EXECUTION_KEYS.has(key)) {
      fail(`deployment environment key is forbidden: ${key}`);
    }
  }
  return { bytes, parsed, source };
}

function snapshot(sourceFile, outputFile, parseAsEnvironment = true) {
  const output = path.resolve(outputFile);
  const parent = path.dirname(output);
  const parentMetadata = lstatSync(parent, { bigint: true });
  const expectedUid = typeof process.geteuid === 'function'
    ? BigInt(process.geteuid())
    : parentMetadata.uid;
  if (parentMetadata.isSymbolicLink() || !parentMetadata.isDirectory()
    || parentMetadata.uid !== expectedUid
    || (process.platform !== 'win32' && Number(parentMetadata.mode & 0o077n) !== 0)) {
    fail('deployment environment snapshot parent must be private and owned by the caller');
  }
  const { bytes } = parseAsEnvironment
    ? parsedEnvironment(sourceFile)
    : readStableEnvironment(sourceFile);
  let descriptor = null;
  try {
    descriptor = openSync(
      output,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
      0o600,
    );
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
  const created = lstatSync(output, { bigint: true });
  if (!created.isFile() || created.isSymbolicLink() || created.nlink !== 1n
    || created.uid !== expectedUid
    || (process.platform !== 'win32' && Number(created.mode & 0o077n) !== 0)) {
    fail('deployment environment snapshot is not private');
  }
}

function value(file, key) {
  if (!ENV_KEY.test(key)) fail('deployment environment key is invalid');
  const { parsed } = parsedEnvironment(file);
  process.stdout.write(parsed[key] || '');
}

function compare(leftFile, rightFile) {
  const left = parsedEnvironment(leftFile).bytes;
  const right = parsedEnvironment(rightFile).bytes;
  if (!left.equals(right)) fail('deployment environment changed after its snapshot was created');
}

function execute(profile, file, cwd, command, args, identity = null) {
  const { parsed } = parsedEnvironment(file);
  const selected = profile === 'build'
    ? Object.fromEntries(Object.entries(parsed).filter(([key]) => (
        BUILD_KEYS.has(key) || key.startsWith('NEXT_PUBLIC_')
      )))
    : parsed;
  if (profile === 'build') {
    selected.DATABASE_URL = 'postgresql://deploy_build:deploy_build@127.0.0.1:1/deploy_build';
  }
  const environment = {
    ...selected,
    PATH: process.env.PATH || '',
    HOME: identity?.home || process.env.HOME || '',
    LANG: process.env.LANG || 'C.UTF-8',
    USER: process.env.USER || '',
    LOGNAME: process.env.LOGNAME || '',
    DEPLOY_ENV_PRELOADED: '1',
  };
  for (const key of [
    'DEPLOY_DIR',
    'ENV_FILE',
    'EXTENSION_PREVIOUS_BUILD_ROOT',
    'SKIP_HTTP_CHECK',
    'SKIP_PROCESS_ENV_CHECKS',
    'SKIP_SERVICE_CHECKS',
  ]) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  if (identity && typeof process.setgroups === 'function') process.setgroups([]);
  const previousUmask = profile === 'build' ? process.umask(0o022) : null;
  let result;
  try {
    result = spawnSync(command, args, {
      cwd: path.resolve(cwd),
      env: environment,
      stdio: 'inherit',
      ...(identity ? { uid: identity.uid, gid: identity.gid } : {}),
      windowsHide: true,
    });
  } finally {
    if (previousUmask !== null) process.umask(previousUmask);
  }
  if (result.error || result.signal || result.status !== 0) {
    process.exitCode = result.status || 1;
  }
}

function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'snapshot' && args.length === 2) return snapshot(args[0], args[1]);
  if (mode === 'snapshot-file' && args.length === 2) return snapshot(args[0], args[1], false);
  if (mode === 'compare' && args.length === 2) return compare(args[0], args[1]);
  if (mode === 'value' && args.length === 2) return value(args[0], args[1]);
  if (mode === 'exec-build' || mode === 'exec-check') {
    const separator = args.indexOf('--');
    if (separator !== 2 || !args[0] || !args[1] || !args[3]) {
      fail('deploy environment exec usage is: exec-build|exec-check <env-file> <cwd> -- <command> [args...]');
    }
    return execute(mode === 'exec-build' ? 'build' : 'check', args[0], args[1], args[3], args.slice(4));
  }
  if (mode === 'exec-build-as' || mode === 'exec-check-as') {
    const separator = args.indexOf('--');
    if (separator !== 5 || !args[0] || !args[1] || !args[2] || !args[3] || !args[4]
      || !args[6] || typeof process.geteuid !== 'function' || process.geteuid() !== 0) {
      fail('deploy environment exec-as usage is: <env> <cwd> <uid> <gid> <home> -- <command> [args...]');
    }
    const uid = Number(args[2]);
    const gid = Number(args[3]);
    if (!Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(gid) || gid <= 0
      || !path.isAbsolute(args[4])) {
      fail('deploy environment execution identity is invalid');
    }
    return execute(
      mode === 'exec-build-as' ? 'build' : 'check',
      args[0],
      args[1],
      args[6],
      args.slice(7),
      { uid, gid, home: args[4] },
    );
  }
  fail('deploy environment usage is snapshot, snapshot-file, compare, value, exec-build/check, or exec-build/check-as');
}

try {
  main();
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
