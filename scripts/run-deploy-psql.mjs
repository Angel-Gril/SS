#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const PRISMA_ONLY_PARAMETERS = [
  'connection_limit',
  'pool_timeout',
  'schema',
  'socket_timeout',
  'pgbouncer',
];

function fail(message) {
  throw new Error(message);
}

function psqlUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('DATABASE_URL must be one valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !url.hostname
    || url.hash
    || !url.pathname
    || url.pathname === '/') {
    fail('DATABASE_URL must identify one PostgreSQL database');
  }
  for (const parameter of PRISMA_ONLY_PARAMETERS) url.searchParams.delete(parameter);
  return url.toString();
}

function psqlArguments() {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  for (const value of args) {
    if (!value || value.length > 65_536 || /[\0\r\n]/u.test(value)) {
      fail('psql arguments must be bounded nonempty command-line values');
    }
    if (value === '-d' || value.startsWith('-d') || value === '--dbname'
      || value.startsWith('--dbname=')) {
      fail('database target overrides are forbidden; DATABASE_URL is authoritative');
    }
  }
  return args;
}

function main() {
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is required');
  const result = spawnSync('psql', ['--no-psqlrc', ...psqlArguments()], {
    env: {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || '',
      LANG: 'C.UTF-8',
      PGAPPNAME: 'ss-erp-deploy-recovery',
      PGDATABASE: psqlUrl(process.env.DATABASE_URL),
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0) {
    fail('psql recovery command failed');
  }
}

try {
  main();
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
