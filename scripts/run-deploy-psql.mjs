#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { postgresConnectionEnvironment } from './postgres-connection-environment.mjs';

function fail(message) {
  throw new Error(message);
}

const CONNECTION_OPTIONS = ['-d', '--dbname', '-h', '--host', '-p', '--port', '-U', '--username'];
const OPTIONS_WITH_SEPARATE_VALUE = new Set([
  '-c', '--command', '-f', '--file', '-L', '--log-file', '-o', '--output',
  '-P', '--pset', '-R', '--record-separator', '-F', '--field-separator',
  '-T', '--table-attr', '-v', '--set', '--variable',
]);

function matchesOption(value, option) {
  if (value === option) return true;
  if (option.startsWith('--')) return value.startsWith(`${option}=`);
  return value.startsWith(option) && value.length > option.length;
}

function psqlArguments() {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  let expectOptionValue = false;
  let separatorSeen = false;
  for (const value of args) {
    if (!value || value.length > 65_536 || /[\0\r\n]/u.test(value)) {
      fail('psql arguments must be bounded nonempty command-line values');
    }
    if (expectOptionValue) {
      expectOptionValue = false;
      continue;
    }
    if (CONNECTION_OPTIONS.some((option) => matchesOption(value, option))) {
      fail('connection target overrides are forbidden; DATABASE_URL is authoritative');
    }
    if (value === '--') {
      if (separatorSeen) fail('psql command separator is duplicated');
      separatorSeen = true;
      continue;
    }
    if (!separatorSeen && value.startsWith('-')) {
      if (OPTIONS_WITH_SEPARATE_VALUE.has(value)) expectOptionValue = true;
      continue;
    }
    fail('positional database targets are forbidden; DATABASE_URL is authoritative');
  }
  if (expectOptionValue) fail('psql command option is missing its value');
  return args;
}

function main() {
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is required');
  const result = spawnSync('psql', ['--no-psqlrc', ...psqlArguments()], {
    env: postgresConnectionEnvironment(process.env.DATABASE_URL, {
      applicationName: 'ss-erp-deploy-recovery',
    }),
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
